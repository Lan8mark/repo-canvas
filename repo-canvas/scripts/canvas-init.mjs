import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ensureStore, getSnapshot } from "./canvas-store.mjs";
import { packageRoot, projectRoot } from "./project-root.mjs";

const AGENTS_START = "<!-- repo-canvas:start -->";
const AGENTS_END = "<!-- repo-canvas:end -->";
const SKILL_MARKER = "<!-- repo-canvas:managed -->";
const hookCommand = "npm run --silent repo-canvas -- hook";

const desiredScripts = {
  "repo-canvas": "repo-canvas",
  "repo-canvas:start": "repo-canvas start",
  "repo-canvas:check": "repo-canvas check",
};
const sourceScripts = {
  "repo-canvas": "node repo-canvas/scripts/canvas.mjs",
  "repo-canvas:start": "node repo-canvas/scripts/canvas.mjs start",
  "repo-canvas:check": "node repo-canvas/scripts/canvas.mjs check",
};

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function readJson(file, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or invalid: ${file} (${error.message})`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object: ${file}`);
  }
  return parsed;
}

function removeRepoCanvasHooks(current, label) {
  const parsed = current === null ? {} : JSON.parse(current);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object`);
  parsed.hooks = parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks) ? parsed.hooks : {};
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    if (!Array.isArray(groups)) continue;
    const cleaned = groups.map((group) => ({
      ...group,
      hooks: Array.isArray(group?.hooks) ? group.hooks.filter((hook) => hook?.command !== hookCommand) : group?.hooks,
    })).filter((group) => !Array.isArray(group.hooks) || group.hooks.length > 0);
    if (cleaned.length) parsed.hooks[event] = cleaned;
    else delete parsed.hooks[event];
  }
  if (!Object.keys(parsed.hooks).length) delete parsed.hooks;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function markerCount(content, marker) {
  return content.split(marker).length - 1;
}

function removeBlock(content, start, end, label) {
  const current = content || "";
  const starts = markerCount(current, start);
  const ends = markerCount(current, end);
  if (starts !== ends || starts > 1) throw new Error(`${label} has malformed or duplicate Repo Canvas markers`);
  if (starts === 1) {
    const startIndex = current.indexOf(start);
    const endIndex = current.indexOf(end, startIndex) + end.length;
    return `${current.slice(0, startIndex)}${current.slice(endIndex)}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
  return current;
}

function ensureIgnoreLines(content) {
  const current = content || "";
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  const missing = [".repo-canvas/", "/repo-canvas-*.tgz"].filter((line) => !lines.includes(line));
  if (!missing.length) return current;
  return `${current.trimEnd()}${current.trim() ? "\n" : ""}${missing.join("\n")}\n`;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, file);
}

function installedPackageVersion(packageName) {
  const parts = packageName.split("/");
  const manifest = path.join(projectRoot, "node_modules", ...parts, "package.json");
  if (!fs.existsSync(manifest)) return null;
  return readJson(manifest, "Installed Repo Canvas package").version || null;
}

function npmInvocation() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli) return { command: process.execPath, prefix: [npmCli] };
  if (process.platform === "win32") {
    throw new Error("npm CLI could not be located next to Node.js; run npm install manually, then rerun init");
  }
  return { command: "npm", prefix: [] };
}

