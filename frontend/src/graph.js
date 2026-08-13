import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType } from "@xyflow/react";

const elk = new ELK();
export const ENTITY_WIDTH = 264;
export const WORK_WIDTH = 220;
export const WORK_HEIGHT = 76;

export function areaTitle(area) {
  return area?.ownerTitle || area?.title || "Область";
}

export function entityLabel(entity) {
  return entity?.ownerLabel || entity?.label || "Сущность";
}

export function relationLabel(relation) {
  return relation?.ownerLabel || relation?.label || "связь";
}

export function activeWork(snapshot) {
  return (snapshot?.work || []).filter((item) => ["active", "blocked", "planned"].includes(item.status));
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function portsFor(entity, relations) {
  const incoming = relations
    .filter((relation) => relation.to === entity.id)
    .map((relation) => ({ id: relation.id, label: relationLabel(relation), peer: relation.from }));
  const outgoing = relations
    .filter((relation) => relation.from === entity.id)
    .map((relation) => ({ id: relation.id, label: relationLabel(relation), peer: relation.to }));
  return { incoming, outgoing };
}

function entityHeight(entity, relations) {
  const ports = portsFor(entity, relations);
  return Math.max(136, 76 + Math.max(ports.incoming.length, ports.outgoing.length) * 25);
}

async function layoutArea(area, entities, relations) {
  const entityIds = new Set(entities.map((entity) => entity.id));
  const internal = relations.filter((relation) => entityIds.has(relation.from) && entityIds.has(relation.to));
  const graph = await elk.layout({
    id: `layout:${area.id}`,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=92,left=44,bottom=44,right=44]",
    },
    children: entities.map((entity) => ({
      id: entity.id,
      width: ENTITY_WIDTH,
      height: entityHeight(entity, relations),
    })),
    edges: internal.map((relation) => ({ id: relation.id, sources: [relation.from], targets: [relation.to] })),
  });
  return {
    width: Math.max(420, graph.width || 420),
    height: Math.max(290, graph.height || 290),
    positions: new Map((graph.children || []).map((node) => [node.id, { x: node.x || 44, y: node.y || 92 }])),
  };
}

async function layoutAreas(areas, areaLayouts, entities, relations) {
  const entityArea = new Map(entities.map((entity) => [entity.id, entity.areaId]));
  const seenPairs = new Set();
  const edges = [];
  for (const relation of relations) {
    const source = entityArea.get(relation.from);
    const target = entityArea.get(relation.to);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    edges.push({ id: `area-edge:${key}`, sources: [source], targets: [target] });
  }
  const graph = await elk.layout({
    id: "project",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "120",
      "elk.layered.spacing.nodeNodeBetweenLayers": "180",
      "elk.padding": "[top=60,left=60,bottom=60,right=60]",
    },
    children: areas.map((area) => ({
      id: area.id,
      width: areaLayouts.get(area.id).width,
      height: areaLayouts.get(area.id).height,
    })),
    edges,
  });
  return new Map((graph.children || []).map((node) => [node.id, { x: node.x || 60, y: node.y || 60 }]));
}

function absolutePosition(node, areaPositions) {
  if (!node.parentId) return node.position;
  const parent = areaPositions.get(node.parentId.replace(/^area:/, "")) || { x: 0, y: 0 };
  return { x: parent.x + node.position.x, y: parent.y + node.position.y };
}

