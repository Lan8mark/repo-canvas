import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType } from "@xyflow/react";

const elk = new ELK();
export const ENTITY_WIDTH = 264;
export const LAYOUT_VERSION = "react-flow-elk-v2";

const AREA_COLORS = ["#6f8fa6", "#a87969", "#7b9270", "#9a7aa8", "#b08b55", "#638f89"];

function areaColor(areaId = "") {
  let hash = 0;
  for (const character of areaId) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return AREA_COLORS[Math.abs(hash) % AREA_COLORS.length];
}

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

function hasCurrentLayout(item) {
  return item?.layoutVersion === LAYOUT_VERSION;
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

function packAreas(areas, areaLayouts, { margin = 60, gap = 110, aspect = 1.55 } = {}) {
  const rectangles = areas.map((area) => ({ id: area.id, ...areaLayouts.get(area.id) }));
  const widest = Math.max(1, ...rectangles.map((item) => item.width));
  const footprint = rectangles.reduce((sum, item) => sum + (item.width + gap) * (item.height + gap), 0);
  const targetWidth = Math.max(widest, Math.sqrt(Math.max(1, footprint) * aspect));
  const positions = new Map();
  let x = margin;
  let y = margin;
  let rowHeight = 0;

  for (const item of rectangles) {
    if (x > margin && x + item.width > margin + targetWidth) {
      x = margin;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    positions.set(item.id, { x, y });
    x += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);
  }
  return positions;
}

function aggregateAreaLinks(areaNodes, entities, relations) {
  const entityArea = new Map(entities.map((entity) => [entity.id, entity.areaId]));
  const nodeByArea = new Map(areaNodes.map((node) => [node.id.slice(5), node]));
  const groups = new Map();

  for (const relation of relations) {
    const fromArea = entityArea.get(relation.from);
    const toArea = entityArea.get(relation.to);
    if (!fromArea || !toArea || fromArea === toArea) continue;
    const [first, second] = [fromArea, toArea].sort();
    const key = `${first}:${second}`;
    const group = groups.get(key) || { first, second, relations: [] };
    group.relations.push(relation);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const sourceNode = nodeByArea.get(group.first);
    const targetNode = nodeByArea.get(group.second);
    const sourceCenter = {
      x: sourceNode.position.x + Number(sourceNode.style.width) / 2,
      y: sourceNode.position.y + Number(sourceNode.style.height) / 2,
    };
    const targetCenter = {
      x: targetNode.position.x + Number(targetNode.style.width) / 2,
      y: targetNode.position.y + Number(targetNode.style.height) / 2,
    };
    const dx = targetCenter.x - sourceCenter.x;
    const dy = targetCenter.y - sourceCenter.y;
    let sourceSide;
    let targetSide;
    if (Math.abs(dx) >= Math.abs(dy)) {
      sourceSide = dx >= 0 ? "right" : "left";
      targetSide = dx >= 0 ? "left" : "right";
    } else {
      sourceSide = dy >= 0 ? "bottom" : "top";
      targetSide = dy >= 0 ? "top" : "bottom";
    }
    return {
      id: `area-link:${group.first}:${group.second}`,
      type: "areaLink",
      source: `area:${group.first}`,
      target: `area:${group.second}`,
      sourceHandle: `area-source:${sourceSide}`,
      targetHandle: `area-target:${targetSide}`,
      data: {
        relations: group.relations,
        sourceArea: sourceNode.data.area,
        targetArea: targetNode.data.area,
      },
      selectable: false,
      zIndex: 0,
    };
  });
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

  const automaticAreas = packAreas(areas, areaLayouts);
  const areaPositions = new Map(areas.map((area) => [area.id, {
    x: hasCurrentLayout(area) && finite(area.x) ? Number(area.x) : automaticAreas.get(area.id)?.x || 60,
    y: hasCurrentLayout(area) && finite(area.y) ? Number(area.y) : automaticAreas.get(area.id)?.y || 60,
  }]));

  const areaNodes = areas.map((area) => {
    const layout = areaLayouts.get(area.id);
    const members = entities.filter((entity) => entity.areaId === area.id);
    let width = layout.width;
    let height = layout.height;
    const origin = areaPositions.get(area.id);
    for (const entity of members) {
      if (!hasCurrentLayout(entity) || !finite(entity.x) || !finite(entity.y)) continue;
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
    const position = hasCurrentLayout(entity) && finite(entity.x) && finite(entity.y)
      ? { x: Number(entity.x) - areaPosition.x, y: Number(entity.y) - areaPosition.y }
      : automatic;
    const ports = portsFor(entity, relations);
    return {
      id: entity.id,
      type: "entity",
      parentId: `area:${entity.areaId}`,
      extent: "parent",
      position,
      data: {
        entity,
        label: entityLabel(entity),
        areaLabel: areaTitle(areas.find((area) => area.id === entity.areaId)),
        areaColor: areaColor(entity.areaId),
        ...ports,
      },
      style: { width: ENTITY_WIDTH, height: entityHeight(entity, relations) },
      zIndex: 2,
    };
  });

  const entityArea = new Map(entities.map((entity) => [entity.id, entity.areaId]));

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
    className: [
      relation.status === "planned" ? "is-planned" : "",
      entityArea.get(relation.from) !== entityArea.get(relation.to) ? "is-cross-area" : "",
    ].filter(Boolean).join(" "),
    zIndex: 1,
  }));

  const areaLinks = aggregateAreaLinks(areaNodes, entities, relations);

  return { nodes: [...areaNodes, ...entityNodes], edges: [...areaLinks, ...relationEdges] };
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
