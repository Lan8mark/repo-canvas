import assert from "node:assert/strict";
import test from "node:test";

import { architectPrompt, auditPrompt, inventoryPrompt, validateInventoryCoverage } from "../repo-canvas/scripts/architect.mjs";
import { validateNarrativeQuality } from "../repo-canvas/scripts/semantic-model.mjs";

const strongMap = {
  areas: [{
    id: "search", title: "Find project knowledge",
    goal: "A newcomer must find relevant project knowledge without knowing its exact internal name.",
    solution: "The project exposes one searchable representation of its code and durable knowledge.", order: 1,
  }],
  entities: [{
    id: "hybrid-search", areaId: "search", label: "Hybrid search", role: "core", parentId: "", weight: 90,
    status: "operational", path: "src/search.ts",
    goal: "Find relevant information from either exact words or a plain-language description.",
    solution: "One query combines exact, structural and semantic candidates into an explained result.",
    mechanism: "The search service merges BM25, filters and vector retrieval into one ranked response.",
    invariants: ["Every result retains the channels that caused it to rank."],
    inputs: ["query"], outputs: ["ranked results"], dependsOn: [], evidence: ["src/search.ts#search"], covers: ["search"], order: 1,
  }],
  relations: [],
};

test("architect pipeline starts from facts and enforces goal-to-solution hierarchy", () => {
  assert.match(inventoryPrompt(), /public capabilities/);
  const prompt = architectPrompt({ snapshot: { areas: [], entities: [], relations: [] }, refresh: false, inventory: { facts: [] } });
  assert.match(prompt, /GOAL -> TECHNICAL SOLUTION/);
  assert.match(prompt, /Separate stores, models and runtimes/);
  assert.match(prompt, /explanatory value/);
  assert.match(prompt, /materializer, validator or executor/);
  assert.match(prompt, /Omission is not deletion/);
  assert.match(auditPrompt({ inventory: {}, candidate: {}, snapshot: { areas: [], entities: [], relations: [] }, refresh: false }), /Core nodes form/);
});

test("narrative quality gate accepts a weighted evidence-backed product block", () => {
  assert.equal(validateNarrativeQuality(strongMap), strongMap);
});

test("narrative quality gate rejects inventory-only entities", () => {
  assert.throws(() => validateNarrativeQuality({
    ...strongMap,
    entities: [{ ...strongMap.entities[0], goal: "", solution: "Stores schemas and write roots.", invariants: [] }],
  }), /goal|invariants/);
});

test("narrative quality gate rejects missing implementation evidence", () => {
  assert.throws(() => validateNarrativeQuality({
    ...strongMap,
    entities: [{ ...strongMap.entities[0], path: "", evidence: [] }],
  }), /evidence/);
});

test("narrative quality gate rejects titles that belong in the body", () => {
  assert.throws(() => validateNarrativeQuality({
    ...strongMap,
    entities: [{ ...strongMap.entities[0], label: "This title contains far too many explanatory words for a card" }],
  }), /label|too explanatory/);
});

test("inventory coverage rejects a missing embedding model", () => {
  assert.throws(() => validateInventoryCoverage({
    facts: [
      { id: "search", kind: "capability" },
      { id: "embedding", kind: "model" },
    ],
    mainFlows: [["embedding", "search"]],
  }, strongMap), /embedding/);
});

test("inventory coverage rejects collapsing a model and store into one card", () => {
  assert.throws(() => validateInventoryCoverage({
    facts: [{ id: "embedding", kind: "model" }, { id: "vectors", kind: "store" }],
    mainFlows: [["embedding", "vectors"]],
  }, {
    entities: [{ id: "semantic-index", covers: ["embedding", "vectors"] }],
    relations: [],
  }), /collapses fundamental facts/);
});
