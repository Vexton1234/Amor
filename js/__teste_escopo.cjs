/* Verificação de ESCOPO do main.js.

   Um ReferenceError só aparece em tempo de execução, no fim da leitura
   da carta — longe de quem lê o código. Esta suíte existe para pegar
   essa classe de defeito ANTES, sem navegador: ela descobre o bloco
   que monta a carta e verifica que nenhum nome declarado dentro dele é
   usado de fora.

   O defeito que motivou esta suíte: `revealClosingNote` (a nota final
   "Algumas palavras acabam. O sentimento, não.") era declarada dentro
   do bloco `if (envelopeButton && letterContent) { ... }`, mas é
   chamada por `startTypewriterSequence`, que mora FORA desse bloco.
   Resultado: ReferenceError no fim da leitura, a nota final nunca
   aparecia e a exceção derrubava o resto do fluxo (abrir a galeria,
   abrir a surpresa). O navegador só mostrou isso porque as execuções
   anteriores serviam um main.js antigo, do cache do perfil.

   Verifica
   • a nota final (e sua hiding) são declaradas no nível do módulo
   • nenhum nome declarado dentro do bloco da carta é chamado de fora
   • a chamada da nota final continua existindo no fim da leitura      */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "main.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

/* ══════════════════════════════════════════════════════════════════
   LEITURA DO CÓDIGO
   ══════════════════════════════════════════════════════════════════ */

/* Neutraliza o que não é código: comentários, strings e expressões
   regulares. O texto é trocado por espaços — o número de linhas e as
   posições de cada caractere continuam idênticos, o que permite
   encontrar linhas e colunas exatas no arquivo original. */
