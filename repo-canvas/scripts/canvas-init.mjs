import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ensureStore, getSnapshot } from "./canvas-store.mjs";
import { packageRoot, projectRoot } from "./project-root.mjs";

const AGENTS_START = "<!-- repo-canvas:start -->";
const AGENTS_END = "<!-- repo-canvas:end -->";
const CLAUDE_START = "<!-- repo-canvas:claude-start -->";
const CLAUDE_END = "<!-- repo-canvas:claude-end -->";
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

const agentsBlock = `${AGENTS_START}
## Repo Canvas

Before changing repository files, read \`repo-canvas/SKILL.md\`.
Run \`npm run repo-canvas -- snapshot\` before editing.
If \`snapshot.semantic\` is false, follow "Bootstrap an existing repository" before product edits.
After inspection but before the first product write, run one separate short command:
\`npm run repo-canvas -- work start --id <id> --title <title> --targets <entity-ids> --note <intent> --actor <agent>\`.
Do not combine registration with tests or other commands. Product writes are forbidden until it returns \`verified: true\`.
If scope changes, update the same work immediately. Update only touched passports, publish structural checkpoints,
mark the work done/stopped/blocked truthfully, and run \`npm run repo-canvas -- check\` before completion.
${AGENTS_END}`;

const codexHooks = {
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: hookCommand, timeout: 10 }] }],
    PreToolUse: [{ matcher: "apply_patch|Write|Edit", hooks: [{ type: "command", command: hookCommand, timeout: 10 }] }],
  },
};

const claudeBlock = `${CLAUDE_START}
@AGENTS.md
${CLAUDE_END}`;

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

function mergeHooks(current, label) {
  const parsed = current === null ? {} : JSON.parse(current);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object`);
  parsed.hooks = parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks) ? parsed.hooks : {};
  for (const [event, groups] of Object.entries(codexHooks.hooks)) {
    const existing = Array.isArray(parsed.hooks[event]) ? parsed.hooks[event] : [];
    for (const group of groups) {
      const present = existing.some((candidate) => candidate?.hooks?.some((hook) => hook.command === hookCommand));
      if (!present) existing.push(group);
    }
    parsed.hooks[event] = existing;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function markerCount(content, marker) {
  return content.split(marker).length - 1;
}

function upsertBlock(content, start, end, block, label) {
  const current = content || "";
  const starts = markerCount(current, start);
  const ends = markerCount(current, end);
  if (starts !== ends || starts > 1) throw new Error(`${label} has malformed or duplicate Repo Canvas markers`);
  if (starts === 1) {
    const startIndex = current.indexOf(start);
    const endIndex = current.indexOf(end, startIndex) + end.length;
    return `${current.slice(0, startIndex)}${block}${current.slice(endIndex)}`;
  }
  const separator = current.trim() ? "\n\n" : "";
  return `${current.trimEnd()}${separator}${block}\n`;
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
  if (agentsCurrent && !agentsCurrent.includes(AGENTS_START) && /repo canvas/i.test(agentsCurrent)) {
    conflicts.push("AGENTS.md contains unmarked Repo Canvas text");
  }

  const skillSource = fs.readFileSync(path.join(packageRoot, "repo-canvas", "SKILL.md"), "utf8");
  if (!skillSource.includes(SKILL_MARKER)) throw new Error("Packaged SKILL.md is missing its managed marker");
  const skillTarget = path.join(projectRoot, "repo-canvas", "SKILL.md");
  const skillCurrent = readText(skillTarget);
  if (skillCurrent !== null && skillCurrent !== skillSource && !skillCurrent.includes(SKILL_MARKER)) {
    conflicts.push("repo-canvas/SKILL.md exists but is not package-managed");
  }
  const codexHooksFile = path.join(projectRoot, ".codex", "hooks.json");
  try { mergeHooks(readText(codexHooksFile), ".codex/hooks.json"); } catch (error) { conflicts.push(error.message); }

  try {
    upsertBlock(agentsCurrent, AGENTS_START, AGENTS_END, agentsBlock, "AGENTS.md");
    const claudeCurrent = readText(path.join(projectRoot, "CLAUDE.md"));
    if (claudeCurrent && !/^@AGENTS\.md\s*$/m.test(claudeCurrent)) {
      upsertBlock(claudeCurrent, CLAUDE_START, CLAUDE_END, claudeBlock, "CLAUDE.md");
    }
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
  writes.set(agentsFile, upsertBlock(agentsCurrent, AGENTS_START, AGENTS_END, agentsBlock, "AGENTS.md"));
  writes.set(skillTarget, skillSource);
  writes.set(codexHooksFile, mergeHooks(readText(codexHooksFile), ".codex/hooks.json"));

  const claudeFile = path.join(projectRoot, "CLAUDE.md");
  const claudeCurrent = readText(claudeFile);
  if (claudeCurrent === null) writes.set(claudeFile, `@AGENTS.md\n`);
  else if (!/^@AGENTS\.md\s*$/m.test(claudeCurrent)) {
    writes.set(claudeFile, upsertBlock(claudeCurrent, CLAUDE_START, CLAUDE_END, claudeBlock, "CLAUDE.md"));
  }

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
  console.log("Start in a persistent terminal: npm run repo-canvas:start");
  console.log(
    'First install: build the semantic project map using "Bootstrap an existing repository" in repo-canvas/SKILL.md.',
  );
  console.log(
    "Unknown-agent bootstrap: Read AGENTS.md and repo-canvas/SKILL.md before changing files; use npm run repo-canvas -- <command> and follow every checkpoint.",
  );
  return { root: projectRoot, changed, version: packageInfo.version };
}
