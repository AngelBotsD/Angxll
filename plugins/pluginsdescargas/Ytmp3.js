// comandos/ytmp3.js — YouTube MP3 (URL) con reacciones 👍 / ❤️ o 1 / 2 usando /youtube-mp3
"use strict";

const axios = require("axios");

// ==== CONFIG API ====
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";

// Jobs pendientes por id del mensaje de opciones
const pendingYTA = Object.create(null);

const isYouTube = (u = "") =>
  /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(String(u || ""));

async function getYTFromSkyAudio(url) {
  const endpoint = `${API_BASE}/youtube-mp3`;

  const r = await axios.post(
    endpoint,
    { url },
    {
      timeout: 120000,
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Accept: "application/json, */*",
      },
      validateStatus: () => true,
    }
  );

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON del servidor");

  const ok =
    data.status === true ||
    data.status === "true" ||
    data.ok === true ||
    data.success === true;

  if (!ok) throw new Error(data.message || data.error || "Error en la API");

  const result = data.result || data.data || data;

  const audioSrc = result?.media?.audio;

  if (!audioSrc) throw new Error("No se pudo obtener audio (sin URL).");

  return {
    title: result?.title || "YouTube",
    audio: audioSrc, // acá devolvemos el link final del audio
  };
}

module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  let text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      { text: `✳️ Usa:\n\( {pref} \){command} <URL YouTube>\nEj: \( {pref} \){command} https://youtu.be/dQw4w9WgXcQ` },
      { quoted: msg }
    );
  }

  if (!isYouTube(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido. Usa URL de YouTube.` },
      { quoted: msg }
    );
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏱️", key: msg.key } });

    const d = await getYTFromSkyAudio(text);
    const title = d.title || "YouTube";

    const txt =
`⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗠𝗣𝟯 — 𝗼𝗽𝗰𝗶𝗼𝗻𝗲𝘀

Elige cómo enviarlo:
👍 𝗔𝘂𝗱𝗶𝗼 (normal)
❤️ 𝗔𝘂𝗱𝗶𝗼 𝗰𝗼𝗺𝗼 𝗱𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼
— 𝗼 responde: 1 = audio · 2 = documento

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}`;

    const preview = await conn.sendMessage(chatId, { text: txt }, { quoted: msg });

    pendingYTA[preview.key.id] = {
      chatId,
      audioSrc: d.audio,
      title,
      quotedBase: msg,
      previewKey: preview.key,
      createdAt: Date.now(),
      processing: false,
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    if (!conn._ytaListener) {
      conn._ytaListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // limpiar jobs viejos (15 min)
            for (const k of Object.keys(pendingYTA)) {
              if (Date.now() - (pendingYTA[k]?.createdAt || 0) > 15 * 60 * 1000) {
                delete pendingYTA[k];
              }
            }

            // --- Reacciones (👍 / ❤️) al preview ---
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingYTA[reactKey.id];
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;

              if (emoji !== "👍" && emoji !== "❤️") continue;

              if (job.processing) continue;
              job.processing = true;

              const asDoc = emoji === "❤️";
              await sendMp3(conn, job, asDoc, m);

              delete pendingYTA[reactKey.id];
              continue;
            }

            // --- Replies 1/2 citando el preview ---
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            const body =
              (m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "").trim();

            if (replyTo && pendingYTA[replyTo]) {
              const job = pendingYTA[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              if (body !== "1" && body !== "2") continue;

              if (job.processing) continue;
              job.processing = true;

              const asDoc = body === "2";
              await sendMp3(conn, job, asDoc, m);

              delete pendingYTA[replyTo];
            }
          } catch (e) {
            console.error("YTMP3 listener error:", e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error en ytmp3:", err?.message || err);
    await conn.sendMessage(
      chatId,
      { text: `❌ *Error:* ${err?.message || "Fallo al procesar el audio."}` },
      { quoted: msg }
    );
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

async function sendMp3(conn, job, asDocument, triggerMsg) {
  const { chatId, audioSrc, title, quotedBase } = job;

  await conn.sendMessage(chatId, { react: { text: asDocument ? "📁" : "🎵", key: triggerMsg.key } });
  await conn.sendMessage(chatId, { text: `⏳ Enviando audio${asDocument ? " como documento" : ""}…` }, { quoted: quotedBase });

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "audio"]: { url: audioSrc },
      mimetype: "audio/mpeg",
      fileName: asDocument ? `${safeBaseFromTitle(title)}.mp3` : undefined,
    },
    { quoted: quotedBase }
  );

  await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });
}

function safeBaseFromTitle(title) {
  return String(title || "youtube").slice(0, 70).replace(/[^A-Za-z0-9_\-.]+/g, "_");
}

module.exports.command = ["ytmp3", "yta"];
module.exports.help = ["ytmp3 <url>", "yta <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
