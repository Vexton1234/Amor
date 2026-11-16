/* Verificação do ENVIO do editor — a corrida entre a foto e o clique.

   Dois defeitos desta classe não aparecem no `node --check` nem em uma
   leitura rápida do código:

   1. Enquanto uma foto é reduzida no canvas ela ainda NÃO está em
      `photos`. Quem clicasse em "Criar minha carta" nesse intervalo
      gerava um link sem a foto — e o dado preenchido se perdia em
      silêncio. O envio precisa ESPERAR as tarefas pendentes.

   2. URLSearchParams transforma "+" em espaço. Um link antigo em base64
      PADRÃO (com "+") perdia bytes ao ser lido, e a carta não abria. O
      fragmento tem de ser lido cru.

   Esta suíte verifica as duas coisas sem navegador: os casos de
   estrutura olham para o código neutralizado (comentários, strings e
   regex trocados por espaços), e os casos de comportamento executam a
   função `readLetterCode` extraída do próprio main.js.

   Verifica
   • readLetterCode preserva "+" e "/" de um link antigo
   • readLetterCode decodifica um fragmento percent-encoded
   • hash vazio ou sem `c` devolve texto vazio
   • o seletor de foto registra a tarefa (não processa solto)
   • o envio espera as fotos antes de ler o formulário
   • o envio não dispara duas vezes
   • o sucesso só aparece depois de decodificar o link
   • a falha reabilita o botão e não anuncia sucesso              */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "main.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

/* ══════════════════════════════════════════════════════════════════
   LEITURA DO CÓDIGO
   ══════════════════════════════════════════════════════════════════ */

/* Troca comentários, strings e expressões regulares por espaços,
   preservando o comprimento e as quebras de linha. Assim os índices do
   texto neutralizado apontam para o mesmo lugar no arquivo original. */
