
// commands/play.js
"use strict";

const axios = require("axios");
const yts = require("yt-search");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { promisify } = require("util");
const { pipeline } = require("stream");
const streamPipe = promisify(pipeline);

// ==== CONFIG DE TU API ====
const API_BASE = (process.env.API_BASE || "https://api-sky-test.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";

// Defaults
const DEFAULT_VIDEO_QUALITY = "360";
const DEFAULT_AUDIO_FORMAT = "mp3";
const MAX_MB = 99;

// Calidades válidas (de tu API)
const VALID_QUALITIES = new Set(["144", "240", "360", "720", "1080", "1440", "4k"]);

// Almacena tareas pendientes por previewMessageId
const pending = {};

// ---------- utils ----------
function safeName(name = "file") {
  return (
    String(name)
      .slice(0, 90)
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "file"
  );
}

function fileSizeMB(filePath) {
  const b = fs.statSync(filePath).size;
  return b / (1024 * 1024);
}

function ensureTmp() {
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function extractQualityFromText(input = "") {
  const t = String(input || "").toLowerCase();

  // 4k
  if (t.includes("4k")) return "4k";

  // 144|240|360|720|1080|1440 (con o sin p)
  const m = t.match(/\b(144|240|360|720|1080|1440)\s*p?\b/);
  if (m && VALID_QUALITIES.has(m[1])) return m[1];

  return "";
}

function splitQueryAndQuality(rawText = "") {
  // Permite: ".play ozuna 720" => query="ozuna", quality="720"
  // Si no hay calidad => query=rawText, quality=""
  const t = String(rawText || "").trim();
  if (!t) return { query: "", quality: "" };

  // busca quality al final
  const parts = t.split(/\s+/);
  const last = (parts[parts.length - 1] || "").toLowerCase();

  let q = "";
  if (last === "4k") q = "4k";
  else {
    const m = last.match(/^(144|240|360|720|1080|1440)p?$/i);
    if (m) q = m[1];
  }

  if (q) {
    parts.pop();
    return { query: parts.join(" ").trim(), quality: q };
  }
  return { query: t, quality: "" };
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

async function downloadToFile(url, filePath) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "*/*",
  };

  // si descargas desde TU API (/youtube/dl) necesitas apikey
  if (isApiUrl(url)) headers["apikey"] = API_KEY;

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 180000,
    headers,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    throw new Error(`HTTP_${res.status}`);
  }

  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

// ---------- API ----------
async function callYoutubeResolve(videoUrl, { type, quality, format }) {
  // POST /youtube/resolve
  const endpoint = `${API_BASE}/youtube/resolve`;

  const body =
    type === "video"
      ? { url: videoUrl, type: "video", quality: quality || DEFAULT_VIDEO_QUALITY }
      : { url: videoUrl, type: "audio", format: format || DEFAULT_AUDIO_FORMAT };

  const r = await axios.post(endpoint, body, {
    timeout: 120000,
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      Accept: "application/json, */*",
    },
    validateStatus: () => true,
  });

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON del servidor");

  const ok = data.status === true || data.status === "true" || data.ok === true || data.success === true;
  if (!ok) throw new Error(data.message || data.error || "Error en la API");

  const result = data.result || data.data || data;
  if (!result?.media) throw new Error("API sin media");

  // dl_download puede venir como "/youtube/dl?...."
  let dl = result.media.dl_download || "";
  if (dl && typeof dl === "string" && dl.startsWith("/")) dl = API_BASE + dl;

  // fallback directo
  const direct = result.media.direct || "";

  return {
    title: result.title || "YouTube",
    thumbnail: result.thumbnail || "",
    picked: result.picked || {},
    dl_download: dl,
    direct,
  };
}

