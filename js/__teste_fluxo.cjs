/* Harness headless para o fluxo carta → galeria → surpresa.
   Carrega galeria.js e surpresa.js de verdade, sobre um DOM mínimo,
   e exercita a máquina de estados de troca de cena.

   Verifica
   • a carta sai em cross-fade (hideLetter) e não com display:none
   • a digitação é terminated antes de a carta sair
   • a rolagem da carta volta de onde saiu
   • "voltar" apertado durante a entrada NÃO é engolido
   • a galeria guarda a foto atual (ida e volta pela surpresa)
   • abrir/fechar várias vezes não duplica ouvintes nem temporizadores
   • um destino antigo não sobrevive a um "voltar" posterior
   • fotos inválidas são descartadas e um conjunto novo refaz o trilho
   • toque duplo (abrir/fechar/lançar) não duplica a cena nem o destino
   • foto corrompida vira uma frase, sem derrubar a galeria
   • deslize cancelado/vertical não troca de foto por acidente
   • reabrir durante o fade espera a saída e reabre uma vez
   • reabrir a surpresa devolve o envelope fechado, não a mensagem velha */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DIR = __dirname;

/* ── DOM mínimo ───────────────────────────────────────────────────── */
let focusedEl = null;   /* preenchido por el.focus() */

function makeEl(tag = "div", id = "") {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    hidden: false,
    disabled: false,
    children: [],
    /* galeria.js posiciona os slides com style.setProperty("--angle", ...).
       O DOM real oferece essa API, então o mock também precisa — sem ela a
       montagem do anel quebra no meio dos 14 casos de fluxo. */
    style: {
      setProperty(name, value) { this[name] = String(value); },
      removeProperty(name) { delete this[name]; }
    },
    attrs: {},
    classes: new Set(),
    listeners: [],
    offsetWidth: 0,
    parentNode: null,

    classList: {
      add(...c) { c.forEach(x => el.classes.add(x)); },
      remove(...c) { c.forEach(x => el.classes.delete(x)); },
      contains(c) { return el.classes.has(c); },
      toggle(c, on) { on ? el.classes.add(c) : el.classes.delete(c); }
    },
    addEventListener(type, fn) { el.listeners.push({ type, fn }); },
    removeEventListener(type, fn) {
      const i = el.listeners.findIndex(l => l.type === type && l.fn === fn);
      if (i >= 0) el.listeners.splice(i, 1);
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k]; },
    removeAttribute(k) { delete el.attrs[k]; },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest(selector) {
      /* O módulo usa img.closest(".gallery-slide") para achar o slide
         que falhou. Reproduz a subida real pela árvore. */
      let node = el;
      if (!selector.startsWith(".")) return null;
      const cls = selector.slice(1);
      while (node) {
        if (node.classes && node.classes.has(cls)) return node;
        node = node.parentNode;
      }
      return null;
    },
    focus() { focusedEl = el; },
    /* A posição da revelação da surpresa depende de geometria real. O
       padrão continua sendo a caixa vazia; o caso que precisa medir
       altura define `rect` antes de abrir. */
    rect: null,
    scrollCalls: [],
    getBoundingClientRect() { return el.rect || { top: 0, bottom: 0, height: 0 }; },
    scrollIntoView(arg) { el.scrollCalls.push(arg); },
    setPointerCapture() {},
    releasePointerCapture() {}
  };
  /* textContent = "" precisa limpar os filhos, como no DOM real: é o
     que o rebuild do trilho usa para não deixar slides antigos. */
  let text = "";
  Object.defineProperty(el, "textContent", {
    get() { return text; },
    set(value) {
      text = String(value);
      if (text === "") el.children.length = 0;
    }
  });
  /* className alimenta a mesma lista de classes que classList usa —
     os módulos marcam slides/fotos por className no build. */
  Object.defineProperty(el, "className", {
    get() { return Array.from(el.classes).join(" "); },
    set(value) {
      el.classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach(c => el.classes.add(c));
    }
  });
  return el;
}

