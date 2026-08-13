import assert from "node:assert/strict";
import test from "node:test";
import { LAYOUT_VERSION, buildGraph } from "../frontend/src/graph.js";

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
  assert.deepEqual(source.position, { x: 44, y: 92 });
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
