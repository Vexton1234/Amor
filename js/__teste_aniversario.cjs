/* Harness headless para js/aniversario.js — a homenagem de aniversário.

   Não substitui o teste visual: verifica as INVARIANTES do módulo.

   • sem a cena no HTML o módulo sai em silêncio, sem API e sem exceção
   • a cena abre com o body em aniversario-open, entra em is-stable, foca
     e a foto escolhida na edição (data URL) vira destaque
   • o coração continua caindo com o laço de frames ativo
   • a digitação roda em timers: o texto completo termina, o cursor some
   • movimento reduzido: texto completo na hora, ZERO frames de coração
   • Esc fecha e o botão voltar chama onExit (e devolve para a surpresa)
   • setMotion para e religa o coração */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "aniversario.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

const PHOTO = "data:image/png;base64,UEhPVE88";
const PHOTO2 = "data:image/png;base64,UEhPVE8x";

/* ══════════════════════════════════════════════════════════════════
   DOM FALSO — só o que aniversario.js usa, com os eventos sob controle
   ══════════════════════════════════════════════════════════════════ */
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
    _focused: false,
    style: { setProperty(name, value) { this[name] = String(value); } }
  };

  el.classList = makeClassList();

  Object.defineProperty(el, "className", {
    get() { return [...el.classList._set].join(" "); },
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
    set(value) { el._text = String(value); el.children.length = 0; }
  });

  el.setAttribute = (name, value) => {
    el.attrs[name] = String(value);
    if (name === "hidden") el.hidden = true;
  };
  el.removeAttribute = name => {
    delete el.attrs[name];
    if (name === "hidden") el.hidden = false;
  };
  el.appendChild = child => { child.parent = el; el.children.push(child); return child; };
  el.querySelector = selector => findAll(el, selector)[0] || null;
  el.querySelectorAll = selector => findAll(el, selector);
  el.addEventListener = (type, fn) => {
    (el.listeners[type] || (el.listeners[type] = [])).push(fn);
  };
  el.removeEventListener = (type, fn) => {
    const list = el.listeners[type];
    if (list) el.listeners[type] = list.filter(f => f !== fn);
  };
  el.dispatch = (type, event = {}) => {
    (el.listeners[type] || []).slice().forEach(fn => fn(event));
  };
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0,
    width: el.clientWidth || 0, height: el.clientHeight || 0,
    right: el.clientWidth || 0, bottom: el.clientHeight || 0
  });
  el.focus = () => { el._focused = true; };

  /* Canvas: só precisa do que o coração da chuva usa no 2d */
  if (String(tag).toLowerCase() === "canvas") {
    el.getContext = () => ({
      clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
      globalAlpha: 1, fillStyle: "", beginPath() {}, moveTo() {},
      bezierCurveTo() {}, closePath() {}, fill() {}
    });
  }

  return el;
}

