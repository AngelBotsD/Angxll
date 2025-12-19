// plugins/abrirgrupo.js
const DIGITS = (s = "") => String(s || "").replace(/\D/g, "");

const handler = async (msg, { conn }) => {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith("@g.us");

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ *Este comando solo funciona en grupos.*" }, { quoted: msg });
  }

  // autor (puede venir en @lid o @s.whatsapp.net; además, si tu index setea msg.realJid, lo usamos)
  const senderId      = msg.key.participant || msg.key.remoteJid;
  const senderRealJid = typeof msg.realJid === "string" ? msg.realJid : (senderId?.endsWith?.("@s.whatsapp.net") ? senderId : null);
  const senderDigits  = DIGITS(senderRealJid || senderId);

  // permisos "dueño" y "soy yo"
  const isOwner = Array.isArray(global.owner) && global.owner.some(([id]) => id === senderDigits);
  const isFromMe = !!msg.key.fromMe;

  // pequeña reacción
  try { await conn.sendMessage(chatId, { react: { text: "🔐", key: msg.key } }); } catch {}

  // metadata del grupo
  let metadata;
  try {
    metadata = await conn.groupMetadata(chatId);
  } catch (e) {
    console.error("[abrirgrupo] metadata error:", e);
    return conn.sendMessage(chatId, { text: "❌ No pude leer la metadata del grupo." }, { quoted: msg });
  }

  const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];

  // construimos candidatos del autor para comparar (LID, REAL y por dígitos)
  const authorCandidates = new Set([
    senderId,
    senderRealJid,
    `${senderDigits}@s.whatsapp.net`,
    `${senderDigits}@lid`
  ].filter(Boolean));

  // ¿es admin? (funciona en LID y no-LID)
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
    await conn.groupSettingUpdate(chatId, "not_announcement");
    await conn.sendMessage(chatId, {
      text: "🔓 *El grupo ha sido abierto.*\n📢 *Todos los miembros pueden enviar mensajes ahora.*"
    }, { quoted: msg });
  } catch (e) {
    console.error("[abrirgrupo] error al abrir:", e);
    await conn.sendMessage(chatId, { text: "❌ No pude abrir el grupo." }, { quoted: msg });
  }
};

handler.command = ["abrirgrupo", "abrir"];
module.exports = handler;