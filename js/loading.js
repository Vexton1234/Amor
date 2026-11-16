/* Projeto Amor — Tela de carregamento cinematográfica.
   Autocontida: não altera a digitação da carta nem o fluxo do editor.
   Controla o cronômetro, o carrossel 3D e a mensagem digitada. */
(() => {
  "use strict";

  const screen = document.getElementById("loading-screen");
  if (!screen) return;

  /* ── Configuração central da experiência ──────────────────────── */
  const DURATION_MS = 60000;   /* alvo do tempo total na tela (60s) */
  const EXIT_MS = 1200;        /* duração do fade de saída */
  const CAROUSEL_FRAME_MS = 1000 / 60;

  /* ── Digitação do texto de carregamento ─────────────────────────
     A cadência NÃO é um número solto: é resolvida em tempo de carga a
     partir do tamanho da mensagem, para que o texto seja escrito ao
     longo de praticamente toda a tela de 60s em vez de terminar cedo e
     ficar parado. Continua sendo um único `setTimeout` por caractere. */
  const TYPE_START_DELAY = 1200;
  const TYPING_TAIL_MS = 8000;     /* texto completo visível antes do fim */
  /* Pausas fixas por tipo de caractere (somadas à cadência base) */
  const PAUSE_LINE_MS = 260;      /* fim de linha */
  const PAUSE_SENTENCE_MS = 420;  /* . ? ! */
  const PAUSE_COMMA_MS = 180;     /* , ; : — */
  const MIN_BASE_MS = 38;         /* trava de segurança: nunca corrido */
  const MAX_BASE_MS = 150;        /* trava de segurança: nunca arrastado */
  /* Mesmo alvo de tempo nos dois modos: só a animação muda, nunca a
     duração. Passa pelo MESMO scheduleEnd(), portanto continua
     existindo um único timer na tela. */
  const REDUCED_DURATION_MS = 60000; /* experiência estática, mesma duração */

  /* Mensagem original, em trechos curtos com pausas intencionais.
     `\n\n` entre parágrafos vira respiro real na leitura. */
  const MESSAGE =
    "Existe um instante antes de abrir qualquer coisa\n" +
    "em que o coração já sabe o que vai encontrar.\n\n" +
    "Antes do primeiro toque, antes da primeira palavra,\n" +
    "já existe um pouco de você aqui.\n\n" +
    "Algumas palavras pesam mais que outras.\n" +
    "Guardam aquilo que a gente não consegue dizer:\n" +
    "o olhar que demorou um segundo a mais,\n" +
    "o nome lembrado na hora certa,\n" +
    "o silêncio que disse tudo sem som.\n\n" +
    "Escrevi devagar. Cada frase lida uma vez,\n" +
    "e outra, até encontrar o jeito dela.\n\n" +
    "Há coisas que a pressa nunca alcança.\n" +
    "A luz baixa no fim da tarde,\n" +
    "o som da chuva que não pede resposta,\n" +
    "a certeza tranquila de quem escolheu ficar.\n\n" +
    "Quando esta carta abrir,\n" +
    "ela vai ser só um pedaço do que existe.";

  /* ══════════════════════════════════════════════════════════════
     MOVIMENTO
     O opt-in persistido pelo visitante (mesma chave usada por
     main.js e particulas.js) vence a preferência do sistema. Sem esta
     leitura, quem ligasse "Ver tudo se animando" continuaria vendo o
     carrossel parado e o texto instantâneo, porque este módulo só
     olhava para prefers-reduced-motion. ══════════════════════════════ */
  const MOTION_KEY = "projeto-amor:animar";
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motionForced = false;
  try {
    motionForced = window.localStorage.getItem(MOTION_KEY) === "1";
  } catch (_) {
    /* localStorage indisponível: segue a preferência do sistema */
  }
  let reduced = reducedQuery.matches && !motionForced;

  const typingEl = document.getElementById("loading-typing");
  const statusEl = document.getElementById("loading-status");
  const carousel = document.getElementById("loading-carousel");
  const ring = document.getElementById("loading-carousel-ring");

  /* ── Estado: tudo pertence a esta execução ────────────────────── */
  let started = false;      /* inicialização única */
  let finished = false;     /* encerramento único */
  let rafId = 0;            /* rAF do carrossel */
  let timerId = 0;          /* temporizador principal */
  let typeTimer = 0;        /* temporizador da digitação */
  let elapsedBeforePause = 0;
  let pauseStartedAt = 0;
  let startedAt = 0;      /* instante do início, base da rotação automática */
  let typingRan = false;  /* a digitação real já foi iniciada ao menos uma vez */

  /* ══════════════════════════════════════════════════════════════
     CARROSSEL 3D — um único rAF, posições calculadas uma vez
     ══════════════════════════════════════════════════════════════ */

  let panels = ring ? Array.from(ring.querySelectorAll(".carousel-item")) : [];

  /* ══════════════════════════════════════════════════════════════
     FOTOS REAIS DO CASAL
     Quando existem fotos na carta, elas substituem as ilustrações
     padrão. O anel 3D é o mesmo: só a lista de painéis muda, e a
     geometria já se adapta a qualquer quantidade de itens.
     Sem fotos, nada é tocado e o carrossel segue com os exemplos.
     ══════════════════════════════════════════════════════════════ */

  const isPhotoDataUrl = value =>
    typeof value === "string" && /^data:image\/(jpeg|jpg|png|webp|gif|avif);base64,/i.test(value.trim());

  function buildCarouselFromPhotos(list) {
    if (!ring) return false;

    const photos = (Array.isArray(list) ? list : []).filter(isPhotoDataUrl);

    /* Sem fotos na carta: nada é tocado e o carrossel segue com as
       ilustrações padrão do HTML. */
    if (!photos.length) return false;

    /* Desmonta o anel (as ilustrações padrão) e remonta com as fotos
       reais do casal. O anel 3D é o mesmo: só a lista de painéis muda,
       e a geometria recalculada em `start` se adapta a qualquer
       quantidade de itens. */
    while (ring.firstChild) {
      ring.removeChild(ring.firstChild);
    }

    photos.forEach((src, index) => {
      const figure = document.createElement("figure");
      figure.className = "carousel-item";
      const img = document.createElement("img");
      img.src = String(src).trim();
      img.alt = `Foto de vocês ${index + 1}`;
      img.loading = "eager";
      img.decoding = "async";
      img.draggable = false;
      figure.appendChild(img);
      ring.appendChild(figure);
    });

    /* Reaponta a lista de painéis para o anel recém-montado: quem mede a
       geometria (`measure`) e quem vigia as imagens (`guardImages`) usam a
       lista viva, senão o carrossel continuaria no anel antigo. */
    panels = Array.from(ring.querySelectorAll(".carousel-item"));

    /* A geometria (raio, passo, profundidade) nasce da lista nova — quem
       chamou (`start`) recalcula tudo em seguida, depois de a tela já estar
       no fluxo e a lista final conhecida. */
    return true;
  }
  let geometry = null;
  let angle = 0;           /* rotação total (automática + manual) */
  let userAngle = 0;       /* ângulo acumulado pelo arrasto do usuário */
  let dragging = false;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartAngle = 0;
  let lastMoveX = 0;
  let lastMoveTime = 0;
  let velocity = 0;       /* graus/ms, para a inércia */
  let activePointer = 0;  /* nº de dedos tocando (para não conflitar com scroll) */

  function measure() {
    if (!ring || !panels.length) return null;

    const cardW = (panels[0] && panels[0].offsetWidth) || ring.offsetWidth || 132;
    const cardH = (panels[0] && panels[0].offsetHeight) || ring.offsetHeight || 168;
    const stage = carousel ? carousel.clientWidth : window.innerWidth;

    /* Raio limitado pela largura disponível: os painéis laterais podem
       chegar perto da borda, nunca ultrapassá-la. O fator 0.62 deixa
       margem para o cartão em perspectiva. */
    const radius = Math.max(cardW * 0.86, Math.min(stage * 0.30, stage * 0.62));
    const step = 360 / panels.length;

    /* Cada painel: ângulo ao redor do círculo + afastamento lateral */
    const positions = panels.map((_, index) => {
      const a = index * step;
      const rad = (a * Math.PI) / 180;
      return {
        x: Math.sin(rad) * radius,
        z: Math.cos(rad) * radius,
        rotate: a,
        /* profundidade -> opacidade e brilho interpolados */
        depth: (Math.cos(rad) + 1) / 2,
        index
      };
    });

    geometry = { cardW, cardH, radius, step, positions };
    layoutPanels(0);
    return geometry;
  }

  function layoutPanels(rot) {
    if (!geometry) return;
    const { radius, positions } = geometry;

    for (const p of positions) {
      const el = panels[p.index];
      if (!el) continue;
      const a = ((p.rotate + rot) % 360 + 360) % 360;
      const rad = (a * Math.PI) / 180;
      const x = Math.sin(rad) * radius;
      const z = Math.cos(rad) * radius;
      const facing = Math.cos(rad);       /* 1 = de frente, -1 = de costas */
      const depth = (facing + 1) / 2;

      el.style.setProperty(
        "--panel-transform",
        `translate3d(${x.toFixed(2)}px, 0px, ${z.toFixed(2)}px) rotateY(${(-a).toFixed(2)}deg)`
      );
      /* Itens que estão de costas somem suavemente */
      el.style.setProperty("--panel-opacity", (0.18 + depth * 0.82).toFixed(3));
      el.style.setProperty("--panel-bright", (0.42 + depth * 0.58).toFixed(3));
      el.style.setProperty("--panel-sat", (0.55 + depth * 0.45).toFixed(3));
      el.style.zIndex = String(100 + Math.round(depth * 100));
    }
  }

  /* Velocidade: ciclo completo em ~26s — lento o bastante para ser observado */
  const DEG_PER_SEC = 360 / 26;
  /* Quanto ângulo o usuário gira por pixel arrastado */
  const DRAG_DEG_PER_PX = 0.42;
  /* Inércia: perde 94% da velocidade por segundo */
  const INERTIA_DECAY = 0.94;

  function spin() {
    if (finished) return;

    if (!dragging) {
      /* Rotação automática + inércia do gesto anterior */
      let delta = reduced ? 0 : DEG_PER_SEC * (CAROUSEL_FRAME_MS / 1000);
      if (!reduced && Math.abs(velocity) > 0.001) {
        delta += velocity * CAROUSEL_FRAME_MS;
        velocity *= Math.pow(INERTIA_DECAY, CAROUSEL_FRAME_MS / 1000);
      }
      angle = (angle + delta) % 360;
      userAngle = (userAngle + delta) % 360;
    }

    layoutPanels(angle);
    rafId = requestAnimationFrame(spin);
  }

  /* ══════════════════════════════════════════════════════════════
     ARRASTO MANUAL — mouse e toque, uma única gesture
     Altera de fato a rotação; a automática continua somando por cima.
     ══════════════════════════════════════════════════════════════ */

  function onPointerDown(event) {
    if (finished || !geometry) return;
    /* Ignore cliques que começam sobre as próprias imagens */
    activePointer = 1;
    dragging = false;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartAngle = userAngle;
    lastMoveX = event.clientX;
    lastMoveTime = performance.now();
    velocity = 0;
  }

  function onPointerMove(event) {
    if (event.pointerId !== dragPointerId || finished || !geometry) return;

    const dx = event.clientX - dragStartX;

    /* Só assume o gesto após um movimento mínimo: preserva o
       scroll vertical com o dedo sem bloquear a rolagem. */
    if (!dragging) {
      if (Math.abs(dx) < 6) return;
      dragging = true;
      if (carousel && carousel.setPointerCapture) {
        try { carousel.setPointerCapture(event.pointerId); } catch (_) { /* ignora */ }
      }
      if (carousel) carousel.classList.add("is-grabbing");
    }

    event.preventDefault();

    const now = performance.now();
    const dt = Math.max(now - lastMoveTime, 1);
    const deltaDeg = dx * DRAG_DEG_PER_PX;

    /* Arrastar para a esquerda gira o anel; para a direita, o inverso.
       No modo reduzido não existe rotação automática: somar o tempo
       decorrido faria o anel saltar no primeiro movimento do dedo. */
    userAngle = dragStartAngle + deltaDeg;
    angle = (userAngle + (reduced ? 0 : DEG_PER_SEC * ((performance.now() - startedAt) / 1000))) % 360;

    /* Velocidade instantânea para a inércia ao soltar */
    velocity = ((event.clientX - lastMoveX) * DRAG_DEG_PER_PX) / dt;
    lastMoveX = event.clientX;
    lastMoveTime = now;

    layoutPanels(angle);
  }

  function endDrag(event) {
    if (event && event.pointerId !== dragPointerId) return;
    if (dragging && carousel) carousel.classList.remove("is-grabbing");
    if (carousel && carousel.releasePointerCapture && dragPointerId !== null) {
      try { carousel.releasePointerCapture(dragPointerId); } catch (_) { /* ignora */ }
    }
    dragging = false;
    activePointer = 0;
    dragPointerId = null;

    /* Gesto muito rápido não deve disparar inércia: estabiliza */
    if (Math.abs(velocity) > 0.9) velocity = 0;

    /* Garante que o loop volte a rodar (pode ter sido pausado). No modo
       reduzido não existe rotação automática nem inércia: o arraste já
       pintou cada posição em onPointerMove, então não há razão para
       manter um rAF de 60 Hz durante os 60 s da tela. */
    if (!reduced && !rafId && !finished) rafId = requestAnimationFrame(spin);
  }

  function bindDrag() {
    if (!carousel) return;
    carousel.addEventListener("pointerdown", onPointerDown, { passive: true });
    carousel.addEventListener("pointermove", onPointerMove, { passive: false });
    carousel.addEventListener("pointerup", endDrag, { passive: true });
    carousel.addEventListener("pointercancel", endDrag, { passive: true });
    carousel.addEventListener("lostpointercapture", endDrag, { passive: true });
  }

  function stopSpin() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ══════════════════════════════════════════════════════════════
     IMAGENS — falha silenciosa nunca interrompe a experiência
     ══════════════════════════════════════════════════════════════ */

  function guardImages() {
    for (const panel of panels) {
      const img = panel.querySelector("img");
      if (!img) continue;
      img.addEventListener(
        "error",
        () => {
          panel.classList.add("is-failed");
        },
        { once: true }
      );
      /* Imagem já quebrada por cache: trata o caso sem esperar o evento */
      if (img.complete && img.naturalWidth === 0) panel.classList.add("is-failed");
    }
  }

  /* ══════════════════════════════════════════════════════════════
     MENSAGEM DIGITADA — pausas naturais entre trechos
     ══════════════════════════════════════════════════════════════ */

  const graphemes = (() => {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      try {
        const seg = new Intl.Segmenter("pt", { granularity: "grapheme" });
        return Array.from(seg.segment(MESSAGE), s => s.segment);
      } catch (_) { /* recuo abaixo */ }
    }
    return Array.from(MESSAGE);
  })();

  /* Pausa fixa por tipo de caractere, somada à cadência base. */
  function extraPauseFor(char) {
    if (char === "\n") return PAUSE_LINE_MS;
    if (char === "?" || char === "." || char === "!") return PAUSE_SENTENCE_MS;
    if (char === "," || char === ";" || char === ":" || char === "—") return PAUSE_COMMA_MS;
    return 0;
  }

  /* Resolve a cadência base uma única vez, para que a digitação ocupe
     praticamente toda a tela. Cada caractere custa `base`; as pausas de
     pontuação são fixas e não escalam, então basta dividir o tempo-alvo
     (já descontadas as pausas) pelo número de caracteres. */
  const BASE_MS = (() => {
    const pauses = graphemes.reduce((sum, char) => sum + extraPauseFor(char), 0);
    const available = Math.max(DURATION_MS - TYPING_TAIL_MS - TYPE_START_DELAY - pauses, 1000);
    const base = Math.round(available / Math.max(graphemes.length, 1));
    return Math.max(MIN_BASE_MS, Math.min(MAX_BASE_MS, base));
  })();

  function delayFor(char) {
    return BASE_MS + extraPauseFor(char);
  }

  function typeAll() {
    let i = 0;
    let rendered = "";
    typingRan = true;
    if (typingEl) typingEl.classList.add("is-typing");

    const step = () => {
      if (finished) {
        if (typingEl) typingEl.classList.remove("is-typing");
        return;
      }
      if (i >= graphemes.length) {
        if (typingEl) typingEl.classList.remove("is-typing");
        setStatus("tudo pronto");
        return;
      }
      const char = graphemes[i];
      rendered += char;
      if (typingEl) typingEl.textContent = rendered; /* textContent, nunca innerHTML */
      i++;
      typeTimer = window.setTimeout(step, delayFor(char));
    };

    typeTimer = window.setTimeout(step, TYPE_START_DELAY);
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  /* ══════════════════════════════════════════════════════════════
     CICLO DE VIDA — início, pausa por visibilidade e encerramento
     ══════════════════════════════════════════════════════════════ */

  function finish() {
    if (finished) return;          /* impede execuções simultâneas */
    finished = true;

    stopSpin();                    /* o carrossel para de verdade */
    if (typeTimer) window.clearTimeout(typeTimer);
    if (timerId) window.clearTimeout(timerId);

    /* Garante o texto completo antes de revelar a carta */
    if (typingEl) {
      typingEl.classList.remove("is-typing");
      typingEl.textContent = MESSAGE;
    }
    if (ring) ring.style.removeProperty("transform");

    screen.classList.add("is-finishing");
    document.body.classList.remove("is-loading");

    window.setTimeout(() => {
      screen.hidden = true;        /* [hidden] real: some do fluxo e do foco */

      /* Notifica só depois que a tela realmente saiu do fluxo: quem
         escuta este evento (main.js, por exemplo) precisa enxergar
         `loadingScreen.hidden === true` para reagir ao fim do
         carregamento. Disparar antes faria a reação acontecer com a
         tela ainda visível. */
      document.dispatchEvent(new CustomEvent("projetoamor:loadingdone"));
    }, EXIT_MS);
  }

  function start(options) {
    if (started || finished) return;   /* inicialização única */
    started = true;
    startedAt = performance.now();

    /* Troca as ilustrações pelas fotos do casal ANTES de medir o anel,
       para que a geometria já seja calculada sobre a lista final. */
    buildCarouselFromPhotos(options && options.photos);

    guardImages();
    screen.hidden = false;
    document.body.classList.add("is-loading");
    bindDrag();

    /* A troca de orientação/tamanho recalcula a geometria nos dois modos.
       Antes o ouvinte era registrado apenas no ramo animado; quem abria a
       carta com movimento reduzido e depois girava o celular ficava com o
       anel medido para a tela antiga até recarregar. */
    window.addEventListener("resize", () => {
      if (finished) return;
      measure();
    });

    if (reduced) {
      /* Sem digitação nem rotação automática, mas o carrossel continua
         utilizável: o usuário pode arrastá-lo à mão. Nenhum rAF fica
         girando à toa durante a tela inteira — onPointerMove pinta cada
         posição do arraste diretamente. */
      if (typingEl) typingEl.textContent = MESSAGE;
      setStatus("preparando tudo para você");
      measure();
      scheduleEnd(REDUCED_DURATION_MS);
      return;
    }

    measure();
    spin();

    typeAll();
    scheduleEnd(DURATION_MS);
  }

  /* Cronômetro em tempo "corrido": abas em segundo plano não
     avançam o relógio, evitando surpresas ao voltar à aba. */
  function scheduleEnd(totalMs) {
    const remaining = totalMs - elapsedBeforePause;
    timerId = window.setTimeout(finish, Math.max(0, remaining));
  }

  function pauseClock() {
    if (finished || pauseStartedAt) return;
    pauseStartedAt = performance.now();
    if (timerId) { window.clearTimeout(timerId); timerId = 0; }
    if (typeTimer) { window.clearTimeout(typeTimer); typeTimer = 0; }
    stopSpin();
  }

  function resumeClock() {
    if (finished || !pauseStartedAt) return;
    elapsedBeforePause += performance.now() - pauseStartedAt;
    pauseStartedAt = 0;

    const total = reduced ? REDUCED_DURATION_MS : DURATION_MS;
    scheduleEnd(total);
    if (!reduced) spin();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseClock();
    else resumeClock();
  });

  /* Se o usuário mudar a preferência com a tela aberta, respeita na hora */
  reducedQuery.addEventListener("change", event => {
    reduced = event.matches && !motionForced;
    if (finished) return;
    stopSpin();
    if (reduced) {
      if (typingEl) {
        typingEl.classList.remove("is-typing");
        typingEl.textContent = MESSAGE;
      }
    } else if (!rafId) {
      measure();
      spin();
    }
  });

  /* API mínima para o main.js iniciar a tela somente com dados válidos */
  window.ProjetoAmorLoading = {
    start,
    finish,
    isActive: () => started && !finished,
    /* Permite respeitar o opt-in do usuário também nesta tela.
       `allow = true` volta a girar o carrossel e retoma a digitação
       mesmo que o laço estivesse parado ou que o texto já tivesse
       apareceu instantaneamente: sem isto, clicar em "Ver tudo se
       animando" deixava o carrossel congelado. Nunca cria um segundo
       laço — `rafId` é sempre o único responsável por `spin`. */
    setMotion: (allow) => {
      const wasReduced = reduced;
      motionForced = !!allow;
      reduced = reducedQuery.matches && !motionForced;
      if (finished || !started) return;

      if (reduced) {
        stopSpin();
        if (typingEl) {
          typingEl.classList.remove("is-typing");
          typingEl.textContent = MESSAGE;
        }
        setStatus("preparando tudo para você");
        return;
      }

      if (!rafId) {
        if (!geometry) measure();
        if (!startedAt) startedAt = performance.now();
        rafId = requestAnimationFrame(spin);
      }

      /* O texto já havia sido despejado de uma vez pelo modo reduzido:
         recomeça a digitação para o opting-in realmente ser visível. */
      if (wasReduced && !typingRan && !finished) {
        setStatus("preparando tudo para você");
        typeAll();
      }
    }
  };
})();