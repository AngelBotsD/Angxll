// commands/twitter.js — X/Twitter interactivo (👍 normal / ❤️ documento o 1/2) usando tu API
"use strict";

const axios = require("axios");

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 25000;

// Jobs pendientes por ID del mensaje preview
const pendingTW = Object.create(null);

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

function isValidX(url) {
  const u = String(url || "").trim();
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(u);
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
  if (!best?.proxy?.inline) throw new Error("No se encontró media descargable.");

  // best.type: "video" | "image"
  const type = best.type === "video" ? "video" : "image";

  return {
    type,
    inline: best.proxy.inline,
    download: best.proxy.download || best.proxy.inline,
    author: r.author || {},
    stats: r.stats || {},
    date: r.date || "",
    text: r.text || "",
    sourceUrl: r.url || url,
  };
}

async function sendMedia(conn, job, asDocument, triggerMsg) {
  const { chatId, type, inline, caption, previewKey, quotedBase } = job;

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await react(conn, chatId, previewKey, "⏳");

    // si es imagen y es "normal", lo mandamos como image.
    // si es video y es "normal", lo mandamos como video.
    // si es documento, siempre como document.
    const mimetype =
      type === "video" ? "video/mp4" : "image/jpeg";

    if (asDocument) {
      const ext = type === "video" ? "mp4" : "jpg";
      await conn.sendMessage(
        chatId,
        {
          document: { url: inline },
          mimetype,
          fileName: `twitter-${Date.now()}.${ext}`,
          caption,
        },
        { quoted: quotedBase || triggerMsg }
      );
    } else {
      if (type === "video") {
        await conn.sendMessage(
          chatId,
          {
            video: { url: inline },
            mimetype: "video/mp4",
            caption,
          },
          { quoted: quotedBase || triggerMsg }
        );
      } else {
        await conn.sendMessage(
          chatId,
          {
            image: { url: inline },
            caption,
          },
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
      { text: `✳️ Usa:\n.twitter <enlace>\nEj: .twitter https://x.com/user/status/123` },
      { quoted: msg }
    );
  }

  if (!isValidX(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido.\nDebe ser un post tipo:\nhttps://x.com/usuario/status/123` },
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
      inline: d.inline, // usamos inline (proxy) para evitar bloqueos
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

    // Listener único
    if (!conn._twInteractiveListener) {
      conn._twInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // limpiar jobs viejos (15 min)
            for (const k of Object.keys(pendingTW)) {
              if (Date.now() - (pendingTW[k]?.createdAt || 0) > 15 * 60 * 1000) delete pendingTW[k];
            }

            // Reacción (👍 / ❤️) al preview
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingTW[reactKey.id];
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;

              if (job.processing) continue;
              job.processing = true;

              const asDoc = emoji === "❤️";
              await sendMedia(conn, job, asDoc, m);

              delete pendingTW[reactKey.id];
              continue;
            }

            // Reply 1/2 citando el preview
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

              const asDoc = body === "2";
              await sendMedia(conn, job, asDoc, m);

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

    let msgTxt = "❌ Ocurrió un error al procesar el post de X.";
    const s = String(err?.message || "");
    if (/api key|unauthorized|forbidden|401/i.test(s)) msgTxt = "🔐 API Key inválida o ausente.";
    else if (/timeout|timed out|502|upstream/i.test(s)) msgTxt = "⚠️ Timeout o error del servidor.";

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["twitter", "tw", "xdl", "x"];
module.exports.help = ["twitter <url>", "tw <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
