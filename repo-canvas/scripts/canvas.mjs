#!/usr/bin/env node

import { appendEvent, createEvent, getSnapshot } from "./canvas-store.mjs";

const [, , command = "help", ...rawArgs] = process.argv;

function parseArgs(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function required(args, key) {
  const value = args[key];
  if (value === undefined || value === true || String(value).trim() === "") {
    throw new Error(`Missing required option --${key}`);
  }
  return String(value);
}

function optionalNumber(value) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received ${value}`);
  return parsed;
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function emit(type, actor, taskId, payload) {
  const event = appendEvent(createEvent(type, { actor, taskId, payload: compact(payload) }));
  console.log(JSON.stringify(event, null, 2));
}

function printHelp() {
  console.log(`Repo Canvas CLI

Commands:
  task        Upsert a task
  node        Upsert a module-level node
  edge        Upsert a connection
  log         Record a decision or verification result
  directives  List pending owner directives
  ack         Acknowledge a handled directive
  snapshot    Print the reduced canvas state
  check       Validate the event log and print a summary

Examples:
  node repo-canvas/scripts/canvas.mjs task --id demo --title "Demo" --status active --actor codex
  node repo-canvas/scripts/canvas.mjs node --task demo --id api --label "API" --status planned --actor codex
  node repo-canvas/scripts/canvas.mjs directives --task demo
`);
}

const args = parseArgs(rawArgs);

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "task") {
    const id = required(args, "id");
    emit("task.upsert", args.actor || "unknown", id, {
      id,
      title: required(args, "title"),
      status: args.status || "planned",
      summary: args.summary || "",
    });
  } else if (command === "node") {
    const taskId = required(args, "task");
    emit("node.upsert", args.actor || "unknown", taskId, {
      id: required(args, "id"),
      label: required(args, "label"),
      path: args.path || "",
      status: args.status || "planned",
      risk: args.risk || "safe",
      note: args.note || "",
      x: optionalNumber(args.x),
      y: optionalNumber(args.y),
      order: optionalNumber(args.order),
    });
  } else if (command === "edge") {
    const taskId = required(args, "task");
    const from = required(args, "from");
    const to = required(args, "to");
    emit("edge.upsert", args.actor || "unknown", taskId, {
      id: args.id || `${from}->${to}`,
      from,
      to,
      label: args.label || "",
      status: args.status || "planned",
    });
  } else if (command === "log") {
    emit("activity.log", args.actor || "unknown", args.task || null, {
      message: required(args, "message"),
      level: args.level || "info",
    });
  } else if (command === "directives") {
    const snapshot = getSnapshot();
    const pending = snapshot.pendingDirectives.filter(
      (directive) => !args.task || directive.taskId === args.task,
    );
    console.log(JSON.stringify(pending, null, 2));
    if (pending.length) process.exitCode = 2;
  } else if (command === "ack") {
    const directiveId = required(args, "id");
    const snapshot = getSnapshot();
    const directive = snapshot.pendingDirectives.find((item) => item.id === directiveId);
    if (!directive) throw new Error(`Pending directive not found: ${directiveId}`);
    emit("directive.ack", args.actor || "unknown", directive.taskId, {
      directiveId,
      note: required(args, "note"),
    });
  } else if (command === "snapshot") {
    console.log(JSON.stringify(getSnapshot(), null, 2));
  } else if (command === "check") {
    const snapshot = getSnapshot();
    if (snapshot.parseErrors.length) {
      console.error(JSON.stringify(snapshot.parseErrors, null, 2));
      process.exitCode = 1;
    } else {
      console.log(`Repo Canvas OK — revision ${snapshot.revision}, ${snapshot.summary.taskCount} tasks, ${snapshot.summary.nodeCount} nodes, ${snapshot.summary.pendingDirectives} pending directives.`);
    }
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`Repo Canvas error: ${error.message}`);
  process.exitCode = 1;
}
