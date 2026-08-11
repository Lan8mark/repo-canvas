export const TASK_STATUSES = new Set(["planned", "active", "blocked", "done", "stopped"]);
export const NODE_STATUSES = new Set([
  "existing",
  "planned",
  "active",
  "changed",
  "done",
  "blocked",
  "rejected",
]);
export const RISK_LEVELS = new Set(["safe", "caution", "destructive"]);
export const ACTIVITY_LEVELS = new Set(["info", "success", "warning", "error"]);
export const DIRECTIVE_ACTIONS = new Set(["explain", "correct", "stop", "reject", "rollback"]);
export const EVENT_TYPES = new Set([
  "task.upsert",
  "node.upsert",
  "edge.upsert",
  "activity.log",
  "directive.created",
  "directive.ack",
]);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:>\-]{0,127}$/;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(errors, value, field, { max = 4000, id = false } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${field} must be a non-empty string`);
    return;
  }
  if (value.length > max) errors.push(`${field} exceeds ${max} characters`);
  if (id && (!IDENTIFIER.test(value) || value.includes("::"))) {
    errors.push(`${field} must be a stable identifier without whitespace or '::'`);
  }
}

function optionalString(errors, value, field, max = 4000) {
  if (value === undefined) return;
  if (typeof value !== "string") errors.push(`${field} must be a string`);
  else if (value.length > max) errors.push(`${field} exceeds ${max} characters`);
}

function requireStatus(errors, value, field, allowed) {
  if (!allowed.has(value)) errors.push(`${field} has unsupported value '${String(value)}'`);
}

function requireFiniteNumber(errors, value, field, { integer = false, min = null } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${field} must be a finite number`);
    return;
  }
  if (integer && !Number.isInteger(value)) errors.push(`${field} must be an integer`);
  if (min !== null && value < min) errors.push(`${field} must be at least ${min}`);
}