function neutralizar(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;

  /* Um "/" começa expressão regular só depois de um token que admite
     valor. Sem isto, o "/^image\//i" da linha 100 seria lido como
     comentário. */
  const antesDeRegex = /[=(,:[!&|?{};+\-*%<>~^]|\breturn\b|\btypeof\b|\bcase\b|\bin\b|\bof\b|\bnew\b/;

  let anterior = "";
  const ultimoSignificativo = () => {
    let k = out.length - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    return k >= 0 ? out[k] : "";
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    /* comentário de linha */
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    /* comentário de bloco */
    if (c === "/" && d === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
    /* strings */
    if (c === '"' || c === "'" || c === "`") {
      const aspas = c;
      out[i] = " ";
      i++;
      while (i < n) {
        if (src[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (src[i] === aspas) { out[i] = " "; i++; break; }
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    /* expressão regular */
    if (c === "/" && antesDeRegex.test(anterior)) {
      out[i] = " ";
      i++;
      let emClasse = false;
      while (i < n) {
        if (src[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (src[i] === "[") emClasse = true;
        else if (src[i] === "]") emClasse = false;
        else if (src[i] === "/" && !emClasse) { out[i] = " "; i++; break; }
        else if (src[i] === "\n") break;
        else out[i] = " ";
        i++;
      }
      continue;
    }

    anterior = c;
    i++;
  }
  return out.join("");
}

function linhaDe(texto, agulha, aPartirDe = 0) {
  const i = texto.indexOf(agulha, aPartirDe);
  if (i < 0) return -1;
  return texto.slice(0, i).split("\n").length;
}

/* Acha a chave que fecha o bloco aberto na linha `linhaInicial`,
   contando apenas as chaves do código neutralizado. */
function chaveDeFechamento(limpo, linhaInicial) {
  const linhas = limpo.split("\n");
  let profundidade = 0;
  let achouAbertura = false;
  for (let l = linhaInicial - 1; l < linhas.length; l++) {
    for (const ch of linhas[l]) {
      if (ch === "{") { profundidade++; achouAbertura = true; }
      else if (ch === "}") {
        profundidade--;
        if (achouAbertura && profundidade === 0) return l + 1;   /* linha 1-based */
      }
    }
  }
  return -1;
}

/* Nomes declarados dentro de um trecho de código. */
function declaradosNo(trecho) {
  const nomes = new Set();
  const re = /(?:^|[\s;{}()])(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(trecho)) !== null) nomes.add(m[1]);
  return nomes;
}

/* Chamadas de um nome no trecho (não a declaração). */
function chamadasDe(trecho, nome) {
  const re = new RegExp("(?<![\\w$.])" + nome.replace(/\$/g, "\\$") + "\\s*\\(", "g");
  const achados = [];
  let m;
  while ((m = re.exec(trecho)) !== null) {
    /* ignora a própria declaração */
    const antes = trecho.slice(Math.max(0, m.index - 30), m.index);
    if (/(?:const|let|var|function|class)\s+$/.test(antes)) continue;
    achados.push(m.index);
  }
  return achados;
}

/* ══════════════════════════════════════════════════════════════════
   OS CASOS
   ══════════════════════════════════════════════════════════════════ */

const src = fs.readFileSync(SRC, "utf8");
const limpo = neutralizar(src);
const linhas = limpo.split("\n");

/* Onde começa e termina o bloco que monta a carta? */
const linhaDoBloco = linhaDe(limpo, "if (envelopeButton && letterContent) {");
assert(linhaDoBloco > 0, "não achei o bloco `if (envelopeButton && letterContent) {` no main.js");
const linhaDoFim = chaveDeFechamento(limpo, linhaDoBloco);
assert(linhaDoFim > linhaDoBloco, "não consegui achar a chave que fecha o bloco da carta");

const corpoDoBloco = linhas.slice(linhaDoBloco, linhaDoFim).join("\n");
const foraDoBloco = linhas.slice(0, linhaDoBloco).join("\n") + "\n" + linhas.slice(linhaDoFim).join("\n");

const resultados = [];
const run_ = (nome, fn) => {
  try {
    const extra = fn();
    resultados.push({ nome, ok: true });
    console.log("  OK   " + nome + (extra ? " — " + extra : ""));
  } catch (e) {
    resultados.push({ nome, ok: false });
    console.log("  FALHA " + nome + "\n         " + e.message);
  }
};

run_("a nota final vive no nível do módulo", () => {
  const linha = linhaDe(limpo, "const revealClosingNote");
  assert(linha > 0, "a declaração de revealClosingNote não existe no main.js");
  const texto = linhas[linha - 1];
  assert(/^ {2}const revealClosingNote = /.test(texto),
    `revealClosingNote está na linha ${linha} fora do nível do módulo: "${texto.trim()}"`);
  assert(linha < linhaDoBloco,
    `revealClosingNote (linha ${linha}) precisa vir ANTES do bloco da carta (linha ${linhaDoBloco}), ` +
    `porque quem a chama mora fora dele`);
  return `linha ${linha}, bloco da carta começa na ${linhaDoBloco}`;
});

run_("a nota final é chamada no fim da leitura", () => {
  assert(/>\s*revealClosingNote\(\);/.test(limpo) || /revealClosingNote\(\);/.test(limpo),
    "a chamada de revealClosingNote sumiu do main.js");
  const linha = linhaDe(limpo, "revealClosingNote();");
  assert(linha > linhaDoFim,
    `a chamada de revealClosingNote (linha ${linha}) está dentro do bloco da carta ` +
    `(linhas ${linhaDoBloco}-${linhaDoFim}) — de dentro ela enxergaria a declaração, ` +
    `mas de fora (como é o caso) não enxerga`);
  return `linha ${linha}`;
});

run_("nenhum nome do bloco da carta é usado de fora", () => {
  const dentro = declaradosNo(corpoDoBloco);
  /* nomes que também existem no nível do módulo não são problema:
     são declarações diferentes, com vida própria */
  const fora = declaradosNo(foraDoBloco);
  const problemas = [];
  for (const nome of dentro) {
    if (fora.has(nome)) continue;               /* também declarado fora */
    if (/^(window|document|console|Object|Array|Math|JSON|Promise|String|Number|Boolean|setTimeout|clearTimeout|requestAnimationFrame|cancelAnimationFrame|Intl|Error|RegExp|Date|Symbol|Map|Set|WeakMap|WeakSet|Uint8Array|TextEncoder|TextDecoder|Image|File|FileReader|Blob|URL|URLSearchParams|fetch|performance|localStorage|sessionStorage|history|navigator|location|parseInt|parseFloat|isNaN|structuredClone|CustomEvent|Event|Node|Element)$/.test(nome)) continue;
    const chamadas = chamadasDe(foraDoBloco, nome);
    if (!chamadas.length) continue;
    const linha = linhas.slice(0, foraDoBloco.slice(0, chamadas[0]).split("\n").length - 1).length + 1;
    problemas.push(`"${nome}" (declarado dentro do bloco da carta, linha ${linha} do main.js)`);
  }
  assert(problemas.length === 0,
    "chamado de fora do bloco, mas declarado dentro dele: " + problemas.join("; "));
  return `${dentro.size} nomes no bloco, nenhum vazado para fora`;
});

run_("o bloco da carta é o esperado", () => {
  assert(linhaDoFim > linhaDoBloco, "bloco da carta malformado");
  assert(linhaDoFim - linhaDoBloco > 300, `o bloco da carta tem só ${linhaDoFim - linhaDoBloco} linhas — o harness pode estar errado`);
  return `linhas ${linhaDoBloco}–${linhaDoFim}`;
});

const falhas = resultados.filter(r => !r.ok).length;
console.log(falhas ? `\n${falhas} caso(s) falharam` : "\nTodos os casos passaram");
process.exit(falhas ? 1 : 0);
