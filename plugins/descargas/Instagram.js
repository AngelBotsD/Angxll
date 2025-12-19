import axios from "axios";
import fs from "fs";
import path from "path";

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text = args.join(" ");
  const pref = global.prefixes?.[0] || ".";

  if (!text) {
    return conn.sendMessage(chatId, {
      text: `🔗 *𝙸𝚗𝚐𝚛𝚎𝚜𝚊 𝚞𝚗 𝚕𝚒𝚗𝚔 𝚍𝚎 𝙸𝚗𝚜𝚝𝚊𝚐𝚛𝚊𝚖*`
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, {
      react: { text: "🕒", key: msg.key }
    });

    const apiUrl = `https://api.dorratz.com/igdl?url=${encodeURIComponent(text)}`;
    const response = await axios.get(apiUrl);
    const { data } = response.data;

    if (!data || data.length === 0) {
      return conn.sendMessage(chatId, {
        text: "❌ *No se pudo obtener el contenido de Instagram.*"
      }, { quoted: msg });
    }

    const caption = ``;

    const tmpDir = path.resolve("./tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    for (const item of data) {
      const filePath = path.join(tmpDir, `ig-${Date.now()}-${Math.floor(Math.random() * 1000)}.mp4`);

      const videoRes = await axios.get(item.url, { responseType: "stream" });
      const writer = fs.createWriteStream(filePath);

      await new Promise((resolve, reject) => {
        videoRes.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      const stats = fs.statSync(filePath);
      const sizeMB = stats.size / (1024 * 1024);

      if (sizeMB > 99) {
        fs.unlinkSync(filePath);
        await conn.sendMessage(chatId, {
          text: `❌ Un video pesa ${sizeMB.toFixed(2)}MB y excede el límite de 99MB.`
        }, { quoted: msg });
        continue;
      }

      await conn.sendMessage(chatId, {
        video: fs.readFileSync(filePath),
        mimetype: "video/mp4",
        caption
      }, { quoted: msg });

      fs.unlinkSync(filePath);
    }

    await conn.sendMessage(chatId, {
      react: { text: "✅", key: msg.key }
    });

  } catch (err) {
    console.error("❌ Error en comando Instagram:", err);
    await conn.sendMessage(chatId, {
      text: "❌ *Ocurrió un error al procesar el enlace de Instagram.*"
    }, { quoted: msg });
  }
};


handler.help = ["𝖨𝗇𝗌𝗍𝖺𝗀𝗋𝖺𝗆 <𝗎𝗋𝗅>"]
handler.tags = ["𝖣𝖤𝖲𝖢𝖠𝖱𝖦𝖠𝖲"]
handler.command = ["instagram", "ig"];
export default handler;