import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { packageRoot, projectRoot, resolveDataDirectory } from "./project-root.mjs";
import { compareVersions, normalizeVersion } from "./runtime-version.mjs";

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;
}

export async function delegateToActiveRuntime() {
  if (process.env.REPO_CANVAS_RUNTIME_ACTIVE === "1") return false;
  const pointerFile = path.join(resolveDataDirectory(projectRoot), "runtime", "current.json");
  if (!fs.existsSync(pointerFile)) return false;

  let pointer;
  try {
    pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
  } catch {
    return false;
  }
  const activeVersion = normalizeVersion(pointer?.version);
  const currentVersion = normalizeVersion(packageVersion());
  if (!activeVersion || !currentVersion || compareVersions(activeVersion, currentVersion) <= 0) return false;

  const cli = path.resolve(String(pointer.cli || ""));
  const runtimeRoot = path.join(resolveDataDirectory(projectRoot), "runtime", "versions");
  const relative = path.relative(runtimeRoot, cli);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(cli)) return false;

  process.env.REPO_CANVAS_RUNTIME_ACTIVE = "1";
  await import(pathToFileURL(cli).href);
  return true;
}
