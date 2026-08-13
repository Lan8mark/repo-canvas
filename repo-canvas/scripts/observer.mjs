import fs from "node:fs";
import path from "node:path";

import { appendEvent, createEvent, getSnapshot } from "./canvas-store.mjs";
import {
  listCodexSessionFiles, readAppendedRecords, readSessionMeta, sessionBelongsToRepository, sessionSignals,
} from "./codex-sessions.mjs";
import { runCodexStructured } from "./model-runtime.mjs";
import { OBSERVER_OUTPUT_SCHEMA, applyObserverDecision } from "./semantic-model.mjs";
import { readObserverState, readRuntimeConfig, writeObserverState } from "./runtime-config.mjs";

const MAX_EVENTS = 80;
const INITIAL_DEADLINE_MS = 5_000;
const UPDATE_INTERVAL_MS = 30_000;

function workId(sessionId, turnId) {
  const safeSession = String(sessionId || "session").replace(/^019f/i, "").slice(-20).replace(/[^A-Za-z0-9.-]/g, "-");
  const safeTurn = String(turnId || Date.now()).slice(-20).replace(/[^A-Za-z0-9.-]/g, "-");
  return `observed-${safeSession}-${safeTurn}`.slice(0, 128);
}

function compactMap(snapshot) {
  return {
    areas: snapshot.areas.map(({ id, title, note }) => ({ id, title, note })),
    entities: snapshot.entities.map(({ id, areaId, label, status, purpose }) => ({ id, areaId, label, status, purpose })),
    relations: snapshot.relations.map(({ id, from, to, label, status }) => ({ id, from, to, label, status })),
  };
}

export function observerPrompt({ turn, final, snapshot }) {
  return `You are Repo Canvas Observer, a silent semantic stenographer. Interpret one coding-agent turn and update an existing high-level project map.

You never inspect the repository, never write code, never answer the owner and never invent explanations. Use only the supplied public session events and current semantic map. Hidden reasoning is unavailable and irrelevant.

Rules:
- describe the concrete work in a short title and summary;
- attach work to every existing semantic entity it genuinely affects;
- during active work, new approved concepts may be created as planned entities and planned relations;
- at completion, update passports and relations only when the session provides enough evidence;
- removing a file is not enough to remove an entity;
- remove an entity only when the session establishes that the concept itself was eliminated or merged away;
- rename, move or reimplementation keeps the stable entity id;
- if evidence is insufficient, leave architecture unchanged;
- for a final successful turn use done; for abort use stopped; otherwise active or blocked;
- return required structured output only.

Final checkpoint: ${final ? "yes" : "no"}
Session: ${JSON.stringify({ id: turn.sessionId, model: turn.model, effort: turn.effort })}
Current work: ${JSON.stringify({ title: turn.title, summary: turn.summary, targets: turn.targets })}
Current semantic map: ${JSON.stringify(compactMap(snapshot))}
New public events: ${JSON.stringify(turn.events)}`;
}

function sessionLocator(meta, firstUserMessage = "") {
  const desktop = /desktop/i.test(meta.originator || "");
  return {
    kind: desktop ? "codex-app" : "codex-cli",
    id: meta.id || meta.session_id,
    title: firstUserMessage.slice(0, 160) || "Observed Codex work",
    cwd: meta.cwd,
  };
}

function provisionalWork(turn, meta) {
  appendEvent(createEvent("work.upsert", {
    actor: "observer",
    payload: {
      id: turn.workId,
      title: "Новая работа",
      status: "active",
      targets: [],
      note: "Агент осмысливает задачу",
      provisional: true,
      session: sessionLocator(meta),
    },
  }));
}

function activityError(message) {
  appendEvent(createEvent("activity.log", { actor: "observer", payload: { message, level: "warning" } }));
}

export class CodexObserver {
  constructor({
    config = readRuntimeConfig(),
    state = readObserverState(),
    runner = runCodexStructured,
    now = () => Date.now(),
    sessionsRoot,
    replay = false,
  } = {}) {
    this.config = config;
    this.state = state;
    this.runner = runner;
    this.now = now;
    this.sessionsRoot = sessionsRoot;
    this.replay = replay;
    this.initialDiscoveryDone = false;
    this.gitCache = new Map();
    this.running = new Map();
  }

  ensureSession(file, meta, baseline = false) {
    const key = path.resolve(file);
    let session = this.state.sessions[key];
    if (!session) {
      session = {
        offset: this.replay || !baseline ? 0 : fs.statSync(file).size,
        relevant: sessionBelongsToRepository(meta, this.config.repoRoot, this.gitCache),
        meta,
        turns: {},
      };
      this.state.sessions[key] = session;
    }
    return session;
  }

  discover() {
    const baseline = !this.initialDiscoveryDone;
    for (const file of listCodexSessionFiles(this.sessionsRoot)) {
      let meta;
      try { meta = readSessionMeta(file); } catch { continue; }
      if (!meta) continue;
      this.ensureSession(file, meta, baseline);
    }
    this.initialDiscoveryDone = true;
  }

  currentTurn(session, turnId) {
    if (turnId && session.turns[turnId]) return session.turns[turnId];
    return Object.values(session.turns).filter((turn) => !turn.finished).sort((a, b) => b.startedAt - a.startedAt)[0] || null;
  }