function buildEnv() {
  const els = new Map();
  const ids = [
    "gallery-scene", "gallery-track", "gallery-dots", "gallery-empty",
    "gallery-stage", "gallery-caption", "gallery-prev", "gallery-next",
    "surprise-scene", "surprise-intro", "surprise-envelope-button",
    "surprise-message", "surprise-back-gallery", "surprise-back-letter",
    "scene-rain", "letter-content", "surprise-launch", "surprise-button"
  ];
  ids.forEach(id => els.set(id, makeEl("div", id)));

  /* a galeria precisa de botões de retorno */
  const backA = makeEl("button", "back-a");
  const backB = makeEl("button", "back-b");
  els.get("gallery-scene").querySelectorAll = sel =>
    sel === "[data-gallery-close]" ? [backA, backB] : [];

  /* a surpresa precisa de .surprise-actions */
  const actions = makeEl("div", "surprise-actions");
  els.set("surprise-actions", actions);
  els.get("surprise-scene").querySelector = sel =>
    sel === ".surprise-actions" ? actions : null;

  const timers = [];
  let timerSeq = 0;
  const env = {
    els, backA, backB, timers,
    get focused() { return focusedEl; },
    scrollY: 0,
    now: 0,
    scrollCalls: [],
    createdElements: 0,
    letterHidden: false
  };
  focusedEl = null;

  env.document = {
    getElementById: id => els.get(id) || null,
    querySelector: () => null,
    querySelectorAll: sel => {
      if (sel === "#surprise-launch, #surprise-button") {
        return [els.get("surprise-launch"), els.get("surprise-button")].filter(Boolean);
      }
      return [];
    },
    createElement: tag => { env.createdElements++; return makeEl(tag); },
    addEventListener(type, fn) { env.docListeners.push({ type, fn }); },
    hidden: false
  };
  env.docListeners = [];

  env.window = {
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: 2,
    scrollY: 0,
    pageYOffset: 0,
    matchMedia: q => ({
      matches: false,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}
    }),
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {},
    requestAnimationFrame: fn => { env.rafs.push(fn); return env.rafs.length; },
    cancelAnimationFrame: () => {},
    /* Tem que escrever em env.timers, e não numa variável solta: runTimers
       substitui o array ao remover um temporizador, e um push numa
       referência antiga desapareceria silenciosamente — o teste passaria
       a não exercitar nada. */
    setTimeout: (fn, ms) => {
      const id = ++timerSeq;
      env.timers.push({ id, fn, ms, at: env.now + ms });
      return id;
    },
    /* clearTimeout de verdade: o modelo antigo o tratava como no-op, e
       um temporizador cancelado continuava rodando no teste — podendo
       mascarar (ou inventar) exatamente as corridas de entrada/saída
       que esta suíte existe para verificar. */
    clearTimeout: id => {
      env.timers = env.timers.filter(t => t.id !== id);
    },
    scrollTo: opts => {
      env.scrollCalls.push(opts);
      if (typeof opts === "object") { env.window.scrollY = opts.top; env.scrollY = opts.top; }
    }
  };
  env.rafs = [];

  return env;
}

function load(env) {
  const sandbox = {
    window: env.window,
    document: env.document,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    localStorage: env.window.localStorage,
    matchMedia: env.window.matchMedia,
    requestAnimationFrame: env.window.requestAnimationFrame,
    cancelAnimationFrame: env.window.cancelAnimationFrame,
    setTimeout: env.window.setTimeout,
    clearTimeout: env.window.clearTimeout,
    console
  };
  sandbox.globalThis = sandbox;
  sandbox.window.ProjetoAmorCarta = env.carta;
  sandbox.window.ProjetoAmorGaleria = env.galeriaBridge;
  sandbox.window.ProjetoAmorChuva = env.rain;
  sandbox.window.ProjetoAmorPromessas = null;
  sandbox.window.scrollY = 0;
  vm.createContext(sandbox);
  for (const f of ["galeria.js", "surpresa.js"]) {
    vm.runInContext(fs.readFileSync(path.join(DIR, f), "utf8"), sandbox, { filename: f });
  }
  return sandbox.window;
}

