/* Harness headless para js/som-chuva.js.
   Não substitui escuta real — verifica as INVARIANTES do som:

   • nenhum AudioContext é criado antes de um gesto real do visitante
   • o gesto cria UM contexto e a chuva entra com fade
   • fechar a cena dá fade-out e NÃO destrói o contexto (sem reinício)
   • voltar à cena reaproveita o MESMO contexto
   • o estado do botão corresponde ao áudio real (ligado/desligado)
   • a preferência do visitante é persistida
   • a chuva tem volume fixo de ambiente e não depende de nenhum player
   • existe UM único temporizador de gotas, e nada duplica ao repetir
   • destroy() fecha o contexto e remove os ouvintes              */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "som-chuva.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

/* ══════════════════════════════════════════════════════════════════
   MOCK DA WEB AUDIO API
   ══════════════════════════════════════════════════════════════════ */
const instances = [];

function makeParam(v) {
  const p = {
    value: v,
    ramped: [],
    setValueAtTime(x, t) { this.ramped.push({ type: "set", to: x, t }); this.value = x; return this; },
    linearRampToValueAtTime(x, t) { this.ramped.push({ type: "lin", to: x, t }); this.value = x; return this; },
    exponentialRampToValueAtTime(x, t) { this.ramped.push({ type: "exp", to: x, t }); this.value = x; return this; },
    cancelScheduledValues(t) { this.ramped.push({ type: "cancel", to: null, t }); return this; },
    setTargetAtTime(x, t) { this.ramped.push({ type: "target", to: x, t }); this.value = x; return this; }
  };
  return p;
}

class MockAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.state = "running";
    this.destination = { type: "destination" };
    this.nodes = [];
    this.closed = false;
    this.resumeCount = 0;
    instances.push(this);
  }
  _node(type, extra) {
    const n = Object.assign({
      type,
      out: null,
      connect(dest) { this.out = dest; return dest; },
      disconnect() {}
    }, extra || {});
    this.nodes.push(n);
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length)
    };
  }
  createBufferSource() {
    return this._node("source", {
      buffer: null, loop: false, playbackRate: makeParam(1),
      start() { this.started = true; }, stop() { this.stopped = true; }
    });
  }
  createBiquadFilter() {
    return this._node("biquad", {
      type: "biquad", frequency: makeParam(350), Q: makeParam(1), gain: makeParam(0)
    });
  }
  createGain() {
    return this._node("gain", { gain: makeParam(1) });
  }
  createOscillator() {
    return this._node("osc", {
      type: "sine", frequency: makeParam(440),
      start() { this.started = true; }, stop() { this.stopped = true; }
    });
  }
  createDynamicsCompressor() {
    return this._node("comp", {
      threshold: makeParam(-24), knee: makeParam(30), ratio: makeParam(12),
      attack: makeParam(0.003), release: makeParam(0.25)
    });
  }
  createStereoPanner() {
    return this._node("panner", { pan: makeParam(0) });
  }
  resume() { this.resumeCount++; this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.closed = true; this.state = "closed"; return Promise.resolve(); }

  /* O nó de volume principal é o ÚLTIMO gain antes do compressor. */
  master() {
    const comp = this.nodes.find(n => n.type === "comp");
    if (!comp) return null;
    return this.nodes.find(n => n.type === "gain" && n.out === comp) || null;
  }
  level() {
    const master = this.master();
    if (!master) return null;
    return this.nodes.find(n => n.type === "gain" && n.out === master) || null;
  }
}

/* ══════════════════════════════════════════════════════════════════
   AMBIENTE
   ══════════════════════════════════════════════════════════════════ */
function makeButton(onBeforeClick) {
  const btn = {
    dataset: {},
    attrs: {},
    title: "",
    listeners: [],
    label: { textContent: "" },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    querySelector(sel) { return sel === ".rain-sound-label" ? this.label : null; },
    click() {
      /* Um clique real no navegador vem SEMPRE precedido de um
         pointerdown (ou de um keydown, no caso do teclado). O módulo
         usa esse instante para fotografar o estado do áudio — sem
         simular o pointerdown, o botão pareceria quebrado. */
      if (onBeforeClick) onBeforeClick();
      const l = this.listeners.find(x => x.type === "click");
      if (l) l.fn({ preventDefault() {}, stopPropagation() {} });
    }
  };
  return btn;
}

