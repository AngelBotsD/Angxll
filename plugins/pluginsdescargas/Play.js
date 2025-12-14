
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
const API_BASE = process.env.API_BASE || "https://api-sky-test.ultraplus.click";
const API_KEY = process.env.API_KEY || "Russellxz";

// Siempre usar estas opciones
const DEFAULT_VIDEO_QUALITY = "360";
const DEFAULT_AUDIO_FORMAT = "mp3";

const pending = {};

// ---------- utils ----------
async function downloadToFile(url, filePath) {
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 120000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    maxRedirects: 5,
  });
  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

function fileSizeMB(filePath) {
  const b = fs.statSync(filePath).size;
  return b / (1024 * 1024);
}

function safeName(name = "file") {
  return String(name)
    .slice(0, 90)
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "file";
}

function pickFromObjByKey(obj, keys = []) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    if (obj[k] && typeof obj[k] === "string") return obj[k];
  }
  return "";
}

function pickUrlFlexible(media, want) {
  // want: { type: 'video'|'audio', quality?:'360', format?:'mp3' }
  if (!media) return "";

  // 1) string directo
  if (typeof media === "string") return media;

  // 2) array de items [{quality, url}, {q, link}, ...]
  if (Array.isArray(media)) {
    const norm = (x) => String(x ?? "").toLowerCase();

    if (want.type === "video") {
      const q = String(want.quality || "360");
      const found =
        media.find((it) => String(it?.quality || it?.q || it?.res || "").includes(q) && (it?.url || it?.link || it?.download)) ||
        media.find((it) => String(it?.quality || it?.q || it?.res || "").includes(q + "p") && (it?.url || it?.link || it?.download)) ||
        media.find((it) => norm(it?.name).includes(q) && (it?.url || it?.link || it?.download));
      if (found) return String(found.url || found.link || found.download || "");
      // fallback primero
      const any = media.find((it) => it?.url || it?.link || it?.download);
      return any ? String(any.url || any.link || any.download || "") : "";
    }

    if (want.type === "audio") {
      const f = String(want.format || "mp3").toLowerCase();
      const found =
        media.find((it) => norm(it?.format || it?.ext || it?.type || it?.name).includes(f) && (it?.url || it?.link || it?.download)) ||
        media.find((it) => norm(it?.name).endsWith("." + f) && (it?.url || it?.link || it?.download));
      if (found) return String(found.url || found.link || found.download || "");
      const any = media.find((it) => it?.url || it?.link || it?.download);
      return any ? String(any.url || any.link || any.download || "") : "";
    }
  }

  // 3) objeto de calidades { "360": "url", "720": "url" } o { mp3:"url" }
  if (typeof media === "object") {
    if (want.type === "video") {
      const q = String(want.quality || "360");
      return (
        pickFromObjByKey(media, [q, q + "p", "360", "360p", "sd", "low"]) ||
        pickFromObjByKey(media, ["url", "downloadUrl", "download", "link", "src"])
      );
    }
    if (want.type === "audio") {
      const f = String(want.format || "mp3").toLowerCase();
      return (
        pickFromObjByKey(media, [f, "mp3", "m4a", "webm", "ogg", "wav"]) ||
        pickFromObjByKey(media, ["url", "downloadUrl", "download", "link", "src"])
      );
    }
  }

  return "";
}

// ---------- API ----------
async function callYoutubeApi(videoUrl) {
  // POST https://api-sky-test.ultraplus.click/youtube
  // Headers: apikey: KEY  (o Authorization: Bearer KEY)
  // Body: { url: "..." }
  const endpoint = `${API_BASE.replace(/\/+$/, "")}/youtube`;

  const r = await axios.post(
    endpoint,
    { url: videoUrl },
    {
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        // Authorization: `Bearer ${API_KEY}`, // (por si quieres usar este en vez de apikey)
        Accept: "application/json, */*",
      },
      validateStatus: () => true,
    }
  );

  const txt = typeof r.data === "string" ? r.data : "";
  if (txt && !txt.trim().startsWith("{") && !txt.trim().startsWith("[")) {
    // cuando devuelve HTML/texto
    throw new Error("Respuesta no JSON del servidor");
  }

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("API inválida");

  // Normaliza: status true/false
  const ok =
    data.status === true ||
    data.status === "true" ||
    data.ok === true ||
    data.success === true;

  if (!ok) {
    throw new Error(data.message || data.error || "Error en la API");
  }

  // resultado puede venir en: result | data
  const result = data.result || data.data || data;
  if (!result) throw new Error("API sin result");

  return result;
}

