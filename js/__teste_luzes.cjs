/* Harness headless para js/luzes.js.
   Não substitui teste visual — verifica as INVARIANTES da camada:

   • sem o canvas na página o módulo sai em silêncio, sem exceção
   • a composição é uma cena espalhada (não um ponto) e cabe na tela
   • a paleta é só de luz quente (nunca branco puro ou cor fria)
   • os 10 sprites são pré-renderizados UMA vez; o laço não cria
     gradiente nem superfície por quadro
   • nenhum NaN/Infinity chega ao contexto 2D
   • movimento reduzido: um único quadro estático, ZERO rAF
   • com movimento: ~10 pinturas/s, não 60
   • start() repetido não duplica o laço; stop() cancela e limpa
   • resize mede de novo, limita o dpr a 1.25 e NÃO re-sorteia a cena
   • aba oculta pausa o rAF; a volta retoma
   • a preferência do sistema e a de outra aba chegam ao módulo
   • setMotion liga/desliga sem reiniciar a cena
   • no celular há menos luzes e nenhuma no miolo do texto
   • a camada está ligada à cena na ordem certa (atrás da chuva)      */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "luzes.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

/* ══════════════════════════════════════════════════════════════════
   AMBIENTE — canvas e relógio controlados pelo teste
   ══════════════════════════════════════════════════════════════════ */
