// commands/yt.js — YouTube por URL (audio/video + calidades) usando /youtube/resolve
"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { promisify } = require("util");
const { pipeline } = require("stream");
const streamPipe = promisify(pipeline);

// ==== CONFIG DE TU API ====
const API_BASE = (process.env.API_BASE || "https://api-sky-test.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";

// Defaults
const DEFAULT_VIDEO_QUALITY = "360";
const DEFAULT_AUDIO_FORMAT  = "mp3";
const MAX_MB = Number(process.env.MAX_MB || 99);

// Calidades válidas (de tu API)
const VALID_QUALITIES = new Set(["144", "240", "360", "720", "1080", "1440", "4k"]);

// Jobs pendientes por id del mensaje preview
const pendingYT = Object.create(null);

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
function ensureTmp() {
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}
function fileSizeMB(filePath) {
  const b = fs.statSync(filePath).size;
  return b / (1024 * 1024);
}
function isYouTube(u = "") {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(String(u || ""));
}
function extractQualityFromText(input = "") {
  const t = String(input || "").toLowerCase();
  if (t.includes("4k")) return "4k";
  const m = t.match(/\b(144|240|360|720|1080|1440)\s*p?\b/);
  if (m && VALID_QUALITIES.has(m[1])) return m[1];
  return "";
}
function splitUrlAndQuality(rawText = "") {
  // Permite: ".yt <url> 720"
  const t = String(rawText || "").trim();
  if (!t) return { url: "", quality: "" };

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
    return { url: parts.join(" ").trim(), quality: q };
  }
  return { url: t, quality: "" };
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

  if (res.status >= 400) throw new Error(`HTTP_${res.status}`);

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

  const direct = result.media.direct || "";

  return {
    title: result.title || "YouTube",
    thumbnail: result.thumbnail || "",
    picked: result.picked || {},
    dl_download: dl,
    direct,
  };
}

// ---------- envío ----------
async function sendAudioMp3(conn, job, asDocument, triggerMsg) {
  const { chatId, ytUrl, title, quotedBase, previewKey } = job;

  try {
    await conn.sendMessage(chatId, { react: { text: asDocument ? "📄" : "🎵", key: triggerMsg.key } });
    try { await conn.sendMessage(chatId, { react: { text: "⏳", key: previewKey } }); } catch {}

    const resolved = await callYoutubeResolve(ytUrl, { type: "audio", format: DEFAULT_AUDIO_FORMAT });
    const mediaUrl = resolved.dl_download || resolved.direct;
    if (!mediaUrl) throw new Error("No se pudo obtener audio");

    const tmp = ensureTmp();
    const base = safeName(title || resolved.title || "youtube");
    const inFile = path.join(tmp, `${Date.now()}_in.bin`);
    const outMp3 = path.join(tmp, `${Date.now()}_${base}.mp3`);

    await downloadToFile(mediaUrl, inFile);

    // Convertir SIEMPRE a mp3 (si falla: manda como documento el bin)
    let outFile = outMp3;
    let forceDoc = asDocument;

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
      forceDoc = true;
    }

    const sizeMB = fileSizeMB(outFile);
    if (sizeMB > MAX_MB) {
      try { fs.unlinkSync(outFile); } catch {}
      throw new Error(`El audio pesa ${sizeMB.toFixed(2)}MB (> ${MAX_MB}MB)`);
    }

    const buf = fs.readFileSync(outFile);

    await conn.sendMessage(
      chatId,
      forceDoc
        ? { document: buf, mimetype: "audio/mpeg", fileName: `${base}.mp3` }
        : { audio: buf, mimetype: "audio/mpeg", fileName: `${base}.mp3` },
      { quoted: quotedBase || triggerMsg }
    );

    try { fs.unlinkSync(outFile); } catch {}

    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: previewKey } }); } catch {}
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: previewKey } }); } catch {}
    await conn.sendMessage(chatId, { text: `❌ Error audio: ${e?.message || "unknown"}` }, { quoted: quotedBase || triggerMsg });
  }
}

async function sendVideoMp4(conn, job, asDocument, triggerMsg, qualityOverride = "") {
  const { chatId, ytUrl, title, quotedBase, previewKey } = job;

  try {
    const q = VALID_QUALITIES.has(qualityOverride)
      ? qualityOverride
      : (VALID_QUALITIES.has(job.videoQuality) ? job.videoQuality : DEFAULT_VIDEO_QUALITY);

    await conn.sendMessage(chatId, { react: { text: asDocument ? "📁" : "🎬", key: triggerMsg.key } });
    try { await conn.sendMessage(chatId, { react: { text: "⏳", key: previewKey } }); } catch {}

    const resolved = await callYoutubeResolve(ytUrl, { type: "video", quality: q });
    const mediaUrl = resolved.dl_download || resolved.direct;
    if (!mediaUrl) throw new Error("No se pudo obtener video");

    const tmp = ensureTmp();
    const base = safeName(title || resolved.title || "youtube");
    const tag = q === "4k" ? "4k" : `${q}p`;
    const file = path.join(tmp, `${Date.now()}_${base}_${tag}.mp4`);

    await downloadToFile(mediaUrl, file);

    const sizeMB = fileSizeMB(file);
    if (sizeMB > MAX_MB) {
      try { fs.unlinkSync(file); } catch {}
      throw new Error(`El video pesa ${sizeMB.toFixed(2)}MB (> ${MAX_MB}MB)`);
    }

    const buf = fs.readFileSync(file);
    await conn.sendMessage(
      chatId,
      {
        [asDocument ? "document" : "video"]: buf,
        mimetype: "video/mp4",
        fileName: `${base}_${tag}.mp4`,
        caption: asDocument ? undefined : `🎬 Video listo (${tag})`,
      },
      { quoted: quotedBase || triggerMsg }
    );

    try { fs.unlinkSync(file); } catch {}

    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });
    try { await conn.sendMessage(chatId, { react: { text: "✅", key: previewKey } }); } catch {}
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: previewKey } }); } catch {}
    await conn.sendMessage(chatId, { text: `❌ Error video: ${e?.message || "unknown"}` }, { quoted: quotedBase || triggerMsg });
  }
}