  handleSignal(session, signal) {
    if (signal.kind === "start") {
      const turnId = signal.turnId || `turn-${this.now()}`;
      const turn = {
        turnId, workId: workId(session.meta.id || session.meta.session_id, turnId),
        sessionId: session.meta.id || session.meta.session_id,
        startedAt: this.now(), events: [], inferredAt: 0, initialInferred: false,
        title: "Новая работа", summary: "Агент осмысливает задачу", targets: [], finished: false,
      };
      session.turns[turnId] = turn;
      provisionalWork(turn, session.meta);
      return;
    }
    const turn = this.currentTurn(session, signal.turnId);
    if (!turn) return;
    if (signal.kind === "context") {
      turn.model = signal.model; turn.effort = signal.effort;
      return;
    }
    turn.events.push(signal);
    if (turn.events.length > MAX_EVENTS) turn.events.splice(0, turn.events.length - MAX_EVENTS);
    if (signal.kind === "user") {
      turn.userMessage = signal.text;
      turn.session = sessionLocator(session.meta, signal.text);
    }
    if (signal.kind === "complete" || signal.kind === "aborted") {
      turn.finished = true;
      turn.finalKind = signal.kind;
      turn.finalPending = true;
    }
    if (signal.kind === "tool" && signal.name === "update_plan") turn.priorityPending = true;
  }

  async infer(turn, final = false) {
    if (this.running.has(turn.workId)) return;
    const operation = (async () => {
      try {
        const snapshot = getSnapshot();
        const result = await this.runner({
          role: "observer", cwd: this.config.repoRoot,
          prompt: observerPrompt({ turn, final, snapshot }), outputSchema: OBSERVER_OUTPUT_SCHEMA,
        });
        if (final && turn.finalKind === "aborted") result.value.workStatus = "stopped";
        const context = {
          workId: turn.workId,
          session: turn.session || sessionLocator({ id: turn.sessionId, cwd: this.config.repoRoot }),
          final,
        };
        applyObserverDecision(result.value, context);
        turn.title = result.value.workTitle;
        turn.summary = result.value.workSummary;
        turn.targets = result.value.targetEntityIds;
        turn.initialInferred = true;
        turn.inferredAt = this.now();
        turn.events = [];
        turn.priorityPending = false;
        turn.finalPending = false;
      } catch (error) {
        activityError(`Observer could not classify ${turn.workId}: ${error.message}`);
        if (final) {
          appendEvent(createEvent("work.upsert", {
            actor: "observer",
            payload: {
              id: turn.workId, title: turn.title, status: turn.finalKind === "aborted" ? "stopped" : "done",
              targets: turn.targets || [], note: turn.summary || "Session completed before semantic classification",
              provisional: (turn.targets || []).length === 0, session: turn.session,
            },
          }));
          turn.finalPending = false;
        }
      }
    })();
    this.running.set(turn.workId, operation);
    try { await operation; } finally { this.running.delete(turn.workId); }
  }

  async runDue() {
    const pending = [];
    for (const session of Object.values(this.state.sessions)) {
      if (!session.relevant) continue;
      for (const turn of Object.values(session.turns)) {
        if (turn.finalPending) pending.push(this.infer(turn, true));
        else if (turn.finished) continue;
        else if (!turn.initialInferred && (turn.events.some((item) => ["agent", "tool"].includes(item.kind))
          || this.now() - turn.startedAt >= INITIAL_DEADLINE_MS)) pending.push(this.infer(turn, false));
        else if (turn.priorityPending || (turn.events.length && this.now() - turn.inferredAt >= UPDATE_INTERVAL_MS)) pending.push(this.infer(turn, false));
      }
    }
    await Promise.all(pending);
  }

  async tick() {
    this.discover();
    for (const [file, session] of Object.entries(this.state.sessions)) {
      if (!session.relevant || !fs.existsSync(file)) continue;
      const delta = readAppendedRecords(file, session.offset);
      session.offset = delta.offset;
      for (const record of delta.records) for (const signal of sessionSignals(record)) this.handleSignal(session, signal);
    }
    await this.runDue();
    this.state.updatedAt = new Date(this.now()).toISOString();
    writeObserverState(this.state);
    return this.summary();
  }

  summary() {
    const sessions = Object.values(this.state.sessions);
    const turns = sessions.flatMap((session) => Object.values(session.turns || {}));
    return {
      provider: "codex", repoRoot: this.config.repoRoot,
      trackedSessions: sessions.filter((session) => session.relevant).length,
      ignoredSessions: sessions.filter((session) => !session.relevant).length,
      activeTurns: turns.filter((turn) => !turn.finished).length,
      pendingModelCalls: this.running.size,
    };
  }
}

export async function runObserverOnce(options = {}) {
  const observer = new CodexObserver(options);
  return observer.tick();
}

export function startObserver(options = {}) {
  const observer = new CodexObserver(options);
  let stopped = false;
  let timer = null;
  let ticking = false;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      if (!ticking) {
        ticking = true;
        try { await observer.tick(); } catch (error) { activityError(`Observer tick failed: ${error.message}`); }
        finally { ticking = false; }
      }
      schedule();
    }, observer.config.pollMs);
    timer.unref?.();
  };
  observer.tick().catch((error) => activityError(`Observer start failed: ${error.message}`)).finally(schedule);
  return {
    observer,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await Promise.all(observer.running.values());
    },
  };
}
