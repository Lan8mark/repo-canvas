import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const tarballArgument = process.argv[2];
if (!tarballArgument) throw new Error("Usage: node tests/package-smoke.mjs <repo-canvas.tgz>");
const tarball = path.resolve(tarballArgument);
if (!fs.existsSync(tarball)) throw new Error(`Tarball not found: ${tarball}`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-package-"));
const conflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-conflict-"));
const npmCliCandidates = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
].filter(Boolean);
const npmCli = npmCliCandidates.find((candidate) => fs.existsSync(candidate));
const npmCommand = npmCli ? process.execPath : "npm";
const npmPrefix = npmCli ? [npmCli] : [];

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, npm_config_cache: path.join(cwd, ".npm-cache") },
    encoding: "utf8",
    timeout: options.timeout || 60_000,
  });
  if (options.expectFailure) {
    assert.notEqual(result.status, 0, `Expected failure: ${command} ${args.join(" ")}`);
  } else {
    assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function hashFiles(base, files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) hash.update(file).update("\0").update(fs.readFileSync(path.join(base, file)));
  return hash.digest("hex");
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

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: requestPath, headers: { Host: `127.0.0.1:${port}` } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    }).once("error", reject);
  });
}

function waitFor(child, pattern, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Timed out: ${output}`)), timeoutMs);
    const inspect = (chunk) => {
      output += chunk.toString();
      if (pattern.test(output)) {
        clearTimeout(timer);
        resolve(output);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
  });
}

try {
  for (const fixture of [root, conflictRoot]) {
    fs.mkdirSync(path.join(fixture, ".git"));
    fs.writeFileSync(path.join(fixture, "package.json"), `${JSON.stringify({ name: "fixture", version: "1.0.0", private: true }, null, 2)}\n`);
    run(npmCommand, [...npmPrefix, "install", "--save-dev", "--save-exact", "--ignore-scripts", tarball], fixture);
  }

  const installedCli = path.join(root, "node_modules", "repo-canvas", "repo-canvas", "scripts", "canvas.mjs");
  assert.ok(fs.existsSync(installedCli), "CLI source missing from packed artifact");
  assert.ok(fs.existsSync(path.join(root, "node_modules", ".bin", process.platform === "win32" ? "repo-canvas.cmd" : "repo-canvas")));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Owner instructions\n\nKeep this paragraph.\n");

  run(process.execPath, [installedCli, "init"], root);
  const managedFiles = ["package.json", "package-lock.json", "AGENTS.md", "CLAUDE.md", ".gitignore", "repo-canvas/SKILL.md"];
  const firstHash = hashFiles(root, managedFiles);
  run(process.execPath, [installedCli, "init"], root);
  assert.equal(hashFiles(root, managedFiles), firstHash, "Second init changed managed files");
  assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /Keep this paragraph/);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");

  const nested = path.join(root, "src", "nested");
  fs.mkdirSync(nested, { recursive: true });
  run(process.execPath, [installedCli, "task", "--id", "packed", "--title", "Packed", "--status", "active", "--actor", "codex"], nested);
  run(process.execPath, [installedCli, "node", "--task", "packed", "--id", "ui", "--label", "UI", "--status", "planned", "--actor", "codex"], nested);
  run(process.execPath, [installedCli, "check"], nested);
  assert.ok(fs.existsSync(path.join(root, ".repo-canvas", "events.jsonl")));
  assert.ok(!fs.existsSync(path.join(root, "node_modules", "repo-canvas", ".repo-canvas")));

  const port = await freePort();
  const server = spawn(process.execPath, [installedCli, "start", "--port", String(port)], {
    cwd: nested,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitFor(server, /listening at/);
    const health = await request(port, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).root, fs.realpathSync(root));
    const page = await request(port, "/");
    assert.equal(page.status, 200);
    assert.match(page.body, /Repo Canvas/);
  } finally {
    server.kill("SIGTERM");
  }

  const conflictManifest = path.join(conflictRoot, "package.json");
  const conflictPackage = JSON.parse(fs.readFileSync(conflictManifest, "utf8"));
  conflictPackage.scripts = { canvas: "something-else" };
  fs.writeFileSync(conflictManifest, `${JSON.stringify(conflictPackage, null, 2)}\n`);
  const beforeConflict = fs.readFileSync(conflictManifest);
  const conflictCli = path.join(conflictRoot, "node_modules", "repo-canvas", "repo-canvas", "scripts", "canvas.mjs");
  const failed = run(process.execPath, [conflictCli, "init"], conflictRoot, { expectFailure: true });
  assert.match(failed.stderr, /script 'canvas'/);
  assert.deepEqual(fs.readFileSync(conflictManifest), beforeConflict);
  assert.ok(!fs.existsSync(path.join(conflictRoot, "AGENTS.md")));
  assert.ok(!fs.existsSync(path.join(conflictRoot, ".repo-canvas")));

  console.log(`Packed Repo Canvas smoke test passed: ${tarball}`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(conflictRoot, { recursive: true, force: true });
}
