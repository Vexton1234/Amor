/* Projeto Amor — Atmosfera cinematográfica: estrelas multicamadas, orbes de luz e pétalas de rosa procedurais */
(() => {
  const canvas = document.querySelector(".particle-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  /* ══════════════════════════════════════════════════════════════════
     MOVIMENTO — fonte única de verdade
     O opt-in explícito do visitante (persistido por main.js em
     localStorage) SEMPRE vence a preferência do sistema. Sem esta
     distinção, num Windows com "efeitos de animação" desligados o Chrome
     reporta prefers-reduced-motion: reduce, o canvas era desenhado UMA
     única vez e as pétalas ficavam congeladas no ar para sempre, sem
     nenhum caminho para religá-las.
     ══════════════════════════════════════════════════════════════════ */
  const MOTION_KEY = "projeto-amor:animar";
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motionForced = false;
  try {
    motionForced = window.localStorage.getItem(MOTION_KEY) === "1";
  } catch (_) {
    /* localStorage bloqueado (modo restrito): segue a preferência do sistema */
  }
  let reducedMotion = motionQuery.matches && !motionForced;

  /* Pools de partículas — sem alocações no loop de animação */
  const stars = [];
  const lightPoints = [];
  const petals = [];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;
  let lastTime = 0;

  /* Velocidades são definidas por SEGUNDO, não por quadro: assim a queda
     das pétalas tem a mesma velocidade em telas de 60 Hz e de 120 Hz. */
  const FPS_NOMINAL = 60;
  /* Teto do passo: evita saltos gigantes depois de uma aba suspensa. */
  const MAX_STEP = 0.05;   // 50 ms

  /* Paletas cromáticas elegantes das pétalas (rosa antigo, vinho suave e rosa pálido) */
  const PETAL_PALETTES = [
    {
      base: "rgba(160, 48, 80, 0.95)",
      mid:  "rgba(224, 122, 156, 0.90)",
      tip:  "rgba(248, 190, 214, 0.84)"
    },
    {
      base: "rgba(132, 38, 68, 0.92)",
      mid:  "rgba(198, 98, 134, 0.86)",
      tip:  "rgba(238, 168, 196, 0.80)"
    },
    {
      base: "rgba(175, 68, 102, 0.90)",
      mid:  "rgba(232, 142, 178, 0.88)",
      tip:  "rgba(254, 216, 232, 0.86)"
    }
  ];

  /* ── 1. Estrelas: 3 camadas (tiny, sparkle, hero) ─────────────────── */
  function mkStar(type, x, y) {
    const isHero = type === "hero";
    const isSparkle = type === "sparkle";

    let r, baseAlpha, freq, color;
    if (isHero) {
      r = Math.random() * 0.8 + 1.8; // 1.8 a 2.6px
      baseAlpha = Math.random() * 0.25 + 0.70; // 0.70 a 0.95
      freq = Math.random() * 0.0006 + 0.0005; // pulso lento de 8-12s
      color = Math.random() > 0.4 ? "#fff4fc" : "#fdf0d5";
    } else if (isSparkle) {
      r = Math.random() * 0.6 + 1.0; // 1.0 a 1.6px
      baseAlpha = Math.random() * 0.35 + 0.50; // 0.50 a 0.85
      freq = Math.random() * 0.0014 + 0.0010;
      color = Math.random() > 0.6 ? "#fae2b8" : (Math.random() > 0.3 ? "#fce4f4" : "#ffffff");
    } else {
      // tiny
      r = Math.random() * 0.5 + 0.45; // 0.45 a 0.95px
      baseAlpha = Math.random() * 0.35 + 0.22; // 0.22 a 0.57
      freq = Math.random() * 0.0010 + 0.0006;
      color = Math.random() > 0.5 ? "#f5eaf8" : "#ede1f5";
    }

    return {
      type,
      x: x ?? Math.random() * width,
      y: y ?? Math.random() * height,
      r,
      baseAlpha,
      freq,
      phase: Math.random() * Math.PI * 2,
      color,
      /* Deriva em px/s (o passo por tempo é aplicado no loop) */
      driftX: (Math.random() - 0.5) * 0.9,
      driftY: (Math.random() - 0.5) * 0.9
    };
  }

  /* ── 2. Pontos de luz cinematográficos (orbes com halo suave / bokeh) ─ */
  function mkLightPoint() {
    const palette = [
      { r: 236, g: 172, b: 206 }, // rosa suave
      { r: 226, g: 196, b: 148 }, // ouro delicado
      { r: 198, g: 156, b: 228 }  // lilás cósmico
    ];
    const c = palette[Math.floor(Math.random() * palette.length)];

    const radius = Math.random() * 16 + 12; // 12 a 28px
    const baseX = Math.random() * width;
    const baseY = Math.random() * height;

    return {
      baseX,
      baseY,
      radius,
      color: c,
      baseAlpha: Math.random() * 0.22 + 0.16, // 0.16 a 0.38
      pulseFreq: Math.random() * 0.0007 + 0.0004,
      driftXFreq: Math.random() * 0.0005 + 0.0002,
      driftYFreq: Math.random() * 0.0005 + 0.0002,
      driftXAmp: Math.random() * 35 + 15,
      driftYAmp: Math.random() * 25 + 10,
      phase: Math.random() * Math.PI * 2
    };
  }

  /* ── 3. Pétalas de rosa procedurais com profundidade ─────────────── */
  function mkPetal(x, y, forcedLayer) {
    // 3 camadas: 1=distante (menor, lenta), 2=média, 3=primeiro plano (maior, volumosa)
    const layer = forcedLayer ?? (Math.random() < 0.25 ? 3 : (Math.random() < 0.65 ? 2 : 1));
    const pal = PETAL_PALETTES[Math.floor(Math.random() * PETAL_PALETTES.length)];

    let w, h, speed, alpha, swayAmp, swayFreq;
    if (layer === 3) {
      w = Math.random() * 5 + 16;  // 16 a 21px
      h = Math.random() * 7 + 22;  // 22 a 29px
      speed = Math.random() * 27 + 51;      // 51 a 78 px/s (primeiro plano)
      alpha = Math.random() * 0.18 + 0.70; // 0.70 a 0.88
      swayAmp = Math.random() * 28 + 20;
      swayFreq = Math.random() * 0.0009 + 0.0006;
    } else if (layer === 2) {
      w = Math.random() * 4 + 10;  // 10 a 14px
      h = Math.random() * 5 + 14;  // 14 a 19px
      speed = Math.random() * 21 + 33;      // 33 a 54 px/s (plano médio)
      alpha = Math.random() * 0.20 + 0.52; // 0.52 a 0.72
      swayAmp = Math.random() * 20 + 14;
      swayFreq = Math.random() * 0.0008 + 0.0005;
    } else {
      w = Math.random() * 3 + 6;   // 6 a 9px
      h = Math.random() * 4 + 8;   // 8 a 12px
      speed = Math.random() * 15 + 19;      // 19 a 34 px/s (fundo)
      alpha = Math.random() * 0.18 + 0.32; // 0.32 a 0.50
      swayAmp = Math.random() * 14 + 8;
      swayFreq = Math.random() * 0.0007 + 0.0004;
    }

    return {
      layer,
      x: x ?? Math.random() * width,
      y: y ?? -h - 10,
      w,
      h,
      speed,
      alpha,
      swayAmp,
      swayFreq,
      rot: Math.random() * Math.PI * 2,
      /* Rotações em rad/s:acobrem valores diferentes por pétala para que
         nenhuma gire em compasso com a vizinha. */
      rotSpeed: (Math.random() - 0.5) * 0.72,
      tilt: Math.random() * Math.PI * 2,
      tiltSpeed: Math.random() * 0.96 + 0.48,
      phase: Math.random() * Math.PI * 2,
      colorBase: pal.base,
      colorMid: pal.mid,
      colorTip: pal.tip
    };
  }

  /* ── Dimensionamento e preenchimento dos pools ──────────────────── */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const isSmall = width < 680;
    const area = width * height;

    /* Quantidades balanceadas conforme a dimensão da tela */
    const tinyCount    = isSmall ? Math.min(45, Math.max(25, Math.floor(area / 18000))) :
                                   Math.min(95, Math.max(50, Math.floor(area / 14000)));
    const sparkleCount = isSmall ? Math.min(18, Math.max(10, Math.floor(area / 42000))) :
                                   Math.min(32, Math.max(16, Math.floor(area / 32000)));
    const heroCount    = isSmall ? 4 : 7;
    const lightCount   = isSmall ? 6 : 12;
    const petalCount   = isSmall ? Math.min(16, Math.max(10, Math.floor(area / 52000))) :
                                   Math.min(32, Math.max(18, Math.floor(area / 42000)));

    stars.length = 0;
    for (let i = 0; i < tinyCount; i++)    stars.push(mkStar("tiny"));
    for (let i = 0; i < sparkleCount; i++) stars.push(mkStar("sparkle"));
    for (let i = 0; i < heroCount; i++)    stars.push(mkStar("hero"));

    lightPoints.length = 0;
    for (let i = 0; i < lightCount; i++) lightPoints.push(mkLightPoint());

    petals.length = 0;
    for (let i = 0; i < petalCount; i++) {
      petals.push(mkPetal(Math.random() * width, Math.random() * (height + 40) - 20));
    }
  }

  /* ── Desenho procedural da pétala de rosa ───────────────────────── */
  function drawPetal(p, time) {
    const sway = Math.sin(time * p.swayFreq + p.phase) * p.swayAmp;
    const currentX = p.x + sway;
    const currentY = p.y;

    // Simulação 3D de rolagem no ar: escala vertical varia com cosseno
    const tiltScale = Math.cos(p.tilt);
    const squish = Math.abs(tiltScale) * 0.72 + 0.28;

    ctx.save();
    ctx.translate(currentX, currentY);
    ctx.rotate(p.rot);
    ctx.scale(1, tiltScale >= 0 ? squish : -squish);
    ctx.globalAlpha = p.alpha;

    const w = p.w;
    const h = p.h;

    // Contorno orgânico curvo da pétala de rosa
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5); // base
    ctx.bezierCurveTo(-w * 0.85, h * 0.18, -w * 0.78, -h * 0.35, -w * 0.22, -h * 0.50); // lateral esquerda
    ctx.bezierCurveTo(-w * 0.06, -h * 0.54, w * 0.14, -h * 0.52, w * 0.26, -h * 0.46);   // cúpula superior
    ctx.bezierCurveTo(w * 0.82, -h * 0.25, w * 0.76, h * 0.24, 0, h * 0.5);             // lateral direita
    ctx.closePath();

    // Gradiente suave de veludo: base vinho/rosa escuro → ápice blush
    const grad = ctx.createLinearGradient(0, h * 0.5, 0, -h * 0.5);
    grad.addColorStop(0, p.colorBase);
    grad.addColorStop(0.65, p.colorMid);
    grad.addColorStop(1, p.colorTip);
    ctx.fillStyle = grad;
    ctx.fill();

    // Vinco/nervura central para pétalas maiores em primeiro plano
    if (p.layer >= 2) {
      ctx.beginPath();
      ctx.moveTo(0, h * 0.38);
      ctx.quadraticCurveTo(w * 0.08, -h * 0.05, 0, -h * 0.38);
      ctx.strokeStyle = "rgba(255, 235, 245, 0.22)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ── Desenho de ponto de luz cinematográfico (bokeh) ─────────────── */
  function drawLightPoint(lp, time) {
    const curX = lp.baseX + Math.sin(time * lp.driftXFreq + lp.phase) * lp.driftXAmp;
    const curY = lp.baseY + Math.cos(time * lp.driftYFreq + lp.phase) * lp.driftYAmp;
    const pulse = 0.72 + Math.sin(time * lp.pulseFreq + lp.phase) * 0.28;
    const a = lp.baseAlpha * pulse;
    const r = lp.radius;

    const g = ctx.createRadialGradient(curX, curY, 0, curX, curY, r);
    const { r: red, g: grn, b: blu } = lp.color;
    g.addColorStop(0,   `rgba(${red}, ${grn}, ${blu}, ${a * 0.65})`);
    g.addColorStop(0.4, `rgba(${red}, ${grn}, ${blu}, ${a * 0.28})`);
    g.addColorStop(1,   `rgba(${red}, ${grn}, ${blu}, 0)`);

    ctx.beginPath();
    ctx.arc(curX, curY, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* ── Loop principal de animação ─────────────────────────────────────
     Um único requestAnimationFrame em toda a vida da página: nunca há
     dois loops concorrendo, nem um loop órfão depois de um resize ou
     de uma troca de aba. ───────────────────────────────────────────── */
  function draw(time = 0) {
    ctx.clearRect(0, 0, width, height);

    /* Passo de tempo real, limitado para não haver saltos após uma
       aba suspensa. `time` do rAF é monotônico em ms. */
    let dt = lastTime ? (time - lastTime) / 1000 : 1 / FPS_NOMINAL;
    lastTime = time;
    if (!(dt > 0)) dt = 1 / FPS_NOMINAL;
    if (dt > MAX_STEP) dt = MAX_STEP;

    // 1. Camada de fundo: orbes de luz atmosféricos (bokeh difuso)
    for (let i = 0; i < lightPoints.length; i++) {
      drawLightPoint(lightPoints[i], time);
    }

    // 2. Camada intermediária: estrelas cósmicas
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const pulse = 0.62 + Math.sin(time * s.freq + s.phase) * 0.38;
      const alpha = s.baseAlpha * pulse;

      if (s.type === "hero") {
        // Estrela especial: núcleo vívido + halo suave de 2 camadas
        const haloR = s.r * 3.4;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
        g.addColorStop(0, `rgba(255, 240, 250, ${alpha * 0.95})`);
        g.addColorStop(0.35, `rgba(235, 185, 220, ${alpha * 0.38})`);
        g.addColorStop(1, "rgba(220, 160, 205, 0)");

        ctx.beginPath();
        ctx.arc(s.x, s.y, haloR, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // Núcleo branco central
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // Micro raios de difração de 4 pontas quando o brilho está no ápice
        if (pulse > 0.84) {
          const spikeLen = s.r * 2.8 * (pulse - 0.84) / 0.16;
          ctx.strokeStyle = `rgba(255, 245, 252, ${(pulse - 0.84) * 2.2})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(s.x - spikeLen, s.y);
          ctx.lineTo(s.x + spikeLen, s.y);
          ctx.moveTo(s.x, s.y - spikeLen);
          ctx.lineTo(s.x, s.y + spikeLen);
          ctx.stroke();
        }
      } else if (s.type === "sparkle") {
        // Estrela cintilante com halo compacto
        const haloR = s.r * 2.4;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
        g.addColorStop(0, s.color);
        g.addColorStop(0.4, `rgba(240, 205, 230, ${alpha * 0.45})`);
        g.addColorStop(1, "rgba(230, 180, 220, 0)");

        ctx.beginPath();
        ctx.arc(s.x, s.y, haloR, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.globalAlpha = Math.min(1, alpha * 1.2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // Estrela discreta de fundo
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Micro-deriva sutil quase imperceptível
      if (!reducedMotion) {
        s.x += s.driftX * dt;
        s.y += s.driftY * dt;
        if (s.x < -10) s.x = width + 10;
        else if (s.x > width + 10) s.x = -10;
        if (s.y < -10) s.y = height + 10;
        else if (s.y > height + 10) s.y = -10;
      }
    }

    // 3. Camada superior: pétalas de rosa caindo suavemente
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      drawPetal(p, time);

      if (!reducedMotion) {
        p.y += p.speed * dt;
        p.rot += p.rotSpeed * dt;
        p.tilt += p.tiltSpeed * dt;

        /* Reciclagem suave ao sair da tela: a pétala reaparece no topo,
           em uma nova coluna e com uma nova velocidade apparentemente
           (a velocidade base permanece, mas a posição de origem muda),
           evitando qualquer padrão mecânico perceptível. */
        if (p.y > height + p.h + 20) {
          p.y = -p.h - 15 - Math.random() * 120;
          p.x = Math.random() * width;
        }
        if (p.x < -p.w - 30) p.x = width + p.w + 30;
        else if (p.x > width + p.w + 30) p.x = -p.w - 30;
      }
    }

    if (!reducedMotion) {
      raf = requestAnimationFrame(draw);
    } else {
      raf = 0;
    }
  }

  /* ── Inicialização ──────────────────────────────────────────────── */
  function start() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastTime = 0;
    if (reducedMotion) {
      draw(0);
    } else {
      raf = requestAnimationFrame(draw);
    }
  }

  resize();
  start();

  /* ── API mínima para o controle de movimento da página ─────────────
     main.js chama setMotion() quando o visitante usa o botão
     "Ver tudo se animando". Sem isto, a atmosfera continuava
     congelada mesmo com o opt-in ligado. ──────────────────────────── */
  window.ProjetoAmorAtmosphere = {
    setMotion(allow) {
      motionForced = !!allow;
      reducedMotion = motionQuery.matches && !motionForced;
      start();
    },
    isMoving: () => !reducedMotion,
    isSystemReduced: () => motionQuery.matches,
    count: () => petals.length
  };

  /* ── Redimensionamento com debounce suave ───────────────────────── */
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      start();
    }, 100);
  }, { passive: true });

  /* ── Controle de ciclo de vida da página (aba em segundo plano) ── */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (!reducedMotion) {
      if (raf) cancelAnimationFrame(raf);
      lastTime = 0;                 /* retoma sem salto de posição */
      raf = requestAnimationFrame(draw);
    }
  });

  /* ── Atualização em tempo real de acessibilidade ────────────────── */
  motionQuery.addEventListener("change", () => {
    reducedMotion = motionQuery.matches && !motionForced;
    start();
  });

  /* ── Outro contexto (outra aba) alterou a preferência persistida ─── */
  window.addEventListener("storage", event => {
    if (event.key !== MOTION_KEY) return;
    motionForced = event.newValue === "1";
    reducedMotion = motionQuery.matches && !motionForced;
    start();
  });
})();
