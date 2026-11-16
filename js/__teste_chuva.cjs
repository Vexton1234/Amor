/* Harness headless para js/chuva.js.
   Não substitui teste visual — verifica invariantes numéricas:
   • nenhum NaN/Infinity chega ao canvas
   • os pools respeitam os tetos
   • a chuva roda por milhares de quadros sem lançar
   • NENHUMA gota vibra, salta ou muda de trajetória no meio da queda
   • a velocidade é a mesma em 30, 60 e 144 fps
   • a degradação de qualidade não apaga gotas visíveis
   • stop() zera tudo e start() repovoa
   • prefers-reduced-motion não agenda nenhum rAF
   • as quatro camadas de profundidade existem e têm velocidades
     diferentes (a chuva não pode ser um plano só)
   • as gotas que cruzam a luz âmbar recebem o tom quente
   • os respingos e as ondulações crescem com o tamanho da gota
   • as gotas que escorrem descem de forma contínua (sem tremor)   */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "chuva.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

/* ══════════════════════════════════════════════════════════════════
   AMBIENTE
   ══════════════════════════════════════════════════════════════════ */
function makeCtx(counter) {
  const num = (name) => (...args) => {
    for (const a of args) {
      if (typeof a === "number" && !Number.isFinite(a)) {
        throw new Error(`ctx.${name} recebeu valor não-finito: ${args.join(", ")}`);
      }
    }
    counter.ops++;
  };
  const grad = (name) => (...args) => {
    for (const a of args) {
      if (typeof a === "number" && !Number.isFinite(a)) {
        throw new Error(`ctx.${name} recebeu valor não-finito: ${args.join(", ")}`);
      }
    }
    counter.ops++;
    return { addColorStop: () => {} };
  };
  return new Proxy({
    canvas: null,
    lineCap: "round", lineWidth: 1,
    strokeStyle: "", fillStyle: "",
    setTransform: num("setTransform"),
    clearRect: num("clearRect"),
    beginPath: num("beginPath"),
    moveTo: num("moveTo"),
    lineTo: num("lineTo"),
    stroke: num("stroke"),
    fill: num("fill"),
    arc: num("arc"),
    ellipse: num("ellipse"),
    drawImage: num("drawImage"),
    save: num("save"), restore: num("restore"),
    createRadialGradient: grad("createRadialGradient"),
    createLinearGradient: grad("createLinearGradient"),
    fillRect: num("fillRect")
  }, {
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

/* Superfície de sprite: o módulo cria telas fora da tela para
   pré-renderizar as manchas de gota. */
function makeSurface(counter) {
  return {
    width: 0, height: 0,
    getContext: () => makeCtx(counter)
  };
}

/* Instrumentação SOMENTE DE TESTE: o fonte é reescrito em memória
   para expor os pools e o relógio. Nada disso toca o disco. */
function instrument(src) {
  const anchors = [
    ["\n  window.ProjetoAmorChuva = {",
     "\n  window.__dbg = { get s(){return splashes}, get r(){return ripples}," +
     " get g(){return glints}, get n(){return runners}," +
     " get d(){return drops}, get q(){return quality}, get t(){return clock}," +
     " get sp(){return SPRITES}, get L(){return LAYERS} };\n" +
     "  window.ProjetoAmorChuva = {"],
    ["    if (splashes.length >= MAX_SPLASH) return;",
     "    if (splashes.length >= MAX_SPLASH) { window.__rejS++; return; }"],
    ["        ripples.shift();",
     "        window.__rejR++; ripples.shift();"]
  ];
  let s = src;
  for (const [from, to] of anchors) {
    if (!s.includes(from)) {
      throw new Error(`âncora de instrumentação não encontrada: ${JSON.stringify(from.slice(0, 40))}`);
    }
    s = s.replace(from, to);
  }
  return s;
}

function build(opts) {
  const o = Object.assign({
    width: 1440, height: 900, dpr: 2, reduced: false,
    cores: 8, mem: 8
  }, opts);

  const counter = { ops: 0 };
  const frames = [];
  const canvas = { width: 0, height: 0, style: {}, getContext: () => makeCtx(counter) };

  const win = {
    innerWidth: o.width, innerHeight: o.height, devicePixelRatio: o.dpr,
    matchMedia: () => ({
      matches: o.reduced,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}
    }),
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, removeEventListener() {},
    __rejS: 0, __rejR: 0
  };

  const sandbox = {
    window: win,
    document: {
      getElementById: () => canvas,
      createElement: () => makeSurface(counter),
      addEventListener() {}, hidden: false
    },
    navigator: { hardwareConcurrency: o.cores, deviceMemory: o.mem },
    localStorage: win.localStorage, matchMedia: win.matchMedia,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
    Math, Date, JSON, console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(instrument(fs.readFileSync(SRC, "utf8")), sandbox, { filename: "chuva.js" });

  const api = win.ProjetoAmorChuva;
  if (!api) throw new Error("window.ProjetoAmorChuva não foi exposto");
  if (!win.__dbg) throw new Error("instrumentação não expôs os pools");

  return { win, api, dbg: win.__dbg, frames, counter, canvas };
}

/* Avança n quadros com passo de ms milissegundos.
   `env.n` acumula o total de quadros rodados — step() devolve o que
   conseguiu rodar nesta chamada, não o acumulado. */
function step(env, n, ms) {
  let t = env.now || 0;
  let ran = 0;
  for (let i = 0; i < n; i++) {
    const fn = env.frames.shift();
    if (!fn) break;
    t += ms;
    fn(t);
    ran++;
  }
  env.now = t;
  env.n = (env.n || 0) + ran;
  return ran;
}

function dropCount(dbg) {
  let n = 0;
  for (const list of dbg.d) n += list.length;
  return n;
}

function fallingCount(dbg) {
  let n = 0;
  for (const list of dbg.d) {
    for (const d of list) {
      if (!d.parked && d.wait <= 0) n++;
    }
  }
  return n;
}

/* ══════════════════════════════════════════════════════════════════
   CASO 1 — INTEGRAÇÃO EXATA: a queda não é re-sorteada por quadro
   ══════════════════════════════════════════════════════════════════ */
function caseIntegration() {
  const env = build({});
  env.api.start();
  const dbg = env.dbg;
  const DT = 16.7;

  let worstDyErr = 0;
  let worstDx = 0;
  let samples = 0;
  const prev = new Map();

  for (let f = 0; f < 900; f++) {
    step(env, 1, DT);
    for (const list of dbg.d) {
      for (const d of list) {
        const p = prev.get(d);
        prev.set(d, { x: d.x, y: d.y, wait: d.wait, parked: d.parked });

        const falling = !d.parked && d.wait <= 0 && p && p.wait <= 0 && !p.parked;
        if (!falling) continue;
        if (d.y <= p.y) continue;                 // reciclada: y subiu

        const dy = d.y - p.y;
        const dx = d.x - p.x;

        /* dy tem de ser exatamente speed × dt. Qualquer desvio
           significa que algo mexeu na gota fora da integração. */
        const expected = d.speed * (DT / 1000);
        const err = Math.abs(dy - expected);
        if (err > worstDyErr) worstDyErr = err;
        if (Math.abs(dx) > worstDx) worstDx = Math.abs(dx);
        samples++;
      }
    }
  }

  env.api.stop();

  assert(samples > 5000, `amostras insuficientes (${samples})`);
  assert(worstDyErr < 1e-6,
    `a queda não é integração pura: erro de dy de até ${worstDyErr.toFixed(6)} px ` +
    `(velocidade ou posição estão sendo re-sorteadas por quadro)`);
  /* |vx| = speed × slope; o maior caso é 1300 × 0.10 = 130 px/s,
     ou seja 2,2 px por quadro a 60 fps. */
  assert(worstDx < 4,
    `deriva horizontal de até ${worstDx.toFixed(2)} px por quadro — ` +
    `acima do que o vento permite (máx. 2,2 px): há oscilação`);

  return { samples, worstDyErr, worstDx };
}

/* ══════════════════════════════════════════════════════════════════
   CASO 2 — O BALANÇO LATERAL É CONTÍNUO (a causa do tremor)

   Reproduz o deslocamento que o desenho realmente usa,
   sin(clock × freq + fase) × amplitude, quadro a quadro. Com a base
   de tempo errada (milissegundos em vez de segundos) o termo gira
   várias voltas por quadro e a gota "ferve" no lugar.
   ══════════════════════════════════════════════════════════════════ */
function caseSway() {
  const results = [];
  for (const [label, ms] of [["30 fps", 33.3], ["60 fps", 16.7], ["144 fps", 6.94]]) {
    const env = build({});
    env.api.start();
    const dbg = env.dbg;

    let worst = 0;
    const prev = new Map();
    const swayOf = (d, t) => Math.sin(t * d.swayFreq + d.swayPhase) * d.sway;

    for (let f = 0; f < 600; f++) {
      const before = dbg.t;
      step(env, 1, ms);
      for (const list of dbg.d) {
        for (const d of list) {
          const p = prev.get(d);
          prev.set(d, { s: swayOf(d, dbg.t), id: d.swayPhase });
          if (!p || p.id !== d.swayPhase) continue;   // gota reciclada
          const delta = Math.abs(swayOf(d, dbg.t) - p.s);
          if (delta > worst) worst = delta;
        }
      }
      void before;
    }
    env.api.stop();
    results.push({ label, worst });
  }

  for (const r of results) {
    /* Maior caso: amplitude 12 px × freq 1,10 rad/s × dt.
       A 144 fps isso dá 0,11 px por quadro. */
    assert(r.worst < 0.5,
      `balanço lateral de ${r.worst.toFixed(2)} px por quadro a ${r.label} — ` +
      `a base de tempo do seno voltou a ser milissegundos?`);
  }
  return results;
}

/* ══════════════════════════════════════════════════════════════════
   CASO 3 — RESIZE NÃO RE-SORTEIA A CHUVA
   ══════════════════════════════════════════════════════════════════ */
function caseResize() {
  const env = build({});
  env.api.start();
  const dbg = env.dbg;
  step(env, 300, 16.7);

  /* Identidade das gotas (o vetor) e de onde cada uma está. */
  const before = [];
  for (const list of dbg.d) {
    for (const d of list) before.push({ d, x: d.x, y: d.y, len: d.len, speed: d.speed });
  }
  assert(before.length > 100, `poucas gotas para testar (${before.length})`);

  /* Recria o módulo com um stub de addEventListener funcional para
     poder acionar o redimensionamento de verdade. */
  const env2 = build({ width: 1440, height: 900 });
  const resizeHandlers = [];
  env2.win.addEventListener = (type, fn) => { if (type === "resize") resizeHandlers.push(fn); };

  const sandbox2 = {
    window: env2.win,
    document: {
      getElementById: () => env2.canvas,
      createElement: () => makeSurface(env2.counter),
      addEventListener() {}, hidden: false
    },
    navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    localStorage: env2.win.localStorage, matchMedia: env2.win.matchMedia,
    requestAnimationFrame: fn => { env2.frames.push(fn); return env2.frames.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (fn2) => { fn2(); return 1; },        // debounce instantâneo
    clearTimeout: () => {},
    Math, console
  };
  sandbox2.globalThis = sandbox2;
  vm.createContext(sandbox2);
  vm.runInContext(instrument(fs.readFileSync(SRC, "utf8")), sandbox2, { filename: "chuva.js" });

  env2.win.ProjetoAmorChuva.start();
  step(env2, 200, 16.7);
  const dbg2 = env2.win.__dbg;

  const snap = [];
  for (const list of dbg2.d) {
    for (const d of list) snap.push({ d, x: d.x, y: d.y, len: d.len, speed: d.speed });
  }
  const nBefore = snap.length;
  assert(nBefore > 100, `poucas gotas para testar (${nBefore})`);

  /* Redimensiona de verdade, passando pelo listener do módulo. */
  env2.win.innerWidth = 900;
  env2.win.innerHeight = 600;
  const before2 = snap.map(s => ({ ...s }));
  resizeHandlers.forEach(fn => fn());
  /* Nenhum quadro roda entre o instantâneo e a medição: uma queda de
     tempo recycleria gotas, e uma gota reciclada legitimamente ganha
     tamanho e velocidade novos — o que confundiria a medição. */
  assert(resizeHandlers.length === 1,
    `esperava 1 ouvinte de resize, achei ${resizeHandlers.length}`);

  let kept = 0;
  let movedOk = 0;
  let propsOk = 0;
  let parkedSeen = 0;
  const sx = 900 / 1440, sy = 600 / 900;
  const bad = [];
  for (const s of before2) {
    const inAny = dbg2.d.some(list => list.indexOf(s.d) >= 0);
    if (!inAny) continue;
    kept++;
    if (s.d.len === s.len && s.d.speed === s.speed) propsOk++;

    /* Gotas APOSADAS tiveram o y de propósito jogado para fora do
       quadro — é assim que a densidade baixa sem sumir com elas. Não
       faz sentido exigir que elas escalem. */
    if (s.d.parked) { parkedSeen++; continue; }

    const ex = s.x * sx, ey = s.y * sy;
    if (Math.abs(s.d.x - ex) < 0.5 && Math.abs(s.d.y - ey) < 0.5) movedOk++;
    else if (bad.length < 3) {
      bad.push(`x ${s.x.toFixed(2)}→${s.d.x.toFixed(2)} (esperado ${ex.toFixed(2)}), ` +
               `y ${s.y.toFixed(2)}→${s.d.y.toFixed(2)} (esperado ${ey.toFixed(2)}), ` +
               `parked=${s.d.parked}`);
    }
  }

  env2.win.ProjetoAmorChuva.stop();

  assert(kept === nBefore,
    `o resize apagou ${nBefore - kept} gotas do array — o reinício deve ` +
    `preservar as que já existiam`);
  assert(propsOk === kept,
    `tamanho ou velocidade mudaram no resize (${kept - propsOk} de ${kept})`);
  assert(movedOk === kept - parkedSeen,
    `a posição não escalou proporcionalmente no resize ` +
    `(${kept - parkedSeen - movedOk} fora do esperado)\n         ${bad.join("\n         ")}`);
  assert(parkedSeen > 0, "nenhuma gota foi aposada no resize — a contagem não caiu");

  return { nBefore, kept, propsOk, movedOk, parkedSeen };
}

/* ══════════════════════════════════════════════════════════════════
   CASO 4 — QUALIDADE ADAPTATIVA SEM ESTOURO
   ══════════════════════════════════════════════════════════════════ */
function caseAdaptive() {
  const env = build({});
  env.api.start();
  const dbg = env.dbg;

  /* Média de quadros, não um instante. fallingCount oscila de ±8 a
     cada quadro porque as gotas que batem no chão ficam esperando
     0.04–0.60 s antes de voltar — comparar dois instantes mede o
     ruído, não a densidade. */
  const sampleFalling = (frames, ms) => {
    let acc = 0;
    for (let f = 0; f < frames; f++) {
      step(env, 1, ms);
      acc += fallingCount(dbg);
    }
    return acc / frames;
  };

  const q0 = dbg.q;
  const n0 = dropCount(dbg);
  const before = sampleFalling(120, 16.7);   // 60 fps: ainda não degradou

  step(env, 900, 40);                        // 25 fps: dispara a degradação

  const q1 = dbg.q;
  const n1 = dropCount(dbg);

  assert(q1 < q0, `qualidade não degradou com 25 fps (${q0} → ${q1})`);
  assert(q1 >= 0.45, `qualidade desceu abaixo do piso (${q1})`);
  assert(n1 === n0,
    `gotas foram apagadas do array (${n0} → ${n1}) — a degradação tem que ` +
    `aposar gotas fora de quadro, nunca removê-las`);
  assert(dbg.q === q1, "a qualidade oscilou para cima em quadros rápidos");

  const after = sampleFalling(240, 16.7);
  env.api.stop();

  assert(after < before * 0.8,
    `densidade em queda não caiu (média ${before.toFixed(1)} → ${after.toFixed(1)})`);
  assert(after >= before * 0.25,
    `chuva ficou rala demais (média ${before.toFixed(1)} → ${after.toFixed(1)})`);

  return { q0, q1, n0, n1, before, after };
}

/* ══════════════════════════════════════════════════════════════════
   CASO 5 — CICLO DE VIDA E MODO REDUZIDO
   ══════════════════════════════════════════════════════════════════ */
function caseLifecycle() {
  const env = build({});
  const dbg = env.dbg;

  env.api.start();
  step(env, 400, 16.7);
  assert(env.api.isRunning(), "isRunning() deveria ser true depois de start()");
  assert(dropCount(dbg) > 50, "a chuva não populou");

  env.api.stop();
  assert(!env.api.isRunning(), "isRunning() deveria ser false depois de stop()");
  assert(dropCount(dbg) === 0, "stop() não esvaziou as gotas");
  assert(dbg.s.length === 0 && dbg.r.length === 0, "stop() não esvaziou os efeitos");
  assert(dbg.g.length === 0 && dbg.n.length === 0, "stop() não esvaziou os reflexos");

  env.api.start();
  assert(dropCount(dbg) > 50, "start() após stop() não repovoou a chuva");

  const framesBefore = env.frames.length;
  step(env, 60, 16.7);
  assert(framesBefore > 0, "o loop não reagendou quadro após reiniciar");

  env.api.stop();

  /* Modo sem movimento: nenhum rAF pode ser agendado. */
  const env2 = build({ reduced: true });
  env2.api.start();
  const scheduled = env2.frames.length;
  assert(scheduled === 0, `modo reduzido agendou ${scheduled} rAF`);
  assert(env2.counter.ops > 0, "modo reduzido não pintou o quadro estático");
  assert(dropCount(env2.dbg) > 0, "modo reduzido não populou as gotas");

  return { scheduled, staticOps: env2.counter.ops };
}

/* ══════════════════════════════════════════════════════════════════
   CASO 6 — AS QUATRO CAMADAS DE PROFUNDIDADE

   A chuva não pode ser UM plano só: sem camadas separadas, qualquer
   "chuva" é um padrão uniforme — exatamente o defeito que esta
   evolução existe para corrigir.
   ══════════════════════════════════════════════════════════════════ */
function caseDepth() {
  const env = build({});
  env.api.start();
  const dbg = env.dbg;
  step(env, 60, 16.7);

  const L = dbg.L;
  assert(L.length === 4, `a chuva deveria ter 4 planos, tem ${L.length}`);

  /* Cada plano tem de ser mais rápido que o anterior: é a leitura de
     profundidade que o olho faz sem pensar. */
  for (let i = 1; i < L.length; i++) {
    assert(L[i].vMin > L[i - 1].vMax,
      `o plano ${i} (${L[i].name}) não é mais rápido que o anterior ` +
      `(${L[i - 1].name}): as camadas de profundidade se embaralharam`);
  }

  /* As manchas do primeiro plano são maiores que as do fundo: o
     tamanho na tela é o que dá a sensação de proximidade. */
  for (let i = 1; i < L.length; i++) {
    assert(L[i].wMin >= L[i - 1].wMin,
      `o plano ${i} não é maior que o plano ${i - 1}`);
  }

  /* Cada plano tem de existir de fato na tela. */
  for (let i = 0; i < L.length; i++) {
    const n = dbg.d[i].length;
    assert(n > 0, `o plano ${i} (${L[i].name}) está vazio`);
  }

  /* A profundidade se lê no TAMANHO da gota na tela.

     MEDIR COM CUIDADO — a comparação não pode ser gota a gota. Cada
     plano sorteia entre duas representações: o TRAÇO (fino e comprido)
     e a MANCHA (larga e curta). Um traço do plano "perto" (largura
     1,3 a 2,4 px) é mais estreito que uma mancha do plano "faro"
     (1,2 a 2,6 px). Comparar duas gotas quaisquer mede o acaso do
     sorteio, não a profundidade — e o teste falhava de vez em quando
     (cerca de 1 em 12 execuções) sem que nada no site tivesse mudado.

     A medida honesta é a MEDIANA de cada plano: a gota TÍPICA que o
     olho enxerga em cada camada. E, para não depender da mistura de
     representações, a largura das MANCHAS é comparada separadamente
     — mancha com mancha, que é a comparação que a vista realmente
     faz. */
  const mediana = (lista, chave) => {
    if (!lista.length) return NaN;
    const v = lista.map(d => d[chave]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };

  const resumo = dbg.d.map((lista, i) => {
    const manchas = lista.filter(d => !d.streak);
    return {
      nome: L[i].name,
      n: lista.length,
      nManchas: manchas.length,
      len: mediana(lista, "len"),
      w: mediana(lista, "w"),
      wMancha: mediana(manchas, "w")
    };
  });

  for (const r of resumo) {
    assert(r.nManchas > 0, `o plano ${r.nome} não tem nenhuma mancha`);
  }

  /* A gota típica de cada plano cresce em altura e em largura, de trás
     para a frente. */
  for (let i = 1; i < resumo.length; i++) {
    const a = resumo[i - 1], b = resumo[i];
    assert(b.len > a.len,
      `a gota típica do plano ${i} (${b.nome}, ${b.len.toFixed(1)} px de altura) ` +
      `não é maior que a do plano ${i - 1} (${a.nome}, ${a.len.toFixed(1)} px): ` +
      `a profundidade visual sumiu`);
    assert(b.w > a.w,
      `a largura típica do plano ${i} (${b.nome}, ${b.w.toFixed(2)} px) não é maior ` +
      `que a do plano ${i - 1} (${a.nome}, ${a.w.toFixed(2)} px): a profundidade visual sumiu`);
    /* Mancha com mancha: a gota de verdade é mais larga quanto mais
       perto da câmera. */
    assert(b.wMancha > a.wMancha,
      `a mancha típica do plano ${i} (${b.nome}, ${b.wMancha.toFixed(2)} px) não é mais ` +
      `larga que a do plano ${i - 1} (${a.nome}, ${a.wMancha.toFixed(2)} px): ` +
      `a profundidade visual sumiu`);
  }

  const counts = dbg.d.map(l => l.length);
  env.api.stop();
  return {
    layers: L.map(l => l.name),
    counts,
    resumo: resumo.map(r => `${r.nome}: ${r.len.toFixed(1)}x${r.w.toFixed(2)} px`)
  };
}

/* ══════════════════════════════════════════════════════════════════
   CASO 7 — A LUZ ÂMBAR SÓ ALCANÇA QUEM PASSA POR ELA

   O exigido é "reflexos âmbar muito discretos em gotas que cruzam a
   região iluminada" — logo, dentro da luz a gota é mais quente, e
   fora dela é fria. E nenhuma gota pode ficar com a cor travada na
   posição em que nasceu.
   ══════════════════════════════════════════════════════════════════ */
function caseLight() {
  const env = build({ width: 1440, height: 900 });
  env.api.start();
  const dbg = env.dbg;
  step(env, 400, 16.7);

  let warmSeen = 0;
  let coldSeen = 0;
  let maxWarm = 0;
  for (const list of dbg.d) {
    for (const d of list) {
      if (d.warm > 0.35) { warmSeen++; maxWarm = Math.max(maxWarm, d.warm); }
      else if (d.warm < 0.05) coldSeen++;
    }
  }

  assert(warmSeen > 0, "nenhuma gota recebeu o tom âmbar da luz");
  assert(coldSeen > 0, "nenhuma gota ficou fora da luz — a cena inteira clareou");
  assert(maxWarm <= 1, `o tom quente passou de 1 (${maxWarm})`);

  env.api.stop();
  return { warmSeen, coldSeen, maxWarm };
}

/* ══════════════════════════════════════════════════════════════════
   CASO 8 — O CHÃO RESPONDE: respingos, ondas e reflexos

   O efeito tem de existir e ter proporção: uma gota miúda não pode
   abrir a mesma onda que uma gota grande.
   ══════════════════════════════════════════════════════════════════ */
function caseFloor() {
  const env = build({});
  env.api.start();
  const dbg = env.dbg;

  let peakS = 0, peakR = 0, peakG = 0;
  let bigRipples = 0, smallRipples = 0;
  for (let f = 0; f < 900; f++) {
    step(env, 1, 16.7);
    peakS = Math.max(peakS, dbg.s.length);
    peakR = Math.max(peakR, dbg.r.length);
    peakG = Math.max(peakG, dbg.g.length);
    for (const rp of dbg.r) {
      if (rp.maxR > 26) bigRipples++;
      else smallRipples++;
    }
  }
  env.api.stop();

  assert(peakS > 0, "nenhum respingo vivo — o chão está seco");
  assert(peakR > 0, "nenhuma ondulação viva — o chão não tem água");
  assert(peakG > 0, "nenhum reflexo âmbar no chão molhado");
  assert(bigRipples > 0 && smallRipples > 0,
    `as ondas não variam de tamanho (grandes ${bigRipples}, pequenas ${smallRipples})`);

  return { peakS, peakR, peakG, bigRipples, smallRipples };
}

/* ══════════════════════════════════════════════════════════════════
   CASO 9 — AS GOTAS QUE ESCORREM DESCEM SEM TREMER
   ══════════════════════════════════════════════════════════════════ */
function caseRunners() {
  const env = build({});
  env.api.start();
  const dbg = env.dbg;
  step(env, 30, 16.7);

  assert(dbg.n.length > 0, "nenhuma gota escorrendo na superfície");

  const prev = new Map();
  let worst = 0;
  let respawns = 0;
  let badRespawn = 0;
  const H = env.win.innerHeight;
  for (let f = 0; f < 600; f++) {
    step(env, 1, 16.7);
    for (const r of dbg.n) {
      const p = prev.get(r);
      if (p !== undefined) {
        const dy = r.y - p;
        if (dy < -1) {
          /* Recomeço: a gota voltou para o topo. Só é aceitável se
             ela já estava inteiramente fora do quadro. */
          respawns++;
          if (p - r.trail <= H) badRespawn++;
          continue;
        }
        /* Desce sempre, e no ritmo do seu próprio speed (nunca um
           pulo para trás e nunca um salto). */
        if (dy < -0.001) worst = Math.max(worst, -dy);
        const expected = r.speed * 0.0167;
        if (Math.abs(dy - expected) > 0.05) {
          worst = Math.max(worst, Math.abs(dy - expected));
        }
      }
      prev.set(r, r.y);
    }
  }

  assert(worst < 0.2,
    `as gotas que escorrem deram um salto de ${worst.toFixed(3)} px — ` +
    `o movimento delas não é contínuo`);
  assert(badRespawn === 0,
    `${badRespawn} recomeços de gota escorrendo aconteceram dentro do quadro ` +
    `(um salto visível)`);

  const nRunners = dbg.n.length;
  env.api.stop();

  return { runners: nRunners, worst, respawns };
}

/* ══════════════════════════════════════════════════════════════════
   EXECUÇÃO
   ══════════════════════════════════════════════════════════════════ */
const baseCases = [
  { label: "desktop 1920x1080 dpr2",   width: 1920, height: 1080, dpr: 2,   reduced: false, cores: 8,  mem: 8 },
  { label: "laptop 1440x900 dpr2",     width: 1440, height: 900,  dpr: 2,   reduced: false, cores: 8,  mem: 8 },
  { label: "celular 390x844 dpr3",     width: 390,  height: 844,  dpr: 3,   reduced: false, cores: 6,  mem: 4 },
  { label: "aparelho modesto 360x640", width: 360,  height: 640,  dpr: 2,   reduced: false, cores: 2,  mem: 2 },
  { label: "ultrawide 3440x1440 dpr1", width: 3440, height: 1440, dpr: 1,   reduced: false, cores: 16, mem: 16 },
  { label: "tela minúscula 320x480",   width: 320,  height: 480,  dpr: 1.5, reduced: false, cores: 4,  mem: 4 }
];

function caseBase(c) {
  const env = build(c);
  env.api.start();
  const dbg = env.dbg;

  let peakS = 0, peakR = 0, peakD = 0, sumS = 0, sumR = 0;
  for (let f = 0; f < 1200; f++) {
    if (!step(env, 1, 16.7)) break;
    const sN = dbg.s.length, rN = dbg.r.length;
    const dN = dropCount(dbg);
    if (sN > peakS) peakS = sN;
    if (rN > peakR) peakR = rN;
    if (dN > peakD) peakD = dN;
    sumS += sN; sumR += rN;
  }
  const n = env.n || 0;
  env.api.stop();

  assert(n >= 900, `loop parou cedo demais: ${n} quadros`);
  /* O chão precisa mostrar respingos. A PROPORÇÃO cai em telas
     altas (cada gota leva mais tempo para chegar ao chão, então
     há menos impactos vivos por gota) — por isso o teste exige
     também um mínimo absoluto, que é o que o olho percebe. */
  assert(peakS >= 12, `quase nenhum respingo vivo (${peakS} para ${peakD} gotas)`);
  assert(peakS / peakD > 0.12, `quase nenhum respingo vivo (${peakS} para ${peakD} gotas)`);
  assert(peakR / peakD > 0.08, `quase nenhuma ondulação viva (${peakR} para ${peakD})`);
  assert(peakD > 20, `chuva rala demais (${peakD} gotas)`);
  assert(env.win.__rejS === 0, `${env.win.__rejS} gotículas recusadas (coroas amputadas)`);
  assert(env.win.__rejR === 0, `${env.win.__rejR} ondulações recicladas (chão saturado)`);

  return { n, peakS, avgS: Math.round(sumS / n), peakR, peakD, q: dbg.q };
}

let failed = 0;
const run_ = (name, fn) => {
  try {
    const r = fn();
    const extra = typeof r === "string" ? r : "";
    console.log(`  OK   ${name}${extra ? " — " + extra : ""}`);
  } catch (e) {
    failed++;
    console.log(`  FALHA ${name}\n         ${e.message}`);
  }
};

for (const c of baseCases) {
  run_(c.label.padEnd(28), () => {
    const r = caseBase(c);
    return `gotas:${String(r.peakD).padStart(4)} | respingo:${String(r.peakS).padStart(3)}/${String(r.avgS).padStart(3)} | ` +
           `onda:${String(r.peakR).padStart(3)}`;
  });
}

run_("integração exata da queda".padEnd(28), () => {
  const r = caseIntegration();
  return `${r.samples} amostras, erro de dy ${r.worstDyErr.toExponential(1)}, ` +
         `deriva máx. ${r.worstDx.toFixed(2)} px/quadro`;
});

run_("balanço lateral contínuo".padEnd(28), () => {
  const rs = caseSway();
  return rs.map(r => `${r.label}: ${r.worst.toFixed(3)} px/quadro`).join(" | ");
});

run_("resize preserva as gotas".padEnd(28), () => {
  const r = caseResize();
  return `${r.kept} gotas mantidas (${r.parkedSeen} aposadas), ` +
         `posição escalada corretamente em ${r.movedOk}`;
});

run_("qualidade adaptativa".padEnd(28), () => {
  const r = caseAdaptive();
  return `q ${r.q0.toFixed(2)}→${r.q1.toFixed(2)}, array ${r.n0}→${r.n1}, ` +
         `em queda (média) ${r.before.toFixed(0)}→${r.after.toFixed(0)}`;
});

run_("ciclo de vida + reduzido".padEnd(28), () => {
  const r = caseLifecycle();
  return `${r.scheduled} rAF no modo reduzido, ${r.staticOps} ops estáticos`;
});

run_("quatro planos de profundidade".padEnd(28), () => {
  const r = caseDepth();
  return `${r.layers.join(" / ")} — ${r.counts.join(" / ")} gotas — ` +
         `${r.resumo.join(" · ")}`;
});

run_("luz âmbar só onde há luz".padEnd(28), () => {
  const r = caseLight();
  return `${r.warmSeen} gotas quentes, ${r.coldSeen} frias`;
});

run_("chão molhado responde".padEnd(28), () => {
  const r = caseFloor();
  return `respingo:${r.peakS} onda:${r.peakR} reflexo:${r.peakG} ` +
         `(ondas grandes ${r.bigRipples}, pequenas ${r.smallRipples})`;
});

run_("gotas que escorrem são contínuas".padEnd(28), () => {
  const r = caseRunners();
  return `${r.runners} gotas na superfície, maior salto ${r.worst.toFixed(4)} px, ` +
         `${r.respawns} recomeços (todos fora do quadro)`;
});

console.log(failed ? `\n${failed} caso(s) falharam` : "\nTodos os casos passaram");
process.exit(failed ? 1 : 0);