function build(opts) {
  const o = Object.assign({ withButton: true }, opts);

  /* Cada caso começa com uma lista de contextos vazia: os casos são
     independentes e não podem se contaminar. */
  instances.length = 0;

  const storage = { getItem: () => null, setItem: (k, v) => { storage[k] = v; } };

  const winListeners = [];
  const docListeners = [];
  const timers = new Map();
  const intervals = new Map();

  const dispatch = (type, event) => {
    winListeners.filter(l => l.type === type).forEach(l => l.fn(event || {}));
  };

  const button = o.withButton ? makeButton(() => dispatch("pointerdown")) : null;

  const win = {
    AudioContext: MockAudioContext,
    localStorage: storage,
    addEventListener(type, fn) { winListeners.push({ type, fn }); },
    removeEventListener(type, fn) {
      const i = winListeners.findIndex(l => l.type === type && l.fn === fn);
      if (i >= 0) winListeners.splice(i, 1);
    },
    setTimeout: (fn, ms) => { const id = timers.size + 1; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => { timers.delete(id); },
    setInterval: (fn, ms) => { const id = intervals.size + 1; intervals.set(id, { fn, ms }); return id; },
    clearInterval: id => { intervals.delete(id); },
    /* O site não tem mais player musical: o ambiente de teste segue
       sem nenhum, e a chuva precisa funcionar assim mesmo. */
    ProjetoAmorPlayer: null
  };

  const document = {
    getElementById: id => (id === "rain-sound-toggle" ? button : null),
    addEventListener(type, fn) { docListeners.push({ type, fn }); },
    hidden: false
  };

  const sandbox = {
    window: win,
    document,
    navigator: { hardwareConcurrency: 8 },
    localStorage: storage,
    Math, Date, JSON, console, Promise,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
    setInterval: win.setInterval, clearInterval: win.clearInterval
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), sandbox, { filename: "som-chuva.js" });

  const api = win.ProjetoAmorSomChuva;
  if (!api) throw new Error("window.ProjetoAmorSomChuva não foi exposto");

  return { win, document, sandbox, api, button, winListeners, docListeners, timers, intervals, storage, dispatch };
}

/* ══════════════════════════════════════════════════════════════════
   CASOS
   ══════════════════════════════════════════════════════════════════ */
const cases = [];

/* 1 — Nada de áudio antes de um gesto real */
cases.push({
  name: "nenhum áudio antes de um gesto do visitante",
  run() {
    const before = instances.length;
    const env = build({});
    assert(instances.length === before,
      `um AudioContext foi criado no carregamento (${instances.length - before}) — ` +
      `a política de autoplay seria violada`);
    assert(env.button.dataset.state === "waiting",
      `o botão deveria estar aguardando o gesto, está "${env.button.dataset.state}"`);
    assert(env.button.getAttribute("aria-pressed") === "false",
      "aria-pressed deveria ser false antes de qualquer som");
    return `estado: ${env.button.dataset.state}`;
  }
});

/* 2 — O gesto cria UM contexto e a chuva entra com fade */
cases.push({
  name: "o gesto cria o contexto e a chuva entra em fade",
  run() {
    const before = instances.length;
    const env = build({});
    env.dispatch("pointerdown");
    assert(instances.length === before + 1,
      `o gesto não criou o AudioContext (${instances.length - before})`);
    const ctx = instances[instances.length - 1];
    assert(ctx.closed === false, "o contexto foi fechado logo após o gesto");

    /* O contexto existe, mas a cena ainda não pediu som. */
    env.api.setSceneActive(true);

    const master = ctx.master();
    assert(master, "o grafo de áudio não tem ganho principal");
    const ramps = master.gain.ramped.filter(r => r.type === "lin");
    assert(ramps.length > 0, "o volume não recebeu nenhuma rampa");
    const last = ramps[ramps.length - 1];
    assert(Math.abs(last.to - 0.10) < 0.001,
      `o volume deveria subir para 0.10, foi para ${last.to}`);
    assert(last.t > 0, "a rampa não tem duração — seria um corte seco");
    assert(last.to <= 0.12,
      `a chuva deveria ficar em segundo plano (até 12%), está em ${last.to}`);

    assert(env.button.dataset.state === "on",
      `o botão deveria estar "on", está "${env.button.dataset.state}"`);
    assert(env.button.getAttribute("aria-pressed") === "true",
      "aria-pressed deveria ser true com o som tocando");
    assert(env.api.isAudible() === true, "isAudible() deveria ser true");
    return `volume → ${last.to} em ${last.t.toFixed(1)}s`;
  }
});

