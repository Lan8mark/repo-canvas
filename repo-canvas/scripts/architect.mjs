import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getSnapshot } from "./canvas-store.mjs";
import { projectRoot } from "./project-root.mjs";
import { resolveDataDirectory } from "./project-root.mjs";
import { runCodexStructured } from "./model-runtime.mjs";
import { ARCHITECT_OUTPUT_SCHEMA, applyArchitecture } from "./semantic-model.mjs";

const factItem = {
  type: "object", additionalProperties: false,
  properties: {
    id: { type: "string" }, name: { type: "string" }, purpose: { type: "string" },
    kind: { type: "string", enum: ["capability", "pipeline", "store", "model", "runtime", "interface", "support"] },
    evidence: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
  },
  required: ["id", "name", "purpose", "kind", "evidence"],
};

export const ARCHITECT_INVENTORY_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    projectPurpose: { type: "string" },
    userGoals: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } },
    facts: { type: "array", minItems: 1, items: factItem },
    mainFlows: { type: "array", minItems: 1, maxItems: 12, items: { type: "array", minItems: 2, items: { type: "string" } } },
    ignoredNoise: { type: "array", items: { type: "string" } },
  },
  required: ["projectPurpose", "userGoals", "facts", "mainFlows", "ignoredNoise"],
};

function compactCurrentMap(snapshot) {
  return {
    areas: snapshot.areas.map((item) => ({
      id: item.id, title: item.ownerTitle || item.title, goal: item.goal || item.problem,
      solution: item.solution,
    })),
    entities: snapshot.entities.map((item) => ({
      id: item.id, areaId: item.areaId, label: item.ownerLabel || item.label,
      role: item.ownerRole || item.role, parentId: item.parentId,
      weight: item.ownerWeight || item.weight, status: item.status,
      goal: item.goal || item.problem, solution: item.solution, mechanism: item.mechanism,
      path: item.path, evidence: item.evidence, covers: item.covers,
    })),
    relations: snapshot.relations.map(({ id, from, to, label, technical, status }) => ({ id, from, to, label, technical, status })),
  };
}

export function inventoryPrompt() {
  return `You are Repo Canvas Fact Collector. Inspect this repository read-only and build a compact factual inventory for an architecture map.

Start from what the product lets a user accomplish. Read primary architecture documentation, current public capabilities and entry points, then verify representative production implementation. Find every substantial pipeline, persistent store, model, separate runtime and public interface participating in those goals.

Evidence names real repository-relative files and may add a symbol after #. A large store, model or runtime in a main flow is a separate fact even when another pipeline owns it. Ignore historical plans, execution reports, generated output, tests and defensive checks unless current production code confirms a durable subsystem. Never rank something highly because it has many checks or documents.

Return facts only. Do not design the map yet.`;
}

export function architectPrompt({ snapshot, refresh, inventory = {} }) {
  const current = refresh ? JSON.stringify(compactCurrentMap(snapshot)) : "No prior semantic map exists.";
  return `You are Repo Canvas Architect. Turn the verified inventory into a top-down product map that lets an owner recognize the whole project immediately.

The governing model is GOAL -> TECHNICAL SOLUTION.
- An area is a major product goal.
- An entity is a real technical solution that accomplishes all or part of that goal.
- goal says what the user or system needs to achieve, in plain language.
- solution says what the block does to achieve it, without internal jargon.
- mechanism and evidence explain how production code implements the claim.

Importance is product importance, never defensive complexity:
- core: removing it destroys or fundamentally changes a main product capability. Core nodes form the readable product spine and have no parentId.
- support: a durable subsystem directly enabling one core block. parentId must be that core id.
- detail: replaceable implementation nested under core or support. It is hidden from the overview. parentId is required.
- weight is 1-100: core 70-100, support 35-69, detail 1-34.

Rank by explanatory value, not by implementation effort. A characteristic model, search engine or persistent store may be core when the owner cannot recognize the product without seeing it. A materializer, validator or executor that only carries out another block's decision is normally support of that deciding block, even when its implementation is large and exact.

Separate stores, models and runtimes in a central user flow must not disappear into another card's mechanism. Give them separate nodes, and make characteristic stores/models part of the core spine when they explain a defining product capability. Conversely validation, hashes, cleanup, documentation, exact copying and test machinery are not core merely because they are sophisticated.

The overview should normally contain 3-9 core blocks. A reader seeing only areas, core nodes and core relations must understand the product. Support fills in how the spine works. Detail is reserved for focus.

Every entity cites 1-8 repository-relative evidence anchors and lists the inventory fact ids it covers in covers. Every inventory fact must be covered. A store, model, runtime or pipeline in a main flow gets its own node rather than sharing a node with another fundamental fact. Main flows must be traceable through relations. Relations describe meaningful data, runtime or control flow.

Use short Russian logical copy when repository context is Russian. Keep area titles and entity labels within 56 characters and 6 words. Use one compact sentence per goal, solution, mechanism and invariant. Write projectSummary as two short sentences: project goal, then its solution.

Refresh is conservative: preserve stable ids and owner overrides. Omission is not deletion. Fill removed ids only when implementation evidence is genuinely gone, never to simplify the map.

Before returning, verify that the owner would recognize the product from core nodes alone. Return structured output only.

Verified inventory:
${JSON.stringify(inventory)}
Current semantic map:
${current}`;
}

