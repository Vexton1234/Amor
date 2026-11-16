/* Projeto Amor — Etapa 03: os três cartões de promessa ("Se eu pudesse
   te prometer três coisas").

   Autocontido, como galeria.js, surpresa.js e loading.js: não toca no
   editor, no envelope, na digitação da carta, na galeria nem na
   surpresa. Vive DENTRO do papel da carta — os cartões são
   uma parte da leitura, não uma etapa nova — e por isso nunca bloqueiam
   a navegação para as outras seções.

   Dados: vêm do próprio link, no campo `promises` (lista de até três
   textos escrita pelo editor). Nada é inventado aqui. Cartas antigas não
   têm o campo — nesse caso a seção inteira continua escondida, sem erro
   e sem espaço vazio.

   Comportamento dos cartões:
   • começam fechados (o texto aparece desfocado e coberto por um véu);
   • um clique, um toque ou Enter/Espaço abre apenas aquele cartão;
   • abrir um não abre nem fecha os outros;
   • depois de aberto, a promessa continua visível — não há fechar;
   • com movimento reduzido a abertura é imediata: nada depende de
     animação para a promessa ser lida.

   Acessibilidade: cada cartão é um <button> real, com nome acessível,
   `aria-expanded` invertido a cada abertura e foco visível. O texto da
   promessa fica no DOM desde o começo (é o que permite a leitura
   imediata no modo sem movimento e evita depender de animação para
   transmitir conteúdo); o estado fechado é comunicado por
   `aria-expanded="false"` e pela pista visual "abrir".

   Movimento reduzido: este módulo não guarda estado de animação
   nenhum. Quem trata disso é a regra global do projeto
   (`prefers-reduced-motion` + a classe .motion-forced do botão
   "Ver tudo se animando"), que zera as transições dos cartões — abrir
   um cartão é sempre um estado direto, animado ou não.

   API: window.ProjetoAmorPromessas = { configure, reset, has, count } */
(() => {
  "use strict";

  const section = document.getElementById("promises-section");
  if (!section) return;

  const cards = Array.from(section.querySelectorAll(".promise-card"));

  const count = () => cards.filter(card => !card.hidden).length;

  /* ══════════════════════════════════════════════════════════════
     ABERTURA
     Abre um cartão e só ele. O estado é a classe e o atributo, nunca
     a animação: se a transição for interrompida, cortada ou zerada,
     a promessa continua legível.
     ══════════════════════════════════════════════════════════════ */
  function openCard(card) {
    if (!card || card.classList.contains("is-open")) return;
    card.classList.add("is-open");
    card.setAttribute("aria-expanded", "true");
  }

  cards.forEach(card => {
    /* Um único caminho para abrir, vindo do mouse, do toque ou do
       teclado: <button> já transforma Enter e Espaço em clique. */
    card.addEventListener("click", event => {
      event.stopPropagation();
      openCard(card);
    });

    /* A carta usa o duplo toque no papel para concluir a leitura
       inteira. Abrir um cartão é um toque só e não pode ser confundido
       com isso: Enter e Espaço param aqui e não sobem. */
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    });
  });

  /* ══════════════════════════════════════════════════════════════
     DADOS
     ══════════════════════════════════════════════════════════════ */
  function normalize(promises) {
    if (!Array.isArray(promises)) return [];
    return promises
      .map(item => (typeof item === "string" ? item : ""))
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, cards.length);
  }

  /* main.js chama isto com os dados que já decodificou do link, sem
     abrir nada: é o mesmo padrão de configure() na surpresa. */
  function configure(promises) {
    const list = normalize(promises);

    cards.forEach((card, index) => {
      const text = list[index] || "";
      const el = card.querySelector(".promise-text");

      if (el) el.textContent = text;
      /* Cartão sem promessa some inteiro — sem moldura, sem numeral,
         sem área de toque sobrando. */
      card.hidden = !text;
      card.classList.remove("is-open");
      card.setAttribute("aria-expanded", "false");
      /* O nome acessível antecipa o texto que está escondido atrás do
         véu, para quem navega por voz ou leitor de tela. */
      card.setAttribute("aria-label", text ? `Promessa ${index + 1}: ${text}` : "");
    });

    /* A seção NÃO é mostrada aqui: quem decide o momento é a leitura
       (main.js a revela junto com os outros blocos, ou de imediato no
       modo sem movimento). Este módulo apenas preenche e diz o que
       existe — `has()` é a fonte da verdade. */
  }

  /* Voltar todos os cartões ao estado fechado — usado pelo botão
     "Ler novamente", que reabre o envelope e recomeça a leitura. */
  function reset() {
    cards.forEach(card => {
      card.classList.remove("is-open");
      card.setAttribute("aria-expanded", "false");
    });
  }

  window.ProjetoAmorPromessas = {
    configure,
    reset,
    /* Quantas promessas esta carta realmente tem (0 em cartas antigas) */
    count,
    has: () => count() > 0,
    /* exposto apenas para inspeção em testes */
    isOpen(card) {
      return !!(card && card.classList.contains("is-open"));
    }
  };
})();