// plugins/py.js — YouTube -> VIDEO/AUDIO con fallback a yt-dlp si googlevideo da 403
// Requiere: ffmpeg y yt-dlp instalados en el contenedor

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const axios = require("axios");

const sh = promisify(exec);

// ===== Config =====
const API_BASE = process.env.PY_API || "https://ytpy.ultraplus.click";
const ENDPOINT = "/download";
const TMP_DIR = path.join(__dirname, "../tmp");
const MAX_WA_MB = 100; // límite razonable de WhatsApp (~100 MB)

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// cache de trabajos (id del mensaje de selección -> job)
const pendingPY = global._pendingPY_FF || (global._pendingPY_FF = Object.create(null));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isYouTube = (u) => /^https?:\/\//i.test(u) && /(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(u);
const mb = (b) => (b / (1024 * 1024)).toFixed(2);

// ===== API ytpy.ultraplus.click =====
async function callYTPY(url, option) {
  let lastErr = null;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await axios.post(`${API_BASE}${ENDPOINT}`, { url, option }, {
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        validateStatus: () => true
      });
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(1000 * i);
        continue;
      }
      if (res.status !== 200) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(1000 * i);
        continue;
      }
      const body = res.data || {};
      const ok = body.success === true ||
                 body.status === true ||
                 (typeof body.status === "string" && body.status.toLowerCase() === "success");
      const mediaUrl =
        body.url ??
        (typeof body.result === "string" ? body.result : undefined) ??
        body?.result?.url ??
        body?.data?.url ??
        (Array.isArray(body?.links) ? body.links[0]?.url : undefined);

      const title =
        body.title ?? body?.result?.title ?? body?.data?.title ?? "YouTube";

      if (!ok && !mediaUrl) {
        lastErr = new Error(`API inválida: ${JSON.stringify(body)}`);
        await sleep(1000 * i);
        continue;
      }
      if (!mediaUrl) {
        lastErr = new Error("El API no devolvió URL.");
        await sleep(1000 * i);
        continue;
      }
      return { mediaUrl, title };
    } catch (e) {
      lastErr = e;
      await sleep(1000 * i);
    }
  }
  throw lastErr || new Error("No se pudo obtener el recurso.");
}

// ===== ffmpeg directo (primera opción) =====
async function downloadWithFfmpeg(inputUrl, outPath, kind /* "video"|"audio" */) {
  const ua = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
  let cmd;
  if (kind === "audio") {
    cmd = `ffmpeg -hide_banner -loglevel error -user_agent "${ua}" -protocol_whitelist file,http,https,tcp,tls -i "${inputUrl}" -vn -c:a libmp3lame -b:a 192k -y "${outPath}"`;
  } else {
    cmd = `ffmpeg -hide_banner -loglevel error -user_agent "${ua}" -protocol_whitelist file,http,https,tcp,tls -i "${inputUrl}" -c copy -bsf:a aac_adtstoasc -y "${outPath}"`;
  }
  try {
    await sh(cmd, { timeout: 0, maxBuffer: 1024 * 1024 * 100 });
    return outPath;
  } catch (e) {
    // Señalamos 403 para activar fallback
    const s = (e.stderr || e.stdout || e.message || "").toLowerCase();
    if (s.includes("403") || s.includes("forbidden") || s.includes("access denied")) {
      const err = new Error("FFMPEG_FORBIDDEN");
      err.code = "FFMPEG_FORBIDDEN";
      throw err;
    }
    throw e;
  }
}

// ===== yt-dlp (fallback) =====
async function downloadWithYtDlp(youtubeUrl, outPath, kind /* "video"|"audio" */) {
  // Asegúrate de tener yt-dlp en PATH (o instala con apt/pip)
  if (kind === "audio") {
    const tmp = outPath.replace(/\.mp3$/i, "");
    const cmd = `yt-dlp -x --audio-format mp3 -o "${tmp}.%(ext)s" "${youtubeUrl}"`;
    await sh(cmd, { timeout: 0, maxBuffer: 1024 * 1024 * 100 });
    // yt-dlp nombra según ext -> buscamos .mp3 generado
    const base = path.basename(tmp);
    const dir = path.dirname(tmp);
    const files = fs.readdirSync(dir).filter(f => f.startsWith(base) && f.endsWith(".mp3"));
    if (!files.length) throw new Error("yt-dlp no generó mp3");
    fs.renameSync(path.join(dir, files[0]), outPath);
    return outPath;
  } else {
    const cmd = `yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best" --merge-output-format mp4 -o "${outPath}" "${youtubeUrl}"`;
    await sh(cmd, { timeout: 0, maxBuffer: 1024 * 1024 * 100 });
    if (!fs.existsSync(outPath)) throw new Error("yt-dlp no generó mp4");
    return outPath;
  }
}

