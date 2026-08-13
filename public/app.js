import { anchoredZoomTransform, captionAwareDetour, chooseFloatingCaption, connectionAnchors, crossAreaDetour, packAreaRectangles, paddedBox, relationCurve, sampleRelationCurve } from "./canvas-layout.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  areaValue: $("#areaValue"), entityValue: $("#entityValue"), activeValue: $("#activeValue"),
  connection: $("#connectionStatus"), projectCount: $("#projectCount"), projectTree: $("#projectTree"),
  allProject: $("#allProject"), passport: $("#passport"), passportArea: $("#passportArea"),
  passportTitle: $("#passportTitle"), passportPurpose: $("#passportPurpose"), passportFacts: $("#passportFacts"),
  closePassport: $("#closePassport"), nowCount: $("#nowCount"), nowList: $("#nowList"),
  activityList: $("#activityList"), lastSync: $("#lastSync"), canvasTitle: $("#canvasTitle"),
  viewport: $("#viewport"), world: $("#world"), areaLayer: $("#areaLayer"), edgeLayer: $("#edgeLayer"),
  entityLayer: $("#entityLayer"), workLayer: $("#workLayer"), emptyState: $("#emptyState"), toast: $("#toast"),
};

const ENTITY_W = 244;
const ENTITY_H = 122;
const WORK_W = 196;
const WORK_H = 66;
const AREA_W = 850;
const AREA_GAP = 150;
const ENTITY_STEP_X = 304;
const ENTITY_STEP_Y = 276;
let snapshot = null;
let selectedArea = "all";
let selectedEntity = null;
let transform = { x: 0, y: 0, scale: 1 };
let worldSize = { width: 1800, height: 1000 };
let pan = null;
let fitDone = false;
let toastTimer = null;
let relationCaptions = [];
let relationObstacles = [];
let relationCaptionFrame = null;
let relationCaptionLastFrame = -Infinity;
let currentLayout = null;
let layoutDrag = null;
let layoutSaving = false;
let suppressEntityClickUntil = 0;
const RELATION_CAPTION_FRAME_MS = 1000 / 60;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function relativeTime(value) {
  if (!value) return "—";
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  if (delta < 10_000) return "сейчас";
  if (delta < 60_000) return `${Math.floor(delta / 1000)} сек`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} мин`;
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function activeWork() {
  return (snapshot?.work || []).filter((item) => ["active", "blocked", "planned"].includes(item.status));
}

function layout() {
  const areas = snapshot.areas || [];
  const entityPositions = new Map();
  const areaSpecs = areas.map((area) => {
    const entities = snapshot.entities.filter((entity) => entity.areaId === area.id);
    const requestedWidth = Number(area.width);
    const columns = Number.isFinite(requestedWidth)
      ? Math.max(1, Math.floor((requestedWidth - 70) / ENTITY_STEP_X))
      : Math.max(3, Math.ceil(Math.sqrt(Math.max(1, entities.length) * 1.35)));
    const rows = Math.max(1, Math.ceil(entities.length / columns));
    const contentWidth = Math.max(AREA_W, 70 + columns * ENTITY_STEP_X);
    const contentHeight = Math.max(400, 150 + rows * ENTITY_STEP_Y);
    return {
      id: area.id,
      x: area.x,
      y: area.y,
      width: Number.isFinite(requestedWidth) ? Math.max(requestedWidth, contentWidth) : contentWidth,
      height: Number.isFinite(Number(area.height)) ? Math.max(Number(area.height), contentHeight) : contentHeight,
      columns,
      entities,
    };
  });
  const entitiesById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const pairCounts = new Map();
  for (const relation of snapshot.relations || []) {
    const sourceArea = entitiesById.get(relation.from)?.areaId;
    const targetArea = entitiesById.get(relation.to)?.areaId;
    if (!sourceArea || !targetArea || sourceArea === targetArea) continue;
    const key = [sourceArea, targetArea].sort().join("::");
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  const densestCorridor = Math.max(0, ...pairCounts.values());
  const adaptiveAreaGap = Math.max(AREA_GAP, 92 + densestCorridor * 38);
  const areaPositions = packAreaRectangles(areaSpecs, { gap: adaptiveAreaGap });
  for (const spec of areaSpecs) {
    const areaPosition = areaPositions.get(spec.id);
    const { x, y } = areaPosition;
    spec.entities.forEach((entity, slot) => {
      const ex = Number.isFinite(Number(entity.x)) ? Number(entity.x) : x + 48 + (slot % spec.columns) * ENTITY_STEP_X;
      const ey = Number.isFinite(Number(entity.y)) ? Number(entity.y) : y + 102 + Math.floor(slot / spec.columns) * ENTITY_STEP_Y;
      entityPositions.set(entity.id, { x: ex, y: ey });
    });
  }
  const workPositions = new Map();
  const targetCounters = new Map();
  activeWork().forEach((item) => {
    const target = item.targets?.find((id) => entityPositions.has(id));
    if (!target) return;
    const base = entityPositions.get(target);
    const count = targetCounters.get(target) || 0;
    targetCounters.set(target, count + 1);
    workPositions.set(item.id, { x: base.x + 24 + (count % 2) * 208, y: base.y + ENTITY_H + 18 + Math.floor(count / 2) * 78 });
  });
  worldSize = {
    width: Math.max(1000, ...[...areaPositions.values()].map((p) => p.x + p.width + 70)),
    height: Math.max(720, ...[...areaPositions.values()].map((p) => p.y + p.height + 80)),
  };
  elements.world.style.width = `${worldSize.width}px`;
  elements.world.style.height = `${worldSize.height}px`;
  elements.edgeLayer.setAttribute("viewBox", `0 0 ${worldSize.width} ${worldSize.height}`);
  currentLayout = { areaPositions, entityPositions, workPositions };
  return currentLayout;
}

function center(position, width = ENTITY_W, height = ENTITY_H) { return { x: position.x + width / 2, y: position.y + height / 2 }; }
function renderAreas(positions) {
  elements.areaLayer.innerHTML = "";
  snapshot.areas.forEach((area) => {
    const p = positions.get(area.id);
    const section = document.createElement("section");
    section.className = `project-area ${selectedArea !== "all" && selectedArea !== area.id ? "is-muted" : ""}`;
    section.dataset.areaId = area.id;
    section.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px`;
    section.innerHTML = `<header title="Перетащить всю область"><small>ОБЛАСТЬ ПРОЕКТА</small><h2>${escapeHtml(area.title)}</h2><p>${escapeHtml(area.note || "")}</p></header>`;
    section.querySelector("header").addEventListener("pointerdown", (event) => beginLayoutDrag(event, "area", area.id));
    elements.areaLayer.append(section);
  });
}

