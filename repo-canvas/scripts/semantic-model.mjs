import { appendEvents, createEvent, getSnapshot } from "./canvas-store.mjs";

const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:>\\-]{0,127}$" };
const stringArray = { type: "array", items: { type: "string" } };
const shortName = { type: "string", minLength: 2, maxLength: 56 };
const logicalSentence = { type: "string", minLength: 24, maxLength: 220 };
const mechanismSentence = { type: "string", minLength: 24, maxLength: 320 };
const invariantArray = {
  type: "array", minItems: 1, maxItems: 3,
  items: { type: "string", minLength: 8, maxLength: 180 },
};
const boundaryArray = { type: "array", maxItems: 3, items: { type: "string", maxLength: 120 } };
const evidenceArray = {
  type: "array", minItems: 1, maxItems: 8,
  items: { type: "string", minLength: 3, maxLength: 1000 },
};
const role = { type: "string", enum: ["core", "support", "detail"] };

const areaSchema = {
  type: "object", additionalProperties: false,
  properties: {
    id, title: shortName, goal: logicalSentence, solution: logicalSentence, order: { type: "number" },
  },
  required: ["id", "title", "goal", "solution", "order"],
};
const entitySchema = {
  type: "object", additionalProperties: false,
  properties: {
    id, areaId: id, label: shortName, role,
    parentId: { type: "string", maxLength: 128 }, weight: { type: "number", minimum: 1, maximum: 100 },
    status: { type: "string", enum: ["operational", "disabled", "problem", "planned"] },
    path: { type: "string", maxLength: 1000 }, goal: logicalSentence, solution: logicalSentence,
    mechanism: mechanismSentence, invariants: invariantArray,
    inputs: boundaryArray, outputs: boundaryArray, dependsOn: { type: "array", items: id }, evidence: evidenceArray,
    covers: { type: "array", minItems: 1, maxItems: 12, items: id }, order: { type: "number" },
  },
  required: ["id", "areaId", "label", "role", "parentId", "weight", "status", "path", "goal", "solution", "mechanism", "invariants", "inputs", "outputs", "dependsOn", "evidence", "covers", "order"],
};
const relationSchema = {
  type: "object", additionalProperties: false,
  properties: {
    id, from: id, to: id,
    label: { type: "string", minLength: 3, maxLength: 64 },
    technical: { type: "string", minLength: 3, maxLength: 96 },
    status: { type: "string", enum: ["existing", "planned"] },
  },
  required: ["id", "from", "to", "label", "technical", "status"],
};
const removalSchema = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["area", "entity", "relation"] },
    id, replacementId: { type: "string", maxLength: 128 },
    evidence: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 3, maxLength: 1000 } },
    reason: { type: "string", minLength: 16, maxLength: 240 },
  },
  required: ["kind", "id", "replacementId", "evidence", "reason"],
};

export const ARCHITECT_OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    projectTitle: { type: "string" }, projectSummary: { type: "string" },
    areas: { type: "array", items: areaSchema },
    entities: { type: "array", items: entitySchema },
    relations: { type: "array", items: relationSchema },
    removedAreaIds: { type: "array", items: id },
    removedEntityIds: { type: "array", items: id },
    removedRelationIds: { type: "array", items: id },
    removals: { type: "array", items: removalSchema },
  },
  required: ["projectTitle", "projectSummary", "areas", "entities", "relations", "removedAreaIds", "removedEntityIds", "removedRelationIds", "removals"],
};