function makeCtx(counter, draws) {
  const check = (name, args) => {
    for (const a of args) {
      if (typeof a === "number" && !Number.isFinite(a)) {
        throw new Error(`ctx.${name} recebeu valor não-finito: ${args.join(", ")}`);
      }
    }
  };
  const ctx = {
    canvas: null,
    globalAlpha: 1,
    fillStyle: "",
    setTransform(...a) { check("setTransform", a); counter.ops++; },
    clearRect(...a) { check("clearRect", a); counter.clears++; counter.ops++; },
    drawImage(...a) {
      check("drawImage", a);
      counter.draws++;
      counter.ops++;
      if (draws) draws.push(a);
    },
    createRadialGradient(...a) {
      check("createRadialGradient", a);
      counter.gradients++;
      return {
        addColorStop(stop, color) {
          if (typeof stop !== "number" || !Number.isFinite(stop)) {
            throw new Error(`addColorStop com parada inválida: ${stop}`);
          }
          if (typeof color !== "string" || !/^rgba?\(/.test(color)) {
            throw new Error(`addColorStop com cor inválida: ${color}`);
          }
        }
      };
    },
    fillRect(...a) { check("fillRect", a); counter.ops++; }
  };
  return new Proxy(ctx, {
    get(t, k) { return k in t ? t[k] : undefined; },
    set(t, k, v) {
      if (typeof v === "number" && !Number.isFinite(v)) {
        throw new Error(`ctx.${k} = valor não-finito: ${v}`);
      }
      t[k] = v;
      return true;
    }
  });
}

function makeSurface(counter) {
  counter.surfaces++;
  return {
    width: 0,
    height: 0,
    getContext: () => makeCtx(counter, null)
  };
}

/* Instrumentação SOMENTE DE TESTE: expõe a composição e o estado.
   Nada disso toca o disco. */
function instrument(src) {
  const from = "\n  window.ProjetoAmorLuzes = {";
  if (!src.includes(from)) {
    throw new Error("âncora de instrumentação não encontrada");
  }
  return src.replace(
    from,
    "\n  window.__dbg = {" +
    " get lights(){return lights}, get sprites(){return sprites}," +
    " get colors(){return COLORS}, get width(){return width}," +
    " get height(){return height}, get dpr(){return dpr}," +
    " get reduced(){return reduced}" +
    " };\n" +
    "  window.ProjetoAmorLuzes = {"
  );
}

function build(opts) {
  const o = Object.assign({
    width: 1440, height: 900, dpr: 2, reduced: false,
    offscreen: false, noCanvas: false
  }, opts);

  const counter = { ops: 0, clears: 0, draws: 0, gradients: 0, surfaces: 0 };
  const draws = [];
  const frames = [];
  const cancelled = new Set();
  const timers = [];
  const winHandlers = {};
  const docHandlers = {};
  const motionHandlers = [];
  const storage = {};
  const env = { now: 0, ran: 0, prefReduced: o.reduced };

  let frameId = 0;
  let timerId = 0;

  const mainCtx = makeCtx(counter, draws);
  const canvas = o.noCanvas ? null : {
    width: 0, height: 0, style: {},
    getContext: () => mainCtx
  };

  const win = {
    innerWidth: o.width,
    innerHeight: o.height,
    devicePixelRatio: o.dpr,
    matchMedia: () => ({
      get matches() { return env.prefReduced; },
      addEventListener(type, fn) { if (type === "change") motionHandlers.push(fn); },
      removeEventListener() {},
      addListener(fn) { motionHandlers.push(fn); },
      removeListener() {}
    }),
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); }
    },
    addEventListener(type, fn) { (winHandlers[type] || (winHandlers[type] = [])).push(fn); },
    removeEventListener() {}
  };

  const document = {
    hidden: false,
    getElementById: id => (id === "scene-bokeh" && !o.noCanvas ? canvas : null),
    createElement: () => makeSurface(counter),
    addEventListener(type, fn) { (docHandlers[type] || (docHandlers[type] = [])).push(fn); },
    removeEventListener() {}
  };

  const sandbox = {
    window: win,
    document,
    requestAnimationFrame(fn) {
      const id = ++frameId;
      frames.push({ id, fn });
      return id;
    },
    cancelAnimationFrame(id) { cancelled.add(id); },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.push({ id, fn, ms: Number(ms) || 0 });
      return id;
    },
    clearTimeout(id) {
      const i = timers.findIndex(t => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    performance: { now: () => env.now },
    Math, Date, JSON, console
  };

  if (o.offscreen) {
    sandbox.OffscreenCanvas = class OffscreenCanvas {
      constructor(w, h) {
        counter.surfaces++;
        this.width = w;
        this.height = h;
      }
      getContext() { return makeCtx(counter, null); }
    };
  }

  sandbox.globalThis = sandbox;

  env.win = win;
  env.document = document;
  env.canvas = canvas;
  env.counter = counter;
  env.draws = draws;
  env.frames = frames;
  env.ran = 0;

  env.activeFrames = () => frames.filter(f => !cancelled.has(f.id)).length;

  env.step = (n, ms) => {
    let ran = 0;
    for (let i = 0; i < n; i++) {
      let entry = null;
      while (frames.length) {
        const f = frames.shift();
        if (!cancelled.has(f.id)) { entry = f; break; }
      }
      if (!entry) break;
      env.now += ms;
      entry.fn(env.now);
      ran++;
    }
    env.ran += ran;
    return ran;
  };

  env.fireTimers = (maxMs) => {
    const limit = maxMs === undefined ? Infinity : maxMs;
    const due = timers.filter(t => t.ms <= limit);
    for (const t of due) {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
      t.fn();
    }
    return due.length;
  };

  env.dispatchWindow = (type, event) => {
    for (const fn of winHandlers[type] || []) fn(event || {});
  };
  env.dispatchDoc = (type, event) => {
    for (const fn of docHandlers[type] || []) fn(event || {});
  };
  env.setPrefReduced = (v) => {
    env.prefReduced = !!v;
    for (const fn of motionHandlers) fn({ matches: env.prefReduced });
  };

  vm.createContext(sandbox);
  vm.runInContext(instrument(fs.readFileSync(SRC, "utf8")), sandbox, { filename: "luzes.js" });

  env.api = win.ProjetoAmorLuzes;
  env.dbg = win.__dbg;
  return env;
}

/* ══════════════════════════════════════════════════════════════════
   CASO 1 — sem canvas, sai em silêncio e não agenda nada
   ══════════════════════════════════════════════════════════════════ */
function caseNoCanvas() {
  const env = build({ noCanvas: true });
  assert(env.api === undefined, "o módulo não deveria expor API sem canvas");
  assert(env.counter.surfaces === 0, "criou sprites sem canvas na página");
  assert(env.activeFrames() === 0, "agendou rAF sem canvas");
  return "sem API, sem sprites, sem rAF";
}