function renderRelations(areaPositions, entityPositions, workPositions) {
  const occupied = [];
  const captionDefinitions = [];
  for (const position of areaPositions.values()) {
    const header = { x: position.x + 18, y: position.y + 14, width: Math.min(position.width - 36, 560), height: 86 };
    occupied.push(header);
  }
  for (const position of entityPositions.values()) occupied.push(paddedBox(position, ENTITY_W, ENTITY_H, 10));
  for (const position of workPositions.values()) occupied.push(paddedBox(position, WORK_W, WORK_H, 8));

  const parts = ["<g>"];
  const entitiesById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const corridorCounters = new Map();
  const localCounters = new Map();
  for (const [relationIndex, relation] of (snapshot.relations || []).entries()) {
    const a = entityPositions.get(relation.from); const b = entityPositions.get(relation.to);
    if (!a || !b) continue;
    const sourceEntity = entitiesById.get(relation.from); const targetEntity = entitiesById.get(relation.to);
    const muted = selectedArea !== "all" && ![sourceEntity, targetEntity].some((entity) => entity?.areaId === selectedArea);
    const width = relation.label ? Math.min(190, Math.max(48, String(relation.label).length * 5.2 + 18)) : 0;
    const crossArea = sourceEntity?.areaId !== targetEntity?.areaId;
    const routeKey = crossArea
      ? [sourceEntity?.areaId, targetEntity?.areaId].sort().join("::")
      : [relation.from, relation.to].sort().join("::");
    const counters = crossArea ? corridorCounters : localCounters;
    const routeIndex = counters.get(routeKey) || 0;
    counters.set(routeKey, routeIndex + 1);
    const routeLane = routeIndex * 38;
    const corridorOffset = routeIndex === 0 ? 0 : (routeIndex % 2 ? -1 : 1) * Math.ceil(routeIndex / 2) * 38;
    const areaDetour = sourceEntity?.areaId !== targetEntity?.areaId
      ? crossAreaDetour(a, b, areaPositions.get(sourceEntity?.areaId), areaPositions.get(targetEntity?.areaId), {
        width: ENTITY_W, height: ENTITY_H, lane: routeLane, corridorOffset,
      })
      : null;
    const detour = areaDetour || (relation.label ? captionAwareDetour(a, b, width, {
      width: ENTITY_W, height: ENTITY_H, lane: routeLane,
    }) : null);
    const { from, to } = detour || connectionAnchors(a, b, ENTITY_W, ENTITY_H);
    const laneOffsets = [0, -34, 34, -68, 68];
    const geometry = relationCurve(from, to, {
      laneOffset: laneOffsets[relationIndex % laneOffsets.length],
      waypoints: detour?.waypoints,
    });
    parts.push(`<path class="relation ${relation.status} ${muted ? "is-muted" : ""}" d="${geometry.d}"><title>${escapeHtml(relation.label || `${relation.from} → ${relation.to}`)}</title></path>`);
    if (relation.label) {
      const height = 22;
      const captionIndex = captionDefinitions.length;
      const samples = sampleRelationCurve(geometry);
      const xs = samples.map((point) => point.x); const ys = samples.map((point) => point.y);
      captionDefinitions.push({
        samples, currentProgress: .5, width, height, muted,
        bounds: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
      });
      parts.push(`<g data-relation-caption="${captionIndex}" class="relation-caption ${muted ? "is-muted" : ""}" hidden><rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="11"></rect><text>${escapeHtml(relation.label)}</text></g>`);
    }
  }
  for (const item of activeWork()) {
    const wp = workPositions.get(item.id); if (!wp) continue;
    for (const target of item.targets || []) {
      const ep = entityPositions.get(target); if (!ep) continue;
      const from = center(ep); const to = center(wp, WORK_W, WORK_H);
      parts.push(`<path class="work-link ${item.status}" d="M ${from.x} ${from.y + 36} C ${from.x} ${to.y}, ${to.x} ${from.y + 50}, ${to.x} ${to.y}"></path>`);
    }
  }
  parts.push("</g>");
  elements.edgeLayer.innerHTML = parts.join("");
  relationObstacles = occupied;
  relationCaptions = captionDefinitions.map((definition, index) => ({
    ...definition,
    element: elements.edgeLayer.querySelector(`[data-relation-caption="${index}"]`),
  }));
  scheduleRelationCaptionUpdate();
}

