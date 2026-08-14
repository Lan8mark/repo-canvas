import assert from "node:assert/strict";
import test from "node:test";

import { architectPrompt } from "../repo-canvas/scripts/architect.mjs";
import { observerPrompt } from "../repo-canvas/scripts/observer.mjs";
import { ARCHITECT_OUTPUT_SCHEMA, validateArchitecture, validateNarrativeQuality } from "../repo-canvas/scripts/semantic-model.mjs";

const emptySnapshot = { areas: [], entities: [], relations: [] };
const strongMap = {
  projectTitle: "Knowledge product", projectSummary: "People need project knowledge. The product makes it understandable.",
  areas: [{ id: "knowledge", title: "Project knowledge", goal: "A newcomer needs to understand why the project exists and what it owns.", solution: "The product presents a compact explanation of its durable responsibilities.", order: 1 }],
  entities: [{
    id: "explain-project", areaId: "knowledge", label: "Explain the project", role: "core", parentId: "", weight: 90,
    status: "operational", path: "src/explain.ts", goal: "A newcomer cannot act safely without understanding the product first.",
    solution: "The product explains its major responsibilities in one stable map.", mechanism: "Representative entry points verify each responsibility after its reason has been established.",
    invariants: ["Implementation details never become responsibilities by default."], inputs: ["repository"], outputs: ["project explanation"],
    dependsOn: [], evidence: ["src/explain.ts#explain"], covers: ["explain-project"], order: 1,
  }],
  relations: [],
  removedAreaIds: [], removedEntityIds: [], removedRelationIds: [],
};

test("Architect uses one reason-first structural pipeline instead of inventory coverage", () => {
  const prompt = architectPrompt({ snapshot: emptySnapshot, refresh: true, language: "ru" });
  assert.match(prompt, /explanatory compression, not an inventory/i);
  assert.match(prompt, /Product boundaries/);
  assert.match(prompt, /Human reasons/);
  assert.match(prompt, /compression must not erase the system's composition/i);
  assert.match(prompt, /Usually produce 6-12 entities across core and support/);
  assert.match(prompt, /state boundary, transformation or decision/i);
  assert.match(prompt, /primary end-to-end flow/i);
  assert.match(prompt, /replacing a database, framework or worker/i);
  assert.match(prompt, /durable architectural memory/i);
  assert.match(prompt, /Omission is never deletion/i);
  assert.match(prompt, /Never remove a concept merely because it was not rediscovered/i);
  assert.match(prompt, /Output language is strictly Russian/);
  assert.doesNotMatch(prompt, /Every inventory fact must be covered/);
  assert.doesNotMatch(prompt, /Separate stores, models and runtimes/);
});

test("Architect schema makes refresh removals explicit", () => {
  assert.deepEqual(ARCHITECT_OUTPUT_SCHEMA.required, ["projectTitle", "projectSummary", "areas", "entities", "relations", "removedAreaIds", "removedEntityIds", "removedRelationIds"]);
  assert.ok(ARCHITECT_OUTPUT_SCHEMA.properties.removedAreaIds);
  assert.ok(ARCHITECT_OUTPUT_SCHEMA.properties.removedEntityIds);
  assert.ok(ARCHITECT_OUTPUT_SCHEMA.properties.removedRelationIds);
});

test("narrative quality accepts a compact evidence-backed responsibility", () => {
  assert.equal(validateNarrativeQuality(strongMap), strongMap);
  assert.equal(validateArchitecture(strongMap, emptySnapshot, { refresh: true }), strongMap);
});

test("refresh preserves existing endpoints unless removal is explicit", () => {
  const snapshot = {
    areas: [{ id: "old-area" }], entities: [{ id: "old", areaId: "old-area" }], relations: [],
  };
  const evolving = { ...strongMap, relations: [{ id: "stale", from: "explain-project", to: "old", label: "keeps established context", technical: "map resolves stable concept id", status: "existing" }] };
  assert.equal(validateArchitecture(evolving, snapshot, { refresh: true }), evolving);
  assert.throws(() => validateArchitecture({ ...evolving, removedEntityIds: ["old"] }, snapshot, { refresh: true }), /Unknown relation endpoint/);
});

test("Observer preserves reason-first responsibilities and the selected language", () => {
  const prompt = observerPrompt({ turn: { sessionId: "fixture", events: [] }, final: false, snapshot: emptySnapshot, language: "en" });
  assert.match(prompt, /human-readable field strictly in English/);
  assert.match(prompt, /ordinary implementation work attaches to an existing responsibility/);
  assert.match(prompt, /independently understandable logical block in an important system flow/);
});
