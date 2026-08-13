import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

import { compareVersions, normalizeVersion } from "../repo-canvas/scripts/runtime-version.mjs";
import { RELEASE_REPOSITORY, releaseCandidate } from "../repo-canvas/scripts/update-service.mjs";

async function removeTemporaryDirectory(directory) {
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try { fs.rmSync(directory, { recursive: true, force: true }); return; }
    catch (error) {
      lastError = error;
      if (!new Set(["EPERM", "EBUSY", "ENOTEMPTY"]).has(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

function release(version, overrides = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/Lan8mark/repo-canvas/releases/tag/v${version}`,
    assets: [{
      name: `repo-canvas-${version}.tgz`,
      state: "uploaded",
      size: 1234,
      digest: `sha256:${"a".repeat(64)}`,
      browser_download_url: `https://github.com/Lan8mark/repo-canvas/releases/download/v${version}/repo-canvas-${version}.tgz`,
    }],
    ...overrides,
  };
}

test("semantic versions compare without a dependency", () => {
  assert.equal(normalizeVersion("v1.12.3"), "1.12.3");
  assert.equal(compareVersions("0.8.10", "0.8.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.9.0", "1.0.0"), -1);
});

test("release discovery accepts only a newer verified official tgz", () => {
  assert.equal(RELEASE_REPOSITORY, "Lan8mark/repo-canvas");
  assert.equal(releaseCandidate(release("0.8.6"), "0.8.5")?.version, "0.8.6");
  assert.equal(releaseCandidate(release("0.8.5"), "0.8.5"), null);
  assert.equal(releaseCandidate(release("0.8.6", { prerelease: true }), "0.8.5"), null);
  const badDigest = release("0.8.6");
  badDigest.assets[0].digest = null;
  assert.equal(releaseCandidate(badDigest, "0.8.5"), null);
  const wrongHost = release("0.8.6");
  wrongHost.assets[0].browser_download_url = "https://example.com/repo-canvas-0.8.6.tgz";
  assert.equal(releaseCandidate(wrongHost, "0.8.5"), null);
  const wrongRepository = release("0.8.6");
  wrongRepository.assets[0].browser_download_url = "https://github.com/m0ast-git/repo-canvas/releases/download/v0.8.6/repo-canvas-0.8.6.tgz";
  assert.equal(releaseCandidate(wrongRepository, "0.8.5"), null);
});

test("the installed bootstrap delegates commands to a newer project-local runtime", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-delegation-"));
  try {
    fs.mkdirSync(path.join(root, ".git"));
    const runtime = path.join(root, ".repo-canvas", "runtime", "versions", "9.9.9");
    const cli = path.join(runtime, "fake-cli.mjs");
    const marker = path.join(root, "delegated.txt");
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(cli, "import fs from 'node:fs'; fs.writeFileSync(process.env.REPO_CANVAS_DELEGATION_MARKER, 'delegated');\n");
    fs.writeFileSync(path.join(root, ".repo-canvas", "runtime", "current.json"), `${JSON.stringify({ version: "9.9.9", cli })}\n`);
    const result = spawnSync(process.execPath, [path.resolve("repo-canvas", "scripts", "canvas.mjs"), "help", "--root", root], {
      cwd: root,
      env: { ...process.env, REPO_CANVAS_DELEGATION_MARKER: marker },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(marker, "utf8"), "delegated");
  } finally {
    await removeTemporaryDirectory(root);
  }
});

test("a checksum failure keeps the previous runtime and restarts the source server", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-canvas-rollback-"));
  const asset = Buffer.from("not a real package");
  const fixture = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Length": asset.length });
    response.end(asset);
  });
  try {
    const port = await new Promise((resolve, reject) => {
      fixture.once("error", reject);
      fixture.listen(0, "127.0.0.1", () => resolve(fixture.address().port));
    });
    const runtime = path.join(root, ".repo-canvas", "runtime");
    const stateFile = path.join(runtime, "update-state.json");
    const pointerFile = path.join(runtime, "current.json");
    const sourceCli = path.join(root, "source-cli.mjs");
    const marker = path.join(root, "restarted.txt");
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(sourceCli, "import fs from 'node:fs'; fs.writeFileSync(process.env.REPO_CANVAS_ROLLBACK_MARKER, 'restarted');\n");
    const previousPointer = `${JSON.stringify({ version: "0.8.5", cli: sourceCli })}\n`;
    fs.writeFileSync(pointerFile, previousPointer);
    const job = {
      schema: 1,
      root,
      runtimeDirectory: runtime,
      stateFile,
      currentPointerFile: pointerFile,
      sourceCli,
      fromVersion: "0.8.5",
      release: {
        version: "0.8.6",
        assetName: "repo-canvas-0.8.6.tgz",
        size: asset.length,
        digest: "f".repeat(64),
        downloadUrl: `http://127.0.0.1:${port}/asset.tgz`,
      },
      host: "127.0.0.1",
      port: 49152,
      apiToken: "a".repeat(43),
      parentPid: 999_999_999,
      allowNonGithub: true,
    };
    const runner = spawn(process.execPath, [path.resolve("repo-canvas", "scripts", "update-runner.mjs")], {
      cwd: root,
      env: { ...process.env, REPO_CANVAS_UPDATE_JOB: JSON.stringify(job), REPO_CANVAS_ROLLBACK_MARKER: marker },
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      runner.once("error", reject);
      runner.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`runner exited ${code}`)));
    });
    const deadline = Date.now() + 3_000;
    while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fs.readFileSync(pointerFile, "utf8"), previousPointer);
    assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).status, "failed");
    assert.equal(fs.readFileSync(marker, "utf8"), "restarted");
  } finally {
    await new Promise((resolve) => fixture.close(resolve));
    await removeTemporaryDirectory(root);
  }
});