function createEnvironment(opts = {}) {
  const o = Object.assign({
    width: 1280, height: 900, reduced: false, withScene: true
  }, opts);

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
    surpriseOpened: false
  };

  const document = {
    hidden: false,
    body: makeElement(env, "body"),
    getElementById(id) { return this._ids[id] || null; },
    createElement(tag) { return makeElement(env, tag); },
    addEventListener(type, fn) {
      (this._handlers[type] || (this._handlers[type] = [])).push(fn);
    },
    removeEventListener() {},
    dispatch(type, event = {}) {
      (this._handlers[type] || []).slice().forEach(fn => fn(event));
    },
    _ids: {},
    _handlers: {}
  };

  const scene = o.withScene ? makeElement(env, "section") : null;
  if (scene) {
    scene.hidden = true;
    scene.setAttribute("tabindex", "-1");
  }
  const hearts = makeElement(env, "canvas");
  const photo = makeElement(env, "img");
  const text = makeElement(env, "p");
  const back = makeElement(env, "button");

  if (scene) {
    Object.assign(document._ids, {
      "aniversario-scene": scene,
      "aniversario-hearts": hearts,
      "aniversario-photo": photo,
      "aniversario-text": text,
      "aniversario-back": back
    });
  }

  const setTimeoutFn = (fn, ms) => {
    const id = ++env.timerSeq;
    env.timers.push({ id, fn, at: env.now + (Number(ms) || 0) });
    return id;
  };
  const clearTimeoutFn = id => {
    env.timers = env.timers.filter(t => t.id !== id);
  };

  const win = {
    innerWidth: o.width,
    innerHeight: o.height,
    devicePixelRatio: 1,
    matchMedia: () => ({
      get matches() { return env.prefReduced; },
      addEventListener(type, fn) { if (type === "change") env.motionHandlers.push(fn); },
      removeEventListener() {},
      addListener(fn) { env.motionHandlers.push(fn); },
      removeListener() {}
    }),
    localStorage: {
      getItem: key => (key in env.storage ? env.storage[key] : null),
      setItem: (key, value) => { env.storage[key] = String(value); }
    },
    ProjetoAmorSurpresa: { open() { env.surpriseOpened = true; } },
    addEventListener(type, fn) {
      (env.windowHandlers[type] || (env.windowHandlers[type] = [])).push(fn);
    },
    removeEventListener() {},
    dispatch(type, event = {}) {
      (env.windowHandlers[type] || []).slice().forEach(fn => fn(event));
    },
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn
  };

  const sandbox = {
    window: win,
    document,
    requestAnimationFrame(fn) {
      const id = ++env.frameSeq;
      env.frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) { env.frames.delete(id); },
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    performance: { now: () => env.now },
    Math, JSON, console, Intl, Date, Number, String, Array, Object
  };

  env.sandbox = sandbox;
  env.document = document;
  env.window = win;
  env.scene = document.getElementById("aniversario-scene");
  env.hearts = document.getElementById("aniversario-hearts");
  env.photo = document.getElementById("aniversario-photo");
  env.text = document.getElementById("aniversario-text");
  env.back = document.getElementById("aniversario-back");

  env.runTimers = ms => {
    const target = env.now + (ms || 0);
    let guard = 0;
    while (guard++ < 2000) {
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
    return win.ProjetoAmorAniversario;
  };

  return env;
}

/* ══════════════════════════════════════════════════════════════════
   CASOS
   ══════════════════════════════════════════════════════════════════ */
function caseSemCena() {
  const env = createEnvironment({ withScene: false });
  env.boot();
  assert(!env.window.ProjetoAmorAniversario, "o módulo não deveria publicar API sem a cena");
  assert(env.frames.size === 0, "nenhum rAF deveria ser agendado");
  return "sem cena: sai em silêncio, sem API e sem rAF";
}

function caseAbrir() {
  const env = createEnvironment();
  const api = env.boot();
  let exited = 0;
  api.open({
    context: { photos: [PHOTO, PHOTO2] },
    onExit: () => exited++
  });
  assert(env.scene.hidden === false, "a cena deveria ficar visível");
  assert(api.isOpen() === true, "a cena deveria estar aberta");
  assert(env.document.body.classList.contains("aniversario-open"), "body deveria entrar em aniversario-open");
  for (let i = 0; i < 4; i++) env.runFrames(1); /* settle: is-stable, foto, timer de digitação */
  assert(env.photo.src === PHOTO, `a foto da edição deveria entrar como destaque (${env.photo.src})`);
  assert(env.photo.classList.contains("is-visible"), "a foto deveria entrar em is-visible");
  assert(env.scene.classList.contains("is-stable"), "após os quadros a cena deveria estar estável");
  assert(env.frames.size >= 1, `o coração deveria estar com o laço de frames ativo (${env.frames.size})`);
  assert(env.scene._focused === true, "a cena deveria receber o foco");

  api.close();
  assert(api.isOpen() === false, "close deveria encerrar a cena na hora");
  assert(env.scene.classList.contains("is-leaving"), "a saída deveria começar em is-leaving");
  env.runTimers(650);
  assert(env.scene.hidden === true, "a cena só pode sumir no fim do fade");
  assert(!env.document.body.classList.contains("aniversario-open"), "o body deveria sair de aniversario-open");
  assert(exited === 1, "o close sem callback deve cair no onExit registrado");
  return "abrir/fechar: body em aniversario-open, foto da edição em is-visible, fade 650 ms";
}

