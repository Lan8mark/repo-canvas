import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ensureStore, getSnapshot } from "./canvas-store.mjs";
import { packageRoot, projectRoot, resolveDataDirectory } from "./project-root.mjs";

const SELF_IGNORE = `# Repo Canvas owns this disposable directory.\n*\n`;

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function readJson(file, label) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
    return value;
  } catch (error) {
    throw new Error(`${label} is missing or invalid: ${file} (${error.message})`);
  }
}

function atomicWrite(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode });
  fs.renameSync(temporary, file);
  if (process.platform !== "win32") fs.chmodSync(file, mode);
}

function writeIfChanged(file, content, changed, mode = 0o600) {
  if (readText(file) === content) return;
  atomicWrite(file, content, mode);
  changed.push(path.relative(projectRoot, file));
}

function npmInvocation() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli) return { command: process.execPath, prefix: [npmCli] };
  if (process.platform === "win32") throw new Error("npm CLI could not be located next to Node.js");
  return { command: "npm", prefix: [] };
}

function portablePaths() {
  const dataDirectory = resolveDataDirectory(projectRoot);
  const runtimeDirectory = path.join(dataDirectory, "runtime");
  return {
    dataDirectory,
    runtimeDirectory,
    installedPackage: path.join(runtimeDirectory, "node_modules", "repo-canvas"),
    installedCli: path.join(runtimeDirectory, "node_modules", "repo-canvas", "repo-canvas", "scripts", "canvas.mjs"),
  };
}

function launcherSource(dataDirectory) {
  const cli = path.join(packageRoot, "repo-canvas", "scripts", "canvas.mjs");
  const relativeCli = path.relative(dataDirectory, cli);
  if (!relativeCli || path.isAbsolute(relativeCli)) throw new Error("Repo Canvas launcher cannot address its runtime portably");
  return `import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const home = path.dirname(fileURLToPath(import.meta.url));
const fallback = path.resolve(home, ${JSON.stringify(relativeCli)});
const pointerFile = path.join(home, "runtime", "current.json");
let cli = fallback;
try {
  const pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
  const candidate = path.resolve(String(pointer.cli || ""));
  const versions = path.resolve(home, "runtime", "versions");
  const relative = path.relative(versions, candidate);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && fs.existsSync(candidate)) cli = candidate;
} catch {}

process.env.REPO_CANVAS_RUNTIME_ACTIVE = "1";
await import(pathToFileURL(cli).href);
`;
}

function ensurePortableFiles() {
  const { dataDirectory } = portablePaths();
  const changed = [];
  writeIfChanged(path.join(dataDirectory, ".gitignore"), SELF_IGNORE, changed);
  writeIfChanged(path.join(dataDirectory, "repo-canvas.mjs"), launcherSource(dataDirectory), changed);
  writeIfChanged(
    path.join(dataDirectory, "repo-canvas.cmd"),
    `@echo off\r\nnode "%~dp0repo-canvas.mjs" %*\r\n`,
    changed,
  );
  writeIfChanged(
    path.join(dataDirectory, "repo-canvas"),
    `#!/bin/sh\nexec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/repo-canvas.mjs" "$@"\n`,
    changed,
    0o700,
  );
  return changed;
}

export function runInit() {
  const packageInfo = readJson(path.join(packageRoot, "package.json"), "Repo Canvas package manifest");
  console.log(`Repo Canvas root: ${projectRoot}`);
  const changed = ensurePortableFiles();
  ensureStore();
  const snapshot = getSnapshot();
  if (snapshot.storeErrors.length) {
    throw new Error(`Store validation failed after init: ${JSON.stringify(snapshot.storeErrors)}`);
  }
  console.log(changed.length ? `Created: ${changed.join(", ")}` : "Repo Canvas portable directory is already initialized.");
  console.log(process.platform === "win32"
    ? "Run: .repo-canvas\\repo-canvas.cmd setup"
    : "Run: ./.repo-canvas/repo-canvas setup");
  return { root: projectRoot, directory: resolveDataDirectory(projectRoot), changed, version: packageInfo.version };
}

function installPortableRuntime() {
  const packageInfo = readJson(path.join(packageRoot, "package.json"), "Repo Canvas package manifest");
  const paths = portablePaths();
  fs.mkdirSync(paths.dataDirectory, { recursive: true });
  if (readText(path.join(paths.dataDirectory, ".gitignore")) !== SELF_IGNORE) {
    atomicWrite(path.join(paths.dataDirectory, ".gitignore"), SELF_IGNORE);
  }
  const npm = npmInvocation();
  const result = spawnSync(
    npm.command,
    [
      ...npm.prefix,
      "install", "--prefix", paths.runtimeDirectory,
      "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", "--package-lock=false", "--install-links",
      packageRoot,
    ],
    { cwd: projectRoot, stdio: "inherit", shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Portable npm install failed with exit code ${result.status}`);
  const installed = readJson(path.join(paths.installedPackage, "package.json"), "Portable Repo Canvas package");
  if (installed.version !== packageInfo.version || !fs.existsSync(paths.installedCli)) {
    throw new Error("Portable Repo Canvas runtime failed validation");
  }
  return { ...paths, version: installed.version };
}

export function runBootstrap({ noSetup = false, refresh = false } = {}) {
  console.log(`Installing Repo Canvas inside ${path.join(projectRoot, ".repo-canvas")} ...`);
  const installed = installPortableRuntime();
  const childArgs = [installed.installedCli, noSetup ? "init" : "setup", "--root", projectRoot];
  if (refresh) childArgs.push("--refresh");
  const result = spawnSync(process.execPath, childArgs, {
    cwd: projectRoot,
    env: { ...process.env, REPO_CANVAS_RUNTIME_ACTIVE: "1" },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Repo Canvas ${noSetup ? "init" : "setup"} failed with exit code ${result.status}`);
  console.log(`Repo Canvas ${installed.version} is fully contained in ${installed.dataDirectory}`);
  console.log(process.platform === "win32"
    ? "Start: .repo-canvas\\repo-canvas.cmd start"
    : "Start: ./.repo-canvas/repo-canvas start");
  return installed;
}
