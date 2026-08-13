import { getSnapshot } from "./canvas-store.mjs";

function readStdin() {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { value += chunk; });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", reject);
  });
}

function output(hookEventName, fields) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName, ...fields } })}\n`);
}

export function evaluateHook(input, snapshot = getSnapshot()) {
  const event = String(input?.hook_event_name || "");
  if (event === "UserPromptSubmit") {
    return {
      hookEventName: event,
      additionalContext: "Repo Canvas is active. Inspect freely, but before the first product write run a separate `npm run repo-canvas -- work start ...` command and wait for verified:true. Do not combine it with tests or other work.",
    };
  }
  if (event !== "PreToolUse") return null;
  const sessionId = String(input?.session_id || "").trim();
  const item = snapshot.work.find((candidate) => candidate.status === "active" && sessionId && candidate.session?.id === sessionId);
  const validTargets = item?.targets?.length > 0 && item.targets.every((id) => snapshot.entities.some((entity) => entity.id === id));
  const valid = item && String(item.note || "").trim() && validTargets;
  if (valid) return null;
  return {
    hookEventName: event,
    permissionDecision: "deny",
    permissionDecisionReason: "Repo Canvas blocked this product write: the current session has no verified active work. First run a separate `npm run repo-canvas -- work start --id <id> --title <title> --targets <entity-ids> --note <intent>` command and wait for verified:true.",
  };
}

export async function runHook() {
  const raw = await readStdin();
  const input = raw.trim() ? JSON.parse(raw) : {};
  const result = evaluateHook(input);
  if (result) output(result.hookEventName, result);
}
