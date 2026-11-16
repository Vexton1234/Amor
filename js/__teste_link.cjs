/* Harness headless para js/link-codec.js.
   Não substitui abrir a carta de verdade — verifica as INVARIANTES do
   link, que é a parte do projeto que a pessoa leva consigo:

   • ida e volta sem perder nada (texto, promessas, fotos)
   • cartas do formato ANTIGO continuam abrindo
   • o link novo é MENOR que o antigo, com as mesmas fotos
   • texto Unicode (emoji, acento, ideograma) sobrevive
   • as fotos voltam como data URL, com o MIME certo
   • a mesma foto escolhida duas vezes é guardada uma vez só
   • link corrompido ou vazio falha com erro limpo
   • o tamanho mostrado no editor é o tamanho real
   • o link só usa caracteres seguros de URL                       */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "link-codec.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

/* O módulo roda dentro de um contexto vm: os Errors dele são de outro
   realm e `instanceof Error` dá falso. O que importa é que a falha
   seja uma exceção com mensagem. */
const isErro = e => !!e && typeof e.message === "string" && e.message.length > 0;

/* ══════════════════════════════════════════════════════════════════
   AMBIENTE
   ══════════════════════════════════════════════════════════════════ */
function carregar() {
  const win = {};
  const sandbox = {
    window: win, console, TextEncoder, TextDecoder, Uint8Array, JSON, Math, Date
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), sandbox, { filename: "link-codec.js" });
  return win.ProjetoAmorLink;
}

/* Bytes determinísticos, com cara de JPEG (não aleatório de verdade:
   o teste precisa ser reprodutível). */
function bytesFalsos(n, seed = 1) {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out[i] = s & 0xff;
  }
  return out;
}

const foto = (n, seed, mime = "image/jpeg") => ({ mime, bytes: bytesFalsos(n, seed) });

const TEXTO = {
  recipient: "Meu amor",
  message: "Existem sentimentos que merecem mais do que uma mensagem.",
  favorite: "Café e chuva na janela",
  story: "A gente se conheceu num dia de chuva.",
  sender: "Eu",
  promises: ["Sempre", "Pra sempre", "Pra sempre e mais um pouco"]
};

/* ══════════════════════════════════════════════════════════════════
   CASOS
   ══════════════════════════════════════════════════════════════════ */
const cases = [];

cases.push({
  name: "ida e volta: nada se perde no caminho",
  run() {
    const codec = carregar();
    const original = { ...TEXTO, photos: [foto(12000, 3), foto(9000, 7, "image/webp")] };
    const carta = codec.decode(codec.encode(original));

    assert(carta.recipient === original.recipient, "o destinatário mudou");
    assert(carta.message === original.message, "a mensagem mudou");
    assert(carta.favorite === original.favorite, "o favorito mudou");
    assert(carta.story === original.story, "a história mudou");
    assert(carta.sender === original.sender, "o remetente mudou");
    assert(Array.isArray(carta.promises) && carta.promises.length === 3, "as promessas se perderam");
    assert(carta.promises[2] === original.promises[2], "a promessa mudou de texto");
    assert(Array.isArray(carta.photos) && carta.photos.length === 2, "as fotos se perderam");
    return `texto e ${carta.photos.length} fotos intactos`;
  }
});

cases.push({
  name: "as fotos voltam como data URL, com o MIME certo",
  run() {
    const codec = carregar();
    const carta = codec.decode(codec.encode({ ...TEXTO, photos: [foto(5000, 1), foto(5000, 2, "image/webp")] }));

    assert(carta.photos[0].startsWith("data:image/jpeg;base64,"), `a primeira foto não é JPEG: ${carta.photos[0].slice(0, 30)}`);
    assert(carta.photos[1].startsWith("data:image/webp;base64,"), `a segunda foto não é WebP: ${carta.photos[1].slice(0, 30)}`);
    /* O conteúdo tem que ser exatamente o que foi guardado. */
    const original = codec.fromDataUrl(carta.photos[0]);
    assert(original.bytes.length === 5000, `a foto voltou com ${original.bytes.length} bytes, e não 5000`);
    let iguais = true;
    for (let i = 0; i < 5000; i++) if (original.bytes[i] !== bytesFalsos(5000, 1)[i]) { iguais = false; break; }
    assert(iguais, "os bytes da foto voltaram diferentes");
    return "JPEG e WebP reconhecidos, bytes idênticos";
  }
});

