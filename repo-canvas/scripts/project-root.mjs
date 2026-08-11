import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const packageRoot = path.resolve(scriptDirectory, "..", "..");

function canonicalDirectory(candidate, source) {
  const resolved = path.resolve(candidate);
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${source} does not exist: ${resolved}`);
    }
    throw error;
  }
  if (!stats.isDirectory()) throw new Error(`${source} is not a directory: ${resolved}`);
  return fs.realpathSync.native?.(resolved) || fs.realpathSync(resolved);
}

export function resolveProjectRoot({ cwd = process.cwd(), override = process.env.REPO_CANVAS_ROOT } = {}) {
  if (override) return canonicalDirectory(path.resolve(cwd, override), "Repo Canvas root");

  let current = canonicalDirectory(cwd, "Working directory");
  let nearestPackage = null;

  while (true) {
    const gitMarker = path.join(current, ".git");
    if (fs.existsSync(gitMarker)) return current;
    if (!nearestPackage && fs.existsSync(path.join(current, "package.json"))) {
      nearestPackage = current;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (nearestPackage) return nearestPackage;
  throw new Error(
    `No repository root found from ${cwd}. Run inside a Git/npm repository or pass --root <path>.`,
  );
}

export const projectRoot = resolveProjectRoot();

export function resolveDataDirectory(root = projectRoot) {
  const configured = process.env.REPO_CANVAS_DATA_DIR;
  return configured ? path.resolve(root, configured) : path.join(root, ".repo-canvas");
}
