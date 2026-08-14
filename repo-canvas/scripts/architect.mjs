import { getSnapshot } from "./canvas-store.mjs";
import { projectRoot } from "./project-root.mjs";
import { runCodexStructured } from "./model-runtime.mjs";
import { normalizeLanguage, readRuntimeConfig } from "./runtime-config.mjs";
import { ARCHITECT_OUTPUT_SCHEMA, applyArchitecture } from "./semantic-model.mjs";

function compactCurrentMap(snapshot) {
  return {
    areas: snapshot.areas.map(({ id, title, goal, solution }) => ({ id, title, goal, solution })),
    entities: snapshot.entities.map(({ id, areaId, label, role, parentId, status, goal, solution, path }) => ({
      id, areaId, label, role, parentId, status, goal, solution, path,
    })),
    relations: snapshot.relations.map(({ id, from, to, label, status }) => ({ id, from, to, label, status })),
  };
}

export function architectPrompt({ snapshot, refresh, language = "ru" }) {
  const outputLanguage = normalizeLanguage(language) === "ru" ? "Russian" : "English";
  const current = refresh ? JSON.stringify(compactCurrentMap(snapshot)) : "No prior semantic map exists.";
  return `You are Repo Canvas Architect. Explain this repository as a reason-first structural map that lets a newcomer understand in a few minutes both why the system exists and what major logical blocks it consists of.

The map is explanatory compression, not an inventory of code, but compression must not erase the system's composition. Do not enumerate every implementation component. Do include every major logical block required to follow the primary flows from input to outcome and to understand where important state, decisions, transformations and safety boundaries live.

Inspect the repository read-only. Never inspect .repo-canvas or use a previously generated map as evidence. Start with manifests, primary product documentation and public entry points. Read representative production code only to verify the explanation. Do not modify files and do not call Repo Canvas commands.

Build the map internally in this order:
1. Product boundaries. Each area is an independently used, shipped or operated product, not a technical layer or feature bucket.
2. Human reasons and journeys. State the plain-language problems that make each product necessary and identify its main end-to-end flows.
3. Major logical blocks. Split each flow into durable responsibilities with distinct inputs, outputs, owned state, decisions, transformations or failure boundaries. These are the system's architectural modules even when several live in one process or package.
4. Ownership hierarchy. Use core entities for the major blocks a newcomer must see. Use support children when a core block hides an essential sub-block with a different contract or role.
5. Verification. After defining the logical structure, attach representative evidence, concise technical mechanisms and essential boundaries.
6. Structural completeness audit. A newcomer must be able to answer: what enters the system, which large blocks handle it, where durable knowledge or state lives, how correctness is protected, what leaves the system, and how the blocks connect.

An entity qualifies when removing or merging it would hide a distinct product capability, durable responsibility, contract, state boundary, transformation or decision needed to explain an important flow. Name the logical responsibility, not its current technology: replacing a database, framework or worker should not invalidate the entity when the architectural role remains.

Databases, stores, indexes, models, workers, runtimes, adapters, registries, validators, frameworks, tests and individual functions are not entities merely because they exist. They may justify a logical entity only when they reveal an independently understandable state, contract, transformation or safety boundary in a primary flow. Do not use generic buckets such as Utilities, Infrastructure or Validation; name the specific responsibility they serve.

For a non-trivial product, 3 entities is usually over-compressed. Usually produce 6-12 entities across core and support, but let real architectural boundaries determine the count. Split a node when its label hides multiple responsibilities with materially different inputs, outputs, failure modes or reasons to change. Merge nodes that differ only by technology, file layout or pipeline mechanics.

Field meanings:
- area.goal: why people need this product;
- area.solution: what outcome the product owns;
- entity.goal: the human problem or reason for this responsibility, with no implementation mechanism;
- entity.solution: what the product takes responsibility for, never how it is implemented;
- entity.mechanism, invariants, inputs, outputs and evidence: compact verification added only after the responsibility is established;
- entity.role: core for a major visible logical block; support for an essential sub-block with its own contract below a core responsibility; avoid detail unless it materially clarifies one focused path;
- entity.parentId: empty for core, owning core id for support/detail;
- entity.weight: product importance, not code size; core 70-100, support 35-69, detail 1-34;
- entity.covers: stable ids for the responsibility itself, not an exhaustive fact ledger;
- relations: connect enough blocks to make every primary end-to-end flow followable. Keep technical short and subordinate to the logical label.

Use stable concise ASCII ids. Output language is strictly ${outputLanguage}. Write every human-readable output field in ${outputLanguage}: project title and summary, area titles/goals/solutions, entity labels/goals/solutions/mechanisms/invariants/boundaries, and relation labels. Do not infer language from repository contents and do not mix languages. Official product, protocol and technology names may retain their spelling.

In refresh mode, evolve the current map instead of regenerating an unrelated replacement. The current map is durable architectural memory and a working hypothesis, but repository evidence remains the source of truth. Preserve valid concepts and stable ids, update their explanation or structure when evidence changed, and add newly established blocks. Split or merge concepts only when that makes the system easier to understand while preserving continuity.

Return the complete updated map, including unchanged concepts. Omission is never deletion: put an id in removedAreaIds, removedEntityIds or removedRelationIds only when repository evidence shows that the concept disappeared, was contradicted, or was deliberately absorbed into another returned concept. Never remove a concept merely because it was not rediscovered during this pass. Owner names and layout survive separately for stable ids.

Return the required structured output only.

Refresh mode: ${refresh ? "yes" : "no"}
Current map:
${current}`;
}

export async function runArchitect({
  root = projectRoot,
  refresh = false,
  model,
  effort,
  language = readRuntimeConfig().language,
  runner = runCodexStructured,
  onProgress = () => {},
} = {}) {
  const snapshot = getSnapshot();
  const profile = model || effort ? {
    model: model || process.env.REPO_CANVAS_ARCHITECT_MODEL || "gpt-5.6-sol",
    effort: effort || process.env.REPO_CANVAS_ARCHITECT_EFFORT || "medium",
  } : undefined;
  onProgress("map");
  const result = await runner({
    role: "architect",
    cwd: root,
    prompt: architectPrompt({ snapshot, refresh, language }),
    outputSchema: ARCHITECT_OUTPUT_SCHEMA,
    ...(profile ? { profile } : {}),
  });
  onProgress("apply");
  const applied = applyArchitecture(result.value, { actor: "architect", refresh });
  return {
    provider: "codex",
    model: result.profile?.model || profile?.model,
    effort: result.profile?.effort || profile?.effort,
    language: normalizeLanguage(language),
    threadId: result.threadId,
    projectTitle: result.value.projectTitle,
    areas: result.value.areas.length,
    entities: result.value.entities.length,
    relations: result.value.relations.length,
    events: applied.events,
    revision: applied.snapshot.revision,
  };
}
