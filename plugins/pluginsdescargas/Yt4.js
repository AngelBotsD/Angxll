const fetch = require("node-fetch"); // Asegúrate de tener node-fetch instalado

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  // 1. Validar si el usuario envió el link
  const urlVideo = args.join(" ").trim();
  if (!urlVideo) {
    return conn.sendMessage(chatId, {
      text: "❌ *Falta el enlace.*\nUsa: *.ytmp4 [link_youtube]*\nEjemplo: *.ytmp4 https://youtu.be/xyz...*"
    }, { quoted: msg });
  }

  // 2. Reacción de 'Cargando'
  await conn.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

  try {
    // 3. CONEXIÓN A TU API (Según documentación en imagen)
    const apiUrl = "https://api-sky.ultraplus.click/youtube-mp4/resolve";
    const apiKey = "Russellxz"; 

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey
      },
      // Cuerpo del JSON idéntico a tu documentación: url, type, quality
      body: JSON.stringify({ 
        url: urlVideo, 
        type: "video",  
        quality: "360"  // Calidad recomendada para WhatsApp
      })
    });

    const json = await response.json();

    // 4. Validar respuesta exitosa
    if (!json.status || !json.result) {
      console.log(json); // Para depurar en consola si falla
      throw new Error("La API no devolvió un resultado válido.");
    }

    const { title, media } = json.result;
    
    // Según tu documentación: media.dl_inline sirve para reproducir (link directo)
    const videoUrl = media.dl_inline || media.dl_download;

    // 5. Enviar el Video a WhatsApp
    await conn.sendMessage(chatId, { 
      video: { url: videoUrl }, 
      caption: `🎥 *${title}*\n\n⚡ Descargado con *SkyUltraPlus API*`,
      mimetype: 'video/mp4'
    }, { quoted: msg });

    // 6. Reacción final de éxito
    await conn.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error("Error en comando ytmp4:", e);
    await conn.sendMessage(chatId, { 
      text: `❌ *Ocurrió un error:* No se pudo descargar el video.\nVerifica que el enlace sea correcto o intenta más tarde.` 
    }, { quoted: msg });
    
    await conn.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
  }
};

// Configuración del comando
handler.command = ['yt4', '4', 'mp'];
module.exports = handler;