function caseDigitacao() {
  const env = createEnvironment();
  const api = env.boot();
  let done = 0;
  api.open({ context: { photos: [PHOTO] }, onExit: () => done++ });

  for (let i = 0; i < 4; i++) env.runFrames(1); /* settle */
  env.runTimers(900);            /* dispara startTyping */
  env.runTimers(60000);          /* roda a digitação até o fim */

  assert(env.text._text.length > 100, `a digitação deveria ter escrito o texto (${env.text._text.length} chars)`);
  assert(!env.text.classList.contains("is-typing"), "o cursor deveria sumir quando a digitação termina");
  return "digitação: o texto completo termina sozinho e o cursor some";
}

function caseReduzido() {
  const env = createEnvironment({ reduced: true });
  const api = env.boot();
  api.open({ context: { photos: [PHOTO] } });
  env.runFrames(2);
  assert(env.frames.size === 0, `movimento reduzido não pode manter o laço de coração (${env.frames.size} rAF)`);
  env.runTimers(0);              /* executa o startTyping imediato do cenário reduzido */
  assert(env.text._text.length > 100, "no reduzido o texto deveria aparecer completo");
  assert(!env.text.classList.contains("is-typing"), "no reduzido não deveria haver cursor de digitação");
  return "movimento reduzido: ZERO frames de coração, texto completo na hora";
}

function caseTeclado() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ context: { photos: [PHOTO] } });
  env.runFrames(2);
  env.document.dispatch("keydown", { key: "Escape", preventDefault() {} });
  env.runTimers(650);
  assert(api.isOpen() === false, "Esc deveria fechar a homenagem");
  assert(env.scene.hidden === true, "a cena deveria se esconder no fim do fade");
  return "Esc fecha a homenagem";
}

function caseVoltar() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ context: { photos: [PHOTO] } });
  env.runFrames(2);
  env.back.dispatch("click");
  env.runTimers(650);
  assert(env.scene.hidden === true, "o botão voltar deveria fechar a homenagem");
  assert(env.surpriseOpened === true, "o botão voltar deveria devolver para a surpresa");
  return "botão voltar: fecha a homenagem e devolve para a surpresa";
}

function caseSetMotion() {
  const env = createEnvironment({ reduced: true });
  const api = env.boot();
  api.open({ context: { photos: [PHOTO] } });
  for (let i = 0; i < 4; i++) env.runFrames(1);
  assert(env.frames.size === 0, `movimento reduzido não mantém o coração (${env.frames.size} frames)`);
  api.setMotion(true);
  assert(env.frames.size >= 1, "setMotion(true) deveria religar o coração");
  api.setMotion(false);
  assert(env.frames.size === 0, "setMotion(false) deveria parar o coração");
  return "setMotion: para e religa o coração";
}

/* ══════════════════════════════════════════════════════════════════
   Runner
   ══════════════════════════════════════════════════════════════════ */
const cases = [
  ["sem cena", caseSemCena],
  ["abrir/fechar", caseAbrir],
  ["digitação", caseDigitacao],
  ["movimento reduzido", caseReduzido],
  ["teclado", caseTeclado],
  ["voltar", caseVoltar],
  ["setMotion", caseSetMotion]
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    const result = fn();
    console.log(`  ok — ${name} (${result})`);
  } catch (err) {
    failed++;
    console.log(`  FALHOU — ${name}: ${err && err.message}`);
  }
}

if (failed) {
  console.log(`aniversario: ${failed} caso(s) falharam`);
  process.exit(1);
}
console.log("aniversario: todos os casos passaram");
