// commands/fb.js — Facebook interactivo (👍 normal / ❤️ documento o 1/2) usando API NUEVA (tu scraper)
"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

// === Config API nueva ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || process.env.SKY_API_KEY || global.SKY_API_KEY || "Russellxz";

// Opcional si tu API lo soporta (docs)
const FB_COOKIE = process.env.FB_COOKIE || ""; // header: x-fb-cookie
const FB_UA     = process.env.FB_UA || "";     // header: x-fb-ua

const MAX_MB = Number(process.env.MAX_MB || 99);

// Jobs pendientes por ID del mensaje preview
const pendingFB = Object.create(null);

const mb = (n) => n / (1024 * 1024);

function isUrl(u = "") {
  return /^https?:\/\//i.test(String(u || ""));
}
function isFB(u = "") {
  u = String(u || "");
  return /(facebook\.com|fb\.watch)/i.test(u);
}
function normalizeUrl(input = "") {
  let u = String(input || "").trim().replace(/^<|>$/g, "").trim();
  if (/^(www\.)?facebook\.com\//i.test(u) || /^fb\.watch\//i.test(u)) {
    u = "https://" + u.replace(/^\/+/, "");
  }
  return u;
}
function safeFileName(name = "facebook") {
  const base = String(name || "facebook").slice(0, 70);
  return (base.replace(/[^A-Za-z0-9_\-.]+/g, "_") || "facebook");
}

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

