// plugins/py.js — YouTube (ytpy.ultraplus.click) -> VIDEO o AUDIO con selección por reacción o 1/2
const axios = require("axios");

// ====== Config ======
const API_BASE = process.env.PY_API || "https://ytpy.ultraplus.click";
const ENDPOINT = "/download";

// mapa de trabajos pendientes (clave: id del mensaje de selección)
const pendingPY = global._pendingPY || (global._pendingPY = Object.create(null));

// Util
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isYouTube = (u) =>
  /^https?:\/\//i.test(u) && /(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(u);

// ====== Llamada robusta a la API (acepta distintos formatos de respuesta) ======
async function callYTPY(url, option) {
  let lastErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.post(
        `${API_BASE}${ENDPOINT}`,
        { url, option }, // option: "video" | "audio"
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          // dejamos que nosotros validemos:
          validateStatus: () => true,
        }
      );

      // reintentos ante saturación/errores del lado servidor
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

      // éxito puede llegar como success:true, status:true o status:"success"
      const ok =
        body.success === true ||
        body.status === true ||
        (typeof body.status === "string" && body.status.toLowerCase() === "success");

      // URL puede estar en: url | result (string) | result.url | data.url | links[0].url
      const mediaUrl =
        body.url ??
        (typeof body.result === "string" ? body.result : undefined) ??
        body?.result?.url ??
        body?.data?.url ??
        (Array.isArray(body?.links) ? body.links[0]?.url : undefined);

      // título/thumbnail (si vienen)
      const title =
        body.title ??
        body?.result?.title ??
        body?.data?.title ??
        "YouTube";
      const thumbnail =
        body.thumbnail ??
        body?.result?.thumbnail ??
        body?.data?.thumbnail ??
        "";

      if (!ok && !mediaUrl) {
        lastErr = new Error(`API no válida: ${JSON.stringify(body)}`);
        await sleep(1000 * attempt);
        continue;
      }
      if (!mediaUrl) {
        lastErr = new Error("El API no devolvió una URL.");
        await sleep(1000 * attempt);
        continue;
      }

      return { mediaUrl, title, thumbnail };
    } catch (e) {
      lastErr = e;
      await sleep(1000 * attempt);
    }
  }

  throw lastErr || new Error("No se pudo obtener el recurso.");
}

// ====== Envío según elección ======
async function sendMedia(conn, job, option, triggerMsg) {
  const { chatId, url, baseMsg } = job;

  // pedir ahora el formato elegido (video/audio)
  const { mediaUrl, title } = await callYTPY(url, option);

  // feedback
  await conn.sendMessage(
    chatId,
    { react: { text: option === "audio" ? "🎵" : "🎬", key: triggerMsg.key } }
  );
  await conn.sendMessage(
    chatId,
    { text: `⏳ Enviando ${option === "audio" ? "música" : "video"}…` },
    { quoted: baseMsg }
  );

  const caption =
`📥 Descarga lista
• Título: ${title}
• Formato: ${option === "audio" ? "MP3" : "MP4"}
• Fuente: ytpy.ultraplus.click`;

  if (option === "audio") {
    // mandar como audio (mp3) por URL
    await conn.sendMessage(
      chatId,
      {
        audio: { url: mediaUrl },
        mimetype: "audio/mpeg",
        fileName: `${title}.mp3`,
        ptt: false
      },
      { quoted: baseMsg }
    );
  } else {
    // mandar como video (mp4) por URL
    await conn.sendMessage(
      chatId,
      {
        video: { url: mediaUrl },
        mimetype: "video/mp4",
        caption
      },
      { quoted: baseMsg }
    );
  }

  await conn.sendMessage(
    chatId,
    { react: { text: "✅", key: triggerMsg.key } }
  );
}

// ====== Handler principal ======
const handler = async (msg, { conn, args, command, usedPrefix }) => {
  const jid = msg.key.remoteJid;
  const url = (args.join(" ") || "").trim();
  const pref = usedPrefix || global.prefix || ".";

  if (!url) {
    return conn.sendMessage(
      jid,
      {
        text: `✳️ *Uso:*\n${pref}${command} <url de YouTube>\nEj: ${pref}${command} https://youtu.be/xxxxxx`
      },
      { quoted: msg }
    );
  }
  if (!isYouTube(url)) {
    return conn.sendMessage(jid, { text: "❌ *URL de YouTube inválida.*" }, { quoted: msg });
  }

  // Mensaje de selección
  await conn.sendMessage(jid, { react: { text: "⏳", key: msg.key } });

  const selectorCaption =
`📥 𝗬𝗧 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱𝗲𝗿

Elige formato para *${url}*:
👍 𝗩𝗶𝗱𝗲𝗼 (MP4)
🎵 𝗔𝘂𝗱𝗶𝗼 (MP3)
— o responde: 1 = video · 2 = audio`;

  const selectorMsg = await conn.sendMessage(jid, { text: selectorCaption }, { quoted: msg });

  // guardar job
  pendingPY[selectorMsg.key.id] = {
    chatId: jid,
    url,
    baseMsg: msg
  };

  await conn.sendMessage(jid, { react: { text: "✅", key: msg.key } });

  // listener único por conexión
  if (!conn._pyListener) {
    conn._pyListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        try {
          // Reacción al mensaje de selección
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

          // Respuesta con 1 / 2 al mensaje de selección
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          const replyTo = ctx?.stanzaId;
          const txt = (m.message?.conversation || m.message?.extendedTextMessage?.text || "")
            .trim().toLowerCase();
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
