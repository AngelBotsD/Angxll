
// plugins/pluginsdescargas/Tiktok.js
"use strict";

const axios = require("axios");

const API_URL = "https://api-sky-test.ultraplus.click/tiktok";
const API_KEY = "Russellxz";
const TIMEOUT = 30000;

// 🔥 Log bonito
function logErr(tag, err) {
  const http = err?.response?.status;
  const data = err?.response?.data;
  console.error(`\n[${tag}] ERROR`);
  console.error("HTTP:", http || "NO_HTTP");
  console.error("MSG :", err?.message || "NO_MESSAGE");
  if (data) {
    try {
      console.error("DATA:", typeof data === "string" ? data : JSON.stringify(data, null, 2));
    } catch {
      console.error("DATA:", data);
    }
  }
  console.error("STACK:", err?.stack || "NO_STACK");
  console.error("----\n");
}

async function callTikTok(url) {
  // ✅ 1) Primero intenta POST (lo más común)
  try {
    const r = await axios.post(
      API_URL,
      { url },
      {
        headers: {
          apikey: API_KEY,
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: TIMEOUT,
        validateStatus: () => true,
      }
    );

    // Debug en consola
    console.log("[TIKTOK] POST HTTP:", r.status);
    console.log("[TIKTOK] POST DATA:", typeof r.data === "string" ? r.data : JSON.stringify(r.data));

    let data = r.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data.trim()); } catch {}
    }

    const ok = data?.status === true || data?.status === "true";
    if (!ok) {
      return { ok: false, where: "POST", http: r.status, data };
    }

    return { ok: true, where: "POST", http: r.status, data };
  } catch (e) {
    logErr("TIKTOK_POST", e);
    // si truena por conexión/timeout, probamos GET abajo
  }

  // ✅ 2) Fallback GET (por si tu API lo implementa así)
  try {
    const r = await axios.get(API_URL, {
      params: { url, apikey: API_KEY },
      timeout: TIMEOUT,
      validateStatus: () => true,
    });

    console.log("[TIKTOK] GET HTTP:", r.status);
    console.log("[TIKTOK] GET DATA:", typeof r.data === "string" ? r.data : JSON.stringify(r.data));

    let data = r.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data.trim()); } catch {}
    }

    const ok = data?.status === true || data?.status === "true";
    if (!ok) {
      return { ok: false, where: "GET", http: r.status, data };
    }

    return { ok: true, where: "GET", http: r.status, data };
  } catch (e) {
    logErr("TIKTOK_GET", e);
    return { ok: false, where: "GET", http: 0, data: { message: e?.message || "Error de conexión" } };
  }
}

module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const url = (args.join(" ") || "").trim();

  if (!url) {
    return conn.sendMessage(
      chatId,
      { text: `✳️ Usa: .ttt <link>\nEj: .ttt https://www.tiktok.com/t/ZP8yLSajY/` },
      { quoted: msg }
    );
  }

  try {
    // ⏳
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } }).catch(() => {});

    const out = await callTikTok(url);

    if (!out.ok) {
      const m = out?.data?.message || out?.data?.error || out?.data?.msg || "Error desconocido";
      const raw = typeof out.data === "string" ? out.data : JSON.stringify(out.data || {}, null, 2);

      // 🔥 Aquí te devuelve el motivo REAL en el chat
      const text =
`❌ Error en la API (TikTok)
• Método: ${out.where}
• HTTP: ${out.http || "?"}
• Motivo: ${m}

🧾 RAW:
${raw.slice(0, 1500)}`;

      await conn.sendMessage(chatId, { text }, { quoted: msg });
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
      return;
    }

    const data = out.data?.result || out.data;

    // ✅ intenta agarrar el video donde sea que lo devuelva tu API
    const video =
      data?.media?.video ||
      data?.video ||
      data?.url ||
      data?.download ||
      data?.dl ||
      null;

    if (!video) {
      await conn.sendMessage(
        chatId,
        { text: `⚠️ La API respondió OK pero no encontré "media.video".\nRAW:\n${JSON.stringify(out.data, null, 2).slice(0, 1500)}` },
        { quoted: msg }
      );
      await conn.sendMessage(chatId, { react: { text: "⚠️", key: msg.key } }).catch(() => {});
      return;
    }

    // ✅ manda el video
    await conn.sendMessage(
      chatId,
      {
        video: { url: video },
        mimetype: "video/mp4",
        caption: `✅ TikTok listo\nFuente: ${API_URL}`,
      },
      { quoted: msg }
    );

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
  } catch (e) {
    logErr("TIKTOK_CMD", e);

    await conn.sendMessage(
      chatId,
      { text: `❌ Error interno del bot:\n${e?.message || "unknown"}` },
      { quoted: msg }
    );
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
  }
};

module.exports.command = ["ttt", "tik"];
module.exports.help = ["ttt <url>", "tiktok <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
