import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendEvent,
  createEvent,
  getSnapshot,
  projectRoot,
} from "./repo-canvas/scripts/canvas-store.mjs";

const host = process.env.CANVAS_HOST || "127.0.0.1";
const port = Number(process.env.CANVAS_PORT || 4173);
const publicDirectory = path.join(projectRoot, "public");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendText(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(value),
  });
  response.end(value);
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 64 * 1024) throw new Error("Request body exceeds 64 KiB");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createDirective(body) {
  const allowedActions = new Set(["explain", "correct", "stop", "reject", "rollback"]);
  const action = String(body.action || "").toLowerCase();
  if (!allowedActions.has(action)) throw new Error(`Unsupported action: ${action || "empty"}`);

  const targetId = String(body.targetId || "").trim();
  const taskId = String(body.taskId || "").trim();
  if (!targetId || !taskId) throw new Error("taskId and targetId are required");

  const id = `dir_${crypto.randomUUID()}`;
  return createEvent("directive.created", {
    actor: "owner",
    taskId,
    payload: {
      id,
      taskId,
      targetId,
      targetKind: body.targetKind === "task" ? "task" : "node",
      action,
      note: String(body.note || "").slice(0, 4000),
      canvasRevision: Number(body.canvasRevision || 0),
    },
  });
}

async function serveStatic(pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const resolvedPath = path.resolve(publicDirectory, relativePath);
  if (!resolvedPath.startsWith(`${publicDirectory}${path.sep}`) && resolvedPath !== publicDirectory) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(resolvedPath);
    const contentType = mimeTypes.get(path.extname(resolvedPath).toLowerCase()) || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, pid: process.pid, now: new Date().toISOString() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      sendJson(response, 200, getSnapshot());
      return;
    }

    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204, { "Cache-Control": "public, max-age=86400" });
      response.end();
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/directives") {
      const directive = appendEvent(createDirective(await readJson(request)));
      sendJson(response, 201, { ok: true, directiveId: directive.payload.id, revision: getSnapshot().revision });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 400, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Repo Canvas listening at http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`Repo Canvas received ${signal}; stopping.`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
