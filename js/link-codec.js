/* Projeto Amor — codificação do link da carta.
   ┌─────────────────────────────────────────────────────────────────┐
   │ O link carrega a carta inteira dentro do fragmento (#c=…).       │
   │ O formato antigo era:                                            │
   │                                                                 │
   │   foto → JPEG → data URL (base64) → JSON → base64 → link        │
   │                                                                 │
   │ ou seja, a imagem passava por base64 DUAS vezes: uma ao virar   │
   │ data URL e outra ao entrar no JSON que é codificado no link.    │
   │ Cada base64 custa 33% a mais que os bytes crus — dois passes,    │
   │ 25% do link jogados fora sem nenhuma ganho.                     │
   │ O formato novo (PA1) guarda os BYTES CRUS das imagens num       │
   │ contêiner binário e só então aplica base64, UMA vez. A foto      │
   │ deixa de ser re-codificada: o ganho é de 25% do link inteiro,    │
   │ sem tocar em um único pixel.                                     │
   │                                                                 │
   │ Compatibilidade: cartas antigas (base64 de JSON) continuam      │
   │ abrindo — o decodificador reconhece o formato pela assinatura.  │
   └─────────────────────────────────────────────────────────────────┘ */

(() => {
  "use strict";

  /* Assinatura e versão do contêiner binário. */
  const MAGIC   = [0x50, 0x41, 0x31];   /* "PA1" */
  const VERSION = 0x01;

  /* Campos de texto que viajam na parte JSON do contêiner.
     As fotos NÃO entram aqui: elas viram bytes no contêiner. */
  const TEXT_FIELDS = ["recipient", "message", "favorite", "story", "sender", "promises"];

  /* Códigos de MIME — 1 byte por imagem, em vez do nome inteiro. */
  const MIME_CODES = {
    "image/jpeg": 1, "image/webp": 2, "image/png": 3, "image/gif": 4, "image/avif": 5
  };
  const CODE_MIMES = {
    1: "image/jpeg", 2: "image/webp", 3: "image/png", 4: "image/gif", 5: "image/avif"
  };

  /* Dois alfabetos base64, e a diferença entre eles é importante:
       • B64_URL  → o LINK (fragmento da URL). Usa - e _ no lugar de
                    + e /, porque + e / são reinterpretados pela URL.
       • B64_STD  → as DATA URLs das fotos. Uma data URL é decodificada
                    com o alfabeto padrão (RFC 4648): um - no lugar de
                    um + faz a imagem não carregar — e o sintoma é
                    silencioso, a imagem simplesmente não aparece. */
  const B64_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  /* ── Base64, sem passar por string binária ──────────────────────── */

  function bytesToB64(bytes, alfabeto) {
    const B = alfabeto || B64_URL;
    const len = bytes.length;
    const parts = [];
    let chunk = "";
    for (let i = 0; i < len; i += 3) {
      const b0 = bytes[i];
      const tem1 = i + 1 < len;
      const tem2 = i + 2 < len;
      const b1 = tem1 ? bytes[i + 1] : 0;
      const b2 = tem2 ? bytes[i + 2] : 0;
      chunk += B[b0 >> 2];
      chunk += B[((b0 & 3) << 4) | (b1 >> 4)];
      if (tem1) chunk += B[((b1 & 15) << 2) | (b2 >> 6)];
      if (tem2) chunk += B[b2 & 63];
      /* Strings grandes viram ropes; quebrar em pedaços evita
         pressão de memória em links de centenas de KB. */
      if (chunk.length >= 32768) { parts.push(chunk); chunk = ""; }
    }
    if (chunk) parts.push(chunk);
    return parts.join("");
  }

  /* Lê base64 dos dois alfabetos: + e / são normalizados para - e _,
     que ocupam as mesmas posições na tabela. */
  function b64ToBytes(text) {
    const clean = String(text).replace(/[\s=]/g, "")
      .replace(/\+/g, "-").replace(/\//g, "_");
    if (!clean.length) return new Uint8Array(0);
    const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let o = 0;
    let i = 0;
    while (i < clean.length) {
      const c0 = B64_URL.indexOf(clean[i]);
      const c1 = i + 1 < clean.length ? B64_URL.indexOf(clean[i + 1]) : -1;
      const c2 = i + 2 < clean.length ? B64_URL.indexOf(clean[i + 2]) : -1;
      const c3 = i + 3 < clean.length ? B64_URL.indexOf(clean[i + 3]) : -1;
      if (c0 < 0 || c1 < 0) throw new Error("a carta não está em base64 válido");
      out[o++] = (c0 << 2) | (c1 >> 4);
      if (c2 >= 0) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
      if (c3 >= 0) out[o++] = ((c2 & 3) << 6) | c3;
      i += 4;
    }
    return out.subarray(0, o);
  }

  /* Quantos caracteres base64 URL-safe estes bytes ocupam. */
  function b64Len(byteLength) {
    const inteiros = Math.floor(byteLength / 3);
    const resto = byteLength % 3;
    return inteiros * 4 + (resto === 0 ? 0 : resto + 1);
  }

  /* ── UTF-8 (a carta pode ter emoji, acento, ideograma) ──────────── */
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const utf8 = text => encoder.encode(text);
  const fromUtf8 = bytes => decoder.decode(bytes);

  /* ── Data URL ⇄ bytes crus ──────────────────────────────────────── */
  const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?(;charset=[^;,]+)?(;base64)?,(.*)$/i;

  function toDataUrl(photo) {
    if (!photo || !photo.bytes || !photo.bytes.length) return null;
    const mime = photo.mime || "image/jpeg";
    /* Base64 PADRÃO aqui: uma data URL com - ou _ no lugar de + e /
       não é decodificada pelo navegador — a imagem simplesmente não
       aparece. */
    return `data:${mime};base64,${bytesToB64(photo.bytes, B64_STD)}`;
  }

  function fromDataUrl(dataUrl) {
    if (typeof dataUrl !== "string") return null;
    const m = dataUrl.trim().match(DATA_URL_RE);
    if (!m) return null;
    const mime = m[1] || "image/jpeg";
    const payload = m[4] || "";
    if (!m[3]) {
      /* Data URL sem base64 (percent-encoded): não é o formato do
         projeto, mas não deve derrubar a carta inteira. */
      return null;
    }
    return { mime, bytes: b64ToBytes(payload) };
  }

  /* Normaliza uma foto para { mime, bytes }.
     Aceita o formato novo (objeto) e o antigo (data URL em texto). */
  function normalizePhoto(photo) {
    if (!photo) return null;
    if (photo.bytes && photo.bytes.length) {
      return { mime: MIME_CODES[photo.mime] ? photo.mime : "image/jpeg", bytes: photo.bytes };
    }
    if (typeof photo === "string") return fromDataUrl(photo);
    return null;
  }

  /* ── Montagem do contêiner ──────────────────────────────────────── */

  /* Separa o que é texto do que é imagem e elimina fotos repetidas:
     a mesma foto escolhida em dois espaços é guardada uma vez só. */
  function collect(data) {
    const fotos = (Array.isArray(data && data.photos) ? data.photos : [])
      .map(normalizePhoto)
      .filter(Boolean);

    const blobs = [];
    const refs = [];
    for (const foto of fotos) {
      let idx = -1;
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        if (b.mime !== foto.mime || b.bytes.length !== foto.bytes.length) continue;
        let iguais = true;
        for (let k = 0; k < b.bytes.length; k++) {
          if (b.bytes[k] !== foto.bytes[k]) { iguais = false; break; }
        }
        if (iguais) { idx = i; break; }
      }
      if (idx < 0) { blobs.push({ mime: foto.mime, bytes: foto.bytes }); idx = blobs.length - 1; }
      refs.push(idx);
    }

    const text = {};
    for (const field of TEXT_FIELDS) {
      const value = data ? data[field] : undefined;
      if (value === undefined || value === null) continue;
      text[field] = value;
    }

    return { text, blobs, refs, textBytes: utf8(JSON.stringify(text)) };
  }

  function writeU32(out, offset, value) {
    out[offset]     = value & 0xff;
    out[offset + 1] = (value >>> 8) & 0xff;
    out[offset + 2] = (value >>> 16) & 0xff;
    out[offset + 3] = (value >>> 24) & 0xff;
  }

  function writeU16(out, offset, value) {
    out[offset]     = value & 0xff;
    out[offset + 1] = (value >>> 8) & 0xff;
  }

  function readU32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function readU16(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
  }

  /* Layout do contêiner PA1:
       "PA1"          assinatura (3 bytes)
       0x01          versão (1 byte)
       uint32        tamanho do texto
       bytes         texto (JSON UTF-8)
       uint32        número de imagens distintas
       por imagem:   uint8 MIME · uint32 tamanho · bytes
       uint16        número de fotos
       por foto:     uint16 índice da imagem                            */
  function buildContainer(data) {
    const { textBytes, blobs, refs } = collect(data);
    let size = 3 + 1 + 4 + textBytes.length + 4 + 2 + refs.length * 2;
    for (const blob of blobs) size += 1 + 4 + blob.bytes.length;

    const out = new Uint8Array(size);
    let o = 0;
    out[o++] = MAGIC[0]; out[o++] = MAGIC[1]; out[o++] = MAGIC[2];
    out[o++] = VERSION;

    writeU32(out, o, textBytes.length); o += 4;
    out.set(textBytes, o); o += textBytes.length;

    writeU32(out, o, blobs.length); o += 4;
    for (const blob of blobs) {
      out[o++] = MIME_CODES[blob.mime] || 3;
      writeU32(out, o, blob.bytes.length); o += 4;
      out.set(blob.bytes, o); o += blob.bytes.length;
    }

    writeU16(out, o, refs.length); o += 2;
    for (const ref of refs) { writeU16(out, o, ref); o += 2; }

    return out;
  }

  function decodeContainer(bytes) {
    if (bytes.length < 8) throw new Error("a carta chegou incompleta");
    const version = bytes[3];
    if (version !== VERSION) throw new Error(`formato de carta desconhecido (versão ${version})`);

    let o = 4;
    const textLen = readU32(bytes, o); o += 4;
    if (o + textLen > bytes.length) throw new Error("a carta chegou incompleta");

    let text;
    try {
      text = JSON.parse(fromUtf8(bytes.subarray(o, o + textLen)));
    } catch (_) {
      throw new Error("o texto da carta está corrompido");
    }
    o += textLen;

    const blobCount = readU32(bytes, o); o += 4;
    const blobs = [];
    for (let i = 0; i < blobCount; i++) {
      if (o + 5 > bytes.length) throw new Error("a carta chegou incompleta");
      const code = bytes[o++];
      const len = readU32(bytes, o); o += 4;
      if (o + len > bytes.length) throw new Error("a carta chegou incompleta");
      blobs.push({ mime: CODE_MIMES[code] || "image/jpeg", bytes: bytes.subarray(o, o + len) });
      o += len;
    }

    if (o + 2 > bytes.length) throw new Error("a carta chegou incompleta");
    const photoCount = readU16(bytes, o); o += 2;
    const photos = [];
    for (let i = 0; i < photoCount; i++) {
      if (o + 2 > bytes.length) throw new Error("a carta chegou incompleta");
      const index = readU16(bytes, o); o += 2;
      const blob = blobs[index];
      if (!blob) throw new Error("a carta aponta para uma foto que não existe");
      photos.push(toDataUrl(blob));
    }

    text.photos = photos;
    return text;
  }

  /* ── Formato antigo (base64 de JSON) — só para ler e comparar ───── */

  function legacyEncode(data) {
    return bytesToB64(utf8(JSON.stringify(data)));
  }

  function legacyDecode(encoded) {
    return JSON.parse(fromUtf8(b64ToBytes(encoded)));
  }

  /* ── API pública ────────────────────────────────────────────────── */

  function encode(data) {
    return bytesToB64(buildContainer(data || {}));
  }

  function decode(encoded) {
    if (typeof encoded !== "string" || !encoded.trim()) {
      throw new Error("não há carta neste link");
    }
    const bytes = b64ToBytes(encoded);
    if (!bytes.length) throw new Error("não há carta neste link");
    if (bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2]) {
      return decodeContainer(bytes);
    }
    /* Formato antigo: base64 de JSON. */
    return legacyDecode(encoded);
  }

  /* Tamanho EXATO do link gerado por encode() para estas données. */
  function estimate(data) {
    const { textBytes, blobs, refs } = collect(data || {});
    let size = 3 + 1 + 4 + textBytes.length + 4 + 2 + refs.length * 2;
    for (const blob of blobs) size += 1 + 4 + blob.bytes.length;
    return b64Len(size);
  }

  const api = {
    encode,
    decode,
    estimate,
    toDataUrl,
    fromDataUrl,
    legacyEncode,
    legacyDecode,
    b64Len,
    FORMAT: "PA1",
    VERSION
  };

  if (typeof window !== "undefined") window.ProjetoAmorLink = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
