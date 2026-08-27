const ACTIVE_ROOTS = new WeakSet();
const DB_NAME = "stylematter";
const STORE_NAME = "graphs";
const STYLE_PROPERTIES = ["--sm-material", "--sm-radius", "--sm-padding"];
let databasePromise;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));

export function colorToHex(color) {
  if (/^#[\da-f]{6}$/i.test(color)) return color.toLowerCase();
  const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!values || values.length !== 3) return "#c97856";
  return `#${values.map(value => clamp(value, 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

export function isStyleMatterGraph(value) {
  if (!value || typeof value !== "object" || value.version !== 1) return false;
  if (!value.materials || typeof value.materials !== "object" || Array.isArray(value.materials)) return false;
  if (!value.nodes || typeof value.nodes !== "object" || Array.isArray(value.nodes)) return false;
  if (!Number.isFinite(value.gap) || value.gap < 0 || value.gap > 200) return false;

  const materials = Object.entries(value.materials);
  const nodes = Object.entries(value.nodes);
  if (!materials.length || materials.length > 1000 || !nodes.length || nodes.length > 10000) return false;
  if (materials.some(([id, color]) => !id || !/^#[\da-f]{6}$/i.test(color))) return false;
  return nodes.every(([id, node]) =>
    id &&
    node &&
    typeof node === "object" &&
    Object.hasOwn(value.materials, node.material) &&
    Number.isFinite(node.radius) && node.radius >= 0 && node.radius <= 120 &&
    Number.isFinite(node.padding) && node.padding >= 0 && node.padding <= 120
  );
}

export function normalizeGraph(saved, fallback) {
  const graph = structuredClone(fallback);
  if (!saved || saved.version !== 1 || typeof saved !== "object") return graph;

  for (const material of Object.keys(graph.materials)) {
    const value = saved.materials?.[material];
    if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value)) graph.materials[material] = value.toLowerCase();
  }

  for (const [id, node] of Object.entries(graph.nodes)) {
    const candidate = saved.nodes?.[id];
    if (!candidate || candidate.material !== node.material) continue;
    if (Number.isFinite(candidate.radius)) node.radius = clamp(candidate.radius, 0, 120);
    if (Number.isFinite(candidate.padding)) node.padding = clamp(candidate.padding, 0, 120);
  }

  if (Number.isFinite(saved.gap)) graph.gap = clamp(saved.gap, 0, 200);
  return graph;
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

async function loadIndexedDbGraph(key) {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function saveIndexedDbGraph(key, graph) {
  const database = await openDatabase();
  if (!database) return false;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(structuredClone(graph), key);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  });
}

function createInitialGraph(root, targets) {
  const materials = {};
  const nodes = {};

  for (const target of targets) {
    const id = target.dataset.smId;
    const material = target.dataset.smMaterial || id;
    const style = getComputedStyle(target);
    materials[material] ??= colorToHex(style.backgroundColor);
    nodes[id] = {
      material,
      radius: clamp(parseFloat(style.borderTopLeftRadius) || 0, 0, 120),
      padding: clamp(parseFloat(style.paddingLeft) || 0, 0, 120)
    };
  }

  const rootStyle = getComputedStyle(root);
  return {
    version: 1,
    materials,
    nodes,
    gap: clamp(parseFloat(rootStyle.columnGap || rootStyle.gap) || 0, 0, 200)
  };
}

function captureProperties(element, properties) {
  return Object.fromEntries(properties.map(property => [property, element.style.getPropertyValue(property)]));
}

function restoreProperties(element, values) {
  for (const [property, value] of Object.entries(values)) {
    if (value) element.style.setProperty(property, value);
    else element.style.removeProperty(property);
  }
}

function springPath(start, end, y) {
  const points = [`${start},${y}`];
  for (let index = 1; index < 12; index += 1) {
    const x = start + (end - start) * index / 12;
    points.push(`${x},${y + (index % 2 ? -7 : 7)}`);
  }
  points.push(`${end},${y}`);
  return `M ${points.join(" L ")}`;
}

function overlayMarkup() {
  return `
    <style>
      :host { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; font-family: ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      svg { position: fixed; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
      .outline { fill: none; stroke: #176b63; stroke-width: 2; stroke-dasharray: 5 6; }
      .link { fill: none; stroke: var(--link-color, #c97856); stroke-width: 2.5; stroke-linecap: round; opacity: .72; }
      .spring { fill: none; stroke: #bd7b10; stroke-width: 3; stroke-linejoin: round; }
      .control { position: fixed; pointer-events: auto; touch-action: none; box-shadow: 0 4px 13px rgb(45 39 31 / .25); }
      .control:disabled { opacity: .45; cursor: wait; }
      button, input { font: inherit; }
      button { display: grid; place-items: center; padding: 0; border: 2px solid #176b63; color: #fffdf7; background: #176b63; cursor: pointer; }
      button:focus-visible, input:focus-visible { outline: 4px solid #bd7b10; outline-offset: 3px; }
      .corner { width: 30px; height: 30px; border-radius: 4px 18px 4px 18px; color: #72500f; border-color: #bd7b10; background: #fff8df; cursor: nesw-resize; }
      .corner::before { content: "⌟"; font-weight: 900; transform: rotate(180deg); }
      .padding { width: 14px; height: 44px; border-radius: 8px; color: #72500f; border-color: #bd7b10; background: #fff8df; cursor: ew-resize; }
      .padding::before { content: ""; position: absolute; inset: 7px 3px; border-left: 2px solid currentColor; border-right: 2px solid currentColor; }
      .gap { width: 32px; height: 32px; border: 3px solid #bd7b10; border-radius: 50%; color: #72500f; background: #fff8df; cursor: ew-resize; }
      .gap::before { content: "↔"; font-size: 12px; font-weight: 900; }
      .material { width: 38px; height: 38px; padding: 0; overflow: hidden; appearance: none; border: 4px solid #fffdf7; border-radius: 50%; background: transparent; cursor: pointer; }
      .material::-webkit-color-swatch-wrapper { padding: 0; }
      .material::-webkit-color-swatch { border: 0; border-radius: 50%; }
      .material::-moz-color-swatch { border: 0; border-radius: 50%; }
      .toolbar { position: fixed; top: 14px; right: 14px; display: flex; gap: 7px; padding: 7px; border: 1px solid #bdb3a4; border-radius: 999px; background: #fffdf7; box-shadow: 0 8px 24px rgb(45 39 31 / .18); pointer-events: auto; }
      .toolbar button { position: static; width: 34px; height: 34px; border-radius: 50%; font-weight: 900; box-shadow: none; }
      .toolbar button:disabled { opacity: .35; cursor: default; }
      .detach { border-color: #a54432 !important; background: #a54432 !important; }
      .status { position: fixed; left: 14px; bottom: 14px; padding: 8px 11px; border: 1px solid #bdb3a4; border-radius: 999px; color: #575148; background: #fffdf7; box-shadow: 0 5px 16px rgb(45 39 31 / .14); font: 700 11px/1 ui-monospace, monospace; pointer-events: none; }
      [hidden] { display: none !important; }
    </style>
    <svg aria-hidden="true">
      <rect class="outline"></rect>
      <g class="links"></g>
      <path class="spring"></path>
    </svg>
    <input class="control material" type="color" aria-label="Shared surface material">
    <button class="control corner" type="button" role="slider" aria-label="Corner curvature" aria-valuemin="0" aria-valuemax="120"></button>
    <button class="control padding" type="button" role="slider" aria-label="Inner spacing" aria-valuemin="0" aria-valuemax="120"></button>
    <button class="control gap" type="button" role="slider" aria-label="Space between objects" aria-valuemin="0" aria-valuemax="200"></button>
    <div class="toolbar">
      <button class="undo" type="button" aria-label="Undo" title="Undo">↶</button>
      <button class="redo" type="button" aria-label="Redo" title="Redo">↷</button>
      <button class="detach" type="button" aria-label="Detach StyleMatter" title="Detach">×</button>
    </div>
    <output class="status" aria-live="polite">loading</output>
  `;
}

export function attachStyleMatter(root, options = {}) {
  if (!(root instanceof Element)) throw new TypeError("StyleMatter requires a root Element");
  if (ACTIVE_ROOTS.has(root)) throw new Error("StyleMatter is already attached to this root");

  // ponytail: targets are fixed at attach time; observe DOM mutations when hosts need live node insertion.
  const targets = [...root.querySelectorAll("[data-sm-id]")];
  if (!targets.length) throw new Error("StyleMatter found no [data-sm-id] elements");
  const ids = targets.map(target => target.dataset.smId);
  if (new Set(ids).size !== ids.length || ids.some(id => !id)) throw new Error("StyleMatter requires unique, non-empty data-sm-id values");

  const storageKey = options.storageKey || root.id || "default";
  const persistence = options.persistence !== false;
  const hasLoadAdapter = typeof options.loadGraph === "function";
  const hasSaveAdapter = typeof options.saveGraph === "function";
  if (typeof storageKey !== "string" || !storageKey) throw new TypeError("StyleMatter storageKey must be a non-empty string");
  if (options.loadGraph !== undefined && !hasLoadAdapter) throw new TypeError("StyleMatter loadGraph must be a function");
  if (options.saveGraph !== undefined && !hasSaveAdapter) throw new TypeError("StyleMatter saveGraph must be a function");
  if (hasLoadAdapter !== hasSaveAdapter) throw new TypeError("StyleMatter requires loadGraph and saveGraph together");

  const storage = hasLoadAdapter ? {
    load: key => options.loadGraph(key),
    save: async (key, value) => (await options.saveGraph(key, structuredClone(value))) !== false
  } : persistence ? {
    load: loadIndexedDbGraph,
    save: saveIndexedDbGraph
  } : null;

  ACTIVE_ROOTS.add(root);
  const byId = new Map(targets.map(target => [target.dataset.smId, target]));
  const fallback = createInitialGraph(root, targets);
  let graph = structuredClone(fallback);
  let selectedId = ids[0];
  let destroyed = false;
  let drag;
  let saveTimer;
  let automaticSave = Boolean(storage);
  const past = [];
  const future = [];
  const originalRoot = captureProperties(root, ["--sm-gap"]);
  const originalTargets = new Map(targets.map(target => [target, captureProperties(target, STYLE_PROPERTIES)]));

  const host = document.createElement("div");
  host.dataset.stylematterEditor = "";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = overlayMarkup();
  document.body.append(host);

  const outline = shadow.querySelector(".outline");
  const links = shadow.querySelector(".links");
  const spring = shadow.querySelector(".spring");
  const material = shadow.querySelector(".material");
  const corner = shadow.querySelector(".corner");
  const padding = shadow.querySelector(".padding");
  const gap = shadow.querySelector(".gap");
  const undoButton = shadow.querySelector(".undo");
  const redoButton = shadow.querySelector(".redo");
  const detachButton = shadow.querySelector(".detach");
  const status = shadow.querySelector(".status");
  const editingControls = [material, corner, padding, gap];
  editingControls.forEach(control => { control.disabled = true; });

  function selectedNode() {
    return graph.nodes[selectedId];
  }

  function applyGraph() {
    root.style.setProperty("--sm-gap", `${graph.gap}px`);
    for (const [id, node] of Object.entries(graph.nodes)) {
      const target = byId.get(id);
      if (!target) continue;
      target.style.setProperty("--sm-material", graph.materials[node.material]);
      target.style.setProperty("--sm-radius", `${node.radius}px`);
      target.style.setProperty("--sm-padding", `${node.padding}px`);
    }
  }

  async function persistGraph() {
    if (!storage) return false;
    return storage.save(storageKey, graph);
  }

  async function save() {
    try {
      const saved = await persistGraph();
      if (saved) automaticSave = true;
      else automaticSave = false;
      draw();
      return saved;
    } catch (error) {
      automaticSave = false;
      draw();
      throw error;
    }
  }

  function scheduleSave() {
    if (!automaticSave || destroyed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save().catch(error => {
      console.warn("StyleMatter could not save", error);
    }), 120);
  }

  function draw() {
    if (destroyed) return;
    const target = byId.get(selectedId);
    const node = selectedNode();
    const rect = target.getBoundingClientRect();
    outline.setAttribute("x", rect.left - 5);
    outline.setAttribute("y", rect.top - 5);
    outline.setAttribute("width", rect.width + 10);
    outline.setAttribute("height", rect.height + 10);
    outline.setAttribute("rx", Math.min(node.radius + 5, 120));

    material.style.left = `${rect.left - 19}px`;
    material.style.top = `${rect.top - 19}px`;
    material.value = graph.materials[node.material];
    material.style.setProperty("--link-color", graph.materials[node.material]);
    corner.style.left = `${rect.right - 15}px`;
    corner.style.top = `${rect.top - 15}px`;
    padding.style.left = `${rect.left + node.padding / 2 - 7}px`;
    padding.style.top = `${rect.top + rect.height / 2 - 22}px`;
    corner.setAttribute("aria-valuenow", node.radius);
    padding.setAttribute("aria-valuenow", node.padding);
    gap.setAttribute("aria-valuenow", graph.gap);

    const linkedTargets = Object.entries(graph.nodes)
      .filter(([, candidate]) => candidate.material === node.material)
      .map(([id]) => byId.get(id));
    links.style.setProperty("--link-color", graph.materials[node.material]);
    links.replaceChildren(...linkedTargets.filter(linked => linked !== target).map(linked => {
      const linkedRect = linked.getBoundingClientRect();
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const x1 = rect.left;
      const y1 = rect.top;
      const x2 = linkedRect.left + linkedRect.width / 2;
      const y2 = linkedRect.top;
      path.setAttribute("class", "link");
      path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${y1 - 52}, ${x2} ${y2 - 52}, ${x2} ${y2}`);
      return path;
    }));

    if (targets.length > 1) {
      // ponytail: one gap constraint uses the first two targets; add per-container gaps when multiple layouts need editing.
      const first = targets[0].getBoundingClientRect();
      const second = targets[1].getBoundingClientRect();
      const start = first.right + 4;
      const end = second.left - 4;
      const y = first.top + first.height * .56;
      spring.setAttribute("d", springPath(start, end, y));
      gap.style.left = `${(start + end) / 2 - 16}px`;
      gap.style.top = `${y - 16}px`;
      gap.hidden = false;
    } else {
      spring.removeAttribute("d");
      gap.hidden = true;
    }

    undoButton.disabled = !past.length;
    redoButton.disabled = !future.length;
    const storageState = !storage ? " · memory only" : automaticSave ? "" : " · save paused";
    status.textContent = `editing ${selectedId}${storageState}`;
  }

  let drawFrame;
  function queueDraw() {
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(draw);
  }

  function changed() {
    applyGraph();
    draw();
    scheduleSave();
  }

  function checkpoint() {
    past.push(structuredClone(graph));
    if (past.length > 100) past.shift();
    future.length = 0;
  }

  function undo() {
    if (!past.length || destroyed) return false;
    future.push(structuredClone(graph));
    graph = past.pop();
    changed();
    return true;
  }

  function redo() {
    if (!future.length || destroyed) return false;
    past.push(structuredClone(graph));
    graph = future.pop();
    changed();
    return true;
  }

  function selectFromRoot(event) {
    const target = event.target.closest?.("[data-sm-id]");
    if (!target || !root.contains(target)) return;
    selectedId = target.dataset.smId;
    draw();
  }

  function beginDrag(event, kind) {
    checkpoint();
    const node = selectedNode();
    drag = {
      pointerId: event.pointerId,
      kind,
      x: event.clientX,
      y: event.clientY,
      value: kind === "gap" ? graph.gap : node[kind]
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const node = selectedNode();
    if (drag.kind === "gap") graph.gap = clamp(drag.value + event.clientX - drag.x, 0, 200);
    if (drag.kind === "padding") node.padding = clamp(drag.value + event.clientX - drag.x, 0, 120);
    if (drag.kind === "radius") {
      const inward = (drag.x - event.clientX + event.clientY - drag.y) / 2;
      node.radius = clamp(drag.value + inward, 0, 120);
    }
    changed();
  }

  function endDrag(event) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function clearDrag() {
    drag = undefined;
  }

  function changeWithKeys(event, kind) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    checkpoint();
    const increase = event.key === "ArrowRight" || event.key === "ArrowUp";
    const amount = (event.shiftKey ? 10 : 2) * (increase ? 1 : -1);
    if (kind === "gap") graph.gap = clamp(graph.gap + amount, 0, 200);
    else selectedNode()[kind] = clamp(selectedNode()[kind] + amount, 0, 120);
    changed();
  }

  material.addEventListener("change", event => {
    checkpoint();
    graph.materials[selectedNode().material] = event.target.value;
    changed();
  });

  [[corner, "radius"], [padding, "padding"], [gap, "gap"]].forEach(([handle, kind]) => {
    handle.addEventListener("pointerdown", event => beginDrag(event, kind));
    handle.addEventListener("pointermove", continueDrag);
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("lostpointercapture", clearDrag);
    handle.addEventListener("keydown", event => changeWithKeys(event, kind));
  });

  root.addEventListener("pointerdown", selectFromRoot);
  undoButton.addEventListener("click", undo);
  redoButton.addEventListener("click", redo);
  window.addEventListener("resize", queueDraw);
  window.addEventListener("scroll", queueDraw, { passive: true, capture: true });
  const resizeObserver = new ResizeObserver(queueDraw);
  resizeObserver.observe(root);
  targets.forEach(target => resizeObserver.observe(target));

  let api;
  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(saveTimer);
    await ready;
    if (automaticSave) await persistGraph().catch(error => console.warn("StyleMatter could not save before detach", error));
    cancelAnimationFrame(drawFrame);
    resizeObserver.disconnect();
    root.removeEventListener("pointerdown", selectFromRoot);
    window.removeEventListener("resize", queueDraw);
    window.removeEventListener("scroll", queueDraw, { capture: true });
    restoreProperties(root, originalRoot);
    for (const [target, values] of originalTargets) restoreProperties(target, values);
    host.remove();
    ACTIVE_ROOTS.delete(root);
  }

  detachButton.addEventListener("click", () => api.destroy());

  applyGraph();
  draw();
  const ready = (async () => {
    if (storage) {
      try {
        graph = normalizeGraph(await storage.load(storageKey), fallback);
      } catch (error) {
        automaticSave = false;
        console.warn("StyleMatter could not load saved state", error);
      }
    }
    if (!destroyed) {
      editingControls.forEach(control => { control.disabled = false; });
      applyGraph();
      draw();
    }
  })();

  api = {
    ready,
    undo,
    redo,
    save,
    destroy,
    get graph() { return structuredClone(graph); }
  };
  return api;
}
