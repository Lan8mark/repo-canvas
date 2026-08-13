import { getSnapshot } from "./canvas-store.mjs";
import { projectRoot } from "./project-root.mjs";
import { runCodexStructured } from "./model-runtime.mjs";
import { ARCHITECT_OUTPUT_SCHEMA, applyArchitecture } from "./semantic-model.mjs";

function compactCurrentMap(snapshot) {
  return {
    areas: snapshot.areas.map(({ id, title, problem, solution, note }) => ({ id, title, problem, solution, legacyNote: note })),
    entities: snapshot.entities.map(({ id, areaId, label, status, problem, solution, mechanism, purpose, path }) => ({
      id, areaId, label, status, problem, solution, mechanism, legacyPurpose: purpose, path,
    })),
    relations: snapshot.relations.map(({ id, from, to, label, technical, status }) => ({ id, from, to, label, technical, status })),
  };
}

export function architectPrompt({ snapshot, refresh }) {
  const current = refresh ? JSON.stringify(compactCurrentMap(snapshot)) : "No prior semantic map exists.";
  return `You are Repo Canvas Architect. Build a two-layer map that lets a capable engineer understand an unfamiliar or forgotten repository quickly.

This is a one-time architecture pass. Inspect the repository read-only using manifests, primary documentation, entry points, runtime boundaries, data flows and representative implementation files. Use medium-depth analysis. Do not modify files and do not call Repo Canvas commands.

The map is an explanation, not an inventory. Model problem spaces and durable solutions. Do not mirror folders, files, classes, libraries, tests or completed tasks. An entity deserves a node only when it solves a distinct problem that a newcomer can understand. Merge implementation pieces that have no independent reason to exist.

Every area and entity has two deliberately separate layers:

LOGIC — understandable before the reader knows repository terminology.
- problem: the concrete failure, risk, limitation or user need that makes this concept necessary;
- solution: what changes for the user or the rest of the system because this concept exists;
- label/title: a short plain-language name for that solution, not an internal class or technology name.

TECHNICAL — compact evidence, not a dump of nouns.
- mechanism: the fundamental algorithm, store, protocol or contract that actually delivers the solution;
- invariants: 1-3 non-negotiable guarantees or boundaries;
- inputs/outputs: at most 3 items each, only when they define the block boundary;
- path: the strongest implementation anchor, never the identity of the node.

Relations also have two layers:
- label: plain-language consequence read as “FROM — label → TO”; explain why the connection matters;
- technical: the actual call, data, control or persistence mechanism. Do not merely repeat endpoint names.
- return the complete meaningful relation graph, not a sample; every entity must have at least one relation because an isolated card does not explain a system;
- keep both relation labels compact: logical at most 64 characters, technical at most 96 characters and roughly 12 words;

Reader test: assume the reader is an experienced developer who knows none of this repository's internal names. The LOGIC layer must make sense alone. The TECHNICAL layer must then let that reader verify the claim in code.

Bad current-style example:
  label: "Реестр возможностей"
  description: "Хранит канонический список публичных операций, схем запросов, групп, write-roots..."
  relation: "публикует типизированные контракты"

Good two-layer example:
  label: "Единые правила операций"
  problem: "CLI, MCP и внутренние вызовы могут разойтись и выполнять одну операцию по-разному."
  solution: "Один список определяет доступные действия и одинаковые правила для всех интерфейсов."
  mechanism: "CapabilitySpec registry хранит request schema, write roots и режим выполнения; CLI и MCP строятся из него."
  invariant: "Операция описывается один раз и не реализуется заново в каждом интерфейсе."
  logical relation from CLI: "берёт единый набор команд"
  technical relation from CLI: "Typer commands generated from CapabilitySpec"

Requirements:
- stable concise ASCII ids;
- use short Russian logical copy when repository context is Russian; keep unavoidable code identifiers only in the technical layer;
- keep every area title and entity label within 56 characters and 6 words; move all explanation into problem and solution;
- one compact sentence per problem, solution, mechanism and invariant;
- name areas by the problem they resolve, not by source layout;
- write projectSummary as two short sentences: the project problem, then its solution;
- relations only for meaningful runtime, data or control flow;
- operational means intended to work; planned only for an approved concept that is not implemented;
- report removals only when refreshing and the concept genuinely no longer exists;
- a renamed, moved or reimplemented concept keeps its stable entity id;
- preserve stable ids from the current map, but rewrite weak titles and copy freely;
- refresh output is a complete replacement: anything omitted will be removed automatically;
- before returning, silently delete jargon that does not change the reader's understanding and verify that every node answers “why does this exist?”;
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
