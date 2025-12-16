
// commands/twitter.js — X/Twitter interactivo (👍 normal / ❤️ documento o 1/2)
// FIX 401: si el link requiere apikey, descargamos con axios y mandamos BUFFER.
"use strict";

const axios = require("axios");

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 30000;

const pendingTW = Object.create(null);

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

function isValidX(url) {
  const u = String(url || "").trim();
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(u)
      || /^https?:\/\/(www\.)?x\.com\/i\/status\/\d+/i.test(u);
}

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

  // Intentamos agarrar un link directo si existe (sin auth)
  const direct =
    best?.url ||
    best?.direct ||
    best?.link ||
    best?.media_url ||
    null;

  const proxyInline = best?.proxy?.inline || null;
  const proxyDownload = best?.proxy?.download || proxyInline;

  if (!direct && !proxyInline) throw new Error("No se encontró enlace descargable.");

  const type = best.type === "video" ? "video" : "image";

  return {
    type,
    direct,                  // puede ser null
    proxyInline,             // puede ser null
    proxyDownload,           // puede ser null
    author: r.author || {},
    stats: r.stats || {},
    date: r.date || "",
    text: r.text || "",
    sourceUrl: r.url || url,
  };
}

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

async function sendMedia(conn, job, asDocument, triggerMsg) {
  const { chatId, type, direct, proxyInline, proxyDownload, caption, previewKey, quotedBase } = job;

  const isVideo = type === "video";
  const mimetype = isVideo ? "video/mp4" : "image/jpeg";
  const ext = isVideo ? "mp4" : "jpg";

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await react(conn, chatId, previewKey, "⏳");

    // 1) Intento: mandar URL directa (si existe)
    const urlTry = direct || proxyInline;
    if (urlTry) {
      try {
        if (asDocument) {
          await conn.sendMessage(
            chatId,
            {
              document: { url: urlTry },
              mimetype,
              fileName: `twitter-${Date.now()}.${ext}`,
              caption,
            },
            { quoted: quotedBase || triggerMsg }
          );
        } else {
          if (isVideo) {
            await conn.sendMessage(
              chatId,
              { video: { url: urlTry }, mimetype: "video/mp4", caption },
              { quoted: quotedBase || triggerMsg }
            );
          } else {
            await conn.sendMessage(
              chatId,
              { image: { url: urlTry }, caption },
              { quoted: quotedBase || triggerMsg }
            );
          }
        }

        await react(conn, chatId, previewKey, "✅");
        await react(conn, chatId, triggerMsg.key, "✅");
        return;
      } catch (e) {
        // Si falla (401 típico), caemos al plan Buffer
      }
    }

    // 2) Fallback: descargar como BUFFER y enviar
    // Preferimos direct (sin headers). Si no hay, usamos proxy (con headers).
    let bufRes = null;

    if (direct) {
      try {
        bufRes = await fetchBuffer(direct, false);
      } catch {}
    }

    if (!bufRes && proxyDownload) {
      bufRes = await fetchBuffer(proxyDownload, true); // aquí sí metemos apikey
    }

    if (!bufRes) throw new Error("No se pudo descargar el archivo.");

    const mediaBuffer = bufRes.buffer;

    if (asDocument) {
      await conn.sendMessage(
        chatId,
        {
          document: mediaBuffer,
          mimetype,
          fileName: `twitter-${Date.now()}.${ext}`,
          caption,
        },
        { quoted: quotedBase || triggerMsg }
      );
    } else {
      if (isVideo) {
        await conn.sendMessage(
          chatId,
          { video: mediaBuffer, mimetype: "video/mp4", caption },
          { quoted: quotedBase || triggerMsg }
        );
      } else {
        await conn.sendMessage(
          chatId,
          { image: mediaBuffer, caption },
          { quoted: quotedBase || triggerMsg }
        );
      }
    }

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
`⚡ 𝗧𝘄𝗶𝘁𝘁𝗲𝗿/𝗫 — 𝗼𝗽𝗰𝗶𝗼𝗻𝗲𝘀

👍 Enviar normal
❤️ Enviar como documento
— o responde: 1 = normal · 2 = documento

✦ 𝗔𝘂𝘁𝗼𝗿: ${authorName} ${username}
✦ 𝗘𝘀𝘁𝗮𝗱𝘀: ❤️ ${likes} · 💬 ${replies} · 🔁 ${retweets}
${d.date ? `✦ 𝗙𝗲𝗰𝗵𝗮: ${d.date}` : ""}`.trim();

    const preview = await conn.sendMessage(chatId, { text: captionPreview }, { quoted: msg });

    pendingTW[preview.key.id] = {
      chatId,
      type: d.type,
      direct: d.direct,
      proxyInline: d.proxyInline,
      proxyDownload: d.proxyDownload,
      caption:
`✅ 𝗧𝘄𝗶𝘁𝘁𝗲𝗿/𝗫 — 𝗹𝗶𝘀𝘁𝗼

✦ 𝗔𝘂𝘁𝗼𝗿: ${authorName} ${username}
✦ 𝗟𝗶𝗻𝗸: ${d.sourceUrl}

🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`,
      quotedBase: msg,
      previewKey: preview.key,
      createdAt: Date.now(),
      processing: false,
    };

    await react(conn, chatId, msg.key, "✅");

    if (!conn._twInteractiveListener) {
      conn._twInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // limpiar jobs viejos (15 min)
            for (const k of Object.keys(pendingTW)) {
              if (Date.now() - (pendingTW[k]?.createdAt || 0) > 15 * 60 * 1000) delete pendingTW[k];
            }

            // Reacción (👍 / ❤️)
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

            // Reply 1/2
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
    console.error("❌ Error Twitter:", err?.message || err);
    await conn.sendMessage(chatId, { text: `❌ Error: ${err?.message || "unknown"}` }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["twitter", "tw", "xdl", "x"];
module.exports.help = ["tw <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