// ---------- main ----------
module.exports = async (msg, { conn, text }) => {
  const pref = global.prefixes?.[0] || ".";

  // parse: ".play ozuna 720"
  const { query, quality } = splitQueryAndQuality(text);

  if (!query) {
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: `✳️ Usa:\n${pref}play <término> [calidad]\nEj: *${pref}play* bad bunny diles 720` },
      { quoted: msg }
    );
  }

  await conn.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });

  const res = await yts(query);
  const video = res.videos?.[0];
  if (!video) {
    return conn.sendMessage(msg.key.remoteJid, { text: "❌ Sin resultados." }, { quoted: msg });
  }

  const { url: videoUrl, title, timestamp: duration, views, author, thumbnail } = video;
  const viewsFmt = (views || 0).toLocaleString();

  // calidad elegida por el usuario (si no, default 360)
  const chosenQuality = VALID_QUALITIES.has(quality) ? quality : DEFAULT_VIDEO_QUALITY;

  const caption = `
❦𝑳𝑨 𝑺𝑼𝑲𝑰 𝑩𝑶𝑻❦

📀 𝙸𝚗𝚏𝚘:
❥ 𝑻𝒊𝒕𝒖𝒍𝒐: ${title}
❥ 𝑫𝒖𝒓𝒂𝒄𝒊𝒐𝒏: ${duration}
❥ 𝑽𝒊𝒔𝒕𝒂𝒔: ${viewsFmt}
❥ 𝑨𝒖𝒕𝒐𝒓: ${author?.name || author || "Desconocido"}
❥ 𝑳𝒊𝒏𝒌: ${videoUrl}

⚙️ Calidad video seleccionada: ${chosenQuality === "4k" ? "4K" : `${chosenQuality}p`} (default: 360p)
🎵 Audio: MP3

📥 Opciones:
☛ 👍 Audio MP3     (1 / audio)
☛ ❤️ Video         (2 / video)  -> usa ${chosenQuality === "4k" ? "4K" : `${chosenQuality}p`}
☛ 📄 Audio Doc     (4 / audiodoc)
☛ 📁 Video Doc     (3 / videodoc)

💡 Tip: También puedes responder:
- "video 720" o "2 720" (cambia calidad)
- "audio" (siempre mp3)

❦𝑳𝑨 𝑺𝑼𝑲𝑰 𝑩𝑶𝑻❦
`.trim();

  const preview = await conn.sendMessage(
    msg.key.remoteJid,
    { image: { url: thumbnail }, caption },
    { quoted: msg }
  );

  pending[preview.key.id] = {
    chatId: msg.key.remoteJid,
    videoUrl,
    title,
    thumbnail,
    commandMsg: msg,
    videoQuality: chosenQuality, // ✅ aquí queda guardado
  };

  await conn.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });

  // listener único
  if (!conn._playproListener) {
    conn._playproListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        // 1) REACCIONES
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pending[reactKey.id];
          if (job) await handleDownload(conn, job, emoji, job.commandMsg, "");
        }

        // 2) RESPUESTAS CITADAS
        try {
          const context = m.message?.extendedTextMessage?.contextInfo;
          const citado = context?.stanzaId;

          const textoRaw =
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            "";
          const texto = String(textoRaw || "").trim().toLowerCase();

          const job = pending[citado];
          const chatId = m.key.remoteJid;

          if (citado && job) {
            // permite "video 720" o "2 720"
            const qFromReply = extractQualityFromText(texto);

            // AUDIO
            if (["1", "audio", "4", "audiodoc"].includes(texto.split(/\s+/)[0])) {
              const docMode = texto.startsWith("4") || texto.includes("audiodoc");
              await conn.sendMessage(chatId, { react: { text: docMode ? "📄" : "🎵", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎶 Descargando audio (mp3)...` }, { quoted: m });
              await downloadAudio(conn, job, docMode, m);
            }
            // VIDEO
            else if (["2", "video", "3", "videodoc"].includes(texto.split(/\s+/)[0])) {
              const docMode = texto.startsWith("3") || texto.includes("videodoc");

              // si el usuario especificó quality en la respuesta, úsalo
              const useQuality = VALID_QUALITIES.has(qFromReply) ? qFromReply : (job.videoQuality || DEFAULT_VIDEO_QUALITY);

              await conn.sendMessage(chatId, { react: { text: docMode ? "📁" : "🎬", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎥 Descargando video (${useQuality === "4k" ? "4K" : useQuality + "p"})...` }, { quoted: m });
              await downloadVideo(conn, { ...job, videoQuality: useQuality }, docMode, m);
            } else {
              await conn.sendMessage(
                chatId,
                { text: `⚠️ Opciones:\n1/audio, 4/audiodoc → audio\n2/video, 3/videodoc → video\n\nEj: "video 720"` },
                { quoted: m }
              );
            }

            if (!job._timer) {
              job._timer = setTimeout(() => delete pending[citado], 5 * 60 * 1000);
            }
          }
        } catch (e) {
          console.error("Error en detector citado:", e);
        }
      }
    });
  }
};

