/* Projeto Amor — Etapa 4: envelope surpresa ("Abra quando sentir minha falta").
   Autocontido, como galeria.js e loading.js: não toca no editor,
   no envelope principal nem na digitação da carta.

   Reaproveitamento (nada de sistema novo):
   • A cena vive dentro de #experience, ao lado da galeria e da carta — trocar
     de etapa é apenas ocultar e mostrar, sem recarregar a página.
   • O papel da mensagem reaproveita .paper, .letter-paragraph, .letter-block,
     .paper-divider, .paper-signoff, .paper-corner e .secondary-button: a
     identidade da carta é a mesma, só muda a cena.
   • O texto é digitado caractere por caractere, numa única sequência
     contínua (saudação → parágrafos → fecho → assinatura). A digitação
     da carta principal continua intocada: este motor vive só aqui.
   • A atmosfera da cena é o fundo exclusivo em CSS
     (#surprise-scene .surprise-fundo): ondas claras e corações
     pendurados. Este arquivo só aciona as classes de estado que
     comandam a sequência cinematográfica.
   • A carta sai e volta em cross-fade por main.js (ProjetoAmorCarta),
     nunca com display:none: era esse corte seco entre carta, galeria e
     surpresa que quebrava a sensação de uma só jornada.
   • Os nomes vêm do que o editor já gravou no link (data.recipient /
     data.sender). Cartas antigas continuam funcionando: sem nome, a
     mensagem aparece sem a saudação personalizada.

   API: window.ProjetoAmorSurpresa = { configure, open, close, isOpen, setMotion }  */