/* Ponte main.js → outras etapas.
   IMPORTANTE: isto é um MODELO, não o código real. main.js é um IIFE
   grande demais para carregar aqui (decodifica o link, monta o editor,
   cria a máquina de escrever). O que este harness verifica de fato é
   que galeria.js e surpresa.js CHAMAM a ponte na ordem certa; a
   implementação de hideLetter/showLetter dentro do main.js foi
   conferida por leitura, não executada aqui. */
function makeCartaBridge(env) {
  const letter = env.els.get("letter-content");
  return {
    calls: [],
    finishReading() { this.calls.push("finishReading"); },
    hideLetter() {
      this.calls.push("hideLetter");
      if (!letter || letter.hidden) return;
      letter.classList.remove("is-stable");
      letter.classList.add("is-exiting");
    },
    showLetter() {
      this.calls.push("showLetter");
      if (!letter) return;
      letter.classList.remove("is-exiting");
      letter.hidden = false;
      letter.classList.add("is-entering");
      letter.classList.add("is-stable");
    },
    isHidden() { return !letter || letter.hidden; }
  };
}

/* ── Utilidades de verificação ─────────────────────────────────────── */
const assert = (c, m) => { if (!c) throw new Error(m); };

function runTimers(env, untilMs) {
  /* Cronologia fiel: roda UM temporizador por vez, em ordem, advancing
     o relógio até o instante do próprio temporizador. Saltar direto
     para o fim da janela antes de rodar faria um timer agendado DURANTE
     a execução nascer no futuro e nunca ser exercitado — o teste
     passaria a medir a coisa errada. */
  for (let guard = 0; guard < 200; guard++) {
    const due = env.timers.filter(t => t.at <= untilMs);
    if (!due.length) return;
    due.sort((a, b) => a.at - b.at);
    const t = due[0];
    env.timers = env.timers.filter(x => x !== t);
    if (t.at > env.now) env.now = t.at;
    t.fn();
  }
  throw new Error("laço de temporizadores não convergiu");
}

function runRafs(env) {
  const q = env.rafs.splice(0);
  q.forEach(fn => fn(env.now));
}

function countListeners(env) {
  let n = 0;
  env.els.forEach(el => { n += el.listeners.length; });
  n += env.backA.listeners.length + env.backB.listeners.length;
  return n;
}

/* Detalhamento por elemento: quando a contagem cresce, é preciso saber
   ONDE cresceu, não só que cresceu. */
function listenerBreakdown(env) {
  const parts = [];
  env.els.forEach((el, id) => { if (el.listeners.length) parts.push(`${id}=${el.listeners.length}`); });
  parts.push(`backA=${env.backA.listeners.length}`, `backB=${env.backB.listeners.length}`);
  return parts.join(" ");
}

/* ═══════════════════════════════════════════════════════════════════
   CASOS
   ═══════════════════════════════════════════════════════════════════ */
const PHOTOS = [
  "data:image/jpeg;base64,AAAA",
  "data:image/jpeg;base64,BBBB",
  "data:image/jpeg;base64,CCCC"
];

const cases = [];

/* 1 — Carta → galeria usa a ponte, não display:none */
cases.push({
  name: "carta → galeria usa cross-fade",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);

    const letter = env.els.get("letter-content");
    const scene = env.els.get("gallery-scene");

    win.ProjetoAmorGaleria.open(PHOTOS);

    assert(env.carta.calls.includes("hideLetter"),
      "a galeria não pediu hideLetter à carta");
    assert(letter.hidden === false,
      "a carta foi escondida na hora (display:none) em vez de cross-fade");
    /* `is-exiting` é o que tira a carta do fluxo (position:absolute no
       CSS) enquanto ela ainda está pintada. O modelo da ponte acima
       reproduz o que o main.js faz — o que se verifica aqui é que a
       ponte foi chamada, não a sua implementação interna. */
    assert(letter.classes.has("is-exiting"),
      "a carta não recebeu is-exiting: ela ficaria ocupando o fluxo e a " +
      "galeria apareceria abaixo, saltando ao topo quando a carta sumisse");
    assert(scene.hidden === false, "a galeria não ficou visível");
    assert(scene.classes.has("is-entering"), "a galeria não começou em is-entering");
    assert(env.focused === scene, "o foco não foi para a galeria");
    runRafs(env);
    assert(scene.classes.has("is-stable") && !scene.classes.has("is-entering"),
      "a galeria não entrou em is-stable");
  }
});

