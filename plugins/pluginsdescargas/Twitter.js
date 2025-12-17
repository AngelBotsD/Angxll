// commands/twitter.js — Twitter/X interactivo (👍 normal / ❤️ documento o 1/2)
// - Normaliza links x.com/twitter.com (incluye /i/status/)
// - Preview de imagen usando BUFFER (evita 401/403)
// - En el resultado final muestra tu API (publicidad), no el link del tweet
"use strict";

const axios = require("axios");

// === Config API (tu API) ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";
const ENDPOINT = `${API_BASE}/twitter`; // <-- ajusta si tu endpoint se llama distinto
const API_PUBLICITY = process.env.API_PUBLICITY || API_BASE; // lo que quieres mostrar de publicidad

const MAX_TIMEOUT = 30000;
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

// ✅ Normaliza: soporta x.com, twitter.com, mobile.twitter.com
// ✅ Soporta /user/status/ID y /i/status/ID y /i/web/status/ID
function normXUrl(input = "") {
  const raw = String(input || "").trim();
  if (!raw) return "";

  // si no trae protocolo, intentar arreglar
  const maybe = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  let u;
  try {
    u = new URL(maybe);
  } catch {
    return "";
  }

  const host = (u.hostname || "").toLowerCase();
  if (!/(\bx\.com\b|\btwitter\.com\b|\bmobile\.twitter\.com\b)/i.test(host)) return "";

  const path = (u.pathname || "").replace(/\/+$/, "");
  // posibles formatos:
  // /<user>/status/<id>
  // /i/status/<id>
  // /i/web/status/<id>
  let id = null;

  const m1 = path.match(/\/status\/(\d+)/i);
  if (m1) id = m1[1];

  const m2 = path.match(/\/i\/status\/(\d+)/i);
  if (!id && m2) id = m2[1];

  const m3 = path.match(/\/i\/web\/status\/(\d+)/i);
  if (!id && m3) id = m3[1];

  if (!id) return "";

  // Canonical: usar x.com/i/status/<id> (sirve aunque no haya username)
  return `https://x.com/i/status/${id}`;
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
  const v = mediaArr.find((m) => String(m?.type || "").toLowerCase().includes("video"));
  return v || mediaArr[0];
}

async function getTwitterFromApi(url) {
  // Intento 1: POST {url}
  let resp;
  try {
    resp = await axios.post(
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
  } catch (e) {
    resp = null;
  }

  // Intento 2: GET ?url=
  if (!resp || resp.status >= 400) {
    resp = await axios.get(ENDPOINT, {
      params: { url },
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "User-Agent": UA,
        Accept: "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true,
    });
  }

  const { data, status } = resp;

  let j = data;
  if (typeof j === "string") {
    try {
      j = JSON.parse(j.trim());
    } catch {
      throw new Error("Respuesta no JSON del servidor");
    }
  }

  // Soporta varias formas
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
  const resp = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: MAX_TIMEOUT,
    headers: {
      "User-Agent": UA,
      Referer: "https://x.com/",
      Accept: "*/*",
    },
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
  if (t.includes("gif")) return "video/mp4"; // muchos gifs vienen como mp4
  if (t.includes("photo") || t.includes("image") || u.includes(".jpg") || u.includes(".jpeg"))
    return "image/jpeg";
  if (u.includes(".png")) return "image/png";
  return "application/octet-stream";
}

async function sendPreview(conn, chatId, d, msg, captionPreview) {
  // ✅ Si es imagen, mandar buffer para evitar 401/403
  const isImg = guessMime(d.mediaBest.type, d.mediaBest.url).startsWith("image/");
  if (!isImg) {
    return await conn.sendMessage(chatId, { text: captionPreview }, { quoted: msg });
  }

  try {
    const buf = await downloadBuffer(d.mediaBest.url);
    const mimetype = guessMime(d.mediaBest.type, d.mediaBest.url);
    return await conn.sendMessage(chatId, { image: buf, mimetype, caption: captionPreview }, { quoted: msg });
  } catch {
    // fallback: texto si falla el buffer
    return await conn.sendMessage(chatId, { text: captionPreview }, { quoted: msg });
  }
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
      { text: `✳️ Usa:\n.tw <link de X/Twitter>\nEj: .tw https://x.com/i/status/123` },
      { quoted: msg }
    );
  }

  const url = normXUrl(text);
  if (!url) {
    return conn.sendMessage(
      chatId,
      {
        text:
          `❌ Enlace inválido.\n` +
          `Usa un link de X/Twitter tipo:\n` +
          `https://x.com/i/status/123\n` +
          `https://x.com/usuario/status/123`,
      },
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

    const preview = await sendPreview(conn, chatId, d, msg, captionPreview);

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
✦ 𝗔𝗣𝗜: ${API_PUBLICITY}

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
    else if (/no se encontró media|no media/i.test(s)) msgTxt = "⚠️ No se encontró media en ese tweet.";
    else if (/url inválida|enlace inválido|id/i.test(s)) msgTxt = "⚠️ Ese link no parece un tweet válido.";

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["tw", "twitter", "x"];
module.exports.help = ["tw <url>", "twitter <url>", "x <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