cases.push({
  name: "cartas do formato antigo continuam abrindo",
  run() {
    const codec = carregar();
    /* Exatamente como a versão anterior do site gravava: base64 de JSON,
       com as fotos como data URL dentro do texto. */
    const antiga = {
      ...TEXTO,
      photos: ["data:image/jpeg;base64," + Buffer.from(bytesFalsos(8000, 9)).toString("base64")]
    };
    const link = codec.legacyEncode(antiga);
    const carta = codec.decode(link);

    assert(carta.recipient === antiga.recipient, "o destinatário da carta antiga mudou");
    assert(carta.photos.length === 1, "a foto da carta antiga se perdeu");
    assert(carta.photos[0] === antiga.photos[0], "a foto da carta antiga voltou diferente");
    return `carta de ${link.length} chars aberta sem complained`;
  }
});

cases.push({
  name: "o link novo é menor que o antigo, com as mesmas fotos",
  run() {
    const codec = carregar();
    const fotos = [foto(40000, 1), foto(40000, 2), foto(40000, 3), foto(40000, 4), foto(40000,  5), foto(40000, 6)];
    const antigo = codec.legacyEncode({
      ...TEXTO,
      photos: fotos.map(f => `data:${f.mime};base64,` + Buffer.from(f.bytes).toString("base64"))
    });
    const novo = codec.encode({ ...TEXTO, photos: fotos });

    const ganho = (1 - novo.length / antigo.length) * 100;
    assert(ganho >= 20, `o link novo só ficou ${ganho.toFixed(1)}% menor — o base64 duplicado continua lá`);
    return `${antigo.length} → ${novo.length} chars (${ganho.toFixed(1)}% menor)`;
  }
});

cases.push({
  name: "a mesma foto em dois espaços é guardada uma vez só",
  run() {
    const codec = carregar();
    const mesma = foto(30000, 42);
    const comDuplicata = codec.encode({ ...TEXTO, photos: [mesma, mesma, mesma] });
    const comTresDiferentes = codec.encode({ ...TEXTO, photos: [foto(30000, 42), foto(30000, 43), foto(30000, 44)] });

    const ganho = (1 - comDuplicata.length / comTresDiferentes.length) * 100;
    assert(ganho >= 30,
      `a foto repetida ainda ocupa espaço: ${comDuplicata.length} contra ${comTresDiferentes.length} chars`);

    const carta = codec.decode(comDuplicata);
    assert(carta.photos.length === 3, `as três fotos deveriam voltar, voltaram ${carta.photos.length}`);
    assert(carta.photos[0] === carta.photos[1] && carta.photos[1] === carta.photos[2],
      "as fotos repetidas voltaram diferentes");
    return `3 fotos iguais: ${comDuplicata.length} chars contra ${comTresDiferentes.length} de 3 diferentes (${ganho.toFixed(0)}% menos)`;
  }
});

cases.push({
  name: "texto Unicode sobrevive (emoji, acento, ideograma)",
  run() {
    const codec = carregar();
    const duro = {
      recipient: "Amor 💘",
      message: "Você é a minha luz ✨ — com todo o amor do mundo",
      favorite: "Chá de hortelã e luar 🌙",
      story: "anji 日本語 · ñandú · ÆØÅ",
      sender: "ღ",
      promises: ["Sempre ❤️", "Pra sempre ✨"]
    };
    const carta = codec.decode(codec.encode(duro));
    for (const campo of ["recipient", "message", "favorite", "story", "sender"]) {
      assert(carta[campo] === duro[campo], `o campo ${campo} voltou diferente: "${carta[campo]}"`);
    }
    assert(carta.promises[0] === duro.promises[0], "a promessa com emoji voltou diferente");
    return "emoji, acento e ideograma preservados";
  }
});

cases.push({
  name: "o tamanho mostrado no editor é o tamanho real",
  run() {
    const codec = carregar();
    const carta = { ...TEXTO, photos: [foto(20000, 1), foto(15000, 2, "image/webp")] };
    const estimado = codec.estimate(carta);
    const real = codec.encode(carta).length;
    assert(estimado === real, `a estimativa errou: ${estimado} contra ${real} caracteres reais`);
    return `${real} chars estimados = ${real} chars reais`;
  }
});

cases.push({
  name: "o link só usa caracteres que a URL aguenta",
  run() {
    const codec = carregar();
    const link = codec.encode({ ...TEXTO, photos: [foto(2000, 1), foto(2000, 2)] });
    const proibidos = link.match(/[^A-Za-z0-9\-_]/g);
    assert(!proibidos, `o link tem ${proibidos ? proibidos.length : 0} caractere(s) fora do alfabeto base64 URL-safe`);
    assert(!link.includes("="), "o link tem preenchimento de base64");
    return `${link.length} chars, todos seguros`;
  }
});

