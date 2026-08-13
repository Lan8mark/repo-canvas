const TOKEN_KEY = "repo-canvas.api-token";

function resolveToken() {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const token = parameters.get("token");
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return token;
  }
  return localStorage.getItem(TOKEN_KEY) || "";
}

let apiToken = resolveToken();

export function reloadToken() {
  apiToken = localStorage.getItem(TOKEN_KEY) || "";
}

export async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (apiToken) headers.set("X-Repo-Canvas-Token", apiToken);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { cache: "no-store", ...init, headers });
  const value = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(value?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.details = value;
    throw error;
  }
  return value;
}

export const canvasApi = {
  state: () => api(`/api/state?t=${Date.now()}`),
  revision: () => api(`/api/revision?t=${Date.now()}`),
  architectStatus: () => api(`/api/architect/status?t=${Date.now()}`),
  updateStatus: (force = false) => api(`/api/update/status?${force ? "refresh=1&" : ""}t=${Date.now()}`),
  saveLayout: (canvasRevision, items, layoutVersion) => api("/api/layout", { method: "POST", body: JSON.stringify({ canvasRevision, items, layoutVersion }) }),
  rename: (canvasRevision, kind, id, value) => api("/api/rename", { method: "POST", body: JSON.stringify({ canvasRevision, kind, id, value }) }),
  openWork: (canvasRevision, workId) => api("/api/sessions/open", { method: "POST", body: JSON.stringify({ canvasRevision, workId }) }),
  regenerate: () => api("/api/architect/refresh", { method: "POST", body: "{}" }),
  applyUpdate: () => api("/api/update/apply", { method: "POST", body: "{}" }),
};
