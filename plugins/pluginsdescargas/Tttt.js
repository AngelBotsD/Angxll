
"use strict";

const axios = require("axios");

const ENDPOINT = "https://api-sky.ultraplus.click/tiktok";
const API_KEY = "Russellxz";
const TIMEOUT = 25000;

module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const url = (args.join(" ") || "").trim();

  if (!url) {
    return conn.sendMessage(
      chatId,
      { text: "✳️ Usa: .tt <url>\nEj: .tt https://www.tiktok.com/t/XXXX" },
      { quoted: msg }
    );
  }

  if (!/^https?:\/\//i.test(url) || !/tiktok\.com|vm\.tiktok\.com/i.test(url)) {
    return conn.sendMessage(chatId, { text: "❌ Link inválido de TikTok." }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    const { data } = await axios.post(
      ENDPOINT,
      { url },
      {
        timeout: TIMEOUT,
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          apikey: API_KEY,
          Authorization: `Bearer ${API_KEY}`,
        },
        validateStatus: () => true,
      }
    );

    if (!data || data.status !== true) {
      throw new Error(data?.message || data?.error || "Respuesta inválida de la API");
    }

    const r = data.result || {};
    const video = r?.media?.video;
    if (!video) throw new Error("No vino media.video en la respuesta");

    const title = (r.title || "TikTok Video").slice(0, 80);
    const author = r?.author?.name ? ` • ${r.author.name}` : "";

    await conn.sendMessage(
      chatId,
      {
        video: { url: video },
        mimetype: "video/mp4",
        caption: `🎬 TikTok: ${title}${author}\n🔗 ${url}`,
      },
      { quoted: msg }
    );

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (e) {
    const err = e?.message || "unknown";
    await conn.sendMessage(chatId, { text: `❌ Error: ${err}` }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

module.exports.command = ["ttt", "tiktoktest"];
module.exports.help = ["tt <url>", "tiktok <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
