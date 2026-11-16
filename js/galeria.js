/* Projeto Amor — Galeria cinematográfica de fotos.
   Autocontida, como loading.js: não toca no editor, no
   envelope nem na digitação da carta.

   Reaproveitamento (nada de sistema novo):
   • As fotos são as MESMAS data URLs que o editor já guardou no link.
      Este módulo não sobe arquivo, não redimensiona, não muda o formato
      do fragmento — apenas lê `data.photos` que main.js já decodificou.
   • Sem fotos → mensagem discreta. Com uma foto → uma foto. Com seis →
      seis. Nunca inventa imagem nem espaço vazio.
   • O DOM é criado na primeira abertura e só é refeito se o conjunto
      de fotos mudar de verdade. As trocas de imagem reutilizam os
      mesmos <img> — sem recriar nós a cada navegação e sem piscar.
   • A entrada e a saída são comandadas por cross-fade com a carta
      (main.js, via ProjetoAmorCarta), e o véu de fundo acompanha o
      mesmo movimento. Antes, carta e galeria trocavam no mesmo quadro.
   • A galeria guarda a foto em que o leitor estava: uma ida à surpresa
      e volta não joga a pessoa de volta na primeira foto.

   API: window.ProjetoAmorGaleria = { open, close, isOpen, count }   */
