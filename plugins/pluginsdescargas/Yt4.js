const fetch = require("node-fetch");

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  // 1. Validar link
  const urlVideo = args.join(" ").trim();
  if (!urlVideo) {
    return conn.sendMessage(chatId, { text: "❌ Falta el enlace." }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });
  
  // LOGS para debug
  console.log("--- INICIANDO COMANDO YTMP4 ---");
  console.log("URL recibida:", urlVideo);

  try {
    const apiUrl = "https://api-sky.ultraplus.click/youtube-mp4/resolve";
    const apiKey = "Russellxz";
    const apiDomain = "https://api-sky.ultraplus.click"; // Base para arreglar el link

    // 2. Petición a la API
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey
      },
      body: JSON.stringify({ 
        url: urlVideo, 
        type: "video", 
        quality: "360" 
      })
    });

    const json = await response.json();

    if (!json.status || !json.result || !json.result.media) {
      throw new Error("Respuesta inválida de la API.");
    }

    const { title, media } = json.result;
    
    // 3. CORRECCIÓN DEL LINK (Aquí estaba el error)
    let videoUrl = media.dl_inline || media.dl_download;

    // Si el link empieza con "/", le falta el dominio. Se lo pegamos:
    if (videoUrl.startsWith("/")) {
        videoUrl = apiDomain + videoUrl;
    }

    console.log("URL FINAL CORREGIDA:", videoUrl);

    // 4. Enviar video
    await conn.sendMessage(chatId, { 
      video: { url: videoUrl }, 
      caption: `🎥 *${title}*\n\n⚡ SkyUltraPlus API`,
      mimetype: 'video/mp4'
    }, { quoted: msg });

    await conn.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error("❌ ERROR:", e);
    await conn.sendMessage(chatId, { 
      text: `❌ *Error:* ${e.message}` 
    }, { quoted: msg });
  }
};

handler.command = ['yt4', 'ytt4'];
module.exports = handler;

