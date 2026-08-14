import assert from "node:assert/strict";
import test from "node:test";
import { focusColumnOffset, orthogonalRelationPath, relationLabelWidth } from "../frontend/src/edge-routing.js";
import { LAYOUT_VERSION, buildGraph, entityContentHeight, entityWidth } from "../frontend/src/graph.js";

function snapshot(overrides = {}) {
  return {
    areas: [
      { id: "alpha", title: "Alpha", x: 0, y: 0 },
      { id: "beta", title: "Beta", x: 0, y: 0 },
    ],
    entities: [
      { id: "source", areaId: "alpha", label: "Source", status: "operational", x: 999, y: 999 },
      { id: "target", areaId: "beta", label: "Target", status: "operational", x: 999, y: 999 },
    ],
    relations: [{ id: "flow", from: "source", to: "target", label: "feeds", status: "existing" }],
    work: [{ id: "session", title: "Current work", status: "active", targets: ["source"] }],
    activeEntityIds: ["source"],
    ...overrides,
  };
}

test("React Flow layout ignores legacy coordinates and packs areas without work-card clutter", async () => {
  const graph = await buildGraph(snapshot({
    relations: [
      { id: "flow", from: "source", to: "target", label: "feeds", status: "existing" },
      { id: "flow-back", from: "target", to: "source", label: "reports", status: "existing" },
    ],
  }));
  const alpha = graph.nodes.find((node) => node.id === "area:alpha");
  const beta = graph.nodes.find((node) => node.id === "area:beta");
  const source = graph.nodes.find((node) => node.id === "source");

  assert.notDeepEqual(alpha.position, beta.position);
  assert.deepEqual(source.position, { x: 44, y: 120 });
  assert.equal(source.data.areaLabel, "Alpha");
  assert.match(source.data.areaColor, /^#[0-9a-f]{6}$/i);
  assert.equal(graph.nodes.some((node) => node.type === "work"), false);
  assert.equal(graph.edges.filter((edge) => edge.type === "areaLink").length, 1);
  assert.equal(graph.edges.find((edge) => edge.type === "areaLink").data.relations.length, 2);
  assert.match(graph.edges.find((edge) => edge.type === "semantic").className, /is-cross-area/);
});

test("React Flow layout preserves coordinates written by its own layout version", async () => {
  const current = snapshot({
    areas: [
      { id: "alpha", title: "Alpha", x: 200, y: 300, layoutVersion: LAYOUT_VERSION },
      { id: "beta", title: "Beta" },
    ],
    entities: [
      { id: "source", areaId: "alpha", label: "Source", status: "operational", x: 260, y: 410, layoutVersion: LAYOUT_VERSION },
      { id: "target", areaId: "beta", label: "Target", status: "operational" },
    ],
  });
  const graph = await buildGraph(current);

  assert.deepEqual(graph.nodes.find((node) => node.id === "area:alpha").position, { x: 200, y: 300 });
  assert.deepEqual(graph.nodes.find((node) => node.id === "source").position, { x: 60, y: 110 });
});

test("focused relation routing reserves a straight caption runway", () => {
  const label = "publishes typed operation contracts";
  const offset = focusColumnOffset([{ label }]);
  const route = orthogonalRelationPath({
    sourceX: 264,
    sourceY: 80,
    targetX: offset,
    targetY: 240,
    label,
  });

  assert.match(route.path, /^M .* H .* V .* H .* V .* H /);
  assert.ok(route.runway >= relationLabelWidth(label) + 24);
  assert.equal(route.labelY, 160);
});

function segmentCrossesRectangle(from, to, rectangle) {
  if (from.y === to.y) {
    return from.y > rectangle.y && from.y < rectangle.y + rectangle.height
      && Math.max(from.x, to.x) > rectangle.x && Math.min(from.x, to.x) < rectangle.x + rectangle.width;
  }
  return from.x > rectangle.x && from.x < rectangle.x + rectangle.width
    && Math.max(from.y, to.y) > rectangle.y && Math.min(from.y, to.y) < rectangle.y + rectangle.height;
}

test("semantic relation routing detours around unrelated cards", () => {
  const obstacle = { x: 190, y: 40, width: 120, height: 120 };
  const route = orthogonalRelationPath({
    sourceX: 0,
    sourceY: 100,
    targetX: 500,
    targetY: 100,
    label: "cross-card relation",
    obstacles: [obstacle],
  });

  assert.ok(route.points.length > 2);
  for (let index = 1; index < route.points.length; index += 1) {
    assert.equal(segmentCrossesRectangle(route.points[index - 1], route.points[index], obstacle), false);
  }
});

test("semantic relation routing clears multiple staggered cards", () => {
  const obstacles = [
    { x: 150, y: 40, width: 90, height: 120 },
    { x: 285, y: -40, width: 90, height: 120 },
  ];
  const route = orthogonalRelationPath({
    sourceX: 0,
    sourceY: 100,
    targetX: 520,
    targetY: 20,
    label: "multi-card relation",
    obstacles,
  });

  for (let index = 1; index < route.points.length; index += 1) {
    for (const obstacle of obstacles) {
      assert.equal(segmentCrossesRectangle(route.points[index - 1], route.points[index], obstacle), false);
    }
  }
});

test("entity cards grow with complete narrative copy", () => {
  const short = entityContentHeight({ label: "Short", problem: "Short problem", solution: "Short solution" });
  const long = entityContentHeight({
    label: "A deliberately multiline but still bounded card title",
    problem: "A long problem statement ".repeat(12),
    solution: "A long complete solution statement ".repeat(12),
    mechanism: "A technical mechanism with enough evidence to wrap across several lines ".repeat(8),
    invariants: ["A complete invariant that must remain visible without an ellipsis ".repeat(5)],
    path: "src/a/very/long/implementation/path/that/must/wrap/instead/of/disappearing.ts",
  });

  assert.equal(short, 206);
  assert.ok(long > short + 150);
});

test("card footprint follows product importance inside the hierarchy", () => {
  assert.ok(entityWidth({ role: "core", weight: 96 }) > entityWidth({ role: "core", weight: 72 }));
  assert.ok(entityWidth({ role: "core", weight: 72 }) > entityWidth({ role: "support", weight: 60 }));
  assert.ok(entityWidth({ role: "support", weight: 60 }) > entityWidth({ role: "detail", weight: 25 }));
});