function updateFloatingRelationCaptions(timestamp = performance.now()) {
  if (timestamp - relationCaptionLastFrame < RELATION_CAPTION_FRAME_MS - .5) {
    relationCaptionFrame = requestAnimationFrame(updateFloatingRelationCaptions);
    return;
  }
  relationCaptionFrame = null;
  relationCaptionLastFrame = timestamp;
  if (!relationCaptions.length || !transform.scale) return;
  const rect = elements.viewport.getBoundingClientRect();
  const padding = 12 / transform.scale;
  const viewport = {
    x: -transform.x / transform.scale + padding,
    y: -transform.y / transform.scale + padding,
    width: Math.max(0, rect.width / transform.scale - padding * 2),
    height: Math.max(0, rect.height / transform.scale - padding * 2),
  };
  const captionBoxes = [];
  const setHidden = (element, hidden) => {
    if (hidden && !element.hasAttribute("hidden")) element.setAttribute("hidden", "");
    if (!hidden && element.hasAttribute("hidden")) element.removeAttribute("hidden");
  };
  for (const caption of relationCaptions) {
    if (caption.muted && selectedArea !== "all") {
      setHidden(caption.element, true);
      continue;
    }
    const outsideViewport = caption.bounds.x > viewport.x + viewport.width
      || caption.bounds.x + caption.bounds.width < viewport.x
      || caption.bounds.y > viewport.y + viewport.height
      || caption.bounds.y + caption.bounds.height < viewport.y;
    if (outsideViewport) {
      setHidden(caption.element, true);
      continue;
    }
    const placement = chooseFloatingCaption({
      samples: caption.samples,
      currentProgress: caption.currentProgress,
      width: caption.width,
      height: caption.height,
      viewport,
      obstacles: relationObstacles,
      occupied: captionBoxes,
    });
    if (!placement) {
      setHidden(caption.element, true);
      continue;
    }
    caption.currentProgress = placement.progress;
    captionBoxes.push(placement.box);
    setHidden(caption.element, false);
    const nextTransform = `translate(${placement.x} ${placement.y}) rotate(${placement.angle})`;
    if (caption.element.getAttribute("transform") !== nextTransform) caption.element.setAttribute("transform", nextTransform);
  }
}

