import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptDirectory, "..", "..");
export const dataDirectory = path.resolve(
  process.env.REPO_CANVAS_DATA_DIR || path.join(projectRoot, ".repo-canvas"),
);
export const eventsFile = path.join(dataDirectory, "events.jsonl");

export function ensureStore() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  if (!fs.existsSync(eventsFile)) {
    fs.writeFileSync(eventsFile, "", "utf8");
  }
}

export function createEvent(type, { actor = "unknown", taskId = null, payload = {} } = {}) {
  return {
    v: 1,
    id: `evt_${crypto.randomUUID()}`,
    ts: new Date().toISOString(),
    type,
    actor,
    taskId,
    payload,
  };
}

export function appendEvent(event) {
  ensureStore();
  fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export function readEvents() {
  ensureStore();
  const lines = fs.readFileSync(eventsFile, "utf8").split(/\r?\n/);
  const events = [];
  const errors = [];

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      errors.push({ line: index + 1, message: error.message });
    }
  });

  return { events, errors };
}

function taskKey(taskId) {
  return String(taskId || "unassigned");
}

function entityKey(taskId, id) {
  return `${taskKey(taskId)}::${String(id)}`;
}

function activityLabel(event) {
  const payload = event.payload || {};
  if (event.type === "activity.log") return payload.message || "Activity recorded";
  if (event.type === "task.upsert") return `Task ${payload.title || payload.id} → ${payload.status || "updated"}`;
  if (event.type === "node.upsert") return `${payload.label || payload.id} → ${payload.status || "updated"}`;
  if (event.type === "edge.upsert") return `Connection ${payload.from} → ${payload.to}`;
  if (event.type === "directive.created") return `Owner: ${payload.action} ${payload.targetId || "task"}`;
  if (event.type === "directive.ack") return `Directive acknowledged by ${event.actor}`;
  return event.type;
}

export function reduceEvents(events, errors = []) {
  const tasks = new Map();
  const nodes = new Map();
  const edges = new Map();
  const directives = new Map();
  const activity = [];

  for (const event of events) {
    const payload = event.payload || {};
    const currentTaskId = taskKey(event.taskId || payload.taskId || payload.id);

    if (event.type === "task.upsert") {
      const id = String(payload.id || currentTaskId);
      tasks.set(id, {
        ...(tasks.get(id) || {}),
        ...payload,
        id,
        actor: event.actor,
        updatedAt: event.ts,
      });
    }

    if (event.type === "node.upsert") {
      const id = String(payload.id);
      const key = entityKey(currentTaskId, id);
      nodes.set(key, {
        ...(nodes.get(key) || {}),
        ...payload,
        id,
        taskId: currentTaskId,
        actor: event.actor,
        updatedAt: event.ts,
      });
      if (!tasks.has(currentTaskId)) {
        tasks.set(currentTaskId, {
          id: currentTaskId,
          title: currentTaskId,
          status: "active",
          actor: event.actor,
          updatedAt: event.ts,
        });
      }
    }

    if (event.type === "edge.upsert") {
      const id = String(payload.id || `${payload.from}->${payload.to}`);
      const key = entityKey(currentTaskId, id);
      edges.set(key, {
        ...(edges.get(key) || {}),
        ...payload,
        id,
        taskId: currentTaskId,
        actor: event.actor,
        updatedAt: event.ts,
      });
    }

    if (event.type === "directive.created") {
      const id = String(payload.id || event.id);
      directives.set(id, {
        ...payload,
        id,
        taskId: event.taskId || payload.taskId || null,
        status: "pending",
        createdAt: event.ts,
        createdBy: event.actor,
      });
    }

    if (event.type === "directive.ack") {
      const directiveId = String(payload.directiveId || "");
      const current = directives.get(directiveId);
      if (current) {
        directives.set(directiveId, {
          ...current,
          status: "acknowledged",
          acknowledgedAt: event.ts,
          acknowledgedBy: event.actor,
          response: payload.note || "",
        });
      }
    }

    activity.push({
      id: event.id,
      ts: event.ts,
      actor: event.actor,
      taskId: event.taskId,
      type: event.type,
      level: payload.level || (event.type === "directive.created" ? "warning" : "info"),
      message: activityLabel(event),
    });
  }

  const taskList = [...tasks.values()].sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const nodeList = [...nodes.values()].sort((a, b) => {
    if (a.taskId !== b.taskId) return a.taskId.localeCompare(b.taskId);
    return Number(a.order || 0) - Number(b.order || 0) || String(a.label).localeCompare(String(b.label));
  });
  const edgeList = [...edges.values()];
  const directiveList = [...directives.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    revision: events.length,
    updatedAt: events.at(-1)?.ts || null,
    parseErrors: errors,
    tasks: taskList,
    nodes: nodeList,
    edges: edgeList,
    directives: directiveList,
    pendingDirectives: directiveList.filter((directive) => directive.status === "pending"),
    activity: activity.slice(-80).reverse(),
    summary: {
      taskCount: taskList.length,
      activeTasks: taskList.filter((task) => task.status === "active").length,
      nodeCount: nodeList.length,
      activeNodes: nodeList.filter((node) => node.status === "active").length,
      plannedNodes: nodeList.filter((node) => node.status === "planned").length,
      pendingDirectives: directiveList.filter((directive) => directive.status === "pending").length,
      agents: [...new Set(events.map((event) => event.actor).filter(Boolean))],
    },
  };
}

export function getSnapshot() {
  const { events, errors } = readEvents();
  return reduceEvents(events, errors);
}
