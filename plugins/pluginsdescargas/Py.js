// plugins/py.js — YouTube Video vía ytpy.ultraplus.click (selección 👍 / ❤️ o 1 / 2)
const axios = require("axios");

// Endpoint nuevo (según la captura)
const API_BASE = "https://ytpy.ultraplus.click";
const ENDPOINT = "/download";

// Sin límite de tiempo ni tamaño (por si responde JSON grande)
axios.defaults.timeout = 0;
axios.defaults.maxBodyLength = Infinity;
axios.defaults.maxContentLength = Infinity;

function isYouTube(u) {
  return /^https?:\/\//i.test(u) && /(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(u);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Jobs pendientes por id del mensaje con opciones
const pendingPY = Object.create(null);

// Llama a ytpy.ultraplus.click (POST) y normaliza la respuesta
async function callYTPY(url) {
  let lastErr = null;

  // hasta 3 intentos con backoff
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.post(
        `${API_BASE}${ENDPOINT}`,
        { url, option: "video" },
        {
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          validateStatus: () => true
        }
      );

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
      // Formato esperado en la doc: { success: true, result, ... }
      if (!body.success) {
        lastErr = new Error(`API: ${JSON.stringify(body)}`);
        await sleep(1000 * attempt);
        continue;
      }

      // result puede ser string (url) o un objeto
      let mediaUrl = null;
      let title =
        body.title ||
        body?.result?.title ||
        body?.data?.title ||
        "YouTube Video";
      let thumbnail =
        body.thumbnail ||
        body?.result?.thumbnail ||
        body?.data?.thumbnail ||
        "";

      if (typeof body.result === "string") {
        mediaUrl = body.result;
      } else {
        const r = body.result || body.data || {};
        mediaUrl =
          r.url ||
          r.video ||
          r.downloadUrl ||
          r.link ||
          (Array.isArray(r.links) && r.links[0]?.url) ||
          null;
      }

      if (!mediaUrl) {
        lastErr = new Error("El API no devolvió una URL de video.");
        await sleep(1000 * attempt);
        continue;
      }

      return { mediaUrl, title, thumbnail };
    } catch (e) {
      lastErr = e;
      await sleep(1000 * attempt);
    }
  }

  throw lastErr || new Error("No se pudo obtener el video.");
}

const handler = async (msg, { conn, args, command }) => {
  const jid  = msg.key.remoteJid;
  const url  = (args.join(" ") || "").trim();
  const pref = global.prefixes?.[0] || ".";

  if (!url) {
    return conn.sendMessage(jid, {
      text: `✳️ *Usa:*\n${pref}${command} <url>\nEj: ${pref}${command} https://youtu.be/xxxxxx`
    }, { quoted: msg });
  }
  if (!isYouTube(url)) {
    return conn.sendMessage(jid, { text: "❌ *URL de YouTube inválida.*" }, { quoted: msg });
  }

  try {
    await conn.sendMessage(jid, { react: { text: "⏱️", key: msg.key } });

    // 1) Pide a tu nuevo API (POST /download)
    const { mediaUrl, title, thumbnail } = await callYTPY(url);

    // 2) Mensaje de selección (reacciones o números)
    const caption =
`⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 — 𝗩𝗶𝗱𝗲𝗼

Elige cómo enviarlo:
👍 𝗩𝗶𝗱𝗲𝗼 (normal)
❤️ 𝗩𝗶𝗱𝗲𝗼 𝗰𝗼𝗺𝗼 𝗱𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼
— o responde: 1 = video · 2 = documento

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: ytpy.ultraplus.click
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

    let selectorMsg;
    if (thumbnail) {
      selectorMsg = await conn.sendMessage(jid, { image: { url: thumbnail }, caption }, { quoted: msg });
    } else {
      selectorMsg = await conn.sendMessage(jid, { text: caption }, { quoted: msg });
    }

    // Guarda el job
    pendingPY[selectorMsg.key.id] = {
      chatId: jid,
      mediaUrl,
      title,
      baseMsg: msg
    };

    await conn.sendMessage(jid, { react: { text: "✅", key: msg.key } });

    // 3) Listener único para reacciones / respuestas
    if (!conn._pyListener) {
      conn._pyListener = true;
      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // REACCIÓN
            if (m.message?.reactionMessage) {
              const { key: reactedKey, text: emoji } = m.message.reactionMessage;
              const job = pendingPY[reactedKey.id];
              if (job) {
                const asDoc = emoji === "❤️";
                await sendVideo(conn, job, asDoc, m);
                delete pendingPY[reactedKey.id];
              }
            }
            // RESPUESTA con 1 / 2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            const txt = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim().toLowerCase();
            if (replyTo && pendingPY[replyTo]) {
              const job = pendingPY[replyTo];
              if (txt === "1" || txt === "2") {
                const asDoc = txt === "2";
                await sendVideo(conn, job, asDoc, m);
                delete pendingPY[replyTo];
              } else if (txt) {
                await conn.sendMessage(job.chatId, {
                  text: "⚠️ Responde con *1* (video) o *2* (documento), o reacciona con 👍 / ❤️."
                }, { quoted: job.baseMsg });
              }
            }
          } catch (e) {
            console.error("py listener error:", e);
          }
        }
      });
    }

  } catch (err) {
    console.error("py error:", err?.message || err);
    try {
      await conn.sendMessage(jid, { text: `❌ ${err?.message || "Error procesando el enlace."}` }, { quoted: msg });
      await conn.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    } catch {}
  }
};

async function sendVideo(conn, job, asDocument, triggerMsg) {
  const { chatId, mediaUrl, title, baseMsg } = job;

  await conn.sendMessage(chatId, { react: { text: asDocument ? "📁" : "🎬", key: triggerMsg.key } });
  await conn.sendMessage(chatId, { text: `⏳ Enviando ${asDocument ? "como documento" : "video"}…` }, { quoted: baseMsg });

  const caption =
`⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗩𝗶𝗱𝗲𝗼 — 𝗟𝗶𝘀𝘁𝗼
✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: ytpy.ultraplus.click

🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

  if (asDocument) {
    await conn.sendMessage(chatId, {
      document: { url: mediaUrl },
      mimetype: "video/mp4",
      fileName: `${title}.mp4`,
      caption
    }, { quoted: baseMsg });
  } else {
    await conn.sendMessage(chatId, {
      video: { url: mediaUrl },
      mimetype: "video/mp4",
      caption
    }, { quoted: baseMsg });
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });
}

handler.command = ["py"];
module.exports = handler;
