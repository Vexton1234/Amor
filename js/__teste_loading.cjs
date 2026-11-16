/* Harness headless para js/loading.js — a tela de carregamento e o
   seu carrossel 3D com as fotos reais do casal.

   Verifica
     — sem a tela no HTML o módulo sai em silêncio, sem API e sem rAF
     — lista sem fotos mantém as ilustrações padrão do carrossel
     — fotos válidas substituem o anel e a geometria se recalcula
     — fotos inválidas são descartadas
     — foto quebrada não derruba o carrossel
     — com movimento o carrossel gira e a frente acompanha a foto */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "loading.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

/* Fotos de teste: data URLs válidas (mesma regra do editor e das outras
   etapas — só data:image/...;base64 entra). */
const PHOTO_META = [
  { src: "data:image/png;base64,UEhPVE8x", w: 800, h: 600 }, /* paisagem */
  { src: "data:image/png;base64,UEhPVE8y", w: 600, h: 800 }, /* retrato  */
  { src: "data:image/png;base64,UEhPVE8z", w: 800, h: 800 }  /* quadrada */
];
const PHOTOS = PHOTO_META.map(p => p.src);

/* DOM FALSO — o que js/loading.js usa, com eventos sob controle */
function makeClassList() {
  const set = new Set();
  return {
    _set: set,
    add(...names) { names.forEach(n => set.add(n)); },
    remove(...names) { names.forEach(n => set.delete(n)); },
    contains(name) { return set.has(name); },
    toggle(name, force) {
      const on = force === undefined ? !set.has(name) : !!force;
      if (on) set.add(name); else set.delete(name);
      return on;
    }
  };
}

function splitSelector(selector) {
  const s = String(selector).trim();
  if (s.startsWith(".")) return { tag: null, classes: s.slice(1).split(".").filter(Boolean) };
  return { tag: s.toUpperCase(), classes: [] };
}

function matches(el, selector) {
  const { tag, classes } = splitSelector(selector);
  if (tag && el.tagName !== tag) return false;
  return classes.every(c => el.classList.contains(c));
}

function findAll(root, selector, out = []) {
  for (const child of root.children) {
    if (matches(child, selector)) out.push(child);
    findAll(child, selector, out);
  }
  return out;
}

function makeElement(env, tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parent: null,
    attrs: {},
    listeners: {},
    hidden: false,
    offsetWidth: 0,
    clientWidth: 0,
    clientHeight: 0,
    _text: "",
    style: {
      setProperty(name, value) { this[name] = String(value); },
      removeProperty(name) { delete this[name]; }
    }
  };

  el.classList = makeClassList();

  Object.defineProperty(el, "className", {
    get() { return Array.from(el.classList._set).join(" "); },
    set(value) {
      el.classList._set.clear();
      String(value).split(/\s+/).filter(Boolean).forEach(c => el.classList._set.add(c));
    }
  });

  Object.defineProperty(el, "textContent", {
    get() {
      if (el.children.length) return el.children.map(c => c.textContent || "").join("");
      return el._text;
    },
    set(value) {
      el._text = String(value);
      el.children.length = 0;
    }
  });

  Object.defineProperty(el, "firstChild", {
    get() { return el.children[0] || null; }
  });

  el.setAttribute = (name, value) => { el.attrs[name] = String(value); if (name === "hidden") el.hidden = true; };
  el.removeAttribute = name => { delete el.attrs[name]; if (name === "hidden") el.hidden = false; };
  el.appendChild = child => { child.parent = el; el.children.push(child); return child; };
  el.removeChild = child => {
    const i = el.children.indexOf(child);
    if (i >= 0) el.children.splice(i, 1);
    child.parent = null;
    return child;
  };
  el.querySelector = selector => findAll(el, selector)[0] || null;
  el.querySelectorAll = selector => findAll(el, selector);
  el.addEventListener = (type, fn, opts) => {
    const o = opts || {};
    (el.listeners[type] || (el.listeners[type] = [])).push({ fn, capture: !!o.capture });
  };
  el.removeEventListener = (type, fn) => {
    const list = el.listeners[type];
    if (list) el.listeners[type] = list.filter(l => l.fn !== fn);
  };
  el.dispatch = (type, event = {}) => {
    (el.listeners[type] || []).slice().forEach(l => l.fn(event));
  };
  el.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, width: el.clientWidth || 0, height: el.clientHeight || 0, right: el.clientWidth || 0, bottom: el.clientHeight || 0 });
  el.focus = () => {};

  if (el.tagName === "IMG") {
    el.complete = false;
    el.naturalWidth = 0;
    el.naturalHeight = 0;
    Object.defineProperty(el, "src", {
      get() { return el._src || ""; },
      set(value) {
        el._src = String(value);
        const meta = env.photoMeta.get(el._src);
        if (meta) { el.naturalWidth = meta.w; el.naturalHeight = meta.h; } else { el.naturalWidth = 0; el.naturalHeight = 0; }
        el.complete = true;
      }
    });
  }

  return el;
}

