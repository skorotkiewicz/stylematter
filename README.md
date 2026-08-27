# StyleMatter

StyleMatter is an embedded spatial style editor for DOM elements. It uses a graph, CSS variables, and a Shadow DOM interaction layer.

The current library supports shared materials, corner radius, padding, gap, undo, redo, and local persistence.

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
import { attachStyleMatter } from "/assets/stylematter.js";

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

`save()` returns `true` when IndexedDB stores the graph. It returns `false` when persistence is unavailable.

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

## Production limits

The current persistence layer uses IndexedDB. The saved graph belongs to one browser and one origin.

IndexedDB does not publish changes to a server. It does not share changes with other users or devices.

Add a server persistence adapter before you use StyleMatter as a shared website editor. The server must authenticate users and authorize each edit.

The current editor reads its target set when it attaches. It does not detect elements that the host adds later.

The current gap control uses the first two targets. Add per-container gap constraints before one root controls multiple layouts.

Do not attach the editor for ordinary site visitors.

## Verification

Run the model tests:

```bash
node --test stylematter.test.mjs
```

Run the Chromium lifecycle test:

```bash
node stylematter.browser-test.mjs
```

The lifecycle test covers attach, edit, pointer drag, undo, redo, save, reload, restore, detach, and reattach.
