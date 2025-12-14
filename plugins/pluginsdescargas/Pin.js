// commands/pinterestimg.js
"use strict";

const axios = require("axios");

// ==== CONFIG API ====
const API_BASE = (process.env.API_BASE || "https://api-sky-test.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";

const LIMIT = 10;

// ---- helpers ----
function isUrl(s = "") {
  return /^https?:\/\//i.test(String(s || ""));
}
function isImageUrl(u = "") {
  u = String(u || "");
  return /^https?:\/\//i.test(u) && /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u);
}

// descarga imagen a buffer (para mandarla por whatsapp)
async function downloadImageBuffer(url) {
  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "image/*,*/*",
    },
    validateStatus: () => true,
  });

  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  const ct = String(r.headers["content-type"] || "");
  if (!ct.startsWith("image/")) {
    // aún así puede ser imagen sin header; no frenamos duro, pero avisamos si quieres
  }
  return Buffer.from(r.data);
}

async function callPinterestImages(q, limit = LIMIT) {
  const endpoint = `${API_BASE}/pinterest-images`;
  const r = await axios.get(endpoint, {
    params: { q, limit },
    headers: { apikey: API_KEY, Accept: "application/json,*/*" },
    timeout: 60000,
    validateStatus: () => true,
  });

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON del servidor");

  const ok = data.status === true || data.status === "true";
  if (!ok) throw new Error(data.message || data.error || "Error en API Pinterest");

  return data.result;
}

// ---- command ----
module.exports = async (msg, { conn, text }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  const input = String(text || "").trim();
  if (!input) {
    return conn.sendMessage(
      chatId,
      { text: `🖼️ Usa:\n${pref}pinterestimg <búsqueda|link_imagen>\nEj: ${pref}pinterestimg gatos anime` },
      { quoted: msg }
    );
  }

  // reaccion inicio
  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    // ✅ Si es URL directa de imagen -> mandar 1
    if (isUrl(input) && isImageUrl(input)) {
      await conn.sendMessage(chatId, { react: { text: "🖼️", key: msg.key } });

      const buf = await downloadImageBuffer(input);
      await conn.sendMessage(
        chatId,
        { image: buf, caption: "📌 Imagen (URL directa)" },
        { quoted: msg }
      );

      await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
      return;
    }

    // 🔎 búsqueda -> pedir top 10 a tu API
    const result = await callPinterestImages(input, LIMIT);
    const images = Array.isArray(result?.results) ? result.results.slice(0, LIMIT) : [];

    if (!images.length) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, { text: "❌ No encontré imágenes." }, { quoted: msg });
    }

    await conn.sendMessage(chatId, {
      text: `📌 Pinterest resultados: *${images.length}*\n🔎 Búsqueda: *${input}*\nEnviando imágenes...`,
    }, { quoted: msg });

    // mandar las 10 primeras (una por una)
    for (let i = 0; i < images.length; i++) {
      const it = images[i];
      const url =
        it.image_medium_url ||
        it.image_large_url ||
        it.image_small_url ||
        "";

      if (!url) continue;

      await conn.sendMessage(chatId, { react: { text: "🖼️", key: msg.key } });

      try {
        const buf = await downloadImageBuffer(url);
        await conn.sendMessage(
          chatId,
          { image: buf, caption: `(${i + 1}/${images.length}) ${it.title || "Pinterest"}` },
          { quoted: msg }
        );
      } catch {
        // fallback: si falla buffer, manda URL
        await conn.sendMessage(
          chatId,
          { text: `(${i + 1}/${images.length}) ${it.title || "Pinterest"}\n${url}` },
          { quoted: msg }
        );
      }
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    await conn.sendMessage(chatId, { text: `❌ Error: ${e?.message || "unknown"}` }, { quoted: msg });
  }
};

module.exports.command = ["pinterestimg", "pinimg", "pimg"];
