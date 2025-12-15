
// comandos/ytmp3.js — YouTube MP3 (URL) con reacciones 👍 / ❤️ o 1 / 2 usando /youtube/resolve
"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { promisify } = require("util");
const { pipeline } = require("stream");
const streamPipe = promisify(pipeline);

// ==== CONFIG API NUEVA ====
const API_BASE = (process.env.API_BASE || "https://api-sky-test.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz"; // tu API key

const DEFAULT_AUDIO_FORMAT = "mp3";

// Jobs pendientes por id del mensaje de opciones
const pendingYTA = Object.create(null);

const isYouTube = (u = "") =>
  /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(String(u || ""));

const fmtSec = (s) => {
  const n = Number(s || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return (h ? `${h}:` : "") + `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};

function ensureTmp() {
  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function safeName(name = "audio") {
  return (
    String(name)
      .slice(0, 90)
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "audio"
  );
}

function isApiUrl(url = "") {
  try {
    const u = new URL(url);
    const b = new URL(API_BASE);
    return u.host === b.host;
  } catch {
    return false;
  }
}

// ===== API NUEVA: POST /youtube/resolve (audio) =====
async function getYTFromSkyAudio(url) {
  const endpoint = `${API_BASE}/youtube/resolve`;

  const r = await axios.post(
    endpoint,
    { url, type: "audio", format: DEFAULT_AUDIO_FORMAT },
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

  // dl_download puede venir como "/youtube/dl?...."
  let dl = result?.media?.dl_download || "";
  if (dl && typeof dl === "string" && dl.startsWith("/")) dl = API_BASE + dl;

  const direct = result?.media?.direct || "";

  return {
    title: result?.title || "YouTube",
    duration: result?.duration || 0,
    thumbnail: result?.thumbnail || "",
    audio: dl || direct, // acá devolvemos el link final del audio
  };
}

// Transcodifica source a MP3 128k y guarda en /tmp; devuelve ruta
async function transcodeToMp3Tmp(srcUrl, outName = `ytmp3-${Date.now()}.mp3`) {
  const tmpDir = ensureTmp();
  const outPath = path.join(tmpDir, outName);

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "*/*",
  };

  // si el audio viene de TU API (/youtube/dl) hay que mandar apikey
  if (isApiUrl(srcUrl)) headers["apikey"] = API_KEY;

  const resp = await axios.get(srcUrl, {
    responseType: "stream",
    timeout: 180000,
    headers,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (resp.status >= 400) throw new Error(`HTTP_${resp.status}`);

  await new Promise((resolve, reject) => {
    ffmpeg(resp.data)
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .format("mp3")
      .save(outPath)
      .on("end", resolve)
      .on("error", reject);
  });

  return outPath;
}

const handler = async (msg, { conn, text, usedPrefix, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = (global.prefixes && global.prefixes[0]) || usedPrefix || ".";

  if (!text || !isYouTube(text)) {
    return conn.sendMessage(
      chatId,
      {
        text:
`✳️ 𝙐𝙨𝙤 𝙘𝙤𝙧𝙧𝙚𝙘𝙩𝙤:
${pref}${command} <enlace de YouTube>

📌 𝙀𝙟𝙚𝙢𝙥𝙡𝙤:
${pref}${command} https://youtu.be/dQw4w9WgXcQ`,
      },
      { quoted: msg }
    );
  }

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    // 1) Llama a tu API (audio)
    const d = await getYTFromSkyAudio(text);
    const title = d.title || "YouTube";
    const durationTxt = d.duration ? fmtSec(d.duration) : "—";
    const thumb = d.thumbnail || "";
    const audioSrc = String(d.audio || "");

    if (!audioSrc) throw new Error("No se pudo obtener audio (sin URL).");

    // 2) Mensaje de opciones (reacciones / números)
    const caption =
`⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 — 𝗔𝘂𝗱𝗶𝗼

Elige cómo enviarlo:
👍 𝗔𝘂𝗱𝗶𝗼 (normal)
❤️ 𝗔𝘂𝗱𝗶𝗼 𝗰𝗼𝗺𝗼 𝗱𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼
— 𝗼 responde: 1 = audio · 2 = documento

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durationTxt}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

    const preview = thumb
      ? await conn.sendMessage(chatId, { image: { url: thumb }, caption }, { quoted: msg })
      : await conn.sendMessage(chatId, { text: caption }, { quoted: msg });

    // Guarda job
    pendingYTA[preview.key.id] = {
      chatId,
      audioSrc,
      title,
      durationTxt,
      quotedBase: msg,
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    // 3) Listener único
    if (!conn._ytaListener) {
      conn._ytaListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingYTA[reactKey.id];
              if (job) {
                const asDoc = emoji === "❤️";
                if (emoji === "👍" || emoji === "❤️") {
                  await sendMp3(conn, job, asDoc, m);
                  delete pendingYTA[reactKey.id];
                }
              }
            }

            // RESPUESTAS con número 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            const textLow =
              (m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "")
                .trim()
                .toLowerCase();

            if (replyTo && pendingYTA[replyTo]) {
              const job = pendingYTA[replyTo];
              if (textLow === "1" || textLow === "2") {
                const asDoc = textLow === "2";
                await sendMp3(conn, job, asDoc, m);
                delete pendingYTA[replyTo];
              } else if (textLow) {
                await conn.sendMessage(
                  job.chatId,
                  { text: "⚠️ Responde con *1* (audio) o *2* (documento), o reacciona con 👍 / ❤️." },
                  { quoted: job.quotedBase }
                );
              }
            }
          } catch (e) {
            console.error("YTMP3 listener error:", e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error en ytmp3 (Sky):", err?.message || err);
    await conn.sendMessage(
      chatId,
      { text: `❌ *Error:* ${err?.message || "Fallo al procesar el audio."}` },
      { quoted: msg }
    );
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

async function sendMp3(conn, job, asDocument, triggerMsg) {
  const { chatId, audioSrc, title, durationTxt, quotedBase } = job;

  await conn.sendMessage(chatId, { react: { text: asDocument ? "📄" : "🎵", key: triggerMsg.key } });
  await conn.sendMessage(chatId, { text: `⏳ Enviando ${asDocument ? "como documento" : "audio"}…` }, { quoted: quotedBase });

  // Transcode → MP3 (128k) a archivo temporal
  const base = safeName(title);
  const filePath = await transcodeToMp3Tmp(audioSrc, `ytmp3-${Date.now()}-${base}.mp3`);

  const buf = fs.readFileSync(filePath);

  if (asDocument) {
    await conn.sendMessage(
      chatId,
      {
        document: buf,
        mimetype: "audio/mpeg",
        fileName: `${base}.mp3`,
      },
      { quoted: quotedBase }
    );
  } else {
    await conn.sendMessage(
      chatId,
      {
        audio: buf,
        mimetype: "audio/mpeg",
        fileName: `${base}.mp3`,
      },
      { quoted: quotedBase }
    );
  }

  try { fs.unlinkSync(filePath); } catch {}
  await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });
}

handler.command = ["ytmp3", "yta"];
handler.help = ["ytmp3 <url>", "yta <url>"];
handler.tags = ["descargas"];
handler.register = true;

module.exports = handler;
