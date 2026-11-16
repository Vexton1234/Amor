/* Harness headless para js/fotos.js — a página exclusiva das fotografias.
   Não substitui o teste visual: verifica as INVARIANTES do módulo.

   • sem a cena no HTML o módulo sai em silêncio, sem API e sem exceção
   • só data URL de imagem entra; link, SVG e texto são recusados
   • lista vazia não abre a cena
   • as fotos são montadas na ordem do link, com um único cartão na frente
   • a moldura acompanha a proporção real (retrato continua retrato)
   • uma foto só vira retrato central, sem laço de animação
   • abrir entra em cena, trava a rolagem e chama onEnter depois do fade
   • com movimento, o anel gira sozinho
   • fechar cancela o laço, limpa o body e chama onExit
   • movimento reduzido: ZERO rAF de laço, cena composta e parada
   • arraste horizontal gira; vertical e cancelado não giram
   • teclado troca de foto; Esc fecha
   • resize remede sem perder nem reordenar as fotos
   • aba oculta pausa; a volta retoma
   • um abrir repetido não duplica cartões
   • a cena está ligada ao HTML, ao CSS e à surpresa na ordem certa  */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "fotos.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

/* Fotos de teste: data URLs válidas. As dimensões ficam num mapa — o
   harness não decodifica imagem, só devolve a medida que o navegador
   devolveria no evento de carga. */
const PHOTO_META = [
  { src: "data:image/png;base64,UEhPVE8x", w: 800, h: 600 },   /* paisagem */
  { src: "data:image/png;base64,UEhPVE8y", w: 600, h: 800 },   /* retrato  */
  { src: "data:image/png;base64,UEhPVE8z", w: 800, h: 800 },   /* quadrada */
  { src: "data:image/png;base64,UEhPVE80", w: 400, h: 600 }    /* retrato  */
];
const PHOTOS = PHOTO_META.map(p => p.src);

/* ══════════════════════════════════════════════════════════════════
   DOM FALSO — só o que fotos.js usa, com os eventos sob controle
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
    style: {
      setProperty(name, value) { this[name] = String(value); }
    }
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
    set(value) {
      el._text = String(value);
      el.children.length = 0;
    }
  });

  el.setAttribute = (name, value) => {
    el.attrs[name] = String(value);
    if (name === "hidden") el.hidden = true;
  };
  el.removeAttribute = name => {
    delete el.attrs[name];
    if (name === "hidden") el.hidden = false;
  };
  el.appendChild = child => {
    child.parent = el;
    el.children.push(child);
    return child;
  };
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
    width: el.clientWidth || 0,
    height: el.clientHeight || 0,
    right: el.clientWidth || 0,
    bottom: el.clientHeight || 0
  });
  el.focus = () => { el._focused = true; };

  if (el.tagName === "IMG") {
    el.complete = false;
    el.naturalWidth = 0;
    el.naturalHeight = 0;
    Object.defineProperty(el, "src", {
      get() { return el._src || ""; },
      set(value) {
        el._src = String(value);
        const meta = env.photoMeta.get(el._src);
        if (meta) {
          el.naturalWidth = meta.w;
          el.naturalHeight = meta.h;
        } else {
          el.naturalWidth = 0;
          el.naturalHeight = 0;
        }
        el.complete = true;   /* cache quente, como numa revisita */
      }
    });
  }

  return el;
}