export async function buildGraph(snapshot) {
  const areas = snapshot.areas || [];
  const entities = snapshot.entities || [];
  const relations = snapshot.relations || [];
  const areaLayouts = new Map();

  await Promise.all(areas.map(async (area) => {
    const members = entities.filter((entity) => entity.areaId === area.id);
    areaLayouts.set(area.id, await layoutArea(area, members, relations));
  }));

  const automaticAreas = await layoutAreas(areas, areaLayouts, entities, relations);
  const areaPositions = new Map(areas.map((area) => [area.id, {
    x: finite(area.x) ? Number(area.x) : automaticAreas.get(area.id)?.x || 60,
    y: finite(area.y) ? Number(area.y) : automaticAreas.get(area.id)?.y || 60,
  }]));

  const areaNodes = areas.map((area) => {
    const layout = areaLayouts.get(area.id);
    const members = entities.filter((entity) => entity.areaId === area.id);
    let width = layout.width;
    let height = layout.height;
    const origin = areaPositions.get(area.id);
    for (const entity of members) {
      if (!finite(entity.x) || !finite(entity.y)) continue;
      width = Math.max(width, Number(entity.x) - origin.x + ENTITY_WIDTH + 44);
      height = Math.max(height, Number(entity.y) - origin.y + entityHeight(entity, relations) + 44);
    }
    return {
      id: `area:${area.id}`,
      type: "area",
      position: origin,
      data: { area, label: areaTitle(area), count: members.length },
      style: { width, height },
      selectable: true,
      draggable: true,
      zIndex: -1,
    };
  });

  const entityNodes = entities.map((entity) => {
    const areaPosition = areaPositions.get(entity.areaId) || { x: 0, y: 0 };
    const automatic = areaLayouts.get(entity.areaId)?.positions.get(entity.id) || { x: 44, y: 92 };
    const position = finite(entity.x) && finite(entity.y)
      ? { x: Number(entity.x) - areaPosition.x, y: Number(entity.y) - areaPosition.y }
      : automatic;
    const ports = portsFor(entity, relations);
    return {
      id: entity.id,
      type: "entity",
      parentId: `area:${entity.areaId}`,
      extent: "parent",
      position,
      data: { entity, label: entityLabel(entity), ...ports },
      style: { width: ENTITY_WIDTH, height: entityHeight(entity, relations) },
      zIndex: 2,
    };
  });

  const allBaseNodes = [...areaNodes, ...entityNodes];
  const nodeById = new Map(allBaseNodes.map((node) => [node.id, node]));
  const workNodes = activeWork(snapshot).map((work, index) => {
    const target = work.targets?.find((id) => nodeById.has(id));
    const targetNode = target ? nodeById.get(target) : null;
    const targetPosition = targetNode ? absolutePosition(targetNode, areaPositions) : { x: 80 + (index % 4) * 250, y: 20 };
    return {
      id: `work:${work.id}`,
      type: "work",
      position: { x: targetPosition.x + 20, y: targetPosition.y - 112 - (index % 2) * 18 },
      data: { work },
      style: { width: WORK_WIDTH, height: WORK_HEIGHT },
      draggable: false,
      zIndex: 5,
    };
  });

  const relationEdges = relations.map((relation) => ({
    id: `relation:${relation.id}`,
    type: "semantic",
    source: relation.from,
    target: relation.to,
    sourceHandle: `out:${relation.id}`,
    targetHandle: `in:${relation.id}`,
    label: relationLabel(relation),
    data: { relation },
    markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 },
    className: relation.status === "planned" ? "is-planned" : "",
    zIndex: 1,
  }));

  const workEdges = activeWork(snapshot).flatMap((work) => (work.targets || [])
    .filter((target) => nodeById.has(target))
    .map((target) => ({
      id: `work-edge:${work.id}:${target}`,
      type: "work",
      source: `work:${work.id}`,
      target,
      targetHandle: "work",
      data: { work },
      animated: work.status === "active",
      zIndex: 3,
    })));

  return { nodes: [...areaNodes, ...entityNodes, ...workNodes], edges: [...relationEdges, ...workEdges] };
}

export function neighborSet(snapshot, selectedId, direction = "all") {
  const ids = new Set(selectedId ? [selectedId] : []);
  if (!selectedId) return ids;
  for (const relation of snapshot.relations || []) {
    if ((direction === "all" || direction === "out") && relation.from === selectedId) ids.add(relation.to);
    if ((direction === "all" || direction === "in") && relation.to === selectedId) ids.add(relation.from);
  }
  return ids;
}