// ===== Descargar (intenta API+ffmpeg -> fallback yt-dlp) =====
async function downloadSmart({ youtubeUrl, option }) {
  const stamp = Date.now();
  const outPath = path.join(TMP_DIR, `${option}_${stamp}.${option === "audio" ? "mp3" : "mp4"}`);

  // 1) intentar con API + ffmpeg (rápido si el enlace sirve)
  try {
    const { mediaUrl, title } = await callYTPY(youtubeUrl, option);
    const t0 = Date.now();
    await downloadWithFfmpeg(mediaUrl, outPath, option);
    return { outPath, tookSec: ((Date.now() - t0) / 1000).toFixed(1), title };
  } catch (e) {
    // 2) si es 403/forbidden u otro error, caemos a yt-dlp
    const t0 = Date.now();
    const res = await downloadWithYtDlp(youtubeUrl, outPath, option);
    return { outPath: res, tookSec: ((Date.now() - t0) / 1000).toFixed(1), title: "YouTube" };
  }
}

// ===== Envío después de elegir =====
async function sendMedia(conn, job, option, triggerMsg) {
  const { chatId, url, baseMsg } = job;

  await conn.sendMessage(chatId, { react: { text: option === "audio" ? "🎵" : "🎬", key: triggerMsg.key } });
  await conn.sendMessage(chatId, { text: `⏳ Procesando ${option === "audio" ? "música" : "video"}…` }, { quoted: baseMsg });

  // descarga inteligente
  const { outPath, tookSec, title } = await downloadSmart({ youtubeUrl: url, option });

  if (!fs.existsSync(outPath)) {
    await conn.sendMessage(chatId, { text: "❌ Error al procesar el archivo." }, { quoted: baseMsg });
    return;
  }

  const sizeMB = Number(mb(fs.statSync(outPath).size));
  if (sizeMB > MAX_WA_MB) {
    try { fs.unlinkSync(outPath); } catch {}
    await conn.sendMessage(chatId, {
      text: `❌ El archivo pesa *${sizeMB} MB* y excede el límite de WhatsApp (~${MAX_WA_MB} MB).\nPrueba con otra calidad o un video más corto.`
    }, { quoted: baseMsg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
    return;
  }

  const caption =
`📥 Descarga lista
• Título: ${title}
• Formato: ${option === "audio" ? "MP3" : "MP4"}
• Tamaño: ${sizeMB} MB
• Tiempo: ${tookSec}s
• Método: ${option === "audio" ? "ffmpeg/yt-dlp" : "ffmpeg/yt-dlp"}`;

  try {
    if (option === "audio") {
      await conn.sendMessage(chatId, {
        audio: fs.readFileSync(outPath),
        mimetype: "audio/mpeg",
        fileName: `${title}.mp3`,
        ptt: false
      }, { quoted: baseMsg });
    } else {
      await conn.sendMessage(chatId, {
        video: fs.readFileSync(outPath),
        mimetype: "video/mp4",
        caption
      }, { quoted: baseMsg });
    }
    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });
  } finally {
    try { fs.unlinkSync(outPath); } catch {}
  }
}

// ===== Handler principal =====
const handler = async (msg, { conn, args, command, usedPrefix }) => {
  const jid = msg.key.remoteJid;
  const url = (args.join(" ") || "").trim();
  const pref = usedPrefix || global.prefix || ".";

  if (!url) {
    return conn.sendMessage(jid, {
      text: `✳️ *Uso:*\n${pref}${command} <url de YouTube>\nEj: ${pref}${command} https://youtu.be/xxxxxx`
    }, { quoted: msg });
  }
  if (!isYouTube(url)) {
    return conn.sendMessage(jid, { text: "❌ *URL de YouTube inválida.*" }, { quoted: msg });
  }

  await conn.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
  const selector = await conn.sendMessage(jid, {
    text: `📥 𝗬𝗧 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱𝗲𝗿\n\nElige formato para *${url}*:\n👍 𝗩𝗶𝗱𝗲𝗼 (MP4)\n🎵 𝗔𝘂𝗱𝗶𝗼 (MP3)\n— o responde: 1 = video · 2 = audio`
  }, { quoted: msg });

  pendingPY[selector.key.id] = { chatId: jid, url, baseMsg: msg };
  await conn.sendMessage(jid, { react: { text: "✅", key: msg.key } });

  if (!conn._pyFFListener) {
    conn._pyFFListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        try {
          // Reacciones
          const rx = m.message?.reactionMessage;
          if (rx) {
            const reactedTo = rx.key?.id;
            const emoji = rx.text;
            const job = pendingPY[reactedTo];
            if (job) {
              let opt = null;
              if (emoji === "👍") opt = "video";
              if (emoji === "🎵" || emoji === "🎶" || emoji === "🎧") opt = "audio";
              if (opt) {
                delete pendingPY[reactedTo];
                await sendMedia(conn, job, opt, m);
              }
            }
          }

          // Respuesta 1 / 2
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          const replyTo = ctx?.stanzaId;
          const txt = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim().toLowerCase();
          if (replyTo && pendingPY[replyTo]) {
            if (txt === "1" || txt === "2") {
              const opt = txt === "1" ? "video" : "audio";
              const job = pendingPY[replyTo];
              delete pendingPY[replyTo];
              await sendMedia(conn, job, opt, m);
            } else if (txt) {
              const job = pendingPY[replyTo];
              await conn.sendMessage(job.chatId, {
                text: "⚠️ Responde con *1* (video) o *2* (audio), o reacciona con 👍 / 🎵."
              }, { quoted: job.baseMsg });
            }
          }
        } catch (e) {
          console.error("py listener error:", e);
        }
      }
    });
  }
};

handler.command = ["py"];
module.exports = handler;
