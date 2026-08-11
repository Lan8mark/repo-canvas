#!/usr/bin/env node

import path from "node:path";

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
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
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

function printHelp() {
  console.log(`Repo Canvas CLI

Commands:
  init        Install the repository contract and local scripts
  start       Run the foreground loopback canvas server
  task        Upsert a task
  node        Upsert a module-level node
  edge        Upsert a connection
  log         Record a decision or verification result
  directives  List pending owner directives (exit 2 when present)
  ack         Acknowledge a handled directive
  snapshot    Print the reduced canvas state
  check       Validate the event log and print a summary
  repair      Preview corrupt-line recovery; add --apply to repair

Global options:
  --root <path>  Explicit repository root
  --port <port>  Server port for start (default 4173)

Examples:
  repo-canvas init
  repo-canvas start
  repo-canvas task --id demo --title "Demo" --status active --actor codex
  repo-canvas node --task demo --id api --label "API" --status planned --actor codex
  repo-canvas directives --task demo
`);
}

const args = parseArgs(rawArgs);
if (args.root === true) {
  console.error("Repo Canvas error: --root requires a path");
  process.exitCode = 1;
} else {
  if (args.root) process.env.REPO_CANVAS_ROOT = path.resolve(process.cwd(), String(args.root));

  try {
    if (command === "help" || command === "--help" || command === "-h") {
      printHelp();
    } else if (command === "start" || command === "serve") {
      if (args.port !== undefined) process.env.CANVAS_PORT = String(args.port);
      if (args.host !== undefined) process.env.CANVAS_HOST = String(args.host);
      await import("../../server.mjs");
    } else if (command === "init") {
      const { runInit } = await import("./canvas-init.mjs");
      runInit({
        upgrade: Boolean(args.upgrade),
        installSpec: args["install-spec"] && args["install-spec"] !== true ? String(args["install-spec"]) : null,
      });
    } else {
      const { appendEvent, createEvent, getSnapshot, repairStore } = await import("./canvas-store.mjs");
      const emit = (type, actor, taskId, payload) => {
        const event = appendEvent(createEvent(type, { actor, taskId, payload: compact(payload) }));
        console.log(JSON.stringify(event, null, 2));
      };

      if (command === "task") {
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
        const pending = snapshot.pendingDirectives.filter((directive) => !args.task || directive.taskId === args.task);
        console.log(JSON.stringify(pending, null, 2));
        if (pending.length) process.exitCode = 2;
      } else if (command === "ack") {
        const directiveId = required(args, "id");
        const snapshot = getSnapshot();
        if (snapshot.storeErrors.length) throw new Error("Cannot acknowledge directives while the event store is invalid");
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
        if (snapshot.storeErrors.length) {
          console.error(JSON.stringify(snapshot.storeErrors, null, 2));
          process.exitCode = 1;
        } else {
          console.log(
            `Repo Canvas OK — revision ${snapshot.revision}, ${snapshot.summary.taskCount} tasks, ${snapshot.summary.nodeCount} nodes, ${snapshot.summary.pendingDirectives} pending directives.`,
          );
        }
      } else if (command === "repair") {
        const result = repairStore({ apply: Boolean(args.apply) });
        console.log(JSON.stringify(result, null, 2));
        if (!args.apply && result.removableLines.length) process.exitCode = 2;
      } else {
        throw new Error(`Unknown command: ${command}`);
      }
    }
  } catch (error) {
    console.error(`Repo Canvas error: ${error.message}`);
    process.exitCode = 1;
  }
}
