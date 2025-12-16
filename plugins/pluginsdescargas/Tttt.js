"use strict";

const axios = require("axios");

const ENDPOINT = "https://api-sky-test.ultraplus.click/tiktok";
const API_KEY = "Russellxz";

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

  // GET: /tiktok?url=...&apikey=...
  const full = `${ENDPOINT}?url=${encodeURIComponent(url)}&apikey=${encodeURIComponent(API_KEY)}`;

  try {
    // ⬇️ Prueba rápida (te devuelve TODO lo que responda la API)
    const r = await axios.get(full, {
      timeout: 25000,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0",
        // (opcional) si tu backend también lee headers:
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
      },
    });

    // Mostrar status + parte del body
    let body = r.data;
    if (typeof body !== "string") body = JSON.stringify(body, null, 2);

    // recortar para WhatsApp
    const out = body.length > 3500 ? body.slice(0, 3500) + "\n...\n(TRUNCADO)" : body;

    // Logs en consola (servidor)
    console.log("[TTT TEST] GET:", full);
    console.log("[TTT TEST] HTTP:", r.status);
    console.log("[TTT TEST] BODY:", r.data);

    return conn.sendMessage(
      chatId,
      { text: `🧪 TikTok TEST (GET)\nHTTP: ${r.status}\n\n${out}` },
      { quoted: msg }
    );
  } catch (e) {
    console.log("[TTT TEST] ERROR:", e?.message || e);
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
