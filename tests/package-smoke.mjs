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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-portable-project-"));
const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-bootstrap-runner-"));
const npmCache = path.join(runnerRoot, ".npm-cache");
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
    env: { ...process.env, npm_config_cache: npmCache, ...(options.env || {}) },
    encoding: "utf8",
    timeout: options.timeout || 90_000,
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
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

function request(port, requestPath, token = "") {
  return new Promise((resolve, reject) => {
    const headers = { Host: `127.0.0.1:${port}` };
    if (token) headers["X-Repo-Canvas-Token"] = token;
    http.get({ host: "127.0.0.1", port, path: requestPath, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    }).once("error", reject);
  });
}

function waitFor(child, pattern, timeoutMs = 8_000) {
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
  run("git", ["init", "--initial-branch=main"], root);
  run("git", ["config", "user.email", "package-smoke@example.invalid"], root);
  run("git", ["config", "user.name", "Repo Canvas package smoke"], root);
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "node_modules", "owner-package"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# Existing project\n");
  fs.writeFileSync(path.join(root, "src", "app.py"), "print('existing product code')\n");
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: "existing-project", private: true, scripts: { test: "owner-test" },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "package-lock.json"), `${JSON.stringify({ name: "existing-project", lockfileVersion: 3 }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, ".gitignore"), "owner-generated/\n");
  fs.writeFileSync(path.join(root, "node_modules", "owner-package", "marker.txt"), "owner dependency\n");
  run("git", ["add", "README.md", "src/app.py", "package.json", "package-lock.json", ".gitignore", "-f", "node_modules/owner-package/marker.txt"], root);
  run("git", ["commit", "-m", "owner project"], root);

  const ownerFiles = ["README.md", "src/app.py", "package.json", "package-lock.json", ".gitignore", "node_modules/owner-package/marker.txt"];
  const ownerHash = hashFiles(root, ownerFiles);
  const ownerEntries = fs.readdirSync(root).sort();

  run(npmCommand, [
    ...npmPrefix, "install", "--prefix", runnerRoot,
    "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", "--package-lock=false", tarball,
  ], runnerRoot);
  const runnerCli = path.join(runnerRoot, "node_modules", "repo-canvas", "repo-canvas", "scripts", "canvas.mjs");
  assert.ok(fs.existsSync(runnerCli), "Bootstrap CLI missing from packed artifact");
  run(process.execPath, [runnerCli, "bootstrap", "--no-setup", "--root", root], root, { timeout: 180_000 });

  const home = path.join(root, ".repo-canvas");
  const installedCli = path.join(home, "runtime", "node_modules", "repo-canvas", "repo-canvas", "scripts", "canvas.mjs");
  const launcher = path.join(home, "repo-canvas.mjs");
  assert.ok(fs.existsSync(installedCli), "Portable CLI was not installed inside .repo-canvas");
  assert.ok(fs.existsSync(launcher), "Portable launcher was not created");
  assert.equal(fs.readFileSync(path.join(home, ".gitignore"), "utf8").trim().endsWith("*"), true);
  assert.equal(fs.existsSync(path.join(home, "runtime", "package.json")), false, "Portable npm prefix leaked a manifest");
  assert.equal(fs.existsSync(path.join(home, "runtime", "package-lock.json")), false, "Portable npm prefix leaked a lockfile");
  assert.equal(hashFiles(root, ownerFiles), ownerHash, "Portable install changed an owner file");
  assert.equal(run("git", ["status", "--porcelain"], root).stdout.trim(), "", ".repo-canvas must hide itself from Git");

  run(process.execPath, [launcher, "init"], root);
  assert.equal(hashFiles(root, ownerFiles), ownerHash, "Repeated init changed an owner file");

  run(process.execPath, [launcher, "area", "--id", "core", "--title", "Core system", "--actor", "codex"], root);
  run(process.execPath, [launcher, "entity", "--id", "api", "--area", "core", "--label", "API", "--path", "src", "--status", "operational", "--actor", "codex"], root);
  run(process.execPath, [launcher, "entity", "--id", "storage", "--area", "core", "--label", "Storage", "--path", "package.json", "--status", "operational", "--actor", "codex"], root);
  run(process.execPath, [launcher, "relation", "--from", "api", "--to", "storage", "--status", "existing", "--actor", "codex"], root);
  run(process.execPath, [launcher, "check"], root);
  const seeded = JSON.parse(run(process.execPath, [launcher, "snapshot"], root).stdout);
  assert.equal(seeded.semantic, true);
  assert.equal(seeded.entities.length, 2);
  assert.equal(seeded.relations.length, 1);

  const port = await freePort();
  const server = spawn(process.execPath, [launcher, "start", "--no-open", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, npm_config_cache: npmCache },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const startedOutput = await waitFor(server, /listening at/);
    const apiToken = startedOutput.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
    assert.ok(apiToken, `Server did not print an API token: ${startedOutput}`);
    assert.equal((await request(port, "/api/health", apiToken)).status, 200);
    assert.match((await request(port, "/")).body, /Repo Canvas/);
  } finally {
    server.kill("SIGTERM");
  }

  fs.rmSync(home, { recursive: true, force: true });
  assert.deepEqual(fs.readdirSync(root).sort(), ownerEntries, "Deleting .repo-canvas did not restore the original root");
  assert.equal(hashFiles(root, ownerFiles), ownerHash, "Deleting .repo-canvas left owner files changed");
  assert.equal(run("git", ["status", "--porcelain"], root).stdout.trim(), "", "Uninstalled project is not Git-clean");
  console.log(`Portable Repo Canvas smoke test passed: ${tarball}`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(runnerRoot, { recursive: true, force: true });
}