/* 3 — Fechar a cena: fade-out, sem destruir o contexto */
cases.push({
  name: "fechar a cena dá fade-out sem reiniciar o áudio",
  run() {
    const env = build({});
    env.dispatch("pointerdown");
    env.api.setSceneActive(true);
    const ctx = instances[instances.length - 1];
    const nCtx = instances.length;

    env.api.setSceneActive(false);

    assert(instances.length === nCtx,
      "abrir/fechar a cena criou um novo AudioContext — o som reiniciaria");
    assert(ctx.closed === false, "o contexto foi destruído ao fechar a cena");

    const master = ctx.master();
    const ramps = master.gain.ramped.filter(r => r.type === "lin");
    const last = ramps[ramps.length - 1];
    assert(last.to <= 0.001, `o volume deveria cair para 0, foi para ${last.to}`);
    assert(env.api.isAudible() === false, "isAudible() continua true com a cena fechada");
    assert(env.button.dataset.state === "waiting",
      `o botão deveria voltar a "waiting", está "${env.button.dataset.state}"`);
    return `volume → ${last.to}`;
  }
});

/* 4 — Voltar à cena reaproveita o MESMO contexto */
cases.push({
  name: "voltar à cena não reinicia o som",
  run() {
    const env = build({});
    env.dispatch("pointerdown");
    env.api.setSceneActive(true);
    const ctx = instances[instances.length - 1];
    env.api.setSceneActive(false);
    env.api.setSceneActive(true);

    assert(instances.length === 1, "a volta à cena criou outro AudioContext");
    const master = ctx.master();
    const ramps = master.gain.ramped.filter(r => r.type === "lin");
    const last = ramps[ramps.length - 1];
    assert(Math.abs(last.to - 0.10) < 0.001,
      `a volta à cena não reativou o volume (foi para ${last.to})`);
    return `mesmo contexto, volume → ${last.to}`;
  }
});

/* 5 — O botão liga e desliga, e a preferência é guardada */
cases.push({
  name: "o botão desliga e religa a chuva",
  run() {
    const env = build({});
    env.dispatch("pointerdown");
    env.api.setSceneActive(true);
    assert(env.button.dataset.state === "on", "o som não estava ligado");

    env.button.click();
    assert(env.button.dataset.state === "off",
      `o botão deveria estar "off", está "${env.button.dataset.state}"`);
    assert(env.button.getAttribute("aria-pressed") === "false",
      "aria-pressed continuou true com o som desligado");
    assert(env.storage["projeto-amor:som-chuva"] === "0",
      "a preferência de desligar não foi guardada");
    assert(env.api.isAudible() === false, "o som continua audível depois de desligar");

    env.button.click();
    assert(env.button.dataset.state === "on",
      `o botão deveria voltar a "on", está "${env.button.dataset.state}"`);
    assert(env.storage["projeto-amor:som-chuva"] === "1",
      "a preferência de religar não foi guardada");
    return "ligou → desligou → ligou";
  }
});

/* 6 — A chuva é ambiente: volume fixo, sem ducking */
cases.push({
  name: "a chuva usa um volume fixo de ambiente",
  run() {
    const env = build({});
    env.dispatch("pointerdown");
    env.api.setSceneActive(true);
    const ctx = instances[instances.length - 1];
    const master = ctx.master();

    let ramps = master.gain.ramped.filter(r => r.type === "lin");
    const alvo = ramps[ramps.length - 1].to;
    assert(Math.abs(alvo - 0.10) < 0.001, `volume da chuva errado (${alvo})`);

    /* Reentrar na cena não muda o alvo: sem música no site, não há
       ducking — a chuva é sempre o mesmo ambiente. */
    env.api.setSceneActive(false);
    env.api.setSceneActive(true);
    ramps = master.gain.ramped.filter(r => r.type === "lin");
    const alvo2 = ramps[ramps.length - 1].to;
    assert(Math.abs(alvo2 - 0.10) < 0.001,
      `o volume mudou ao reentrar na cena (${alvo2})`);
    return "0.10 sempre — ambiente estável";
  }
});

