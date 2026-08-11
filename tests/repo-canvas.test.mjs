import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "repo-canvas", "scripts", "canvas.mjs");
const writer = path.join(repositoryRoot, "tests", "concurrent-writer.mjs");

function makeRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-test-"));
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"fixture","version":"1.0.0","private":true}\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function runCli(root, args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    timeout: options.timeout || 15_000,
  });
}

function waitForOutput(child, pattern, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}; output: ${output}`)), timeoutMs);
    const inspect = (chunk) => {
      output += chunk.toString();
      if (pattern.test(output)) {
        clearTimeout(timer);
        resolve(output);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", (code) => {
      if (!pattern.test(output)) {
        clearTimeout(timer);
        reject(new Error(`Process exited ${code} before ${pattern}; output: ${output}`));
      }
    });
  });
}

function waitForExit(child, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
    const timer = setTimeout(() => reject(new Error("Process did not exit in time")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function request(port, { method = "GET", path: requestPath = "/api/health", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, method, path: requestPath, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* static/text response */ }
          resolve({ status: response.statusCode, text, json });
        });
      },
    );
    request.once("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

test("nested invocation resolves the Git root and validates statuses", (t) => {
  const root = makeRepository(t);
  const nested = path.join(root, "src", "nested");
  fs.mkdirSync(nested, { recursive: true });

  const task = runCli(root, ["task", "--id", "demo", "--title", "Demo", "--status", "active", "--actor", "codex"], { cwd: nested });
  assert.equal(task.status, 0, task.stderr);
  assert.ok(fs.existsSync(path.join(root, ".repo-canvas", "events.jsonl")));
  assert.ok(!fs.existsSync(path.join(nested, ".repo-canvas")));

  const invalid = runCli(root, ["node", "--task", "demo", "--id", "bad", "--label", "Bad", "--status", "donne", "--actor", "codex"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /unsupported value 'donne'/);

  const check = runCli(root, ["check"]);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /revision 1/);
});

test("concurrent processes serialize complete event appends and reclaim an old dead lock", async (t) => {
  const root = makeRepository(t);
  const store = path.join(root, ".repo-canvas");
  fs.mkdirSync(store, { recursive: true });
  const lock = path.join(store, "events.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: 999_999, createdAt: "2000-01-01T00:00:00.000Z" }));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);

  const writers = Array.from({ length: 4 }, (_, index) => spawn(
    process.execPath,
    [writer, root, `agent${index}`, "50"],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  ));
  const results = await Promise.all(writers.map((child) => waitForExit(child, 20_000)));
  assert.deepEqual(
    results.map((result) => result.code),
    [0, 0, 0, 0],
    results.map((result) => result.output).join("\n"),
  );
  assert.ok(!fs.existsSync(lock));

  const snapshot = runCli(root, ["snapshot"]);
  assert.equal(snapshot.status, 0, snapshot.stderr);
  const parsed = JSON.parse(snapshot.stdout);
  assert.equal(parsed.revision, 200);
  assert.deepEqual(parsed.storeErrors, []);
});

test("repair previews and quarantines malformed JSON without hiding schema errors", (t) => {
  const root = makeRepository(t);
  assert.equal(runCli(root, ["log", "--task", "repair", "--actor", "codex", "--message", "valid"]).status, 0);
  const events = path.join(root, ".repo-canvas", "events.jsonl");
  fs.appendFileSync(events, "{broken tail\n", "utf8");

  const checkBefore = runCli(root, ["check"]);
  assert.equal(checkBefore.status, 1);
  assert.match(checkBefore.stderr, /"kind": "parse"/);

  const preview = runCli(root, ["repair"]);
  assert.equal(preview.status, 2);
  const previewJson = JSON.parse(preview.stdout);
  assert.deepEqual(previewJson.removableLines, [2]);

  const applied = runCli(root, ["repair", "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.applied, true);
  assert.ok(fs.existsSync(result.backupFile));
  assert.ok(fs.existsSync(result.rejectedFile));
  assert.equal(runCli(root, ["check"]).status, 0);
});

test("loopback server rejects rebinding and CSRF, detects stale clicks, reports port collision, and stops", async (t) => {
  const root = makeRepository(t);
  assert.equal(runCli(root, ["task", "--id", "demo", "--title", "Demo", "--status", "active", "--actor", "codex"]).status, 0);
  assert.equal(runCli(root, ["node", "--task", "demo", "--id", "module", "--label", "Module", "--status", "planned", "--actor", "codex"]).status, 0);
  const port = await freePort();
  const server = spawn(process.execPath, [cli, "start", "--root", root, "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (server.exitCode === null) server.kill("SIGTERM"); });
  await waitForOutput(server, /listening at/);

  const badHost = await request(port, { headers: { Host: `attacker.example:${port}` } });
  assert.equal(badHost.status, 403);

  const state = await request(port, { path: "/api/state", headers: { Host: `127.0.0.1:${port}` } });
  assert.equal(state.status, 200);
  const payload = JSON.stringify({
    action: "explain",
    taskId: "demo",
    targetId: "module",
    targetKind: "node",
    canvasRevision: state.json.revision,
  });
  const commonHeaders = {
    Host: `127.0.0.1:${port}`,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  };
  const csrf = await request(port, {
    method: "POST",
    path: "/api/directives",
    headers: { ...commonHeaders, Origin: "https://evil.example" },
    body: payload,
  });
  assert.equal(csrf.status, 403);

  const accepted = await request(port, {
    method: "POST",
    path: "/api/directives",
    headers: { ...commonHeaders, Origin: `http://127.0.0.1:${port}` },
    body: payload,
  });
  assert.equal(accepted.status, 201, accepted.text);

  const stale = await request(port, {
    method: "POST",
    path: "/api/directives",
    headers: { ...commonHeaders, Origin: `http://127.0.0.1:${port}` },
    body: payload,
  });
  assert.equal(stale.status, 409);

  const second = spawn(process.execPath, [cli, "start", "--root", root, "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const secondOutput = await waitForOutput(second, /already in use/);
  const secondExit = await waitForExit(second);
  assert.equal(secondExit.code, 1);
  assert.match(secondOutput, /--port <port>/);

  const started = Date.now();
  server.kill("SIGTERM");
  await waitForExit(server, 2_500);
  assert.ok(Date.now() - started < 2_500);
});
