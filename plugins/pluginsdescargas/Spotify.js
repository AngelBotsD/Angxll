// commands/spotify.js — Spotify interactivo
// ✅ Reacciones: 👍 (Audio) / ❤️ (Documento) o Respuestas 1 / 2
// ✅ Mensaje de espera: "Descargando su canción..."
// ✅ Branding: La Suki Bot + Link API
// ✅ Multiuso: No se borra al instante (10 min activo)

"use strict";

const axios = require("axios");

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY || "Russellxz";
const MAX_TIMEOUT = 60000; // 60s

// Jobs pendientes
const pendingSPOTIFY = Object.create(null);

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

function safeBaseFromTitle(title) {
  return String(title || "spotify").slice(0, 70).replace(/[^A-Za-z0-9_\-.]+/g, "_");
}

// 1. OBTENER INFO (POST /spotify)
async function getSpotifyMp3(input) {
  const endpoint = `${API_BASE}/spotify`;

  const isUrl = /spotify\.com/i.test(input);
  const body = isUrl ? { url: input } : { query: input };

  const { data: res, status: http } = await axios.post(
    endpoint,
    body,
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

  const mp3Url = data.result?.media?.audio;
  if (!mp3Url) throw new Error("No se encontró el MP3");

  const title = data.result?.title || "Spotify Track";
  const artist = data.result?.artist || "Desconocido";
  const thumbnail = data.result?.thumbnail || data.result?.image || "";

  return { mp3Url, title, artist, thumbnail };
}

// 2. ENVIAR AUDIO
async function sendAudio(conn, job, asDocument, triggerMsg) {
  job.isBusy = true;
  const { chatId, mp3Url, title, artist, previewKey, quotedBase } = job;

  try {
    // Feedback visual
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎵");
    await conn.sendMessage(chatId, { text: "⏳ Espere, descargando su canción..." }, { quoted: quotedBase });

    // Caption con Branding
    const finalCaption = 
`🎵 𝗧𝗶𝘁𝘂𝗹𝗼: ${title}
👤 𝗔𝗿𝘁𝗶𝘀𝘁𝗮: ${artist}

🤖 𝗕𝗼𝘁: La Suki Bot
🔗 𝗔𝗣𝗜: https://api-sky.ultraplus.click`;

    await conn.sendMessage(
      chatId,
      {
        [asDocument ? "document" : "audio"]: { url: mp3Url },
        mimetype: "audio/mpeg",
        fileName: asDocument ? `${safeBaseFromTitle(title)} - ${artist}.mp3` : undefined,
        // Caption solo se muestra bien en documentos
        caption: asDocument ? finalCaption : undefined,
      },
      { quoted: quotedBase || triggerMsg }
    );

    await react(conn, chatId, previewKey, "✅");
    await react(conn, chatId, triggerMsg.key, "✅");

  } catch (e) {
    console.error("Spotify Send Error:", e);
    await react(conn, chatId, previewKey, "❌");
    await react(conn, chatId, triggerMsg.key, "❌");
    await conn.sendMessage(
      chatId,
      { text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: quotedBase || triggerMsg }
    );
  } finally {
    job.isBusy = false; // Liberar para otra descarga
  }
}

// 3. HANDLER PRINCIPAL
module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || "."; 
  let text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      { 
        text: `✳️ Usa:\n${pref}${command} <canción o URL>\n\nEjemplo:\n${pref}${command} bad bunny tití me preguntó` 
      },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏱️");

    // A) Obtener Info
    const { mp3Url, title, artist, thumbnail } = await getSpotifyMp3(text);

    // B) Mensaje de opciones
    const caption =
`🎵 𝗦𝗽𝗼𝘁𝗶𝗳𝘆 — 𝗢𝗽𝗰𝗶𝗼𝗻𝗲𝘀

✦ 𝗧𝗶𝘁𝘂𝗹𝗼: ${title}
✦ 𝗔𝗿𝘁𝗶𝘀𝘁𝗮: ${artist}

Elige cómo enviarlo:
👍 𝗔𝘂𝗱𝗶𝗼 (normal)
❤️ 𝗔𝘂𝗱𝗶𝗼 𝗰𝗼𝗺𝗼 𝗱𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼
— o responde: 1 = audio · 2 = documento

🤖 𝗕𝗼𝘁: La Suki Bot
🔗 𝗔𝗣𝗜: https://api-sky.ultraplus.click`;

    let preview;
    if (thumbnail && thumbnail.startsWith("http")) {
        preview = await conn.sendMessage(chatId, { image: { url: thumbnail }, caption }, { quoted: msg });
    } else {
        preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
    }

    // C) Guardar trabajo
    pendingSPOTIFY[preview.key.id] = {
      chatId,
      mp3Url,
      title,
      artist,
      quotedBase: msg,
      previewKey: preview.key,
      isBusy: false,
    };

    // Auto-limpieza (10 min)
    setTimeout(() => {
        if (pendingSPOTIFY[preview.key.id]) delete pendingSPOTIFY[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

    // D) Listener
    if (!conn._spotifyInteractiveListener) {
      conn._spotifyInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // Reacciones
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingSPOTIFY[reactKey.id];
              
              if (!job || job.chatId !== m.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;

              if (job.isBusy) continue;
              
              const asDoc = emoji === "❤️";
              await sendAudio(conn, job, asDoc, m);
              continue;
            }

            // Respuestas
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            if (replyTo && pendingSPOTIFY[replyTo]) {
              const job = pendingSPOTIFY[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
              if (body !== "1" && body !== "2") continue;

              if (job.isBusy) continue;

              const asDoc = body === "2";
              await sendAudio(conn, job, asDoc, m);
            }
          } catch (e) {
            console.error("Spotify listener error:", e);
          }
        }
      });
    }

  } catch (err) {
    console.error("❌ Error spotify:", err?.message || err);

    let msgTxt = "❌ Ocurrió un error al procesar la canción.";
    const s = String(err?.message || "");
    if (/api key|unauthorized|forbidden|401/i.test(s)) msgTxt = "🔐 API Key inválida o ausente.";
    else if (/timeout|timed out|502|upstream/i.test(s)) msgTxt = "⚠️ Timeout o error del servidor.";

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["spotify", "sp"];
module.exports.help = ["spotify <canción o url>", "sp <canción o url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;

