"use strict";

import axios from "axios";
import fetch from "node-fetch";

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Angxllll";
const MAX_TIMEOUT = 30000;

let thumb = null;
fetch("https://cdn.russellxz.click/28a8569f.jpeg")
  .then(r => r.arrayBuffer())
  .then(b => thumb = Buffer.from(b))
  .catch(() => null);

async function getSpotifyMp3(input) {
  const endpoint = `${API_BASE}/spotify`;
  const isUrl = /spotify\.com/i.test(input);
  const body = isUrl ? { url: input } : { query: input };

  const { data, status } = await axios.post(
    endpoint,
    body,
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true
    }
  );

  let res = data;
  if (typeof res === "string") {
    try { res = JSON.parse(res.trim()); } catch { throw new Error("Respuesta inválida"); }
  }

  const ok = res?.status === true || res?.status === "true";
  if (!ok) throw new Error(res?.message || res?.error || `HTTP ${status}`);

  const mp3Url = res?.result?.media?.audio;
  if (!mp3Url) throw new Error("MP3 no disponible");

  return {
    mp3Url,
    title: res?.result?.title || "Spotify",
    artist: res?.result?.artist || "Desconocido"
  };
}

const handler = async (m, { conn, args }) => {
  const text = (args.join(" ") || "").trim();
  if (!text) {
    return conn.sendMessage(
      m.chat,
      { text: "✳️ Usa:\n.sp <canción o URL>" },
      { quoted: m }
    );
  }

  await conn.sendMessage(m.chat, {
    react: { text: "🕒", key: m.key }
  });

  const fkontak = {
    key: {
      participants: "0@s.whatsapp.net",
      remoteJid: "status@broadcast",
      fromMe: false,
      id: "Angel"
    },
    message: {
      locationMessage: {
        name: "𝖧𝗈𝗅𝖺, 𝖲𝗈𝗒 𝖠𝗇𝗀𝖾𝗅 𝖡𝗈𝗍",
        jpegThumbnail: thumb
      }
    },
    participant: "0@s.whatsapp.net"
  };

  try {
    const { mp3Url, title, artist } = await getSpotifyMp3(text);

    await conn.sendMessage(
      m.chat,
      {
        audio: { url: mp3Url },
        mimetype: "audio/mpeg",
        fileName: `${title} - ${artist}.mp3`,
        caption: `🎵 ${title}\n👤 ${artist}`
      },
      { quoted: fkontak }
    );

    await conn.sendMessage(m.chat, {
      react: { text: "✅", key: m.key }
    });

  } catch (e) {
    let msg = "❌ Error al descargar desde Spotify";
    if (/api key|unauthorized|401/i.test(e?.message)) msg = "🔐 API Key inválida";
    else if (/timeout|502|upstream/i.test(e?.message)) msg = "⚠️ Error del servidor";

    await conn.sendMessage(m.chat, { text: msg }, { quoted: m });
  }
};

handler.command = ["spotify", "sp"];
handler.help = ["spotify <canción o url>"];
handler.tags = ["descargas"];

export default handler;