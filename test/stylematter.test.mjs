import test from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  colorToHex,
  isPersistedStyleMatterGraph,
  isStyleMatterGraph,
  normalizeGraph
} from "../src/stylematter.js";

const relationId = "gap:first:second";
const fallback = {
  version: 2,
  materials: { shared: "#c97856" },
  nodes: {
    first: { material: "shared", radius: 24, padding: 28 },
    second: { material: "shared", radius: 24, padding: 28 }
  },
  relations: {
    [relationId]: { type: "gap", from: "first", to: "second", value: 40 }
  }
};

const legacy = {
  version: 1,
  materials: structuredClone(fallback.materials),
  nodes: structuredClone(fallback.nodes),
  gap: 64
};

test("clamp rounds and limits physical values", () => {
  assert.equal(clamp(12.6, 0, 20), 13);
  assert.equal(clamp(-4, 0, 20), 0);
  assert.equal(clamp(30, 0, 20), 20);
});

test("colorToHex accepts browser rgb output", () => {
  assert.equal(colorToHex("rgb(201, 120, 86)"), "#c97856");
  assert.equal(colorToHex("#AABBCC"), "#aabbcc");
});

test("normalizeGraph restores valid version 2 state", () => {
  const saved = structuredClone(fallback);
  saved.materials.shared = "#336699";
  saved.nodes.first.radius = 48;
  saved.nodes.first.padding = 44;
  saved.relations[relationId].value = 72;

  assert.deepEqual(normalizeGraph(saved, fallback), saved);
});

test("normalizeGraph migrates a version 1 gap into a relation", () => {
  const normalized = normalizeGraph(legacy, fallback);
  assert.equal(normalized.version, 2);
  assert.equal(normalized.relations[relationId].value, 64);
  assert.equal("gap" in normalized, false);
});

test("normalizeGraph rejects stale and unsafe values", () => {
  const saved = {
    version: 2,
    materials: { shared: "not-a-color", unknown: "#000000" },
    nodes: {
      first: { material: "wrong", radius: 999, padding: -20 },
      unknown: { material: "shared", radius: 1, padding: 1 }
    },
    relations: {
      [relationId]: { type: "gap", from: "first", to: "second", value: 999 },
      unknown: { type: "gap", from: "first", to: "unknown", value: 1 }
    }
  };

  const normalized = normalizeGraph(saved, fallback);
  assert.equal(normalized.materials.shared, fallback.materials.shared);
  assert.deepEqual(normalized.nodes.first, fallback.nodes.first);
  assert.equal(normalized.nodes.unknown, undefined);
  assert.equal(normalized.relations[relationId].value, 200);
  assert.equal(normalized.relations.unknown, undefined);
});

test("normalizeGraph does not mutate its fallback", () => {
  const before = structuredClone(fallback);
  normalizeGraph({ version: 2, materials: { shared: "#000000" } }, fallback);
  assert.deepEqual(fallback, before);
});

test("normalizeGraph rejects an invalid fallback", () => {
  assert.throws(() => normalizeGraph(legacy, legacy), /version 2 fallback/);
});

test("isStyleMatterGraph accepts a complete version 2 graph", () => {
  assert.equal(isStyleMatterGraph(fallback), true);
});

test("isStyleMatterGraph rejects invalid relationships", () => {
  assert.equal(isStyleMatterGraph({ ...fallback, version: 1 }), false);
  assert.equal(isStyleMatterGraph({ ...fallback, materials: { shared: "red" } }), false);
  assert.equal(isStyleMatterGraph({ ...fallback, relations: { bad: { type: "gap", from: "first", to: "missing", value: 10 } } }), false);
  assert.equal(isStyleMatterGraph({ ...fallback, relations: { bad: { type: "gap", from: "first", to: "second", value: 201 } } }), false);
});

test("persisted graph validation accepts version 1 during migration", () => {
  assert.equal(isPersistedStyleMatterGraph(legacy), true);
  assert.equal(isPersistedStyleMatterGraph({ ...legacy, gap: 201 }), false);
});
