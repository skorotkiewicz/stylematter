# StyleMatter

StyleMatter is an embedded spatial style editor for DOM elements. It uses a graph, CSS variables, and a Shadow DOM interaction layer.

The library supports shared materials, corner radius, padding, gap, undo, redo, and local or server persistence.

## Install

```bash
npm install stylematter
```

StyleMatter is an ESM-only package.

## Run the demo

Start a static HTTP server from the repository root:

```bash
python3 -m http.server
```

Open `http://localhost:8000`.

The archived interaction experiments are available at `http://localhost:8000/docs/`.

## Embed the library

### 1. Mark the editable elements

Add a stable `data-sm-id` to each editable element. The ID must be unique inside the editor root.

Use the same `data-sm-material` value to link elements to one shared material.

```html
<section id="stories" class="story-grid">
  <article
    class="story-card"
    data-sm-id="coast"
    data-sm-material="story-surface"
  >
    ...
  </article>

  <article
    class="story-card"
    data-sm-id="gardens"
    data-sm-material="story-surface"
  >
    ...
  </article>
</section>
```

StyleMatter edits descendants of the supplied root. It does not edit the root element itself.

### 2. Use the StyleMatter CSS variables

Add fallback values so the page keeps its design when the editor is detached.

```css
.story-grid {
  gap: var(--sm-gap, 2rem);
}

.story-card {
  background: var(--sm-material, #dfa17b);
  border-radius: var(--sm-radius, 1.5rem);
  padding: var(--sm-padding, 2rem);
}
```

### 3. Attach the editor

Attach StyleMatter only for an authorized editor.

```js
import { attachStyleMatter } from "stylematter";

const root = document.querySelector("#stories");

if (currentUser.canEdit) {
  const editor = attachStyleMatter(root, {
    storageKey: "stories-v1"
  });

  await editor.ready;
}
```

Use a different `storageKey` for each editable area.

The editor rejects duplicate or empty `data-sm-id` values.

## Editor API

### Save

```js
const saved = await editor.save();
```

`save()` returns `true` when the active storage adapter stores the graph. It returns `false` when persistence is unavailable.

### Undo and redo

```js
editor.undo();
editor.redo();
```

Each method returns `true` when it changes the graph.

### Read the graph

```js
const graph = editor.graph;
```

The getter returns a structured clone. Changes to the returned object do not change the editor state.

A gap belongs to an explicit relationship between two node IDs:

```js
{
  version: 2,
  materials: { shared: "#c97856" },
  nodes: {
    first: { material: "shared", radius: 24, padding: 28 },
    second: { material: "shared", radius: 24, padding: 28 }
  },
  relations: {
    "gap:first:second": {
      type: "gap",
      from: "first",
      to: "second",
      value: 40
    }
  }
}
```

StyleMatter migrates version 1 graphs during load. New saves use version 2.

### Detach

```js
await editor.destroy();
```

`destroy()` saves the graph, removes listeners and controls, and restores the original inline CSS variables.

### Disable persistence

```js
const editor = attachStyleMatter(root, {
  persistence: false
});
```

This mode keeps the graph in memory until the editor is detached.

## Server persistence

Supply `loadGraph` and `saveGraph` together. StyleMatter uses IndexedDB when these callbacks are absent.

```js
import { attachStyleMatter } from "stylematter";

const token = getShortLivedEditorToken();
const endpoint = key => `/api/stylematter/${encodeURIComponent(key)}`;

const editor = attachStyleMatter(document.querySelector("#stories"), {
  storageKey: "stories-v1",

  async loadGraph(key) {
    const response = await fetch(endpoint(key), {
      headers: { authorization: `Bearer ${token}` }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Graph load failed: ${response.status}`);
    return response.json();
  },

  async saveGraph(key, graph) {
    const response = await fetch(endpoint(key), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(graph)
    });
    if (!response.ok) throw new Error(`Graph save failed: ${response.status}`);
  }
});

await editor.ready;
```

StyleMatter validates a loaded graph against the current DOM before it applies values. It passes a structured clone to `saveGraph`.

The editor pauses automatic saves when `loadGraph` fails. An explicit successful `editor.save()` starts automatic saves again.

### Bun reference server

The package includes an authenticated SQLite server for Bun.

```js
import { createStyleMatterServer } from "stylematter/bun-server";

const application = createStyleMatterServer({
  token: process.env.STYLEMATTER_TOKEN,
  databasePath: "stylematter.sqlite",
  port: 3000
});

console.log(application.server.url);
```

You can also start the server from this repository:

```bash
STYLEMATTER_TOKEN="replace-with-at-least-16-characters" npm run start:server
```

The server provides `GET` and `PUT` at `/api/stylematter/:key`. It rejects invalid keys, large requests, and invalid graphs.

Do not put a long-lived server token in public JavaScript. Use a short-lived editor token or place the server behind your authenticated application.

Call `application.close()` during a graceful shutdown.

## Production limits

IndexedDB state belongs to one browser and one origin. Use server callbacks when users must share changes across browsers or devices.

The current editor reads its target set when it attaches. It does not detect elements that the host adds later.

The current gap control uses the first two targets. Add per-container gap constraints before one root controls multiple layouts.

Do not attach the editor for ordinary site visitors.

## Verification

Run all checks:

```bash
npm test
```

The checks cover graph validation, IndexedDB, custom adapters, Chromium interactions, authentication, SQLite persistence, restart recovery, and teardown.

Inspect the npm package contents:

```bash
npm pack --dry-run
```
