const NODE_WIDTH = 232;
const NODE_HEIGHT = 106;
const LANE_HEIGHT = 272;
const GRID_COLUMNS = 4;
const GRID_START_X = 120;
const GRID_START_Y = 170;
const GRID_STEP_X = 285;
const GRID_STEP_Y = 164;
const NODE_CLEARANCE = 22;

const STATUS_LABELS = {
  existing: "существует",
  planned: "запланировано",
  active: "в работе",
  changed: "изменено",
  done: "готово",
  blocked: "остановлено",
  rejected: "отклонено",
};

const TASK_STATUS_LABELS = {
  planned: "запланирована",
  active: "в работе",
  changed: "изменяется",
  done: "готова",
  blocked: "остановлена",
  rejected: "отклонена",
};

const ACTION_LABELS = {
  explain: "пояснить",
  correct: "скорректировать",
  stop: "остановить",
  reject: "отклонить",
  rollback: "откатить",
};

const elements = {
  viewport: document.querySelector("#viewport"),
  world: document.querySelector("#world"),
  nodeLayer: document.querySelector("#nodeLayer"),
  edgeLayer: document.querySelector("#edgeLayer"),
  taskZones: document.querySelector("#taskZones"),
  taskList: document.querySelector("#taskList"),
  taskCount: document.querySelector("#taskCount"),
  canvasTitle: document.querySelector("#canvasTitle"),
  emptyState: document.querySelector("#emptyState"),
  revisionValue: document.querySelector("#revisionValue"),
  activeValue: document.querySelector("#activeValue"),
  signalValue: document.querySelector("#signalValue"),
  connectionStatus: document.querySelector("#connectionStatus"),
  lastSync: document.querySelector("#lastSync"),
  inspectorEmpty: document.querySelector("#inspectorEmpty"),
  inspectorContent: document.querySelector("#inspectorContent"),
  selectedStatus: document.querySelector("#selectedStatus"),
  selectedActor: document.querySelector("#selectedActor"),
  selectedLabel: document.querySelector("#selectedLabel"),
  selectedPath: document.querySelector("#selectedPath"),
  selectedNote: document.querySelector("#selectedNote"),
  selectedTask: document.querySelector("#selectedTask"),
  selectedUpdated: document.querySelector("#selectedUpdated"),
  ownerNote: document.querySelector("#ownerNote"),
  destructiveAction: document.querySelector("#destructiveAction"),
  pendingCount: document.querySelector("#pendingCount"),
  pendingList: document.querySelector("#pendingList"),
  activityList: document.querySelector("#activityList"),
  toast: document.querySelector("#toast"),
};