export function validateEvent(event) {
  const errors = [];
  if (!plainObject(event)) return ["event must be an object"];

  if (event.v !== 1) errors.push(`unsupported event version '${String(event.v)}'`);
  requireString(errors, event.id, "id", { max: 160, id: true });
  requireString(errors, event.ts, "ts", { max: 64 });
  if (typeof event.ts === "string" && Number.isNaN(Date.parse(event.ts))) {
    errors.push("ts must be an RFC3339 timestamp");
  }
  requireString(errors, event.type, "type", { max: 80 });
  if (typeof event.type === "string" && !EVENT_TYPES.has(event.type)) {
    errors.push(`unknown event type '${event.type}'`);
  }
  requireString(errors, event.actor, "actor", { max: 64, id: true });
  if (event.taskId !== null && event.taskId !== undefined) {
    requireString(errors, event.taskId, "taskId", { max: 128, id: true });
  }
  if (!plainObject(event.payload)) {
    errors.push("payload must be an object");
    return errors;
  }

  const payload = event.payload;
  if (event.type === "task.upsert") {
    requireString(errors, event.taskId, "taskId", { max: 128, id: true });
    requireString(errors, payload.id, "payload.id", { max: 128, id: true });
    requireString(errors, payload.title, "payload.title", { max: 240 });
    requireStatus(errors, payload.status, "payload.status", TASK_STATUSES);
    optionalString(errors, payload.summary, "payload.summary", 4000);
    if (event.taskId && payload.id && event.taskId !== payload.id) {
      errors.push("taskId must equal payload.id for task.upsert");
    }
  } else if (event.type === "node.upsert") {
    requireString(errors, event.taskId, "taskId", { max: 128, id: true });
    requireString(errors, payload.id, "payload.id", { max: 128, id: true });
    requireString(errors, payload.label, "payload.label", { max: 240 });
    requireStatus(errors, payload.status, "payload.status", NODE_STATUSES);
    if (payload.risk !== undefined) requireStatus(errors, payload.risk, "payload.risk", RISK_LEVELS);
    optionalString(errors, payload.path, "payload.path", 1000);
    optionalString(errors, payload.note, "payload.note", 4000);
    for (const field of ["x", "y", "order"]) {
      if (payload[field] !== undefined) requireFiniteNumber(errors, payload[field], `payload.${field}`);
    }
  } else if (event.type === "edge.upsert") {
    requireString(errors, event.taskId, "taskId", { max: 128, id: true });
    requireString(errors, payload.id, "payload.id", { max: 128, id: true });
    requireString(errors, payload.from, "payload.from", { max: 128, id: true });
    requireString(errors, payload.to, "payload.to", { max: 128, id: true });
    requireStatus(errors, payload.status, "payload.status", NODE_STATUSES);
    optionalString(errors, payload.label, "payload.label", 240);
  } else if (event.type === "activity.log") {
    requireString(errors, payload.message, "payload.message", { max: 4000 });
    if (payload.level !== undefined) requireStatus(errors, payload.level, "payload.level", ACTIVITY_LEVELS);
  } else if (event.type === "directive.created") {
    requireString(errors, event.taskId, "taskId", { max: 128, id: true });
    requireString(errors, payload.id, "payload.id", { max: 160, id: true });
    requireString(errors, payload.taskId, "payload.taskId", { max: 128, id: true });
    requireString(errors, payload.targetId, "payload.targetId", { max: 128, id: true });
    requireStatus(errors, payload.action, "payload.action", DIRECTIVE_ACTIONS);
    if (!new Set(["task", "node"]).has(payload.targetKind)) {
      errors.push("payload.targetKind must be 'task' or 'node'");
    }
    optionalString(errors, payload.note, "payload.note", 4000);
    requireFiniteNumber(errors, payload.canvasRevision, "payload.canvasRevision", { integer: true, min: 0 });
    if (event.taskId && payload.taskId && event.taskId !== payload.taskId) {
      errors.push("taskId must equal payload.taskId for directive.created");
    }
  } else if (event.type === "directive.ack") {
    requireString(errors, event.taskId, "taskId", { max: 128, id: true });
    requireString(errors, payload.directiveId, "payload.directiveId", { max: 160, id: true });
    requireString(errors, payload.note, "payload.note", { max: 4000 });
  }

  return errors;
}

export function validateEventSequence(eventsWithLines) {
  const errors = [];
  const eventIds = new Set();
  const nodeKeys = new Set();
  const directives = new Map();

  for (const { event, line } of eventsWithLines) {
    if (eventIds.has(event.id)) errors.push({ line, id: event.id, message: "duplicate event id" });
    eventIds.add(event.id);
    if (event.type === "node.upsert") nodeKeys.add(`${event.taskId}::${event.payload.id}`);
    if (event.type === "directive.created") {
      const id = event.payload.id;
      if (directives.has(id)) errors.push({ line, id: event.id, message: `duplicate directive id '${id}'` });
      directives.set(id, { acknowledged: false, line });
    }
    if (event.type === "directive.ack") {
      const id = event.payload.directiveId;
      const directive = directives.get(id);
      if (!directive) errors.push({ line, id: event.id, message: `directive '${id}' was not created earlier` });
      else if (directive.acknowledged) errors.push({ line, id: event.id, message: `directive '${id}' was already acknowledged` });
      else directive.acknowledged = true;
    }
  }

  for (const { event, line } of eventsWithLines) {
    if (event.type !== "edge.upsert") continue;
    const from = `${event.taskId}::${event.payload.from}`;
    const to = `${event.taskId}::${event.payload.to}`;
    if (!nodeKeys.has(from)) errors.push({ line, id: event.id, message: `edge source '${event.payload.from}' does not exist` });
    if (!nodeKeys.has(to)) errors.push({ line, id: event.id, message: `edge target '${event.payload.to}' does not exist` });
  }

  return errors;
}