(() => {
  "use strict";

  const scene       = document.getElementById("surprise-scene");
  if (!scene) return;

  const intro        = document.getElementById("surprise-intro");
  const envelopeBtn  = document.getElementById("surprise-envelope-button");
  const paper        = document.getElementById("surprise-message");
  const backGallery  = document.getElementById("surprise-back-gallery");
  const backLetter   = document.getElementById("surprise-back-letter");
  const actions      = scene.querySelector(".surprise-actions");
  const letterContent = document.getElementById("letter-content");
  const launchEls    = Array.from(document.querySelectorAll("#surprise-launch, #surprise-button"));

  /* main.js é o dono da carta — e ele é carregado DEPOIS deste módulo
     (ver a ordem dos <script> em carta.html). Guardar a ponte aqui no
     topo capturaria `null` para sempre, porque na hora em que este
     arquivo roda a carta ainda nem foi decodificada. A ponte é
     resolvida na hora da chamada. Sem ela, o funcionamento antigo
     (esconder a carta na hora) continua valendo. */
  function bridge() {
    return window.ProjetoAmorCarta || null;
  }

  /* A cena assume o foco ao entrar: sem isto o foco ficaria no botão
     que acabou de sumir, e teclado/leitor de tela não teriam para onde
     ir. */
  function focusScene() {
    if (!scene || typeof scene.focus !== "function") return;
    try { scene.focus({ preventScroll: true }); } catch (_) { scene.focus(); }
  }

  /* ══════════════════════════════════════════════════════════════
     A MENSAGEM — acolhimento, saudade e a certeza de que o amor
     continua presente mesmo à distância. Escrita para ser dita de
     perto, não declamada.
     ══════════════════════════════════════════════════════════════ */
  const TEXT_1 =
    "Você chegou até aqui. Eu sabia que um dia isso ia acontecer: existe um instante " +
    "em que a distância pesa mais do que o orgulho de segurar tudo sozinho.";

  const TEXT_2 =
    "Sentir falta não é fraqueza — é o amor deixando recados. Um bilhete deixado em " +
    "cima da mesa, uma luz acesa no corredor, o jeito de chamar o seu nome só para " +
    "ouvir a própria voz dizendo. Eu continuo fazendo isso, mesmo de longe.";

  const TEXT_3 =
    "Mesmo quando faltam os braços, sobra o resto: a conversa que a gente refaz de " +
    "memória, o cuidado que não precisa de tela, a certeza de que existe um lugar " +
    "com o seu nome e a minha chave — e que ele vai estar aceso quando você voltar.";

  /* Frase final: uma só, sem repetição, sem clichê. */
  const CLOSING = "A distância encurtou o caminho — nunca o que eu sinto por você.";

  const KICKER = "PARA ABRIR QUANDO A SAUDADE APERTAR";

  /* ══════════════════════════════════════════════════════════════
     MOVIMENTO — mesma chave e mesma regra de main.js/galeria.js:
     o opt-in do visitante vence a preferência do sistema.
     ══════════════════════════════════════════════════════════════ */
  const MOTION_KEY = "projeto-amor:animar";
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motionForced = false;
  try {
    motionForced = window.localStorage.getItem(MOTION_KEY) === "1";
  } catch (_) { /* localStorage bloqueado: segue o sistema */ }
  let reduced = motionQuery.matches && !motionForced;

  /* ══════════════════════════════════════════════════════════════
     ATMOSFERA DA CENA — fundo decorativo em CSS
     O fundo novo (#surprise-scene .surprise-fundo) é 100% CSS:
     ondas claras e corações pendurados. Nenhum motor de chuva ou
     áudio é iniciado por esta cena.
     ══════════════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════════════
     DURAÇÕES DA SEQUÊNCIA
     O `is-entering` durava 620 ms, o que derrubava o fundo quase
     instantaneamente e tirava todo o suspense. Agora a entrada da
     cena dura o suficiente para o fundo entrar, os corações começarem
     a balançar e o envelope ganhar presença — ~4,5 s, dentro da faixa
     pedida.
     NADA fica bloqueado durante esse tempo: o envelope já é clicável
     desde o primeiro quadro, e as saídas só dependem da mensagem.
     ══════════════════════════════════════════════════════════════ */
  const SCENE_ENTER_MS = 4500;

  /* ══════════════════════════════════════════════════════════════
     ESTADO
     ══════════════════════════════════════════════════════════════ */
  let photos = [];          /* só para reabrir a galeria no botão "voltar" */
  let hasGallery = false;   /* existe galeria para onde voltar? */
  let open = false;
  let animating = false;
  /* Um pedido de abertura já está esperando a galeria sair? Evita que
     um toque duplo no botão da surpresa a abra duas vezes. */
  let launching = false;
  /* A página exclusiva das fotografias já foi convidada nesta leitura?
     Garante que a transição automática acontece uma única vez por
     abertura — voltar dela não dispara um novo convite em laço. */
  let photosInvited = false;
  let timers = [];

  /* Digitação da mensagem: UM timer e UMA sequência por abertura.
     `typeRun` invalida qualquer passo que já estivesse na fila quando a
     carta fecha, reabre ou o movimento é alterado — é o que impede
     letras duplicadas e textos misturados entre uma abertura e outra. */
  let typedContext = null;
  let typeRun = 0;
  let typeTimer = 0;
  let typingEl = null;

  const later = (fn, ms) => {
    const id = window.setTimeout(fn, ms);
    timers.push(id);
    return id;
  };

  const clearTimers = () => {
    timers.forEach(id => window.clearTimeout(id));
    timers = [];
  };

  const scrollTop = () => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });

  /* ══════════════════════════════════════════════════════════════
     TEXTO — escrito uma vez, com os nomes que já vieram no link
     ══════════════════════════════════════════════════════════════ */
  function setText(el, value) {
    if (el) el.textContent = value || "";
  }

  /* ── Motor de digitação da mensagem surpresa ─────────────────────
     Cadência natural e emocional: 25–40 ms por caractere, com pausas
     curtas depois de vírgulas e um respiro maior no fim de frases e
     entre campos. Tudo numa única cadeia de setTimeout — nunca há dois
     temporizadores escrevendo no mesmo papel. */
  const TYPE_SPEED_MS = 32;
  const TYPE_SHORT_MS = 38;
  const PAUSE_COMMA_MS = 110;
  const PAUSE_SENTENCE_MS = 260;
  const PAUSE_PARAGRAPH_MS = 380;
  const PAUSE_FIELD_MS = 280;

  const TYPED_IDS = [
    "surprise-greeting",
    "surprise-text-1",
    "surprise-text-2",
    "surprise-text-3",
    "surprise-closing",
    "surprise-sender"
  ];

  function typedEl(id) {
    return document.getElementById(id);
  }

  /* Unicode-safe: não parte acentos compostos, emojis ou pares
     substitutos ao meio. */
  function getGraphemes(text) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      try {
        const segmenter = new Intl.Segmenter("pt", { granularity: "grapheme" });
        return Array.from(segmenter.segment(text), part => part.segment);
      } catch (_) { /* navegador antigo: cai no Array.from */ }
    }
    return Array.from(text);
  }

  function stopTyping() {
    typeRun += 1;
    if (typeTimer) {
      window.clearTimeout(typeTimer);
      typeTimer = 0;
    }
    if (typingEl) {
      typingEl.classList.remove("is-typing");
      typingEl = null;
    }
  }

  function messageValues() {
    const data = typedContext && typeof typedContext === "object" ? typedContext : {};
    const recipient = typeof data.recipient === "string" ? data.recipient.trim() : "";
    const sender = typeof data.sender === "string" ? data.sender.trim() : "";
    return {
      recipient,
      sender,
      greeting: recipient || "Para você"
    };
  }

  /* Ordem original da mensagem, sem saltar trechos. Cada campo tem a
     sua própria pausa de saída; a digitação é contínua entre eles. */
  function messageFields() {
    const values = messageValues();
    const fields = [
      { id: "surprise-greeting", text: values.greeting, pause: 380 },
      { id: "surprise-text-1", text: TEXT_1, pause: 300 },
      { id: "surprise-text-2", text: TEXT_2, pause: 300 },
      { id: "surprise-text-3", text: TEXT_3, pause: 320 },
      { id: "surprise-closing", text: CLOSING, pause: 340 }
    ];
    if (values.sender) {
      fields.push({ id: "surprise-sender", text: values.sender, pause: 0 });
    }
    return fields
      .map(field => ({ ...field, el: typedEl(field.id) }))
      .filter(field => field.el && field.text);
  }

  function clearTypedText() {
    stopTyping();
    TYPED_IDS.forEach(id => setText(typedEl(id), ""));
    const signoff = document.querySelector(".surprise-signoff");
    if (signoff) signoff.hidden = true;
  }

  /* ══════════════════════════════════════════════════════════════
     PONTE COM A PÁGINA DAS FOTOGRAFIAS — Etapa 5
     A última carta termina de ser digitada aqui. Só então — depois de
     um respiro — a cena das fotografias é convidada a entrar. Nada é
     interrompido: a mensagem já está inteira, o fundo continua no lugar
     até o cross-fade e o retorno devolve exatamente esta cena, com o
     texto completo.

     Sem fotos no link, o convite nem existe: a experiência termina
     como sempre terminou.
     ══════════════════════════════════════════════════════════════ */
  function suspendSceneForPhotos() {
    /* O fundo é CSS puro: não há laço de animação para pausar. */
  }

  function resumeSceneAfterPhotos() {
    if (!open) return;
    focusScene();
  }

  function schedulePhotosAfterReading() {
    if (!open || photosInvited) return;
    let list = Array.isArray(photos) ? photos.filter(Boolean) : [];
    if (!list.length) {
      const ctx = lastContext || typedContext || null;
      if (ctx && Array.isArray(ctx.photos)) {
        list = ctx.photos.filter(Boolean);
        if (list.length) photos = list;
      }
    }
    if (!list.length) return;

    const api = window.ProjetoAmorFotos;
    if (!api || typeof api.open !== "function") return;

    photosInvited = true;

    /* O respiro entre a última palavra e a primeira fotografia. Em
       movimento reduzido ele é mais curto, mas nunca zero: a leitura
       precisa ter tempo de pousar. */
    later(() => {
      if (!open) return;
      const fotos = window.ProjetoAmorFotos;
      if (!fotos || typeof fotos.open !== "function") return;

      fotos.open({
        photos: list,
        onEnter: suspendSceneForPhotos,
        onExit: resumeSceneAfterPhotos
      });
    }, reduced ? 1600 : 3200);
  }

  /* Movimento reduzido e qualquer conclusão antecipada: o conteúdo
     inteiro aparece de uma vez, sem espera. */
  function renderMessageInstant() {
    stopTyping();
    const values = messageValues();
    messageFields().forEach(field => {
      field.el.textContent = field.text;
      field.el.classList.remove("is-typing");
    });
    const signoff = document.querySelector(".surprise-signoff");
    if (signoff) signoff.hidden = !values.sender;

    /* A leitura está completa: a próxima etapa pode ser convidada. */
    schedulePhotosAfterReading();
  }

  function startTyping() {
    stopTyping();
    const run = typeRun;
    const fields = messageFields();
    if (!fields.length) return;

    const signoff = document.querySelector(".surprise-signoff");
    /* A assinatura estática ("Sempre por perto…") só entra quando a
       digitação chega ao remetente — antes disso, o bloco nem ocupa
       espaço no papel. */
    if (signoff) signoff.hidden = true;

    fields.forEach(field => {
      field.el.textContent = "";
      field.chars = getGraphemes(field.text);
    });

    let fieldIndex = 0;
    let charIndex = 0;
    let current = null;
    let rendered = "";

    const settleCurrent = () => {
      if (!current) return;
      current.classList.remove("is-typing");
      if (typingEl === current) typingEl = null;
      current = null;
    };

    const step = () => {
      /* Fechou, reabriu ou o movimento mudou: este passo morre aqui. */
      if (run !== typeRun) return;

      if (fieldIndex >= fields.length) {
        settleCurrent();
        typeTimer = 0;
        schedulePhotosAfterReading();
        return;
      }

      const field = fields[fieldIndex];

      if (charIndex === 0) {
        rendered = "";
        current = field.el;
        typingEl = current;
        current.classList.add("is-typing");
        if (field.id === "surprise-sender" && signoff) signoff.hidden = false;
      }

      if (charIndex >= field.chars.length) {
        settleCurrent();
        fieldIndex += 1;
        charIndex = 0;
        if (fieldIndex >= fields.length) {
          typeTimer = 0;
          schedulePhotosAfterReading();
          return;
        }
        typeTimer = window.setTimeout(step, field.pause || PAUSE_FIELD_MS);
        return;
      }

      const char = field.chars[charIndex];
      charIndex += 1;
      rendered += char;
      field.el.textContent = rendered;

      let delay = field.chars.length <= 14 ? TYPE_SHORT_MS : TYPE_SPEED_MS;
      if (char === "." || char === "!" || char === "?") delay += PAUSE_SENTENCE_MS;
      else if (char === "," || char === ";" || char === ":" || char === "—") delay += PAUSE_COMMA_MS;
      else if (char === "\n") delay += PAUSE_PARAGRAPH_MS;

      typeTimer = window.setTimeout(step, delay);
    };

    step();
  }

  function fillContent(context) {
    typedContext = context && typeof context === "object" ? context : {};

    setText(document.querySelector(".surprise-kicker"), KICKER);
    /* Todos os campos digitáveis começam REALMENTE vazios: nada de
       texto completo escondido por opacidade atrás da animação. A
       assinatura também espera a digitação chegar ao remetente (ou
       fica escondida para sempre quando a carta não tem remetente). */
    clearTypedText();
  }

  /* ══════════════════════════════════════════════════════════════
     CENA
     ══════════════════════════════════════════════════════════════ */
  function show(context) {
    /* Já aberta: um segundo clique não reinicia a cena (e não faz a
       sequência de entrada rodar de novo por cima da mensagem já
       revelada). */
    if (open) return;
    /* Ainda saindo: não reacende a cena por baixo da etapa seguinte. */
    if (animating) return;

    clearTimers();
    launching = false;
    photosInvited = false;

    if (context && typeof context === "object") {
      photos = Array.isArray(context.photos) ? context.photos.filter(Boolean) : photos;
      if (typeof context.hasGallery === "boolean") hasGallery = context.hasGallery;
      else if (Array.isArray(context.photos)) hasGallery = context.photos.length > 0;
    }
    fillContent(context);

    /* Estado inicial limpo: quem sai da etapa e volta encontra o envelope
       fechado, como na primeira visita. */
    if (backGallery) backGallery.hidden = !hasGallery;
    /* As saídas só entram com a mensagem. */
    if (actions) actions.hidden = true;
    if (paper) {
      paper.hidden = true;
      paper.classList.remove("shimmer-run");
    }
    /* is-revealed primeiro, para o estado "aberta" do envelope e o
       papel entrem limpos: sem isto, voltar da mensagem e reentrar
       reaproveitaria a composição escurecida da leitura. */
    scene.classList.remove("is-revealed", "is-stable");
    if (envelopeBtn) {
      envelopeBtn.classList.remove("is-open");
      envelopeBtn.disabled = false;
      envelopeBtn.setAttribute("aria-expanded", "false");
    }
    if (intro) {
      intro.hidden = false;
      intro.classList.remove("is-leaving");
    }

    scene.hidden = false;
    open = true;
    animating = true;
    scene.classList.add("is-entering");

    /* O fundo novo (corações + ondas) já está no lugar junto com a
       cena — é decorativo (aria-hidden, pointer-events: none), então
       nunca atrapalha leitura nem clique. */

    /* Só uma cena visível por vez: a galeria e a carta saem de cena.
       A carta sai em cross-fade, não de uma vez. */
    const c = bridge();
    if (c) c.hideLetter();
    else if (letterContent) letterContent.hidden = true;

    focusScene();

    scrollTop();

    /* Um quadro de separação antes de .is-stable, com um reflow
       forçado antes: sem ele o navegador computa o estado inicial e o
       final antes de qualquer paint e a sequência inteira é pulada.
       (Mesma técnica já usada na revelação do papel, mais abaixo.) */
    void scene.offsetWidth;
    requestAnimationFrame(() => {
      if (!open) return;
      scene.classList.remove("is-entering");
      scene.classList.add("is-stable");
    });

    /* `animating` só é um espelho do estado da cena; o tempo aqui é o
       da sequência em CSS, não um bloqueio para o visitante. */
    later(() => { animating = false; }, reduced ? 10 : SCENE_ENTER_MS);
  }

  /* Saída da cena: some com a seção e entrega a próxima etapa. */
  function close(next) {
    if (!open) {
      /* Já está saindo: um clique duplo não executa o destino duas
         vezes. O primeiro fechamento continua sendo o dono da saída. */
      if (animating) return;
      if (typeof next === "function") next();
      return;
    }
    clearTimers();
    /* A digitação morre junto com a cena. Sem isto, o timer pendente
       continuaria escrevendo no papel escondido e a reabertura poderia
       herdar letras da leitura anterior. */
    stopTyping();
    open = false;
    animating = true;
    scene.classList.remove("is-stable", "is-revealed");
    scene.classList.add("is-leaving");

    later(() => {
      scene.hidden = true;
      scene.classList.remove("is-leaving");
      animating = false;
      if (typeof next === "function") {
        next();
      } else {
        const c = bridge();
        /* Devolve a carta e a rolagem de onde ela foi embora. */
        if (c) c.showLetter();
        else if (letterContent) letterContent.hidden = false;
      }
    }, reduced ? 10 : 900);   /* = a duração do fade de .surprise-scene */
  }

  /* ══════════════════════════════════════════════════════════════
     ABERTURA DO ENVELOPE → MENSAGEM
     ══════════════════════════════════════════════════════════════ */
  function revealMessage() {
    if (!paper || !paper.hidden) return;

    /* O envelope sai de cena e só depois o papel entra. Sem isto, os dois
       ficavam visíveis durante ~500ms no mesmo ponto da tela — a
       sobreposição que o próprio comentário dizia não existir. */
    if (intro) intro.classList.add("is-leaving");

    later(() => {
      if (intro) intro.hidden = true;

      /* Duas etapas, nunca na mesma: primeiro o papel entra no fluxo e
         só no quadro seguinte `is-revealed` ajusta a luz da cena. O
         texto começa vazio; a digitação só é agendada depois que o
         papel está de fato visível. */
      paper.hidden = false;
      requestAnimationFrame(() => {
        /* A cena pode ter sido fechada entre o paint e este quadro
           (Esc, por exemplo): não reacende nem inicia digitação órfã. */
        if (!open || paper.hidden) return;
        scene.classList.add("is-revealed");
        if (actions) actions.hidden = false;

        const box = paper.getBoundingClientRect();
        /* O que precisa caber não é só o papel: as saídas vêm logo
           abaixo dele. Medir os dois juntos evita o caso em que o papel
           cabe na viewport mas o "Voltar para a carta" fica abaixo da
           dobra. */
        const actionsBox = actions && !actions.hidden ? actions.getBoundingClientRect() : null;
        const fim = actionsBox ? actionsBox.bottom : box.bottom;

        if (box.top < 0 || fim > window.innerHeight) {
          /* Alinhar ao TOPO, sempre. Centralizar um papel de ~1039 px
             numa tela de 900 px cortava o começo ("Meu amor" já nascia
             acima da borda) e o fim (a assinatura e as saídas ficavam
             abaixo dela) — o leitor abria a mensagem no meio. Alinhado
             ao topo, a leitura começa pelo começo; o fim é alcançado
             rolando. Em telas em que o conjunto cabe (papel + saídas),
             o mesmo alinhamento deixa as saídas visíveis, porque o
             espaço que sobra fica todo embaixo. */
          paper.scrollIntoView({
            behavior: reduced ? "auto" : "smooth",
            block: "start"
          });
        }

        /* Movimento reduzido: conteúdo completo, sem espera. Caso
           contrário, começa a ÚNICA sequência de digitação desta
           abertura — depois do papel visível e do quadro de entrada. */
        if (reduced) {
          renderMessageInstant();
        } else {
          later(startTyping, 140);
        }
      });

      /* Brilho de luz passando pelo papel — o mesmo efeito da carta. */
      if (!reduced) {
        paper.classList.remove("shimmer-run");
        void paper.offsetWidth;
        later(() => paper.classList.add("shimmer-run"), 220);
      }
    }, reduced ? 10 : 500);
  }

  function openEnvelope() {
    if (!envelopeBtn || !open) return;
    if (envelopeBtn.classList.contains("is-open")) return;

    envelopeBtn.disabled = true;
    envelopeBtn.setAttribute("aria-expanded", "true");

    if (reduced) {
      revealMessage();
      return;
    }

    envelopeBtn.classList.add("is-open");
    /* Fim da animação do envelope (aba ~0,94s + papel ~1,1s) antes de
       trocar a cena: a revelação nunca atropela a abertura. */
    later(revealMessage, 1500);
  }

  /* ══════════════════════════════════════════════════════════════
     CONTROLES
     ══════════════════════════════════════════════════════════════ */
  if (envelopeBtn) envelopeBtn.addEventListener("click", openEnvelope);

  /* Guardado para que voltar/reabrir não perca os dados do link */
  let lastContext = null;

  /* Entradas: o botão discreto da carta (quando não há galeria) e o
     botão da galeria. Este último fecha a galeria ANTES de abrir a
     surpresa — as duas cenas nunca ficam visíveis ao mesmo tempo. */
  launchEls.forEach(el => {
    el.addEventListener("click", () => {
      /* Toque duplo: o primeiro clique já registrou a abertura; o
         segundo não pode abrir a surpresa por cima da galeria que ainda
         está saindo (e nem abri-la de novo no fim do fade). */
      if (launching) return;
      const showIt = () => { launching = false; show(lastContext); };
      if (window.ProjetoAmorGaleria && window.ProjetoAmorGaleria.isOpen()) {
        launching = true;
        window.ProjetoAmorGaleria.close(showIt);
        return;
      }
      showIt();
    });
  });

  if (backGallery) {
    backGallery.addEventListener("click", () => {
      close(() => {
        if (window.ProjetoAmorGaleria && photos.length) window.ProjetoAmorGaleria.open(photos);
        else if (bridge()) bridge().showLetter();
        else if (letterContent) letterContent.hidden = false;
      });
    });
  }

  if (backLetter) {
    backLetter.addEventListener("click", () => close());
  }

  /* ── Botão de acesso à homenagem de aniversário ─────────────── */
  const aniversarioLaunchBtn = document.getElementById("aniversario-launch");
  if (aniversarioLaunchBtn) {
    /* Mostra o botão assim que o módulo estiver pronto */
    aniversarioLaunchBtn.hidden = false;

    aniversarioLaunchBtn.addEventListener("click", () => {
      if (!window.ProjetoAmorAniversario) return;
      /* Fecha a surpresa antes de abrir a homenagem */
      close(() => {
        window.ProjetoAmorAniversario.open({
          context: lastContext,
          onExit() {
            /* Volta para a surpresa ao fechar a homenagem */
            if (window.ProjetoAmorSurpresa) {
              window.ProjetoAmorSurpresa.open();
            }
          }
        });
      });
    });
  }

  /* Teclado: Esc volta para a etapa anterior. Enquanto a página das
     fotografias está por cima, o Esc pertence a ela — a surpresa não
     pode fechar por baixo. A classe no body cobre também o instante do
     fade de saída, quando a cena já não está mais "aberta". */
  document.addEventListener("keydown", event => {
    if (!open || event.key !== "Escape") return;
    if (document.body.classList.contains("photos-open")) return;
    if (window.ProjetoAmorFotos && window.ProjetoAmorFotos.isOpen()) return;
    if (backGallery && !backGallery.hidden) {
      close(() => {
        if (window.ProjetoAmorGaleria && photos.length) window.ProjetoAmorGaleria.open(photos);
        else if (bridge()) bridge().showLetter();
        else if (letterContent) letterContent.hidden = false;
      });
    } else {
      close();
    }
  });

  /* ══════════════════════════════════════════════════════════════
     API
     ══════════════════════════════════════════════════════════════ */
  window.ProjetoAmorSurpresa = {
    /* main.js registra aqui os dados que já decodificou do link, sem
       abrir nada: os botões da carta e da galeria passam a usar este
       mesmo contexto, e nenhum dado se perde entre as etapas. */
    configure(context) {
      lastContext = context || null;
    },
    /* main.js chama isto com os dados que já decodificou do link */
    open(context) {
      lastContext = context || lastContext;
      if (launching) return;
      const start = () => { launching = false; show(lastContext); };
      if (window.ProjetoAmorGaleria && window.ProjetoAmorGaleria.isOpen()) {
        launching = true;
        window.ProjetoAmorGaleria.close(start);
        return;
      }
      start();
    },
    close,
    isOpen: () => open,
    /* main.js propaga a decisão de movimento para todos os motores */
    setMotion(allow) {
      motionForced = !!allow;
      reduced = motionQuery.matches && !motionForced;
      /* Se o visitante passou a preferir movimento reduzido no meio da
         leitura, o texto termina de aparecer na hora — sem deixar a
         sequência correndo contra a preferência. */
      if (reduced && paper && !paper.hidden) renderMessageInstant();
    }
  };

})();