import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStyleMatterServer } from "../src/stylematter-server.js";

const token = "test-token-at-least-16-characters";
const authorization = { authorization: `Bearer ${token}` };
const temporaryDirectories = [];

const graph = {
  version: 2,
  materials: { shared: "#c97856" },
  nodes: {
    first: { material: "shared", radius: 24, padding: 28 },
    second: { material: "shared", radius: 24, padding: 28 }
  },
  relations: {
    "gap:first:second": { type: "gap", from: "first", to: "second", value: 40 }
  }
};

const legacyGraph = {
  version: 1,
  materials: structuredClone(graph.materials),
  nodes: structuredClone(graph.nodes),
  gap: 32
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

test("requires a nontrivial authentication token", () => {
  expect(() => createStyleMatterServer({ token: "short", port: 0, databasePath: ":memory:" })).toThrow();
});

test("authenticates, validates, and persists graphs across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stylematter-server-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "graphs.sqlite");
  let application = createStyleMatterServer({ token, databasePath, port: 0 });
  let endpoint = new URL("/api/stylematter/stories", application.server.url);

  expect((await fetch(endpoint)).status).toBe(401);
  expect((await fetch(new URL("/api/stylematter/bad%2Fkey", application.server.url), { headers: authorization })).status).toBe(400);
  expect((await fetch(endpoint, { headers: authorization })).status).toBe(404);
  expect((await fetch(endpoint, {
    method: "PUT",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ version: 1 })
  })).status).toBe(422);

  expect((await fetch(endpoint, {
    method: "PUT",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify(graph)
  })).status).toBe(204);
  expect(await (await fetch(endpoint, { headers: authorization })).json()).toEqual(graph);

  const legacyEndpoint = new URL("/api/stylematter/legacy", application.server.url);
  expect((await fetch(legacyEndpoint, {
    method: "PUT",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify(legacyGraph)
  })).status).toBe(204);
  expect(await (await fetch(legacyEndpoint, { headers: authorization })).json()).toEqual(legacyGraph);

  application.close();
  application = createStyleMatterServer({ token, databasePath, port: 0 });
  endpoint = new URL("/api/stylematter/stories", application.server.url);
  expect(await (await fetch(endpoint, { headers: authorization })).json()).toEqual(graph);
  application.close();
});