const entityChangeSchema = {
  type: "object", additionalProperties: false,
  properties: {
    operation: { type: "string", enum: ["upsert", "remove"] }, entityId: id, areaId: { type: "string" },
    label: shortName, status: { type: "string", enum: ["operational", "disabled", "problem", "planned"] },
    path: { type: "string", maxLength: 1000 }, problem: logicalSentence, solution: logicalSentence,
    mechanism: mechanismSentence, invariants: invariantArray,
    inputs: boundaryArray, outputs: boundaryArray, dependsOn: { type: "array", items: id }, reason: { type: "string" },
  },
  required: ["operation", "entityId", "areaId", "label", "status", "path", "problem", "solution", "mechanism", "invariants", "inputs", "outputs", "dependsOn", "reason"],
};
const relationChangeSchema = {
  type: "object", additionalProperties: false,
  properties: {
    operation: { type: "string", enum: ["upsert", "remove"] }, relationId: id,
    from: { type: "string" }, to: { type: "string" },
    label: { type: "string", maxLength: 64 }, technical: { type: "string", maxLength: 96 },
    status: { type: "string", enum: ["existing", "planned"] }, reason: { type: "string" },
  },
  required: ["operation", "relationId", "from", "to", "label", "technical", "status", "reason"],
};

export const OBSERVER_OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    workTitle: { type: "string" }, workSummary: { type: "string" },
    workStatus: { type: "string", enum: ["active", "blocked", "done", "stopped"] },
    targetEntityIds: { type: "array", items: id },
    entityChanges: { type: "array", items: entityChangeSchema },
    relationChanges: { type: "array", items: relationChangeSchema },
  },
  required: ["workTitle", "workSummary", "workStatus", "targetEntityIds", "entityChanges", "relationChanges"],
};

