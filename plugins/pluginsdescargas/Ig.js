
// ig.js — Instagram con opciones (👍 video / ❤️ documento o 1 / 2)
// ✅ API NUEVA: POST /instagram  +  GET /instagram/dl
"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = (process.env.API_BASE || "https://api-sky-test.ultraplus.click").replace(/\/+$/, "");
const SKY_API_KEY = process.env.API_KEY || "Russellxz";
const MAX_MB = 99; // WhatsApp recomendado

const pendingIG = Object.create(null);

const isIG = (u = "") => /(instagram\.com|instagr\.am)/i.test(u);
const mb = (n) => n / (1024 * 1024);

function extFromCT(ct = "", def = "bin") {
  const c = String(ct || "").toLowerCase();
  if (c.includes("mp4")) return "mp4";
  if (c.includes("jpeg")) return "jpg";
  if (c.includes("jpg")) return "jpg";
  if (c.includes("png")) return "png";
  if (c.includes("webp")) return "webp";
  return def;
}

function safeFileName(name = "instagram") {
  return String(name || "instagram")
    .slice(0, 70)
    .replace(/[^A-Za-z0-9_\-.]+/g, "_") || "instagram";
}

// ✅ Normaliza media venga como venga
function normalizeMediaList(result) {
  const r = result || {};
  const media =
    r.media ||
    r.medias ||
    r.items ||
    r.results ||
    r.data?.media ||
    r.result?.media ||
    [];

  if (!Array.isArray(media)) return [];

  return media
    .map((it) => {
      if (!it) return null;

      // si viene string directo
      if (typeof it === "string") {
        return { type: "video", url: it };
      }

      const type = String(it.type || it.kind || it.media_type || "").toLowerCase();
      const url =
        it.url ||
        it.downloadUrl ||
        it.download_url ||
        it.link ||
        it.src ||
        it.media ||
        it.video ||
        it.image ||
        "";

      if (!url) return null;

      // adivina tipo si no viene
      let t = type;
      if (!t) {
        t = /\.mp4(\?|#|$)/i.test(url) ? "video" : "image";
      }

      return { type: t, url: String(url) };
    })
    .filter(Boolean);
}

// ✅ Llama a API nueva
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
        // Authorization: `Bearer ${SKY_API_KEY}`, // si prefieres bearer
      },
      validateStatus: () => true,
    }
  );

  let data = r.data;

  // por si viene texto
  if (typeof data === "string") {
    try { data = JSON.parse(data.trim()); }
    catch { throw new Error("Respuesta no JSON del servidor"); }
  }

  if (!data || typeof data !== "object") throw new Error("Respuesta no JSON del servidor");

  const ok =
    data.status === true ||
    data.status === "true" ||
    data.ok === true ||
    data.success === true;

  if (!ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);

  return data.result || data.data || data;
}

// ✅ descarga usando el proxy /instagram/dl (mejor que ir directo al CDN)
async function downloadToTmpFromProxy(type, srcUrl, filenameBase = "instagram") {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  const fname = safeFileName(filenameBase) + (type === "video" ? ".mp4" : ".jpg");

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

  const ext = extFromCT(res.headers["content-type"], type === "video" ? "mp4" : "jpg");
  const filePath = path.join(tmp, `ig-${Date.now()}-${Math.floor(Math.random() * 1e5)}.${ext}`);

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filePath);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });

  return { path: filePath, mime: res.headers["content-type"] || "application/octet-stream" };
}

async function sendVideo(conn, chatId, filePath, asDocument, quoted, extraCaption = "") {
  const sizeMB = mb(fs.statSync(filePath).size);
  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(filePath); } catch {}
    return conn.sendMessage(
      chatId,
      { text: `❌ Video ≈ ${sizeMB.toFixed(2)} MB — supera el límite de ${MAX_MB} MB.` },
      { quoted }
    );
  }

  const caption =