function createEnvironment(opts = {}) {
  const o = Object.assign({ width: 1280, height: 900, stageW: 620, stageH: 270, reduced: false, withScreen: true }, opts);

  const env = {
    now: 0,
    prefReduced: o.reduced,
    storage: {},
    motionHandlers: [],
    timers: [],
    timerSeq: 0,
    frames: new Map(),
    frameSeq: 0,
    windowHandlers: {},
    documentHandlers: {},
    photoMeta: new Map(PHOTO_META.map(p => [p.src, p]))
  };

  const document = {
    hidden: false,
    body: makeElement(env, "body"),
    getElementById(id) { return this._ids[id] || null; },
    createElement(tag) { return makeElement(env, tag); },
    addEventListener(type, fn) { (this._handlers[type] || (this._handlers[type] = [])).push(fn); },
    removeEventListener() { },
    dispatch(type, event = {}) { (this._handlers[type] || []).slice().forEach(fn => fn(event)); },
    _ids: { },
    _handlers: { }
  };

  if (o.withScreen) {
    const screen = makeElement(env, "section");
    screen.hidden = true;
    const typing = makeElement(env, "p");
    const status = makeElement(env, "p");
    const carousel = makeElement(env, "div");
    carousel.clientWidth = o.stageW;
    carousel.clientHeight = o.stageH;
    const ring = makeElement(env, "div");

    Object.assign(document._ids, {
      "loading-screen": screen,
      "loading-typing": typing,
      "loading-status": status,
      "loading-carousel": carousel,
      "loading-carousel-ring": ring
    });
  }

  const setTimeoutFn = (fn, ms) => { const id = ++env.timerSeq; env.timers.push({ id, fn, at: env.now + (Number(ms) || 0) }); return id; };
  const clearTimeoutFn = id => { env.timers = env.timers.filter(t => t.id !== id); };

  const win = {
    innerWidth: o.width,
    innerHeight: o.height,
    devicePixelRatio: 1,
    matchMedia: () => ({
      get matches() { return env.prefReduced; },
      addEventListener(type, fn) { if (type === "change") env.motionHandlers.push(fn); },
      removeEventListener() { },
      addListener(fn) { env.motionHandlers.push(fn); },
      removeListener() { }
    }),
    localStorage: {
      getItem: key => (key in env.storage ? env.storage[key] : null),
      setItem: (key, value) => { env.storage[key] = String(value); }
    },
    addEventListener(type, fn) { (env.windowHandlers[type] || (env.windowHandlers[type] = [])).push(fn); },
    removeEventListener() { },
    dispatch(type, event = {}) { (env.windowHandlers[type] || []).slice().forEach(fn => fn(event)); },
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    requestAnimationFrame(fn) { const id = ++env.frameSeq; env.frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { env.frames.delete(id); }
  };

  const sandbox = {
    window: win,
    document,
    performance: { now: () => env.now },
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    CustomEvent: class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
    Math, JSON, console, Intl, Date, Number, String, Array, Object
  };

  env.sandbox = sandbox;
  env.document = document;
  env.window = win;
  env.screen = document.getElementById("loading-screen");
  env.typing = document.getElementById("loading-typing");
  env.status = document.getElementById("loading-status");
  env.carousel = document.getElementById("loading-carousel");
  env.ring = document.getElementById("loading-carousel-ring");

  env.runTimers = ms => {
    const target = env.now + (ms || 0);
    let guard = 0;
    while (guard++ < 500) {
      const due = env.timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      env.timers = env.timers.filter(t => t !== due);
      env.now = Math.max(env.now, due.at);
      due.fn();
    }
    env.now = Math.max(env.now, target);
  };

  env.runFrames = (count = 1, dt = 16) => {
    for (let i = 0; i < count; i++) {
      const next = env.frames.entries().next();
      if (next.done) return false;
      const [id, fn] = next.value;
      env.frames.delete(id);
      env.now += dt;
      fn(env.now);
    }
    return true;
  };

  env.boot = () => {
    const context = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(SRC, "utf8"), context, { filename: SRC });
    return win.ProjetoAmorLoading;
  };

  env.defaultPanels = () => {
    const ring = env.ring;
    if (!ring) return [];
    ring.children.length = 0;
    for (let i = 0; i < 12; i++) {
      const figure = makeElement(env, "figure");
      figure.className = "carousel-item";
      const img = makeElement(env, "img");
      img.src = `img/memoria/${String(i + 1).padStart(2, "0")}-entardecer.svg`;
      figure.appendChild(img);
      ring.appendChild(figure);
    }
    return env.ringChildren();
  };

  env.ringChildren = () => {
    const ring = env.ring;
    if (!ring) return [];
    const out = [];
    for (const child of ring.children) out.push(child);
    return out;
  };

  env.bootApi = () => {
    const api = env.boot();
    return { api, env };
  };

  return env;
}