function createEnvironment(opts = {}) {
  const o = Object.assign({
    width: 1280, height: 900, stageW: 1200, stageH: 680,
    reduced: false, withScene: true
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
    photoMeta: new Map(PHOTO_META.map(p => [p.src, p]))
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

  if (o.withScene) {
    const scene = makeElement(env, "section");
    scene.hidden = true;
    scene.setAttribute("tabindex", "-1");
    const stage = makeElement(env, "div");
    const ring = makeElement(env, "div");
    const counter = makeElement(env, "span");
    const back = makeElement(env, "button");

    stage.clientWidth = o.stageW;
    stage.clientHeight = o.stageH;
    stage.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0,
      width: o.stageW, height: o.stageH,
      right: o.stageW, bottom: o.stageH
    });

    for (let i = 0; i < 4; i++) scene.appendChild(makeElement(env, "div")).className = "photos-palette";
    scene.appendChild(stage);
    stage.appendChild(ring);
    scene.appendChild(counter);
    scene.appendChild(back);

    Object.assign(document._ids, {
      "photos-scene": scene,
      "photos-stage": stage,
      "photos-ring": ring,
      "photos-counter": counter,
      "photos-back": back
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
  env.scene = document.getElementById("photos-scene");
  env.stage = document.getElementById("photos-stage");
  env.ring = document.getElementById("photos-ring");
  env.counter = document.getElementById("photos-counter");
  env.back = document.getElementById("photos-back");

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
    return win.ProjetoAmorFotos;
  };

  env.cards = () => findAll(env.scene || document.body, ".photos-card");
  env.front = () => findAll(env.scene || document.body, ".photos-card.is-front");
  env.pointer = (x, y, extra = {}) => Object.assign({
    pointerId: 1, pointerType: "mouse", button: 0,
    clientX: x, clientY: y, cancelable: true, preventDefault() {}
  }, extra);
  env.counterText = () => env.counter.textContent;

  return env;
}

/* ══════════════════════════════════════════════════════════════════
   CASOS
   ══════════════════════════════════════════════════════════════════ */
function caseNoScene() {
  const env = createEnvironment({ withScene: false });
  env.boot();
  assert(!env.window.ProjetoAmorFotos, "o módulo não deveria publicar API sem a cena");
  assert(env.frames.size === 0, "nenhum rAF deveria ser agendado");
  return "sem cena: sai em silêncio, sem API e sem rAF";
}

function caseValidation() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ photos: ["http://exemplo.com/foto.png", "data:image/svg+xml;base64,PHN2Zz4=", "", null, 42] });
  assert(api.isOpen() === false, "foto que não é data URL não pode abrir a cena");
  assert(env.scene.hidden === true, "a cena precisa continuar escondida");
  api.open({ photos: [] });
  assert(api.isOpen() === false && env.scene.hidden === true, "lista vazia não abre");
  api.open({});
  assert(api.isOpen() === false, "sem lista não abre");
  return "só data URL de imagem entra; link, SVG, vazio e lixo são recusados";
}

function caseBuild() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ photos: PHOTOS });
  assert(env.scene.hidden === false, "a cena deveria estar visível");
  assert(api.isOpen() === true && api.count() === 4, "4 fotos deveriam estar abertas");
  assert(env.cards().length === 4, "4 cartões deveriam existir");
  assert(env.front().length === 1, "exatamente um cartão na frente");
  assert(env.counterText() === "01 / 04", `contador inesperado: ${env.counterText()}`);
  assert(env.document.body.classList.contains("photos-open"), "body deveria entrar em photos-open");
  assert(env.cards().every(c => c.querySelector("img")), "todo cartão precisa de uma imagem");
  const order = env.cards().map(c => c.querySelector("img").src);
  assert(order.join("|") === PHOTOS.join("|"), "a ordem das fotos precisa ser a do link");
  return "montagem: 4 fotos na ordem do link, um cartão na frente, contador 01 / 04";
}

function caseGeometry() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ photos: PHOTOS });
  env.runFrames(1);

  const dims = env.cards().map(card => ({
    w: parseFloat(card.style["--card-w"]),
    h: parseFloat(card.style["--card-h"]),
    nw: card.querySelector("img").naturalWidth,
    nh: card.querySelector("img").naturalHeight
  }));

  dims.forEach((d, i) => {
    assert(Number.isFinite(d.w) && d.w > 60, `cartão ${i} com largura inválida: ${d.w}`);
    assert(Number.isFinite(d.h) && d.h > 60, `cartão ${i} com altura inválida: ${d.h}`);
    const boxRatio = d.w / d.h;
    const imgRatio = d.nw / d.nh;
    assert(Math.abs(boxRatio - imgRatio) / imgRatio < 0.02,
      `cartão ${i} não preservou a proporção: caixa ${boxRatio.toFixed(3)} × foto ${imgRatio.toFixed(3)}`);
  });

  assert(dims[0].w > dims[0].h, "a foto de paisagem precisa continuar paisagem");
  assert(dims[1].h > dims[1].w, "a foto de retrato precisa continuar retrato");

  env.cards().forEach(card => {
    const raw = card.style.transform + card.style.opacity + card.style.filter + card.style.zIndex;
    assert(!/NaN|Infinity|undefined/.test(raw), `valor inválido no layout: ${raw}`);
  });

  return "geometria: cada moldura mantém a proporção real da foto, sem NaN";
}

