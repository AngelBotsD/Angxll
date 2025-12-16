// plugins/tiktok.js — ultra simple (apikey en query)
"use strict";

const axios = require("axios");

const ENDPOINT = "https://api-sky-test.ultraplus.click/tiktok";
const API_KEY = "Russellxz";

module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const url = (args.join(" ") || "").trim();

  if (!url) {
    return conn.sendMessage(chatId, { text: "✳️ Usa: .tiktok <link>" }, { quoted: msg });
  }

  try {
    const { data } = await axios.get(ENDPOINT, {
      params: { url, apikey: API_KEY },
      timeout: 25000,
      validateStatus: () => true,
    });

    const ok = data?.status === true || data?.status === "true";
    if (!ok) throw new Error(data?.message || "Error en la API");

    const r = data.result || data.data || data;
    const video =
      r?.media?.video ||
      r?.video ||
      r?.nowm ||
      r?.no_watermark ||
      r?.url ||
      "";

    if (!video) throw new Error("No encontré link MP4 en la respuesta");

    await conn.sendMessage(
      chatId,
      { video: { url: video }, mimetype: "video/mp4" },
      { quoted: msg }
    );
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error: ${e?.message || "unknown"}` }, { quoted: msg });
  }
};

module.exports.command = ["tik", "ttt"];
module.exports.help = ["tiktok <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
