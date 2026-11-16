/* Projeto Amor â€” PÃ¡gina cinematogrÃ¡fica exclusiva das fotografias.
   Etapa 5: entra depois que a Ãºltima carta (a mensagem da surpresa, na
   cena de chuva) termina de ser lida.

   Reaproveitamento â€” nada de sistema novo:
   â€¢ As fotos sÃ£o exatamente as mesmas data URLs que o editor jÃ¡ gravou
     no link. Este mÃ³dulo nÃ£o cria, nÃ£o substitui e nÃ£o inventa imagem.
   â€¢ A cena vive ao lado da galeria e da surpresa, dentro de #experience:
     trocar de etapa continua sendo mostrar/ocultar, sem recarregar.
   â€¢ A atmosfera Ã© CSS puro: quatro paletas predefinidas se alternam em
     cross-fade quando uma nova foto passa a ser a principal. Nenhuma
     anÃ¡lise de imagem, nenhuma IA.
   â€¢ O carrossel Ã© um anel 3D leve: posiÃ§Ãµes calculadas por um Ãºnico rAF
     e aplicadas como transform/opacity. As fotos de trÃ¡s continuam
     visÃ­veis, com escala, perspectiva e iluminaÃ§Ã£o prÃ³prias.
   â€¢ A pÃ¡gina nÃ£o substitui a galeria existente, nÃ£o toca na chuva, no
     som, no editor, nos links nem na digitaÃ§Ã£o da carta.

   API: window.ProjetoAmorFotos = { open, close, isOpen, count, setMotion } */