let snapshot = null;
let selectedNodeKey = null;
let focusedTaskId = "all";
let transform = { x: 0, y: 0, scale: 1 };
let worldSize = { width: 1840, height: 920 };
let isPanning = false;
let panOrigin = null;
let hasFitOnce = false;
let knownNodes = new Set();
let toastTimer = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function relativeTime(value) {
  if (!value) return "—";
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  if (delta < 10_000) return "сейчас";
  if (delta < 60_000) return `${Math.floor(delta / 1000)} сек назад`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} мин назад`;
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status, labels = STATUS_LABELS) {
  return labels[status] || status || "—";
}

function nodeKey(node) {
  return `${node.taskId}::${node.id}`;
}

function updateTransform() {
  elements.world.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
}

function clampScale(scale) {
  return Math.min(1.5, Math.max(0.32, scale));
}

function fitView(taskId = focusedTaskId) {
  if (!snapshot?.nodes.length) return;
  const nodes = snapshot.nodes.filter((node) => taskId === "all" || node.taskId === taskId);
  if (!nodes.length) return;
  const positions = layoutNodes(snapshot.tasks, snapshot.nodes);
  const selected = nodes.map((node) => positions.get(nodeKey(node))).filter(Boolean);
  const minX = Math.min(...selected.map((position) => position.x)) - 45;
  const minY = Math.min(...selected.map((position) => position.y)) - 70;
  const maxX = Math.max(...selected.map((position) => position.x + NODE_WIDTH)) + 45;
  const maxY = Math.max(...selected.map((position) => position.y + NODE_HEIGHT)) + 60;
  const rect = elements.viewport.getBoundingClientRect();
  const scale = clampScale(Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)) * 0.93);
  transform = {
    scale,
    x: (rect.width - (maxX - minX) * scale) / 2 - minX * scale,
    y: (rect.height - (maxY - minY) * scale) / 2 - minY * scale,
  };
  updateTransform();
}

function zoomAt(nextScale, clientX, clientY) {
  const rect = elements.viewport.getBoundingClientRect();
  const pointX = clientX - rect.left;
  const pointY = clientY - rect.top;
  const worldX = (pointX - transform.x) / transform.scale;
  const worldY = (pointY - transform.y) / transform.scale;
  const scale = clampScale(nextScale);
  transform = {
    scale,
    x: pointX - worldX * scale,
    y: pointY - worldY * scale,
  };
  updateTransform();
}

function hasExplicitPosition(node) {
  return Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y));
}

function gridPosition(slot, taskOffsetY) {
  return {
    x: GRID_START_X + (slot % GRID_COLUMNS) * GRID_STEP_X,
    y: taskOffsetY + GRID_START_Y + Math.floor(slot / GRID_COLUMNS) * GRID_STEP_Y,
  };
}

function overlapsOccupied(candidate, occupied) {
  return occupied.some((position) => (
    candidate.x < position.x + NODE_WIDTH + NODE_CLEARANCE
    && candidate.x + NODE_WIDTH + NODE_CLEARANCE > position.x
    && candidate.y < position.y + NODE_HEIGHT + NODE_CLEARANCE
    && candidate.y + NODE_HEIGHT + NODE_CLEARANCE > position.y
  ));
}

function firstFreeGridPosition(occupied, taskOffsetY, preferredSlot = 0) {
  for (let offset = 0; offset < 400; offset += 1) {
    const candidate = gridPosition(preferredSlot + offset, taskOffsetY);
    if (!overlapsOccupied(candidate, occupied)) return candidate;
  }
  return gridPosition(occupied.length, taskOffsetY);
}

function layoutNodes(tasks, nodes) {
  const positions = new Map();
  const taskIds = tasks.map((task) => task.id);
  let taskOffsetY = 0;
  for (const node of nodes) {
    if (!taskIds.includes(node.taskId)) taskIds.push(node.taskId);
  }

  taskIds.forEach((taskId) => {
    const taskNodes = nodes.filter((node) => node.taskId === taskId);
    const occupied = [];
    const orderedNodes = [...taskNodes].sort((left, right) => {
      const explicitDifference = Number(hasExplicitPosition(right)) - Number(hasExplicitPosition(left));
      if (explicitDifference) return explicitDifference;
      return Number(left.order ?? Number.MAX_SAFE_INTEGER) - Number(right.order ?? Number.MAX_SAFE_INTEGER);
    });

    orderedNodes.forEach((node, nodeIndex) => {
      let candidate = hasExplicitPosition(node)
        ? { x: Number(node.x), y: taskOffsetY + Number(node.y) }
        : firstFreeGridPosition(occupied, taskOffsetY, Math.max(0, Number(node.order ?? nodeIndex + 1) - 1));

      if (overlapsOccupied(candidate, occupied)) {
        candidate = firstFreeGridPosition(occupied, taskOffsetY);
      }
      positions.set(nodeKey(node), candidate);
      occupied.push(candidate);
    });
    const taskPositions = taskNodes.map((node) => positions.get(nodeKey(node))).filter(Boolean);
    const taskBottom = taskPositions.length
      ? Math.max(...taskPositions.map((position) => position.y + NODE_HEIGHT))
      : taskOffsetY;
    taskOffsetY = Math.max(taskOffsetY + LANE_HEIGHT, taskBottom + 128);
  });

  const values = [...positions.values()];
  worldSize = {
    width: Math.max(1840, ...values.map((position) => position.x + NODE_WIDTH + 160)),
    height: Math.max(760, ...values.map((position) => position.y + NODE_HEIGHT + 170)),
  };
  elements.world.style.width = `${worldSize.width}px`;
  elements.world.style.height = `${worldSize.height}px`;
  elements.edgeLayer.setAttribute("viewBox", `0 0 ${worldSize.width} ${worldSize.height}`);
  return positions;
}

function renderTaskZones(tasks, nodes, positions) {
  elements.taskZones.innerHTML = "";
  for (const task of tasks) {
    const taskNodes = nodes.filter((node) => node.taskId === task.id);
    if (!taskNodes.length) continue;
    const taskPositions = taskNodes.map((node) => positions.get(nodeKey(node)));
    const minX = Math.min(...taskPositions.map((position) => position.x)) - 34;
    const minY = Math.min(...taskPositions.map((position) => position.y)) - 70;
    const maxX = Math.max(...taskPositions.map((position) => position.x + NODE_WIDTH)) + 34;
    const maxY = Math.max(...taskPositions.map((position) => position.y + NODE_HEIGHT)) + 38;
    const zone = document.createElement("div");
    zone.className = "task-zone";
    zone.style.left = `${minX}px`;
    zone.style.top = `${minY}px`;
    zone.style.width = `${maxX - minX}px`;
    zone.style.height = `${maxY - minY}px`;
    zone.innerHTML = `<span>${escapeHtml(task.title)} · ${escapeHtml(statusLabel(task.status || "active", TASK_STATUS_LABELS))}</span>`;
    elements.taskZones.append(zone);
  }
}

function renderEdges(edges, nodes, positions) {
  const nodeLookup = new Map(nodes.map((node) => [nodeKey(node), node]));
  elements.edgeLayer.innerHTML = "";
  for (const edge of edges) {
    const fromNode = nodeLookup.get(`${edge.taskId}::${edge.from}`);
    const toNode = nodeLookup.get(`${edge.taskId}::${edge.to}`);
    if (!fromNode || !toNode) continue;
    const from = positions.get(nodeKey(fromNode));
    const to = positions.get(nodeKey(toNode));
    let x1;
    let y1;
    let x2;
    let y2;
    let path;
    if (to.x > from.x + NODE_WIDTH + 20) {
      x1 = from.x + NODE_WIDTH;
      y1 = from.y + NODE_HEIGHT / 2;
      x2 = to.x;
      y2 = to.y + NODE_HEIGHT / 2;
      const bend = Math.max(50, Math.abs(x2 - x1) * 0.42);
      path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    } else {
      x1 = from.x + NODE_WIDTH / 2;
      y1 = from.y + NODE_HEIGHT;
      x2 = to.x + NODE_WIDTH / 2;
      y2 = to.y;
      const bend = Math.max(45, Math.abs(y2 - y1) * 0.5);
      path = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
    }
    const muted = focusedTaskId !== "all" && edge.taskId !== focusedTaskId;
    elements.edgeLayer.insertAdjacentHTML(
      "beforeend",
      `<path class="edge-path ${escapeHtml(edge.status || "planned")}" d="${path}" opacity="${muted ? "0.1" : "1"}"></path>${
        edge.label
          ? `<text class="edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 10}" text-anchor="middle" opacity="${muted ? "0.1" : "1"}">${escapeHtml(edge.label)}</text>`
          : ""
      }`,
    );
  }
}

function renderNodes(nodes, positions, directives) {
  const previousKnown = knownNodes;
  const nextKnown = new Set();
  elements.nodeLayer.innerHTML = "";

  for (const node of nodes) {
    const key = nodeKey(node);
    nextKnown.add(key);
    const position = positions.get(key);
    const hasSignal = directives.some(
      (directive) => directive.status === "pending" && directive.taskId === node.taskId && directive.targetId === node.id,
    );
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "repo-node",
      node.status || "planned",
      selectedNodeKey === key ? "is-selected" : "",
      focusedTaskId !== "all" && focusedTaskId !== node.taskId ? "is-muted" : "",
      previousKnown.size && !previousKnown.has(key) ? "is-new" : "",
    ].filter(Boolean).join(" ");
    button.style.left = `${position.x}px`;
    button.style.top = `${position.y}px`;
    button.dataset.key = key;
    button.innerHTML = `
      <span class="node-top">
        <span class="node-status">${escapeHtml(statusLabel(node.status || "planned"))}</span>
        <span class="node-agent">${escapeHtml(node.actor || "agent")}</span>
      </span>
      <strong class="node-title">${escapeHtml(node.label || node.id)}</strong>
      <span class="node-bottom">
        <span class="node-path">${escapeHtml(node.path || "без привязки к файлу")}</span>
        <i class="node-signal ${hasSignal ? "has-signal" : ""}"></i>
      </span>
    `;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedNodeKey = key;
      elements.ownerNote.value = "";
      renderAll();
    });
    elements.nodeLayer.append(button);
  }

  knownNodes = nextKnown;
}

function renderTasks(tasks) {
  elements.taskCount.textContent = String(tasks.length);
  elements.taskList.innerHTML = tasks.map((task, index) => `
    <button class="task-filter ${focusedTaskId === task.id ? "is-active" : ""}" data-task="${escapeHtml(task.id)}" type="button">
      <span class="task-index">${String(index + 1).padStart(2, "0")}</span>
      <span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.actor || "агент")} · ${escapeHtml(statusLabel(task.status || "active", TASK_STATUS_LABELS))}</small></span>
    </button>
  `).join("");
  document.querySelector('[data-task="all"]').classList.toggle("is-active", focusedTaskId === "all");
  elements.taskList.querySelectorAll(".task-filter").forEach((button) => {
    button.addEventListener("click", () => {
      focusedTaskId = button.dataset.task;
      const task = tasks.find((item) => item.id === focusedTaskId);
      elements.canvasTitle.textContent = task?.title || "Вся работа";
      renderAll();
      requestAnimationFrame(() => fitView(focusedTaskId));
    });
  });
}

function renderInspector(nodes) {
  const selected = nodes.find((node) => nodeKey(node) === selectedNodeKey);
  elements.inspectorEmpty.hidden = Boolean(selected);
  elements.inspectorContent.hidden = !selected;
  if (!selected) return;

  elements.selectedStatus.textContent = statusLabel(selected.status || "planned");
  elements.selectedActor.textContent = selected.actor || "агент";
  elements.selectedLabel.textContent = selected.label || selected.id;
  elements.selectedPath.textContent = selected.path || "без привязки к файлу";
  elements.selectedNote.textContent = selected.note || "Агент пока не оставил пояснение.";
  elements.selectedTask.textContent = selected.taskId;
  elements.selectedUpdated.textContent = relativeTime(selected.updatedAt);

  const shouldRollback = ["active", "changed", "done"].includes(selected.status);
  elements.destructiveAction.dataset.action = shouldRollback ? "rollback" : "reject";
  elements.destructiveAction.textContent = shouldRollback ? "Откатить работу" : "Отклонить план";
}

function renderPending(directives) {
  const pending = directives.filter((directive) => directive.status === "pending");
  elements.pendingCount.textContent = String(pending.length);
  elements.pendingList.innerHTML = pending.length
    ? pending.slice(0, 6).map((directive) => `
        <div class="pending-item">
          <strong>${escapeHtml(ACTION_LABELS[directive.action] || directive.action)} · ${escapeHtml(directive.targetId)}</strong>
          <span>${escapeHtml(directive.note || "Ждёт ближайшей проверки агентом")}</span>
        </div>
      `).join("")
    : '<span class="muted-copy">Нет ожидающих команд.</span>';
}

function renderActivity(activity) {
  elements.activityList.innerHTML = activity.slice(0, 18).map((item) => `
    <article class="activity-event ${escapeHtml(item.level || "info")}">
      <time>${escapeHtml(relativeTime(item.ts))} · ${escapeHtml(item.actor || "agent")}</time>
      <p>${escapeHtml(item.message)}</p>
      <small>${escapeHtml(item.taskId || "система")}</small>
    </article>
  `).join("");
}

function renderAll() {
  if (!snapshot) return;
  const positions = layoutNodes(snapshot.tasks, snapshot.nodes);
  elements.emptyState.hidden = snapshot.nodes.length > 0;
  elements.revisionValue.textContent = String(snapshot.revision);
  elements.activeValue.textContent = String(snapshot.summary.activeNodes);
  elements.signalValue.textContent = String(snapshot.summary.pendingDirectives);
  elements.lastSync.textContent = relativeTime(snapshot.updatedAt);
  renderTasks(snapshot.tasks);
  renderTaskZones(snapshot.tasks, snapshot.nodes, positions);
  renderEdges(snapshot.edges, snapshot.nodes, positions);
  renderNodes(snapshot.nodes, positions, snapshot.directives);
  renderInspector(snapshot.nodes);
  renderPending(snapshot.directives);
  renderActivity(snapshot.activity);
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

async function sendDirective(action) {
  const selected = snapshot?.nodes.find((node) => nodeKey(node) === selectedNodeKey);
  if (!selected) return;
  const note = elements.ownerNote.value.trim();
  if (action === "correct" && !note) {
    showToast("Напиши, что именно нужно скорректировать.", true);
    elements.ownerNote.focus();
    return;
  }
  if (action === "rollback" && !window.confirm(`Откатить только изменения, относящиеся к «${selected.label}»?`)) return;

  try {
    const response = await fetch("/api/directives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        note,
        taskId: selected.taskId,
        targetId: selected.id,
        targetKind: "node",
        canvasRevision: snapshot.revision,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) await pollState(true);
      throw new Error(result.error || "Не удалось отправить команду");
    }
    elements.ownerNote.value = "";
    showToast(`Команда «${ACTION_LABELS[action] || action}» отправлена · ${result.directiveId.slice(0, 18)}…`);
    await pollState(true);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function pollState(force = false) {
  try {
    const response = await fetch(`/api/state?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    elements.connectionStatus.className = "connection is-online";
    elements.connectionStatus.querySelector("span").textContent = "онлайн";
    if (force || !snapshot || next.revision !== snapshot.revision) {
      snapshot = next;
      renderAll();
      if (!hasFitOnce && snapshot.nodes.length) {
        hasFitOnce = true;
        requestAnimationFrame(() => fitView());
      }
    } else {
      elements.lastSync.textContent = relativeTime(snapshot.updatedAt);
    }
  } catch (error) {
    elements.connectionStatus.className = "connection is-offline";
    elements.connectionStatus.querySelector("span").textContent = "нет связи";
  }
}

