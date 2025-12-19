const fs = require("fs")
const path = require("path")

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid
  const isGroup = chatId.endsWith("@g.us")
  const senderId = msg.key.participant || msg.key.remoteJid
  const senderNum = senderId.replace(/[^0-9]/g, "")
  const isOwner = global.owner.some(([id]) => id === senderNum)
  const isFromMe = msg.key.fromMe

  if (isGroup) {
    if (!isOwner && !isFromMe) {
      const metadata = await conn.groupMetadata(chatId)
      const participant = metadata.participants.find(p => p.id === senderId)
      const isAdmin = participant?.admin === "admin" || participant?.admin === "superadmin"
      if (!isAdmin) {
        return conn.sendMessage(chatId, {
          text: "🚫 *Solo administradores, owner o el bot pueden usar este comando.*"
        }, { quoted: msg })
      }
    }
  } else {
    if (!isOwner && !isFromMe) {
      return conn.sendMessage(chatId, {
        text: "🚫 *Solo el owner o el bot pueden usar este comando en privado.*"
      }, { quoted: msg })
    }
  }

  if (!isGroup) {
    return conn.sendMessage(chatId, {
      text: "❌ *Este comando solo puede usarse en grupos.*"
    }, { quoted: msg })
  }

  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
  if (!quoted?.stickerMessage) {
    return conn.sendMessage(chatId, {
      text: "❌ *Responde a un sticker para asignarle un comando.*"
    }, { quoted: msg })
  }

  const comando = args.join(" ").trim()
  if (!comando) {
    return conn.sendMessage(chatId, {
      text: "⚠️ *Especifica el comando a asignar. Ejemplo:* addco kick"
    }, { quoted: msg })
  }

  const fileSha = quoted.stickerMessage.fileSha256?.toString("base64")
  if (!fileSha) {
    return conn.sendMessage(chatId, {
      text: "❌ *No se pudo obtener el ID único del sticker.*"
    }, { quoted: msg })
  }

  const jsonPath = path.resolve("./comandos.json")
  const data = fs.existsSync(jsonPath)
    ? JSON.parse(fs.readFileSync(jsonPath, "utf-8"))
    : {}

  data[fileSha] = {
    command: comando,
    chat: chatId
  }

  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2))

  await conn.sendMessage(chatId, {
    react: { text: "✅", key: msg.key }
  })

  return conn.sendMessage(chatId, {
    text: `✅ *Sticker vinculado al comando:* \`${comando}\`\n📌 *Solo funcionará en este grupo*`,
    quoted: msg
  })
}

handler.command = ["addco"]
handler.tags = ["tools"]
handler.help = ["addco <comando>"]
module.exports = handler