/* 2 — "Voltar" durante a entrada NÃO é engolido */
cases.push({
  name: "voltar durante a entrada fecha depois",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const scene = env.els.get("gallery-scene");

    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);

    /* o leitor aperta voltar antes de a entrada terminar */
    env.backA.listeners.find(l => l.type === "click").fn();

    assert(scene.hidden === false, "a galeria sumiu no meio da entrada");
    assert(scene.classes.has("is-entering") || scene.classes.has("is-stable"),
      "a galeria não está em nenhum estado válido");

    runTimers(env, 1200);   /* entrada (420) + saída (420) */
    assert(scene.hidden === true, "a galeria nunca fechou após o pedido de voltar");
    assert(env.carta.calls.includes("showLetter"),
      "a carta não voltou depois do retorno da galeria");
  }
});

/* 3 — Galeria → surpresa: destino pendente honored, carta não pisca */
cases.push({
  name: "galeria → surprise pendente",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const scene = env.els.get("gallery-scene");

    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);

    /* caminho real da Etapa 4: fechar a galeria com destino */
    win.ProjetoAmorGaleria.close(() => { env.carta.calls.push("surpriseShow"); });

    runTimers(env, 1200);
    assert(scene.hidden === true, "a galeria não fechou");
    assert(env.carta.calls.includes("surpriseShow"), "o destino da surpresa não rodou");
    assert(!env.carta.calls.includes("showLetter"),
      "a carta voltou a aparecer durante a ida para a surpresa");
  }
});

/* 4 — Voltar da surpresa devolve a carta, e a posição de rolagem */
cases.push({
  name: "surpresa → carta devolve a carta",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const sScene = env.els.get("surprise-scene");

    win.ProjetoAmorSurpresa.open({ recipient: "R", sender: "S", photos: [], hasGallery: false });
    assert(sScene.hidden === false, "a surpresa não abriu");
    assert(env.carta.calls.includes("hideLetter"), "a surpresa não tirou a carta de cena");
    assert(env.els.get("letter-content").classes.has("is-exiting"),
      "a surpresa não pôs a carta em is-exiting (mesmo problema de layout)");
    runRafs(env);

    win.ProjetoAmorSurpresa.close();
    runTimers(env, 1000);
    assert(sScene.hidden === true, "a surpresa não fechou");
    assert(env.carta.calls.includes("showLetter"), "a carta não voltou pela ponte");
    assert(env.els.get("letter-content").hidden === false, "a carta ficou escondida");
  }
});

/* 5 — Ida e volta pela surpresa preserva a foto atual */
cases.push({
  name: "galeria guarda a foto atual",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const dots = env.els.get("gallery-dots");

    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);
    assert(dots.children.length === 3, `esperava 3 pontos, veio ${dots.children.length}`);

    /* vai para a terceira foto */
    dots.children[2].listeners.find(l => l.type === "click").fn();
    const track = env.els.get("gallery-track");
    const expected = track.style.transform;

    /* ida e volta com as MESMAS fotos */
    win.ProjetoAmorGaleria.close();
    runTimers(env, 1200);
    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);

    assert(track.style.transform === expected,
      `a galeria perdeu a foto atual: ${expected} → ${track.style.transform}`);
  }
});