// ---------- main ----------
module.exports = async (msg, { conn, text, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  const { url, quality } = splitUrlAndQuality(text);

  if (!url || !isYouTube(url)) {
    return conn.sendMessage(
      chatId,
      { text: `✳️ Usa:\n${pref}${command} <url> [calidad]\nEj: ${pref}${command} https://youtu.be/dQw4w9WgXcQ 720` },
      { quoted: msg }
    );
  }

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    const chosenQuality = VALID_QUALITIES.has(quality) ? quality : DEFAULT_VIDEO_QUALITY;

    // Para preview sacamos info rápido (audio resolve)
    const info = await callYoutubeResolve(url, { type: "audio", format: DEFAULT_AUDIO_FORMAT });

    const title = info.title || "YouTube";
    const thumb = info.thumbnail || "";

    const caption = `
❦𝑳𝑨 𝑺𝑼𝑲𝑰 𝑩𝑶𝑻❦

📀 𝙸𝚗𝚏𝚘:
❥ 𝑻𝒊𝒕𝒖𝒍𝒐: ${title}
❥ 𝑳𝒊𝒏𝒌: ${url}

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

    const preview = thumb
      ? await conn.sendMessage(chatId, { image: { url: thumb }, caption }, { quoted: msg })
      : await conn.sendMessage(chatId, { text: caption }, { quoted: msg });

    pendingYT[preview.key.id] = {
      chatId,
      ytUrl: url,
      title,
      quotedBase: msg,
      previewKey: preview.key,
      videoQuality: chosenQuality,
      processing: false,
      createdAt: Date.now(),
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    // listener único
    if (!conn._ytUrlListener) {
      conn._ytUrlListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // limpiar jobs viejos (10 min)
            for (const k of Object.keys(pendingYT)) {
              if (Date.now() - (pendingYT[k]?.createdAt || 0) > 10 * 60 * 1000) delete pendingYT[k];
            }

            // 1) REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingYT[reactKey.id];
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;
              if (job.processing) continue;

              // 👍 audio, ❤️ video, 📄 audiodoc, 📁 videodoc
              if (!["👍", "❤️", "📄", "📁"].includes(emoji)) continue;

              job.processing = true;

              if (emoji === "👍") await sendAudioMp3(conn, job, false, m);
              else if (emoji === "📄") await sendAudioMp3(conn, job, true, m);
              else if (emoji === "❤️") await sendVideoMp4(conn, job, false, m, "");
              else if (emoji === "📁") await sendVideoMp4(conn, job, true, m, "");

              delete pendingYT[reactKey.id];
              continue;
            }

            // 2) RESPUESTAS CITADAS
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            const raw =
              m.message?.conversation ||
              m.message?.extendedTextMessage?.text ||
              "";
            const txt = String(raw || "").trim().toLowerCase();

            if (replyTo && pendingYT[replyTo]) {
              const job = pendingYT[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;
              if (job.processing) continue;

              const qFromReply = extractQualityFromText(txt);
              const first = (txt.split(/\s+/)[0] || "");

              // audio
              if (["1", "audio", "4", "audiodoc"].includes(first)) {
                job.processing = true;
                const asDoc = first === "4" || txt.includes("audiodoc");
                await sendAudioMp3(conn, job, asDoc, m);
                delete pendingYT[replyTo];
              }
              // video
              else if (["2", "video", "3", "videodoc"].includes(first)) {
                job.processing = true;
                const asDoc = first === "3" || txt.includes("videodoc");
                const useQ = VALID_QUALITIES.has(qFromReply) ? qFromReply : (job.videoQuality || DEFAULT_VIDEO_QUALITY);
                await sendVideoMp4(conn, job, asDoc, m, useQ);
                delete pendingYT[replyTo];
              } else {
                await conn.sendMessage(
                  job.chatId,
                  { text: `⚠️ Opciones:\n1/audio, 4/audiodoc → audio\n2/video, 3/videodoc → video\n\nEj: "video 720"` },
                  { quoted: m }
                );
              }
            }
          } catch (e) {
            console.error("YT URL listener error:", e?.message || e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error yt(url):", err?.message || err);
    await conn.sendMessage(chatId, { text: `❌ Error: ${err?.message || "unknown"}` }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

module.exports.command = ["yt", "yta", "ytv", "ytmp3"];
module.exports.help = ["yt <url> [calidad]"];
module.exports.tags = ["descargas"];
module.exports.register = true;
