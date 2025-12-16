"use strict";

const axios = require("axios");

const ENDPOINT = "https://api-sky-test.ultraplus.click/tiktok";
const API_KEY = "Russellxz";
const TIMEOUT = 25000;

module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const url = (args.join(" ") || "").trim();

  if (!url) {
    return conn.sendMessage(
      chatId,
      { text: "✳️ Usa: .ttt <url tiktok>\nEj: .ttt https://www.tiktok.com/t/XXXX" },
      { quoted: msg }
    );
  }

  try {
    const r = await axios.post(
      ENDPOINT,
      { url },
      {
        timeout: TIMEOUT,
        maxRedirects: 0,          // ✅ IMPORTANTE: no seguir 302 a /login
        validateStatus: () => true,
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          apikey: API_KEY,
          Authorization: `Bearer ${API_KEY}`,
          "User-Agent": "Mozilla/5.0",
        },
      }
    );

    const ct = (r.headers?.["content-type"] || "").toString();
    const loc = (r.headers?.location || "").toString();

    let body = r.data;
    if (typeof body !== "string") body = JSON.stringify(body, null, 2);

    // recortar para WhatsApp
    const out = body.length > 3200 ? body.slice(0, 3200) + "\n...\n(TRUNCADO)" : body;

    // Logs en consola
    console.log("[TTT DEBUG] URL:", url);
    console.log("[TTT DEBUG] HTTP:", r.status);
    console.log("[TTT DEBUG] CT:", ct);
    console.log("[TTT DEBUG] Location:", loc);
    console.log("[TTT DEBUG] BODY:", r.data);

    const headInfo =
      `🧪 TikTok DEBUG (POST)\n` +
      `HTTP: ${r.status}\n` +
      `Content-Type: ${ct || "?"}\n` +
      (loc ? `Redirect-Location: ${loc}\n` : "");

    return conn.sendMessage(chatId, { text: headInfo + "\n" + out }, { quoted: msg });
  } catch (e) {
    console.log("[TTT DEBUG] ERROR:", e?.message || e);
    return conn.sendMessage(
      chatId,
      { text: `❌ Error request: ${e?.message || "unknown"}` },
      { quoted: msg }
    );
  }
};

module.exports.command = ["ttt", "tiktoktest"];
module.exports.help = ["ttt <url>", "tiktoktest <url>"];
module.exports.tags = ["descargas"];
