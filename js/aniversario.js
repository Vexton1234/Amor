/* Projeto Amor — Etapa 6: Homenagem de aniversário cinematográfica.
   Autocontida: não toca no editor, envelope, carta, galeria, surpresa ou fotos.

   Visual:
   • Fundo preto profundo com corações vermelhos caindo (canvas próprio)
   • Fotografia no topo, com fade-in suave
   • Digitação gradual do texto com cursor discreto e pausas naturais

   API: window.ProjetoAmorAniversario = { open, close, isOpen, setMotion } */
(() => {
  "use strict";

  const scene = document.getElementById("aniversario-scene");
  if (!scene) return;

  const canvas  = document.getElementById("aniversario-hearts");
  const photoEl = document.getElementById("aniversario-photo");
  const textEl  = document.getElementById("aniversario-text");
  const backBtn = document.getElementById("aniversario-back");

  /* ══════════════════════════════════════════════════════════════
     MOVIMENTO — mesma chave que os outros módulos
     ══════════════════════════════════════════════════════════════ */
  const MOTION_KEY = "projeto-amor:animar";
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motionForced = false;
  try { motionForced = window.localStorage.getItem(MOTION_KEY) === "1"; } catch (_) {}
  let reduced = motionQuery.matches && !motionForced;

  /* ══════════════════════════════════════════════════════════════
     ESTADO
     ══════════════════════════════════════════════════════════════ */
  let active  = false;
  let closing = false;
  let heartsRaf = 0;
  let typeTimer = 0;
  let onExitCb = null;
  let photoSource = null; /* foto escolhida na edição (data URL / caminho) */

  /* ══════════════════════════════════════════════════════════════
     CORAÇÕES — canvas isolado, sem tocar nas pétalas de particulas.js
     ══════════════════════════════════════════════════════════════ */
  const hearts = [];
  const HEART_COUNT = 28;
  const HEART_COLORS = [
    "rgba(220, 38, 60, 0.82)",
    "rgba(190, 20, 40, 0.70)",
    "rgba(240, 80, 100, 0.65)",
    "rgba(255, 120, 140, 0.55)"
  ];

  function spawnHeart() {
    return {
      x: Math.random() * (canvas ? canvas.width : window.innerWidth),
      y: -(10 + Math.random() * 60),
      size: 8 + Math.random() * 14,
      speed: 0.6 + Math.random() * 1.1,
      drift: (Math.random() - 0.5) * 0.4,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.025,
      alpha: 0.55 + Math.random() * 0.45,
      color: HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)]
    };
  }

  function drawHeart(ctx, h) {
    const s = h.size;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    ctx.globalAlpha = h.alpha;
    ctx.fillStyle = h.color;
    ctx.beginPath();
    /* Coração em bezier: dois arcos + ponta inferior */
    ctx.moveTo(0, s * 0.3);
    ctx.bezierCurveTo(-s * 0.1, -s * 0.1, -s * 0.6, -s * 0.1, -s * 0.5, s * 0.3);
    ctx.bezierCurveTo(-s * 0.5, s * 0.6, -s * 0.1, s * 0.85, 0, s * 1.0);
    ctx.bezierCurveTo(s * 0.1, s * 0.85, s * 0.5, s * 0.6, s * 0.5, s * 0.3);
    ctx.bezierCurveTo(s * 0.6, -s * 0.1, s * 0.1, -s * 0.1, 0, s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function tickHearts() {
    heartsRaf = 0;
    if (!active || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < hearts.length; i++) {
      const h = hearts[i];
      h.y += h.speed;
      h.x += h.drift;
      h.rot += h.rotSpeed;
      if (h.y > canvas.height + h.size * 2) {
        /* Recicla pelo topo */
        h.y = -(h.size * 2);
        h.x = Math.random() * canvas.width;
      }
      drawHeart(ctx, h);
    }

    heartsRaf = requestAnimationFrame(tickHearts);
  }

  function startHearts() {
    if (reduced || !canvas) return;
    resizeCanvas();
    if (!hearts.length) {
      for (let i = 0; i < HEART_COUNT; i++) {
        const h = spawnHeart();
        /* Espalhados verticalmente no início para não caírem todos juntos */
        h.y = Math.random() * (canvas.height + 100);
        hearts.push(h);
      }
    }
    if (!heartsRaf) heartsRaf = requestAnimationFrame(tickHearts);
  }

  function stopHearts() {
    if (heartsRaf) { cancelAnimationFrame(heartsRaf); heartsRaf = 0; }
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     DIGITAÇÃO — motor simples, independente do main.js
     ══════════════════════════════════════════════════════════════ */
  const TEXT = "Hoje é o dia em que o mundo celebra a sua existência, " +
    "mas eu queria que você pudesse enxergar o quanto a sua presença também " +
    "transformou o meu mundo. Entre tantas pessoas, tantos caminhos e tantos " +
    "momentos, conhecer você se tornou uma das partes mais bonitas da minha " +
    "história. Eu não sei tudo o que o futuro reserva, mas sei que existem " +
    "sentimentos que merecem ser vividos com coragem, cuidado e verdade. E você " +
    "é alguém com quem eu gostaria de descobrir cada capítulo que ainda está por " +
    "vir. Feliz aniversário, meu carinho. Que a vida seja tão bonita com você " +
    "quanto você tornou os meus dias.";

  /* Pausas naturais após pontuação */
  function charDelay(ch, next) {
    if (ch === "." || ch === "!" || ch === "?") return 420;
    if (ch === ",") return 160;
    if (ch === " " && next && next === next.toUpperCase() && next !== " ") return 90;
    return 52;
  }

  function getGraphemes(text) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      try {
        const seg = new Intl.Segmenter("pt", { granularity: "grapheme" });
        return Array.from(seg.segment(text), s => s.segment);
      } catch (_) {}
    }
    return Array.from(text);
  }

  function typeText(chars, index, onDone) {
    if (!active || !textEl) return;
    if (index >= chars.length) {
      /* Remove cursor ao terminar */
      textEl.classList.remove("is-typing");
      if (onDone) onDone();
      return;
    }
    textEl.textContent += chars[index];
    const delay = charDelay(chars[index], chars[index + 1] || "");
    typeTimer = window.setTimeout(() => typeText(chars, index + 1, onDone), delay);
  }

  function startTyping() {
    if (!textEl) return;
    textEl.textContent = "";
    textEl.classList.add("is-typing");

    if (reduced) {
      textEl.textContent = TEXT;
      textEl.classList.remove("is-typing");
      return;
    }

    const chars = getGraphemes(TEXT);
    typeTimer = window.setTimeout(() => typeText(chars, 0, null), 600);
  }

  function cancelTyping() {
    if (typeTimer) { window.clearTimeout(typeTimer); typeTimer = 0; }
    if (textEl) textEl.classList.remove("is-typing");
  }

  /* ══════════════════════════════════════════════════════════════
     ABERTURA E FECHAMENTO
     ══════════════════════════════════════════════════════════════ */
  function focusScene() {
    if (!scene || typeof scene.focus !== "function") return;
    try { scene.focus({ preventScroll: true }); } catch (_) { scene.focus(); }
  }

  function open(options) {
    if (active || closing) return;
    onExitCb = (options && typeof options.onExit === "function") ? options.onExit : null;
    photoSource = (options && options.context && Array.isArray(options.context.photos))
      ? (options.context.photos.filter(Boolean)[0] || null)
      : null;

    scene.hidden = false;
    active = true;
    closing = false;
    scene.classList.remove("is-leaving");

    document.body.classList.add("aniversario-open");

    resizeCanvas();
    startHearts();
    focusScene();

    /* Dois frames para garantir que o hidden=false já pintou */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!active) return;
      scene.classList.add("is-stable");
      /* Foto aparece primeiro, texto começa logo após */
      if (photoEl) {
        if (photoSource) photoEl.src = photoSource;
        photoEl.classList.add("is-visible");
      }
      window.setTimeout(startTyping, reduced ? 0 : 900);
    }));
  }

  function close(cb) {
    if (!active || closing) return;
    closing = true;
    active = false;

    cancelTyping();
    stopHearts();

    scene.classList.remove("is-stable");
    scene.classList.add("is-leaving");

    window.setTimeout(() => {
      scene.hidden = true;
      scene.classList.remove("is-leaving");
      if (photoEl) photoEl.classList.remove("is-visible");
      document.body.classList.remove("aniversario-open");
      closing = false;
      hearts.length = 0; /* limpa pool para próxima abertura */

      const done = cb || onExitCb;
      onExitCb = null;
      if (typeof done === "function") {
        try { done(); } catch (_) {}
      }
    }, reduced ? 20 : 650);
  }

  /* ══════════════════════════════════════════════════════════════
     CONTROLES
     ══════════════════════════════════════════════════════════════ */
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      close(() => {
        /* Volta para a surpresa, se estiver disponível */
        if (window.ProjetoAmorSurpresa && typeof window.ProjetoAmorSurpresa.open === "function") {
          window.ProjetoAmorSurpresa.open();
        }
      });
    });
  }

  document.addEventListener("keydown", event => {
    if (!active) return;
    if (event.key === "Escape") {
      close();
      event.preventDefault();
    }
  });

  window.addEventListener("resize", () => {
    if (!active) return;
    resizeCanvas();
  });

  /* Aba oculta: pausa corações */
  document.addEventListener("visibilitychange", () => {
    if (!active) return;
    if (document.hidden) stopHearts();
    else startHearts();
  });

  const onMotionChange = event => {
    reduced = event.matches && !motionForced;
    if (!active) return;
    if (reduced) stopHearts();
    else startHearts();
  };
  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", onMotionChange);
  } else if (typeof motionQuery.addListener === "function") {
    motionQuery.addListener(onMotionChange);
  }

  /* ══════════════════════════════════════════════════════════════
     API
     ══════════════════════════════════════════════════════════════ */
  window.ProjetoAmorAniversario = {
    open,
    close,
    isOpen: () => active,
    setMotion(allow) {
      motionForced = !!allow;
      reduced = motionQuery.matches && !motionForced;
      if (!active) return;
      if (reduced) stopHearts();
      else startHearts();
    }
  };
})();

