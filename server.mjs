import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { appendEvents, createEvent, getSnapshot, packageRoot, projectRoot } from "./repo-canvas/scripts/canvas-store.mjs";
import { startObserver } from "./repo-canvas/scripts/observer.mjs";
import { readRuntimeConfig } from "./repo-canvas/scripts/runtime-config.mjs";
import { openSessionLocator } from "./repo-canvas/scripts/session-locator.mjs";

const host = process.env.CANVAS_HOST || "127.0.0.1";
const port = Number(process.env.CANVAS_PORT || 4173);
const publicDirectory = path.join(packageRoot, "public");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const runtimeConfig = readRuntimeConfig();
let observerService = null;

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
    if (total > 1024 * 1024) throw new HttpError(413, "Request body exceeds 1 MiB");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

function saveLayout(body) {
  const requestedRevision = Number(body.canvasRevision);
  if (!Number.isInteger(requestedRevision) || requestedRevision < 0) throw new HttpError(400, "canvasRevision must be a non-negative integer");
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, "items must be a non-empty array");
  const snapshot = getSnapshot();
  if (snapshot.storeErrors.length) throw new HttpError(409, "Repo Canvas store must pass check before saving layout");
  if (requestedRevision !== snapshot.revision) throw new HttpError(409, "Canvas changed; refresh before saving layout", { revision: snapshot.revision });
  const areas = new Map(snapshot.areas.map((item) => [item.id, item]));
  const entities = new Map(snapshot.entities.map((item) => [item.id, item]));
  const seen = new Set();
  const events = body.items.map((item) => {
    const kind = String(item?.kind || ""); const id = String(item?.id || "").trim();
    const x = Number(item?.x); const y = Number(item?.y); const key = `${kind}:${id}`;
    if (!id || seen.has(key)) throw new HttpError(400, "Each layout item must have a unique id and kind");
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new HttpError(400, `Layout coordinates must be finite for ${key}`);
    seen.add(key);
    if (kind === "area") {
      const current = areas.get(id); if (!current) throw new HttpError(404, `Area not found: ${id}`);
      const { actor, updatedAt, ...payload } = current;
      return createEvent("area.upsert", { actor: "owner", payload: { ...payload, x, y } });
    }
    if (kind === "entity") {
      const current = entities.get(id); if (!current) throw new HttpError(404, `Entity not found: ${id}`);
      const { actor, updatedAt, ...payload } = current;
      return createEvent("entity.upsert", { actor: "owner", payload: { ...payload, x, y } });
    }
    throw new HttpError(400, `Unsupported layout item kind: ${kind}`);
  });
  try {
    appendEvents(events, { expectedRevision: requestedRevision });
  } catch (error) {
    if (error.code === "STALE_REVISION") throw new HttpError(409, "Canvas changed; refresh before saving layout", { revision: error.currentRevision });
    throw error;
  }
  return { revision: requestedRevision + events.length, saved: events.length };
}

function findSessionNode(body) {
  const workId = String(body.workId || "").trim();
  if (!workId) throw new HttpError(400, "workId is required");
  const snapshot = getSnapshot();
  if (snapshot.storeErrors.length) throw new HttpError(409, "Repo Canvas store must pass check before navigation");
  const requestedRevision = Number(body.canvasRevision);
  if (!Number.isInteger(requestedRevision) || requestedRevision < 0) {
    throw new HttpError(400, "canvasRevision must be a non-negative integer");
  }
  if (requestedRevision !== snapshot.revision) {
    throw new HttpError(409, "Canvas changed; refresh before opening this work session", { revision: snapshot.revision });
  }
  const node = snapshot.work.find((item) => item.id === workId);
  if (!node) throw new HttpError(404, `Work not found: ${workId}`);
  if (!node.session) throw new HttpError(422, "The agent did not attach a work session to this node");
  return node;
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
      sendJson(response, 200, {
        ok: true, pid: process.pid, root: projectRoot, now: new Date().toISOString(),
        observer: observerService?.observer.summary() || { enabled: runtimeConfig.enabled, running: false },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      sendJson(response, 200, getSnapshot());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/revision") {
      const snapshot = getSnapshot();
      sendJson(response, 200, { revision: snapshot.revision, updatedAt: snapshot.updatedAt });
      return;
    }

    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204, { "Cache-Control": "public, max-age=86400" });
      response.end();
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sessions/open") {
      guardMutation(request);
      try {
        const node = findSessionNode(await readJson(request));
        const result = await openSessionLocator(node.session);
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, `Could not open the work session: ${error.message}`);
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/layout") {
      guardMutation(request);
      const result = saveLayout(await readJson(request));
      sendJson(response, 201, { ok: true, ...result });
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
  if (runtimeConfig.enabled && getSnapshot().semantic) {
    observerService = startObserver({ config: runtimeConfig });
    console.log(`Repo Canvas observer: ${observerService.observer.adapters.map((item) => item.id).join(", ")} sessions for ${runtimeConfig.repoRoot}`);
  }
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
  observerService?.stop().catch((error) => console.error(`Observer shutdown error: ${error.message}`));
  server.close(() => {
    clearTimeout(deadline);
    process.exit(0);
  });
  server.closeIdleConnections?.();
  setTimeout(() => server.closeAllConnections?.(), 100).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