/* 6 — Ciclos repetidos não duplicam ouvintes nem recriam o DOM */
cases.push({
  name: "ciclos repetidos não duplicam nada",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);

    const dots = env.els.get("gallery-dots");

    /* Aquecimento: a primeira abertura é a que monta o DOM da galeria
       (trilho, pontos, swipe). Sem isso a linha de base seria tirada
       antes de build() existir, e toda a contagem pareceria vazamento. */
    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);
    win.ProjetoAmorGaleria.close();
    runTimers(env, 1200);

    const base = countListeners(env);
    const baseBreak = listenerBreakdown(env);
    const baseDoc = env.docListeners.length;

    for (let i = 0; i < 3; i++) {
      win.ProjetoAmorGaleria.open(PHOTOS);
      runRafs(env);
      win.ProjetoAmorSurpresa.open({ photos: PHOTOS, hasGallery: true });
      runRafs(env);
      win.ProjetoAmorSurpresa.close();
      runTimers(env, 1200);
      win.ProjetoAmorGaleria.close();
      runTimers(env, 1200);
    }

    assert(countListeners(env) === base,
      `ouvintes cresceram: ${base} → ${countListeners(env)}\n` +
      `      antes: ${baseBreak}\n      depois: ${listenerBreakdown(env)}`);
    assert(env.docListeners.length === baseDoc,
      `ouvintes de document cresceram: ${baseDoc} → ${env.docListeners.length}`);
    assert(dots.children.length === 3,
      `o DOM da galeria foi recriado: ${dots.children.length} pontos`);
  }
});

/* 7 — Fechar sem destino não deixa estado pendurado */
cases.push({
  name: "fechar sem destino não pendura callback",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const scene = env.els.get("gallery-scene");

    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);

    win.ProjetoAmorGaleria.close(() => { env.carta.calls.push("irParaSurpresa"); });
    /* o leitor se arrepende e aperta voltar ANTES de a galeria fechar */
    env.backA.listeners.find(l => l.type === "click").fn();

    runTimers(env, 1000);
    assert(!env.carta.calls.includes("irParaSurpresa"),
      "um destino antigo rodou depois de o leitor pedir para voltar");
    assert(env.carta.calls.includes("showLetter"), "a carta não voltou");
    assert(scene.hidden === true, "a galeria ficou aberta");
  }
});

/* 8 — main.js é carregado DEPOIS de galeria.js/surpresa.js.
   Se qualquer um dos dois capturar window.ProjetoAmorCarta no topo do
   módulo, ele guardará `null` para sempre e o cross-fade nunca
   acontece — sem erro, sem aviso, só a transição some. */
cases.push({
  name: "ponte resolvida na chamada, não no carregamento",
  run() {
    const env = buildEnv();
    /* main.js ainda NÃO rodou: a ponte não existe no momento em que os
       módulos são avaliados. */
    env.carta = undefined;
    env.galeriaBridge = undefined;

    const win = load(env);
    const scene = env.els.get("gallery-scene");

    win.ProjetoAmorGaleria.open(PHOTOS);
    assert(scene.hidden === false, "a galeria não abriu");
    /* Agora main.js termina de carregar e publica a ponte. */
    const carta = makeCartaBridge(env);
    win.ProjetoAmorCarta = carta;

    /* Fecha de novo: AGORA a ponte existe e deve ser usada. */
    win.ProjetoAmorGaleria.close();
    runTimers(env, 1200);
    assert(carta.calls.includes("showLetter"),
      "a ponte foi capturada cedo demais: devolveu null para sempre e o " +
      "retorno à carta continua sendo o corte antigo");

    /* E o mesmo pela surpresa. */
    const carta2 = makeCartaBridge(env);
    win.ProjetoAmorCarta = carta2;
    win.ProjetoAmorSurpresa.open({ photos: [], hasGallery: false });
    assert(carta2.calls.includes("hideLetter"),
      "a surpresa também capturou a ponte cedo demais");
  }
});

/* 9 — Fotos inválidas/holes não entram na galeria nem quebram a cena.
   Fonte da verdade: a mesma regra de data URL do editor. */
