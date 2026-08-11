import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { DIRECTIVE_ACTIONS } from "./repo-canvas/scripts/canvas-schema.mjs";
import {
  appendEvent,
  createEvent,
  getSnapshot,
  packageRoot,
  projectRoot,
} from "./repo-canvas/scripts/canvas-store.mjs";

const host = process.env.CANVAS_HOST || "127.0.0.1";
const port = Number(process.env.CANVAS_PORT || 4173);
const publicDirectory = path.join(packageRoot, "public");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

if (!loopbackHosts.has(host)) throw new Error(`Repo Canvas v1 only binds to loopback; received CANVAS_HOST=${host}`);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid CANVAS_PORT: ${process.env.CANVAS_PORT}`);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

class HttpError extends Error {
  constructor(statusCode, message, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendText(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(value),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(value);
}

function parseLoopbackUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(403, `Invalid ${label}`);
  }
  if (parsed.protocol !== "http:" || !loopbackHosts.has(parsed.hostname)) {
    throw new HttpError(403, `${label} must be loopback HTTP`);
  }
  const parsedPort = parsed.port ? Number(parsed.port) : 80;
  if (parsedPort !== port) throw new HttpError(403, `${label} port does not match the active canvas`);
  return parsed;
}

function guardRequest(request) {
  const hostHeader = String(request.headers.host || "");
  parseLoopbackUrl(`http://${hostHeader}`, "Host");
  if (request.headers["sec-fetch-site"] === "cross-site") {
    throw new HttpError(403, "Cross-site requests are not allowed");
  }
}

function guardMutation(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const origin = request.headers.origin;
  if (origin) parseLoopbackUrl(String(origin), "Origin");
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 64 * 1024) throw new HttpError(413, "Request body exceeds 64 KiB");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

function createDirective(body) {
  const action = String(body.action || "").toLowerCase();
  if (!DIRECTIVE_ACTIONS.has(action)) throw new HttpError(400, `Unsupported action: ${action || "empty"}`);

  const targetId = String(body.targetId || "").trim();
  const taskId = String(body.taskId || "").trim();
  const targetKind = body.targetKind === "task" ? "task" : "node";
  if (!targetId || !taskId) throw new HttpError(400, "taskId and targetId are required");

  const snapshot = getSnapshot();
  if (snapshot.storeErrors.length) throw new HttpError(409, "Repo Canvas store must pass check before owner actions");
  const requestedRevision = Number(body.canvasRevision);
  if (!Number.isInteger(requestedRevision) || requestedRevision < 0) {
    throw new HttpError(400, "canvasRevision must be a non-negative integer");
  }
  if (requestedRevision !== snapshot.revision) {
    throw new HttpError(409, "Canvas changed; refresh before sending this command", { revision: snapshot.revision });
  }

  const target = targetKind === "task"
    ? snapshot.tasks.find((task) => task.id === targetId)
    : snapshot.nodes.find((node) => node.taskId === taskId && node.id === targetId);
  if (!target) throw new HttpError(404, `Target not found: ${taskId}/${targetId}`);
  if (action === "reject" && target.status !== "planned") {
    throw new HttpError(409, "Only planned work can be rejected; use rollback once work has started");
  }
  if (action === "rollback" && !new Set(["active", "changed", "done"]).has(target.status)) {
    throw new HttpError(409, "Rollback requires active, changed, or completed work");
  }

  const id = `dir_${crypto.randomUUID()}`;
  const event = createEvent("directive.created", {
    actor: "owner",
    taskId,
    payload: {
      id,
      taskId,
      targetId,
      targetKind,
      action,
      note: String(body.note || "").slice(0, 4000),
      canvasRevision: requestedRevision,
    },
  });
  return { event, expectedRevision: requestedRevision };
}

async function serveStatic(pathname, response, headOnly = false) {
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
      "X-Content-Type-Options": "nosniff",
    });
    response.end(headOnly ? undefined : content);
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
    guardRequest(request);
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, pid: process.pid, root: projectRoot, now: new Date().toISOString() });
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
      guardMutation(request);
      const { event, expectedRevision } = createDirective(await readJson(request));
      let directive;
      try {
        directive = appendEvent(event, { expectedRevision });
      } catch (error) {
        if (error.code === "STALE_REVISION") {
          throw new HttpError(409, "Canvas changed; refresh before sending this command", {
            revision: error.currentRevision,
          });
        }
        throw error;
      }
      sendJson(response, 201, { ok: true, directiveId: directive.payload.id, revision: expectedRevision + 1 });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, response, request.method === "HEAD");
  } catch (error) {
    const statusCode = error.statusCode || 400;
    sendJson(response, statusCode, { ok: false, error: error.message, ...(error.details || {}) });
  }
});

server.once("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Repo Canvas could not start: http://${host}:${port} is already in use. Choose another with --port <port>.`);
    process.exitCode = 1;
    return;
  }
  console.error(`Repo Canvas server error: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Repo Canvas root: ${projectRoot}`);
  console.log(`Repo Canvas listening at http://${host}:${port}`);
});

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Repo Canvas received ${signal}; stopping.`);
  const deadline = setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(0);
  }, 1_500);
  deadline.unref();
  server.close(() => {
    clearTimeout(deadline);
    process.exit(0);
  });
  server.closeIdleConnections?.();
  setTimeout(() => server.closeAllConnections?.(), 100).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