function scheduleRelationCaptionUpdate() {
  if (relationCaptionFrame !== null) return;
  relationCaptionFrame = requestAnimationFrame(updateFloatingRelationCaptions);
}

function renderEntities(positions) {
  const activeIds = new Set(snapshot.activeEntityIds || []);
  elements.entityLayer.innerHTML = "";
  snapshot.entities.forEach((entity) => {
    const p = positions.get(entity.id); if (!p) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.entityId = entity.id;
    button.dataset.areaId = entity.areaId;
    button.className = `project-entity ${entity.status} ${activeIds.has(entity.id) ? "has-active-work" : ""} ${selectedArea !== "all" && selectedArea !== entity.areaId ? "is-muted" : ""}`;
    button.style.cssText = `left:${p.x}px;top:${p.y}px`;
    button.innerHTML = `<span class="entity-state">${entity.status === "problem" ? "ПРОБЛЕМА" : entity.status === "disabled" ? "ОТКЛЮЧЕНО" : entity.status === "planned" ? "ПЛАН" : "РАБОТАЕТ"}</span><strong>${escapeHtml(entity.label)}</strong><small>${escapeHtml(entity.path || entity.purpose || "смысловая сущность")}</small><i></i>`;
    button.addEventListener("pointerdown", (event) => beginLayoutDrag(event, "entity", entity.id));
    button.addEventListener("click", (event) => { event.stopPropagation(); if (performance.now() >= suppressEntityClickUntil) showPassport(entity); });
    elements.entityLayer.append(button);
  });
}

function renderWork(positions) {
  elements.workLayer.innerHTML = "";
  activeWork().forEach((item) => {
    const p = positions.get(item.id); if (!p) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `work-satellite ${item.status} ${item.session ? "has-session" : ""}`;
    button.style.cssText = `left:${p.x}px;top:${p.y}px`;
    button.title = item.session ? "Двойной клик: открыть рабочую сессию" : "Рабочая сессия не привязана";
    button.innerHTML = `<i></i><span><small>${escapeHtml(item.actor || "agent")} · ${item.status === "active" ? "В РАБОТЕ" : item.status === "blocked" ? "ЖДЁТ" : "ПЛАН"}</small><strong>${escapeHtml(item.title)}</strong></span><b>↗</b>`;
    button.addEventListener("click", (event) => event.stopPropagation());
    button.addEventListener("dblclick", async (event) => { event.preventDefault(); event.stopPropagation(); await openWork(item); });
    elements.workLayer.append(button);
  });
}

