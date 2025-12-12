// plugins/py.js — YouTube (ytpy.ultraplus.click) -> VIDEO/AUDIO
// Descarga local con ffmpeg para evitar 403 de googlevideo al mandar URL directa

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const axios = require("axios");

const execPromise = promisify(exec);

// ===== Config =====
const API_BASE = process.env.PY_API || "https://ytpy.ultraplus.click";
const ENDPOINT = "/download";
const TMP_DIR = path.join(__dirname, "../tmp");
const MAX_WA_MB = 100; // límite razonable para WhatsApp (~100 MB)

// cache de trabajos (id del mensaje de selección -> job)
const pendingPY = global._pendingPY_FF || (global._pendingPY_FF = Object.create(null));

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isYouTube = (u) => /^https?:\/\//i.test(u) && /(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(u);

// ===== Llamada robusta a la API =====
async function callYTPY(url, option) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.post(`${API_BASE}${ENDPOINT}`, { url, option }, {
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        validateStatus: () => true
      });

      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(1000 * attempt);
        continue;
      }
      if (res.status !== 200) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(1000 * attempt);
        continue;
      }

      const body = res.data || {};
      const ok =
        body.success === true ||
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
        await sleep(1000 * attempt);
        continue;
      }
      if (!mediaUrl) {
        lastErr = new Error("El API no devolvió una URL.");
        await sleep(1000 * attempt);
        continue;
      }

      return { mediaUrl, title };
    } catch (e) {
      lastErr = e;
      await sleep(1000 * attempt);
    }
  }
  throw lastErr || new Error("No se pudo obtener el recurso.");
}

// ===== Descarga con ffmpeg =====
async function downloadWithFfmpeg(inputUrl, outputPath, kind /* "video"|"audio" */) {
  // Forzamos whitelist por si es HLS/M3U8 y seteamos UA por si acaso
  const userAgent = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

  let cmd;
  if (kind === "audio") {
    // Extraer a MP3 192 kbps
    cmd = `ffmpeg -hide_banner -loglevel error -user_agent "${userAgent}" -protocol_whitelist file,http,https,tcp,tls -i "${inputUrl}" -vn -c:a libmp3lame -b:a 192k -y "${outputPath}"`;
  } else {
    // Copiar a MP4 (si es AAC lo normaliza; para HLS usa whitelist)
    cmd = `ffmpeg -hide_banner -loglevel error -user_agent "${userAgent}" -protocol_whitelist file,http,https,tcp,tls -i "${inputUrl}" -c copy -bsf:a aac_adtstoasc -y "${outputPath}"`;
  }

  // timeout 0 = sin límite; maxBuffer grande por si spamea logs
  await execPromise(cmd, { timeout: 0, maxBuffer: 1024 * 1024 * 100 });
  return outputPath;
}

function bytesToMB(b) { return (b / (1024 * 1024)).toFixed(2); }

// ===== Envío después de elegir =====
async function sendMedia(conn, job, option, triggerMsg) {
  const { chatId, url, baseMsg } = job;

  await conn.sendMessage(chatId, { react: { text: option === "audio" ? "🎵" : "🎬", key: triggerMsg.key } });
  await conn.sendMessage(chatId, { text: `⏳ Procesando ${option === "audio" ? "música" : "video"}…` }, { quoted: baseMsg });

  // 1) pedir URL real para el formato elegido
  const { mediaUrl, title } = await callYTPY(url, option);

  // 2) descargar local con ffmpeg
  const stamp = Date.now();
  const outPath = path.join(TMP_DIR, `${option}_${stamp}.${option === "audio" ? "mp3" : "mp4"}`);

  const t0 = Date.now();
  await downloadWithFfmpeg(mediaUrl, outPath, option);
  const took = ((Date.now() - t0) / 1000).toFixed(1);

  if (!fs.existsSync(outPath)) {
    await conn.sendMessage(chatId, { text: "❌ Error al procesar el archivo." }, { quoted: baseMsg });
    return;
  }

  const sizeMB = Number(bytesToMB(fs.statSync(outPath).size));
  if (sizeMB > MAX_WA_MB) {
    fs.unlinkSync(outPath);
    await conn.sendMessage(chatId, {
      text: `❌ El archivo pesa *${sizeMB} MB* y excede el límite de WhatsApp (~${MAX_WA_MB} MB).\n⚠️ Prueba con otra calidad o un video más corto.`
    }, { quoted: baseMsg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
    return;
  }

  const caption =
`📥 Descarga lista
• Título: ${title}
• Formato: ${option === "audio" ? "MP3" : "MP4"}
• Tamaño: ${sizeMB} MB
• Tiempo: ${took}s
• Fuente: ytpy.ultraplus.click`;

  // 3) enviar a WhatsApp
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
    // 4) limpiar
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

  // Mensaje de selección
  await conn.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
  const selector = await conn.sendMessage(jid, {
    text: `📥 𝗬𝗧 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱𝗲𝗿\n\nElige formato para *${url}*:\n👍 𝗩𝗶𝗱𝗲𝗼 (MP4)\n🎵 𝗔𝘂𝗱𝗶𝗼 (MP3)\n— o responde: 1 = video · 2 = audio`
  }, { quoted: msg });

  pendingPY[selector.key.id] = { chatId: jid, url, baseMsg: msg };
  await conn.sendMessage(jid, { react: { text: "✅", key: msg.key } });

  // listener único
  if (!conn._pyFFListener) {
    conn._pyFFListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        try {
          // Reacción
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

          // Respuesta 1/2
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
          console.error("py ffmpeg listener error:", e);
        }
      }
    });
  }
};

handler.command = ["py"];
module.exports = handler;
