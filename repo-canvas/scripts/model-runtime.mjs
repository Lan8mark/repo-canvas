import os from "node:os";

export const MODEL_PROFILES = Object.freeze({
  architect: Object.freeze({
    model: process.env.REPO_CANVAS_ARCHITECT_MODEL || "gpt-5.6-sol",
    effort: process.env.REPO_CANVAS_ARCHITECT_EFFORT || "medium",
  }),
  observer: Object.freeze({
    model: process.env.REPO_CANVAS_OBSERVER_MODEL || "gpt-5.4-mini",
    effort: process.env.REPO_CANVAS_OBSERVER_EFFORT || "low",
  }),
});

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { controller, clear: () => clearTimeout(timer) };
}

function parseStructuredResponse(finalResponse) {
  if (typeof finalResponse !== "string" || !finalResponse.trim()) {
    throw new Error("Codex returned an empty structured response");
  }
  try {
    return JSON.parse(finalResponse);
  } catch (error) {
    throw new Error(`Codex returned invalid JSON: ${error.message}`);
  }
}

function isolatedCodexEnvironment() {
  const env = { ...process.env, REPO_CANVAS_INTERNAL_SESSION: "1" };
  // Desktop/CLI launch metadata must not leak into the private SDK worker.
  // Otherwise its journal looks like another owner session and the observer can observe itself.
  for (const key of [
    "CODEX_THREAD_ID",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    "CODEX_THREAD_SOURCE",
    "CODEX_SPAWNED_BY",
  ]) delete env[key];
  return env;
}

export async function runCodexStructured({
  role,
  cwd,
  prompt,
  outputSchema,
  timeoutMs = role === "architect" ? 30 * 60_000 : 90_000,
  profile = MODEL_PROFILES[role],
  sdkFactory,
}) {
  if (!profile) throw new Error(`Unknown model role '${role}'`);
  const { controller, clear } = timeoutSignal(timeoutMs);
  try {
    const createSdk = sdkFactory || (async () => {
      const { Codex } = await import("@openai/codex-sdk");
      return new Codex({
        env: isolatedCodexEnvironment(),
      });
    });
    const codex = await createSdk();
    const thread = codex.startThread({
      model: profile.model,
      modelReasoningEffort: profile.effort,
      workingDirectory: cwd,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      webSearchEnabled: false,
    });
    const turn = await thread.run(prompt, { outputSchema, signal: controller.signal });
    return {
      value: parseStructuredResponse(turn.finalResponse),
      threadId: thread.id || null,
      profile,
      usage: turn.usage || null,
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${role} model timed out after ${timeoutMs} ms`);
    throw error;
  } finally {
    clear();
  }
}

export async function probeCodex({ cwd = os.tmpdir(), sdkFactory } = {}) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { answer: { type: "integer", enum: [4] } },
    required: ["answer"],
  };
  const startedAt = Date.now();
  try {
    const result = await runCodexStructured({
      role: "observer",
      cwd,
      prompt: "What is 2+2? Return only the required structured answer.",
      outputSchema: schema,
      timeoutMs: 45_000,
      sdkFactory,
    });
    return {
      provider: "codex",
      status: result.value.answer === 4 ? "connected" : "not-connected",
      model: result.profile.model,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider: "codex",
      status: "not-connected",
      model: MODEL_PROFILES.observer.model,
      latencyMs: Date.now() - startedAt,
      error: error.message,
    };
  }
}
