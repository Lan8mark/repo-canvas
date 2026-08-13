import assert from "node:assert/strict";
import test from "node:test";

import { architectPrompt } from "../repo-canvas/scripts/architect.mjs";
import { validateNarrativeQuality } from "../repo-canvas/scripts/semantic-model.mjs";

const strongMap = {
  areas: [{
    id: "operations",
    title: "Одинаковое поведение команд",
    problem: "Разные интерфейсы могут выполнять одну операцию по-разному и давать несовместимые результаты.",
    solution: "Все интерфейсы получают команды и правила из одного проверяемого описания.",
    order: 1,
  }],
  entities: [{
    id: "operation-rules",
    areaId: "operations",
    label: "Единые правила операций",
    status: "operational",
    path: "src/application/api.py",
    problem: "CLI, MCP и внутренние вызовы могут разойтись в доступных действиях и проверках.",
    solution: "Один список задаёт доступные действия и одинаковые правила для каждого интерфейса.",
    mechanism: "CapabilitySpec registry хранит request schema, write roots и режим выполнения каждой операции.",
    invariants: ["Операция описывается один раз и не копируется между интерфейсами."],
    inputs: ["Operation definition"],
    outputs: ["Interface-neutral operation spec"],
    dependsOn: [],
    order: 1,
  }],
  relations: [{
    id: "cli-rules",
    from: "cli",
    to: "operation-rules",
    label: "берёт единый набор команд",
    technical: "Typer commands generated from CapabilitySpec",
    status: "existing",
  }],
};

test("architect prompt separates newcomer logic from implementation evidence", () => {
  const prompt = architectPrompt({
    snapshot: { areas: [], entities: [], relations: [] },
    refresh: false,
  });

  assert.match(prompt, /LOGIC/);
  assert.match(prompt, /TECHNICAL/);
  assert.match(prompt, /why does this exist/);
  assert.match(prompt, /Единые правила операций/);
});

test("narrative quality gate accepts a compact two-layer map", () => {
  assert.equal(validateNarrativeQuality(strongMap), strongMap);
});

test("narrative quality gate rejects inventory-only entities", () => {
  assert.throws(() => validateNarrativeQuality({
    ...strongMap,
    entities: [{
      ...strongMap.entities[0],
      problem: "",
      solution: "Хранит канонический список схем, групп и write-roots.",
      invariants: [],
    }],
  }), /problem|invariants/);
});

test("narrative quality gate rejects disconnected cards", () => {
  assert.throws(() => validateNarrativeQuality({
    ...strongMap,
    entities: [...strongMap.entities, { ...strongMap.entities[0], id: "orphan", label: "Изолированный блок" }],
  }), /must be connected/);
});
