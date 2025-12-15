// ig.js — Instagram (👍 video / ❤️ documento o 1 / 2) — API NUEVA + fallback imagen
"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = (process.env.API_BASE || "https://api-sky-test.ultraplus.click").replace(/\/+$/, "");
const SKY_API_KEY = process.env.API_KEY || "Russellxz";
const MAX_MB = Number(process.env.MAX_MB || 99);

const pendingIG = Object.create(null);

const mb = (n) => n / (1024 * 1024);

function isIG(u = "") {
  return /(instagram\.com|instagr\.am)/i.test(String(u || ""));
}

function isUrl(u = "") {
  return /^https?:\/\//i.test(String(u || ""));
}

function isImageUrl(u = "") {
  u = String(u || "");
  return isUrl(u) && /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u);
}

function normalizeIGUrl(input = "") {
  let u = String(input || "").trim();
  u = u.replace(/^<|>$/g, "").trim(); // por si lo pegan con < >

  // si viene sin protocolo, pon https
  if (/^(www\.)?instagram\.com\//i.test(u) || /^instagr\.am\//i.test(u)) {
    u = "https://" + u.replace(/^\/+/, "");
  }
  return u;
}

function safeFileName(name = "instagram") {
  return (
    String(name || "instagram")
      .slice(0, 70)
      .replace(/[^A-Za-z0-9_\-.]+/g, "_") || "instagram"
  );
}

