import { Database } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";
import { isPersistedStyleMatterGraph } from "./stylematter.js";

const API_PREFIX = "/api/stylematter/";
const MAX_BODY_BYTES = 1_000_000;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function hasValidToken(request, token) {
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function response(status, body, headers = {}) {
  return new Response(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function createStyleMatterServer(options = {}) {
  const token = options.token ?? process.env.STYLEMATTER_TOKEN;
  if (typeof token !== "string" || token.length < 16) {
    throw new TypeError("StyleMatter server requires a token with at least 16 characters");
  }

  const databasePath = options.databasePath ?? process.env.STYLEMATTER_DB ?? "stylematter.sqlite";
  const database = new Database(databasePath);
  database.query(`
    CREATE TABLE IF NOT EXISTS stylematter_graphs (
      key TEXT PRIMARY KEY,
      graph TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  const selectGraph = database.query("SELECT graph FROM stylematter_graphs WHERE key = ?");
  const upsertGraph = database.query(`
    INSERT INTO stylematter_graphs (key, graph, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      graph = excluded.graph,
      updated_at = excluded.updated_at
  `);

  const server = Bun.serve({
    port: options.port ?? Number(process.env.PORT || 3000),
    hostname: options.hostname ?? process.env.HOST ?? "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(API_PREFIX)) return response(404, "Not found");
      if (!hasValidToken(request, token)) {
        return response(401, "Unauthorized", { "www-authenticate": "Bearer" });
      }

      let key;
      try {
        key = decodeURIComponent(url.pathname.slice(API_PREFIX.length));
      } catch {
        return response(400, "Invalid storage key");
      }
      if (!KEY_PATTERN.test(key)) return response(400, "Invalid storage key");

      if (request.method === "GET") {
        const row = selectGraph.get(key);
        if (!row) return response(404, "Not found");
        try {
          const graph = JSON.parse(row.graph);
          if (!isPersistedStyleMatterGraph(graph)) throw new Error("invalid stored graph");
          return Response.json(graph, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("StyleMatter server found an invalid stored graph", error);
          return response(500, "Invalid stored graph");
        }
      }

      if (request.method === "PUT") {
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
          return response(415, "Expected application/json");
        }
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > MAX_BODY_BYTES) return response(413, "Graph is too large");

        const text = await request.text();
        if (Buffer.byteLength(text) > MAX_BODY_BYTES) return response(413, "Graph is too large");
        let graph;
        try {
          graph = JSON.parse(text);
        } catch {
          return response(400, "Invalid JSON");
        }
        if (!isPersistedStyleMatterGraph(graph)) return response(422, "Invalid StyleMatter graph");

        upsertGraph.run(key, JSON.stringify(graph), Date.now());
        return response(204, null);
      }

      return response(405, "Method not allowed", { allow: "GET, PUT" });
    }
  });

  let closed = false;
  return {
    server,
    close() {
      if (closed) return;
      closed = true;
      server.stop(true);
      database.close(true);
    }
  };
}

if (import.meta.main) {
  const application = createStyleMatterServer();
  console.log(`StyleMatter server listening on ${application.server.url}`);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      application.close();
      process.exit(0);
    });
  }
}