function renderTree() {
  elements.projectCount.textContent = String(snapshot.entities.length);
  elements.projectTree.innerHTML = snapshot.areas.map((area) => {
    const entities = snapshot.entities.filter((entity) => entity.areaId === area.id);
    return `<section class="tree-area"><button data-area="${escapeHtml(area.id)}" class="${selectedArea === area.id ? "is-active" : ""}" type="button"><span><strong>${escapeHtml(area.title)}</strong><small>${entities.length} сущностей</small></span><b>›</b></button><div>${entities.map((entity) => `<button data-entity="${escapeHtml(entity.id)}" type="button"><i class="${escapeHtml(entity.status)}"></i>${escapeHtml(entity.label)}</button>`).join("")}</div></section>`;
  }).join("");
  elements.projectTree.querySelectorAll("[data-area]").forEach((button) => button.addEventListener("click", () => selectArea(button.dataset.area)));
  elements.projectTree.querySelectorAll("[data-entity]").forEach((button) => button.addEventListener("click", () => showPassport(snapshot.entities.find((item) => item.id === button.dataset.entity))));
}

function showPassport(entity) {
  if (!entity) return;
  selectedEntity = entity.id;
  const area = snapshot.areas.find((item) => item.id === entity.areaId);
  const works = activeWork().filter((item) => item.targets?.includes(entity.id));
  elements.passport.hidden = false;
  elements.passportArea.textContent = area?.title || "СУЩНОСТЬ";
  elements.passportTitle.textContent = entity.label;
  elements.passportPurpose.textContent = entity.purpose || entity.note || "Краткое назначение ещё не описано.";
  const facts = [
    ["Вход", (entity.inputs || []).join(", ") || "—"], ["Результат", (entity.outputs || []).join(", ") || "—"],
    ["Зависит от", (entity.dependsOn || []).join(", ") || "—"], ["Путь", entity.path || "—"],
    ["Сейчас", works.map((item) => item.title).join(", ") || "нет активных задач"],
  ];
  elements.passportFacts.innerHTML = facts.map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function renderNow() {
  const items = activeWork();
  elements.nowCount.textContent = String(items.length);
  elements.nowList.innerHTML = items.length ? items.map((item) => {
    const targets = (item.targets || []).map((id) => snapshot.entities.find((entity) => entity.id === id)?.label).filter(Boolean).join(" · ");
    return `<button data-work="${escapeHtml(item.id)}" class="${escapeHtml(item.status)}" type="button"><i></i><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.actor || "agent")} · ${escapeHtml(targets)}</small></span></button>`;
  }).join("") : `<p class="empty-copy">Активной работы нет.</p>`;
  elements.nowList.querySelectorAll("[data-work]").forEach((button) => button.addEventListener("dblclick", () => openWork(items.find((item) => item.id === button.dataset.work))));
}

function renderActivity() {
  const relevant = (snapshot.activity || []).filter((item) => ["area.upsert", "entity.upsert", "relation.upsert", "work.upsert", "activity.log"].includes(item.type)).slice(0, 7);
  elements.activityList.innerHTML = relevant.map((item) => `<article class="${escapeHtml(item.level)}"><i></i><span><small>${escapeHtml(relativeTime(item.ts))} · ${escapeHtml(item.actor || "agent")}</small><p>${escapeHtml(item.message)}</p></span></article>`).join("");
}

function render() {
  const positions = layout();
  elements.areaValue.textContent = String(snapshot.areas.length);
  elements.entityValue.textContent = String(snapshot.entities.length);
  elements.activeValue.textContent = String(snapshot.summary.activeWork || 0);
  elements.lastSync.textContent = relativeTime(snapshot.updatedAt);
  elements.emptyState.hidden = snapshot.semantic;
  renderAreas(positions.areaPositions); renderRelations(positions.areaPositions, positions.entityPositions, positions.workPositions);
  renderEntities(positions.entityPositions); renderWork(positions.workPositions); renderTree(); renderNow(); renderActivity();
}

function selectArea(id) {
  selectedArea = id;
  elements.allProject.classList.toggle("is-active", id === "all");
  elements.canvasTitle.textContent = id === "all" ? "Весь проект" : snapshot.areas.find((area) => area.id === id)?.title || "Область";
  render();
  requestAnimationFrame(fitView);
}

function updateTransform() {
  const pixelRatio = window.devicePixelRatio || 1;
  const crispX = Math.round(transform.x * pixelRatio) / pixelRatio;
  const crispY = Math.round(transform.y * pixelRatio) / pixelRatio;
  elements.world.style.zoom = String(transform.scale);
  elements.world.style.transform = `translate(${crispX / transform.scale}px, ${crispY / transform.scale}px)`;
  scheduleRelationCaptionUpdate();
}
function zoomAt(clientX, clientY, factor) {
  const rect = elements.viewport.getBoundingClientRect();
  const nextScale = Math.min(1.5, Math.max(.015, transform.scale * factor));
  transform = anchoredZoomTransform(transform, nextScale, { x: clientX - rect.left, y: clientY - rect.top });
  updateTransform();
}
function zoomAtViewportCenter(factor) {
  const rect = elements.viewport.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
}
function fitView() {
  const rect = elements.viewport.getBoundingClientRect();
  const area = selectedArea === "all" ? null : snapshot.areas.find((item) => item.id === selectedArea);
  const positions = layout().areaPositions;
  const box = area ? positions.get(area.id) : { x: 0, y: 0, width: worldSize.width, height: worldSize.height };
  const scale = Math.min(1.2, Math.max(.015, Math.min(rect.width / (box.width + 90), rect.height / (box.height + 90)) * .94));
  transform = { scale, x: (rect.width - box.width * scale) / 2 - box.x * scale, y: (rect.height - box.height * scale) / 2 - box.y * scale };
  updateTransform();
}

function showToast(message, error = false) {
  clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.className = `toast is-visible ${error ? "is-error" : ""}`;
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 3500);
}