function caseRelativeGeometry() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ photos: PHOTOS });
  env.runFrames(1);
  const transforms = env.cards().map(c => c.style.transform);
  assert(new Set(transforms).size === 4, "cada foto do anel precisa de uma posição própria");
  assert(env.cards().every(c => parseFloat(c.style.opacity) >= 0.5 && parseFloat(c.style.opacity) <= 1),
    "as fotos de trás não podem desaparecer por completo");
  return "anel: quatro posições distintas e fotos de trás ainda presentes";
}

function caseSingle() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ photos: [PHOTOS[0]] });
  env.runFrames(1);
  assert(env.cards().length === 1, "uma foto deveria gerar um cartão");
  assert(env.scene.classList.contains("is-single"), "a cena deveria entrar em is-single");
  assert(env.frames.size === 0, `uma foto não deveria manter laço de animação (${env.frames.size} rAF)`);
  const before = env.cards()[0].style.transform;
  env.now += 1500;
  assert(env.cards()[0].style.transform === before, "com uma foto o cartão não pode girar");
  return "uma foto: retrato central, is-single e ZERO rAF de laço";
}

function caseOpenClose() {
  const env = createEnvironment();
  const api = env.boot();
  let entered = 0;
  let exited = 0;

  api.open({ photos: PHOTOS, onEnter: () => entered++, onExit: () => exited++ });
  assert(env.scene.classList.contains("is-entering"), "a entrada deveria começar em is-entering");
  /* Dois quadros: o primeiro é o laço de rotação, o segundo é o que
     promove a cena de is-entering para is-stable. */
  env.runFrames(2);
  assert(env.scene.classList.contains("is-stable"), "depois de um quadro a cena deveria estar estável");
  assert(entered === 0, "onEnter não pode acontecer antes do fade");
  env.runTimers(667);            /* now = 699 ms */
  assert(entered === 0, "onEnter não pode acontecer antes de 700 ms");
  env.runTimers(2);
  assert(entered === 1, "onEnter deveria acontecer uma vez ao fim do fade");
  assert(env.scene._focused === true, "a cena deveria receber o foco");

  api.open({ photos: PHOTOS });
  assert(env.cards().length === 4, "um segundo open não pode duplicar cartões");

  api.close();
  assert(api.isOpen() === false, "close deveria encerrar a cena na hora");
  assert(env.scene.classList.contains("is-leaving"), "a saída deveria começar em is-leaving");
  env.runTimers(619);
  assert(env.scene.hidden === false, "a cena só pode sumir no fim do fade");
  env.runTimers(2);
  assert(env.scene.hidden === true, "a cena deveria estar escondida");
  assert(!env.document.body.classList.contains("photos-open"), "o body deveria sair de photos-open");
  assert(exited === 1, "onExit deveria ser chamado uma vez");
  assert(env.frames.size === 0, "nenhum rAF pode sobreviver ao fechamento");
  return "abrir/fechar: entrada, foco, onEnter em 700 ms, saída em 620 ms e onExit";
}

function caseRotation() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ photos: PHOTOS });
  env.runFrames(2);              /* laço + entrada */
  assert(env.frames.size === 1, "com 4 fotos e movimento deveria haver 1 laço");

  const before = env.cards()[0].style.transform;
  env.runFrames(260, 16);        /* passa dos 2,4 s de respiro inicial */
  const after = env.cards()[0].style.transform;
  assert(before !== after, "o anel deveria girar sozinho com movimento ligado");

  const counterBefore = env.counterText();
  env.runFrames(420, 16);        /* mais ~6,7 s */
  assert(env.counterText() !== counterBefore, "a rotação deveria chegar a outra foto");
  return "rotação automática: o anel gira e o contador acompanha";
}

