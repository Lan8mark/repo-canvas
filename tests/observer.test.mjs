import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-observer-"));
const sessionsRoot = path.join(root, "sessions");
fs.mkdirSync(sessionsRoot, { recursive: true });
fs.writeFileSync(path.join(root, "package.json"), '{"name":"observer-fixture","private":true}\n');
process.env.REPO_CANVAS_ROOT = root;
process.env.REPO_CANVAS_DATA_DIR = path.join(root, ".repo-canvas");

const store = await import("../repo-canvas/scripts/canvas-store.mjs");
const schema = await import("../repo-canvas/scripts/canvas-schema.mjs");
const sessions = await import("../repo-canvas/scripts/codex-sessions.mjs");
const semantic = await import("../repo-canvas/scripts/semantic-model.mjs");
const { CodexObserver } = await import("../repo-canvas/scripts/observer.mjs");

function emit(type, payload) {
  store.appendEvent(store.createEvent(type, { actor: "test", payload }));
}

function record(type, payload) {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, payload });
}

function append(file, lines) {
  fs.appendFileSync(file, `${lines.join("\n")}\n`);
}

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("large Codex metadata lines and repository filtering remain reliable", () => {
  const file = path.join(sessionsRoot, "rollout-large.jsonl");
  append(file, [record("session_meta", { id: "large-session", cwd: root, originator: "codex_desktop", padding: "x".repeat(130_000) })]);
  const meta = sessions.readSessionMeta(file);
  assert.equal(meta.id, "large-session");
  assert.equal(sessions.sessionBelongsToRepository(meta, root), true);
  assert.equal(sessions.sessionBelongsToRepository({ ...meta, originator: "codex_sdk_ts" }, root), false);
});

test("journal reads stay bounded, resume in order, and discard oversized records once", () => {
  const file = path.join(sessionsRoot, "rollout-bounded.jsonl");
  const lines = Array.from({ length: 6 }, (_, index) => JSON.stringify({ index, text: "x".repeat(48) }));
  fs.writeFileSync(file, `${lines.join("\n")}\n`);

  let offset = 0;
  const seen = [];
  for (let pass = 0; pass < 6 && seen.length < lines.length; pass += 1) {
    const delta = sessions.readAppendedRecords(file, offset, { maxBytes: 256, maxRecordBytes: 128, maxRecords: 2 });
    assert.ok(delta.bytesRead <= 256);
    assert.ok(delta.records.length <= 2);
    assert.ok(delta.offset > offset);
    offset = delta.offset;
    seen.push(...delta.records.map((record) => record.index));
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);

  const oversized = path.join(sessionsRoot, "rollout-oversized.jsonl");
  fs.writeFileSync(oversized, `${"x".repeat(700)}\n${JSON.stringify({ index: "after" })}\n`);
  offset = 0;
  let discardingOversizedRecord = false;
  const recovered = [];
  let skipped = 0;
  for (let pass = 0; pass < 8 && !recovered.length; pass += 1) {
    const delta = sessions.readAppendedRecords(oversized, offset, {
      maxBytes: 256, maxRecordBytes: 128, maxRecords: 2, discardingOversizedRecord,
    });
    assert.ok(delta.bytesRead <= 256);
    offset = delta.offset;
    discardingOversizedRecord = delta.discardingOversizedRecord;
    skipped += delta.skippedOversizedRecords;
    recovered.push(...delta.records);
  }
  assert.equal(skipped, 1);
  assert.deepEqual(recovered, [{ index: "after" }]);
  assert.equal(offset, fs.statSync(oversized).size);

  const partial = path.join(sessionsRoot, "rollout-partial.jsonl");
  const partialRecord = JSON.stringify({ index: "partial", text: "kept" });
  fs.writeFileSync(partial, partialRecord);
  const waiting = sessions.readAppendedRecords(partial, 0, { maxBytes: 256, maxRecordBytes: 128, maxRecords: 2 });
  assert.deepEqual(waiting.records, []);
  assert.equal(waiting.offset, 0, "a normal incomplete record must wait for its newline");
  fs.appendFileSync(partial, "\n");
  const completed = sessions.readAppendedRecords(partial, waiting.offset, { maxBytes: 256, maxRecordBytes: 128, maxRecords: 2 });
  assert.deepEqual(completed.records, [{ index: "partial", text: "kept" }]);
  assert.equal(completed.offset, fs.statSync(partial).size);
});

test("observer reuses persisted session metadata instead of rereading full journals", async () => {
  const file = path.join(sessionsRoot, "rollout-meta-cache.jsonl");
  fs.writeFileSync(file, "");
  let metadataReads = 0;
  const adapter = {
    id: "codex",
    listFiles: () => [file],
    readMeta: () => { metadataReads += 1; return { id: "cached-session", cwd: root, originator: "codex_desktop" }; },
    belongsToRepository: () => true,
    signals: () => [],
    locator: () => ({ kind: "codex-app", id: "cached-session", cwd: root }),
  };
  const observer = new CodexObserver({
    config: { enabled: true, repoRoot: root, providers: ["codex"], pollMs: 250 },
    state: { version: 2, initializedProviders: [], sessions: {} },
    adapters: [adapter], runner: async () => { throw new Error("runner should not be called"); },
  });
  await observer.tick();
  await observer.tick();
  assert.equal(metadataReads, 1);
});

