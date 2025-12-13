// comandos/tt.js — TikTok con opciones (👍 video / ❤️ documento o 1 / 2)
// Usa tu API Sky: https://api-sky.ultraplus.click
const axios = require("axios");

const API_BASE = process.env.API_BASE || "https://api-russell-test.ultraplus.click/tiktok";
const API_KEY  = process.env.API_KEY  || "sk_732a209b-322a-47b3-8ce0-965aa13a7024"; // tu key
const MAX_TIMEOUT = 25000;

const fmtSec = (s) => {
  const n = Number(s || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return (h ? `${h}:` : "") + `${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;
};

// jobs pendientes por id del mensaje de opciones
const pendingTT = Object.create(null);

async function getTikTokFromSky(url){
  const { data: res, status: http } = await axios.get(
    `${API_BASE}/api/download/tiktok.php`,
    {
      params: { url },
      headers: { Authorization: `Bearer ${API_KEY}` },
      timeout: MAX_TIMEOUT,
      validateStatus: s => s >= 200 && s < 600
    }
  );
  if (http !== 200) throw new Error(`HTTP ${http}${res?.error ? ` - ${res.error}` : ""}`);
  if (!res || res.status !== "true" || !res.data?.video) {
    throw new Error(res?.error || "La API no devolvió un video válido.");
  }
  return res.data; // { title, author, duration, likes, comments, video, audio? }
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text   = (args || []).join(" ");
  const pref   = (global.prefixes && global.prefixes[0]) || ".";

  if (!text) {
    return conn.sendMessage(chatId, {
      text:
`✳️ 𝙐𝙨𝙖:
${pref}${command} <enlace>
Ej: ${pref}${command} https://vm.tiktok.com/xxxxxx/`
    }, { quoted: msg });
  }

  const url = args[0];
  if (!/^https?:\/\//i.test(url) || !/tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(url)) {
    return conn.sendMessage(chatId, { text: "❌ 𝙀𝙣𝙡𝙖𝙘𝙚 𝙙𝙚 𝙏𝙞𝙠𝙏𝙤𝙠 𝙞𝙣𝙫𝙖́𝙡𝙞𝙙𝙤." }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏱️", key: msg.key } });

    // 1) Llama a tu Sky API (solo 1 video)
    const d = await getTikTokFromSky(url);

    const title   = d.title || "TikTok";
    const author  = (d.author && (d.author.name || d.author.username)) || "—";
    const durTxt  = d.duration ? fmtSec(d.duration) : "—";
    const likes   = d.likes ?? 0;
    const comments= d.comments ?? 0;

    // 2) Mensaje de opciones (reacciones / números)
    const txt =
`⚡ 𝗧𝗶𝗸𝗧𝗼𝗸 — 𝗼𝗽𝗰𝗶𝗼𝗻𝗲𝘀

Elige cómo enviarlo:
👍 𝗩𝗶𝗱𝗲𝗼 (normal)
❤️ 𝗩𝗶𝗱𝗲𝗼 𝗰𝗼𝗺𝗼 𝗱𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼
— 𝗼 responde: 1 = video · 2 = documento

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗔𝘂𝘁𝗼𝗿: ${author}
✦ 𝗗𝘂𝗿.: ${durTxt} • 👍 ${likes} · 💬 ${comments}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

    const preview = await conn.sendMessage(chatId, { text: txt }, { quoted: msg });

    // guarda el trabajo
    pendingTT[preview.key.id] = {
      chatId,
      url: d.video,
      caption:
`⚡ 𝗧𝗶𝗸𝗧𝗼𝗸 — 𝘃𝗶𝗱𝗲𝗼 𝗹𝗶𝘀𝘁𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗔𝘂𝘁𝗼𝗿: ${author}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durTxt}
✦ 𝗟𝗶𝗸𝗲𝘀: ${likes}  •  𝗖𝗼𝗺𝗲𝗻𝘁𝗮𝗿𝗶𝗼𝘀: ${comments}

✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`,
      quotedBase: msg
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    // 3) Listener único para TT
    if (!conn._ttListener) {
      conn._ttListener = true;
      conn.ev.on("messages.upsert", async ev => {
        for (const m of ev.messages) {
          try {
            // REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingTT[reactKey.id];
              if (job) {
                const asDoc = emoji === "❤️";
                await sendTikTok(conn, job, asDoc, m);
                delete pendingTT[reactKey.id];
              }
            }

            // RESPUESTAS con número 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            const textLow =
              (m.message?.conversation ||
               m.message?.extendedTextMessage?.text ||
               "").trim().toLowerCase();

            if (replyTo && pendingTT[replyTo]) {
              const job = pendingTT[replyTo];
              if (textLow === "1" || textLow === "2") {
                const asDoc = textLow === "2";
                await sendTikTok(conn, job, asDoc, m);
                delete pendingTT[replyTo];
              } else {
                await conn.sendMessage(job.chatId, {
                  text: "⚠️ Responde con *1* (video) o *2* (documento), o reacciona con 👍 / ❤️."
                }, { quoted: job.quotedBase });
              }
            }
          } catch (e) {
            console.error("TT listener error:", e);
          }
        }
      });
    }

  } catch (err) {
    console.error("❌ Error en tt:", err?.message || err);
    await conn.sendMessage(chatId, {
      text: `❌ *Error:* ${err?.message || "Fallo al procesar el TikTok."}`
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

async function sendTikTok(conn, job, asDocument, triggerMsg){
  const { chatId, url, caption, quotedBase } = job;
  await conn.sendMessage(chatId, { react: { text: asDocument ? "📁" : "🎬", key: triggerMsg.key } });
  await conn.sendMessage(chatId, { text: `⏳ Enviando ${asDocument ? "como documento" : "video"}…` }, { quoted: quotedBase });

  if (asDocument) {
    await conn.sendMessage(chatId, {
      document: { url },
      mimetype: "video/mp4",
      fileName: `tiktok-${Date.now()}.mp4`
    }, { quoted: quotedBase });
  } else {
    await conn.sendMessage(chatId, {
      video: { url },
      mimetype: "video/mp4",
      caption
    }, { quoted: quotedBase });
  }

  await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });
}

handler.command = ["tiktok","tt"];
handler.help = ["tiktok <url>", "tt <url>"];
handler.tags = ["descargas"];
handler.register = true;

module.exports = handler;