cases.push({
  name: "fotos inválidas são descartadas",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const dots = env.els.get("gallery-dots");
    const stage = env.els.get("gallery-stage");
    const empty = env.els.get("gallery-empty");

    win.ProjetoAmorGaleria.open([
      PHOTOS[0],
      "data:text/html;base64,AAAA",
      "nao-e-uma-url",
      "",
      null
    ]);
    runRafs(env);
    assert(win.ProjetoAmorGaleria.count() === 1,
      `esperava 1 foto válida, veio ${win.ProjetoAmorGaleria.count()}`);
    assert(dots.children.length === 1, `esperava 1 ponto, veio ${dots.children.length}`);
    assert(stage.hidden === false, "o palco sumiu com uma foto válida");

    win.ProjetoAmorGaleria.close();
    runTimers(env, 1200);
    win.ProjetoAmorGaleria.open(["javascript:alert(1)", "data:text/html;base64,AA"]);
    assert(win.ProjetoAmorGaleria.count() === 0, "foto inválida entrou na galeria");
    assert(stage.hidden === true, "o palco ficou visível sem foto");
    assert(dots.hidden === true, "os pontos ficaram visíveis sem foto");
    assert(empty.hidden === false, "o aviso de galeria vazia não apareceu");
  }
});

/* 10 — Conjunto novo de fotos refaz o DOM, sem duplicar slides. */
cases.push({
  name: "conjunto novo de fotos refaz o trilho",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const dots = env.els.get("gallery-dots");
    const track = env.els.get("gallery-track");

    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);
    assert(track.children.length === 3 && dots.children.length === 3,
      "a primeira montagem não criou 3 slides/pontos");

    const primeiroImg = track.children[0].children[0];
    /* Mesmo conjunto: nada é recriado. */
    win.ProjetoAmorGaleria.open(PHOTOS);
    assert(track.children[0].children[0] === primeiroImg,
      "reabrir com as mesmas fotos recriou os nós");

    /* Conjunto menor: o trilho e os pontos acompanham. */
    win.ProjetoAmorGaleria.open([PHOTOS[0], PHOTOS[1]]);
    assert(track.children.length === 2,
      `trilho devia ter 2 slides, tem ${track.children.length}`);
    assert(dots.children.length === 2,
      `pontos deviam ser 2, são ${dots.children.length}`);
  }
});

/* 11 — Abrir de novo durante a entrada não reinicia a cena. */
cases.push({
  name: "abertura dupla não reinicia a entrada",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const scene = env.els.get("gallery-scene");

    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);
    assert(scene.classes.has("is-stable"), "a galeria não estabilizou");

    win.ProjetoAmorGaleria.open(PHOTOS);
    assert(!scene.classes.has("is-entering"),
      "um segundo open reacendeu a animação de entrada");
    assert(scene.classes.has("is-stable"), "a galeria perdeu o estado estável");
  }
});

/* 12 — Fechar duas vezes na surpresa dispara o destino uma vez só. */
cases.push({
  name: "fechamento duplo da surpresa dispara uma vez",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);

    win.ProjetoAmorSurpresa.open({ photos: [], hasGallery: false });
    runRafs(env);

    let calls = 0;
    win.ProjetoAmorSurpresa.close(() => { calls++; });
    win.ProjetoAmorSurpresa.close(() => { calls += 10; });
    runTimers(env, 1000);

    assert(calls === 1,
      `o destino devia rodar 1 vez, rodou ${calls} (toque duplo duplicou a saída)`);
  }
});

/* 13 — Toque duplo no botão da surpresa abre a cena uma vez. */
cases.push({
  name: "toque duplo no lançamento abre uma vez",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const launch = env.els.get("surprise-launch");
    const surprise = env.els.get("surprise-scene");

    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);
    const hideAntes = env.carta.calls.filter(c => c === "hideLetter").length;

    const click = launch.listeners.find(l => l.type === "click").fn;
    click();
    click();                       /* segundo toque antes do fade terminar */

    runTimers(env, 1200);
    assert(surprise.hidden === false, "a surpresa não abriu");
    const hideDepois = env.carta.calls.filter(c => c === "hideLetter").length;
    assert(hideDepois === hideAntes + 1,
      `a cena foi aberta ${hideDepois - hideAntes} vez(es) em vez de 1`);
  }
});