// ✅ LLAMADA API NUEVA (POST /instagram)
async function callSkyInstagram(url) {
  const endpoint = `${API_BASE}/instagram`;

  const r = await axios.post(
    endpoint,
    { url },
    {
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json,*/*",
        apikey: SKY_API_KEY,
      },
      validateStatus: () => true,
    }
  );

  let data = r.data;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data.trim());
    } catch {
      throw new Error("Respuesta no JSON del servidor");
    }
  }

  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${r.status}`);

  return data.result;
}

function extractItems(result) {
  const items = result?.media?.items;
  return Array.isArray(items) ? items : [];
}

function pickFirstVideo(items) {
  let v = items.find((it) => String(it?.type || "").toLowerCase() === "video" && it?.url);
  if (v) return { type: "video", url: String(v.url) };

  v = items.find((it) => /\.mp4(\?|#|$)/i.test(String(it?.url || "")));
  if (v?.url) return { type: "video", url: String(v.url) };

  return null;
}

function pickFirstImage(items) {
  let im = items.find((it) => String(it?.type || "").toLowerCase() === "image" && it?.url);
  if (im) return { type: "image", url: String(im.url) };

  im = items.find((it) => /(\.jpg|\.jpeg|\.png|\.webp)(\?|#|$)/i.test(String(it?.url || "")));
  if (im?.url) return { type: "image", url: String(im.url) };

  return null;
}

// ✅ descargar usando /instagram/dl (con apikey)
async function downloadToTmpFromProxy(type, srcUrl, filenameBase = "instagram") {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  const base = safeFileName(filenameBase);
  const ext = type === "video" ? "mp4" : type === "image" ? "jpg" : "bin";
  const fname = `${base}.${ext}`;

  const dlUrl =
    `${API_BASE}/instagram/dl` +
    `?type=${encodeURIComponent(type)}` +
    `&src=${encodeURIComponent(srcUrl)}` +
    `&filename=${encodeURIComponent(fname)}` +
    `&download=1`;

  const res = await axios.get(dlUrl, {
    responseType: "stream",
    timeout: 180000,
    headers: {
      apikey: SKY_API_KEY,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    maxRedirects: 5,
    validateStatus: (s) => s < 400,
  });

  const filePath = path.join(
    tmp,
    `ig-${Date.now()}-${Math.floor(Math.random() * 1e5)}.${ext}`
  );

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filePath);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });

  return filePath;
}

async function sendMedia(conn, chatId, filePath, mediaType, asDocument, quoted) {
  const sizeMB = mb(fs.statSync(filePath).size);

  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(filePath); } catch {}
    return conn.sendMessage(
      chatId,
      { text: `❌ Media ≈ ${sizeMB.toFixed(2)} MB — supera el límite de ${MAX_MB} MB.` },
      { quoted }
    );
  }

  const buf = fs.readFileSync(filePath);

  // video
  if (mediaType === "video") {
    await conn.sendMessage(
      chatId,
      {
        [asDocument ? "document" : "video"]: buf,
        mimetype: "video/mp4",
        fileName: `instagram-${Date.now()}.mp4`,
        caption: asDocument ? undefined : "✅ Instagram video listo",
      },
      { quoted }
    );
  }
  // image
  else if (mediaType === "image") {
    if (asDocument) {
      await conn.sendMessage(
        chatId,
        {
          document: buf,
          mimetype: "image/jpeg",
          fileName: `instagram-${Date.now()}.jpg`,
        },
        { quoted }
      );
    } else {
      await conn.sendMessage(
        chatId,
        {
          image: buf,
        },
        { quoted }
      );
    }
  } else {
    // file genérico
    await conn.sendMessage(
      chatId,
      {
        document: buf,
        mimetype: "application/octet-stream",
        fileName: `instagram-${Date.now()}.bin`,
      },
      { quoted }
    );
  }

  try { fs.unlinkSync(filePath); } catch {}
}

async function setReaction(conn, chatId, key, emoji) {
  try {
    await conn.sendMessage(chatId, { react: { text: emoji, key } });
  } catch {}
}

module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  let text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
        text:
`✳️ Usa:
${pref}${command} <enlace IG o imagen directa>
Ej:
${pref}${command} https://www.instagram.com/reel/XXXX/
${pref}${command} https://.../imagen.jpg`,
      },
      { quoted: msg }
    );
  }

  // ✅ si es imagen directa, mandar imagen directo (sin API)
  if (isImageUrl(text)) {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    try {
      // usamos proxy IG como "file"? mejor directo con axios normal:
      const r = await axios.get(text, {
        responseType: "arraybuffer",
        timeout: 120000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "image/*,*/*",
        },
        validateStatus: () => true,
      });

      if (r.status >= 400) throw new Error(`HTTP ${r.status}`);

      await conn.sendMessage(chatId, { image: Buffer.from(r.data) }, { quoted: msg });
      await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
      return;
    } catch (e) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, { text: `❌ Error: ${e?.message || "unknown"}` }, { quoted: msg });
    }
  }

  // IG normal
  text = normalizeIGUrl(text);

  if (!isIG(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido.\nUsa: ${pref}${command} <url>` },
      { quoted: msg }
    );
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    const result = await callSkyInstagram(text);
    const items = extractItems(result);

    // ✅ prioridad: video -> si no, imagen
    const chosen = pickFirstVideo(items) || pickFirstImage(items);

    if (!chosen) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        { text: "🚫 No se encontró video ni imagen descargable en ese enlace." },
        { quoted: msg }
      );
    }

    const txt =
`⚡ Instagram — opciones

👍 Enviar normal
❤️ Enviar como documento
— o responde: 1 = normal · 2 = documento

📌 Detectado: ${chosen.type.toUpperCase()}`;

    const preview = await conn.sendMessage(chatId, { text: txt }, { quoted: msg });

    pendingIG[preview.key.id] = {
      chatId,
      url: chosen.url,
      type: chosen.type,     // 'video' o 'image'
      quotedBase: msg,
      previewKey: preview.key,
      createdAt: Date.now(),
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    if (!conn._igListener) {
      conn._igListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // limpiar jobs viejos (15 min)
            for (const k of Object.keys(pendingIG)) {
              if (Date.now() - (pendingIG[k]?.createdAt || 0) > 15 * 60 * 1000) {
                delete pendingIG[k];
              }
            }

            // -------- REACCIONES --------
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingIG[reactKey.id];
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;

              const asDoc = emoji === "❤️";

              // 👇 reacción de “descargando”
              await setReaction(conn, job.chatId, job.previewKey, "⏳");

              // descarga + envío
              const filePath =
                job.type === "video"
                  ? await downloadToTmpFromProxy("video", job.url, "instagram")
                  : await downloadToTmpFromProxy("image", job.url, "instagram");

              await sendMedia(conn, job.chatId, filePath, job.type, asDoc, job.quotedBase);

              // ✅ terminado
              await setReaction(conn, job.chatId, job.previewKey, "✅");

              delete pendingIG[reactKey.id];
              continue;
            }

            // -------- RESPUESTAS 1/2 --------
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            const body =
              (m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "").trim();

            if (replyTo && pendingIG[replyTo]) {
              const job = pendingIG[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              if (body === "1" || body === "2") {
                const asDoc = body === "2";

                // 👇 reacción de “descargando”
                await setReaction(conn, job.chatId, job.previewKey, "⏳");

                const filePath =
                  job.type === "video"
                    ? await downloadToTmpFromProxy("video", job.url, "instagram")
                    : await downloadToTmpFromProxy("image", job.url, "instagram");

                await sendMedia(conn, job.chatId, filePath, job.type, asDoc, job.quotedBase);

                // ✅ terminado
                await setReaction(conn, job.chatId, job.previewKey, "✅");

                delete pendingIG[replyTo];
              } else {
                await conn.sendMessage(
                  job.chatId,
                  { text: "⚠️ Responde con *1* (normal) o *2* (documento), o reacciona con 👍 / ❤️." },
                  { quoted: job.quotedBase }
                );
              }
            }
          } catch (e) {
            console.error("IG listener error:", e?.message || e);
          }
        }
      });
    }
  } catch (err) {
    const s = String(err?.message || "");
    console.error("❌ IG error:", s);

    let msgTxt = "❌ Error al procesar el enlace.";
    if (/enlace no válido|no válido|invalid/i.test(s)) msgTxt = "❌ Enlace no válido (usa link completo con https://).";
    else if (/no se encontraron medios|no se encontraron|no_media/i.test(s)) msgTxt = "🚫 No se encontraron medios en ese link.";
    else if (/401|api key|unauthorized|forbidden/i.test(s)) msgTxt = "🔐 API Key inválida o ausente.";
    else if (/timeout|timed out|502|upstream/i.test(s)) msgTxt = "⚠️ La upstream tardó demasiado o no respondió.";

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

module.exports.command = ["instagram", "ig"];
module.exports.help = ["instagram <url>", "ig <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