export function auditPrompt({ inventory, candidate, snapshot, refresh }) {
  return `You are the final Repo Canvas Architecture Critic. Return a corrected complete architecture map, not comments.

Reject and repair the candidate when a primary user goal or main flow is missing; a substantial store, model, runtime or pipeline exists only inside prose; defensive checks, exact copying, cleanup, docs or tests outrank product capabilities; core-only nodes do not explain the product; wording describes risks instead of pragmatic goal -> technical solution; hierarchy or evidence is invalid; or an existing major concept vanished without proof.

Core nodes form the recognizable product spine. Support nodes explain durable enabling systems. Detail stays subordinate. Compare weights across the entire map: characteristic retrieval, storage and model blocks must not rank below mechanical execution merely because execution has more code, checks or outputs. When a block only applies a plan or decision produced elsewhere, nest it under the deciding block unless that execution is itself the defining user capability. Preserve stable ids and owner overrides. Omission is not deletion. Use removed ids only when code evidence confirms disappearance.

Inventory:
${JSON.stringify(inventory)}
Current map:
${refresh ? JSON.stringify(compactCurrentMap(snapshot)) : "none"}
Candidate:
${JSON.stringify(candidate)}`;
}

export function repairPrompt({ inventory, candidate, validationError, snapshot, refresh }) {
  return `${auditPrompt({ inventory, candidate, snapshot, refresh })}

The deterministic validator rejected this candidate:
${validationError}

Repair that exact structural failure without dropping any already covered fact or main flow. Return the complete corrected map.`;
}