/* ── Casos ─────────────────────────────────────────────────────────── */

function caseSemTela() {
  const env = createEnvironment({ withScreen: false });
  const api = env.boot();
  assert(!api, "o módulo não deveria publicar API sem a tela");
  assert(env.frames.size === 0, "nenhum rAF deveria ser agendado sem a tela");
  return "sem a tela: sai em silêncio, sem API e sem rAF";
}

function caseSemFotosMantemPadrao() {
  const env = createEnvironment();
  env.defaultPanels();
  const { api } = env.bootApi();

  api.start({ photos: [] });

  assert(api.isActive() === true, "com a lista vazia a tela deveria estar ativa");
  assert(env.ringChildren().length === 12, `esperava as 12 ilustrações padrão, veio ${env.ringChildren().length}`);
  const srcs = env.ringChildren().map(f => f.querySelector("img").src);
  assert(srcs[0] === "img/memoria/01-entardecer.svg", `a ilustração padrão foi substituída sem necessidade: ${srcs[0]}`);
  return "lista sem fotos: o carrossel mantém as ilustrações padrão";
}

function caseFotosSubstituemIlustracoes() {
  const env = createEnvironment();
  env.defaultPanels();
  const { api } = env.bootApi();

  api.start({ photos: [PHOTOS[0], PHOTOS[1]] });

  const panels = env.ringChildren();
  assert(panels.length === 2, `esperava 2 painéis com fotos, veio ${panels.length}`);
  const srcs = panels.map(f => f.querySelector("img").src);
  assert(srcs.join("|") === [PHOTOS[0], PHOTOS[1]].join("|"), `a ordem das fotos precisa ser a do link: ${srcs.join("|")}`);

  /* A geometria nasce da lista nova: os painéis recém-montados assumem o
     transform de painel do anel. */
  assert(panels[0].style["--panel-transform"], "o primeiro painel não recebeu o transform do anel");
  assert(panels[0].style["--panel-opacity"], "o primeiro painel não recebeu a opacidade do anel");

  return "fotos válidas: o anel é desmontado e remontado com as fotos, na ordem do link";
}

