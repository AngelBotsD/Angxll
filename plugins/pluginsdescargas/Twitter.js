// commands/twitter.js — X/Twitter interactivo (👍 normal / ❤️ documento o 1/2)
// ✅ FIX 401: Descarga con Axios y Buffer si es necesario
// ✅ Multiuso: No se borra al instante (10 min activo)
// ✅ Mensaje de espera: "Descargando..."
// ✅ Branding: La Suki Bot + Link API

"use strict";

const axios = require("axios");

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000; // 60s

const pendingTW = Object.create(null);

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

function isValidX(url) {
  const u = String(url || "").trim();
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(u)
      || /^https?:\/\/(www\.)?x\.com\/i\/status\/\d+/i.test(u);
}

// 1. OBTENER DATOS DE TU API
async function getTwitterFromSky(url) {
  const endpoint = `${API_BASE}/twitter`;

  const { data: res, status: http } = await axios.post(
    endpoint,
    { url },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true,
    }
  );

  let data = res;
  if (typeof data === "string") {
    try { data = JSON.parse(data.trim()); } catch { throw new Error("Respuesta no JSON del servidor"); }
  }

  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${http}`);

  const r = data.result || {};
  const best = r?.media?.best || r?.media?.items?.[0];
  if (!best) throw new Error("No se encontró media.");

  // Intentamos agarrar un link directo
  const direct = best?.url || best?.direct || best?.link || best?.media_url || null;
  const proxyInline = best?.proxy?.inline || null;
  const proxyDownload = best?.proxy?.download || proxyInline;

  if (!direct && !proxyInline) throw new Error("No se encontró enlace descargable.");

  const type = best.type === "video" ? "video" : "image";

  return {
    type,
    direct,
    proxyInline,
    proxyDownload,
    author: r.author || {},
    stats: r.stats || {},
    date: r.date || "",
    text: r.text || "",
    sourceUrl: r.url || url,
  };
}

// 2. DESCARGAR BUFFER (SOLUCIÓN ERROR 401)
async function fetchBuffer(url, useAuthHeaders) {
  const headers = useAuthHeaders
    ? { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` }
    : {};

  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: MAX_TIMEOUT,
    headers,
    validateStatus: () => true,
  });

  if (r.status >= 400) {
    throw new Error(`HTTP ${r.status}`);
  }
  const ct = String(r.headers["content-type"] || "");
  return { buffer: Buffer.from(r.data), contentType: ct };
}

// 3. ENVIAR MEDIA
async function sendMedia(conn, job, asDocument, triggerMsg) {
  // Marcamos como ocupado para evitar doble clic
  job.isBusy = true;
  const { chatId, type, direct, proxyInline, proxyDownload, caption, previewKey, quotedBase } = job;

  const isVideo = type === "video";
  const mimetype = isVideo ? "video/mp4" : "image/jpeg";
  const ext = isVideo ? "mp4" : "jpg";

  try {
    // Feedback visual
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    // Mensaje de espera (LO QUE PEDISTE)
    await conn.sendMessage(chatId, { text: "⏳ Espere, descargando su archivo..." }, { quoted: quotedBase });

    // A) Intento: mandar URL directa (si existe y WhatsApp la acepta)
    const urlTry = direct || proxyInline;
    if (urlTry) {
      try {
        if (asDocument) {
          await conn.sendMessage(
            chatId,
            { document: { url: urlTry }, mimetype, fileName: `twitter-${Date.now()}.${ext}`, caption },
            { quoted: quotedBase || triggerMsg }
          );
        } else {
          if (isVideo) {
            await conn.sendMessage(chatId, { video: { url: urlTry }, mimetype: "video/mp4", caption }, { quoted: quotedBase || triggerMsg });
          } else {
            await conn.sendMessage(chatId, { image: { url: urlTry }, caption }, { quoted: quotedBase || triggerMsg });
          }
        }
        await react(conn, chatId, triggerMsg.key, "✅");
        return; // Éxito con URL
      } catch (e) {
        // Falló URL (posible 401), pasamos a Buffer
      }
    }

    // B) Fallback: descargar como BUFFER
    let bufRes = null;
    if (direct) {
      try { bufRes = await fetchBuffer(direct, false); } catch {}
    }
    if (!bufRes && proxyDownload) {
      bufRes = await fetchBuffer(proxyDownload, true); // con headers
    }

    if (!bufRes) throw new Error("No se pudo descargar el archivo.");

    const mediaBuffer = bufRes.buffer;

    if (asDocument) {
      await conn.sendMessage(
        chatId,
        { document: mediaBuffer, mimetype, fileName: `twitter-${Date.now()}.${ext}`, caption },
        { quoted: quotedBase || triggerMsg }
      );
    } else {
      if (isVideo) {
        await conn.sendMessage(chatId, { video: mediaBuffer, mimetype: "video/mp4", caption }, { quoted: quotedBase || triggerMsg });
      } else {
        await conn.sendMessage(chatId, { image: mediaBuffer, caption }, { quoted: quotedBase || triggerMsg });
      }
    }

    await react(conn, chatId, triggerMsg.key, "✅");

  } catch (e) {
    console.error("TW Send Error:", e);
    await react(conn, chatId, triggerMsg.key, "❌");
    await conn.sendMessage(
      chatId,
      { text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: quotedBase || triggerMsg }
    );
  } finally {
    // Liberamos el job para permitir otra descarga
    job.isBusy = false;
  }
}

