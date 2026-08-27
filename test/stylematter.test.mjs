import test from "node:test";
import assert from "node:assert/strict";
import { clamp, colorToHex, isStyleMatterGraph, normalizeGraph } from "../src/stylematter.js";

const fallback = {
  version: 1,
  materials: { shared: "#c97856" },
  nodes: {
    first: { material: "shared", radius: 24, padding: 28 },
    second: { material: "shared", radius: 24, padding: 28 }
  },
  gap: 40
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

test("normalizeGraph restores valid saved state", () => {
  const saved = structuredClone(fallback);
  saved.materials.shared = "#336699";
  saved.nodes.first.radius = 48;
  saved.nodes.first.padding = 44;
  saved.gap = 72;

  assert.deepEqual(normalizeGraph(saved, fallback), saved);
});

test("normalizeGraph rejects stale and unsafe values", () => {
  const saved = {
    version: 1,
    materials: { shared: "not-a-color", unknown: "#000000" },
    nodes: {
      first: { material: "wrong", radius: 999, padding: -20 },
      unknown: { material: "shared", radius: 1, padding: 1 }
    },
    gap: 999
  };

  const normalized = normalizeGraph(saved, fallback);
  assert.equal(normalized.materials.shared, fallback.materials.shared);
  assert.deepEqual(normalized.nodes.first, fallback.nodes.first);
  assert.equal(normalized.nodes.unknown, undefined);
  assert.equal(normalized.gap, 200);
});

test("normalizeGraph does not mutate its fallback", () => {
  const before = structuredClone(fallback);
  normalizeGraph({ version: 1, materials: { shared: "#000000" } }, fallback);
  assert.deepEqual(fallback, before);
});

test("isStyleMatterGraph accepts a complete graph", () => {
  assert.equal(isStyleMatterGraph(fallback), true);
});

test("isStyleMatterGraph rejects invalid server input", () => {
  assert.equal(isStyleMatterGraph({ ...fallback, gap: 201 }), false);
  assert.equal(isStyleMatterGraph({ ...fallback, materials: { shared: "red" } }), false);
  assert.equal(isStyleMatterGraph({ ...fallback, nodes: { first: { material: "missing", radius: 1, padding: 1 } } }), false);
});