function neutralizar(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const antesDeRegex = /[=(,:[!&|?{};+\-*%<>~^]|\breturn\b|\btypeof\b|\bcase\b|\bin\b|\bof\b|\bnew\b/;
  let anterior = "";

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
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

/* Índice da chave que fecha o bloco aberto em `abertura`. */
function fechamentoDe(limpo, abertura) {
  assert(limpo[abertura] === "{", "o índice informado não aponta para uma chave de abertura");
  let profundidade = 0;
  for (let i = abertura; i < limpo.length; i++) {
    if (limpo[i] === "{") profundidade++;
    else if (limpo[i] === "}") {
      profundidade--;
      if (profundidade === 0) return i;
    }
  }
  return -1;
}

/* Recorta do arquivo ORIGINAL a função inteira (útil para executá-la). */
function recortarFuncao(src, limpo, nome) {
  const assinatura = new RegExp("function\\s+" + nome + "\\s*\\(");
  const m = assinatura.exec(limpo);
  assert(m, `a função ${nome} não existe no main.js`);
  const abertura = limpo.indexOf("{", m.index);
  assert(abertura > 0, `não achei o corpo de ${nome}`);
  const fim = fechamentoDe(limpo, abertura);
  assert(fim > abertura, `o corpo de ${nome} está malformado`);
  return src.slice(m.index, fim + 1);
}

const src = fs.readFileSync(SRC, "utf8");
const limpo = neutralizar(src);

/* ══════════════════════════════════════════════════════════════════
   LOCALIZAÇÃO DOS TRECHOS
   ══════════════════════════════════════════════════════════════════ */

/* O handler de submit (procura no original por causa da string "submit"). */
const iSubmit = src.indexOf('form.addEventListener("submit"');
assert(iSubmit > 0, "não achei o handler de submit do formulário");
const iSubmitAbertura = limpo.indexOf("{", limpo.indexOf("async event =>", iSubmit));
assert(iSubmitAbertura > 0, "não achei o corpo do handler de submit");
const iSubmitFim = fechamentoDe(limpo, iSubmitAbertura);
const handlerSubmit = limpo.slice(iSubmitAbertura, iSubmitFim + 1);

const iCatch = handlerSubmit.indexOf("catch (error)");
assert(iCatch > 0, "não achei o tratamento de erro do envio");
const iCatchAbertura = handlerSubmit.indexOf("{", iCatch);
const iCatchFim = fechamentoDe(handlerSubmit, iCatchAbertura);
const corpoCatch = handlerSubmit.slice(iCatchAbertura, iCatchFim + 1);

/* O handler do seletor de foto. */
const iChange = src.indexOf('input.addEventListener("change"');
assert(iChange > 0, "não achei o handler de troca de foto");
const iChangeAbertura = limpo.indexOf("{", limpo.indexOf("event =>", iChange));
assert(iChangeAbertura > 0, "não achei o corpo do handler de foto");
const iChangeFim = fechamentoDe(limpo, iChangeAbertura);
const handlerFoto = limpo.slice(iChangeAbertura, iChangeFim + 1);

/* O corpo de processPhotoFile (onde o await de buildPhoto deve viver). */
const iProcessoAbertura = limpo.indexOf("{", limpo.indexOf("async function processPhotoFile"));
assert(iProcessoAbertura > 0, "não achei processPhotoFile");
const iProcessoFim = fechamentoDe(limpo, iProcessoAbertura);
const corpoProcesso = limpo.slice(iProcessoAbertura, iProcessoFim + 1);

/* ══════════════════════════════════════════════════════════════════
   OS CASOS
   ══════════════════════════════════════════════════════════════════ */

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

/* Executa a função real, com um window de mentira. */
const lerCodigo = (() => {
  const fonte = recortarFuncao(src, limpo, "readLetterCode");
  const fabrica = new Function("window", fonte + "\nreturn readLetterCode;");
  return hash => fabrica({ location: { hash } })();
})();

run_("um link antigo com + chega intacto", () => {
  const codigo = "ab+cd/ef+gh/ij==";
  const lido = lerCodigo("#c=" + codigo);
  assert(lido === codigo,
    `o fragmento foi alterado: ${JSON.stringify(lido)} (esperado ${JSON.stringify(codigo)})`);
  assert(!lido.includes(" "), "o + virou espaço — URLSearchParams voltou ao caminho");
  return `${lido.length} chars, + e / preservados`;
});

run_("um fragmento percent-encoded é decodificado", () => {
  const lido = lerCodigo("#c=abc%2Bdef%2Fghi%3D");
  assert(lido === "abc+def/ghi=", `decodificação errada: ${JSON.stringify(lido)}`);
  return "percent-encoding resolvido antes do decodificador";
});

run_("hash vazio ou sem c devolve texto vazio", () => {
  assert(lerCodigo("") === "", "hash vazio deveria devolver string vazia");
  assert(lerCodigo("#foo=1") === "", "hash sem c deveria devolver string vazia");
  assert(lerCodigo("#c=") === "", "c vazio deveria devolver string vazia");
  return "três entradas inválidas recusadas sem exceção";
});

run_("o seletor de foto registra a tarefa, não processa solto", () => {
  assert(/trackPhotoTask\(\s*processPhotoFile\(/.test(handlerFoto),
    "o handler de change não registra a tarefa em trackPhotoTask(processPhotoFile(...))");
  assert(!/buildPhoto\s*\(/.test(handlerFoto),
    "o handler de change ainda chama buildPhoto direto — o envio não teria como esperar");
  assert(/await\s+buildPhoto\s*\(/.test(corpoProcesso),
    "processPhotoFile não aguarda buildPhoto");
  return "a foto entra em pendingPhotoTasks antes de ser reduzida";
});

run_("o envio espera as fotos antes de ler o formulário", () => {
  const iPendentes = handlerSubmit.indexOf("pendingPhotoTasks.size");
  const iForm = handlerSubmit.indexOf("getFormData()");
  assert(iPendentes > 0, "o envio não consulta pendingPhotoTasks");
  assert(iForm > 0, "o envio não lê o formulário");
  assert(iPendentes < iForm,
    `o formulário é lido (índice ${iForm}) antes da espera das fotos (índice ${iPendentes})`);
  assert(/await\s+Promise\.all\(\s*Array\.from\(\s*pendingPhotoTasks\s*\)/.test(handlerSubmit),
    "a espera não aguarda uma cópia da lista de tarefas");
  assert(/while\s*\(\s*pendingPhotoTasks\.size\s*\)/.test(handlerSubmit),
    "a espera não repete: uma foto escolhida durante o envio ficaria de fora");
  return "espera → lê → codifica";
});

run_("o envio não dispara duas vezes", () => {
  const guarda = handlerSubmit.indexOf("if (submitting) return;");
  const marca = handlerSubmit.indexOf("submitting = true;");
  assert(guarda > 0, "não há guarda de reentrada (if (submitting) return)");
  assert(marca > guarda, "submitting não é marcado depois da guarda");
  assert(/finally\s*\{[^}]*submitting\s*=\s*false/.test(handlerSubmit),
    "submitting nunca volta a false — o segundo envio legítimo ficaria travado");
  return "um envio por vez, liberado no finally";
});

run_("o sucesso só aparece depois de decodificar o link", () => {
  const iDecodifica = handlerSubmit.indexOf("decodeData(encoded)");
  assert(iDecodifica > 0, "o envio não decodifica o link gerado");
  const iSucesso = handlerSubmit.indexOf("setStatus", iDecodifica);
  assert(iSucesso > iDecodifica, "não achei a mensagem de sucesso depois da decodificação");
  const entre = handlerSubmit.slice(iDecodifica, iSucesso);
  assert(/throw new Error/.test(entre),
    "a comparação do link não interrompe o envio quando algo diverge");
  assert(/photosOk/.test(entre) && /textOk/.test(entre),
    "a verificação não cobre fotos e texto");
  return "ida e volta conferida antes de anunciar";
});

run_("a falha reabilita o botão e não anuncia sucesso", () => {
  assert(/submitButton\.disabled\s*=\s*false/.test(corpoCatch),
    "o botão não é reabilitado no erro");
  assert(/console\.error/.test(corpoCatch),
    "o erro não é registrado no console");
  assert(!/location\.href/.test(corpoCatch),
    "o caminho de erro ainda navega — a pessoa iria para uma carta que não existe");
  return "erro visível, botão de volta, sem navegação";
});

const falhas = resultados.filter(r => !r.ok).length;
console.log(falhas ? `\n${falhas} caso(s) falharam` : "\nTodos os casos passaram");
process.exit(falhas ? 1 : 0);