function caseReduced() {
  const env = createEnvironment({ reduced: true });
  const api = env.boot();
  api.open({ photos: PHOTOS });
  env.runFrames(1);
  assert(env.frames.size === 0, `movimento reduzido não pode manter laço (${env.frames.size} rAF)`);

  const before = env.cards()[0].style.transform;
  env.now += 2200;
  assert(env.cards()[0].style.transform === before, "no reduzido o cartão não pode girar sozinho");
  assert(env.scene.classList.contains("is-stable"), "a cena precisa estar composta");

  api.setMotion(true);
  assert(env.frames.size === 1, "devolver o movimento deveria religar o laço");
  api.setMotion(false);
  assert(env.frames.size === 0, "voltar ao reduzido deveria parar o laço");
  return "movimento reduzido: quadro composto, parado, ZERO rAF; setMotion religa e para";
}

function caseDrag() {
  const env = createEnvironment({ reduced: true });
  const api = env.boot();
  api.open({ photos: PHOTOS });
  env.runFrames(1);

  const before = env.counterText();
  env.stage.dispatch("pointerdown", env.pointer(700, 400));
  env.stage.dispatch("pointermove", env.pointer(600, 400));
  env.stage.dispatch("pointermove", env.pointer(430, 400));
  env.stage.dispatch("pointerup", env.pointer(430, 400));
  assert(env.counterText() !== before, "arraste horizontal deveria trocar a foto principal");
  assert(!env.stage.classList.contains("is-grabbing"), "a classe de arraste deveria sair no fim");

  const afterDrag = env.cards()[0].style.transform;
  env.stage.dispatch("pointerdown", env.pointer(700, 400));
  env.stage.dispatch("pointermove", env.pointer(699, 300));
  env.stage.dispatch("pointerup", env.pointer(699, 300));
  assert(env.cards()[0].style.transform === afterDrag, "gesto vertical não pode girar o anel");

  env.stage.dispatch("pointerdown", env.pointer(700, 400));
  env.stage.dispatch("pointercancel", { pointerId: 1, pointerType: "touch", cancelable: true });
  assert(env.cards()[0].style.transform === afterDrag, "gesto cancelado não pode girar nem pular foto");
  return "gestos: horizontal gira, vertical não, cancelado não navega";
}

function caseKeyboard() {
  const env = createEnvironment({ reduced: true });
  const api = env.boot();
  api.open({ photos: PHOTOS });
  env.runFrames(1);

  const start = env.counterText();
  env.document.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert(env.counterText() !== start, "seta direita deveria trocar de foto");
  const right = env.counterText();
  env.document.dispatch("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert(env.counterText() === start, `seta esquerda deveria voltar para ${start}, veio ${env.counterText()}`);

  env.document.dispatch("keydown", { key: "Escape", preventDefault() {} });
  env.runTimers(30);
  assert(env.scene.hidden === true, "Esc deveria fechar a cena");
  assert(api.isOpen() === false, "a API deveria refletir o fechamento");
  return `teclado: setas trocam (${start} → ${right} → ${start}) e Esc fecha`;
}

function caseResize() {
  const env = createEnvironment({ reduced: true });
  const api = env.boot();
  api.open({ photos: PHOTOS });
  env.runFrames(1);

  const order = env.cards().map(c => c.querySelector("img").src).join("|");
  const beforeW = parseFloat(env.cards()[0].style["--card-w"]);

  env.stage.clientWidth = 380;
  env.stage.clientHeight = 620;
  env.stage.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, width: 380, height: 620, right: 380, bottom: 620
  });
  env.window.innerWidth = 390;
  env.window.innerHeight = 844;
  env.window.dispatch("resize", {});

  const afterW = parseFloat(env.cards()[0].style["--card-w"]);
  assert(env.cards().length === 4, "resize não pode perder fotos");
  assert(env.cards().map(c => c.querySelector("img").src).join("|") === order, "resize não pode reordenar as fotos");
  assert(afterW < beforeW, `no celular a moldura deveria encolher (${beforeW} → ${afterW})`);
  assert(env.frames.size === 0, "resize no reduzido não pode ligar laço");
  return `resize: 4 fotos mantidas, ordem intacta, moldura ${beforeW} → ${afterW} px`;
}

function caseVisibility() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ photos: PHOTOS });
  env.runFrames(2);              /* laço + entrada */
  assert(env.frames.size === 1, "deveria haver um laço ativo");

  env.document.hidden = true;
  env.document.dispatch("visibilitychange", {});
  assert(env.frames.size === 0, "com a aba oculta o laço deveria parar");

  env.document.hidden = false;
  env.document.dispatch("visibilitychange", {});
  assert(env.frames.size === 1, "ao voltar, o laço deveria retomar");
  return "aba oculta: pausa o laço e retoma ao voltar";
}