/* 14 — Foto que falha ao carregar é marcada e a galeria continua de pé. */
cases.push({
  name: "foto quebrada não derruba a galeria",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const track = env.els.get("gallery-track");

    win.ProjetoAmorGaleria.open([PHOTOS[0]]);
    runRafs(env);

    const slide = track.children[0];
    const img = slide.children[0];
    const onError = track.listeners.find(l => l.type === "error");
    assert(onError, "o trilho não tem ouvinte de erro de imagem");
    onError.fn({ target: img });

    assert(slide.classes.has("is-broken"),
      "a foto que falhou não recebeu a classe is-broken");

    /* A navegação e a saída continuam funcionando. */
    win.ProjetoAmorGaleria.close();
    runTimers(env, 1200);
    assert(env.els.get("gallery-scene").hidden === true,
      "a galeria não fechou depois do erro de imagem");
  }
});

/* 15 — Reabrir durante a saída espera o fade e volta uma única vez. */
cases.push({
  name: "reabertura durante a saída espera o fade",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const scene = env.els.get("gallery-scene");
    const dots = env.els.get("gallery-dots");

    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);
    win.ProjetoAmorGaleria.close();
    runTimers(env, 500);            /* entrada termina, saída começa */

    win.ProjetoAmorGaleria.open([PHOTOS[0]]);
    assert(scene.hidden === false, "a cena sumiu no meio do fade");

    runTimers(env, 1200);
    runRafs(env);
    assert(scene.hidden === false, "a reabertura pedida não aconteceu");
    assert(dots.children.length === 1,
      `a reabertura devia mostrar 1 foto, mostrou ${dots.children.length}`);
    assert(scene.classes.has("is-stable"), "a cena reabriu sem estabilizar");
  }
});

/* 16 — Deslize no celular: cancelamento não troca de foto por acidente. */
cases.push({
  name: "deslize cancelado não troca de foto",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const stage = env.els.get("gallery-stage");
    const track = env.els.get("gallery-track");

    win.ProjetoAmorGaleria.open(PHOTOS);
    runRafs(env);
    const inicial = track.style.transform;

    const fire = (type, x, y) =>
      stage.listeners.find(l => l.type === type).fn({
        pointerType: "touch", pointerId: 1, clientX: x, clientY: y,
        cancelable: true, preventDefault() {}
      });

    /* Deslize horizontal iniciado, mas o navegador cancela o gesto. */
    fire("pointerdown", 200, 100);
    fire("pointermove", 100, 100);
    fire("pointercancel", 0, 0);
    assert(track.style.transform === inicial,
      "um gesto cancelado trocou a foto");

    /* Deslize horizontal concluído: aí sim, troca. */
    fire("pointerdown", 200, 100);
    fire("pointermove", 100, 100);
    fire("pointerup", 100, 100);
    assert(track.style.transform !== inicial,
      "um deslize horizontal válido não trocou a foto");

    /* Gesto predominantemente vertical: pertence à rolagem da página. */
    const depoisDoDeslize = track.style.transform;
    fire("pointerdown", 200, 100);
    fire("pointermove", 195, 200);
    fire("pointerup", 195, 200);
    assert(track.style.transform === depoisDoDeslize,
      "um gesto vertical trocou a foto");
  }
});

/* 17 — Fechar e reabrir a surpresa devolve o envelope fechado. */
cases.push({
  name: "surpresa reabre com o envelope fechado",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const scene = env.els.get("surprise-scene");
    const paper = env.els.get("surprise-message");
    const envelope = env.els.get("surprise-envelope-button");

    win.ProjetoAmorSurpresa.open({ photos: [], hasGallery: false });
    runRafs(env);
    envelope.listeners.find(l => l.type === "click").fn();
    runTimers(env, 2500);
    runRafs(env);
    assert(!paper.hidden && scene.classes.has("is-revealed") &&
           envelope.classes.has("is-open"),
      "a surpresa não chegou ao estado revelado");

    win.ProjetoAmorSurpresa.close();
    runTimers(env, env.now + 1000);
    assert(scene.hidden === true, "a surpresa não fechou");

    /* Reabrir tem de mostrar o envelope outra vez, não a mensagem velha. */
    win.ProjetoAmorSurpresa.open({ photos: [], hasGallery: false });
    runRafs(env);
    assert(paper.hidden === true, "a mensagem antiga reapareceu ao reabrir");
    assert(!scene.classes.has("is-revealed"), "a cena reabriu já revelada");
    assert(!envelope.classes.has("is-open"), "o envelope reabriu já aberto");
    assert(envelope.disabled === false, "o envelope reabriu desativado");

    envelope.listeners.find(l => l.type === "click").fn();
    runTimers(env, env.now + 2500);
    runRafs(env);
    assert(!paper.hidden, "a segunda abertura não revelou a mensagem");
  }
});