async function handleDownload(conn, job, choice, quoted, extraText) {
  const mapping = { "👍": "audio", "❤️": "video", "📄": "audioDoc", "📁": "videoDoc" };
  const key = mapping[choice];
  if (!key) return;

  const isDoc = key.endsWith("Doc");

  if (key.startsWith("audio")) {
    await conn.sendMessage(job.chatId, { text: `⏳ Descargando audio (mp3)...` }, { quoted: quoted || job.commandMsg });
    return downloadAudio(conn, job, isDoc, quoted || job.commandMsg);
  }

  // video
  const useQuality = job.videoQuality || DEFAULT_VIDEO_QUALITY;
  await conn.sendMessage(job.chatId, { text: `⏳ Descargando video (${useQuality === "4k" ? "4K" : useQuality + "p"})...` }, { quoted: quoted || job.commandMsg });
  return downloadVideo(conn, job, isDoc, quoted || job.commandMsg);
}

async function downloadAudio(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;

  let resolved;
  try {
    resolved = await callYoutubeResolve(videoUrl, { type: "audio", format: DEFAULT_AUDIO_FORMAT });
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error API (audio): ${e.message}` }, { quoted });
    return;
  }

  const mediaUrl = resolved.dl_download || resolved.direct;
  if (!mediaUrl) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo obtener audio." }, { quoted });
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);

  const inFile = path.join(tmp, `${Date.now()}_in.bin`);
  await downloadToFile(mediaUrl, inFile);

  // Convertir a mp3 siempre (si falla, manda como doc)
  const outMp3 = path.join(tmp, `${Date.now()}_${base}.mp3`);
  let outFile = outMp3;

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inFile)
        .audioCodec("libmp3lame")
        .audioBitrate("128k")
        .format("mp3")
        .save(outMp3)
        .on("end", resolve)
        .on("error", reject);
    });
    try { fs.unlinkSync(inFile); } catch {}
  } catch {
    outFile = inFile;
    asDocument = true;
  }

  const sizeMB = fileSizeMB(outFile);
  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(outFile); } catch {}
    await conn.sendMessage(chatId, { text: `❌ El audio pesa ${sizeMB.toFixed(2)}MB (> ${MAX_MB}MB).` }, { quoted });
    return;
  }

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "audio"]: fs.readFileSync(outFile),
      mimetype: "audio/mpeg",
      fileName: `${base}.mp3`,
    },
    { quoted }
  );

  try { fs.unlinkSync(outFile); } catch {}
}

async function downloadVideo(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;

  const q = VALID_QUALITIES.has(job.videoQuality) ? job.videoQuality : DEFAULT_VIDEO_QUALITY;

  let resolved;
  try {
    resolved = await callYoutubeResolve(videoUrl, { type: "video", quality: q });
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error API (video): ${e.message}` }, { quoted });
    return;
  }

  const mediaUrl = resolved.dl_download || resolved.direct;
  if (!mediaUrl) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo obtener video." }, { quoted });
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);
  const tag = q === "4k" ? "4k" : `${q}p`;
  const file = path.join(tmp, `${Date.now()}_${base}_${tag}.mp4`);

  await downloadToFile(mediaUrl, file);

  const sizeMB = fileSizeMB(file);
  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(file); } catch {}
    await conn.sendMessage(chatId, { text: `❌ El video pesa ${sizeMB.toFixed(2)}MB (> ${MAX_MB}MB).` }, { quoted });
    return;
  }

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "video"]: fs.readFileSync(file),
      mimetype: "video/mp4",
      fileName: `${base}_${tag}.mp4`,
      caption: asDocument ? undefined : `🎬 Aquí está tu video (${tag})`,
    },
    { quoted }
  );

  try { fs.unlinkSync(file); } catch {}
}

module.exports.command = ["play"];
