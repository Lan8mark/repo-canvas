import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { pathBelongsToRoot, readAppendedRecords } from "./codex-sessions.mjs";

export function claudeDataRoot() {
  return process.env.REPO_CANVAS_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function listClaudeSessionFiles(root = claudeDataRoot()) {
  const projects = path.join(root, "projects");
  if (!fs.existsSync(projects)) return [];
  const files = [];
  const pending = [projects];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(absolute);
    }
  }
  return files;
}

export function readClaudeSessionMeta(file) {
  const delta = readAppendedRecords(file, 0);
  for (const record of delta.records) {
    if (!record?.sessionId || !record?.cwd) continue;
    return {
      id: record.sessionId,
      cwd: record.cwd,
      entrypoint: record.entrypoint || "",
      promptSource: record.promptSource || "",
      provider: "claude",
    };
  }
  return null;
}

export function claudeSessionBelongsToRepository(meta, repoRoot) {
  return Boolean(meta?.cwd && pathBelongsToRoot(meta.cwd, repoRoot));
}

function textParts(content, allowed = new Set(["text"])) {
  const parts = typeof content === "string" ? [{ type: "text", text: content }] : (Array.isArray(content) ? content : []);
  return parts.filter((part) => allowed.has(part?.type) && typeof part.text === "string").map((part) => part.text).join("\n").slice(0, 2_500);
}

export function claudeSessionSignals(record) {
  if (record?.type === "user") {
    const text = textParts(record.message?.content);
    if (!text) return [];
    const turnId = record.promptId || record.uuid;
    return [
      { kind: "start", turnId, at: record.timestamp },
      { kind: "user", turnId, text, at: record.timestamp },
      { kind: "context", turnId, model: "claude", effort: null, cwd: record.cwd },
    ];
  }
  if (record?.type !== "assistant") return [];
  const signals = [];
  const content = Array.isArray(record.message?.content) ? record.message.content : [];
  const text = textParts(content);
  if (text) signals.push({ kind: "agent", text, at: record.timestamp });
  for (const part of content) {
    if (part?.type === "tool_use") {
      signals.push({ kind: "tool", name: part.name || "tool", input: JSON.stringify(part.input || {}).slice(0, 2_500), at: record.timestamp });
    }
  }
  const reason = record.message?.stop_reason;
  if (["end_turn", "stop_sequence", "max_tokens", "refusal"].includes(reason)) {
    signals.push({ kind: reason === "refusal" ? "aborted" : "complete", at: record.timestamp, reason });
  }
  return signals;
}

export function claudeSessionLocator(meta, firstUserMessage = "") {
  return {
    kind: "claude-cli",
    id: meta.id,
    title: firstUserMessage.slice(0, 160) || "Observed Claude work",
    cwd: meta.cwd,
  };
}

export const claudeSessionAdapter = Object.freeze({
  id: "claude",
  listFiles: listClaudeSessionFiles,
  readMeta: readClaudeSessionMeta,
  belongsToRepository: claudeSessionBelongsToRepository,
  signals: claudeSessionSignals,
  locator: claudeSessionLocator,
});
