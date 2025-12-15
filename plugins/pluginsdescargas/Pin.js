
"use strict";

const axios = require("axios");

// ✅ IMPORTANTE: para álbum en Baileys
const {
  generateWAMessageFromContent,
  generateWAMessage,
} = require("@whiskeysockets/baileys");

// ==== CONFIG API ====
const API_BASE = (process.env.API_BASE || "https://api-sky-test.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const LIMIT = 10;

// ---- helpers ----
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
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(r.data);
}

async function callPinterestImages(q, limit = LIMIT) {
  // ⚠️ Ajusta si tu endpoint real es otro
  const endpoint = `${API_BASE}/pinterest-images`;

  const r = await axios.get(endpoint, {
    params: { q, limit },
    headers: { apikey: API_KEY, Accept: "application/json,*/*" },
    timeout: 60000,
    validateStatus: () => true,
  });

  let data = r.data;

  // si viene texto → intenta parsear
  if (typeof data === "string") {
    try { data = JSON.parse(data.trim()); }
    catch { throw new Error("Respuesta no JSON del servidor"); }
  }

  if (!data || typeof data !== "object") throw new Error("Respuesta no JSON del servidor");

  const ok =
    data.status === true ||
    data.status === "true" ||
    data.ok === true ||
    data.success === true;

  if (!ok) throw new Error(data.message || data.error || "Error en API Pinterest");

  return data.result || data.data || data;
}

// ✅ TU LÓGICA DE ÁLBUM (misma que te pasó tu amigo)
function ensureAlbumSupport(conn) {
  if (typeof conn.sendAlbumMessage === "function") return;

  conn.sendAlbumMessage = async function (jid, medias = [], caption = "", quoted = null) {
    if (!Array.isArray(medias) || medias.length === 0) {
      throw new Error("No se proporcionaron medios válidos.");
    }

    const album = generateWAMessageFromContent(jid, {
      albumMessage: {
        expectedImageCount: medias.filter(media => media.type === "image").length,
        expectedVideoCount: medias.filter(media => media.type === "video").length,
        ...(quoted ? {
          contextInfo: {
            remoteJid: quoted.key.remoteJid,
            fromMe: quoted.key.fromMe,
            stanzaId: quoted.key.id,
            participant: quoted.key.participant || quoted.key.remoteJid,
            quotedMessage: quoted.message
          }
        } : {})
      }
    }, { quoted });

    await this.relayMessage(album.key.remoteJid, album.message, {
      messageId: album.key.id
    });

    for (let i = 0; i < medias.length; i++) {
      const { type, data } = medias[i];

      const mediaPayload = {};
      mediaPayload[type] = data;

      // ✅ caption SOLO en el primero (y aquí lo mandamos vacío)
      if (i === 0 && caption) {
        mediaPayload.caption = caption;
      }

      const mediaMessage = await generateWAMessage(album.key.remoteJid, mediaPayload, {
        upload: this.waUploadToServer
      });

      mediaMessage.message.messageContextInfo = {
        messageAssociation: {
          associationType: 1,
          parentMessageKey: album.key
        }
      };

      await this.relayMessage(mediaMessage.key.remoteJid, mediaMessage.message, {
        messageId: mediaMessage.key.id
      });
    }

    return album;
  };
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

  // ✅ reacciona inicio
  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    ensureAlbumSupport(conn);

    // 🔎 búsqueda -> pedir top 10 a tu API
    const result = await callPinterestImages(input, LIMIT);

    // soporta: result.results o result array
    const arr = Array.isArray(result?.results) ? result.results : (Array.isArray(result) ? result : []);
    const items = arr.slice(0, LIMIT);

    if (!items.length) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, { text: "❌ No encontré imágenes." }, { quoted: msg });
    }

    // Mensaje info (esto sí se queda)
    await conn.sendMessage(chatId, {
      text: `📌 Pinterest resultados: *${items.length}*\n🔎 Búsqueda: *${input}*\n📸 Enviando en álbum...`,
    }, { quoted: msg });

    // Descargar buffers
    const medias = [];
    for (let i = 0; i < items.length; i++) {
      const url = pickBestImage(items[i]);
      if (!url) continue;

      // reacciona mientras descarga
      await conn.sendMessage(chatId, { react: { text: "🖼️", key: msg.key } });

      try {
        const buf = await downloadImageBuffer(url);
        medias.push({ type: "image", data: buf });
      } catch {
        // si una falla, la saltamos (para no romper el álbum)
      }
    }

    if (!medias.length) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, { text: "❌ No pude descargar ninguna imagen." }, { quoted: msg });
    }

    // ✅ Enviar álbum SIN caption por imagen (caption = "")
    try {
      await conn.sendAlbumMessage(chatId, medias, "", msg);
    } catch (e) {
      // fallback: si tu baileys realmente no lo soporta, manda 1x1 SIN caption
      for (const m of medias) {
        await conn.sendMessage(chatId, { image: m.data }, { quoted: msg });
      }
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    await conn.sendMessage(chatId, { text: `❌ Error: ${e?.message || "unknown"}` }, { quoted: msg });
  }
};

module.exports.command = ["pinterestimg", "pinimg", "pimg"];