(() => {
  "use strict";

  const scene = document.getElementById("gallery-scene");
  if (!scene) return;

  const track  = document.getElementById("gallery-track");
  const dots   = document.getElementById("gallery-dots");
  const empty  = document.getElementById("gallery-empty");
  const stage  = document.getElementById("gallery-stage");
  const capEl  = document.getElementById("gallery-caption");
  const prevBtn = document.getElementById("gallery-prev");
  const nextBtn = document.getElementById("gallery-next");
  const backEls = Array.from(scene.querySelectorAll("[data-gallery-close]"));

  /* ── Frases: curtas e discretas, abaixo da foto ──────────────────
     Uma por foto; com menos fotos que frases, o ciclo recomeça. */
  const LINES = [
    "O dia em que tudo começou a fazer sentido.",
    "Aquele instante que a gente resolveu guardar.",
    "Um sorriso que valeu o trajeto inteiro.",
    "O tempo parado, só nós dois.",
    "O lugar onde eu mais quis ficar.",
    "E ainda assim, o melhor de todos."
  ];

  const EMPTY_TEXT = "Nenhuma foto foi adicionada a esta carta ainda.";

  /* Validação da imagem: aceita data URLs de imagem e imagens da memória do projeto. */
  const isPhotoDataUrl = value =>
    typeof value === "string" && (
      /^data:image\/(jpeg|jpg|png|webp|gif|avif);base64,/i.test(value.trim()) ||
      /^img\/memoria\/[a-zA-Z0-9_-]+\.(svg|png|jpg|jpeg|webp)$/i.test(value.trim())
    );

  /* ── Estado ─────────────────────────────────────────────────────── */
  let photos = [];
  let index = 0;
  let built = false;      /* o DOM da galeria já foi criado uma vez */
  let open = false;
  let animating = false;   /* transição de cena (entrada/saída) */
  let navBusy = false;     /* cooldown da navegação entre fotos */

  /* ════════════════════════════════════════════════════════════════
     MOVIMENTO — mesma chave e mesma regra de main.js/fotos.js:
     o opt-in do visitante vence a preferência do sistema.
     ════════════════════════════════════════════════════════════════ */
  const MOTION_KEY = "projeto-amor:animar";
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motionForced = false;
  try {
    motionForced = window.localStorage.getItem(MOTION_KEY) === "1";
  } catch (_) { /* localStorage bloqueado: segue o sistema */ }
  let reduced = motionQuery.matches && !motionForced;
  /* O modo estático entra no carregamento, não só quando o main.js
     transmite via setMotion (que roda apenas no clique do botão): uma
     página aberta com movimento reduzido do sistema e sem opt-in
     abria a galeria ainda animada. */
  scene.classList.toggle("is-static", reduced);

  /* ═════════════════════════════════════════════════════════════
     ATMOSFERA DINÂMICA — fundo muda conforme a foto em destaque
     ═════════════════════════════════════════════════════════════ */
  const ATMOSPHERE_CYCLES = [
    "sunset",        // Foto 1: pôr do sol realista
    "stars",         // Foto 2: céu estrelado
    "soft-snow",     // Foto 3: neve suave
    "urban-lights",  // Foto 4: luzes urbanas
    "dawn"           // Foto 5: amanhecer
  ];

  function setActiveAtmosphere(photoIndex) {
    const atm = ATMOSPHERE_CYCLES[photoIndex % ATMOSPHERE_CYCLES.length];
    /* Sem <body> (harness de teste) o módulo segue calmo: a atmosfera é
       só uma camada visual, nunca pode derrubar a galeria. */
    const body = document.body;
    if (!body) return;
    body.classList.remove("sunset", "stars", "soft-snow", "urban-lights", "dawn");
    body.classList.add(atm);
  }

  /* ════════════════════════════════════════════════════════════
     MONTAGEM — anel 3D com fotos distribuídas em círculo.
     ══════════════════════════════════════════════════════════════ */
  const PHOTO_RADIUS = 180;   /* distância do centro do anel */
  const SLIDE_COUNT  = 6;     /* máximo; ajustamos dinamicamente */

  function build() {
    if (built) return;
    built = true;

    if (!track) return;

    /* Limpa o trilho existente */
    track.textContent = "";

    /* Remove classes antigas de layout horizontal */
    track.classList.remove("horizontal-track");

    /* Cria um slide para cada foto */
    photos.forEach((src, i) => {
      const slide = document.createElement("div");
      slide.className = "carousel-slide";
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-label", `Foto ${i + 1} de ${photos.length}`);

      const img = document.createElement("img");
      img.className = "carousel-photo";
      img.alt = `Foto de vocês ${i + 1}`;
      img.decoding = "async";
      img.draggable = false;
      img.src = src.trim();

      slide.appendChild(img);
      track.appendChild(slide);
    });

    /* Erro de imagem NÃO borbulha: o ouvinte é delegado no trilho e
       captura a fase de descida. Uma foto que falha vira "Foto
       indisponível" — marcada, sem derrubar o anel nem a navegação. */
    track.addEventListener("error", event => {
      const img = event.target;
      const slide = img && img.parentNode;
      if (!slide || !slide.classList) return;
      slide.classList.add("is-broken");
    }, true);

    /* Posiciona os slides no anel 3D */
    positionSlides();

    /* Cria/atualiza os indicadores */
    updateDots();

    /* Define a rotação inicial: a foto em destaque de frente */
    setRotation(faceRot(index));

    /* Aplica atmosfera inicial */
    setActiveAtmosphere(index);
  }

  /* Calcula o raio dinamicamente para afastar as fotos e eliminar sobreposição */
  function computeRadius() {
    const stageW = (stage && stage.clientWidth) || (typeof window !== "undefined" ? window.innerWidth : 360) || 360;
    const isMobile = stageW < 640;
    if (photos.length < 2) return 0;
    if (photos.length === 2) return isMobile ? 220 : 300;
    return isMobile
      ? Math.max(260, Math.min(340, stageW * 0.75))
      : Math.max(360, Math.min(480, stageW * 0.5));
  }

  /* Posiciona os slides em um anel circular com perspectiva, eliminando sobreposições */
  function positionSlides() {
    if (!track || photos.length === 0) return;

    const radius = computeRadius();
    const totalAngle = 360 / photos.length;

    Array.from(track.children).forEach((slide, i) => {
      const angle = i * totalAngle - 180 + totalAngle / 2; /* centralizar o primeiro slide */
      slide.style.setProperty("--angle", `${angle}deg`);
      slide.style.setProperty("--radius", `${radius}px`);

      /* Distância em relação à foto ativa atual para controle de foco */
      const diff = ((i - index) % photos.length + photos.length) % photos.length;
      const dist = Math.min(diff, photos.length - diff);

      const isCurrent = (dist === 0);
      const isNeighbor = (dist === 1);

      /* Escala e opacidade elegantes: apenas a foto em foco tem destaque total;
         as vizinhas ficam sutilmente na periferia e as demais são ocultadas para não invadir */
      const scale = isCurrent ? 1 : (isNeighbor ? 0.72 : 0.52);
      const opacity = isCurrent ? 1 : (isNeighbor && photos.length > 2 ? 0.35 : 0);

      slide.style.transform = `rotateY(${angle}deg) translateZ(${radius}px) scale(${scale})`;
      slide.style.opacity = String(opacity);
      slide.style.zIndex = isCurrent ? "10" : (isNeighbor ? "3" : "1");
      slide.style.pointerEvents = isCurrent ? "auto" : "none";
      slide.classList.toggle("is-active", isCurrent);
    });
  }

  /* Rotação do trilho que põe a foto `i` de frente. positionSlides()
     distribui o slide i no ângulo (i·T − 180 + T/2); para trazê-lo ao
     centro do palco o anel gira pelo oposto desse ângulo. Sem esta
     régua o anel abria na rotação zero, com a foto vizinha na frente
     e a legenda apontando outra. */
  function faceRot(i) {
    const step = 360 / photos.length;
    return 180 - step / 2 - i * step;
  }

  /* Escreve a rotação absoluta do trilho */
  function setRotation(deg) {
    if (!track) return;
    track.style.transform = `rotateY(${deg}deg)`;
  }

  /* Menor giro de `from` até `to`, em (−180, 180]: o anel anda pelo
     lado curto em vez de dar a volta inteira. */
  function shortestDelta(from, to) {
    const diff = ((to - from) % 360 + 360) % 360;
    return diff > 180 ? diff - 360 : diff;
  }

  /* ════════════════════════════════════════════════════════════
     ATUALIZAÇÃO VISUAL
     ═════════════════════════════════════════════════════════════ */

  function paint() {
    if (!photos.length) return;

    /* Atualiza a legenda */
    if (capEl) capEl.textContent = LINES[index % LINES.length];

    /* Atualiza o rótulo do palco */
    if (stage) stage.setAttribute("aria-label", `Foto ${index + 1} de ${photos.length}`);

    /* Atualiza os indicadores (bolinhas) */
    if (dots) {
      Array.from(dots.children).forEach((dot, i) => {
        const on = i === index;
        dot.classList.toggle("is-current", on);
        dot.setAttribute("aria-selected", String(on));
        dot.tabIndex = on ? 0 : -1;
      });
    }

    /* Posiciona os slides no anel (apenas posição estática; rotação é animada separadamente) */
    positionSlides();

    /* Atualiza a atmosfera conforme a foto em destaque */
    setActiveAtmosphere(index);
  }

  /* Gira o anel até a foto `delta` posições à frente. O anel vai pela
     rotação absoluta da foto de destino (caminho curto), não por um
     delta somado: depois de um deslize a rotação do trilho não estava
     mais alinhada ao centro e o somatório deixava a foto parada meio
     girada, com a legenda de uma foto e a imagem de outra. */
  function rotateBy(delta) {
    if (!photos.length || !open || navBusy) return;
    navBusy = true;

    /* Move o índice */
    index = ((index + delta + photos.length) % photos.length);

    /* Gira o anel pelo caminho mais curto até a rotação de destino */
    const current = trackDeg();
    setRotation(current + shortestDelta(current, faceRot(index)));

    paint();

    /* O cooldown cobre a rotação do anel (.8s no CSS) de forma suave */
    setTimeout(() => { navBusy = false; }, reduced ? 0 : 450);
  }

  const next = () => rotateBy(1);
  const prev = () => rotateBy(-1);

  /* Vai direto para a foto escolhida, pelo caminho mais curto do anel.
     É o que um clique num ponto pede: não importa quantos passos faltam
     no sentido horário, o anel gira pelo lado mais curto. */
  function goTo(target) {
    if (!photos.length || !open || navBusy) return;
    const raw = ((target - index) % photos.length + photos.length) % photos.length;
    const delta = raw > photos.length / 2 ? raw - photos.length : raw;
    if (delta === 0) return;
    rotateBy(delta);
  }

  /* ── Indicadores (bolinhas) ─────────────────────────────────────────
     Um ponto por foto, refeito só quando o conjunto muda. A criação
     mora aqui; o estado (is-current, aria-selected, tabIndex) é de
     paint(), que roda depois a cada navegação. */
  function updateDots() {
    if (!dots) return;

    dots.textContent = "";

    photos.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "gallery-dot";
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", `Foto ${i + 1} de ${photos.length}`);
      dot.addEventListener("click", () => goTo(i));
      dots.appendChild(dot);
    });

    /* Sem paint() aqui: o build() monta os nós e o openGallery chama
       paint() na sequência — marcar o estado duas vezes por abertura só
       repetia o mesmo trabalho. */
  }

  /* ═════════════════════════════════════════════════════════════
     DESLIZAR/ARRASTRAR NO CELULAR E MOUSE
     ═════════════════════════════════════════════════════════════ */

  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginDeg = 0;
  let isDragging = false;

  /* Leitura da rotação atual do trilho, em graus */
  function trackDeg() {
    const match = /(-?[\d.]+)deg/.exec((track && track.style.transform) || "");
    return match ? parseFloat(match[1]) : 0;
  }

  /* Bind de arraste: mouse e toque. A superfície do gesto é o PALCO,
     que envolve o trilho inteiro (inclusive o espaço vazio entre os
     slides) e recebe o evento por propagação. Ligar no trilho deixava
     essas faixas sem resposta — e prendia os ouvintes de movimento no
     documento, que sobreviviam à galeria fechada. */
  function bindDrag() {
    if (!track) return;
    const surface = stage || track;

    const onDown = event => {
      /* Se clicou ou tocou em uma das setas de navegação, não inicia o arraste */
      if (event.target && event.target.closest && event.target.closest(".gallery-arrow")) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (photos.length < 2) return;
      isDragging = true;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      /* De onde o anel parte: qualquer gesto que não termine em troca
         devolve exatamente esta rotação. */
      dragOriginDeg = trackDeg();
      track.style.transition = "none";
      if (surface.setPointerCapture) {
        try { surface.setPointerCapture(event.pointerId); } catch (_) {}
      }
      track.classList.add("is-dragging");
    };

    const onMove = event => {
      if (!isDragging) return;
      const dx = dragStartX - event.clientX;
      const dy = Math.abs(dragStartY - event.clientY);
      /* Gesto predominantemente vertical pertence à rolagem da página:
         o anel nem chega a acompanhar. */
      if (dy > Math.abs(dx)) return;
      /* Limitar delta para evitar movimentos acidentais. O valor é
         ABSOLUTO em relação ao início — somar a cada movimento faria o
         anel girar em dobro conforme os eventos se multiplicam. */
      const limitedDelta = Math.max(-180, Math.min(180, dx));
      track.style.transform = `rotateY(${dragOriginDeg + limitedDelta}deg)`;
    };

    const onUp = event => {
      if (!isDragging) return;
      isDragging = false;
      track.classList.remove("is-dragging");
      track.style.transition = "";

      if (surface.releasePointerCapture && event && event.pointerId !== undefined) {
        try { surface.releasePointerCapture(event.pointerId); } catch (_) {}
      }

      /* Calcular quanto rolhou para decidir direção */
      const dragDistance = dragStartX - event.clientX;
      const vertical = Math.abs(dragStartY - event.clientY) > Math.abs(dragDistance);
      const threshold = 30; /* mínimo para registrar como arraste */

      if (Math.abs(dragDistance) < threshold || vertical) {
        /* Arraste muito curto (ou vertical) — devolve o anel ao lugar */
        track.style.transform = `rotateY(${dragOriginDeg}deg)`;
        return;
      }

      /* Determinar direção */
      if (dragDistance > 0) {
        /* Arrastou para a esquerda - próxima foto */
        next();
      } else {
        /* Arrastou para a direita - foto anterior */
        prev();
      }
    };

    const onCancel = event => {
      if (!isDragging) return;
      isDragging = false;
      track.classList.remove("is-dragging");
      track.style.transition = "";
      if (surface.releasePointerCapture && event && event.pointerId !== undefined) {
        try { surface.releasePointerCapture(event.pointerId); } catch (_) {}
      }
      /* Gesto interrompido pelo navegador (rolagem tomada de volta,
         por exemplo): o anel volta ao ponto em que estava, sem trocar
         de foto por acidente. */
      track.style.transform = `rotateY(${dragOriginDeg}deg)`;
    };

    surface.addEventListener("pointerdown", onDown, { passive: true });
    surface.addEventListener("pointermove", onMove, { passive: false });
    surface.addEventListener("pointerup", onUp, { passive: true });
    surface.addEventListener("pointercancel", onCancel, { passive: true });

    /* Toque - também permitir gestos nativos de rolagem */
    surface.style.touchAction = "pan-y pinch-zoom";
  }

  /* ═════════════════════════════════════════════════════════════
     ABERTURA E FECHAMENTO
     ═════════════════════════════════════════════════════════════ */

   function bridge() {
     return window.ProjetoAmorCarta || null;
   }

   function focusScene() {
     if (!scene || typeof scene.focus !== "function") return;
     try { scene.focus({ preventScroll: true }); } catch (_) { scene.focus(); }
   }

   let pendingClose = false;
   let pendingAfter = null;
   const NO_OPEN = Symbol("sem-abertura-pendente");
   let pendingOpen = NO_OPEN;

   function syncChrome() {
     const has = photos.length > 0;
     if (stage) stage.hidden = !has;
     if (dots) dots.hidden = !has;
     if (empty) empty.hidden = has;
     if (empty) {
       const line = empty.querySelector(".gallery-empty-line");
       if (line) line.textContent = EMPTY_TEXT;
     }
     if (dots) dots.setAttribute("aria-hidden", String(!has));
   }

   function openGallery(list) {
     /* Já saindo: registra o pedido e reabre quando o fade terminar. */
     if (!open && animating) {
       pendingOpen = { list };
       return;
     }

     const incoming = (Array.isArray(list) ? list : []).filter(isPhotoDataUrl);

     /* A galeria só perde a foto atual quando o conjunto de fotos muda
        de verdade. Voltar da surpresa com as mesmas fotos devolve o
        leitor exatamente onde ele estava. */
     const changed = incoming.length !== photos.length ||
                     incoming.some((src, i) => src !== photos[i]);
     photos = incoming;
     if (changed || index >= photos.length) index = 0;
     /* Conjunto novo depois de já montado: o DOM precisa ser refeito. */
     if (changed) built = false;

     /* Já está visível: só mantém o conteúdo em dia, sem repetir a
        entrada nem reanimar a cena. */
     if (open) {
       pendingOpen = NO_OPEN;
       syncChrome();
       if (photos.length) { build(); paint(); }
       return;
     }

     /* Fechamento pedido mas ainda não executado. */
     pendingClose = false;
     pendingAfter = null;
     pendingOpen = NO_OPEN;

     syncChrome();

     if (photos.length) { build(); paint(); }

     scene.hidden = false;
     open = true;
     animating = true;
     scene.classList.add("is-entering");

     const c = bridge();
     if (c) c.hideLetter();

     window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });

     focusScene();

     /* Forçado reflow antes da animação */
     void scene.offsetWidth;
     requestAnimationFrame(() => {
       if (!open) return;
       scene.classList.remove("is-entering");
       scene.classList.add("is-stable");
     });

     /* O animating cobre a duração do fade da cena */
     window.setTimeout(() => {
       animating = false;
       if (pendingClose) runClose();
     }, reduced ? 10 : 420);
   }

   function runClose() {
     animating = true;
     open = false;

     scene.classList.remove("is-stable");
     scene.classList.add("is-leaving");

     window.setTimeout(() => {
       scene.hidden = true;
       scene.classList.remove("is-leaving");
       animating = false;

       const reopen = pendingOpen;
       pendingOpen = NO_OPEN;
       if (reopen !== NO_OPEN) {
         pendingClose = false;
         pendingAfter = null;
         openGallery(reopen.list);
         return;
       }

       const doClose = pendingClose;
       const next = pendingAfter;
       pendingClose = false;
       pendingAfter = null;

       if (!doClose) return;
       if (next) {
         next();
       } else {
         /* A carta volta com a rolagem de onde foi embora. Sem a ponte
            (improvavel, mas possivel no meio de uma transicao), devolve a
            carta direto do DOM - sem depender de variavel capturada que
            nao exista neste modulo. */
         const c = bridge();
         if (c) c.showLetter();
         else {
           const letterEl = document.getElementById("letter-content");
           if (letterEl) letterEl.hidden = false;
         }
       }
     }, reduced ? 10 : 420);
   }

   function closeGallery(after) {
     const wantsAfter = typeof after === "function" ? after : null;

     if (!open) {
       /* Já está saindo: o toque duplo não pode disparar o destino duas
          vezes (abriria a surpresa no meio do fade e de novo no fim).
          O destino mais recente fica registrado e roda uma vez só. */
       if (animating) {
         if (wantsAfter) pendingAfter = wantsAfter;
         /* Fechar de novo é a intenção mais recente: cancela a
            reabertura que tinha sido pedida antes. */
         pendingOpen = NO_OPEN;
         return;
       }
       /* Já estava fechada: o pedido é atendido de imediato, sem animação. */
       pendingClose = false;
       pendingAfter = null;
       if (wantsAfter) wantsAfter();
       return;
     }

     /* O destino é sempre o pedido mais recente: um "voltar para a
        carta" apertado durante a entrada cancela a ida à surpresa que
        já estava na fila. */
     pendingClose = true;
     pendingAfter = wantsAfter;

     /* Ainda entrando ou já saindo: o pedido fica registrado e roda no
        fim da transição em curso. */
     if (animating) return;

     runClose();
   }

  /* ═════════════════════════════════════════════════════════════
     CONTROLES
     ═════════════════════════════════════════════════════════════ */

   /* O arraste depende apenas do trilho, sobrevive a um rebuild */
   bindDrag();

   /* Configuração direta e confiável das setas para celular e desktop */
   function bindArrow(btn, action) {
     if (!btn) return;
     btn.addEventListener("click", event => {
       event.preventDefault();
       event.stopPropagation();
       action();
     });
     btn.addEventListener("pointerdown", event => {
       event.stopPropagation();
     });
     btn.addEventListener("pointerup", event => {
       event.stopPropagation();
     });
   }

   bindArrow(prevBtn, prev);
   bindArrow(nextBtn, next);
   backEls.forEach(el => el.addEventListener("click", () => closeGallery()));

   window.addEventListener("resize", () => {
     if (!open || !photos.length) return;
     positionSlides();
   });

   document.addEventListener("keydown", event => {
     if (!open || !photos.length) return;
     if (event.key === "ArrowLeft") { prev(); event.preventDefault(); }
     else if (event.key === "ArrowRight") { next(); event.preventDefault(); }
     else if (event.key === "Escape") { closeGallery(); event.preventDefault(); }
   });

  /* ═════════════════════════════════════════════════════════════
     API
     ═════════════════════════════════════════════════════════════ */
  window.ProjetoAmorGaleria = {
    open: openGallery,
    close: closeGallery,
    isOpen: () => open,
    count: () => photos.length,
    setMotion(allow) {
      motionForced = !!allow;
      reduced = motionQuery.matches && !motionForced;
      scene.classList.toggle("is-static", reduced);
    }
  };
})();