import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-provider-stress-"));
const repo = path.join(root, "repo");
const unrelated = path.join(root, "unrelated");
const claudeHome = path.join(root, "claude");
const kimiHome = path.join(root, "kimi");
fs.mkdirSync(repo, { recursive: true });
fs.mkdirSync(unrelated, { recursive: true });
fs.mkdirSync(path.join(claudeHome, "projects", "fixture"), { recursive: true });
fs.mkdirSync(kimiHome, { recursive: true });
process.env.REPO_CANVAS_ROOT = repo;
process.env.REPO_CANVAS_DATA_DIR = path.join(root, "data");
process.env.REPO_CANVAS_CLAUDE_HOME = claudeHome;
process.env.REPO_CANVAS_KIMI_HOME = kimiHome;

const store = await import("../repo-canvas/scripts/canvas-store.mjs");
const { SessionObserver } = await import("../repo-canvas/scripts/observer.mjs");
const { claudeSessionAdapter } = await import("../repo-canvas/scripts/claude-sessions.mjs");
const { kimiSessionAdapter } = await import("../repo-canvas/scripts/kimi-sessions.mjs");

function writeLines(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

try {
  store.appendEvent(store.createEvent("area.upsert", { actor: "stress", payload: { id: "core", title: "Core", note: "", order: 1 } }));
  for (let index = 0; index < 240; index += 1) {
    store.appendEvent(store.createEvent("entity.upsert", { actor: "stress", payload: {
      id: `module-${index}`, areaId: "core", label: `Module ${index}`, status: "operational",
      path: `src/${index}`, purpose: "Stress", note: "", inputs: [], outputs: [], dependsOn: [], order: index,
    } }));
  }

  for (let index = 0; index < 160; index += 1) {
    const cwd = index < 120 ? repo : unrelated;
    writeLines(path.join(claudeHome, "projects", "fixture", `session-${index}.jsonl`), [
      { type: "user", sessionId: `claude-${index}`, cwd, promptId: `p-${index}`, timestamp: "2026-08-13T00:00:00Z", message: { content: `Update module ${index}` } },
      { type: "assistant", sessionId: `claude-${index}`, cwd, timestamp: "2026-08-13T00:00:01Z", message: { content: [{ type: "text", text: "Done" }], stop_reason: "end_turn" } },
    ]);
  }

  const kimiIndex = [];
  for (let index = 0; index < 160; index += 1) {
    const cwd = index < 120 ? repo : unrelated;
    const sessionDir = path.join(kimiHome, "sessions", "wd", `session_${index}`);
    kimiIndex.push({ sessionId: `session_${index}`, sessionDir, workDir: cwd });
    writeLines(path.join(sessionDir, "state.json"), [{ id: `session_${index}`, title: `Kimi ${index}` }]);
    writeLines(path.join(sessionDir, "agents", "main", "wire.jsonl"), [
      { type: "turn.prompt", time: index + 1, input: [{ type: "text", text: `Update module ${120 + index}` }] },
      { type: "context.append_loop_event", time: index + 2, event: { type: "content.part", part: { type: "think", text: "ignored" } } },
      { type: "context.append_loop_event", time: index + 3, event: { type: "content.part", part: { type: "text", text: "Done" } } },
      { type: "context.append_loop_event", time: index + 4, event: { type: "step.end", turnId: index, finishReason: "end_turn" } },
    ]);
  }
  writeLines(path.join(kimiHome, "session_index.jsonl"), kimiIndex);

  let calls = 0;
  const runner = async ({ prompt }) => {
    calls += 1;
    const index = Number(prompt.match(/Update module (\d+)/)?.[1] || 0);
    return { profile: { model: "fixture", effort: "low" }, value: {
      workTitle: `Module ${index}`, workSummary: "Done", workStatus: "done",
      targetEntityIds: [`module-${index}`], entityChanges: [], relationChanges: [],
    } };
  };
  const observer = new SessionObserver({
    config: { enabled: true, repoRoot: repo, providers: ["claude", "kimi"], pollMs: 250 },
    state: { version: 2, sessions: {} }, adapters: [claudeSessionAdapter, kimiSessionAdapter], replay: true, runner,
  });
  const started = performance.now();
  const summary = await observer.tick();
  const elapsedMs = Math.round(performance.now() - started);
  const snapshot = store.getSnapshot();
  assert.equal(summary.trackedSessions, 240);
  assert.equal(summary.ignoredSessions, 80);
  assert.equal(calls, 240);
  assert.equal(snapshot.work.length, 240);
  assert.equal(snapshot.storeErrors.length, 0);
  console.log(JSON.stringify({ ok: true, elapsedMs, calls, ...summary }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
