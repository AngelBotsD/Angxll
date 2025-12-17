
// commands/twitter.js — Twitter/X interactivo (👍 normal / ❤️ documento o 1/2)
// - PREVIEW por buffer (evita 401 de Baileys al usar URL directo)
// - Descarga final por buffer
// - En el resultado final muestra tu API (publicidad), no el link del tweet
"use strict";

const axios = require("axios");

// === Config API (tu API) ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";

// ✅ si tu endpoint cambia, lo puedes setear por env sin tocar el archivo
const ENDPOINT = (process.env.TWITTER_ENDPOINT || `${API_BASE}/twitter`).replace(/\/+$/, "");

const PUBLIC_API_URL = process.env.PUBLIC_API_URL || API_BASE;

const MAX_TIMEOUT = 45000;
const UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

// Jobs pendientes por ID del mensaje preview
const pendingTW = Object.create(null);

function cleanOldJobs() {
  const now = Date.now();
  for (const k of Object.keys(pendingTW)) {
    if (now - (pendingTW[k]?.createdAt || 0) > 15 * 60 * 1000) delete pendingTW[k];
  }
}

async function react(conn, chatId, key, emoji) {
  try {
    await conn.sendMessage(chatId, { react: { text: emoji, key } });
  } catch {}
}

function normXUrl(u = "") {
  const url = String(u || "").trim();
  if (!url) return "";

  // acepta x.com, twitter.com, mobile.twitter.com
  if (!/^https?:\/\//i.test(url)) return "";

  // corta /photo/1 o cosas extra
  const m =
    url.match(/(https?:\/\/(?:www\.)?x\.com\/[^\/]+\/status\/\d+)/i) ||
    url.match(/(https?:\/\/(?:www\.)?x\.com\/i\/status\/\d+)/i) ||
    url.match(/(https?:\/\/(?:www\.)?twitter\.com\/[^\/]+\/status\/\d+)/i) ||
    url.match(/(https?:\/\/(?:www\.)?twitter\.com\/i\/status\/\d+)/i) ||
    url.match(/(https?:\/\/(?:mobile\.)?twitter\.com\/[^\/]+\/status\/\d+)/i) ||
    url.match(/(https?:\/\/(?:mobile\.)?twitter\.com\/i\/status\/\d+)/i);

  return m ? m[1] : url;
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toUTCString();
  } catch {
    return String(d);
  }
}

function pickBestMedia(mediaArr = []) {
  if (!Array.isArray(mediaArr) || !mediaArr.length) return null;
  // prioriza video
  const v = mediaArr.find((m) => (m?.type || "").toLowerCase().includes("video"));
  return v || mediaArr[0];
}

async function getTwitterFromApi(url) {
  const { data, status } = await axios.post(
    ENDPOINT,
    { url },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true,
    }
  );

  let j = data;
  if (typeof j === "string") {
    try {
      j = JSON.parse(j.trim());
    } catch {
      throw new Error("Respuesta no JSON del servidor");
    }
  }

  const ok = j?.status === true || j?.found === true || j?.success === true;
  if (!ok) {
    const msg = j?.message || j?.error || `HTTP ${status}`;
    throw new Error(msg);
  }

  const r = j.result || j;

  const media = r.media || r.result?.media || [];
  const best = pickBestMedia(media);
  if (!best?.url) throw new Error("No se encontró media en el tweet.");

  return {
    authorName: r.authorName || r.user_name || r.author?.name || "—",
    authorUsername: r.authorUsername || r.user_screen_name || r.author?.username || "",
    likes: Number(r.likes || 0),
    replies: Number(r.replies || 0),
    retweets: Number(r.retweets || 0),
    date: r.date || r.created_at || "",
    mediaBest: { url: best.url, type: best.type || "" },
  };
}

async function downloadBuffer(url) {
  // Reintento simple: a veces X responde raro, esto ayuda
  const headers = {
    "User-Agent": UA,
    Referer: "https://x.com/",
    Origin: "https://x.com",
    Accept: "*/*",
  };

  const resp = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: MAX_TIMEOUT,
    headers,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (resp.status >= 400) {
    throw new Error(`Upstream ${resp.status} al bajar media`);
  }
  return Buffer.from(resp.data);
}

function guessMime(type, url) {
  const t = String(type || "").toLowerCase();
  const u = String(url || "").toLowerCase();

  if (t.includes("video") || u.includes(".mp4")) return "video/mp4";
  if (t.includes("gif")) return "video/mp4";
  if (t.includes("photo") || t.includes("image") || u.includes(".jpg") || u.includes(".jpeg"))
    return "image/jpeg";
  if (u.includes(".png")) return "image/png";
  return "application/octet-stream";
}

