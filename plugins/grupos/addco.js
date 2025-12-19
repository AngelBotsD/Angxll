// plugins/addco.js
const fs = require("fs");
const path = require("path");

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const senderId = msg.key.participant || msg.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isFromMe = msg.key.fromMe;

  // OWNER
  const isOwner = global.owner?.some(([id]) => id === senderNum);

  // ================== PERMISOS ==================
  if (isGroup) {
    // En grupos: solo admin / owner / bot
    if (!isOwner && !isFromMe) {
      const metadata = await conn.groupMetadata(chatId);
      const participant = metadata.participants.find(p => p.id === senderId);
      const isAdmin =
        participant?.admin === "admin" ||
        participant?.admin === "superadmin";

      if (!isAdmin) {
        return conn.sendMessage(
          chatId,
          { text: "🚫 *Solo administradores, owner o el bot pueden usar este comando.*" },
          { quoted: msg }
        );
      }
    }
  } else {
    // En privado: solo owner o bot
    if (!isOwner && !isFromMe) {
      return conn.sendMessage(
        chatId,
        { text: "🚫 *Este comando solo puede usarlo el owner o el bot en privado.*" },
        { quoted: msg }
      );
    }
  }
  // =================================================

  // Debe responder a un sticker
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted?.stickerMessage) {
    return conn.sendMessage(
      chatId,
      { text: "❌ *Responde a un sticker para asignarle un comando.*" },
      { quoted: msg }
    );
  }

  // Comando a asignar
  const comando = args.join(" ").trim();
  if (!comando) {
    return conn.sendMessage(
      chatId,
      { text: "⚠️ *Especifica el comando.*\nEjemplo: `addco kick`" },
      { quoted: msg }
    );
  }

  // ID único del sticker
  const fileSha = quoted.stickerMessage.fileSha256?.toString("base64");
  if (!fileSha) {
    return conn.sendMessage(
      chatId,
      { text: "❌ *No se pudo obtener el ID del sticker.*" },
      { quoted: msg }
    );
  }

  // Guardar en JSON
  const jsonPath = path.resolve("./comandos.json");
  const data = fs.existsSync(jsonPath)
    ? JSON.parse(fs.readFileSync(jsonPath, "utf-8"))
    : {};

  data[fileSha] = comando;
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

  // Reacción
  await conn.sendMessage(chatId, {
    react: { text: "✅", key: msg.key }
  });

  // Confirmación
  return conn.sendMessage(
    chatId,
    { text: `✅ *Sticker vinculado al comando con éxito:*\n\n➤ ${comando}` },
    { quoted: msg }
  );
};

handler.command = ["addco"];
handler.tags = ["tools"];
handler.help = ["addco <comando>"];

module.exports = handler;