elements.viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest(".repo-node")) return;
  event.preventDefault();
  document.getSelection()?.removeAllRanges();
  isPanning = true;
  panOrigin = { clientX: event.clientX, clientY: event.clientY, x: transform.x, y: transform.y };
  elements.viewport.classList.add("is-panning");
  elements.viewport.setPointerCapture(event.pointerId);
});

elements.viewport.addEventListener("pointermove", (event) => {
  if (!isPanning || !panOrigin) return;
  transform.x = panOrigin.x + event.clientX - panOrigin.clientX;
  transform.y = panOrigin.y + event.clientY - panOrigin.clientY;
  updateTransform();
});

function endPan() {
  if (!isPanning && !panOrigin) return;
  isPanning = false;
  panOrigin = null;
  elements.viewport.classList.remove("is-panning");
}

elements.viewport.addEventListener("pointerup", endPan);
elements.viewport.addEventListener("pointercancel", endPan);
elements.viewport.addEventListener("lostpointercapture", endPan);

elements.viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(transform.scale * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY);
}, { passive: false });

elements.viewport.addEventListener("dblclick", () => fitView());
document.querySelector("#fitView").addEventListener("click", () => fitView());
document.querySelector("#zoomIn").addEventListener("click", () => {
  const rect = elements.viewport.getBoundingClientRect();
  zoomAt(transform.scale * 1.14, rect.left + rect.width / 2, rect.top + rect.height / 2);
});
document.querySelector("#zoomOut").addEventListener("click", () => {
  const rect = elements.viewport.getBoundingClientRect();
  zoomAt(transform.scale * 0.86, rect.left + rect.width / 2, rect.top + rect.height / 2);
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => sendDirective(button.dataset.action));
});

document.querySelector('[data-task="all"]').addEventListener("click", () => {
  focusedTaskId = "all";
  elements.canvasTitle.textContent = "Вся работа";
  renderAll();
  requestAnimationFrame(() => fitView());
});

window.addEventListener("resize", () => {
  if (hasFitOnce) fitView(focusedTaskId);
});

pollState();
setInterval(() => pollState(), 1100);