function installPinnedPackage(packageInfo, installSpec) {
  const npm = npmInvocation();
  const spec = installSpec || `${packageInfo.name}@${packageInfo.version}`;
  const result = spawnSync(
    npm.command,
    [...npm.prefix, "install", "--save-dev", "--save-exact", "--ignore-scripts", spec],
    { cwd: projectRoot, stdio: "inherit", shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm install failed with exit code ${result.status}`);
}

function packageDependencySpec(projectPackage, packageName) {
  return projectPackage.devDependencies?.[packageName] || projectPackage.dependencies?.[packageName] || null;
}

export function runInit({ upgrade = false, installSpec = null } = {}) {
  const packageManifest = path.join(packageRoot, "package.json");
  const projectManifest = path.join(projectRoot, "package.json");
  const packageInfo = readJson(packageManifest, "Repo Canvas package manifest");
  let projectPackage = readJson(projectManifest, "Project package.json");
  const conflicts = [];

  for (const [key, value] of Object.entries(desiredScripts)) {
    const current = projectPackage.scripts?.[key];
    const sourceCheckout = packageRoot === projectRoot && current === sourceScripts[key];
    if (current && current !== value && !sourceCheckout) {
      conflicts.push(`package.json script '${key}' is already '${projectPackage.scripts[key]}'`);
    }
  }

  const agentsFile = path.join(projectRoot, "AGENTS.md");
  const agentsCurrent = readText(agentsFile);
  const skillSource = fs.readFileSync(path.join(packageRoot, "repo-canvas", "SKILL.md"), "utf8");
  if (!skillSource.includes(SKILL_MARKER)) throw new Error("Packaged SKILL.md is missing its managed marker");
  const skillTarget = path.join(projectRoot, "repo-canvas", "SKILL.md");
  const skillCurrent = readText(skillTarget);
  if (skillCurrent !== null && skillCurrent !== skillSource && !skillCurrent.includes(SKILL_MARKER)) {
    conflicts.push("repo-canvas/SKILL.md exists but is not package-managed");
  }
  const codexHooksFile = path.join(projectRoot, ".codex", "hooks.json");
  try { removeRepoCanvasHooks(readText(codexHooksFile), ".codex/hooks.json"); } catch (error) { conflicts.push(error.message); }

  try {
    removeBlock(agentsCurrent, AGENTS_START, AGENTS_END, "AGENTS.md");
  } catch (error) {
    conflicts.push(error.message);
  }

  const dependencySpec = packageDependencySpec(projectPackage, packageInfo.name);
  const installedVersion = installedPackageVersion(packageInfo.name);
  if (dependencySpec && installedVersion && installedVersion !== packageInfo.version && !upgrade) {
    conflicts.push(
      `${packageInfo.name} ${installedVersion} is installed; rerun ${packageInfo.version} with init --upgrade`,
    );
  }

  if (conflicts.length) {
    throw new Error(`Initialization conflicts:\n- ${conflicts.join("\n- ")}`);
  }

  console.log(`Repo Canvas root: ${projectRoot}`);
  const runningFromProject = packageRoot === projectRoot;
  const needsInstall = !runningFromProject && (!dependencySpec || installedVersion !== packageInfo.version || upgrade);
  if (needsInstall) installPinnedPackage(packageInfo, installSpec);

  projectPackage = readJson(projectManifest, "Project package.json");
  projectPackage.scripts = {
    ...(projectPackage.scripts || {}),
    ...(packageRoot === projectRoot ? sourceScripts : desiredScripts),
  };

  const writes = new Map();
  writes.set(projectManifest, `${JSON.stringify(projectPackage, null, 2)}\n`);
  if (agentsCurrent !== null) writes.set(agentsFile, removeBlock(agentsCurrent, AGENTS_START, AGENTS_END, "AGENTS.md"));
  writes.set(skillTarget, skillSource);
  if (readText(codexHooksFile) !== null) writes.set(codexHooksFile, removeRepoCanvasHooks(readText(codexHooksFile), ".codex/hooks.json"));

  const gitignoreFile = path.join(projectRoot, ".gitignore");
  writes.set(gitignoreFile, ensureIgnoreLines(readText(gitignoreFile)));

  const changed = [];
  for (const [file, content] of writes) {
    if (readText(file) === content) continue;
    atomicWrite(file, content);
    changed.push(path.relative(projectRoot, file) || path.basename(file));
  }

  ensureStore();
  const snapshot = getSnapshot();
  if (snapshot.storeErrors.length) {
    throw new Error(`Store validation failed after init: ${JSON.stringify(snapshot.storeErrors)}`);
  }

  console.log(changed.length ? `Updated: ${changed.join(", ")}` : "Repo Canvas is already initialized; no file changes.");
  console.log("One-command setup: npm run repo-canvas -- setup");
  console.log("Normal development agents stay untouched; the private observer maintains Canvas out of band.");
  return { root: projectRoot, changed, version: packageInfo.version };
}