/* ══════════════════════════════════════════════════════════════════
   CASO 2 — a composição é uma cena, não um ponto
   ══════════════════════════════════════════════════════════════════ */
function caseComposition() {
  const env = build({});
  const lights = env.dbg.lights;
  assert(lights.length === 16, `esperava 16 luzes, veio ${lights.length}`);

  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  let breathing = 0, staticOnes = 0;
  for (const l of lights) {
    assert(l.nx >= 0.03 && l.nx <= 0.97, `x fora da tela: ${l.nx}`);
    assert(l.ny >= 0.04 && l.ny <= 0.96, `y fora da tela: ${l.ny}`);
    assert(l.r > 0 && Number.isFinite(l.r), `raio inválido: ${l.r}`);
    assert(l.a0 > 0 && l.a0 <= 0.4, `opacidade inválida: ${l.a0}`);
    assert(l.squash > 0.9 && l.squash < 1.1, `achatamento inválido: ${l.squash}`);
    if (l.amp > 0) breathing++; else staticOnes++;
    minX = Math.min(minX, l.nx); maxX = Math.max(maxX, l.nx);
    minY = Math.min(minY, l.ny); maxY = Math.max(maxY, l.ny);
  }

  assert(maxX - minX > 0.8, `luzes concentradas na horizontal: ${minX}..${maxX}`);
  assert(maxY - minY > 0.7, `luzes concentradas na vertical: ${minY}..${maxY}`);
  assert(breathing > 0, "nenhuma luz respira — a camada vira um quadro estático");
  assert(staticOnes > 0, "todas as luzes respiram — a cena pulsa em compasso");

  /* As maiores são pintadas primeiro: uma luz menor não pode ser
     engolida pelo halo de uma maior. */
  for (let i = 1; i < lights.length; i++) {
    assert(lights[i - 1].r >= lights[i].r, "a ordem de pintura não é do maior para o menor");
  }

  return `${lights.length} luzes, x ${minX.toFixed(2)}..${maxX.toFixed(2)}, ` +
         `y ${minY.toFixed(2)}..${maxY.toFixed(2)}, ${breathing} respirando / ${staticOnes} fixas`;
}

/* ══════════════════════════════════════════════════════════════════
   CASO 3 — a paleta é só de luz quente
   ══════════════════════════════════════════════════════════════════ */
function casePalette() {
  const env = build({});
  const colors = env.dbg.colors;
  assert(colors.length === 5, `esperava 5 tons, veio ${colors.length}`);
  for (const c of colors) {
    for (const v of c) assert(v >= 0 && v <= 255, `canal fora de 0..255: ${v}`);
    assert(c[0] >= c[1] && c[1] >= c[2],
      `tom frio ou fora da família do quente: rgb(${c.join(",")})`);
    assert(c[0] > c[2] + 40, `tom sem dominância quente: rgb(${c.join(",")})`);
    assert(c[2] < 220, `azul alto demais para uma lâmpada âmbar: ${c[2]}`);
  }
  return colors.map(c => `rgb(${c.join(",")})`).join(" ");
}

/* ══════════════════════════════════════════════════════════════════
   CASO 4 — sprites pré-renderizados uma vez só
   ══════════════════════════════════════════════════════════════════ */
function caseSprites() {
  const env = build({});
  assert(env.counter.surfaces === 10, `esperava 10 sprites (5 cores × 2), veio ${env.counter.surfaces}`);
  assert(env.counter.gradients === 15, `esperava 15 gradientes na criação, veio ${env.counter.gradients}`);
  assert(env.dbg.sprites.length === 5, "sprites não indexados por cor");
  for (const pair of env.dbg.sprites) {
    assert(pair.halo && pair.core, "faltou o sprite de halo ou de núcleo");
  }

  const surfacesBefore = env.counter.surfaces;
  const gradientsBefore = env.counter.gradients;
  env.api.start();
  for (let i = 0; i < 1200; i++) env.step(1, 16.7);

  assert(env.counter.surfaces === surfacesBefore,
    `o laço criou ${env.counter.surfaces - surfacesBefore} superfícies novas`);
  assert(env.counter.gradients === gradientsBefore,
    `o laço criou ${env.counter.gradients - gradientsBefore} gradientes novos`);

  return `10 sprites, 15 gradientes, 0 criados em 1200 quadros`;
}