function dragElements(kind, id) {
  if (kind === "entity") return [...elements.entityLayer.querySelectorAll(`[data-entity-id="${CSS.escape(id)}"]`)];
  return [
    ...elements.areaLayer.querySelectorAll(`[data-area-id="${CSS.escape(id)}"]`),
    ...elements.entityLayer.querySelectorAll(`[data-area-id="${CSS.escape(id)}"]`),
  ];
}

function beginLayoutDrag(event, kind, id) {
  if (event.button !== 0 || layoutSaving || !currentLayout) return;
  event.preventDefault(); event.stopPropagation();
  const sourcePositions = kind === "area"
    ? [
      { kind: "area", id, ...currentLayout.areaPositions.get(id) },
      ...snapshot.entities.filter((entity) => entity.areaId === id).map((entity) => ({ kind: "entity", id: entity.id, ...currentLayout.entityPositions.get(entity.id) })),
    ]
    : [{ kind: "entity", id, ...currentLayout.entityPositions.get(id) }];
  layoutDrag = { kind, id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, sourcePositions, elements: dragElements(kind, id), capture: event.currentTarget };
  layoutDrag.capture.setPointerCapture(event.pointerId);
  layoutDrag.elements.forEach((element) => element.classList.add("is-layout-dragging"));
}

function moveLayoutDrag(event) {
  if (!layoutDrag || event.pointerId !== layoutDrag.pointerId) return;
  const dx = (event.clientX - layoutDrag.startX) / transform.scale;
  const dy = (event.clientY - layoutDrag.startY) / transform.scale;
  layoutDrag.moved ||= Math.hypot(event.clientX - layoutDrag.startX, event.clientY - layoutDrag.startY) > 4;
  if (!layoutDrag.moved) return;
  const preview = `translate(${dx}px, ${dy}px)`;
  layoutDrag.elements.forEach((element) => { element.style.transform = preview; });
}

async function endLayoutDrag(event) {
  if (!layoutDrag || event.pointerId !== layoutDrag.pointerId) return;
  const drag = layoutDrag; layoutDrag = null;
  drag.elements.forEach((element) => { element.classList.remove("is-layout-dragging"); element.style.transform = ""; });
  if (!drag.moved) return;
  suppressEntityClickUntil = performance.now() + 250;
  const dx = (event.clientX - drag.startX) / transform.scale;
  const dy = (event.clientY - drag.startY) / transform.scale;
  const items = drag.sourcePositions.map((item) => ({ kind: item.kind, id: item.id, x: item.x + dx, y: item.y + dy }));
  for (const item of items) {
    const target = item.kind === "area" ? snapshot.areas.find((area) => area.id === item.id) : snapshot.entities.find((entity) => entity.id === item.id);
    if (target) { target.x = item.x; target.y = item.y; }
  }
  render();
  layoutSaving = true;
  try {
    const response = await fetch("/api/layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canvasRevision: snapshot.revision, items }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось сохранить раскладку");
    snapshot.revision = result.revision;
    showToast(drag.kind === "area" ? "Область и её ноды перемещены" : "Положение ноды сохранено");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    layoutSaving = false;
    await poll(true);
  }
}