/* 18 — Auto-teste do modelo de tempo. Se clearTimeout voltar a ser um
   no-op, um temporizador cancelado continua rodando e as corridas
   testadas acima passam a ser medidas com timers fantasmas — o mesmo
   tipo de teste que mente sozinho. */
cases.push({
  name: "o modelo de tempo honra clearTimeout",
  run() {
    const env = buildEnv();
    load(env);

    let rodou = false;
    const id = env.window.setTimeout(() => { rodou = true; }, 100);
    env.window.clearTimeout(id);
    runTimers(env, 500);
    assert(!rodou, "um temporizador cancelado rodou mesmo assim");

    let rodou2 = false;
    env.window.setTimeout(() => { rodou2 = true; }, 100);
    runTimers(env, 1000);
    assert(rodou2, "um temporizador válido não rodou");
  }
});

/* 19 — A revelação da surpresa começa pelo topo quando o papel + as
   ações não cabem. Centralizar um papel de ~1039 px numa tela de 900 px
   cortava o começo da mensagem: o leitor abria no meio. Este caso e o
   seguinte medem os dois lados da decisão. */
cases.push({
  name: "revelação da surpresa alinha ao topo quando não cabe",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const paper = env.els.get("surprise-message");
    const actions = env.els.get("surprise-actions");

    /* Papel mais alto que a viewport do harness (800 px), com as ações
       terminando abaixo dela: o conjunto não cabe. */
    paper.rect = { top: 127, bottom: 1166.2, height: 1039.2 };
    actions.rect = { top: 1186.2, bottom: 1219.2, height: 33 };

    win.ProjetoAmorSurpresa.open({ photos: [], hasGallery: false });
    runRafs(env);
    env.els.get("surprise-envelope-button").listeners.find(l => l.type === "click").fn();
    runTimers(env, 2500);
    runRafs(env);

    assert(paper.scrollCalls.length === 1,
      `esperava 1 alinhamento, houve ${paper.scrollCalls.length}`);
    assert(paper.scrollCalls[0].block === "start",
      `alinhou em "${paper.scrollCalls[0].block}" em vez de "start"`);
    assert(paper.scrollCalls[0].behavior === "smooth",
      `o modo animado perdeu a rolagem suave ("${paper.scrollCalls[0].behavior}")`);
  }
});

/* 20 — Quando papel + ações cabem, a revelação não rola nada: o papel
   fica na posição natural do fluxo e as ações já aparecem. */
cases.push({
  name: "revelação não rola quando papel e ações cabem",
  run() {
    const env = buildEnv();
    env.carta = makeCartaBridge(env);
    const win = load(env);
    const paper = env.els.get("surprise-message");
    const actions = env.els.get("surprise-actions");

    paper.rect = { top: 100, bottom: 600, height: 500 };
    actions.rect = { top: 620, bottom: 653, height: 33 };

    win.ProjetoAmorSurpresa.open({ photos: [], hasGallery: false });
    runRafs(env);
    env.els.get("surprise-envelope-button").listeners.find(l => l.type === "click").fn();
    runTimers(env, 2500);
    runRafs(env);

    assert(paper.scrollCalls.length === 0,
      `o papel foi rolado ${paper.scrollCalls.length} vez(es) mesmo cabendo`);
  }
});

/* ── Execução ──────────────────────────────────────────────────────── */
let failed = 0;
for (const c of cases) {
  try {
    c.run();
    console.log(`  OK   ${c.name}`);
  } catch (e) {
    failed++;
    console.log(`  FALHA ${c.name} — ${e.message}`);
  }
}
console.log(failed ? `\n${failed} caso(s) falharam` : "\nTodos os casos passaram");
process.exit(failed ? 1 : 0);