function buildMediaLinks(apiResult) {
  // buscamos video/audio en muchos nombres posibles
  const videoBlock =
    apiResult.video ||
    apiResult.videos ||
    apiResult.media?.video ||
    apiResult.media?.videos ||
    apiResult.links?.video ||
    apiResult.links?.videos ||
    apiResult.download?.video ||
    apiResult.downloads?.video ||
    apiResult.formats?.video ||
    apiResult.quality ||
    apiResult.qualities ||
    null;

  const audioBlock =
    apiResult.audio ||
    apiResult.audios ||
    apiResult.media?.audio ||
    apiResult.media?.audios ||
    apiResult.links?.audio ||
    apiResult.download?.audio ||
    apiResult.downloads?.audio ||
    apiResult.formats?.audio ||
    null;

  const pickedVideo = pickUrlFlexible(videoBlock, { type: "video", quality: DEFAULT_VIDEO_QUALITY });
  const pickedAudio = pickUrlFlexible(audioBlock, { type: "audio", format: DEFAULT_AUDIO_FORMAT });

  // mini fallbacks si viniera invertido
  const anyUrl =
    (typeof apiResult.url === "string" && apiResult.url) ||
    (typeof apiResult.downloadUrl === "string" && apiResult.downloadUrl) ||
    "";

  return {
    video: pickedVideo || "",
    audio: pickedAudio || "",
    any: anyUrl || "",
    title: apiResult.title || apiResult.name || "YouTube",
    thumbnail: apiResult.thumbnail || apiResult.cover || apiResult.image || "",
  };
}