// 4. HANDLER PRINCIPAL
module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      { text: `✳️ Usa:\n.tw <enlace>\nEj: .tw https://x.com/user/status/123` },
      { quoted: msg }
    );
  }

  if (!isValidX(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido.\nUsa un link tipo:\nhttps://x.com/usuario/status/123` },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const d = await getTwitterFromSky(text);

    const authorName = d.author?.name || "X";
    const username = d.author?.username ? `@${String(d.author.username).replace(/^@/, "")}` : "";
    const likes = Number(d.stats?.likes || 0);
    const replies = Number(d.stats?.replies || 0);
    const retweets = Number(d.stats?.retweets || 0);

    const captionPreview =
`⚡ 𝗧𝘄𝗶𝘁𝘁𝗲𝗿/𝗫 — 𝗢𝗽𝗰𝗶𝗼𝗻𝗲𝘀

👍 Enviar normal
❤️ Enviar como documento
— o responde: 1 = normal · 2 = documento

✦ 𝗔𝘂𝘁𝗼𝗿: ${authorName} ${username}
✦ 𝗘𝘀𝘁𝗮𝗱𝘀: ❤️ ${likes} · 💬 ${replies} · 🔁 ${retweets}
${d.date ? `✦ 𝗙𝗲𝗰𝗵𝗮: ${d.date}` : ""}`.trim();

    const preview = await conn.sendMessage(chatId, { text: captionPreview }, { quoted: msg });

    // Guardar trabajo
    pendingTW[preview.key.id] = {
      chatId,
      type: d.type,
      direct: d.direct,
      proxyInline: d.proxyInline,
      proxyDownload: d.proxyDownload,
      caption:
`✅ 𝗧𝘄𝗶𝘁𝘁𝗲𝗿/𝗫 — 𝗩𝗶𝗱𝗲𝗼

✦ 𝗔𝘂𝘁𝗼𝗿: ${authorName} ${username}

🤖 𝗕𝗼𝘁: La Suki Bot
🔗 𝗔𝗣𝗜: ${API_BASE}`,
      quotedBase: msg,
      previewKey: preview.key,
      createdAt: Date.now(),
      isBusy: false,
    };

    // Auto-limpieza en 10 min
    setTimeout(() => {
        if (pendingTW[preview.key.id]) delete pendingTW[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

    if (!conn._twInteractiveListener) {
      conn._twInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // Reacciones
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingTW[reactKey.id];
              
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;

              if (job.isBusy) continue;
              await sendMedia(conn, job, emoji === "❤️", m);
              continue;
            }

            // Replies
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            if (replyTo && pendingTW[replyTo]) {
              const job = pendingTW[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
              if (body !== "1" && body !== "2") continue;

              if (job.isBusy) continue;
              await sendMedia(conn, job, body === "2", m);
            }
          } catch (e) {
            console.error("Twitter listener error:", e?.message || e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error Twitter:", err?.message || err);
    await conn.sendMessage(chatId, { text: `❌ Error: ${err?.message || "unknown"}` }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["twitter", "tw", "xdl", "x"];
module.exports.help = ["tw <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;