async function openWork(item) {
  if (!item?.session) return showToast("Агент не привязал рабочую сессию к этой задаче.", true);
  try {
    const response = await fetch("/api/sessions/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workId: item.id, canvasRevision: snapshot.revision }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось открыть сессию");
    if (result.outcome === "resume") {
      await navigator.clipboard.writeText(result.command).catch(() => {});
      showToast(`${result.label}: команда resume скопирована — ${result.command}`);
    } else if (result.outcome === "surface-opened") showToast("Kimi Work открыт. Выберите указанный диалог по названию.");
    else showToast(`${result.label}: открываю «${result.title || item.title}».`);
  } catch (error) { showToast(error.message, true); }
}

async function poll(force = false) {
  if (layoutDrag || layoutSaving) return;
  try {
    if (!force && snapshot) {
      const revisionResponse = await fetch(`/api/revision?t=${Date.now()}`, { cache: "no-store" });
      if (!revisionResponse.ok) throw new Error(`HTTP ${revisionResponse.status}`);
      const revision = await revisionResponse.json();
      if (revision.revision === snapshot.revision) {
        elements.connection.className = "connection is-online"; elements.connection.querySelector("b").textContent = "онлайн";
        elements.lastSync.textContent = relativeTime(snapshot.updatedAt);
        return;
      }
    }
    const response = await fetch(`/api/state?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    elements.connection.className = "connection is-online"; elements.connection.querySelector("b").textContent = "онлайн";
    if (force || !snapshot || next.revision !== snapshot.revision) { snapshot = next; render(); if (!fitDone && snapshot.semantic) { fitDone = true; requestAnimationFrame(fitView); } }
    else elements.lastSync.textContent = relativeTime(snapshot.updatedAt);
  } catch { elements.connection.className = "connection is-offline"; elements.connection.querySelector("b").textContent = "нет связи"; }
}

elements.allProject.addEventListener("click", () => selectArea("all"));
elements.closePassport.addEventListener("click", () => { selectedEntity = null; elements.passport.hidden = true; });
$("#fitView").addEventListener("click", fitView);
$("#zoomIn").addEventListener("click", () => zoomAtViewportCenter(1.16));
$("#zoomOut").addEventListener("click", () => zoomAtViewportCenter(1 / 1.16));
elements.viewport.addEventListener("wheel", (event) => { event.preventDefault(); zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? .9 : 1.1); }, { passive: false });
elements.viewport.addEventListener("pointerdown", (event) => { if (event.button !== 0 || event.target.closest("button")) return; window.getSelection()?.removeAllRanges(); pan = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y }; elements.viewport.setPointerCapture(event.pointerId); elements.viewport.classList.add("is-panning"); });
elements.viewport.addEventListener("pointermove", (event) => { if (!pan) return; transform.x = pan.tx + event.clientX - pan.x; transform.y = pan.ty + event.clientY - pan.y; updateTransform(); });
function endPan() { pan = null; elements.viewport.classList.remove("is-panning"); }
elements.viewport.addEventListener("pointerup", endPan); elements.viewport.addEventListener("pointercancel", endPan); elements.viewport.addEventListener("lostpointercapture", endPan);
elements.world.addEventListener("pointermove", moveLayoutDrag);
elements.world.addEventListener("pointerup", endLayoutDrag);
elements.world.addEventListener("pointercancel", endLayoutDrag);
window.addEventListener("resize", () => { if (snapshot?.semantic) fitView(); });
poll(true); setInterval(poll, 250);