// ---------- main ----------
module.exports = async (msg, { conn, text }) => {
  const pref = global.prefixes?.[0] || ".";

  if (!text || !text.trim()) {
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: `✳️ Usa:\n${pref}play <término>\nEj: *${pref}play* bad bunny diles` },
      { quoted: msg }
    );
  }

  await conn.sendMessage(msg.key.remoteJid, {
    react: { text: "⏳", key: msg.key },
  });

  const res = await yts(text);
  const video = res.videos?.[0];
  if (!video) {
    return conn.sendMessage(msg.key.remoteJid, { text: "❌ Sin resultados." }, { quoted: msg });
  }

  const { url: videoUrl, title, timestamp: duration, views, author, thumbnail } = video;
  const viewsFmt = (views || 0).toLocaleString();

  const caption = `
❦𝑳𝑨 𝑺𝑼𝑲𝑰 𝑩𝑶𝑻❦

📀 𝙸𝚗𝚏𝚘:
❥ 𝑻𝒊𝒕𝒖𝒍𝒐: ${title}
❥ 𝑫𝒖𝒓𝒂𝒄𝒊𝒐𝒏: ${duration}
❥ 𝑽𝒊𝒔𝒕𝒂𝒔: ${viewsFmt}
❥ 𝑨𝒖𝒕𝒐𝒓: ${author?.name || author || "Desconocido"}
❥ 𝑳𝒊𝒏𝒌: ${videoUrl}

📥 Opciones:
☛ 👍 Audio MP3     (1 / audio)
☛ ❤️ Video 360p    (2 / video)
☛ 📄 Audio Doc     (4 / audiodoc)
☛ 📁 Video Doc     (3 / videodoc)

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
    commandMsg: msg,
  };

  await conn.sendMessage(msg.key.remoteJid, {
    react: { text: "✅", key: msg.key },
  });

  if (!conn._playproListener) {
    conn._playproListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        // REACCIONES
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pending[reactKey.id];
          if (job) {
            await handleDownload(conn, job, emoji, job.commandMsg);
          }
        }

        // RESPUESTAS CITADAS
        try {
          const context = m.message?.extendedTextMessage?.contextInfo;
          const citado = context?.stanzaId;

          const texto = (
            m.message?.conversation?.toLowerCase() ||
            m.message?.extendedTextMessage?.text?.toLowerCase() ||
            ""
          ).trim();

          const job = pending[citado];
          const chatId = m.key.remoteJid;

          if (citado && job) {
            // AUDIO
            if (["1", "audio", "4", "audiodoc"].includes(texto)) {
              const docMode = ["4", "audiodoc"].includes(texto);
              await conn.sendMessage(chatId, { react: { text: docMode ? "📄" : "🎵", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎶 Descargando audio...` }, { quoted: m });
              await downloadAudio(conn, job, docMode, m);
            }
            // VIDEO
            else if (["2", "video", "3", "videodoc"].includes(texto)) {
              const docMode = ["3", "videodoc"].includes(texto);
              await conn.sendMessage(chatId, { react: { text: docMode ? "📁" : "🎬", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎥 Descargando video...` }, { quoted: m });
              await downloadVideo(conn, job, docMode, m);
            } else {
              await conn.sendMessage(
                chatId,
                { text: `⚠️ Opciones:\n1/audio, 4/audiodoc → audio\n2/video, 3/videodoc → video` },
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

async function handleDownload(conn, job, choice, quoted) {
  const mapping = {
    "👍": "audio",
    "❤️": "video",
    "📄": "audioDoc",
    "📁": "videoDoc",
  };

  const key = mapping[choice];
  if (!key) return;

  const isDoc = key.endsWith("Doc");
  await conn.sendMessage(
    job.chatId,
    { text: `⏳ Descargando...` },
    { quoted: quoted || job.commandMsg }
  );

  if (key.startsWith("audio")) return downloadAudio(conn, job, isDoc, quoted || job.commandMsg);
  return downloadVideo(conn, job, isDoc, quoted || job.commandMsg);
}

async function downloadAudio(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;

  const apiResult = await callYoutubeApi(videoUrl);
  const links = buildMediaLinks(apiResult);

  const mediaUrl = links.audio || "";
  if (!mediaUrl) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo obtener audio." }, { quoted });
    return;
  }

  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  const base = safeName(title);
  const inFile = path.join(tmp, `${Date.now()}_in.bin`);
  await downloadToFile(mediaUrl, inFile);

  // Convertir a mp3 si hace falta
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
  } catch {
    // fallback: manda lo que bajó como doc
    outFile = inFile;
    asDocument = true;
  }

  // limpiar input si se convirtió
  if (outFile === outMp3) {
    try { fs.unlinkSync(inFile); } catch {}
  }

  const sizeMB = fileSizeMB(outFile);
  if (sizeMB > 99) {
    try { fs.unlinkSync(outFile); } catch {}
    await conn.sendMessage(chatId, { text: `❌ El audio pesa ${sizeMB.toFixed(2)}MB (>99MB).` }, { quoted });
    return;
  }

  const buffer = fs.readFileSync(outFile);

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "audio"]: buffer,
      mimetype: "audio/mpeg",
      fileName: `${base}.mp3`,
    },
    { quoted }
  );

  try { fs.unlinkSync(outFile); } catch {}
}

async function downloadVideo(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;

  const apiResult = await callYoutubeApi(videoUrl);
  const links = buildMediaLinks(apiResult);

  const mediaUrl = links.video || "";
  if (!mediaUrl) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo obtener video." }, { quoted });
    return;
  }

  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  const base = safeName(title);
  const file = path.join(tmp, `${Date.now()}_${base}_360p.mp4`);

  await downloadToFile(mediaUrl, file);

  const sizeMB = fileSizeMB(file);
  if (sizeMB > 99) {
    try { fs.unlinkSync(file); } catch {}
    await conn.sendMessage(chatId, { text: `❌ El video pesa ${sizeMB.toFixed(2)}MB (>99MB).` }, { quoted });
    return;
  }

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "video"]: fs.readFileSync(file),
      mimetype: "video/mp4",
      fileName: `${base}_360p.mp4`,
      caption: asDocument ? undefined : `🎬 Aquí está tu video (360p)`,
    },
    { quoted }
  );

  try { fs.unlinkSync(file); } catch {}
}

// comando
module.exports.command = ["play"];