(() => {
  "use strict";

  const scene = document.getElementById("photos-scene");
  if (!scene) return;

  const stage    = document.getElementById("photos-stage");
  const ring     = document.getElementById("photos-ring");
  const counter  = document.getElementById("photos-counter");
  const backBtn  = document.getElementById("photos-back");
  const palettes = Array.from(scene.querySelectorAll(".photos-palette"));

  /* Mesma regra de validaÃ§Ã£o do editor e da galeria: sÃ³ data URL. */
  const isPhotoDataUrl = value =>
    typeof value === "string" &&
    /^data:image\/(jpeg|jpg|png|webp|gif|avif);base64,/i.test(value.trim());

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     MOVIMENTO â€” mesma chave e mesma regra de main.js/galeria.js:
     o opt-in do visitante vence a preferÃªncia do sistema.
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  const MOTION_KEY = "projeto-amor:animar";
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motionForced = false;
  try {
    motionForced = window.localStorage.getItem(MOTION_KEY) === "1";
  } catch (_) { /* localStorage bloqueado: segue o sistema */ }
  let reduced = motionQuery.matches && !motionForced;

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     ESTADO
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  let photos = [];
  let cards = [];
  let active = false;
  let closing = false;
  let onEnter = null;
  let onExit = null;

  /* Geometria */
  let radius = 320;
  let step = 60;
  let maxBoxW = 340;
  let maxBoxH = 400;

  /* RotaÃ§Ã£o. `rotation` Ã© contÃ­nua e pode ser negativa: a foto da frente
     Ã© a que estÃ¡ mais perto do Ã¢ngulo 0. */
  let rotation = 0;
  let mode = "idle";          /* idle | drag | inertia | snap | auto */
  let snapTarget = 0;
  let velocity = 0;           /* graus por milissegundo */
  let autoFactor = 0;         /* entrada suave da rotaÃ§Ã£o automÃ¡tica */
  let resumeAt = 0;
  let autoSpeed = 6;          /* graus por segundo */
  let lastTs = 0;
  let rafId = 0;
  let frontIndex = -1;
  let moodIndex = -1;

  /* Gesto */
  let pointerDown = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastTime = 0;
  let decided = false;
  let horizontal = false;

  const DRAG_DEG_PER_PX = 0.34;
  const MAX_VELOCITY = 0.62;  /* graus/ms: inÃ©rcia discreta, sem rodopio */
  const RESUME_DELAY_MS = 3800;
  const INITIAL_DELAY_MS = 2400;

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     MONTAGEM â€” uma vez por conjunto de fotos.
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  function build(list) {
    photos = (Array.isArray(list) ? list : []).filter(isPhotoDataUrl);

    if (ring) ring.textContent = "";
    cards = [];
    frontIndex = -1;
    moodIndex = -1;
    rotation = 0;
    mode = "idle";
    velocity = 0;
    autoFactor = 0;

    /* Com uma Ãºnica foto nÃ£o hÃ¡ anel para girar: a cena vira um retrato
       central e o convite ao gesto sai de cena. */
    scene.classList.toggle("is-single", photos.length < 2);

    photos.forEach((src, index) => {
      const card = document.createElement("figure");
      card.className = "photos-card";
      card.setAttribute("role", "group");
      card.setAttribute("aria-roledescription", "foto");
      card.setAttribute("aria-label", `Foto ${index + 1} de ${photos.length}`);

      const img = document.createElement("img");
      img.alt = `Foto de vocÃªs ${index + 1}`;
      img.decoding = "async";
      img.draggable = false;
      img.src = src.trim();

      img.addEventListener("load", () => {
        sizeCard(card);
        measure();
      }, { once: true });

      img.addEventListener("error", () => {
        card.classList.add("is-broken");
      }, { once: true });

      card.appendChild(img);
      ring.appendChild(card);
      cards.push(card);

      /* Cache: a imagem pode jÃ¡ estar pronta antes do ouvinte. */
      if (img.complete) {
        if (img.naturalWidth > 0) sizeCard(card);
        else card.classList.add("is-broken");
      }
    });

    measure();
    updateFront(true);
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     GEOMETRIA
     A caixa de cada foto acompanha a proporÃ§Ã£o real da imagem: retrato
     continua retrato, paisagem continua paisagem. Assim o anel nÃ£o
     estica nem corta as fotografias.
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  function computeBox() {
    const w = (stage && stage.clientWidth) || window.innerWidth || 360;
    const h = (stage && stage.clientHeight) || Math.round(window.innerHeight * 0.55) || 420;
    const narrow = w < 640;

    maxBoxW = Math.min(w * (narrow ? 0.56 : 0.32), narrow ? 230 : 360);
    maxBoxH = Math.min(h * 0.56, narrow ? 300 : 430);

    /* Piso: nunca vira um selo, mesmo em telas muito baixas. */
    maxBoxW = Math.max(maxBoxW, 120);
    maxBoxH = Math.max(maxBoxH, 160);
  }

  function sizeCard(card) {
    if (!card) return;
    const img = card.querySelector("img");
    const nw = img && img.naturalWidth;
    const nh = img && img.naturalHeight;

    let w;
    let h;

    if (nw && nh) {
      const ratio = nw / nh;
      w = maxBoxW;
      h = w / ratio;
      if (h > maxBoxH) {
        h = maxBoxH;
        w = h * ratio;
      }
    } else {
      /* Enquanto a imagem nÃ£o mediu, uma moldura neutra segura o lugar. */
      w = maxBoxW * 0.82;
      h = Math.min(maxBoxH * 0.86, w / 0.78);
    }

    card.style.setProperty("--card-w", `${Math.round(w)}px`);
    card.style.setProperty("--card-h", `${Math.round(h)}px`);
    card._w = w;
    card._h = h;
  }

  function measure() {
    if (!stage || !cards.length) return;
    computeBox();
    cards.forEach(sizeCard);

    const stageW = stage.clientWidth || window.innerWidth || 360;
    const stageH = stage.clientHeight || Math.round(window.innerHeight * 0.55) || 420;

    const widest = Math.max(
      160,
      ...cards.map(card => card._w || 0)
    );

    step = 360 / Math.max(photos.length, 1);

    radius = photos.length < 2
      ? 0
      : Math.min(
          Math.max(widest * 1.25, stageW * 0.42),
          stageW * 0.62,
          stageH * 0.84
        );

    autoSpeed = 360 / Math.max(44, Math.min(82, photos.length * 8));

    layout();
  }

  function layout() {
    if (!cards.length) return;
    const rad0 = Math.PI / 180;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const angle = ((i * step + rotation) % 360 + 360) % 360;
      const rad = angle * rad0;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const x = sin * radius;
      const z = cos * radius;
      const y = -cos * radius * 0.12;

      const depth = (cos + 1) / 2;
      const rotY = -angle * 0.08;

      card.style.transform =
        `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) ` +
        `rotateY(${rotY.toFixed(2)}deg)`;
      card.style.opacity = (0.6 + depth * 0.4).toFixed(3);
      card.style.filter =
        `brightness(${(0.76 + depth * 0.24).toFixed(3)}) ` +
        `saturate(${(0.88 + depth * 0.12).toFixed(3)})`;
      card.style.zIndex = String(100 + Math.round(depth * 300));
    }

    updateFront();
  }

  function updateFront(force) {
    if (!photos.length) return;

    const index = ((Math.round(-rotation / step) % photos.length) +
                   photos.length) % photos.length;

    if (!force && index === frontIndex) return;
    frontIndex = index;

    cards.forEach((card, i) => card.classList.toggle("is-front", i === index));

    if (counter) {
      const pad = n => String(n).padStart(2, "0");
      counter.textContent = `${pad(index + 1)} / ${pad(photos.length)}`;
    }

    setMood(index);
  }

  /* Atmosfera ativa da foto que estÃ¡ na frente: a paleta do clima entra
     no ar (cross-fade por opacidade) e a `data-mood` liga chuva, luzes
     urbanas e pontos de luz. A troca Ã© lenta â€” nunca um corte. */
  function setMood(index) {
    moodIndex = index;

    if (scene) scene.setAttribute("data-mood", String(index));

    palettes.forEach(palette => {
      const moodClass = `p${index}`;
      palette.classList.toggle("is-active", palette.classList.contains(moodClass));
    });
  }

  /* Ativar a paleta de clima da foto atual */
  function startLoop() {
    /* Uma foto sÃ³ nÃ£o tem anel para girar: nenhum rAF fica rodando Ã 
       toa enquanto a cena estÃ¡ aberta. */
    if (reduced || rafId || !active || photos.length < 2) return;
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastTs = 0;
  }

  function tick(now) {
    rafId = 0;
    if (!active) return;

    const ts = typeof now === "number" ? now : performance.now();
    const dt = lastTs ? Math.min(50, ts - lastTs) : 16;
    lastTs = ts;

    advance(dt, ts);
    layout();

    rafId = requestAnimationFrame(tick);
  }

  function advance(dt, now) {
    if (photos.length < 2) {
      rotation = 0;
      mode = "idle";
      return;
    }

    if (mode === "drag") return;

    if (mode === "inertia") {
      rotation += velocity * dt;
      velocity *= Math.pow(0.90, dt / 16.67);

      if (Math.abs(velocity) < 0.0008) {
        velocity = 0;
        beginSnap(now);
      }
      return;
    }

    if (mode === "snap") {
      const delta = snapTarget - rotation;
      const ease = 1 - Math.pow(0.78, dt / 16.67);
      rotation += delta * ease;

      if (Math.abs(delta) < 0.08) {
        rotation = snapTarget;
        mode = "idle";
      }
      return;
    }

    if (reduced) {
      mode = "idle";
      return;
    }

    /* Pausa depois do gesto: o anel fica parado um instante e sÃ³ entÃ£o
       a rotaÃ§Ã£o automÃ¡tica volta, acelerando devagar. */
    if (now < resumeAt) {
      mode = "idle";
      autoFactor = 0;
      return;
    }

    mode = "auto";
    autoFactor = Math.min(1, autoFactor + dt / 900);
    rotation -= autoSpeed * autoFactor * (dt / 1000);
  }

  function beginSnap(now) {
    if (reduced) {
      rotation = Math.round(rotation / step) * step;
      mode = "idle";
      layout();
      return;
    }

    snapTarget = Math.round(rotation / step) * step;
    mode = "snap";
    resumeAt = now + RESUME_DELAY_MS;
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     ARRASTE â€” mouse e toque, com escuta passiva atÃ© o gesto virar
     horizontal. O scroll vertical nunca Ã© bloqueado.
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  function onPointerDown(event) {
    if (!active || photos.length < 2) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    pointerDown = true;
    decided = false;
    horizontal = false;
    pointerId = event.pointerId;
    startX = lastX = event.clientX;
    startY = event.clientY;
    lastTime = performance.now();
    velocity = 0;

    /* O toque pausa a rotaÃ§Ã£o automÃ¡tica imediatamente. */
    mode = "drag";
    autoFactor = 0;
    resumeAt = Infinity;
  }

  function onPointerMove(event) {
    if (!pointerDown || event.pointerId !== pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!decided) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
      decided = true;

      /* SÃ³ um gesto predominantemente horizontal gira o anel. */
      horizontal = Math.abs(dx) > Math.abs(dy) * 1.1;
      if (!horizontal) {
        endGesture(event, true);
        return;
      }

      if (stage && stage.setPointerCapture) {
        try { stage.setPointerCapture(event.pointerId); } catch (_) { /* ignora */ }
      }
      if (stage) stage.classList.add("is-grabbing");
    }

    if (!horizontal) return;
    if (event.cancelable) event.preventDefault();

    const now = performance.now();
    const deltaX = event.clientX - lastX;
    const dt = Math.max(now - lastTime, 1);

    rotation += deltaX * DRAG_DEG_PER_PX;
    velocity = Math.max(
      -MAX_VELOCITY,
      Math.min(MAX_VELOCITY, (deltaX * DRAG_DEG_PER_PX) / dt)
    );

    lastX = event.clientX;
    lastTime = now;

    layout();
  }

  function endGesture(event, cancelled) {
    if (!pointerDown) return;

    const wasHorizontal = horizontal;
    pointerDown = false;

    if (stage && stage.releasePointerCapture && pointerId !== null) {
      try { stage.releasePointerCapture(pointerId); } catch (_) { /* ignora */ }
    }
    if (stage) stage.classList.remove("is-grabbing");

    pointerId = null;
    horizontal = false;

    const now = performance.now();

    if (!wasHorizontal || cancelled) {
      velocity = 0;
      mode = "idle";
      autoFactor = 0;
      resumeAt = now + 1400;
      return;
    }

    if (reduced) {
      rotation = Math.round(rotation / step) * step;
      mode = "idle";
      resumeAt = now;
      layout();
      return;
    }

    if (Math.abs(velocity) > 0.0015) {
      mode = "inertia";
      resumeAt = now + RESUME_DELAY_MS;
      startLoop();
    } else {
      velocity = 0;
      beginSnap(now);
      startLoop();
    }
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     NAVEGAÃ‡ÃƒO POR TECLADO
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  function goTo(index) {
    if (!active || photos.length < 2) return;

    const targetIndex = ((index % photos.length) + photos.length) % photos.length;
    const target = -targetIndex * step;

    /* Escolhe a volta mais curta: nunca dÃ¡ uma volta inteira para
       chegar Ã  foto vizinha. */
    let delta = ((target - rotation) % 360 + 540) % 360 - 180;
    if (delta === -180) delta = 180;

    if (reduced) {
      rotation = rotation + delta;
      mode = "idle";
      layout();
      updateFront();
      return;
    }

    snapTarget = rotation + delta;
    velocity = 0;
    autoFactor = 0;
    mode = "snap";
    resumeAt = performance.now() + RESUME_DELAY_MS;
    startLoop();
  }

  const goPrev = () => goTo((frontIndex < 0 ? 0 : frontIndex) - 1);
  const goNext = () => goTo((frontIndex < 0 ? 0 : frontIndex) + 1);

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     ABERTURA E FECHAMENTO
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  function focusScene() {
    if (!scene || typeof scene.focus !== "function") return;
    try { scene.focus({ preventScroll: true }); } catch (_) { scene.focus(); }
  }

  function open(options) {
    if (active || closing) return;

    const list = (options && Array.isArray(options.photos)) ? options.photos : [];
    const valid = list.filter(isPhotoDataUrl);
    if (!valid.length) return;   /* sem fotos: a etapa simplesmente nÃ£o existe */

    onEnter = options && typeof options.onEnter === "function" ? options.onEnter : null;
    onExit  = options && typeof options.onExit  === "function" ? options.onExit  : null;

    build(valid);

    scene.hidden = false;
    active = true;
    closing = false;
    scene.classList.remove("is-leaving", "is-stable");
    scene.classList.add("is-entering");

    document.body.classList.add("photos-open");

    /* Primeiro quadro: a foto 0 jÃ¡ estÃ¡ na frente. A rotaÃ§Ã£o automÃ¡tica
       sÃ³ comeÃ§a depois de um respiro. A cena jÃ¡ estÃ¡ visÃ­vel aqui, entÃ£o
       a geometria Ã© medida no palco real â€” com imagens em cache, a
       mediÃ§Ã£o feita durante o build (com a cena ainda hidden) ficaria
       no tamanho de fallback. */
    rotation = 0;
    mode = "idle";
    autoFactor = 0;
    resumeAt = performance.now() + INITIAL_DELAY_MS;
    frontIndex = -1;
    moodIndex = -1;
    measure();
    updateFront(true);

    startLoop();
    focusScene();

    /* Reflow forÃ§ado: sem um paint no estado inicial a entrada inteira
       seria pulada. */
    void scene.offsetWidth;
    requestAnimationFrame(() => {
      if (!active) return;
      scene.classList.remove("is-entering");
      scene.classList.add("is-stable");
    });

    /* SÃ³ depois da entrada a cena de chuva Ã© suspensa: a transiÃ§Ã£o Ã© um
       cross-fade, nÃ£o um corte. */
    window.setTimeout(() => {
      if (!active) return;
      if (onEnter) {
        try { onEnter(); } catch (_) { /* a atmosfera anterior nÃ£o pode derrubar a nova */ }
      }
    }, reduced ? 20 : 700);
  }

  function close() {
    if (!active || closing) return;
    closing = true;
    active = false;

    stopLoop();

    scene.classList.remove("is-stable");
    scene.classList.add("is-leaving");

    window.setTimeout(() => {
      scene.hidden = true;
      scene.classList.remove("is-leaving", "is-entering");
      document.body.classList.remove("photos-open");
      closing = false;

      /* Devolve a etapa anterior (a surpresa) jÃ¡ com a chuva de volta. */
      const done = onExit;
      onExit = null;
      onEnter = null;
      if (typeof done === "function") {
        try { done(); } catch (_) { /* nada aqui pode travar o retorno */ }
      }
    }, reduced ? 20 : 620);
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     CONTROLES
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  if (stage) {
    stage.addEventListener("pointerdown", onPointerDown, { passive: true });
    stage.addEventListener("pointermove", onPointerMove, { passive: false });
    stage.addEventListener("pointerup", event => endGesture(event, false), { passive: true });
    stage.addEventListener("pointercancel", event => endGesture(event, true), { passive: true });
    stage.addEventListener("lostpointercapture", event => endGesture(event, true), { passive: true });
  }

  if (backBtn) backBtn.addEventListener("click", close);

  document.addEventListener("keydown", event => {
    if (!active) return;

    if (event.key === "ArrowLeft") {
      goPrev();
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      goNext();
      event.preventDefault();
    } else if (event.key === "Escape") {
      close();
      event.preventDefault();
    }
  });

  window.addEventListener("resize", () => {
    if (!active) return;
    measure();
  });

  /* Aba escondida: nenhum rAF fica girando Ã  toa. */
  document.addEventListener("visibilitychange", () => {
    if (!active) return;
    if (document.hidden) stopLoop();
    else startLoop();
  });

  /* A preferÃªncia do sistema pode mudar com a pÃ¡gina aberta.
     `addEventListener` Ã© o caminho atual; `addListener` cobre o Safari
     antigo, exatamente como em luzes.js. */
  const onMotionChange = event => {
    reduced = event.matches && !motionForced;
    if (!active) return;

    if (reduced) {
      stopLoop();
      rotation = Math.round(rotation / step) * step;
      mode = "idle";
      autoFactor = 0;
      layout();
    } else {
      resumeAt = performance.now() + 600;
      startLoop();
    }
  };

  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", onMotionChange);
  } else if (typeof motionQuery.addListener === "function") {
    motionQuery.addListener(onMotionChange);
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     API
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  window.ProjetoAmorFotos = {
    open,
    close,
    isOpen: () => active,
    count: () => photos.length,
    /* main.js propaga a decisÃ£o de movimento para todos os motores */
    setMotion(allow) {
      motionForced = !!allow;
      reduced = motionQuery.matches && !motionForced;

      if (!active) return;

      if (reduced) {
        stopLoop();
        rotation = Math.round(rotation / step) * step;
        mode = "idle";
        autoFactor = 0;
        layout();
      } else {
        resumeAt = performance.now() + 600;
        startLoop();
      }
    }
  };
})();