cases.push({
  name: "a data URL usa base64 padrão (e a imagem carrega)",
  run() {
    const codec = carregar();
    /* Estes bytes exigem "+" e "/" no base64 padrão (e "-" e "_" no
       URL-safe). A diferença não é cosmética: uma data URL com - ou _
       no lugar de + ou / NÃO é decodificada pelo navegador — a
       imagem simplesmente não aparece. */
    const bytes = new Uint8Array([0xfb, 0xef, 0xbe, 0xff, 0xef, 0xbf]);
    const url = codec.toDataUrl({ mime: "image/jpeg", bytes });
    const corpo = url.slice(url.indexOf(",") + 1);

    assert(!corpo.includes("-") && !corpo.includes("_"),
      `a data URL usa o alfabeto URL-safe: ${corpo.slice(0, 24)} — o navegador não decodifica isso`);
    assert(/^[A-Za-z0-9+/]+$/.test(corpo),
      `a data URL tem caractere fora do base64 padrão: ${corpo.slice(0, 24)}`);

    /* E a volta precisa devolver exatamente os mesmos bytes. */
    const volta = codec.fromDataUrl(url);
    assert(volta.bytes.length === bytes.length, "a data URL perdeu bytes na volta");
    for (let i = 0; i < bytes.length; i++) {
      assert(volta.bytes[i] === bytes[i], `o byte ${i} voltou errado`);
    }
    return `base64 padrão conferido (${corpo.slice(0, 12)}…)`;
  }
});

cases.push({
  name: "link corrompido falha com erro limpo",
  run() {
    const codec = carregar();
    const link = codec.encode({ ...TEXTO, photos: [foto(3000, 1)] });
    const corrompido = link.slice(0, 40) + "!!!!" + link.slice(44);

    let erro = null;
    try { codec.decode(corrompido); } catch (e) { erro = e; }
    assert(isErro(erro), "um link corrompido não deu erro nenhum");
    return `erro claro: "${erro.message}"`;
  }
});

cases.push({
  name: "link vazio ou sem carta falha com erro limpo",
  run() {
    const codec = carregar();
    for (const entrada of ["", "   ", null, undefined, "%%%"]) {
      let erro = null;
      try { codec.decode(entrada); } catch (e) { erro = e; }
      assert(isErro(erro), `"${entrada}" deveria ter dado erro`);
    }
    return "todas as entradas vazias recusadas com erro";
  }
});

cases.push({
  name: "a assinatura do formato novo é reconhecível",
  run() {
    const codec = carregar();
    const link = codec.encode({ ...TEXTO });
    const bytes = codec.fromDataUrl(`data:application/octet-stream;base64,${link}`).bytes;
    assert(bytes[0] === 0x50 && bytes[1] === 0x41 && bytes[2] === 0x31,
      `a assinatura não é PA1: ${bytes[0]},${bytes[1]},${bytes[2]}`);
    assert(bytes[3] === codec.VERSION, `a versão não é ${codec.VERSION}`);
    return "PA1 v1 no começo do contêiner";
  }
});

cases.push({
  name: "uma carta sem fotos continua funcionando",
  run() {
    const codec = carregar();
    const carta = codec.decode(codec.encode({ ...TEXTO, photos: [] }));
    assert(carta.recipient === TEXTO.recipient, "a carta sem foto perdeu o destinatário");
    assert(Array.isArray(carta.photos) && carta.photos.length === 0, "a carta sem foto ganhou fotos");
    return "carta de texto pura, sem fotos";
  }
});

cases.push({
  name: "data URL ⇄ bytes: a ponte usada pelo editor",
  run() {
    const codec = carregar();
    const bytes = bytesFalsos(2000, 5);
    const url = codec.toDataUrl({ mime: "image/webp", bytes });
    assert(url.startsWith("data:image/webp;base64,"), "a data URL ficou com o MIME errado");
    const volta = codec.fromDataUrl(url);
    assert(volta.bytes.length === bytes.length, "a data URL perdeu bytes na volta");
    assert(volta.mime === "image/webp", "a data URL perdeu o MIME na volta");
    return "ida e volta sem perda";
  }
});

/* ══════════════════════════════════════════════════════════════════
   EXECUÇÃO
   ══════════════════════════════════════════════════════════════════ */
(async () => {
  let failed = 0;
  for (const c of cases) {
    try {
      const r = await c.run();
      console.log(`  OK   ${c.name}${r ? " — " + r : ""}`);
    } catch (e) {
      failed++;
      console.log(`  FALHA ${c.name} — ${e.message}`);
    }
  }
  console.log(failed ? `\n${failed} caso(s) falharam` : "\nTodos os casos passaram");
  process.exit(failed ? 1 : 0);
})();
