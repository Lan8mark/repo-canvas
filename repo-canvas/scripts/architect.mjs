import { getSnapshot } from "./canvas-store.mjs";
import { projectRoot } from "./project-root.mjs";
import { runCodexStructured } from "./model-runtime.mjs";
import { ARCHITECT_OUTPUT_SCHEMA, applyArchitecture } from "./semantic-model.mjs";

function compactCurrentMap(snapshot) {
  return {
    areas: snapshot.areas.map(({ id, title, note }) => ({ id, title, note })),
    entities: snapshot.entities.map(({ id, areaId, label, status, purpose, path }) => ({ id, areaId, label, status, purpose, path })),
    relations: snapshot.relations.map(({ id, from, to, label, status }) => ({ id, from, to, label, status })),
  };
}

export function architectPrompt({ snapshot, refresh }) {
  const current = refresh ? JSON.stringify(compactCurrentMap(snapshot)) : "No prior semantic map exists.";
  return `You are Repo Canvas Architect. Build a complete high-level semantic map of the repository in your current working directory.

This is a one-time architecture pass. Inspect the repository read-only using manifests, primary documentation, entry points, runtime boundaries, data flows and representative implementation files. Use medium-depth analysis. Do not modify files and do not call Repo Canvas commands.

Model human-meaningful areas, persistent modules, responsibilities, stores, pipeline stages and integrations. Do not mirror folders, individual files, classes, tests or completed tasks. There is no entity count limit: include every semantic entity needed to understand the real project, whether that is 4 or 400.

Requirements:
- stable concise ASCII ids;
- short Russian labels and descriptions when repository context is Russian, otherwise use its working language;
- relations only for meaningful runtime, data or control flow;
- path is optional reference evidence and never the identity of an entity;
- operational means intended to work; planned only for an approved concept that is not implemented;
- report removals only when refreshing and the concept genuinely no longer exists;
- a renamed, moved or reimplemented concept keeps its stable entity id;
- return the required structured output only.

Refresh mode: ${refresh ? "yes" : "no"}
Current semantic map:
${current}`;
}

export async function runArchitect({
  root = projectRoot,
  refresh = false,
  model,
  effort,
  runner = runCodexStructured,
} = {}) {
  const snapshot = getSnapshot();
  const profile = model || effort ? {
    model: model || process.env.REPO_CANVAS_ARCHITECT_MODEL || "gpt-5.6-sol",
    effort: effort || process.env.REPO_CANVAS_ARCHITECT_EFFORT || "medium",
  } : undefined;
  const result = await runner({
    role: "architect",
    cwd: root,
    prompt: architectPrompt({ snapshot, refresh }),
    outputSchema: ARCHITECT_OUTPUT_SCHEMA,
    ...(profile ? { profile } : {}),
  });
  const applied = applyArchitecture(result.value, { actor: "architect", refresh });
  return {
    provider: "codex",
    model: result.profile?.model || profile?.model,
    effort: result.profile?.effort || profile?.effort,
    threadId: result.threadId,
    projectTitle: result.value.projectTitle,
    areas: result.value.areas.length,
    entities: result.value.entities.length,
    relations: result.value.relations.length,
    events: applied.events,
    revision: applied.snapshot.revision,
  };
}
