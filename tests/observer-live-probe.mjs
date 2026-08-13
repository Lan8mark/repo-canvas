import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.argv[2];
const expectedTarget = process.argv[3];
if (!root || !expectedTarget || !process.env.REPO_CANVAS_DATA_DIR) {
  throw new Error("Usage: set REPO_CANVAS_DATA_DIR, then node tests/observer-live-probe.mjs <repo-root> <expected-entity>");
}
process.env.REPO_CANVAS_ROOT = root;
const sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-live-observer-"));

const { CodexObserver } = await import("../repo-canvas/scripts/observer.mjs");
const { getSnapshot } = await import("../repo-canvas/scripts/canvas-store.mjs");

function record(type, payload) {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, payload });
}

try {
  const file = path.join(sessionsRoot, "rollout-live-probe.jsonl");
  fs.writeFileSync(file, `${[
    record("session_meta", { id: "live-observer-probe", cwd: root, originator: "Codex Desktop" }),
    record("event_msg", { type: "task_started", turn_id: "probe-turn" }),
    record("event_msg", { type: "user_message", message: "Improve ModelGateway timeout handling and cover the failure path with tests." }),
    record("event_msg", { type: "agent_message", phase: "commentary", message: "I will update the model provider gateway timeout boundary and its focused tests, then run those tests." }),
    record("event_msg", { type: "task_complete", turn_id: "probe-turn" }),
  ].join("\n")}\n`);

  const observer = new CodexObserver({
    config: { enabled: true, repoRoot: root, provider: "codex", pollMs: 250 },
    state: { version: 1, sessions: {} }, sessionsRoot, replay: true,
  });
  const started = performance.now();
  await observer.tick();
  const elapsedMs = Math.round(performance.now() - started);
  const work = getSnapshot().work.find((item) => item.session?.id === "live-observer-probe");
  assert.ok(work, "observer did not publish live probe work");
  assert.equal(work.status, "done");
  assert.ok(work.targets.includes(expectedTarget), `expected target '${expectedTarget}', received ${work.targets.join(",")}`);
  console.log(JSON.stringify({ ok: true, elapsedMs, title: work.title, targets: work.targets, session: work.session }));
} finally {
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
}
