
"use strict";

const axios = require("axios");

// ==== CONFIG API ====
const API_BASE = (process.env.API_BASE || "https://api-sky-test.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";

const LIMIT = 10;

// ---- helpers ----
function looksLikeUrl(s = "") {
  return /^https?:\/\//i.test(String(s || ""));
}

function pickBestImage(it) {
  return (
    it?.image_medium_url ||
    it?.image_large_url ||
    it?.image_small_url ||
    it?.url ||
    it?.image ||
    ""
  );
}

// descarga imagen a buffer
async function downloadImageBuffer(url) {
  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "image/*,*/*",
    },
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(r.data);
}

// ✅ Llamada correcta a tu API (plugin: /pinterestimg)
async function callPinterestImages(q) {
  const endpoint = `${API_BASE}/pinterestimg`;
  const r = await axios.post(
    endpoint,
    { q, limit: LIMIT },
    {
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Accept: "application/json, */*",
      },
      timeout: 60000,
      validateStatus: () => true,
    }
  );

  let data = r.data;
  if (typeof data === "string") {
    const t = data.trim();
    try { data = JSON.parse(t); }
    catch { throw new Error(`Respuesta no JSON del servidor (HTTP ${r.status})`); }
  }

  if (!data || typeof data !== "object") throw new Error(`API inválida (HTTP ${r.status})`);

  const ok = data.status === true || data.status === "true" || data.ok === true || data.success === true;
  if (!ok) throw new Error(data.message || data.error || `Error en API (HTTP ${r.status})`);

  return data.result || data.data || data;
}

// ✅ intento de envío en álbum (si Baileys lo soporta)
async function sendAlbum(conn, chatId, albumItems, quoted) {
  // albumItems: [{ image: Buffer, caption?: string }, ...]
  try {
    // Baileys recientes soportan { album: [...] }
    await conn.sendMessage(chatId, { album: albumItems }, { quoted });
    return true;
  } catch (e) {
    return false;
  }
}

// ---- command ----
module.exports = async (msg, { conn, text }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  const input = String(text || "").trim();
  if (!input) {
    return conn.sendMessage(
      chatId,
      { text: `🖼️ Usa:\n${pref}pinterestimg <búsqueda>\nEj: ${pref}pinterestimg gatos anime` },
      { quoted: msg }
    );
  }

  // ✅ solo búsqueda por texto
  if (looksLikeUrl(input)) {
    return conn.sendMessage(
      chatId,
      { text: `⚠️ Este comando ahora es SOLO búsqueda por texto.\nEj: ${pref}pinterestimg gatos anime` },
      { quoted: msg }
    );
  }

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    const result = await callPinterestImages(input);

    const raw = Array.isArray(result?.results) ? result.results : Array.isArray(result) ? result : [];
    const images = raw.slice(0, LIMIT);

    if (!images.length) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, { text: "❌ No encontré imágenes." }, { quoted: msg });
    }

    await conn.sendMessage(
      chatId,
      {
        text:
          `📌 Pinterest resultados: *${images.length}*\n` +
          `🔎 Búsqueda: *${input}*\n` +
          `📤 Enviando en álbum...`,
      },
      { quoted: msg }
    );

    // 1) Descargamos buffers
    const albumItems = [];
    for (let i = 0; i < images.length; i++) {
      const it = images[i];
      const url = pickBestImage(it);
      if (!url) continue;

      try {
        const buf = await downloadImageBuffer(url);

        // Tip: normalmente WhatsApp solo muestra caption en la primera imagen del álbum
        albumItems.push({
          image: buf,
          caption: i === 0 ? `📌 Pinterest: ${input}\n(${images.length} imágenes)` : undefined,
        });
      } catch {
        // si una falla, la saltamos (para no romper el álbum completo)
      }
    }

    if (!albumItems.length) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, { text: "❌ No pude descargar imágenes." }, { quoted: msg });
    }

    // 2) Intentar enviar como álbum
    await conn.sendMessage(chatId, { react: { text: "🖼️", key: msg.key } });

    const okAlbum = await sendAlbum(conn, chatId, albumItems, msg);

    // 3) Fallback: si no soporta álbum, mandar una por una
    if (!okAlbum) {
      await conn.sendMessage(chatId, { text: "⚠️ Tu Baileys no soporta álbum. Enviando normal..." }, { quoted: msg });

      for (let i = 0; i < albumItems.length; i++) {
        await conn.sendMessage(
          chatId,
          { image: albumItems[i].image, caption: `(${i + 1}/${albumItems.length}) Pinterest: ${input}` },
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