/* 6b — A chuva é autossuficiente: não depende de player nenhum */
cases.push({
  name: "a chuva funciona sozinha, sem player de música",
  run() {
    const env = build({});
    env.dispatch("pointerdown");
    env.api.setSceneActive(true);

    /* O site não tem mais player musical: a chuva precisa funcionar
       sozinha, sem consultar (nem precisar que exista) qualquer
       reprodutor de áudio. */
    assert(env.win.ProjetoAmorPlayer === null || env.win.ProjetoAmorPlayer === undefined,
      "o ambiente de teste ainda injeta um player");
    assert(env.api.isAudible() === true,
      "a chuva não entrou mesmo sem nenhum player por perto");
    return "a chuva não depende de nenhum player";
  }
});

/* 6c — Uma única instância: o script rodando duas vezes não duplica o áudio */
cases.push({
  name: "uma única fonte de áudio, mesmo com o script repetido",
  run() {
    const env = build({});
    env.dispatch("pointerdown");
    env.api.setSceneActive(true);
    const criados = instances.length;
    assert(criados === 1, `o gesto criou ${criados} AudioContext (deveria ser 1)`);
    const primeiro = instances[0];

    /* O mesmo arquivo executa de novo: a instância anterior tem de
       ser encerrada, senão ficam DOIS contextos e volume dobrado. */
    const fs2 = require("fs");
    const path2 = require("path");
    const vm2 = require("vm");
    const src = fs2.readFileSync(SRC, "utf8");
    vm2.runInContext(src, env.sandbox, { filename: "som-chuva.js" });

    assert(primeiro.closed === true,
      "o AudioContext da instância anterior continua vivo — o áudio duplicou");
    assert(env.sandbox.window.ProjetoAmorSomChuva,
      "a API pública do som da chuva sumiu");

    /* Um novo gesto cria UM contexto novo, e só um. */
    env.dispatch("pointerdown");
    const vivos = instances.filter(c => c.closed === false).length;
    assert(vivos === 1, `há ${vivos} AudioContext vivo(s) — o áudio duplicou`);
    return `${instances.length} criado(s), ${vivos} vivo(s)`;
  }
});

/* 7 — Um único temporizador de gotas; nada duplica ao repetir a cena */
cases.push({
  name: "um único temporizador, sem duplicação ao repetir a cena",
  run() {
    const env = build({});
    env.dispatch("pointerdown");
    env.api.setSceneActive(true);
    const n1 = env.timers.size;
    for (let i = 0; i < 5; i++) {
      env.api.setSceneActive(false);
      env.api.setSceneActive(true);
    }
    assert(env.timers.size === n1,
      `os temporizadores acumularam (${n1} → ${env.timers.size}) — há relógios órfãos`);
    assert(env.intervals.size <= 1,
      `há mais de um intervalo vivo (${env.intervals.size})`);
    return `${env.timers.size} temporizador(es), ${env.intervals.size} intervalo(s)`;
  }
});

/* 8 — destroy fecha o contexto e limpa os ouvintes */
cases.push({
  name: "destroy fecha o contexto e limpa os ouvintes",
  run() {
    const env = build({});
    env.dispatch("pointerdown");
    env.api.setSceneActive(true);
    const ctx = instances[instances.length - 1];
    const nWin = env.winListeners.length;

    env.api.destroy();

    assert(ctx.closed === true, "o contexto de áudio não foi fechado");
    assert(env.winListeners.length < nWin, "os ouvintes do window ficaram pendurados");
    assert(env.timers.size === 0, "os temporizadores ficaram pendurados");
    assert(env.intervals.size === 0, "os intervalos ficaram pendurados");
    return `ouvintes ${nWin} → ${env.winListeners.length}`;
  }
});

/* 9 — O módulo funciona mesmo sem o botão na página */
cases.push({
  name: "funciona sem o botão na página",
  run() {
    const env = build({ withButton: false });
    env.dispatch("pointerdown");
    env.api.setSceneActive(true);
    assert(env.api.isAudible() === true, "o som não entrou sem o botão presente");
    env.api.toggle();
    assert(env.api.isEnabled() === false, "o toggle não desligou o som");
    return "sem botão, sem quebras";
  }
});

/* ══════════════════════════════════════════════════════════════════
   EXECUÇÃO
   ══════════════════════════════════════════════════════════════════ */
let failed = 0;
for (const c of cases) {
  try {
    const r = c.run();
    console.log(`  OK   ${c.name}${r ? " — " + r : ""}`);
  } catch (e) {
    failed++;
    console.log(`  FALHA ${c.name} — ${e.message}`);
  }
}
console.log(failed ? `\n${failed} caso(s) falharam` : "\nTodos os casos passaram");
process.exit(failed ? 1 : 0);
