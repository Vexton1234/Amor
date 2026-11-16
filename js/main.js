/* Projeto Amor — lógica do editor e da carta. Sem servidor: os dados são carregados do fragmento do link. */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const form = $("#letter-form");

  /* Nossas Fotos: 6 posições fixas. Cada posição guarda uma miniatura em
     data URL ou null. A ordem dos espaços é preservada; ao gerar o link
     só as posições preenchidas são enviadas, já compactadas. */
  const PHOTO_SLOTS = 6;
  const photos = new Array(PHOTO_SLOTS).fill(null);

  const getFormData = () => ({
    recipient: ($("#recipient")?.value || "").trim(),
    message:   ($("#message")?.value   || "").trim(),
    favorite:  ($("#favorite")?.value  || "").trim(),
    story:     ($("#story")?.value     || "").trim(),
    sender:    ($("#sender")?.value    || "").trim(),
    /* Três promessas (Etapa 03): mesma ideia das fotos — lista compacta,
       sem espaços vazios, na ordem em que foram escritas. Campo novo e
       opcional: cartas antigas não o têm e continuam abrindo normal. */
    promises:  [
      ($("#promise-1")?.value || "").trim(),
      ($("#promise-2")?.value || "").trim(),
      ($("#promise-3")?.value || "").trim()
    ].filter(Boolean),
    /* Lista compacta: sem espaços vazios, na ordem dos espaços do editor.
       As fotos vão como bytes crus ({ mime, bytes }) — o link-codec
       transforma em base64 uma única vez, no fim. */
    photos:    photos.filter(Boolean)
  });

  /* ── Editor: atualiza prévia em tempo real ─────────────────────── */
  if (form) {
    const fields = {
      recipient: $("#preview-recipient"),
      message:   $("#preview-message"),
      sender:    $("#preview-sender")
    };
    const updatePreview = () => {
      const data = getFormData();
      if (fields.recipient) fields.recipient.textContent = data.recipient || "Meu amor";
      if (fields.message)   fields.message.textContent   = data.message   || "Existem sentimentos que merecem mais do que uma mensagem. Merecem um momento só deles.";
      if (fields.sender)    fields.sender.textContent    = data.sender ? `Com amor, ${data.sender}` : "Com amor, sempre.";
    };
    form.addEventListener("input", updatePreview);
    updatePreview();

    /* ══════════════════════════════════════════════════════════════
       NOSSAS FOTOS
       Não existe servidor: as imagens são reduzidas aqui no navegador
       e guardadas dentro do próprio link. O tamanho é controlado por
       orçamento para o link continuar utilizável.

       As fotos são guardadas em BYTES CRUS (ver js/link-codec.js), não
       em data URLs: o base64 é aplicado uma única vez, no fim. O formato
       antigo aplicava base64 duas vezes (data URL + JSON) e jogava
       25% do link fora.
       ══════════════════════════════════════════════════════════════ */

    const PHOTO_MAX_DIM    = 520;          /* lado maior da miniatura */
    const PHOTO_MAX_BYTES  = 150 * 1024;   /* teto por foto */
    const PHOTO_WARN_CHARS = 200000;       /* aviso de link pesado */
    const PHOTO_MAX_CHARS  = 1200000;      /* recusa de link inviável */
    const DATA_URL_PREFIX  = "data:image/jpeg;base64,";

    const photoGrid  = $("#photo-grid");
    const photoNote  = $("#photo-note");
    const photoSlots = photoGrid ? Array.from(photoGrid.querySelectorAll(".photo-slot")) : [];

    /* Desenha a imagem já reduzida no canvas e devolve o canvas */
    function drawScaled(img, maxDim) {
      const w0 = img.naturalWidth || img.width;
      const h0 = img.naturalHeight || img.height;
      if (!w0 || !h0) return null;

      const ratio = Math.min(1, maxDim / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * ratio));
      const h = Math.max(1, Math.round(h0 * ratio));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      /* Fundo na cor do tema: PNG com transparência não vira retângulo preto */
      ctx.fillStyle = "#1b1226";
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);

      return canvas;
    }

    /* Carrega o arquivo num <img>. Usa <img> em vez de createImageBitmap
       porque é o caminho mais compatível (inclusive HEIC no Safari do iPhone). */
    function loadImage(file) {
      return new Promise(resolve => {
        if (!file || !/^image\//i.test(file.type || "")) { resolve(null); return; }
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const ok = (img.naturalWidth || img.width) > 0;
          URL.revokeObjectURL(objectUrl);
          resolve(ok ? img : null);
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
        img.src = objectUrl;
      });
    }

    /* O navegador sabe codificar em WebP? Chrome, Firefox e Safari 16+
       sim; os mais antigos devolvem PNG no lugar — que é gigantesco e
       por isso precisa ser conferido pelo tipo, nunca assumido. */
    const SUPORTA_WEBP = (() => {
      try {
        const teste = document.createElement("canvas");
        teste.width = 1;
        teste.height = 1;
        return typeof teste.toDataURL === "function" &&
               teste.toDataURL("image/webp").indexOf("data:image/webp") === 0;
      } catch (_) {
        return false;
      }
    })();

    /* Codifica o canvas e devolve os BYTES crus (nunca data URL: o
       base64 é aplicado uma única vez, no link-codec). */
    function canvasToBytes(canvas, type, quality) {
      return new Promise(resolve => {
        if (!canvas || typeof canvas.toBlob !== "function") { resolve(null); return; }
        canvas.toBlob(async blob => {
          if (!blob || !blob.type || typeof blob.arrayBuffer !== "function") { resolve(null); return; }
          try {
            const buffer = await blob.arrayBuffer();
            resolve({ mime: blob.type, bytes: new Uint8Array(buffer) });
          } catch (_) {
            resolve(null);
          }
        }, type, quality);
      });
    }

    /* Uma foto. O WebP entra quando o navegador sabe fazer: na mesma
       qualidade ele ocupa ~30% menos que o JPEG, e o link inteiro
       encolhe na mesma proporção. A foto continua sendo lida igual em
       qualquer navegador (o JPEG é o plano B). */
    async function encodePhoto(img, maxDim, quality) {
      const canvas = drawScaled(img, maxDim);
      if (!canvas) return null;

      if (SUPORTA_WEBP) {
        const webp = await canvasToBytes(canvas, "image/webp", quality);
        if (webp && webp.mime === "image/webp" && webp.bytes.length) return webp;
      }

      const jpeg = await canvasToBytes(canvas, "image/jpeg", quality);
      if (jpeg && jpeg.mime === "image/jpeg" && jpeg.bytes.length) return jpeg;

      return null;
    }

    /* Reduz e comprime até caber no orçamento por foto */
    async function buildPhoto(file) {
      const img = await loadImage(file);
      if (!img) return null;

      let maxDim  = PHOTO_MAX_DIM;
      let quality = 0.72;
      let output  = null;

      for (let attempt = 0; attempt < 8; attempt++) {
        output = await encodePhoto(img, maxDim, quality);
        if (!output) return null;
        if (output.bytes.length <= PHOTO_MAX_BYTES) break;
        if (quality > 0.45) quality -= 0.09;
        else maxDim = Math.round(maxDim * 0.82);
      }
      return output;
    }

    function setPhotoNote(message, state) {
      if (!photoNote) return;
      photoNote.textContent = message;
      photoNote.classList.remove("is-warning", "is-error");
      if (state) photoNote.classList.add(state);
    }

    /* Peso do link: o link-codec sabe exatamente quantos caracteres o
       link vai ter (o contêiner é determinístico). Nada de estimar
       por data URL — o número mostrado é o número real. */
    function estimateLinkChars() {
      const codec = window.ProjetoAmorLink;
      if (!codec || typeof codec.estimate !== "function") return 0;
      try {
        return codec.estimate(getFormData());
      } catch (_) {
        return 0;
      }
    }

    function refreshPhotoNote() {
      const filled = photos.filter(Boolean).length;
      const chars = estimateLinkChars();

      if (filled === 0) {
        setPhotoNote("Toque em um espaço para escolher uma foto. Você pode trocar ou remover quando quiser.");
        return { ok: true, chars };
      }
      if (chars > PHOTO_MAX_CHARS) {
        setPhotoNote(`O link ficou grande demais (${filled} foto${filled > 1 ? "s" : ""}). Remova alguma para conseguir enviá-lo.`, "is-error");
        return { ok: false, chars };
      }
      if (chars > PHOTO_WARN_CHARS) {
        setPhotoNote(`${filled} foto${filled > 1 ? "s" : ""} · link de ~${Math.round(chars / 1024)} KB. Alguns navegadores podem precisar de mais tempo para abrir.`, "is-warning");
        return { ok: true, chars };
      }
      setPhotoNote(`${filled} foto${filled > 1 ? "s" : ""} selecionada${filled > 1 ? "s" : ""} · link de ~${Math.round(chars / 1024)} KB. Toque em uma foto para trocar.`);
      return { ok: true, chars };
    }

    function paintPhotoSlot(index, photo) {
      const slot = photoSlots[index];
      if (!slot) return;
      const preview = slot.querySelector(".photo-preview");
      const empty   = slot.querySelector(".photo-empty");
      const remove  = slot.querySelector(".photo-remove");

      if (photo && photo.bytes && photo.bytes.length) {
        photos[index] = photo;
        const dataUrl = window.ProjetoAmorLink
          ? window.ProjetoAmorLink.toDataUrl(photo)
          : null;
        if (dataUrl) preview.src = dataUrl;
        preview.hidden = false;
        preview.alt = `Prévia da foto ${index + 1}`;
        empty.hidden = true;
        remove.hidden = false;
      } else {
        photos[index] = null;
        preview.removeAttribute("src");
        preview.hidden = true;
        empty.hidden = false;
        remove.hidden = true;
      }
    }

    /* Fotos ainda sendo reduzidas. Enquanto uma imagem é processada ela
       AINDA NÃO está em `photos`; se a pessoa clicasse em "Criar minha
       carta" nesse intervalo, o link era gerado sem ela — e o dado
       preenchido se perdia em silêncio. O envio agora espera estas
       tarefas antes de montar o link. */
    const pendingPhotoTasks = new Set();

    function trackPhotoTask(task) {
      /* O erro de uma foto é tratado dentro da própria tarefa; o catch
         aqui só garante que a espera do envio nunca rejeite. */
      const safe = Promise.resolve(task).catch(error => {
        console.warn("Não foi possível preparar uma foto.", error);
      });
      pendingPhotoTasks.add(safe);
      safe.then(() => pendingPhotoTasks.delete(safe));
      return safe;
    }

    async function processPhotoFile(index, file) {
      const slot = photoSlots[index];
      if (!slot) return;

      slot.classList.add("is-busy");
      let photo = null;
      try {
        photo = await buildPhoto(file);
      } catch (_) {
        photo = null;
      }
      slot.classList.remove("is-busy");

      if (!photo) {
        setPhotoNote("Não consegui ler essa imagem. Tente outro arquivo (JPG ou PNG).", "is-error");
        return;
      }
      paintPhotoSlot(index, photo);
      refreshPhotoNote();
    }

    if (photoSlots.length) {
      refreshPhotoNote();

      photoSlots.forEach((slot, index) => {
        const input  = slot.querySelector(".photo-input");
        const remove = slot.querySelector(".photo-remove");
        if (!input) return;

        input.addEventListener("change", event => {
          const file = event.target.files && event.target.files[0];
          /* Limpa o valor para permitir escolher exatamente o mesmo arquivo
             outra vez logo depois (troca de foto). */
          event.target.value = "";
          if (!file) return;
          trackPhotoTask(processPhotoFile(index, file));
        });

        if (remove) {
          remove.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            paintPhotoSlot(index, null);
            refreshPhotoNote();
          });
        }
      });
    }

    let submitting = false;

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (submitting) return;
      submitting = true;

      const status       = $("#form-message");
      const submitButton = form.querySelector('button[type="submit"]');
      const setStatus = text => { if (status) status.textContent = text; };

      try {
        /* Uma foto escolhida segundos antes do envio precisa entrar no
           link: espera o redimensionamento terminar antes de ler os
           campos. O botão fica indisponível só durante essa espera. */
        if (pendingPhotoTasks.size) {
          setStatus("Preparando as fotos…");
          if (submitButton) submitButton.disabled = true;
          /* Laço: uma foto escolhida durante a espera entra na rodada
             seguinte, em vez de ficar de fora do link. */
          while (pendingPhotoTasks.size) {
            await Promise.all(Array.from(pendingPhotoTasks));
          }
          if (submitButton) submitButton.disabled = false;
        }

        const data = getFormData();
        if (!data.recipient || !data.message) {
          setStatus("Preencha o nome de quem vai receber e a mensagem principal para continuar.");
          (!data.recipient ? $("#recipient") : $("#message"))?.focus();
          return;
        }

        /* Impede gerar um link que nenhum navegador conseguiria abrir */
        if (data.photos.length) {
          const weight = estimateLinkChars();
          if (weight > PHOTO_MAX_CHARS) {
            setStatus("As fotos deixaram o link grande demais. Remova alguma foto para continuar.");
            setPhotoNote("O link ficou grande demais. Remova alguma foto para conseguir enviá-lo.", "is-error");
            return;
          }
        }

        setStatus("Preparando o link da sua carta…");

        /* Conteúdo codificado no fragmento da URL — sem backend.
           Quem tiver o link poderá ler; não coloque dados sensíveis. */
        const encoded = encodeData(data);
        const target  = new URL("carta.html", window.location.href);
        target.hash   = `c=${encoded}`;

        /* Confirma o link antes de anunciar sucesso: decodificar o que
           acabou de ser gerado prova que o destinatário — em qualquer
           navegador, sem a sessão de quem criou — recebe os mesmos dados.
           Só depois disso a mensagem de sucesso aparece. */
        const check = decodeData(encoded);
        const photosOk = (Array.isArray(check && check.photos) ? check.photos.length : 0) === data.photos.length;
        const textOk = !!check &&
          check.recipient === data.recipient &&
          check.message === data.message &&
          (check.favorite || "") === data.favorite &&
          (check.story || "") === data.story &&
          (check.sender || "") === data.sender &&
          JSON.stringify(check.promises || []) === JSON.stringify(data.promises);
        if (!textOk || !photosOk) {
          throw new Error("O link gerado não devolveu a carta completa.");
        }

        setStatus("Sua carta está pronta. Abrindo a experiência…");
        window.location.href = target.href;
      } catch (error) {
        console.error("Não foi possível criar o link da carta.", error);
        setStatus("Não foi possível criar o link da sua carta. Tente novamente; se o problema continuar, remova uma foto e tente de novo.");
        if (submitButton) submitButton.disabled = false;
      } finally {
        submitting = false;
      }
    });
  }

  /* ── Codificação / decodificação da carta ─────────────────────────
     A lógica mora em js/link-codec.js (contêiner binário + compatibilidade
     com o formato antigo). Aqui só há o atalho para o caso de o módulo
     não ter carregado — sem ele, o site avisa em vez de quebrar. */
  function encodeData(data) {
    const codec = window.ProjetoAmorLink;
    if (!codec || typeof codec.encode !== "function") {
      throw new Error("O módulo do link não carregou.");
    }
    return codec.encode(data);
  }

  function decodeData(encoded) {
    const codec = window.ProjetoAmorLink;
    if (!codec || typeof codec.decode !== "function") {
      throw new Error("O módulo do link não carregou.");
    }
    return codec.decode(encoded);
  }

  /* Lê o valor de `c` direto do fragmento, sem URLSearchParams.
     URLSearchParams transforma "+" em espaço, e um link antigo que use
     base64 padrão (com "+") perderia bytes. O decodificador aceita os
     dois alfabetos; aqui só é preciso entregar o texto intacto. */
  function readLetterCode() {
    const hash = window.location.hash.slice(1);
    if (!hash) return "";
    const match = hash.match(/(?:^|&)c=([^&]*)/);
    if (!match) return "";
    const raw = match[1];
    try {
      return decodeURIComponent(raw);
    } catch (_) {
      return raw;
    }
  }

  /* ── Renderiza texto preservando quebras de linha ──────────────── */
  function setTextContent(el, text) {
    if (!el) return;
    /* Usa textContent seguro e depende de white-space: pre-wrap no CSS */
    el.textContent = text;
  }

  /* ══════════════════════════════════════════════════════════════════
     PREFERÊNCIA DE MOVIMENTO
     Padrão: respeitar o sistema. O opt-in do usuário tem precedência e é
     persistido. IMPORTANTE: lida dinamicamente a cada abertura — nunca
     assumida no carregamento — para que mudar a configuração do sistema
     passe a valer sem depender de F5.
     ══════════════════════════════════════════════════════════════════ */
  const MOTION_KEY = "projeto-amor:animar";
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const systemPrefersReduced = () => reducedQuery.matches;

  let forceAnimation = false;
  try {
    forceAnimation = window.localStorage.getItem(MOTION_KEY) === "1";
  } catch (_) {
    /* localStorage indisponível: segue apenas a preferência do sistema */
  }

  /* A marcação vai no <html> antes do primeiro paint: o CSS de
     prefers-reduced-motion é escopado por `:root:not(.motion-forced)`,
     então sem esta classe a página inteira continuaria congelada mesmo
     com o opt-in ligado. */
  const applyMotionClass = () => {
    document.documentElement.classList.toggle("motion-forced", forceAnimation);
  };
  applyMotionClass();

  const motionAllowed = () => !systemPrefersReduced() || forceAnimation;

  /* Propaga a decisão para TODOS os motores de animação da página de uma
     vez: o CSS (via classe), o canvas de partículas e a tela de
     carregamento. Antes, o botão só religava a digitação e a tela de
     carregamento — as pétalas, estrelas e brilhos seguiam congelados. */
  const broadcastMotion = () => {
    applyMotionClass();
    if (window.ProjetoAmorAtmosphere) window.ProjetoAmorAtmosphere.setMotion(motionAllowed());
    if (window.ProjetoAmorLoading && typeof window.ProjetoAmorLoading.setMotion === "function") {
      window.ProjetoAmorLoading.setMotion(motionAllowed());
    }
    if (window.ProjetoAmorGaleria && typeof window.ProjetoAmorGaleria.setMotion === "function") {
      window.ProjetoAmorGaleria.setMotion(motionAllowed());
    }
    if (window.ProjetoAmorFotos && typeof window.ProjetoAmorFotos.setMotion === "function") {
      window.ProjetoAmorFotos.setMotion(motionAllowed());
    }
    if (window.ProjetoAmorSurpresa && typeof window.ProjetoAmorSurpresa.setMotion === "function") {
      window.ProjetoAmorSurpresa.setMotion(motionAllowed());
    }
    if (window.ProjetoAmorAniversario && typeof window.ProjetoAmorAniversario.setMotion === "function") {
      window.ProjetoAmorAniversario.setMotion(motionAllowed());
    }
  };

  /* ── Controle de opt-in de movimento ──────────────────────────────
     Só aparece quando o sistema pede movimento reduzido (é aí que ele é
     necessário). Fica disponível tanto no editor quanto na carta, com o
     mesmo rótulo e a mesma escolha persistida. ───────────────────── */
  const setupMotionToggle = () => {
    const motionToggle = $("#motion-toggle");
    if (!motionToggle) return;
    const motionLabel = $(".motion-toggle-label", motionToggle);
    if (!motionLabel) return;

    motionToggle.hidden = !systemPrefersReduced();

    const syncLabel = () => {
      motionLabel.textContent = forceAnimation
        ? "Usar movimento reduzido"
        : "Ver tudo se animando";
      motionToggle.setAttribute("aria-pressed", String(forceAnimation));
    };
    syncLabel();

    motionToggle.addEventListener("click", event => {
      event.stopPropagation();
      forceAnimation = !forceAnimation;
      try {
        window.localStorage.setItem(MOTION_KEY, forceAnimation ? "1" : "0");
      } catch (_) { /* segue sem persistir */ }
      syncLabel();
      broadcastMotion();
      document.dispatchEvent(new CustomEvent("projetoamor:motionchange", {
        detail: { allowed: motionAllowed() }
      }));
    });
  };

  setupMotionToggle();

  /* ══════════════════════════════════════════════════════════════════
     LINK PESADO — REDE DE SEGURANÇA
     Cartas com fotos viajam com as imagens dentro do link e, por isso,
     têm uma URL longa.

     Uma versão anterior desta função copiava o conteúdo para a
     sessionStorage e LIMPAVA a barra de endereços. Isso, porém,
     quebrava o compartilhamento: era justamente a barra de endereços
     que a pessoa copia e envia, e sem o "#c=" o destinatário abria a
     página e via "Esta carta ainda não chegou". Como enviar a carta é
     a função principal do site, o link completo passa a ser SEMPRE
     preservado.

     A cópia em sessionStorage continua sendo feita: serve de rede de
     segurança para um F5 e não tem custo. */
  const LETTER_KEY = "projeto-amor:carta";
  const URL_SAFE_CHARS = 16000;   /* corte a partir do qual a URL é considerada pesada */

  function lightenUrl(encoded) {
    if (!encoded) return;
    if (window.location.href.length <= URL_SAFE_CHARS) return;
    try {
      /* Guarda uma cópia, mas NÃO encurta a URL: o link precisa
         continuar completo e copiável para ser compartilhado. */
      window.sessionStorage.setItem(LETTER_KEY, encoded);
    } catch (_) {
      /* Sem sessão disponível a carta abre normalmente, direto pelo
         hash da URL. Nada mais é afetado. */
    }
  }

  /* ── Experiência pública: lê a carta a partir do hash da URL ───── */
  const envelopeButton = $("#envelope-button");
  const letterContent  = $("#letter-content");

  /* ══════════════════════════════════════════════════════════════════
     PONTE COM AS OUTRAS ETAPAS — galeria e surpresa

     main.js é o dono da carta (#letter-content) e da digitação. As
     outras etapas precisam de três coisas que só existem aqui, e esta
     é a única forma de pedir por elas sem duplicar lógica em dois
     módulos:

       finishReading()  termina a digitação de uma vez. Sem isto a
                        máquina de escrever continua escrevendo dentro
                        de um elemento já escondido, e quem volta
                        encontra a carta pela metade — e, pior, o
                        "Ler novamente" fica travado, porque a trava
                        de abertura continua ligada.
       hideLetter()     some com a carta em cross-fade, para a próxima
                        cena entrar junto em vez de sobre um corte.
       showLetter()     devolve a carta e a posição de rolagem de onde
                        ela foi embora.

     Nada aqui cria interface nova: só coordena o que já existe.
     ══════════════════════════════════════════════════════════════════ */
  const LETTER_EXIT_MS = 460;

  /* Preenchido pela sequência de digitação (ver startTypewriterSequence) */
  let finishTypingNow = () => {};
  /* Preenchido dentro do bloco da carta, que conhece `animating` */
  let finishReading   = () => {};
  let letterExitTimer = 0;
  let letterScrollTop = 0;

  /* ══════════════════════════════════════════════════════════════════
     A NOTA FINAL — "Algumas palavras acabam. O sentimento, não."

     Ela é o FECHO da carta: aparece quando a escrita acaba — ou na
     hora, se o leitor pular a digitação ou se o movimento estiver
     reduzido. O atributo `hidden` garante que ela não fique invisível
     ocupando espaço: enquanto não entra, ela não existe na tela.

     POR QUE ESTA PARTE VIVE NO NÍVEL DO MÓDULO, e não dentro do
     bloco que monta a carta: quem a chama é a sequência de digitação
     (startTypewriterSequence), que mora FORA desse bloco — ela
     precisa sobreviver ao "Ler novamente" e recomeçar do zero. Uma
     função definida dentro do bloco da carta é invisível para a
     sequência, e o resultado era um ReferenceError no fim da leitura:
     a nota final nunca aparecia e a exceção derrubava o resto do
     fluxo (abrir a galeria, abrir a surpresa). As duas pontas
     precisam se ver — logo, moram no mesmo nível. */
  const closingNote = $(".closing-note");
  let closingRevealed = false;

  const revealClosingNote = () => {
    if (closingRevealed || !closingNote) return;
    closingRevealed = true;
    closingNote.hidden = false;
    /* Pequena entrada suave: o elemento já estava no lugar, por isso
       um reflow antes da classe garante que a animação comece de
       verdade (e não de um estado invisível). */
    void closingNote.offsetWidth;
    closingNote.classList.add("nav-reveal");
  };

  const hideClosingNote = () => {
    closingRevealed = false;
    if (!closingNote) return;
    closingNote.hidden = true;
    closingNote.classList.remove("nav-reveal");
  };

  function hideLetter() {
    if (!letterContent || letterContent.hidden) return;

    /* A carta vai sair de cena no meio da leitura: termina de escrever
       agora, senão o texto continua aparecendo (invisível) atrás da
       outra cena. */
    finishReading();

    letterScrollTop = window.scrollY || window.pageYOffset || 0;

    if (!motionAllowed()) {
      letterContent.hidden = true;
      return;
    }

    letterContent.classList.remove("is-stable");
    letterContent.classList.add("is-exiting");

    if (letterExitTimer) window.clearTimeout(letterExitTimer);
    letterExitTimer = window.setTimeout(() => {
      letterExitTimer = 0;
      if (!letterContent) return;
      letterContent.classList.remove("is-exiting");
      letterContent.hidden = true;
    }, LETTER_EXIT_MS);
  }

  function showLetter() {
    if (!letterContent) return;

    /* Cancela uma saída ainda em andamento: senão o temporizador
       esconderia a carta logo depois de ela voltar. */
    if (letterExitTimer) {
      window.clearTimeout(letterExitTimer);
      letterExitTimer = 0;
    }

    letterContent.classList.remove("is-exiting");
    letterContent.hidden = false;
    letterContent.classList.add("is-entering");

    /* Reflow forçado: sem um paint entre os dois estados, a transição
       não acontece e a carta simplesmente aparece. */
    void letterContent.offsetWidth;
    requestAnimationFrame(() => {
      letterContent.classList.remove("is-entering");
      letterContent.classList.add("is-stable");
      /* Devolve o leitor ao ponto onde ele estava, e não ao topo: quem
         abriu a galeria estava no fim da carta e precisa reencontrar o
         mesmo lugar, não rolar tudo de novo. */
      const top = letterScrollTop;
      if (top > 0) {
        window.scrollTo({ top, behavior: motionAllowed() ? "smooth" : "auto" });
      }
    });
  }

  window.ProjetoAmorCarta = {
    finishReading() { finishReading(); },
    hideLetter,
    showLetter,
    isHidden: () => !letterContent || letterContent.hidden
  };

  if (envelopeButton && letterContent) {
    let data = null;
    let encoded = null;
    try {
      encoded = readLetterCode();
      /* Sem hash (por exemplo, alguém abriu carta.html direto), a cópia
         da sessão ainda permite recarregar a carta. O caminho normal é
         SEMPRE o fragmento da URL, que é o que o destinatário recebe. */
      if (!encoded) {
        try { encoded = window.sessionStorage.getItem(LETTER_KEY); } catch (_) { /* sem sessão */ }
      }
      if (encoded) data = decodeData(encoded);
    } catch (error) {
      console.warn("Não foi possível ler os dados da carta.", error);
    }

    const openingScene = $("#opening-scene");
    const missing      = $("#missing-letter");
    const loadingScreen = $("#loading-screen");

    /* Ponte com a tela de carregamento (js/loading.js, independente).
       O cronômetro só começa depois que os dados da carta foram validados. */
    const startLoadingScreen = () => {
      if (!loadingScreen) return;
      document.body.classList.add("is-loading");
      if (window.ProjetoAmorLoading && typeof window.ProjetoAmorLoading.start === "function") {
        window.ProjetoAmorLoading.start({
          /* Só as fotos reais já reduzidas. Lista vazia = mantém
             as ilustrações padrão do carrossel. */
          photos: Array.isArray(data.photos) ? data.photos.filter(Boolean) : []
        });
      } else {
        /* Fallback: sem o módulo, não bloqueia a experiência */
        document.body.classList.remove("is-loading");
      }
    };

    if (!data || typeof data !== "object" || !data.recipient || !data.message) {
      /* Link incompleto — exibe mensagem de erro imediatamente.
         A tela de carregamento nunca é iniciada aqui: o prazo de 30s é
         para a experiência, não para esconder um erro. */
      loadingScreen.hidden = true;
      document.body.classList.remove("is-loading");
      openingScene.hidden = true;
      missing.hidden      = false;
    } else {
      /* Antes de qualquer outra coisa: cartas com link pesado guardam
         uma cópia de segurança na sessão (para um F5 não perder a
         carta). A barra de endereços nunca é encurtada. */
      lightenUrl(encoded);

      /* Dados válidos: a tela cinematográfica entra antes do envelope */
      startLoadingScreen();
      /* ── Prepara os campos (inicialmente vazios para o typewriter) ── */
      setTextContent($("#letter-recipient"), "");
      setTextContent($("#letter-message"), "");
      setTextContent($("#letter-sender"), "");

      const favoriteSection = $("#favorite-section");
      const storySection    = $("#story-section");
      const promisesSection = $("#promises-section");
      if (favoriteSection) favoriteSection.hidden = true;
      if (storySection)    storySection.hidden = true;
      /* Os cartões de promessa entram na leitura junto com os outros
         blocos. Sem promessa gravada no link (cartas antigas) a seção
         permanece escondida e nada é criado. */
      if (promisesSection) promisesSection.hidden = true;

      /* Blocos que entram com opacidade 0 e sobem suavemente no momento da
         digitação. O estado inicial é aplicado uma única vez, aqui. */
      const revealTargets = [
        $("#letter-recipient"),
        favoriteSection,
        storySection,
        promisesSection,
        $(".paper-signoff")
      ].filter(Boolean);

      const resetReveal = () => {
        revealTargets.forEach(el => el.classList.remove("reveal-pending", "is-complete"));
        $(".paper")?.classList.remove("is-complete");
      };
      const armReveal = () => {
        if (!motionAllowed()) return;
        revealTargets.forEach(el => el.classList.add("reveal-pending"));
      };
      armReveal();

      /* O botão de opt-in já foi ligado por setupMotionToggle(), valendo
         para a digitação, para o canvas de partículas e para a tela de
         carregamento. Aqui resta apenas reagir a mudanças externas
         (outra aba alterando a preferência) sem duplicar listeners. */
      const motionToggle = $("#motion-toggle");
      if (motionToggle) {
        window.addEventListener("storage", event => {
          if (event.key !== MOTION_KEY) return;
          forceAnimation = event.newValue === "1";
          const label = $(".motion-toggle-label", motionToggle);
          if (label) {
            label.textContent = forceAnimation ? "Usar movimento reduzido" : "Ver tudo se animando";
          }
          motionToggle.setAttribute("aria-pressed", String(forceAnimation));
          broadcastMotion();
        });
      }

      /* Dispara o brilho sutil do papel quando a tela de carregamento
         termina — sem reiniciar nenhum dos efeitos animados. */
      document.addEventListener("projetoamor:loadingdone", () => {
        const paper = $(".paper");
        if (!paper || !motionAllowed()) return;
        paper.classList.remove("shimmer-run");
        void paper.offsetWidth;
        window.setTimeout(() => paper.classList.add("shimmer-run"), 250);
      });

      /* Ao alternar o movimento, os blocos da carta são rearmaados uma
         única vez para entrarem (ou saírem) da animação com o texto. */
      document.addEventListener("projetoamor:motionchange", () => {
        resetReveal();
        armReveal();
      });

      /* ── Controlador de digitação (permite cancelamento e reinício) ── */
      let currentTypewriterController = null;

      /* Cria um controlador. As promises pendentes são resolvidas no cancelamento
         para que a sequência async nunca fique suspensa indefinidamente. */
      const createTypewriterController = () => {
        const pending = new Set();
        return {
          active: true,
          timer: null,
          /* Registra um descritor { resolve } para resolução no cancelamento */
          track(descriptor) {
            pending.add(descriptor);
            return descriptor;
          },
          cancel() {
            this.active = false;
            if (this.timer) {
              clearTimeout(this.timer);
              this.timer = null;
            }
            pending.forEach(promise => promise.resolve?.());
            pending.clear();
            document.querySelectorAll(".is-typing").forEach(el => {
              el.classList.remove("is-typing");
            });
          }
        };
      };

      /* ── Controle de estado da animação de abertura ─────────────── */
      let animating = false;

      /* Ligação com a ponte acima: as outras etapas pedem "termine a
         leitura" ao sair da carta. Aqui a trava de abertura também é
         liberada — do contrário o "Ler novamente" ficaria sem resposta
         para sempre depois de uma ida e volta pela galeria. */
      finishReading = () => {
        finishTypingNow();
        animating = false;
      };

      const openLetter = () => {
        /* Impede duplo clique ou re-abertura enquanto já está aberto */
        if (animating || envelopeButton.classList.contains("is-open")) return;
        animating = true;

        if (currentTypewriterController) {
          currentTypewriterController.cancel();
        }
        currentTypewriterController = createTypewriterController();

        envelopeButton.classList.add("is-open");
        envelopeButton.setAttribute("aria-expanded", "true");
        openingScene.classList.add("is-opening");
        envelopeButton.disabled = true;
        /* Cada reabertura reinicia a revelação de forma consistente */
        resetReveal();
        armReveal();

        const isReducedMotion = !motionAllowed();
        if (isReducedMotion) {
          openingScene.hidden  = true;
          letterContent.hidden = false;
          letterContent.classList.add("is-stable");
          startTypewriterSequence(data, currentTypewriterController);
          animating = false;
          return;
        }

        const peekEl = $(".letter-peek", envelopeButton);
        let transitioned = false;
        let peekFallbackTimer = null;

        const transitionToReading = () => {
          if (transitioned) return;
          transitioned = true;
          if (peekFallbackTimer) {
            clearTimeout(peekFallbackTimer);
            peekFallbackTimer = null;
          }

          openingScene.classList.add("is-exiting");
          letterContent.hidden = false;
          letterContent.classList.add("is-entering");

          window.setTimeout(() => {
            /* O envelope some só depois que a SUA fade-out termina
               (.4s no CSS). Com 380 ms a cena era escondida 20 ms antes
               do fim, e a entrada da carta recomeçava do meio da
               animação. 450 ms fecha as duas transições. */
            openingScene.hidden = true;
            openingScene.classList.remove("is-exiting");
            letterContent.classList.remove("is-entering");
            letterContent.classList.add("is-stable");

            /* Scroll suave até o topo da carta */
            letterContent.scrollIntoView({ behavior: "smooth", block: "start" });

            /* Dispara brilho sutil (shimmer) no papel */
            const paper = $(".paper");
            if (paper) {
              paper.classList.remove("shimmer-run");
              void paper.offsetWidth;
              window.setTimeout(() => paper.classList.add("shimmer-run"), 250);
            }

            /* Sincronização da estabilização visual do papel com a digitação */
            let typingStarted = false;
            let paperStableTimer = null;

            const startTypingOnce = () => {
              if (typingStarted) return;
              typingStarted = true;
              letterContent.removeEventListener("transitionend", onPaperStable);
              if (paperStableTimer) {
                clearTimeout(paperStableTimer);
                paperStableTimer = null;
              }

              /* Inicia a sequência cinematográfica de digitação */
              startTypewriterSequence(data, currentTypewriterController);
              animating = false;
            };

            const onPaperStable = (e) => {
              if (e.target === letterContent && (e.propertyName === "transform" || e.propertyName === "opacity")) {
                startTypingOnce();
              }
            };

            letterContent.addEventListener("transitionend", onPaperStable);
            /* Fallback seguro alinhado à transição CSS (.45s) caso transitionend não dispare */
            paperStableTimer = window.setTimeout(startTypingOnce, LETTER_ENTER_MS + 30);
          }, LETTER_ENTER_MS);
        };

        if (peekEl) {
          const onTransitionEnd = (e) => {
            if (e.target === peekEl && e.propertyName === "transform") {
              peekEl.removeEventListener("transitionend", onTransitionEnd);
              transitionToReading();
            }
          };
          peekEl.addEventListener("transitionend", onTransitionEnd);
        }

        /* Fallback de segurança alinhado ao término da transição do papel (1500ms) */
        peekFallbackTimer = window.setTimeout(transitionToReading, 1550);
      };

      /* Registra listener UMA única vez */
      envelopeButton.addEventListener("click", openLetter);

      /* ══════════════════════════════════════════════════════════
         GALERIA DE MOMENTOS — etapa depois da leitura
         Reaproveita as fotos do casal (`data.photos`) ou exibe
         a seleção de memórias se nenhuma foto foi anexada.
         ══════════════════════════════════════════════════════════ */
      const DEFAULT_GALLERY_PHOTOS = [
        "img/memoria/01-entardecer.svg",
        "img/memoria/02-ceu-estrelado.svg",
        "img/memoria/03-duas-luas.svg",
        "img/memoria/04-campo-de-flores.svg",
        "img/memoria/05-chuva-na-janela.svg",
        "img/memoria/07-praia-amora.svg"
      ];
      const galleryButton = $("#gallery-button");
      const userPhotos = Array.isArray(data.photos) ? data.photos.filter(Boolean) : [];
      const letterPhotos = userPhotos.length ? userPhotos : DEFAULT_GALLERY_PHOTOS;
      const hasGallery = Boolean(galleryButton && window.ProjetoAmorGaleria);
      if (hasGallery) {
        galleryButton.hidden = false;
        galleryButton.addEventListener("click", () => {
          window.ProjetoAmorGaleria.open(letterPhotos);
        });
      }

      /* ════════════════════════════════════════════════════════════
         ATMOSFERA DINÂMICA — fundo muda conforme a foto em destaque
         ════════════════════════════════════════════════════════════ */
      const ATMOSPHERE_CYCLES = [
        "sunset",        // Foto 1: pôr do sol realista
        "stars",         // Foto 2: céu estrelado
        "soft-snow",     // Foto 3: neve suave
        "urban-lights",  // Foto 4: luzes urbanas
        "dawn"           // Foto 5: amanhecer
      ];

      function setActiveAtmosphere(photoIndex) {
        const atm = ATMOSPHERE_CYCLES[photoIndex % ATMOSPHERE_CYCLES.length];
        document.body.classList.remove("sunset", "stars", "soft-snow", "urban-lights", "dawn");
          document.body.classList.add(atm);
      }

      /* Quando a galeria abre, define a atmosfera da foto inicial */
      if (hasGallery && window.ProjetoAmorGaleria) {
        const originalOpen = window.ProjetoAmorGaleria.open;
        window.ProjetoAmorGaleria.open = function(list) {
          const incoming = (Array.isArray(list) ? list : []).filter(Boolean);
          /* Chama a função original */
          if (originalOpen) originalOpen.call(this, incoming);
          /* Define atmosfera da primeira foto */
          if (incoming.length > 0) {
            setActiveAtmosphere(0);
          }
        };
      }

      /* Intercepta as navegações da galeria para mudar a atmosfera */
      if (window.ProjetoAmorGaleria) {
        const originalPaint = window.ProjetoAmorGaleria.paint;
        if (originalPaint) {
          window.ProjetoAmorGaleria.paint = function() {
            if (this.index !== undefined && photos.length > 0) {
              setActiveAtmosphere(this.index);
            }
            if (originalPaint) originalPaint.call(this);
          };
        }
      }

      /* ══════════════════════════════════════════════════════════
         ETAPA 4 — ENVELOPE SURPRESA
         Reaproveita o que já existe: os mesmos nomes e as mesmas
         fotos que o editor gravou no link. Nenhum dado novo, nenhum
         formato novo, nenhuma alteração no envelope principal nem na
         digitação.
         Quando existe galeria, a surpresa é oferecida por ela (o
         botão vive na cena da galeria, ligado em surpresa.js). Sem
         galeria — cartas antigas, ou cartas sem foto — ela é
         oferecida aqui, logo abaixo da carta.
         ══════════════════════════════════════════════════════════ */
      const surpriseButton = $("#surprise-button");
      const surpriseLaunch = $("#surprise-launch");

      if (window.ProjetoAmorSurpresa) {
        /* Mesmo objeto de dados usado pela galeria: os nomes vêm da carta
           e as fotos voltam intactas se o leitor quiser rever a galeria
           depois da mensagem. */
        window.ProjetoAmorSurpresa.configure({
          recipient: data.recipient,
          sender: data.sender,
          photos: letterPhotos,
          hasGallery
        });

        /* Com galeria, a surpresa é oferecida por ela (botão na própria
           cena). Sem galeria — cartas antigas ou sem foto — ela aparece
           aqui, logo abaixo da leitura. */
        if (surpriseLaunch) surpriseLaunch.hidden = false;
        if (surpriseButton && !hasGallery) surpriseButton.hidden = false;
      }

      /* ══════════════════════════════════════════════════════════
         TRÊS PROMESSAS — Etapa 03
         O que o editor gravou no link (`data.promises`) é entregue ao
         módulo dos cartões, que decide o que existe e o que fica
         fechado. Nenhuma invenção de texto e nenhum formato novo de
         link: apenas um campo opcional a mais no JSON já existente.
         ══════════════════════════════════════════════════════════ */
      if (window.ProjetoAmorPromessas && typeof window.ProjetoAmorPromessas.configure === "function") {
        window.ProjetoAmorPromessas.configure(
          Array.isArray(data.promises) ? data.promises.filter(Boolean) : []
        );
        /* A seção continua escondida aqui: ela entra na leitura no seu
           lugar, junto com os outros blocos — abrir o envelope não
           pode mostrar as promessas antes da hora. */
      }

      /* ── Botão "Ler novamente" ──────────────────────────────────── */
      const replayButton = $("#replay-button");
      if (replayButton) {
        replayButton.addEventListener("click", () => {
          if (currentTypewriterController) {
            currentTypewriterController.cancel();
          }

          /* O replay reabre apenas o envelope. A tela de carregamento é uma
             experiência única por visita e não é reiniciada aqui. */
          letterContent.hidden    = true;
          /* `is-exiting` entra na lista: se o replay for apertado logo
             depois de a carta ter saído para a galeria, uma classe de
             saída órfã deixaria a carta em opacidade 0 quando ela
             voltasse a ser aberta. */
          letterContent.classList.remove("is-stable", "is-entering", "is-exiting");
          if (letterExitTimer) {
            window.clearTimeout(letterExitTimer);
            letterExitTimer = 0;
          }
          openingScene.hidden     = false;
          openingScene.classList.remove("is-opening", "is-exiting");
          envelopeButton.disabled = false;
          envelopeButton.classList.remove("is-open");
          envelopeButton.setAttribute("aria-expanded", "false");
          animating = false;

          /* Reseta o conteúdo para reiniciar a digitação na próxima abertura */
          setTextContent($("#letter-recipient"), "");
          setTextContent($("#letter-message"), "");
          setTextContent($("#letter-sender"), "");
          if (favoriteSection) favoriteSection.hidden = true;
          if ($("#letter-favorite")) $("#letter-favorite").textContent = "";
          if (storySection) storySection.hidden = true;
          if ($("#letter-story")) $("#letter-story").textContent = "";
          /* Os cartões voltam a ficar fechados: reler a carta é reler
             tudo, inclusive as promessas. */
          if (promisesSection) promisesSection.hidden = true;
          if (window.ProjetoAmorPromessas && typeof window.ProjetoAmorPromessas.reset === "function") {
            window.ProjetoAmorPromessas.reset();
          }

          $(".paper")?.classList.remove("shimmer-run", "is-complete");
          resetReveal();
          /* A nota final sai junto: reler a carta é reler tudo, do
             começo — o fecho entra de novo no fim. */
          hideClosingNote();
          if (letterContent) letterContent.removeAttribute("aria-busy");
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      }
    }
  }

/* ══════════════════════════════════════════════════════════════════
     ETAPA 3 — MOTOR DE DIGITAÇÃO CINEMATOGRÁFICA (TYPEWRITER)
     ══════════════════════════════════════════════════════════════════ */

  /* ── Constantes configuráveis de velocidade e pausas ────────────── */
  const TYPE_SPEED = 58;            /* cadência base por caractere (lenta, legível) */
  const SHORT_TEXT_SPEED = 82;     /* nomes curtos ganham um respiro extra */
  /* Pausa emocional entre os blocos da carta. O valor é a PAUSA em si:
     o intervalo medido entre o fim de um bloco e o primeiro caractere do
     seguinte soma este número ao último tique da máquina de escrever
     (~58 ms) e a alguns ms de fila de eventos. Com 700 ms o intervalo
     real passava de 790 ms — o dobro do respiro pretendido. */
  const PAUSE_BETWEEN_BLOCKS = 500;
  const MIN_TYPE_SPEED = 40;        /* piso: nunca volta a ficar rápido */
  const REVEAL_DURATION = 660;      /* duração da entrada suave dos blocos */
  /* Duração da entrada da carta (.letter-content.is-entering → .is-stable).
     Precisa ser igual à transição do CSS (.45s): com 380 ms a cena era
     trocada de estado NO MEIO da própria animação, e a entrada recomeçava
     do valor parcial (a opacidade subia de 0,87 para 1 em mais 450 ms). */
  const LETTER_ENTER_MS = 450;

  

  /* ── Segmentação segura de caracteres e emojis (Unicode-safe) ───── */
  function getGraphemes(text) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      try {
        const segmenter = new Intl.Segmenter("pt", { granularity: "grapheme" });
        return Array.from(segmenter.segment(text), s => s.segment);
      } catch (_) {}
    }
    return Array.from(text);
  }

  /* A cadência é constante e deliberadamente lenta.
     NÃO existe mais o cálculo adaptativo por tamanho do bloco: ele fazia
     as mensagens longas acelerarem (uma mensagem de 515 caracteres caía
     para ~18ms por letra) e a carta "aparecia de uma vez".
     Blocos curtos ficam um pouco mais lentos, nunca mais rápidos. */
  function resolveSpeed(text) {
    const length = getGraphemes(text).length || 1;
    const speed = length <= 14 ? SHORT_TEXT_SPEED : TYPE_SPEED;
    return Math.max(MIN_TYPE_SPEED, speed);
  }

  /* Aguarda um frame: necessário para que um elemento recém-exibido
     (hidden = false) compute o estado inicial e realmente faça a transição. */
  function nextFrame() {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else window.setTimeout(resolve, 16);
    });
  }

  /* ── Entrada suave do bloco: opacidade + deslocamento vertical ──── */
  function revealBlock(element, animate) {
    if (!element) return Promise.resolve();

    if (!animate || !element.classList.contains("reveal-pending")) {
      element.classList.remove("reveal-pending");
      return Promise.resolve();
    }

    return new Promise(resolve => {
      let settled = false;
      let timer = null;

      const done = () => {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        element.removeEventListener("transitionend", onEnd);
        resolve();
      };

      const onEnd = event => {
        if (event.target === element) done();
      };

      element.addEventListener("transitionend", onEnd);
      /* O transitionend pode não disparar em navegadores sem composição;
         o temporizador apenas garante que a leitura nunca fique suspensa. */
      timer = window.setTimeout(done, REVEAL_DURATION + 140);

      element.classList.remove("reveal-pending");
    });
  }

  /* ── Função reutilizável de digitação caractere por caractere ───── */
  function typeText(element, text, speed, controller) {
    return new Promise(resolve => {
      if (!element || !text || !controller || !controller.active) {
        resolve();
        return;
      }

      const graphemes = getGraphemes(text);
      let index = 0;
      let settled = false;
      let rendered = "";

      /* Nó de texto apenas — nunca innerHTML com dados dinâmicos */
      element.textContent = "";
      element.classList.add("is-typing");

      const finish = () => {
        if (settled) return;
        settled = true;
        if (controller.timer) {
          clearTimeout(controller.timer);
          controller.timer = null;
        }
        element.classList.remove("is-typing");
        resolve();
      };

      controller.track({ resolve: finish });

      function step() {
        if (!controller.active) {
          finish();
          return;
        }

        if (index >= graphemes.length) {
          /* Bloco concluído: o cursor desaparece imediatamente deste elemento */
          finish();
          return;
        }

        const char = graphemes[index];
        rendered += char;
        element.textContent = rendered;
        index++;

        /* Cadência expressiva proporcional: blocos curtos ficam lentos e
           românticos; blocos longos continuam legíveis. */
        let factor = 1;
        if (char === "." || char === "!" || char === "?") factor = 2.3;
        else if (char === "," || char === ";" || char === ":" || char === "—") factor = 1.5;
        else if (char === "\n") factor = 1.6;

        controller.timer = setTimeout(step, Math.round(speed * factor));
      }

      step();
    });
  }

  /* ── Pausa assíncrona entre blocos ──────────────────────────────── */
  function waitBetweenFields(controller, ms = PAUSE_BETWEEN_BLOCKS) {
    return new Promise(resolve => {
      if (!controller || !controller.active) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (controller.timer) {
          clearTimeout(controller.timer);
          controller.timer = null;
        }
        resolve();
      };
      controller.track({ resolve: finish });
      controller.timer = setTimeout(finish, ms);
    });
  }

  /* ── Sequência do Typewriter nos cinco campos da carta ──────────── */
  async function startTypewriterSequence(letterData, controller) {
    if (!letterData || !controller || !controller.active) return;

    /* Avaliado aqui, no momento da leitura, e não no carregamento */
    const reduced = !motionAllowed();
    const paper   = $(".paper");

    const recipientEl = $("#letter-recipient");
    const messageEl   = $("#letter-message");
    const favoriteSec = $("#favorite-section");
    const favoriteEl  = $("#letter-favorite");
    const storySec    = $("#story-section");
    const storyEl     = $("#letter-story");
    const promisesSec = $("#promises-section");
    const hasPromises = !!(promisesSec && window.ProjetoAmorPromessas && window.ProjetoAmorPromessas.has());
    const signoffEl   = $(".paper-signoff");
    const senderEl    = $("#letter-sender");

    const recipientText = (letterData.recipient || "").trim();
    const messageText   = (letterData.message || "").trim();
    const favoriteText  = (letterData.favorite || "").trim();
    const storyText     = (letterData.story || "").trim();
    const senderText    = (letterData.sender || "").trim();

    /* Sem remetente não sobra nada real para assinar: oculta a seção inteira
       em vez de deixar um rótulo e um coração ocupando espaço vazio. */
    if (signoffEl && !senderText) signoffEl.hidden = true;

    /* Preenche tudo de uma vez: movimento reduzido e ação de pular */
    const renderInstantly = () => {
      if (recipientEl && recipientText) {
        recipientEl.classList.remove("reveal-pending");
        recipientEl.textContent = recipientText;
      }
      if (messageEl && messageText) {
        messageEl.classList.remove("reveal-pending");
        messageEl.textContent = messageText;
      }
      if (favoriteSec && favoriteEl && favoriteText) {
        favoriteSec.classList.remove("reveal-pending");
        favoriteSec.hidden = false;
        favoriteEl.textContent = favoriteText;
      }
      if (storySec && storyEl && storyText) {
        storySec.classList.remove("reveal-pending");
        storySec.hidden = false;
        storyEl.textContent = storyText;
      }
      if (signoffEl) signoffEl.classList.remove("reveal-pending");
      if (senderEl && senderText) senderEl.textContent = senderText;
      /* Sem movimento não há cascata: os cartões aparecem já prontos,
         ainda fechados — são eles que o leitor abre no toque.
         O reveal-pending é removido aqui pelo mesmo motivo dos outros
         blocos: ao pular a leitura, nada pode ficar em opacidade 0. */
      if (promisesSec) {
        promisesSec.classList.remove("reveal-pending");
        promisesSec.hidden = !hasPromises;
      }
    };

    /* Enquanto o texto cresce, o leitor de tela não deve anunciar cada letra:
       a região é announced uma única vez, ao final da sequência. */
    const silenceLiveRegion = () => {
      if (!letterContent) return;
      letterContent.setAttribute("aria-live", "off");
      letterContent.setAttribute("aria-busy", "true");
    };

    const restoreLiveRegion = () => {
      if (letterContent) {
        letterContent.setAttribute("aria-live", "polite");
        letterContent.removeAttribute("aria-busy");
      }
      /* Nenhuma animação contínua sobrevive ao fim da leitura */
      if (paper) paper.classList.add("is-complete");
      /* A leitura acabou: a nota final pode entrar. Este é o ÚNICO ponto
         de revelação — ele é chamado tanto no fim normal, quanto quando
         o leitor pula a digitação, quanto no movimento reduzido. */
      revealClosingNote();
    };

    if (reduced) {
      renderInstantly();
      restoreLiveRegion();
      return;
    }

    silenceLiveRegion();

    /* Permite concluir a carta antecipadamente, sem esperar a animação inteira.
       Um clique simples NÃO cancela mais nada: apenas um toque deliberado
       (duplo clique) ou o teclado concluem a leitura. Assim um clique
       acidental — rolar, selecionar, tocar sem querer — nunca corta a
       digitação no meio. */
    const onSkipKey = event => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") skip();
    };
    const detachSkip = () => {
      if (!paper) return;
      paper.removeEventListener("click", onSkipClick);
      paper.removeEventListener("keydown", onSkipKey);
      paper.style.cursor = "";
      paper.removeAttribute("title");
    };
    function skip() {
      if (!controller.active) return;
      controller.cancel();
      renderInstantly();
      restoreLiveRegion();
    }

    /* O skip é exatamente "termine a leitura agora" — é ele que as
       outras etapas chamam ao tirar a carta de cena. */
    finishTypingNow = skip;
    /* Só o segundo toque do par cancela a digitação */
    const onSkipClick = event => {
      if (event.detail < 2) return;
      skip();
    };

    if (paper) {
      paper.style.cursor = "default";
      paper.title = "Toque duas vezes para revelar a carta inteira";
      paper.addEventListener("click", onSkipClick);
      paper.addEventListener("keydown", onSkipKey);
    }

    try {
      /* 1. Nome do destinatário — saudação pessoal */
      if (recipientEl && recipientText) {
        await revealBlock(recipientEl, true);
        if (!controller.active) return;
        await typeText(recipientEl, recipientText, resolveSpeed(recipientText), controller);
        if (!controller.active) return;
      }

      /* 2. Mensagem principal — foco principal da leitura */
      if (messageEl && messageText) {
        if (recipientText) {
          await waitBetweenFields(controller, PAUSE_BETWEEN_BLOCKS);
          if (!controller.active) return;
        }
        await typeText(messageEl, messageText, resolveSpeed(messageText), controller);
        if (!controller.active) return;
      }

      /* 3. O que mais amo em você (somente se preenchido) */
      if (favoriteSec && favoriteEl && favoriteText) {
        await waitBetweenFields(controller, PAUSE_BETWEEN_BLOCKS);
        if (!controller.active) return;
        favoriteSec.hidden = false;
        await nextFrame();
        await revealBlock(favoriteSec, true);
        if (!controller.active) return;
        await typeText(favoriteEl, favoriteText, resolveSpeed(favoriteText), controller);
        if (!controller.active) return;
      }

      /* 4. Nossa história (somente se preenchido) */
      if (storySec && storyEl && storyText) {
        await waitBetweenFields(controller, PAUSE_BETWEEN_BLOCKS);
        if (!controller.active) return;
        storySec.hidden = false;
        await nextFrame();
        await revealBlock(storySec, true);
        if (!controller.active) return;
        await typeText(storyEl, storyText, resolveSpeed(storyText), controller);
        if (!controller.active) return;
      }

      /* 5. Três promessas (somente se existirem). O bloco entra com a mesma
        entrada suave dos outros, mas o texto NÃO é digitado: cada
        promessa se revela no toque do próprio cartão. */
      if (promisesSec && hasPromises) {
        await waitBetweenFields(controller, PAUSE_BETWEEN_BLOCKS);
        if (!controller.active) return;
        promisesSec.hidden = false;
        await nextFrame();
        await revealBlock(promisesSec, true);
        if (!controller.active) return;
      }

      /* 6. Assinatura — sempre ao final, nunca sobreposta */
      if (signoffEl) {
        /* Sem remetente a assinatura inteira está escondida: não há
           transição para esperar e o revealBlock ficaria 800 ms
           esperando um transitionend que nunca viria. */
        if (!signoffEl.hidden) {
          await revealBlock(signoffEl, true);
          if (!controller.active) return;
        }
      }
      if (senderEl && senderText) {
        if (!controller.active) return;
        await typeText(senderEl, senderText, Math.max(TYPE_SPEED, resolveSpeed(senderText)), controller);
      }
    } finally {
      detachSkip();
      if (controller.active) restoreLiveRegion();
    }
  }
})();