/* ══════════════════════════════════════════════════════════════════
   CASO 5 — movimento reduzido: um quadro, zero rAF
   ══════════════════════════════════════════════════════════════════ */
function caseReduced() {
  const env = build({ reduced: true });
  env.api.start();

  assert(env.api.isRunning() === true, "a camada não ficou ativa");
  assert(env.activeFrames() === 0, "agendou rAF com movimento reduzido");
  assert(env.counter.clears === 1, `esperava 1 limpeza, veio ${env.counter.clears}`);
  assert(env.counter.draws === 32, `esperava 32 desenhos (16 × 2), veio ${env.counter.draws}`);
  /* O teto exato do dpr é decisão do módulo (hoje 1.25). O teste cobra o
     contrato: nunca passar de 1.6 e dimensionar o canvas por esse dpr. */
  const cap = env.dbg.dpr;
  assert(cap > 1 && cap <= 1.6, `dpr fora do limite: ${cap}`);
  assert(env.canvas.width === Math.floor(1440 * cap),
    `canvas não dimensionado pelo dpr ${cap}: ${env.canvas.width}`);
  assert(env.canvas.height === Math.floor(900 * cap),
    `altura errada: ${env.canvas.height}`);

  const antes = env.counter.clears;
  env.api.stop();
  assert(env.api.isRunning() === false, "stop() não encerrou a camada");
  assert(env.counter.clears === antes + 1, "stop() não limpou o canvas");

  return "1 quadro estático, 0 rAF, canvas limpo ao sair";
}

/* ══════════════════════════════════════════════════════════════════
   CASO 6 — o laço pinta ~10 vezes por segundo, não 60
   ══════════════════════════════════════════════════════════════════ */
function caseThrottle() {
  const env = build({});
  env.api.start();
  assert(env.activeFrames() === 1, "start() não agendou exatamente um rAF");

  env.step(600, 16.7);       /* 10,02 s a 60 Hz */
  const paints = env.counter.clears;
  assert(env.ran === 600, `o laço parou cedo: ${env.ran} quadros`);
  assert(paints >= 85 && paints <= 115,
    `cadência fora do esperado: ${paints} pinturas em 10 s (queria ~100)`);
  assert(env.counter.draws === paints * 32,
    `desenhos (${env.counter.draws}) não correspondem a 32 por pintura`);

  return `${paints} pinturas em 10 s (${(paints / 10).toFixed(1)}/s)`;
}

/* ══════════════════════════════════════════════════════════════════
   CASO 7 — start() repetido não duplica; stop() cancela
   ══════════════════════════════════════════════════════════════════ */
function caseLifecycle() {
  const env = build({});
  env.api.start();
  env.api.start();
  env.api.start();
  assert(env.activeFrames() === 1, `start() repetido duplicou o laço: ${env.activeFrames()}`);

  env.step(30, 16.7);
  assert(env.activeFrames() === 1, "o laço não se reagendou");

  env.api.stop();
  assert(env.api.isRunning() === false, "isRunning() ficou verdadeiro depois de stop()");
  assert(env.activeFrames() === 0, "sobrou rAF ativo depois de stop()");
  const ranBefore = env.ran;
  env.step(60, 16.7);
  assert(env.ran === ranBefore, "o laço continuou rodando depois de stop()");

  env.api.start();
  assert(env.api.isRunning() === true, "start() depois de stop() não religou");
  assert(env.activeFrames() === 1, "start() depois de stop() não agendou o laço");

  return "um único laço, cancelado no stop, religado no start";
}

/* ══════════════════════════════════════════════════════════════════
   CASO 8 — resize mede de novo, limita o dpr e preserva a cena
   ══════════════════════════════════════════════════════════════════ */
