// ig.js — Instagram SOLO VIDEO (👍 normal / ❤️ documento o 1/2) — API NUEVA
"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const SKY_API_KEY = process.env.API_KEY || "Russellxz";
const MAX_MB = Number(process.env.MAX_MB || 99);

const pendingIG = Object.create(null);

const mb = (n) => n / (1024 * 1024);

function isIG(u = "") {
  return /(instagram\.com|instagr\.am)/i.test(String(u || ""));
}
function isUrl(u = "") {
  return /^https?:\/\//i.test(String(u || ""));
}

function normalizeIGUrl(input = "") {
  let u = String(input || "").trim();
  u = u.replace(/^<|>$/g, "").trim();

  // si viene sin protocolo
  if (/^(www\.)?instagram\.com\//i.test(u) || /^instagr\.am\//i.test(u)) {
    u = "https://" + u.replace(/^\/+/, "");
  }
  return u;
}

function safeFileName(name = "instagram") {
  return (
    String(name || "instagram")
      .slice(0, 70)
      .replace(/[^A-Za-z0-9_\-.]+/g, "_") || "instagram"
  );
}

async function setReaction(conn, chatId, key, emoji) {
  try {
    await conn.sendMessage(chatId, { react: { text: emoji, key } });
  } catch {}
}

// ✅ API NUEVA (POST /instagram)
async function callSkyInstagram(url) {
  const endpoint = `${API_BASE}/instagram`;

  const r = await axios.post(
    endpoint,
    { url },
    {
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json,*/*",
        apikey: SKY_API_KEY,
      },
      validateStatus: () => true,
    }
  );

  let data = r.data;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data.trim());
    } catch {
      throw new Error("Respuesta no JSON del servidor");
    }
  }

  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${r.status}`);

  return data.result;
}

function extractItems(result) {
  const items = result?.media?.items;
  return Array.isArray(items) ? items : [];
}

function pickFirstVideo(items) {
  // 1) por type
  let v = items.find((it) => String(it?.type || "").toLowerCase() === "video" && it?.url);
  if (v?.url) return String(v.url);

  // 2) por extensión
  v = items.find((it) => /\.mp4(\?|#|$)/i.test(String(it?.url || "")));
  if (v?.url) return String(v.url);

  return null;
}

// ✅ descargar usando /instagram/dl (con apikey)
async function downloadVideoToTmpFromProxy(srcUrl, filenameBase = "instagram") {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  const base = safeFileName(filenameBase);
  const fname = `${base}.mp4`;

  const dlUrl =
    `${API_BASE}/instagram/dl` +
    `?type=video` +
    `&src=${encodeURIComponent(srcUrl)}` +
    `&filename=${encodeURIComponent(fname)}` +
    `&download=1`;

  const res = await axios.get(dlUrl, {
    responseType: "stream",
    timeout: 180000,
    headers: {
      apikey: SKY_API_KEY,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    maxRedirects: 5,
    validateStatus: (s) => s < 400,
  });

  const filePath = path.join(
    tmp,
    `ig-${Date.now()}-${Math.floor(Math.random() * 1e5)}.mp4`
  );

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filePath);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });

  return filePath;
}

async function sendVideo(conn, chatId, filePath, asDocument, quoted) {
  const sizeMB = mb(fs.statSync(filePath).size);

  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(filePath); } catch {}
    return conn.sendMessage(
      chatId,
      { text: `❌ Video ≈ ${sizeMB.toFixed(2)} MB — supera el límite de ${MAX_MB} MB.` },
      { quoted }
    );
  }

  const buf = fs.readFileSync(filePath);

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "video"]: buf,
      mimetype: "video/mp4",
      fileName: `instagram-${Date.now()}.mp4`,
      caption: asDocument ? undefined : "✅ Instagram video listo",
    },
    { quoted }
  );

  try { fs.unlinkSync(filePath); } catch {}
}

module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  let text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
        text:
`✳️ Usa:
${pref}${command} <enlace IG>
Ej: ${pref}${command} https://www.instagram.com/reel/XXXX/`,
      },
      { quoted: msg }
    );
  }

  text = normalizeIGUrl(text);

  if (!isUrl(text) || !isIG(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido.\nUsa: ${pref}${command} <url de Instagram>` },
      { quoted: msg }
    );
  }

  try {
    await setReaction(conn, chatId, msg.key, "⏳");

    const result = await callSkyInstagram(text);
    const items = extractItems(result);

    const videoUrl = pickFirstVideo(items);
    if (!videoUrl) {
      await setReaction(conn, chatId, msg.key, "❌");
      return conn.sendMessage(
        chatId,
        { text: "🚫 Ese enlace no tiene un video descargable." },
        { quoted: msg }
      );
    }

    const optionsText =
`⚡ Instagram — opciones (SOLO VIDEO)

👍 Enviar normal
❤️ Enviar como documento
— o responde: 1 = normal · 2 = documento`;

    const preview = await conn.sendMessage(chatId, { text: optionsText }, { quoted: msg });

    // guardar trabajo pendiente (clave = id del mensaje de opciones)
    pendingIG[preview.key.id] = {
      chatId,
      url: videoUrl,
      quotedBase: msg,
      previewKey: preview.key,
      createdAt: Date.now(),
      processing: false,
    };

    await setReaction(conn, chatId, msg.key, "✅");

    if (!conn._igListener) {
      conn._igListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // limpiar jobs viejos (15 min)
            for (const k of Object.keys(pendingIG)) {
              if (Date.now() - (pendingIG[k]?.createdAt || 0) > 15 * 60 * 1000) {
                delete pendingIG[k];
              }
            }

            // -------- REACCIONES (👍 / ❤️) --------
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingIG[reactKey.id];
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;

              // solo aceptamos estas reacciones
              if (emoji !== "👍" && emoji !== "❤️") continue;

              // anti-duplicados
              if (job.processing) continue;
              job.processing = true;

              const asDoc = emoji === "❤️";

              // reacción “descargando” en el mensaje de opciones
              await setReaction(conn, job.chatId, job.previewKey, "⏳");

              try {
                const filePath = await downloadVideoToTmpFromProxy(job.url, "instagram");
                await sendVideo(conn, job.chatId, filePath, asDoc, job.quotedBase);
                await setReaction(conn, job.chatId, job.previewKey, "✅");
              } catch (e) {
                await setReaction(conn, job.chatId, job.previewKey, "❌");
                await conn.sendMessage(
                  job.chatId,
                  { text: `❌ Error descargando: ${e?.message || "unknown"}` },
                  { quoted: job.quotedBase }
                );
              } finally {
                delete pendingIG[reactKey.id];
              }

              continue;
            }

            // -------- RESPUESTAS 1/2 --------
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            const body =
              (m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "").trim();

            if (replyTo && pendingIG[replyTo]) {
              const job = pendingIG[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              if (body !== "1" && body !== "2") continue;

              // anti-duplicados
              if (job.processing) continue;
              job.processing = true;

              const asDoc = body === "2";

              await setReaction(conn, job.chatId, job.previewKey, "⏳");

              try {
                const filePath = await downloadVideoToTmpFromProxy(job.url, "instagram");
                await sendVideo(conn, job.chatId, filePath, asDoc, job.quotedBase);
                await setReaction(conn, job.chatId, job.previewKey, "✅");
              } catch (e) {
                await setReaction(conn, job.chatId, job.previewKey, "❌");
                await conn.sendMessage(
                  job.chatId,
                  { text: `❌ Error descargando: ${e?.message || "unknown"}` },
                  { quoted: job.quotedBase }
                );
              } finally {
                delete pendingIG[replyTo];
              }
            }
          } catch (e) {
            console.error("IG listener error:", e?.message || e);
          }
        }
      });
    }
  } catch (err) {
    const s = String(err?.message || "");
    console.error("❌ IG error:", s);

    let msgTxt = "❌ Error al procesar el enlace.";
    if (/enlace no válido|no válido|invalid/i.test(s)) msgTxt = "❌ Enlace no válido (usa link completo con https://).";
    else if (/api key|unauthorized|forbidden|401/i.test(s)) msgTxt = "🔐 API Key inválida o ausente.";
    else if (/timeout|timed out|502|upstream/i.test(s)) msgTxt = "⚠️ La upstream tardó demasiado o no respondió.";

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await setReaction(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["instagram", "ig"];
module.exports.help = ["instagram <url>", "ig <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