export function validateInventoryCoverage(inventory, map) {
  const facts = new Map((inventory.facts || []).map((fact) => [fact.id, fact]));
  const factReference = new Map();
  const normalizedWords = (value) => new Set(String(value || "").toLowerCase().replace(/[^a-z0-9а-яё]+/giu, " ").split(/\s+/).filter((word) => word.length > 2 && !new Set(["and", "the", "with", "through", "from", "или", "для", "через"]).has(word)));
  for (const fact of facts.values()) {
    factReference.set(String(fact.id).trim().toLowerCase(), fact.id);
    factReference.set(String(fact.name || "").trim().toLowerCase(), fact.id);
  }
  const resolveFacts = (value) => {
    const exact = factReference.get(String(value || "").trim().toLowerCase());
    if (exact) return new Set([exact]);
    const words = normalizedWords(value);
    const scored = [];
    for (const fact of facts.values()) {
      const candidateWords = normalizedWords(`${fact.id} ${fact.name}`);
      const overlap = [...candidateWords].filter((word) => words.has(word)).length;
      const score = overlap / Math.max(1, Math.min(words.size, candidateWords.size));
      if (overlap && score >= 0.34) scored.push([fact.id, score]);
    }
    const best = Math.max(0, ...scored.map(([, score]) => score));
    return new Set(scored.filter(([, score]) => score >= Math.max(0.5, best - 0.12)).map(([id]) => id));
  };
  const coveredBy = new Map();
  for (const entity of map.entities || []) {
    for (const factId of entity.covers || []) {
      if (!facts.has(factId)) throw new Error(`entity '${entity.id}' covers unknown inventory fact '${factId}'`);
      const owners = coveredBy.get(factId) || [];
      owners.push(entity.id);
      coveredBy.set(factId, owners);
    }
  }
  const missing = [...facts.keys()].filter((id) => !coveredBy.has(id));
  if (missing.length) throw new Error(`architecture omits verified inventory facts: ${missing.join(", ")}`);

  const fundamental = new Set(["pipeline", "store", "model", "runtime"]);
  for (const entity of map.entities || []) {
    const major = (entity.covers || []).filter((id) => fundamental.has(facts.get(id)?.kind));
    if (major.length > 1) throw new Error(`entity '${entity.id}' collapses fundamental facts: ${major.join(", ")}`);
  }

  const factNodes = new Map([...coveredBy].map(([factId, ids]) => [factId, new Set(ids)]));
  const adjacency = new Map((map.entities || []).map((entity) => [entity.id, new Set()]));
  for (const relation of map.relations || []) {
    adjacency.get(relation.from)?.add(relation.to);
    adjacency.get(relation.to)?.add(relation.from);
  }
  const connected = (sources, targets) => {
    const queue = [...sources];
    const seen = new Set(queue);
    while (queue.length) {
      const current = queue.shift();
      if (targets.has(current)) return true;
      for (const next of adjacency.get(current) || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    return false;
  };
  for (const flow of inventory.mainFlows || []) {
    const resolved = flow.map(resolveFacts).filter((ids) => ids.size);
    for (let index = 1; index < resolved.length; index += 1) {
      const fromFactIds = resolved[index - 1];
      const toFactIds = resolved[index];
      const from = new Set([...fromFactIds].flatMap((id) => [...(factNodes.get(id) || [])]));
      const to = new Set([...toFactIds].flatMap((id) => [...(factNodes.get(id) || [])]));
      if (!from.size || !to.size || !connected(from, to)) throw new Error(`main flow is broken between '${[...fromFactIds].join("/")}' and '${[...toFactIds].join("/")}'`);
    }
  }
  return map;
}

function repositoryFingerprint(root) {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
    const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return crypto.createHash("sha256").update(head).update("\0").update(status).digest("hex");
  } catch {
    return null;
  }
}

function readInventoryCache(root) {
  const fingerprint = repositoryFingerprint(root);
  if (!fingerprint) return null;
  const file = path.join(resolveDataDirectory(root), "architect-inventory.json");
  try {
    const cache = JSON.parse(fs.readFileSync(file, "utf8"));
    return cache.fingerprint === fingerprint ? cache.inventory : null;
  } catch { return null; }
}

function writeInventoryCache(root, inventory) {
  const fingerprint = repositoryFingerprint(root);
  if (!fingerprint) return;
  const file = path.join(resolveDataDirectory(root), "architect-inventory.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, fingerprint, inventory }, null, 2)}\n`, "utf8");
}

export async function runArchitect({
  root = projectRoot,
  refresh = false,
  model,
  effort,
  runner = runCodexStructured,
  onProgress = () => {},
} = {}) {
  const snapshot = getSnapshot();
  const profile = model || effort ? {
    model: model || process.env.REPO_CANVAS_ARCHITECT_MODEL || "gpt-5.6-sol",
    effort: effort || process.env.REPO_CANVAS_ARCHITECT_EFFORT || "medium",
  } : undefined;
  const common = { cwd: root, ...(profile ? { profile } : {}) };
  let inventory = readInventoryCache(root);
  let inventoryResult;
  if (inventory) {
    onProgress("inventory-cached");
    inventoryResult = { value: inventory, profile };
  } else {
    onProgress("inventory");
    inventoryResult = await runner({
      ...common, role: "architect-inventory", prompt: inventoryPrompt(), outputSchema: ARCHITECT_INVENTORY_SCHEMA,
    });
    inventory = inventoryResult.value;
    writeInventoryCache(root, inventory);
  }
  onProgress("map");
  const candidateResult = await runner({
    ...common, role: "architect", prompt: architectPrompt({ snapshot, refresh, inventory: inventoryResult.value }),
    outputSchema: ARCHITECT_OUTPUT_SCHEMA,
  });
  onProgress("audit");
  let result = await runner({
    ...common, role: "architect-audit",
    prompt: auditPrompt({ inventory: inventoryResult.value, candidate: candidateResult.value, snapshot, refresh }),
    outputSchema: ARCHITECT_OUTPUT_SCHEMA,
  });
  try {
    validateInventoryCoverage(inventoryResult.value, result.value);
  } catch (error) {
    onProgress("repair", error.message);
    result = await runner({
      ...common, role: "architect-repair",
      prompt: repairPrompt({
        inventory: inventoryResult.value, candidate: result.value,
        validationError: error.message, snapshot, refresh,
      }),
      outputSchema: ARCHITECT_OUTPUT_SCHEMA,
    });
    validateInventoryCoverage(inventoryResult.value, result.value);
  }
  onProgress("apply");
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
    inventoryFacts: inventoryResult.value.facts.length,
    events: applied.events,
    revision: applied.snapshot.revision,
  };
}