// ✅ TU API: result.media.video_hd / result.media.video_sd
function pickBestVideoUrl(result) {
  const hd = String(result?.media?.video_hd || "").trim();
  const sd = String(result?.media?.video_sd || "").trim();

  if (hd && /^https?:\/\//i.test(hd)) return hd; // prioriza HD
  if (sd && /^https?:\/\//i.test(sd)) return sd;

  // Fallback por si algún día cambias formato
  const altHd = String(result?.video_hd || "").trim();
  const altSd = String(result?.video_sd || "").trim();
  if (altHd && /^https?:\/\//i.test(altHd)) return altHd;
  if (altSd && /^https?:\/\//i.test(altSd)) return altSd;

  return null;
}

// ✅ API NUEVA: POST /facebook  body: { url }
async function callSkyFacebook(url) {
  const endpoint = `${API_BASE}/facebook`;

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json,*/*",
    apikey: API_KEY,
  };
  if (FB_COOKIE) headers["x-fb-cookie"] = FB_COOKIE;
  if (FB_UA) headers["x-fb-ua"] = FB_UA;

  const r = await axios.post(endpoint, { url }, {
    headers,
    timeout: 60000,
    validateStatus: () => true,
  });

  let data = r.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data.trim()); }
    catch { throw new Error("Respuesta no JSON del servidor"); }
  }

  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${r.status}`);

  return data.result;
}

// ✅ descarga usando proxy nuevo: /facebook/dl?type=video&src=...&filename=...&download=1
async function downloadVideoToTmpFromProxy(srcUrl, filenameBase = "facebook") {
  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const base = safeFileName(filenameBase);
  const fname = `${base}.mp4`;

  const dlUrl =
    `${API_BASE}/facebook/dl` +
    `?type=video` +
    `&src=${encodeURIComponent(srcUrl)}` +
    `&filename=${encodeURIComponent(fname)}` +
    `&download=1`;

  const res = await axios.get(dlUrl, {
    responseType: "stream",
    timeout: 180000,
    headers: {
      apikey: API_KEY,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    maxRedirects: 5,
    validateStatus: (s) => s < 400,
  });

  const filePath = path.join(tmpDir, `fb-${Date.now()}-${Math.floor(Math.random() * 1e5)}.mp4`);

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filePath);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });

  return filePath;
}

async function sendVideo(conn, job, asDocument, triggerMsg) {
  const { chatId, url, title, previewKey, quotedBase } = job;

  try {
    // reacción en el mensaje que activó
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    // reacción “descargando” en el preview
    await react(conn, chatId, previewKey, "⏳");

    const filePath = await downloadVideoToTmpFromProxy(url, title || "facebook");

    const sizeMB = mb(fs.statSync(filePath).size);
    if (sizeMB > MAX_MB) {
      try { fs.unlinkSync(filePath); } catch {}
      await react(conn, chatId, previewKey, "❌");
      return conn.sendMessage(
        chatId,
        { text: `❌ Video ≈ ${sizeMB.toFixed(2)} MB — supera el límite de ${MAX_MB} MB.` },
        { quoted: quotedBase || triggerMsg }
      );
    }

    const buf = fs.readFileSync(filePath);

    await conn.sendMessage(
      chatId,
      {
        [asDocument ? "document" : "video"]: buf,
        mimetype: "video/mp4",
        fileName: `${safeFileName(title || "facebook")}.mp4`,
        caption: asDocument ? undefined : "✅ Facebook video listo",
      },
      { quoted: quotedBase || triggerMsg }
    );

    try { fs.unlinkSync(filePath); } catch {}

    await react(conn, chatId, previewKey, "✅");
    await react(conn, chatId, triggerMsg.key, "✅");
  } catch (e) {
    await react(conn, chatId, previewKey, "❌");
    await react(conn, chatId, triggerMsg.key, "❌");
    await conn.sendMessage(
      chatId,
      { text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: job.quotedBase || triggerMsg }
    );
  }
}

module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  let text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      { text: `✳️ Usa:\n${pref}${command} <enlace>\nEj: ${pref}${command} https://fb.watch/xxxxxx/` },
      { quoted: msg }
    );
  }

  text = normalizeUrl(text);

  if (!isUrl(text) || !isFB(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido.\nUsa: ${pref}${command} <url de Facebook/fb.watch>` },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const result = await callSkyFacebook(text);
    const videoUrl = pickBestVideoUrl(result);

    if (!videoUrl) {
      await react(conn, chatId, msg.key, "❌");
      return conn.sendMessage(chatId, { text: "🚫 No se encontró video descargable (privado/bloqueado)." }, { quoted: msg });
    }

    const title = result?.title || "Facebook Video";

    const caption =
`⚡ Facebook — opciones

👍 Enviar normal
❤️ Enviar como documento
— o responde: 1 = normal · 2 = documento`;

    const preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });

    pendingFB[preview.key.id] = {
      chatId,
      url: videoUrl,
      title,
      quotedBase: msg,
      previewKey: preview.key,
      createdAt: Date.now(),
      processing: false,
    };

    await react(conn, chatId, msg.key, "✅");

    if (!conn._fbInteractiveListener) {
      conn._fbInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // limpiar jobs viejos (15 min)
            for (const k of Object.keys(pendingFB)) {
              if (Date.now() - (pendingFB[k]?.createdAt || 0) > 15 * 60 * 1000) {
                delete pendingFB[k];
              }
            }

            // --- Reacciones (👍 / ❤️) al preview ---
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingFB[reactKey.id];
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;

              if (emoji !== "👍" && emoji !== "❤️") continue;

              if (job.processing) continue;
              job.processing = true;

              const asDoc = emoji === "❤️";
              await sendVideo(conn, job, asDoc, m);

              delete pendingFB[reactKey.id];
              continue;
            }

            // --- Replies 1/2 citando el preview ---
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            const body =
              (m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "").trim();

            if (replyTo && pendingFB[replyTo]) {
              const job = pendingFB[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              if (body !== "1" && body !== "2") continue;

              if (job.processing) continue;
              job.processing = true;

              const asDoc = body === "2";
              await sendVideo(conn, job, asDoc, m);

              delete pendingFB[replyTo];
            }
          } catch (e) {
            console.error("FB listener error:", e?.message || e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error FB:", err?.message || err);

    let msgTxt = "❌ Ocurrió un error al procesar el video de Facebook.";
    const s = String(err?.message || "");
    if (/api key|unauthorized|forbidden|401/i.test(s)) msgTxt = "🔐 API Key inválida o ausente.";
    else if (/timeout|timed out|502|upstream/i.test(s)) msgTxt = "⚠️ La upstream tardó demasiado o no respondió.";

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["facebook", "fb"];
module.exports.help = ["facebook <url>", "fb <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