async function sendMedia(conn, job, asDocument, triggerMsg) {
  const { chatId, mediaUrl, mediaType, caption, previewKey, quotedBase } = job;

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await react(conn, chatId, previewKey, "⏳");

    const buf = await downloadBuffer(mediaUrl);
    const mimetype = guessMime(mediaType, mediaUrl);

    const isVideo = mimetype.startsWith("video/");
    const isImage = mimetype.startsWith("image/");

    const fileNameBase = `twitter-${Date.now()}`;
    const fileName =
      isVideo ? `${fileNameBase}.mp4` : isImage ? `${fileNameBase}.jpg` : `${fileNameBase}.bin`;

    const payload = asDocument
      ? { document: buf, mimetype, fileName, caption }
      : isVideo
      ? { video: buf, mimetype, caption }
      : isImage
      ? { image: buf, mimetype, caption }
      : { document: buf, mimetype, fileName, caption };

    await conn.sendMessage(chatId, payload, { quoted: quotedBase || triggerMsg });

    await react(conn, chatId, previewKey, "✅");
    await react(conn, chatId, triggerMsg.key, "✅");
  } catch (e) {
    await react(conn, chatId, previewKey, "❌");
    await react(conn, chatId, triggerMsg.key, "❌");
    await conn.sendMessage(
      chatId,
      { text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: quotedBase || triggerMsg }
    );
  }
}

module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      { text: `✳️ Usa:\n.tw <link de X/Twitter>\nEj: .tw https://x.com/user/status/123` },
      { quoted: msg }
    );
  }

  const url = normXUrl(text);
  if (!url || !/\/\/(x|twitter)\.com/i.test(url)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido.\nUsa un link de X/Twitter tipo:\nhttps://x.com/user/status/123` },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const d = await getTwitterFromApi(url);

    const username = d.authorUsername ? `@${String(d.authorUsername).replace(/^@/, "")}` : "";

    const captionPreview =
`⚡ 𝗧𝘄𝗶𝘁𝘁𝗲𝗿/𝗫 — 𝗼𝗽𝗰𝗶𝗼𝗻𝗲𝘀

👍 Enviar normal
❤️ Enviar como documento
— o responde: 1 = normal · 2 = documento

✦ 𝗔𝘂𝘁𝗼𝗿: ${d.authorName} ${username}
✦ 𝗘𝘀𝘁𝗮𝗱𝘀: ❤️ ${d.likes} · 💬 ${d.replies} · 🔁 ${d.retweets}
✦ 𝗙𝗲𝗰𝗵𝗮: ${fmtDate(d.date)}`;

    // ✅ PREVIEW: si es imagen, mandamos BUFFER (evita 401)
    let preview;
    const previewMime = guessMime(d.mediaBest.type, d.mediaBest.url);

    if (previewMime.startsWith("image/")) {
      let imgBuf = null;
      try {
        imgBuf = await downloadBuffer(d.mediaBest.url);
      } catch {
        imgBuf = null;
      }

      if (imgBuf) {
        preview = await conn.sendMessage(
          chatId,
          { image: imgBuf, mimetype: previewMime, caption: captionPreview },
          { quoted: msg }
        );
      } else {
        preview = await conn.sendMessage(chatId, { text: captionPreview }, { quoted: msg });
      }
    } else {
      preview = await conn.sendMessage(chatId, { text: captionPreview }, { quoted: msg });
    }

    pendingTW[preview.key.id] = {
      chatId,
      mediaUrl: d.mediaBest.url,
      mediaType: d.mediaBest.type,
      previewKey: preview.key,
      quotedBase: msg,
      createdAt: Date.now(),
      processing: false,
      caption:
`✅ 𝗧𝘄𝗶𝘁𝘁𝗲𝗿/𝗫 — 𝗹𝗶𝘀𝘁𝗼

✦ 𝗔𝘂𝘁𝗼𝗿: ${d.authorName} ${username}
✦ 𝗔𝗣𝗜: ${PUBLIC_API_URL}

🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`,
    };

    await react(conn, chatId, msg.key, "✅");

    // Listener único
    if (!conn._twitterInteractiveListener) {
      conn._twitterInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            cleanOldJobs();

            // --- Reacciones (👍 / ❤️) al preview ---
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingTW[reactKey.id];
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;

              if (emoji !== "👍" && emoji !== "❤️") continue;
              if (job.processing) continue;
              job.processing = true;

              await sendMedia(conn, job, emoji === "❤️", m);
              delete pendingTW[reactKey.id];
              continue;
            }

            // --- Replies 1/2 citando el preview ---
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            const body =
              (m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "").trim();

            if (replyTo && pendingTW[replyTo]) {
              const job = pendingTW[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              if (body !== "1" && body !== "2") continue;
              if (job.processing) continue;
              job.processing = true;

              await sendMedia(conn, job, body === "2", m);
              delete pendingTW[replyTo];
            }
          } catch (e) {
            console.error("Twitter listener error:", e?.message || e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error Twitter/X:", err?.message || err);

    let msgTxt = "❌ Ocurrió un error al procesar el link de Twitter/X.";
    const s = String(err?.message || "");

    if (/api key|unauthorized|forbidden|401/i.test(s)) msgTxt = "🔐 API Key inválida o sin permisos (401).";
    else if (/timeout|timed out|502|upstream/i.test(s)) msgTxt = "⚠️ Timeout o error del servidor.";
    else if (/no media/i.test(s)) msgTxt = "⚠️ No se encontró media en ese tweet.";
    else if (/enlace|url/i.test(s)) msgTxt = "❌ No pude procesar ese enlace. Intenta copiar el link completo del tweet.";

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["tw", "twitter", "x"];
module.exports.help = ["tw <url>", "twitter <url>", "x <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