`⚡ Instagram — listo
✦ Source: api-sky-test.ultraplus.click
${extraCaption || ""}`.trim();

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "video"]: fs.readFileSync(filePath),
      mimetype: "video/mp4",
      fileName: `instagram-${Date.now()}.mp4`,
      caption: asDocument ? undefined : caption,
    },
    { quoted }
  );

  try { fs.unlinkSync(filePath); } catch {}
}

module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text = (args.join(" ") || "").trim();
  const pref = global.prefixes?.[0] || ".";

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
        text:
`✳️ Usa:
${pref}${command} <enlace IG>
Ej: ${pref}${command} https://www.instagram.com/reel/DPO9MwWjjY_/`
      },
      { quoted: msg }
    );
  }

  if (!isIG(text)) {
    return conn.sendMessage(
      chatId,
      {
        text:
`❌ Enlace IG inválido.

✳️ Usa:
${pref}${command} <enlace IG>`
      },
      { quoted: msg }
    );
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    // 1) API nueva
    const result = await callSkyInstagram(text);
    const mediaList = normalizeMediaList(result);

    const firstVideo =
      mediaList.find((it) => String(it.type).includes("video")) ||
      mediaList.find((it) => /\.mp4(\?|#|$)/i.test(it.url)) ||
      null;

    if (!firstVideo) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        { text: "🚫 Ese enlace no tiene video descargable." },
        { quoted: msg }
      );
    }

    // 2) opciones
    const author =
      result.author ||
      result.username ||
      result.user?.username ||
      result.creator?.username ||
      "";

    const txt =
`⚡ Instagram — opciones

Elige cómo enviarlo:
👍 Video (normal)
❤️ Video como documento
— o responde: 1 = video · 2 = documento

✦ Autor: ${author ? "@" + author : "desconocido"}
✦ Source: api-sky-test.ultraplus.click
────────────
🤖 Suki Bot`;

    const preview = await conn.sendMessage(chatId, { text: txt }, { quoted: msg });

    pendingIG[preview.key.id] = {
      chatId,
      srcUrl: firstVideo.url,
      quotedBase: msg,
      nameBase: "instagram",
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    if (!conn._igListener) {
      conn._igListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingIG[reactKey.id];
              if (job) {
                const asDoc = emoji === "❤️";
                await conn.sendMessage(job.chatId, { react: { text: asDoc ? "📁" : "🎬", key: m.key } });
                await conn.sendMessage(job.chatId, { text: `⏳ Descargando…` }, { quoted: job.quotedBase });

                const { path: fpath } = await downloadToTmpFromProxy("video", job.srcUrl, job.nameBase);
                await sendVideo(conn, job.chatId, fpath, asDoc, job.quotedBase);

                delete pendingIG[reactKey.id];
              }
            }

            // RESPUESTA 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            const textLow =
              (m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "").trim().toLowerCase();

            if (replyTo && pendingIG[replyTo]) {
              const job = pendingIG[replyTo];

              if (textLow === "1" || textLow === "2") {
                const asDoc = textLow === "2";
                await conn.sendMessage(job.chatId, { react: { text: asDoc ? "📁" : "🎬", key: m.key } });
                await conn.sendMessage(job.chatId, { text: `⏳ Descargando…` }, { quoted: job.quotedBase });

                const { path: fpath } = await downloadToTmpFromProxy("video", job.srcUrl, job.nameBase);
                await sendVideo(conn, job.chatId, fpath, asDoc, job.quotedBase);

                delete pendingIG[replyTo];
              } else {
                await conn.sendMessage(
                  job.chatId,
                  { text: "⚠️ Responde con *1* (video) o *2* (documento), o reacciona con 👍 / ❤️." },
                  { quoted: job.quotedBase }
                );
              }
            }
          } catch (e) {
            console.error("IG listener error:", e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error IG:", err?.message || err);

    let msgTxt = "❌ Error al procesar el enlace.";
    const s = String(err?.message || "");

    if (/invalid|falt|missing/i.test(s)) msgTxt = "❌ URL inválida o faltante.";
    else if (/no_media|no_video/i.test(s)) msgTxt = "🚫 No se encontró un video descargable en ese enlace.";
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
