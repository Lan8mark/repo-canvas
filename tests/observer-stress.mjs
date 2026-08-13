import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-observer-stress-"));
const dataDir = path.join(root, ".repo-canvas");
const sessionsRoot = path.join(root, "sessions");
const unrelatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-unrelated-"));
fs.mkdirSync(sessionsRoot, { recursive: true });
fs.writeFileSync(path.join(root, "package.json"), '{"name":"observer-stress","private":true}\n');
process.env.REPO_CANVAS_ROOT = root;
process.env.REPO_CANVAS_DATA_DIR = dataDir;

const store = await import("../repo-canvas/scripts/canvas-store.mjs");
const { CodexObserver } = await import("../repo-canvas/scripts/observer.mjs");

function append(type, payload) {
  store.appendEvent(store.createEvent(type, { actor: "stress", payload }));
}

function record(type, payload) {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, payload });
}

try {
  append("area.upsert", { id: "factory", title: "Factory", note: "", order: 1 });
  for (let index = 0; index < 300; index += 1) {
    append("entity.upsert", {
      id: `module-${index}`, areaId: "factory", label: `Module ${index}`, status: "operational",
      path: `src/module-${index}`, purpose: "Stress entity", note: "", inputs: [], outputs: [], dependsOn: [], order: index,
    });
  }

  for (let index = 0; index < 300; index += 1) {
    const relevant = index < 200;
    const lines = [
      record("session_meta", { id: `session-${index}`, cwd: relevant ? root : unrelatedRoot, originator: "codex_desktop" }),
      record("event_msg", { type: "task_started", turn_id: `turn-${index}` }),
      record("event_msg", { type: "user_message", message: `Work on module ${index % 300}` }),
      record("event_msg", { type: "agent_message", phase: "commentary", message: "Plan accepted" }),
      record("event_msg", { type: "task_complete", turn_id: `turn-${index}` }),
    ];
    fs.writeFileSync(path.join(sessionsRoot, `rollout-${index}.jsonl`), `${lines.join("\n")}\n`);
  }

  let calls = 0;
  const runner = async ({ prompt }) => {
    calls += 1;
    const match = prompt.match(/Work on module (\d+)/);
    const index = Number(match?.[1] || 0);
    await Promise.resolve();
    return {
      profile: { model: "fake-mini", effort: "low" },
      value: {
        workTitle: `Module ${index} update`, workSummary: "Completed stress update", workStatus: "done",
        targetEntityIds: [`module-${index}`], entityChanges: [], relationChanges: [],
      },
    };
  };

  const observer = new CodexObserver({
    config: { enabled: true, repoRoot: root, provider: "codex", pollMs: 250 },
    state: { version: 1, sessions: {} }, sessionsRoot, replay: true, runner,
  });
  const started = performance.now();
  const summary = await observer.tick();
  const elapsedMs = Math.round(performance.now() - started);
  const snapshot = store.getSnapshot();

  assert.equal(summary.trackedSessions, 200);
  assert.equal(summary.ignoredSessions, 100);
  assert.equal(calls, 200);
  assert.equal(snapshot.entities.length, 300);
  assert.equal(snapshot.work.length, 200);
  assert.equal(snapshot.work.filter((item) => item.status === "done").length, 200);
  assert.equal(snapshot.storeErrors.length, 0);
  console.log(JSON.stringify({ ok: true, elapsedMs, revision: snapshot.revision, ...summary, modelCalls: calls }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(unrelatedRoot, { recursive: true, force: true });
}