function caseResize() {
  const env = build({ dpr: 3 });
  env.api.start();
  env.step(10, 16.7);

  const cap = env.dbg.dpr;
  assert(cap > 1 && cap <= 1.6, `dpr inicial fora do limite: ${cap}`);
  assert(env.canvas.width === Math.floor(1440 * cap),
    `canvas não dimensionado pelo dpr ${cap}: ${env.canvas.width}`);

  const before = env.dbg.lights.map(l => ({ nx: l.nx, ny: l.ny, r: l.r, a0: l.a0, color: l.color }));
  const clearsBefore = env.counter.clears;

  env.win.innerWidth = 800;
  env.win.innerHeight = 600;
  env.win.devicePixelRatio = 1;
  env.dispatchWindow("resize");
  assert(env.fireTimers(140) === 1, "o debounce do resize não disparou");
  env.step(1, 16.7);

  assert(env.canvas.width === 800, `largura não remedida: ${env.canvas.width}`);
  assert(env.canvas.height === 600, `altura não remedida: ${env.canvas.height}`);
  assert(env.counter.clears > clearsBefore, "o resize não repintou a camada");

  const after = env.dbg.lights;
  assert(after.length === before.length, "o resize mudou a quantidade de luzes");
  for (let i = 0; i < after.length; i++) {
    assert(after[i].nx === before[i].nx && after[i].ny === before[i].ny &&
           after[i].r === before[i].r && after[i].a0 === before[i].a0 &&
           after[i].color === before[i].color,
      `o resize re-sorteou a luz ${i}: a constelação não pode mudar`);
  }

  /* Posições escaladas: a luz que estava em 7% da largura continua
     em 7% — nada sai do quadro. */
  const drew = env.draws[env.draws.length - 1];
  for (let i = 1; i < drew.length; i++) {
    if (typeof drew[i] === "number") {
      assert(Number.isFinite(drew[i]), `drawImage recebeu ${drew[i]}`);
    }
  }

  return "1440×900 dpr3 → 800×600 dpr1, composição idêntica";
}

/* ══════════════════════════════════════════════════════════════════
   CASO 9 — aba oculta pausa; a volta retoma
   ══════════════════════════════════════════════════════════════════ */
function caseVisibility() {
  const env = build({});
  env.api.start();
  env.step(10, 16.7);

  env.document.hidden = true;
  env.dispatchDoc("visibilitychange");
  assert(env.activeFrames() === 0, "a aba oculta continuou com rAF ativo");

  env.document.hidden = false;
  env.dispatchDoc("visibilitychange");
  assert(env.activeFrames() === 1, "a volta da aba não retomou o laço");

  /* Em movimento reduzido a camada é estática: a visibilidade não
     pode criar um laço que antes não existia. */
  const still = build({ reduced: true });
  still.api.start();
  still.dispatchDoc("visibilitychange");
  still.document.hidden = false;
  still.dispatchDoc("visibilitychange");
  assert(still.activeFrames() === 0, "o modo reduzido ganhou rAF ao voltar para a aba");

  return "pausa e retomada; reduzido nunca agenda";
}

/* ══════════════════════════════════════════════════════════════════
   CASO 10 — preferência do sistema chega ao módulo
   ══════════════════════════════════════════════════════════════════ */
function caseSystemPreference() {
  const env = build({ reduced: true });
  env.api.start();
  assert(env.activeFrames() === 0, "começou animando com movimento reduzido");

  env.setPrefReduced(false);
  assert(env.dbg.reduced === false, "a mudança do sistema não foi lida");
  assert(env.activeFrames() === 1, "permitir movimento não iniciou o laço");

  env.step(10, 16.7);
  const clearsBefore = env.counter.clears;

  env.setPrefReduced(true);
  assert(env.dbg.reduced === true, "reduzir movimento não foi lido");
  assert(env.activeFrames() === 0, "reduzir movimento não cancelou o rAF");
  assert(env.counter.clears > clearsBefore, "reduzir movimento não pintou o quadro estático");

  return "sistema reduce → animate → reduce, sem reiniciar";
}

