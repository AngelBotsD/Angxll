
const fetch = require("node-fetch");

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  // 1. Validar link
  const urlVideo = args.join(" ").trim();
  if (!urlVideo) {
    return conn.sendMessage(chatId, { text: "❌ Falta el enlace." }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

  console.log("--- INICIANDO COMANDO YTMP4 ---");
  console.log("URL recibida:", urlVideo);

  try {
    const apiUrl = "https://api-sky.ultraplus.click/youtube-mp4/resolve";
    const apiKey = "Russellxz";

    console.log("Enviando petición a:", apiUrl);

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

    console.log("Estatus HTTP:", response.status);

    // 3. Obtener respuesta como TEXTO primero (para ver si devuelve HTML de error)
    const rawText = await response.text();
    console.log("Respuesta cruda del servidor:", rawText);

    // 4. Intentar convertir a JSON
    let json;
    try {
      json = JSON.parse(rawText);
    } catch (e) {
      throw new Error("La API no devolvió un JSON válido. Respuesta: " + rawText.slice(0, 50) + "...");
    }

    // 5. Verificar si la API dio error lógico (status: false)
    if (!json.status) {
      throw new Error(json.message || "Error desconocido en la API.");
    }

    if (!json.result || !json.result.media) {
      throw new Error("El JSON no tiene la propiedad 'result.media'.");
    }

    const { title, media } = json.result;
    const videoUrl = media.dl_inline || media.dl_download;

    console.log("URL del video obtenida:", videoUrl);

    if (!videoUrl) {
      throw new Error("La API respondió OK, pero no devolvió link de video.");
    }

    // 6. Enviar video
    await conn.sendMessage(chatId, { 
      video: { url: videoUrl }, 
      caption: `🎥 *${title}*\n\n⚡ SkyUltraPlus API`,
      mimetype: 'video/mp4'
    }, { quoted: msg });

    await conn.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    console.log("--- COMANDO FINALIZADO CON ÉXITO ---");

  } catch (e) {
    console.error("❌ ERROR CRÍTICO EN YTMP4:", e);
    
    // ENVIAR EL ERROR REAL AL CHAT
    await conn.sendMessage(chatId, { 
      text: `❌ *Debug Error:*\n${e.message}` 
    }, { quoted: msg });
    
    await conn.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
  }
};

handler.command = ['yt4', '4'];
module.exports = handler;
