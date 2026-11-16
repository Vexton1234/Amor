/* Projeto Amor — Luzes cinematográficas ao fundo da cena da chuva.

   Pequena camada de "bokeh" (lâmpadas distantes fora de foco) para a
   cena da surpresa. Ela NÃO participa do motor da chuva: vive em um
   canvas próprio, atrás do canvas .scene-rain e atrás de todo o
   conteúdo da etapa. A chuva continua exatamente como estava e passa
   na frente das luzes, preservando a profundidade.

   O QUE É DESENHADO
   ─────────────────
   • Luzes grandes, muito desfocadas, nos cantos e no alto do quadro:
     são as lâmpadas distantes que dão profundidade.
   • Luzes médias, com halo e um núcleo levemente mais claro.
   • Luzes pequenas, de brilho mais definido, mas ainda macio.
   • Tons de dourado intenso, amarelo-claro, âmbar, laranja suave e
     laranja escuro. Nada de branco puro ou cores frias.
   • Opacidades variadas: algumas quase somem na escuridão.
   • Respiração lentíssima e individual (dezenas de segundos por
     ciclo), como lâmpadas reais ao longe. Nunca há piscada rápida:
     algumas luzes são até completamente estáticas.

   Decisões técnicas
   ─────────────────
   • SPRITES PRÉ-RENDERIZADOS: dez superfícies pequenas, criadas uma
     única vez. O laço de desenho só reposiciona, sem criar gradiente.
   • REDESENHO EM ~10 QUADROS/S: as variações são lentas; atualizar a
     camada a cada quadro seria desperdício. O rAF só confere o relógio
     e, quando chega a hora, pinta.
   • POSIÇÕES NORMALIZADAS: redimensionar não re-sorteia a composição;
     a mesma constelação de luzes acompanha a tela.
   • SEM INTERAÇÃO: o canvas é pointer-events:none e aria-hidden (herda
     o aria-hidden de .scene-layers). Nada bloqueia clique.
   • Movimento: mesma chave e mesma regra do resto do projeto — o
     opt-in do visitante vence a preferência do sistema. Com movimento
     reduzido a camada é pintada UMA vez e nenhum rAF é agendado.

   API: window.ProjetoAmorLuzes = { start, stop, setMotion, isRunning } */
