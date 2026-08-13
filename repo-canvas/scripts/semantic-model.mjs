import { appendEvents, createEvent, getSnapshot } from "./canvas-store.mjs";

const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:>\\-]{0,127}$" };
const stringArray = { type: "array", items: { type: "string" } };

const areaSchema = {
  type: "object", additionalProperties: false,
  properties: {
    id, title: { type: "string" }, note: { type: "string" }, order: { type: "number" },
  },
  required: ["id", "title", "note", "order"],
};
const entitySchema = {
  type: "object", additionalProperties: false,
  properties: {
    id, areaId: id, label: { type: "string" },
    status: { type: "string", enum: ["operational", "disabled", "problem", "planned"] },
    path: { type: "string" }, purpose: { type: "string" }, note: { type: "string" },
    inputs: stringArray, outputs: stringArray, dependsOn: { type: "array", items: id }, order: { type: "number" },
  },
  required: ["id", "areaId", "label", "status", "path", "purpose", "note", "inputs", "outputs", "dependsOn", "order"],
};
const relationSchema = {
  type: "object", additionalProperties: false,
  properties: {
    id, from: id, to: id, label: { type: "string" }, status: { type: "string", enum: ["existing", "planned"] },
  },
  required: ["id", "from", "to", "label", "status"],
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
  },
  required: ["projectTitle", "projectSummary", "areas", "entities", "relations", "removedAreaIds", "removedEntityIds", "removedRelationIds"],
};

const entityChangeSchema = {
  type: "object", additionalProperties: false,
  properties: {
    operation: { type: "string", enum: ["upsert", "remove"] }, entityId: id, areaId: { type: "string" },
    label: { type: "string" }, status: { type: "string", enum: ["operational", "disabled", "problem", "planned"] },
    path: { type: "string" }, purpose: { type: "string" }, note: { type: "string" },
    inputs: stringArray, outputs: stringArray, dependsOn: { type: "array", items: id }, reason: { type: "string" },
  },
  required: ["operation", "entityId", "areaId", "label", "status", "path", "purpose", "note", "inputs", "outputs", "dependsOn", "reason"],
};
const relationChangeSchema = {
  type: "object", additionalProperties: false,
  properties: {
    operation: { type: "string", enum: ["upsert", "remove"] }, relationId: id,
    from: { type: "string" }, to: { type: "string" }, label: { type: "string" },
    status: { type: "string", enum: ["existing", "planned"] }, reason: { type: "string" },
  },
  required: ["operation", "relationId", "from", "to", "label", "status", "reason"],
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

export function validateArchitecture(value, snapshot = getSnapshot()) {
  if (!value || !Array.isArray(value.areas) || !Array.isArray(value.entities) || !Array.isArray(value.relations)) {
    throw new Error("Architect response is missing semantic arrays");
  }
  uniqueIds(value.areas, "id"); uniqueIds(value.entities, "id"); uniqueIds(value.relations, "id");
  const removedAreas = new Set(value.removedAreaIds || []);
  const removedEntities = new Set(value.removedEntityIds || []);
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
  for (const relation of value.relations) {
    if (!entityIds.has(relation.from) || !entityIds.has(relation.to)) throw new Error(`Unknown relation endpoint '${relation.id}'`);
  }
  return value;
}

export function architectureEvents(value, { actor = "architect", refresh = false } = {}) {
  const snapshot = getSnapshot();
  validateArchitecture(value, snapshot);
  const events = [];
  for (const area of value.areas) events.push(createEvent("area.upsert", { actor, payload: area }));
  for (const entity of value.entities) events.push(createEvent("entity.upsert", { actor, payload: entity }));
  for (const relation of value.relations) events.push(createEvent("relation.upsert", { actor, payload: relation }));
  if (refresh) {
    for (const id of value.removedRelationIds || []) events.push(createEvent("relation.remove", { actor, payload: { id, reason: "Architect refresh" } }));
    for (const id of value.removedEntityIds || []) events.push(createEvent("entity.remove", { actor, payload: { id, reason: "Architect refresh" } }));
    for (const id of value.removedAreaIds || []) events.push(createEvent("area.remove", { actor, payload: { id, reason: "Architect refresh" } }));
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
      targets, note: decision.workSummary || "", provisional: targets.length === 0 && decision.workStatus === "active",
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
    upserts.push(createEvent("entity.upsert", {
      actor: "observer",
      payload: {
        id: change.entityId, areaId: change.areaId, label: change.label, status: change.status,
        path: change.path, purpose: change.purpose, note: change.note,
        inputs: change.inputs, outputs: change.outputs, dependsOn: change.dependsOn,
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
      payload: { id: change.relationId, from: change.from, to: change.to, label: change.label, status: change.status },
    }));
  }
  return [...upserts, workEvent, ...removals];
}

export function applyObserverDecision(decision, context) {
  const events = observerEvents(decision, context);
  appendEvents(events);
  return { events: events.length, snapshot: getSnapshot() };
}
