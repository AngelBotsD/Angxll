
// ig.js — Instagram (👍 video / ❤️ documento o 1 / 2) — API NUEVA
"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = (process.env.API_BASE || "https://api-sky-test.ultraplus.click").replace(/\/+$/, "");
const SKY_API_KEY = process.env.API_KEY || "Russellxz";
const MAX_MB = Number(process.env.MAX_MB || 99);

const pendingIG = Object.create(null);

const mb = (n) => n / (1024 * 1024);

function isIG(u = "") {
  return /(instagram\.com|instagr\.am)/i.test(String(u || ""));
}

function normalizeIGUrl(input = "") {
  let u = String(input || "").trim();

  // quitar <> por si lo pegan así
  u = u.replace(/^<|>$/g, "").trim();

  // si viene sin protocolo, pon https
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

// ✅ LLAMADA API NUEVA (POST /instagram)
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
        apikey: SKY_API_KEY, // tu middleware usa req.currentUser
        // Authorization: `Bearer ${SKY_API_KEY}`, // opcional si lo usas
      },
      validateStatus: () => true,
    }
  );

  let data = r.data;

  // por si viene string
  if (typeof data === "string") {
    try {
      data = JSON.parse(data.trim());
    } catch {
      throw new Error("Respuesta no JSON del servidor");
    }
  }

  if (!data || typeof data !== "object") throw new Error("Respuesta inválida");

  const ok = data.status === true || data.status === "true";
  if (!ok) throw new Error(data.message || data.error || `HTTP ${r.status}`);

  // TU API hace res.success(result) => { status:true, result:{...} }
  return data.result;
}

// ✅ EXTRAER ITEMS (result.media.items)
function extractItems(result) {
  const items = result?.media?.items;
  return Array.isArray(items) ? items : [];
}

function pickFirstVideo(items) {
  // prioridad: type === video
  let v = items.find((it) => String(it?.type || "").toLowerCase() === "video");
  if (v && v.url) return v;

  // fallback: por extensión
  v = items.find((it) => /\.mp4(\?|#|$)/i.test(String(it?.url || "")));
  if (v && v.url) return v;

  return null;
}

// ✅ descargar usando /instagram/dl (con apikey)
async function downloadToTmpFromProxy(type, srcUrl, filenameBase = "instagram") {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  const base = safeFileName(filenameBase);
  const fname =
    base + (type === "video" ? ".mp4" : type === "image" ? ".jpg" : ".bin");

  const dlUrl =
    `${API_BASE}/instagram/dl` +
    `?type=${encodeURIComponent(type)}` +
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

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "video"]: fs.readFileSync(filePath),
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
Ej: ${pref}${command} https://www.instagram.com/reel/DPO9MwWjjY_/`,
      },
      { quoted: msg }
    );
  }

  text = normalizeIGUrl(text);

  if (!isIG(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace IG inválido.\nUsa: ${pref}${command} <url>` },
      { quoted: msg }
    );
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    // 1) API nueva
    const result = await callSkyInstagram(text);

    // 2) items
    const items = extractItems(result);
    const firstVideo = pickFirstVideo(items);

    if (!firstVideo) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        { text: "🚫 No se encontró VIDEO descargable en ese enlace." },
        { quoted: msg }
      );
    }

    // 3) opciones (reacción o 1/2)
    const txt =
`⚡ Instagram — opciones

👍 Video (normal)
❤️ Video como documento
— o responde: 1 = video · 2 = documento`;

    const preview = await conn.sendMessage(chatId, { text: txt }, { quoted: msg });

    pendingIG[preview.key.id] = {
      chatId,
      videoUrl: String(firstVideo.url),
      quotedBase: msg,
      createdAt: Date.now(),
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    // listener único
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

            // 1) REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingIG[reactKey.id];
              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;

              const asDoc = emoji === "❤️";
              await conn.sendMessage(job.chatId, { react: { text: asDoc ? "📁" : "🎬", key: m.key } });

              const filePath = await downloadToTmpFromProxy("video", job.videoUrl, "instagram");
              await sendVideo(conn, job.chatId, filePath, asDoc, job.quotedBase);

              delete pendingIG[reactKey.id];
              continue;
            }

            // 2) RESPUESTAS 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            const body =
              (m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                "").trim();

            if (replyTo && pendingIG[replyTo]) {
              const job = pendingIG[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              if (body === "1" || body === "2") {
                const asDoc = body === "2";
                await conn.sendMessage(job.chatId, { react: { text: asDoc ? "📁" : "🎬", key: m.key } });

                const filePath = await downloadToTmpFromProxy("video", job.videoUrl, "instagram");
                await sendVideo(conn, job.chatId, filePath, asDoc, job.quotedBase);

                delete pendingIG[replyTo];
              } else {
                await conn.sendMessage(
                  job.chatId,
                  { text: "⚠️ Responde con *1* (video) o *2* (documento), o reacciona con 👍 / ❤️." },
                  { quoted: job.quotedBase }
                );
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
    else if (/no se encontraron medios|no se encontraron|no_media/i.test(s)) msgTxt = "🚫 No se encontraron medios en ese link.";
    else if (/401|api key|unauthorized|forbidden/i.test(s)) msgTxt = "🔐 API Key inválida o ausente.";
    else if (/timeout|timed out|502|upstream/i.test(s)) msgTxt = "⚠️ La upstream tardó demasiado o no respondió.";

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

module.exports.command = ["instagram", "ig"];
module.exports.help = ["instagram <url>", "ig <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