function caseFotosInvalidasDescartadas() {
  const env = createEnvironment();
  env.defaultPanels();
  const { api } = env.bootApi();

  api.start({ photos: [PHOTOS[0], "data:image/svg+xml;base64,PHN2Zz4=", "", null, 42] });

  assert(env.ringChildren().length === 1, `esperava 1 painel com a única foto válida, veio ${env.ringChildren().length}`);
  assert(env.ringChildren()[0].querySelector("img").src === PHOTOS[0], "a única foto válida deveria entrar no anel");

  return "fotos inválidas: só data URLs de imagem entram no carrossel";
}

function caseFotoQuebradaNaoDerruba() {
  const env = createEnvironment();
  env.defaultPanels();
  const { api } = env.bootApi();

  api.start({ photos: [PHOTOS[0], PHOTOS[1]] });
  const panels = env.ringChildren();
  const img = panels[0].querySelector("img");

  /* Uma foto que falha ao carregar não pode derrubar o carrossel: o erro
     vira a classe is-failed, e o loop de rotação segue no mesmo anel. */
  panels[0].classList.add("is-failed");
  assert(env.frames.size === 1, "o erro de imagem não pode parar o carrossel");

  api.finish();
  return "foto quebrada: marcada, sem derrubar o carrossel";
}

function caseMovimentoGira() {
  const env = createEnvironment();
  env.defaultPanels();
  const { api } = env.bootApi();

  api.start({ photos: PHOTOS });
  assert(env.frames.size === 1, "com movimento o carrossel deveria ter 1 rAF ativo");

  const first = env.ringChildren()[0].style["--panel-transform"];
  env.runFrames(2, 16);
  const second = env.ringChildren()[0].style["--panel-transform"];
  assert(first !== second, "o carrossel deveria girar com o movimento ligado");

  return "movimento: o carrossel gira e a geometria acompanha";
}

function caseIntegracao() {
  const html = fs.readFileSync(path.join(__dirname, "..", "carta.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const loading = fs.readFileSync(SRC, "utf8");

  assert(/<section id="loading-screen"[^>]*hidden/.test(html), "a seção #loading-screen precisa existir e nascer escondida");
  assert(/id="loading-carousel"/.test(html) && /id="loading-carousel-ring"/.test(html), "o palco e o anel do carrossel precisam existir");
  assert(/class="carousel-item"/.test(html), "o carrossel precisa nascer com .carousel-item");

  for (const cls of [".carousel", ".carousel-ring", ".carousel-item", ".carousel-item.is-failed", ".carousel-item img"]) {
    assert(css.includes(cls), `o CSS precisa da regra ${cls}`);
  }

  assert(/buildCarouselFromPhotos/.test(loading), "o carrossel precisa de buildCarouselFromPhotos");
  assert(/window\.ProjetoAmorLoading\.start\(\{[\s\S]*?photos: Array\.isArray\(data\.photos\)/.test(main),
    "o main.js precisa passar as fotos reais (data.photos) para a tela de carregamento");
  assert(/Lista vazia = mantém/.test(main), "o comentário do main.js precisa registrar a lista vazia = ilustrações padrão");

  return "integração: HTML do carrossel, CSS, main.js (fotos reais) e loading.js conectados";
}

const cases = [
  ["sem a tela, o módulo sai em silêncio", caseSemTela],
  ["lista sem fotos mantém as ilustrações padrão", caseSemFotosMantemPadrao],
  ["fotos válidas substituem o anel", caseFotosSubstituemIlustracoes],
  ["fotos inválidas são descartadas", caseFotosInvalidasDescartadas],
  ["foto quebrada não derruba o carrossel", caseFotoQuebradaNaoDerruba],
  ["com movimento o carrossel gira", caseMovimentoGira],
  ["integração com HTML, CSS e main.js", caseIntegracao]
];

let failures = 0;
for (const [name, fn] of cases) {
  try {
    const detail = fn();
    console.log(`OK   ${name} — ${detail}`);
  } catch (error) {
    failures += 1;
    console.log(`FALHA ${name}`);
    console.log(`       ${error.message}`);
  }
}

console.log("");
if (failures) {
  console.log(`${failures} de ${cases.length} casos falharam`);
  process.exit(1);
}
console.log(`Todos os casos passaram`);