/* ══════════════════════════════════════════════════════════════════
   CASO 11 — setMotion e a preferência de outra aba
   ══════════════════════════════════════════════════════════════════ */
function caseForcedMotion() {
  const env = build({ reduced: true });
  env.api.start();
  assert(env.activeFrames() === 0, "começou animando sem opt-in");

  env.api.setMotion(true);
  assert(env.dbg.reduced === false, "setMotion(true) não venceu o sistema");
  assert(env.activeFrames() === 1, "setMotion(true) não iniciou o laço");

  env.api.setMotion(false);
  assert(env.dbg.reduced === true, "setMotion(false) não voltou ao sistema");
  assert(env.activeFrames() === 0, "setMotion(false) não cancelou o laço");
  assert(env.api.isRunning() === true, "setMotion não deve encerrar a cena");

  /* Outra aba: só a chave do projeto importa. */
  env.dispatchWindow("storage", { key: "outra-chave", newValue: "1" });
  assert(env.activeFrames() === 0, "uma chave estranha ligou o movimento");

  env.dispatchWindow("storage", { key: "projeto-amor:animar", newValue: "1" });
  assert(env.activeFrames() === 1, "a preferência de outra aba não iniciou o laço");

  env.dispatchWindow("storage", { key: "projeto-amor:animar", newValue: null });
  assert(env.activeFrames() === 0, "remover a preferência não voltou ao sistema");

  return "opt-in vence o sistema; storage respeita só a chave do projeto";
}

/* ══════════════════════════════════════════════════════════════════
   CASO 12 — no celular há menos luzes e nenhuma no miolo do texto
   ══════════════════════════════════════════════════════════════════ */
function caseMobile() {
  const desktop = build({ width: 1440, height: 900, reduced: true });
  desktop.api.start();
  assert(desktop.counter.draws === 32, `desktop: ${desktop.counter.draws} desenhos`);

  const mobile = build({ width: 390, height: 844, reduced: true });
  mobile.api.start();
  assert(mobile.counter.draws === 24,
    `celular desenhou ${mobile.counter.draws} (esperava 12 luzes × 2)`);

  const visiveis = mobile.dbg.lights.filter(l => l.mobile);
  assert(visiveis.length === 12, `esperava 12 luzes no celular, veio ${visiveis.length}`);
  for (const l of visiveis) {
    assert(l.nx <= 0.36 || l.nx >= 0.74,
      `luz em cima do texto no celular: x=${l.nx.toFixed(2)}`);
  }

  /* O miolo do quadro é do texto: nenhuma luz nasce ali, nem no
     desktop. A única exceção é a luz de base (y ≥ 0.8), que fica
     abaixo do papel. A faixa 0,34..0,66 é a região em que o papel
     cabe em qualquer viewport de desktop. */
  for (const l of desktop.dbg.lights) {
    if (l.nx > 0.34 && l.nx < 0.66) {
      assert(l.ny > 0.78,
        `luz no miolo do quadro: (${l.nx.toFixed(2)}, ${l.ny.toFixed(2)})`);
    }
  }

  return "desktop 16 luzes / celular 12, nenhuma no miolo";
}

/* ══════════════════════════════════════════════════════════════════
   CASO 13 — nenhum NaN em nenhum tamanho, dpr ou caminho de sprite
   ══════════════════════════════════════════════════════════════════ */
function caseNoNaN() {
  const sizes = [
    [320, 480, 1], [390, 844, 3], [820, 1180, 2],
    [1440, 900, 2], [3440, 1440, 1], [1280, 720, 1.5]
  ];
  let frames = 0;
  for (const [w, h, dpr] of sizes) {
    const env = build({ width: w, height: h, dpr, offscreen: true });
    assert(env.counter.surfaces === 10,
      `OffscreenCanvas: esperava 10 sprites, veio ${env.counter.surfaces}`);
    env.api.start();
    frames += env.step(300, 16.7);
    env.api.stop();
  }
  assert(frames === sizes.length * 300, `nem todos os quadros rodaram: ${frames}`);
  return `${sizes.length} tamanhos × 300 quadros, 0 valores não-finitos`;
}