function caseBrokenPhoto() {
  const env = createEnvironment();
  const api = env.boot();
  api.open({ photos: [PHOTOS[0], "data:image/png;base64,QUJD"] });
  env.runFrames(1);
  assert(env.cards().length === 2, "a foto quebrada não pode derrubar a cena");
  assert(env.cards().some(c => c.classList.contains("is-broken")), "a imagem sem medida deveria ser marcada como quebrada");
  assert(api.count() === 2, "a contagem deveria incluir a foto marcada");
  assert(env.front().length === 1, "a cena continua com uma foto na frente");
  return "foto sem medida: marcada como quebrada, sem derrubar o anel";
}

function caseIntegration() {
  const html = fs.readFileSync(path.join(__dirname, "..", "carta.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "css", "style.css"), "utf8");
  const surpresa = fs.readFileSync(path.join(__dirname, "surpresa.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const index = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  assert(/<section id="photos-scene"[^>]*hidden/.test(html), "a seção #photos-scene precisa existir e nascer escondida");
  assert(/id="photos-stage"/.test(html) && /id="photos-ring"/.test(html), "palco e anel precisam existir");
  assert(/id="photos-counter"/.test(html), "o contador precisa existir");
  assert(/id="photos-back"/.test(html), "a saída precisa existir");

  const iFotos = html.indexOf("js/fotos.js");
  const iSurpresa = html.indexOf("js/surpresa.js");
  const iMain = html.indexOf("js/main.js");
  assert(iFotos > 0 && iFotos < iSurpresa && iFotos < iMain, "fotos.js precisa vir antes de surpresa.js e main.js");
  assert(!/js\/fotos\.js/.test(index), "o editor não precisa carregar a cena das fotos");

  for (const cls of [".photos-scene", ".photos-card", ".photos-palette", "body.photos-open", ".photos-scene.is-single", ":root:not(.motion-forced) .photos-card"]) {
    assert(css.includes(cls), `o CSS precisa da regra ${cls}`);
  }
  assert(/@media \(max-width: 640px\)[\s\S]*?\.photos-scene/.test(css), "o CSS precisa do bloco de celular");
  assert(/data-mood="0"/.test(css), "o CSS precisa das quatro atmosferas");

  assert(/ProjetoAmorFotos/.test(surpresa), "a surpresa precisa conversar com a cena das fotos");
  assert(/schedulePhotosAfterReading/.test(surpresa), "a surpresa precisa convidar a cena ao fim da leitura");
  assert(/suspendSceneForPhotos/.test(surpresa) && /resumeSceneAfterPhotos/.test(surpresa), "a chuva e o som precisam ser suspensos e devolvidos");
  assert(/onEnter:\s*suspendSceneForPhotos/.test(surpresa), "onEnter precisa suspender a cena anterior");
  assert(/onExit:\s*resumeSceneAfterPhotos/.test(surpresa), "onExit precisa devolver a cena anterior");
  assert(/ProjetoAmorFotos[\s\S]*?setMotion/.test(main), "main.js precisa propagar a preferência de movimento");

  return "integração: HTML, CSS, ordem dos scripts, surpresa e setMotion ligados";
}

/* ══════════════════════════════════════════════════════════════════
   EXECUÇÃO
   ══════════════════════════════════════════════════════════════════ */
const cases = [
  ["sem a cena, o módulo sai em silêncio", caseNoScene],
  ["só data URL de imagem entra", caseValidation],
  ["montagem e contador", caseBuild],
  ["a moldura preserva a proporção", caseGeometry],
  ["o anel tem quatro posições distintas", caseRelativeGeometry],
  ["uma foto vira retrato central", caseSingle],
  ["abrir e fechar em ordem", caseOpenClose],
  ["rotação automática", caseRotation],
  ["movimento reduzido", caseReduced],
  ["arraste e cancelamento", caseDrag],
  ["teclado", caseKeyboard],
  ["resize", caseResize],
  ["aba oculta", caseVisibility],
  ["foto quebrada", caseBrokenPhoto],
  ["integração com HTML, CSS e surpresa", caseIntegration]
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