test("observer publishes immediately, classifies deltas, and removes concepts only at completion", async () => {
  emit("area.upsert", { id: "core", title: "Core", note: "", order: 1 });
  emit("entity.upsert", {
    id: "legacy", areaId: "core", label: "Legacy", status: "operational", path: "src/legacy",
    purpose: "Old concept", note: "", inputs: [], outputs: [], dependsOn: [], order: 1,
  });
  const file = path.join(sessionsRoot, "rollout-live.jsonl");
  append(file, [
    record("session_meta", { id: "app-session", cwd: root, originator: "codex_desktop" }),
    record("event_msg", { type: "task_started", turn_id: "turn-1" }),
    record("event_msg", { type: "user_message", message: "Remove the obsolete legacy concept" }),
  ]);

  let now = 1_000;
  let calls = 0;
  const runner = async () => {
    calls += 1;
    return {
      profile: { model: "fake-mini", effort: "low" },
      value: {
        workTitle: "Legacy cleanup", workSummary: "Removing the obsolete concept",
        workStatus: calls === 1 ? "active" : "done", targetEntityIds: ["legacy"],
        entityChanges: [{
          operation: "remove", entityId: "legacy", areaId: "", label: "", status: "operational",
          path: "", purpose: "", note: "", inputs: [], outputs: [], dependsOn: [], reason: "Concept eliminated",
        }],
        relationChanges: [],
      },
    };
  };
  const observer = new CodexObserver({
    config: { enabled: true, repoRoot: root, provider: "codex", pollMs: 250 },
    state: { version: 1, sessions: {} }, sessionsRoot, replay: true, runner, now: () => now,
  });

  await observer.tick();
  let snapshot = store.getSnapshot();
  assert.equal(calls, 0);
  assert.equal(snapshot.work.at(-1).provisional, true);
  assert.equal(snapshot.work.at(-1).status, "active");

  append(file, [record("event_msg", { type: "agent_message", phase: "commentary", message: "I will remove the old concept." })]);
  now += 500;
  await observer.tick();
  snapshot = store.getSnapshot();
  assert.equal(calls, 1);
  assert.ok(snapshot.entities.some((entity) => entity.id === "legacy"), "active inference must not remove semantic concepts");
  assert.equal(snapshot.work.at(-1).title, "Legacy cleanup");

  append(file, [record("event_msg", { type: "task_complete", turn_id: "turn-1" })]);
  now += 500;
  await observer.tick();
  snapshot = store.getSnapshot();
  assert.equal(calls, 2);
  assert.ok(!snapshot.entities.some((entity) => entity.id === "legacy"));
  assert.equal(snapshot.work.at(-1).status, "done");
  assert.equal(snapshot.work.at(-1).session.kind, "codex-app");
});

test("architect rejects relations to entities removed by the same refresh", () => {
  assert.throws(() => semantic.validateArchitecture({
    projectTitle: "Fixture", projectSummary: "",
    areas: [], entities: [],
    relations: [{ id: "bad", from: "legacy", to: "legacy", label: "self", status: "existing" }],
    removedAreaIds: [], removedEntityIds: ["legacy"], removedRelationIds: [],
  }), /Unknown relation endpoint/);
});

test("complete architect refresh removes concepts omitted from its response", () => {
  emit("area.upsert", { id: "stale-area", title: "Stale", note: "", order: 9 });
  emit("entity.upsert", {
    id: "stale-entity", areaId: "stale-area", label: "Stale", status: "operational",
    path: "src/stale", purpose: "Old concept", note: "", inputs: [], outputs: [], dependsOn: [], order: 1,
  });
  const value = {
    projectTitle: "Fixture", projectSummary: "Проблема проекта описана. Решение проекта описано.",
    areas: [{
      id: "core", title: "Понятная область",
      problem: "Разрозненные действия могут давать разные и непроверяемые результаты.",
      solution: "Общая область объединяет решения вокруг одного проверяемого результата.", order: 1,
    }],
    entities: [{
      id: "source", areaId: "core", label: "Источник правила", status: "operational", path: "src/source",
      problem: "Интерфейсам негде получить одинаковое правило выполнения операции.",
      solution: "Один блок публикует общее правило для любого вызывающего интерфейса.",
      mechanism: "Registry хранит неизменяемую спецификацию операции и её обработчик.",
      invariants: ["Правило операции определяется только один раз."], inputs: [], outputs: ["Operation rule"], dependsOn: [], order: 1,
    }, {
      id: "consumer", areaId: "core", label: "Исполнитель правила", status: "operational", path: "src/consumer",
      problem: "Вызов может обойти общее правило и получить несовместимый результат.",
      solution: "Исполнитель всегда получает операцию из единого проверяемого источника.",
      mechanism: "Dispatcher resolves the operation id through Registry before invoking handler.",
      invariants: ["Неизвестный идентификатор операции отклоняется."], inputs: ["Operation id"], outputs: ["Operation result"], dependsOn: ["source"], order: 2,
    }],
    relations: [{
      id: "consumer-uses-source", from: "consumer", to: "source",
      label: "берёт единое правило", technical: "Dispatcher resolves operation id through Registry", status: "existing",
    }],
    removedAreaIds: [], removedEntityIds: [], removedRelationIds: [],
  };

  const events = semantic.architectureEvents(value, { refresh: true });
  assert.ok(events.some((event) => event.type === "entity.remove" && event.payload.id === "stale-entity"));
  assert.ok(events.some((event) => event.type === "area.remove" && event.payload.id === "stale-area"));
});

test("completed observer work may remain provisional when no semantic target was established", () => {
  const [event] = semantic.observerEvents({
    workTitle: "Repository-wide review", workSummary: "No single semantic target was established",
    workStatus: "done", targetEntityIds: [], entityChanges: [], relationChanges: [],
  }, {
    workId: "unmapped-review", final: true,
    session: { kind: "codex-app", id: "unmapped-session", cwd: root },
  });
  assert.equal(event.payload.provisional, true);
  assert.deepEqual(event.payload.targets, []);
  assert.deepEqual(schema.validateEvent(event), []);
});
