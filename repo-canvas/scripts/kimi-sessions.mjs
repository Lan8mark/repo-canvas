import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { pathBelongsToRoot } from "./codex-sessions.mjs";

export function kimiDataRoot() {
  return process.env.REPO_CANVAS_KIMI_HOME || path.join(os.homedir(), ".kimi-code");
}

function readIndex(root = kimiDataRoot()) {
  const indexFile = path.join(root, "session_index.jsonl");
  if (!fs.existsSync(indexFile)) return [];
  const entries = [];
  for (const line of fs.readFileSync(indexFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const wire = path.join(entry.sessionDir || "", "agents", "main", "wire.jsonl");
      if (entry.sessionId && entry.workDir && fs.existsSync(wire)) entries.push({ ...entry, wire });
    } catch { /* an incomplete final index line is retried on the next poll */ }
  }
  return entries;
}

export function listKimiSessionFiles(root = kimiDataRoot()) {
  return readIndex(root).map((entry) => entry.wire);
}

export function readKimiSessionMeta(file, root = kimiDataRoot()) {
  const resolved = path.resolve(file);
  const entry = readIndex(root).find((item) => path.resolve(item.wire) === resolved);
  if (!entry) return null;
  let state = {};
  try { state = JSON.parse(fs.readFileSync(path.join(entry.sessionDir, "state.json"), "utf8")); } catch { /* optional title */ }
  return {
    id: entry.sessionId,
    cwd: entry.workDir,
    title: state.title || state.lastPrompt || "",
    provider: "kimi",
  };
}

export function kimiSessionBelongsToRepository(meta, repoRoot) {
  return Boolean(meta?.cwd && pathBelongsToRoot(meta.cwd, repoRoot));
}

function inputText(input) {
  if (!Array.isArray(input)) return "";
  return input.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").slice(0, 2_500);
}

export function kimiSessionSignals(record) {
  if (record?.type === "turn.prompt") {
    const text = inputText(record.input);
    const turnId = `turn-${record.time || Date.now()}`;
    return [
      { kind: "start", turnId, at: record.time },
      ...(text ? [{ kind: "user", turnId, text, at: record.time }] : []),
      { kind: "context", turnId, model: "kimi", effort: null },
    ];
  }
  if (record?.type === "context.append_loop_event") {
    const event = record.event || {};
    if (event.type === "content.part" && event.part?.type === "text" && typeof event.part.text === "string") {
      return [{ kind: "agent", text: event.part.text.slice(0, 2_500), at: record.time }];
    }
    if (event.type === "tool.call") {
      return [{ kind: "tool", name: event.name || "tool", input: JSON.stringify(event.args || {}).slice(0, 2_500), at: record.time }];
    }
    if (event.type === "step.end" && event.finishReason === "end_turn") {
      return [{ kind: "complete", turnId: event.turnId, at: record.time }];
    }
    return [];
  }
  if (record?.type === "turn.ended") {
    const completed = record.reason === "completed";
    return [{ kind: completed ? "complete" : "aborted", reason: record.reason, at: record.time }];
  }
  return [];
}

export function kimiSessionLocator(meta, firstUserMessage = "") {
  return {
    kind: "kimi-cli",
    id: meta.id,
    title: firstUserMessage.slice(0, 160) || meta.title?.slice(0, 160) || "Observed Kimi work",
    cwd: meta.cwd,
  };
}

export const kimiSessionAdapter = Object.freeze({
  id: "kimi",
  listFiles: listKimiSessionFiles,
  readMeta: readKimiSessionMeta,
  belongsToRepository: kimiSessionBelongsToRepository,
  signals: kimiSessionSignals,
  locator: kimiSessionLocator,
});