function uniqueIds(items, field) {
  const values = items.map((item) => item[field]);
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${field} in model response`);
}

function requireNarrative(value, field, { min = 16, max = 280 } = {}) {
  const text = String(value || "").trim();
  if (text.length < min || text.length > max) throw new Error(`${field} must contain ${min}-${max} meaningful characters`);
  if (/\r|\n/.test(text)) throw new Error(`${field} must be one compact sentence`);
}

export function validateNarrativeQuality(value) {
  for (const area of value.areas || []) {
    requireNarrative(area.title, `area '${area.id}' title`, { min: 2, max: 56 });
    requireNarrative(area.goal || area.problem, `area '${area.id}' goal`, { min: 24, max: 220 });
    requireNarrative(area.solution, `area '${area.id}' solution`, { min: 24, max: 220 });
  }
  for (const entity of value.entities || []) {
    requireNarrative(entity.label, `entity '${entity.id}' label`, { min: 2, max: 56 });
    if (entity.label.trim().split(/\s+/).length > 6) throw new Error(`entity '${entity.id}' label is too explanatory; move detail into solution`);
    requireNarrative(entity.goal || entity.problem, `entity '${entity.id}' goal`, { min: 24, max: 220 });
    requireNarrative(entity.solution, `entity '${entity.id}' solution`, { min: 24, max: 220 });
    requireNarrative(entity.mechanism, `entity '${entity.id}' mechanism`, { min: 24, max: 320 });
    if (!Array.isArray(entity.invariants) || entity.invariants.length < 1 || entity.invariants.length > 3) {
      throw new Error(`entity '${entity.id}' must declare 1-3 technical invariants`);
    }
    entity.invariants.forEach((item, index) => requireNarrative(item, `entity '${entity.id}' invariant ${index + 1}`, { min: 8, max: 180 }));
    if ((entity.inputs || []).length > 3 || (entity.outputs || []).length > 3) {
      throw new Error(`entity '${entity.id}' may expose at most 3 boundary-defining inputs and outputs`);
    }
    const semanticRole = entity.role || "core";
    const semanticWeight = entity.weight ?? (semanticRole === "core" ? 80 : semanticRole === "support" ? 50 : 20);
    if (!["core", "support", "detail"].includes(semanticRole)) throw new Error(`entity '${entity.id}' must declare core, support or detail role`);
    if (!Number.isFinite(semanticWeight) || semanticWeight < 1 || semanticWeight > 100) throw new Error(`entity '${entity.id}' must declare weight 1-100`);
    if ((!Array.isArray(entity.evidence) || !entity.evidence.length) && !entity.path) throw new Error(`entity '${entity.id}' must cite implementation evidence`);
  }
  for (const relation of value.relations || []) {
    requireNarrative(relation.label, `relation '${relation.id}' logical label`, { min: 3, max: 64 });
    requireNarrative(relation.technical, `relation '${relation.id}' technical label`, { min: 3, max: 96 });
    if (/[-,:;]$/.test(relation.technical.trim())) throw new Error(`relation '${relation.id}' technical label appears truncated`);
  }
  if ((value.entities || []).length > 1) {
    const connected = new Set((value.relations || []).flatMap((relation) => [relation.from, relation.to]));
    const isolated = value.entities.filter((entity) => !connected.has(entity.id)).map((entity) => entity.id);
    if (isolated.length) throw new Error(`semantic entities must be connected by meaningful relations: ${isolated.join(", ")}`);
  }
  return value;
}

export function validateArchitecture(value, snapshot = getSnapshot(), { refresh = false } = {}) {
  if (!value || !Array.isArray(value.areas) || !Array.isArray(value.entities) || !Array.isArray(value.relations)) {
    throw new Error("Architect response is missing semantic arrays");
  }
  uniqueIds(value.areas, "id"); uniqueIds(value.entities, "id"); uniqueIds(value.relations, "id");
  for (const entity of value.entities) if ((entity.ownerRole || entity.role || "core") === "core") entity.parentId = "";
  const removals = value.removals || [];
  const removedAreas = new Set(removals.filter((item) => item.kind === "area").map((item) => item.id));
  const removedEntities = new Set(removals.filter((item) => item.kind === "entity").map((item) => item.id));
  const areaIds = new Set([
    ...snapshot.areas.filter((item) => !removedAreas.has(item.id)).map((item) => item.id),
    ...value.areas.map((item) => item.id),
  ]);
  const entityIds = new Set([
    ...snapshot.entities
      .filter((item) => !removedEntities.has(item.id) && !removedAreas.has(item.areaId))
      .map((item) => item.id),
    ...value.entities.map((item) => item.id),
  ]);
  for (const entity of value.entities) if (!areaIds.has(entity.areaId)) throw new Error(`Unknown entity area '${entity.areaId}'`);
  const returnedEntities = new Map(value.entities.map((entity) => [entity.id, entity]));
  for (const entity of value.entities) {
    const semanticRole = entity.role || "core";
    if (semanticRole !== "core") {
      const parent = returnedEntities.get(entity.parentId) || snapshot.entities.find((item) => item.id === entity.parentId);
      if (!parent) throw new Error(`entity '${entity.id}' must point to a real parent`);
      if ((parent.ownerRole || parent.role || "core") === "detail" && semanticRole === "support") throw new Error(`support entity '${entity.id}' cannot be nested under detail`);
    }
  }
  for (const entity of value.entities) {
    const seen = new Set([entity.id]);
    let parentId = entity.parentId;
    while (parentId) {
      if (seen.has(parentId)) throw new Error(`semantic hierarchy contains a cycle at '${entity.id}'`);
      seen.add(parentId);
      parentId = (returnedEntities.get(parentId) || snapshot.entities.find((item) => item.id === parentId))?.parentId || "";
    }
  }
  for (const relation of value.relations) {
    if (!entityIds.has(relation.from) || !entityIds.has(relation.to)) throw new Error(`Unknown relation endpoint '${relation.id}'`);
  }
  validateNarrativeQuality(value);
  return value;
}

export function architectureEvents(value, { actor = "architect", refresh = false } = {}) {
  const snapshot = getSnapshot();
  validateArchitecture(value, snapshot, { refresh });
  const events = [];
  for (const area of value.areas) events.push(createEvent("area.upsert", { actor, payload: area }));
  for (const entity of value.entities) events.push(createEvent("entity.upsert", { actor, payload: entity }));
  for (const relation of value.relations) events.push(createEvent("relation.upsert", { actor, payload: relation }));
  if (refresh) {
    const returnedAreas = new Set(value.areas.map((item) => item.id));
    const returnedEntities = new Set(value.entities.map((item) => item.id));
    const returnedRelations = new Set(value.relations.map((item) => item.id));
    // Omission is never deletion. The architect must explicitly name removed concepts.
    const approvedRemovals = value.removals || [];
    const staleRelations = new Set(approvedRemovals.filter((item) => item.kind === "relation").map((item) => item.id));
    const staleEntities = new Set(approvedRemovals.filter((item) => item.kind === "entity").map((item) => item.id));
    const staleAreas = new Set(approvedRemovals.filter((item) => item.kind === "area").map((item) => item.id));
    for (const id of staleRelations) events.push(createEvent("relation.remove", { actor, payload: { id, reason: "Absent from complete architect refresh" } }));
    for (const id of staleEntities) events.push(createEvent("entity.remove", { actor, payload: { id, reason: "Absent from complete architect refresh" } }));
    for (const id of staleAreas) events.push(createEvent("area.remove", { actor, payload: { id, reason: "Absent from complete architect refresh" } }));
  }
  return events;
}

export function applyArchitecture(value, options = {}) {
  const events = architectureEvents(value, options);
  if (events.length) appendEvents(events);
  return { events: events.length, snapshot: getSnapshot() };
}

export function observerEvents(decision, context) {
  const snapshot = getSnapshot();
  const existingEntities = new Map(snapshot.entities.map((item) => [item.id, item]));
  const existingRelations = new Map(snapshot.relations.map((item) => [item.id, item]));
  const upserts = [];
  const removals = [];
  const targets = [...new Set((decision.targetEntityIds || []).filter((target) => existingEntities.has(target)
    || decision.entityChanges?.some((change) => change.operation === "upsert" && change.entityId === target)))];
  const workEvent = createEvent("work.upsert", {
    actor: "observer",
    payload: {
      id: context.workId, title: decision.workTitle || "Agent work", status: decision.workStatus,
      targets, note: decision.workSummary || "", provisional: targets.length === 0,
      session: context.session,
    },
  });
  for (const change of decision.entityChanges || []) {
    if (change.operation === "remove") {
      if (!context.final) continue;
      if (existingEntities.has(change.entityId)) removals.push(createEvent("entity.remove", {
        actor: "observer", payload: { id: change.entityId, reason: change.reason || decision.workSummary },
      }));
      continue;
    }
    const previous = existingEntities.get(change.entityId);
    upserts.push(createEvent("entity.upsert", {
      actor: "observer",
      payload: {
        id: change.entityId, areaId: change.areaId, label: change.label, status: change.status,
        path: change.path, goal: change.problem, problem: change.problem, solution: change.solution,
        mechanism: change.mechanism, invariants: change.invariants,
        inputs: change.inputs, outputs: change.outputs, dependsOn: change.dependsOn,
        role: previous?.role || "detail", parentId: previous?.parentId || targets[0] || "",
        weight: previous?.weight || 20, evidence: previous?.evidence || (change.path ? [change.path] : []),
        covers: previous?.covers || [change.entityId],
      },
    }));
  }
  for (const change of decision.relationChanges || []) {
    if (change.operation === "remove") {
      if (!context.final) continue;
      if (existingRelations.has(change.relationId)) removals.unshift(createEvent("relation.remove", {
        actor: "observer", payload: { id: change.relationId, reason: change.reason || decision.workSummary },
      }));
      continue;
    }
    upserts.push(createEvent("relation.upsert", {
      actor: "observer",
      payload: {
        id: change.relationId, from: change.from, to: change.to,
        label: change.label, technical: change.technical, status: change.status,
      },
    }));
  }
  return [...upserts, workEvent, ...removals];
}

export function applyObserverDecision(decision, context) {
  const events = observerEvents(decision, context);
  appendEvents(events);
  return { events: events.length, snapshot: getSnapshot() };
}