(() => {
  "use strict";

  const canvas = document.getElementById("scene-bokeh");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  /* ══════════════════════════════════════════════════════════════
     MOVIMENTO — fonte única de verdade
     ══════════════════════════════════════════════════════════════ */
  const MOTION_KEY = "projeto-amor:animar";
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motionForced = false;
  try {
    motionForced = window.localStorage.getItem(MOTION_KEY) === "1";
  } catch (_) { /* localStorage bloqueado: segue a preferência do sistema */ }
  let reduced = motionQuery.matches && !motionForced;

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const rgba = (c, a) => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";

  /* ══════════════════════════════════════════════════════════════
     PALETA — só a família do quente
     O fundo (roxo/vinho/preto) vem das camadas CSS; aqui só existem
     luzes que poderiam ter vindo de postes e janelas ao longe.
     ══════════════════════════════════════════════════════════════ */
  const COLORS = [
    [255, 209, 112],   /* 0 · amarelo-dourado intenso */
    [255, 241, 188],   /* 1 · amarelo-claro          */
    [255, 184, 88],    /* 2 · âmbar                  */
    [255, 150, 83],    /* 3 · laranja suave          */
    [221, 116, 48]     /* 4 · laranja escuro         */
  ];

  const SPRITE = 160;   /* lado da superfície fora da tela */
  const sprites = [];   /* sprites[cor][tipo] */

  function makeSurface(w, h) {
    if (typeof OffscreenCanvas === "function") {
      try { return new OffscreenCanvas(w, h); } catch (_) { /* cai para o DOM */ }
    }
    const el = document.createElement("canvas");
    el.width = w;
    el.height = h;
    return el;
  }

  /* Um sprite de bokeh: disco de luz com borda dissolvida. A variante
     com núcleo ganha um miolo mais claro — é o que diferencia uma
     lâmpada um pouco mais próxima de uma mancha totalmente desfocada. */
  function buildSprite(color, withCore) {
    const s = makeSurface(SPRITE, SPRITE);
    const g = s.getContext("2d");
    const c = SPRITE / 2;

    const body = g.createRadialGradient(c, c, 0, c, c, c);
    body.addColorStop(0, rgba(color, withCore ? 0.66 : 0.58));
    body.addColorStop(0.42, rgba(color, withCore ? 0.62 : 0.52));
    body.addColorStop(0.68, rgba(color, withCore ? 0.40 : 0.32));
    body.addColorStop(0.86, rgba(color, 0.13));
    body.addColorStop(1, rgba(color, 0));
    g.fillStyle = body;
    g.fillRect(0, 0, SPRITE, SPRITE);

    if (withCore) {
      /* Núcleo: a luz ainda está fora de foco, então o miolo é uma
         mancha pequena e macia, nunca um ponto duro. O tom é apenas
         um pouco mais claro que o halo — um branco puro em opacidade
         baixa viraria uma mancha cinzenta. */
      const light = [
        Math.round(color[0] + (255 - color[0]) * 0.30),
        Math.round(color[1] + (255 - color[1]) * 0.30),
        Math.round(color[2] + (255 - color[2]) * 0.30)
      ];
      const core = g.createRadialGradient(c, c, 0, c, c, c * 0.31);
      core.addColorStop(0, rgba(light, 0.95));
      core.addColorStop(0.48, rgba(color, 0.50));
      core.addColorStop(1, rgba(color, 0));
      g.fillStyle = core;
      g.fillRect(0, 0, SPRITE, SPRITE);
    }

    return s;
  }

  for (let i = 0; i < COLORS.length; i++) {
    sprites.push({
      halo: buildSprite(COLORS[i], false),
      core: buildSprite(COLORS[i], true)
    });
  }

  /* ══════════════════════════════════════════════════════════════
     COMPOSIÇÃO DAS LUZES

     Posições normalizadas (0..1), escolhidas para fugir do centro:
     o envelope, o título e o papel vivem ali. As luzes ficam nas
     bordas, no alto e na base — o olho lê "cidade ao longe", não
     "decoração atrás do texto".

     mobile: presença da luz no celular. Menos exemplares e nenhum
     no miolo do quadro, onde o texto ocupa quase toda a largura.

     tier  tamanho base (px de referência), opacidade e tipo de sprite.
     O tamanho final é multiplicado pela escala da tela em draw().
     ══════════════════════════════════════════════════════════════ */
  const TIERS = {
    far:  { rMin: 64, rMax: 124, aMin: 0.080, aMax: 0.180 },
    mid:  { rMin: 22, rMax: 50,  aMin: 0.120, aMax: 0.260 },
    near: { rMin: 6,  rMax: 17,  aMin: 0.180, aMax: 0.380 }
  };

  /* x, y, tier, cor, mobile, núcleo? */
  const DEFS = [
    [0.07, 0.13, "far",  0, true,  true ],
    [0.18, 0.28, "mid",  2, true,  true ],
    [0.05, 0.46, "near", 1, true,  true ],
    [0.12, 0.66, "mid",  3, true,  false],
    [0.07, 0.84, "far",  2, true,  false],
    [0.22, 0.08, "mid",  1, true,  false],
    [0.31, 0.20, "near", 0, false, true ],
    [0.69, 0.13, "far",  2, false, true ],
    [0.82, 0.27, "mid",  1, true,  true ],
    [0.93, 0.11, "near", 4, true,  true ],
    [0.95, 0.34, "far",  3, true,  false],
    [0.89, 0.54, "mid",  0, true,  false],
    [0.80, 0.70, "near", 2, true,  true ],
    [0.72, 0.87, "far",  4, false, false],
    [0.30, 0.80, "mid",  3, true,  true ],
    [0.50, 0.94, "near", 1, false, true ]
  ];

  const lights = [];
  for (let i = 0; i < DEFS.length; i++) {
    const d = DEFS[i];
    const tier = TIERS[d[2]];

    /* Umidade no sorteio: nenhuma posição perfeitamente uniforme. */
    const nx = clamp(d[0] + rand(-0.025, 0.025), 0.03, 0.97);
    const ny = clamp(d[1] + rand(-0.028, 0.028), 0.04, 0.96);

    /* Metade das luzes respira; a outra metade fica parada. Assim a
       cena não pulsa em compasso nem parece um conjunto de LEDs. */
    const breathing = Math.random() > 0.45;

    lights.push({
      nx: nx,
      ny: ny,
      color: d[3],
      mobile: d[4],
      core: d[5],
      r: rand(tier.rMin, tier.rMax),
      a0: rand(tier.aMin, tier.aMax),
      squash: rand(0.93, 1.07),          /* lente levemente oval */
      freq: rand(0.045, 0.16),           /* ciclo de 39 s a 140 s */
      freq2: rand(0.19, 0.42),           /* irregularidade discreta */
      amp: breathing ? rand(0.05, 0.13) : 0,
      phase: Math.random() * Math.PI * 2,
      phase2: Math.random() * Math.PI * 2
    });
  }

  /* As maiores são pintadas primeiro: uma luz menor pode sobrepor o
     halo de uma maior sem ser engolida por ele. */
  lights.sort((a, b) => b.r - a.r);

  /* ══════════════════════════════════════════════════════════════
     GEOMETRIA
     ══════════════════════════════════════════════════════════════ */
  let width = 0;
  let height = 0;
  let dpr = 1;
  let running = false;
  let raf = 0;
  let lastPaint = -1e9;

  /* ~10 pinturas por segundo. A camada é lenta de propósito; pintar a
     60 Hz só gastaria bateria sem mudar um pixel perceptível. */
  const PAINT_INTERVAL = 100;

  function measure() {
    /* A camada é 100% desfocada: resolução extra não acrescenta nada.
       1.25 é o teto — quase 40% menos memória que um canvas em DPR 1.6
       e exatamente o mesmo desenho suave. */
    dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);

    /* Escala única por tela: no celular as luzes encolhem junto com a
       cena, sem virar confete. */
    const scale = clamp(Math.min(width, height) / 780, 0.55, 1.55);
    const small = width < 720;

    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (small && !l.mobile) continue;

      const flicker = l.amp
        ? 1 + Math.sin(t * l.freq + l.phase) * l.amp
            + Math.sin(t * l.freq2 + l.phase2) * l.amp * 0.32
        : 1;

      const alpha = l.a0 * flicker;
      if (alpha <= 0.002) continue;

      const r = l.r * scale;
      const sprite = sprites[l.color][l.core ? "core" : "halo"];
      const w = r * 2 * l.squash;
      const h = r * 2;

      /* Halo externo: a mesma luz, maior e mais fraca, antes do corpo.
         É o que transforma um disco em uma fonte luminosa — sem ele a
         borda do sprite pode ser lida como uma moeda desfocada. */
      ctx.globalAlpha = alpha * 0.34;
      ctx.drawImage(
        sprite,
        l.nx * width - w * 0.84,
        l.ny * height - h * 0.84,
        w * 1.68, h * 1.68
      );

      ctx.globalAlpha = alpha > 1 ? 1 : alpha;
      ctx.drawImage(
        sprite,
        l.nx * width - w * 0.5,
        l.ny * height - h * 0.5,
        w, h
      );
    }

    ctx.globalAlpha = 1;
  }

  /* ══════════════════════════════════════════════════════════════
     LOOP — só agenda rAF com a cena aberta e movimento permitido
     ══════════════════════════════════════════════════════════════ */
  function frame(time) {
    raf = 0;
    if (!running) return;

    if (time - lastPaint >= PAINT_INTERVAL) {
      lastPaint = time;
      draw(time / 1000);
    }

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    measure();
    lastPaint = -1e9;

    if (reduced) {
      draw(0);                 /* um único quadro estático */
      raf = 0;
    } else {
      raf = requestAnimationFrame(frame);
    }
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastPaint = -1e9;
    if (width && height) ctx.clearRect(0, 0, width, height);
  }

  /* Reaplica a preferência sem depender de stop()/start() externos. */
  function applyMotion() {
    reduced = motionQuery.matches && !motionForced;
    if (!running) return;

    if (raf) cancelAnimationFrame(raf);
    raf = 0;

    if (reduced) {
      draw(0);
    } else {
      lastPaint = -1e9;
      raf = requestAnimationFrame(frame);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     REDIMENSIONAMENTO E ABA EM SEGUNDO PLANO
     ══════════════════════════════════════════════════════════════ */
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!running) return;
      measure();
      lastPaint = -1e9;
      draw(reduced ? 0 : performance.now() / 1000);
    }, 140);
  }, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (!running || reduced) return;

    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      lastPaint = -1e9;
      raf = requestAnimationFrame(frame);
    }
  });

  /* ══════════════════════════════════════════════════════════════
     ACESSIBILIDADE — a preferência pode mudar a qualquer momento
     ══════════════════════════════════════════════════════════════ */
  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", applyMotion);
  } else if (typeof motionQuery.addListener === "function") {
    motionQuery.addListener(applyMotion);       /* Safari antigo */
  }

  window.addEventListener("storage", event => {
    if (event.key !== MOTION_KEY) return;
    motionForced = event.newValue === "1";
    applyMotion();
  });

  window.ProjetoAmorLuzes = {
    start,
    stop,
    isRunning: () => running,
    setMotion(allow) {
      motionForced = !!allow;
      applyMotion();
    }
  };
})();
