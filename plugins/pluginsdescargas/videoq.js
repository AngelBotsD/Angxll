// comandos/xnxx.js
const axios = require("axios");

const API_BASE = process.env.API_BASE || "https://api-sky-test.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 25000;

const fmtSec = (s) => {
  const n = Number(s || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return (h ? `\( {h}:` : "") + ` \){m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;
};

const pendingXNXX = Object.create(null);

async function getXnxxFromSky(url){
  const { data: res, status: http } = await axios.post(
    `${API_BASE}/xnxx`,
    { url },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: s => s >= 200 && s < 600
    }
  );

  if (http !== 200) throw new Error(`HTTP \( {http} \){res?.message ? ` - ${res.message}` : ""}`);
  if (!res || res.status !== true || !res.result?.media?.video) {
    throw new Error(res?.message || "La API no devolvió un video válido.");
  }

  const r = res.result;
  return {
    title: r.title || "XNXX",
    duration: r.duration || 0,
    video: r.media.video,
    cover: r.cover || null,
  };
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text   = (args || []).join(" ");
  const pref   = (global.prefixes && global.prefixes[0]) || ".";

  if (!text) {
    return conn.sendMessage(chatId, { text: `✳️ 𝙐𝙨𝙖:\n\( {pref} \){command} <enlace>\nEj: \( {pref} \){command} https://www.xnxx.com/video-xxxxx/titulo` }, { quoted: msg });
  }

  const url = args[0];
  if (!/^https?:\/\//i.test(url) || !/xnxx\./i.test(url)) {
    return conn.sendMessage(chatId, { text: "❌ 𝙀𝙣𝙡𝙖𝙘𝙚 𝙙𝙚 𝙓𝙉𝙓𝙓 𝙞𝙣𝙫𝙖́𝙡𝙞𝙙𝙤." }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏱️", key: msg.key } });
    const d = await getXnxxFromSky(url);

    const title  = d.title || "XNXX Video";
    const durTxt = d.duration ? fmtSec(d.duration) : "—";

    const txt = `⚡ 𝗫𝗡𝗫𝗫 — 𝗼𝗽𝗰𝗶𝗼𝗻𝗲𝘀 ⚠️ +18

Elige cómo enviarlo:
👍 𝗩𝗶𝗱𝗲𝗼 (normal)
❤️ 𝗩𝗶𝗱𝗲𝗼 𝗰𝗼𝗺𝗼 𝗱𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼
— 𝗼 responde: 1 = video · 2 = documento

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗗𝘂𝗿.: ${durTxt}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: ${API_BASE}
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

    const preview = await conn.sendMessage(chatId, { text: txt }, { quoted: msg });

    pendingXNXX[preview.key.id] = {
      chatId,
      url: d.video,
      caption: `⚡ 𝗫𝗡𝗫𝗫 — 𝘃𝗶𝗱𝗲𝗼 𝗹𝗶𝘀𝘁𝗼 ⚠️ +18

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durTxt}

✦ 𝗦𝗼𝘂𝗿𝗰𝗲: ${API_BASE}
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`,
      quotedBase: msg
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    if (!conn._xnxxListener) {
      conn._xnxxListener = true;
      conn.ev.on("messages.upsert", async ev => {
        for (const m of ev.messages) {
          try {
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingXNXX[reactKey.id];
              if (job) {
                const asDoc = emoji === "❤️";
                await conn.sendMessage(job.chatId, { react: { text: asDoc ? "📁" : "🎬", key: m.key } });
                await conn.sendMessage(job.chatId, { text: `⏳ Descargando video${asDoc ? " en documento" : ""}…` }, { quoted: job.quotedBase });
                await sendXnxx(conn, job, asDoc);
                delete pendingXNXX[reactKey.id];
                await conn.sendMessage(job.chatId, { react: { text: "✅", key: m.key } });
              }
            }

            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            const textLow = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim().toLowerCase();

            if (replyTo && pendingXNXX[replyTo]) {
              const job = pendingXNXX[replyTo];
              if (textLow === "1" || textLow === "2") {
                const asDoc = textLow === "2";
                await conn.sendMessage(job.chatId, { react: { text: asDoc ? "📁" : "🎬", key: m.key } });
                await conn.sendMessage(job.chatId, { text: `⏳ Descargando video${asDoc ? " en documento" : ""}…` }, { quoted: job.quotedBase });
                await sendXnxx(conn, job, asDoc);
                delete pendingXNXX[replyTo];
                await conn.sendMessage(job.chatId, { react: { text: "✅", key: m.key } });
              } else {
                await conn.sendMessage(job.chatId, { text: "⚠️ Responde con *1* (video) o *2* (documento), o reacciona con 👍 / ❤️." }, { quoted: job.quotedBase });
              }
            }
          } catch (e) { console.error("XNXX listener error:", e); }
        }
      });
    }

  } catch (err) {
    console.error("❌ Error en xnxx:", err?.message || err);
    await conn.sendMessage(chatId, { text: `❌ *Error:* ${err?.message || "Fallo al procesar el video de XNXX."}` }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

async function sendXnxx(conn, job, asDocument){
  const { chatId, url, caption, quotedBase } = job;
  if (asDocument) {
    await conn.sendMessage(chatId, { document: { url }, mimetype: "video/mp4", fileName: `xnxx-${Date.now()}.mp4`, caption }, { quoted: quotedBase });
  } else {
    await conn.sendMessage(chatId, { video: { url }, mimetype: "video/mp4", caption }, { quoted: quotedBase });
  }
}

handler.command = ["xnxx","x"];
handler.help = ["xnxx <url>", "x <url>"];
handler.tags = ["descargas", "nsfw"];
handler.register = true;

module.exports = handler;
