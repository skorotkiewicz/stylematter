import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const root = process.cwd();
const profile = await mkdtemp(join(tmpdir(), "stylematter-chrome-"));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(request.url, "http://localhost").pathname;
    const file = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(`${root}/`)) throw new Error("invalid path");
    response.setHeader("content-type", extname(file) === ".js" ? "text/javascript" : "text/html");
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end("not found");
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const chromium = spawn(process.env.CHROMIUM_BIN || "chromium", [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--window-size=1280,950",
  "--remote-debugging-port=0",
  "--remote-allow-origins=*",
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${port}/index.html`
], { stdio: ["ignore", "ignore", "pipe"] });
let browserErrors = "";
chromium.stderr.on("data", chunk => { browserErrors += chunk; });

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(check, message, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const result = await check();
      if (result) return result;
    } catch {}
    await sleep(50);
  }
  throw new Error(message);
}

class CDP {
  constructor(url) {
    this.nextId = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.opened = new Promise((resolve, reject) => {
      this.socket = new WebSocket(url);
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
      this.socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === "Runtime.exceptionThrown") this.exceptions.push(message.params.exceptionDetails.text);
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      };
    });
  }

  async call(method, params = {}) {
    await this.opened;
    const id = ++this.nextId;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate(expression, awaitPromise = false) {
    const response = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

let cdp;
try {
  const devtoolsPort = await waitFor(async () => {
    const contents = await readFile(join(profile, "DevToolsActivePort"), "utf8");
    return Number(contents.split("\n")[0]);
  }, "Chromium did not expose a debugging port");
  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
    const list = await response.json();
    return list.find(target => target.type === "page")?.webSocketDebuggerUrl;
  }, "Chromium page target was unavailable");
  cdp = new CDP(targets);
  await cdp.call("Runtime.enable");
  await cdp.call("Page.enable");

  await waitFor(() => cdp.evaluate("document.documentElement.dataset.stylematterReady === 'true'"), "StyleMatter did not become ready");

  async function center(expression) {
    return cdp.evaluate(`(() => { const r=(${expression}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  }

  async function drag(expression, dx, dy) {
    const point = await center(expression);
    await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + dx, y: point.y + dy, button: "left", buttons: 1 });
    await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + dx, y: point.y + dy, button: "left", buttons: 0, clickCount: 1 });
  }

  const card = await center("document.querySelector('[data-sm-id=\"gardens\"]')");
  const viewport = await cdp.evaluate("({width:innerWidth,height:innerHeight})");
  assert.ok(card.x > 0 && card.x < viewport.width && card.y > 0 && card.y < viewport.height, { card, viewport });
  await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: card.x, y: card.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: card.x, y: card.y, button: "left", buttons: 0, clickCount: 1 });
  assert.equal(await cdp.evaluate("document.querySelector('[data-stylematter-editor]').shadowRoot.querySelector('.status').textContent"), "editing gardens");

  await cdp.evaluate(`(() => {
    const shadow=document.querySelector('[data-stylematter-editor]').shadowRoot;
    const color=shadow.querySelector('.material');
    color.value='#4f9b80';
    color.dispatchEvent(new Event('change', {bubbles:true}));
    for (const selector of ['.corner','.padding','.gap']) {
      shadow.querySelector(selector).dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true}));
    }
  })()`);
  assert.deepEqual(await cdp.evaluate("window.styleMatter.graph"), {
    version: 1,
    materials: { "story-surface": "#4f9b80" },
    nodes: {
      coast: { material: "story-surface", radius: 26, padding: 32 },
      gardens: { material: "story-surface", radius: 28, padding: 34 }
    },
    gap: 46
  });
  assert.equal(await cdp.evaluate("window.styleMatter.undo()"), true);
  assert.equal((await cdp.evaluate("window.styleMatter.graph")).gap, 44);
  assert.equal(await cdp.evaluate("window.styleMatter.redo()"), true);

  await drag("document.querySelector('[data-stylematter-editor]').shadowRoot.querySelector('.corner')", -10, 10);
  await drag("document.querySelector('[data-stylematter-editor]').shadowRoot.querySelector('.gap')", 20, 0);
  const edited = await cdp.evaluate("window.styleMatter.graph");
  assert.equal(edited.nodes.gardens.radius, 38);
  assert.equal(edited.gap, 66);
  assert.equal(await cdp.evaluate("getComputedStyle(document.querySelector('[data-sm-id=\"coast\"]')).getPropertyValue('--sm-material').trim()"), "#4f9b80");

  assert.equal(await cdp.evaluate("window.styleMatter.save()", true), true);
  await cdp.call("Page.reload", { ignoreCache: true });
  await waitFor(() => cdp.evaluate("document.documentElement.dataset.stylematterReady === 'true'"), "StyleMatter did not restore after reload");
  const restored = await cdp.evaluate("window.styleMatter.graph");
  assert.equal(restored.materials["story-surface"], "#4f9b80");
  assert.equal(restored.nodes.gardens.radius, 38);
  assert.equal(restored.nodes.gardens.padding, 34);
  assert.equal(restored.gap, 66);

  await cdp.evaluate("window.styleMatter.destroy()", true);
  assert.deepEqual(await cdp.evaluate(`(() => ({
    host: Boolean(document.querySelector('[data-stylematter-editor]')),
    rootGap: document.querySelector('#editableStories').style.getPropertyValue('--sm-gap'),
    nodeMaterial: document.querySelector('[data-sm-id="coast"]').style.getPropertyValue('--sm-material')
  }))()`), { host: false, rootGap: "", nodeMaterial: "" });

  await cdp.evaluate(`import('./src/stylematter.js').then(async ({attachStyleMatter}) => {
    window.adapterEvents={loads:[],saves:[]};
    window.adapterStored=${JSON.stringify(restored)};
    window.reattachedStyleMatter=attachStyleMatter(document.querySelector('#editableStories'), {
      storageKey:'server-stories',
      loadGraph:async key => { window.adapterEvents.loads.push(key); return structuredClone(window.adapterStored); },
      saveGraph:async (key, graph) => { window.adapterEvents.saves.push({key,graph}); window.adapterStored=structuredClone(graph); }
    });
    await window.reattachedStyleMatter.ready;
  })`, true);
  assert.deepEqual(await cdp.evaluate("window.reattachedStyleMatter.graph"), restored);
  assert.deepEqual(await cdp.evaluate("window.adapterEvents.loads"), ["server-stories"]);
  await cdp.evaluate(`(() => {
    const gap=document.querySelector('[data-stylematter-editor]').shadowRoot.querySelector('.gap');
    gap.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true}));
  })()`);
  assert.equal(await cdp.evaluate("window.reattachedStyleMatter.save()", true), true);
  const adapterSave = await cdp.evaluate("window.adapterEvents.saves.at(-1)");
  assert.equal(adapterSave.key, "server-stories");
  assert.equal(adapterSave.graph.gap, 68);
  await cdp.evaluate("window.reattachedStyleMatter.destroy()", true);
  assert.equal(await cdp.evaluate("document.querySelectorAll('[data-stylematter-editor]').length"), 0);

  const partialAdapterError = await cdp.evaluate(`import('./src/stylematter.js').then(({attachStyleMatter}) => {
    try {
      attachStyleMatter(document.querySelector('#editableStories'), {loadGraph:async () => null});
    } catch (error) {
      return error.message;
    }
  })`, true);
  assert.equal(partialAdapterError, "StyleMatter requires loadGraph and saveGraph together");
  const invalidAdapterError = await cdp.evaluate(`import('./src/stylematter.js').then(({attachStyleMatter}) => {
    try {
      attachStyleMatter(document.querySelector('#editableStories'), {loadGraph:'invalid',saveGraph:'invalid'});
    } catch (error) {
      return error.message;
    }
  })`, true);
  assert.equal(invalidAdapterError, "StyleMatter loadGraph must be a function");
  assert.deepEqual(cdp.exceptions, []);

  console.log("Chromium lifecycle: pass");
} catch (error) {
  console.error(error);
  if (browserErrors) console.error(browserErrors.slice(-3000));
  process.exitCode = 1;
} finally {
  cdp?.close();
  chromium.kill();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