/* ══════════════════════════════════════════════════════════════════
   CASO 14 — a camada está ligada à cena na ordem certa
   ══════════════════════════════════════════════════════════════════ */
function caseIntegration() {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "carta.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
  const surpresa = fs.readFileSync(path.join(__dirname, "surpresa.js"), "utf8");

  const bokeh = html.indexOf('<canvas class="scene-bokeh" id="scene-bokeh">');
  const rain = html.indexOf('<canvas class="scene-rain" id="scene-rain">');
  const warmth = html.indexOf('<div class="scene-warmth">');
  assert(bokeh >= 0, "carta.html não tem o canvas .scene-bokeh");
  assert(bokeh < rain, "o bokeh está na frente da chuva (o DOM desenha de trás para frente)");
  assert(bokeh < warmth, "o bokeh está na frente da luz âmbar do envelope");

  const scriptLights = html.indexOf('src="js/luzes.js"');
  const scriptSurpresa = html.indexOf('src="js/surpresa.js"');
  assert(scriptLights >= 0, "luzes.js não está em carta.html");
  assert(scriptLights < scriptSurpresa,
    "luzes.js precisa vir ANTES de surpresa.js: a cena lê a API ao abrir");

  const block = css.match(/\.scene-bokeh\s*\{[^}]*\}/s);
  assert(block, "a regra .scene-bokeh não existe no CSS");
  assert(/pointer-events:\s*none/.test(block[0]), "o canvas pode bloquear cliques");
  assert(/z-index:\s*2\b/.test(block[0]), "o bokeh não está na camada 2");
  assert(/position:\s*absolute/.test(block[0]), "o bokeh não está posicionado");
  assert(/\.surprise-scene\.is-stable\s+\.scene-bokeh\s*\{\s*opacity:\s*1/.test(css),
    "o bokeh não aparece no estado estável da cena");

  assert(/if \(lights\) lights\.start\(\)/.test(surpresa), "a cena não inicia as luzes");
  assert(/if \(lights\) lights\.stop\(\)/.test(surpresa), "a cena não encerra as luzes");
  assert(/if \(lights\) lights\.setMotion\(motionForced\)/.test(surpresa),
    "a cena não propaga a preferência de movimento para as luzes");

  return "canvas atrás da chuva, script antes da cena, start/stop/setMotion ligados";
}

/* ══════════════════════════════════════════════════════════════════
   EXECUÇÃO
   ══════════════════════════════════════════════════════════════════ */
let failed = 0;
const run_ = (name, fn) => {
  try {
    const r = fn();
    console.log(`  OK   ${name}${r ? " — " + r : ""}`);
  } catch (e) {
    failed++;
    console.log(`  FALHA ${name}\n         ${e.message}`);
  }
};

console.log("Luzes cinematográficas — invariantes do módulo\n");

run_("sem canvas, o módulo sai em silêncio", caseNoCanvas);
run_("a composição é uma cena, não um ponto", caseComposition);
run_("a paleta é só de luz quente", casePalette);
run_("sprites pré-renderizados uma vez", caseSprites);
run_("movimento reduzido: 1 quadro, 0 rAF", caseReduced);
run_("o laço pinta ~10 vezes por segundo", caseThrottle);
run_("start/stop não duplicam nem vazam", caseLifecycle);
run_("resize mede de novo sem re-sortear", caseResize);
run_("aba oculta pausa, a volta retoma", caseVisibility);
run_("a preferência do sistema é ouvida", caseSystemPreference);
run_("opt-in e a preferência de outra aba", caseForcedMotion);
run_("no celular: menos luzes, longe do texto", caseMobile);
run_("nenhum NaN em nenhum tamanho", caseNoNaN);
run_("a camada está ligada à cena", caseIntegration);

console.log(failed ? `\n${failed} caso(s) falharam` : "\nTodos os casos passaram");
process.exit(failed ? 1 : 0);
