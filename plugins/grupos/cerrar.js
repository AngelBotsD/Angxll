// plugins/cerrargrupo.js
const DIGITS = (s = "") => String(s || "").replace(/\D/g, "");

const handler = async (msg, { conn }) => {
  const chatId  = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ *Este comando solo funciona en grupos.*" }, { quoted: msg });
  }

  // Autor (puede venir @lid o @s.whatsapp.net). Si tu index setea msg.realJid, lo usamos.
  const senderId      = msg.key.participant || msg.key.remoteJid;
  const senderRealJid = typeof msg.realJid === "string"
    ? msg.realJid
    : (senderId?.endsWith?.("@s.whatsapp.net") ? senderId : null);
  const senderDigits  = DIGITS(senderRealJid || senderId);

  const isOwner  = Array.isArray(global.owner) && global.owner.some(([id]) => id === senderDigits);
  const isFromMe = !!msg.key.fromMe;

  try { await conn.sendMessage(chatId, { react: { text: "🔒", key: msg.key } }); } catch {}

  // Metadata
  let metadata;
  try {
    metadata = await conn.groupMetadata(chatId);
  } catch (e) {
    console.error("[cerrargrupo] metadata error:", e);
    return conn.sendMessage(chatId, { text: "❌ No pude leer la metadata del grupo." }, { quoted: msg });
  }

  const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];

  // Candidatos del autor para comparar (LID, REAL y por dígitos)
  const authorCandidates = new Set([
    senderId,
    senderRealJid,
    `${senderDigits}@s.whatsapp.net`,
    `${senderDigits}@lid`
  ].filter(Boolean));

  // ¿Es admin? (funciona tanto en LID como en no-LID)
  const isAdmin = participantes.some(p => {
    const idsPosibles = [
      p?.id,                                   // puede ser @lid o real
      typeof p?.jid === "string" ? p.jid : ""  // algunos wrappers traen .jid = real
    ].filter(Boolean);

    const matchId = idsPosibles.some(id => authorCandidates.has(id) || DIGITS(id) === senderDigits);
    const rolOK   = p?.admin === "admin" || p?.admin === "superadmin";
    return matchId && rolOK;
  });

  if (!isAdmin && !isOwner && !isFromMe) {
    return conn.sendMessage(chatId, {
      text: "🚫 Solo administradores u owners pueden usar este comando."
    }, { quoted: msg });
  }

  try {
    await conn.groupSettingUpdate(chatId, "announcement");
    await conn.sendMessage(chatId, {
      text: "🔒 *El grupo ha sido cerrado.*\n📢 *Solo los administradores pueden enviar mensajes ahora.*"
    }, { quoted: msg });
  } catch (e) {
    console.error("[cerrargrupo] error al cerrar:", e);
    await conn.sendMessage(chatId, { text: "❌ No pude cerrar el grupo." }, { quoted: msg });
  }
};

handler.command = ["cerrargrupo", "cerrar"];
module.exports = handler;