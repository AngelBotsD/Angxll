// plugins/kick.js
const fs = require("fs");
const path = require("path");

const DIGITS = (s = "") => String(s || "").replace(/\D/g, "");

/** Busca un participante por dígitos (coincide por p.id o p.jid) */
function findParticipantByDigits(parts = [], digits = "") {
  if (!digits) return null;
  return parts.find(p => DIGITS(p?.id || "") === digits || DIGITS(p?.jid || "") === digits) || null;
}

const handler = async (msg, { conn }) => {
  const chatId   = msg.key.remoteJid;
  const isGroup  = chatId.endsWith("@g.us");
  const isFromMe = !!msg.key.fromMe;

  // autor (puede venir @lid). Si tu index ya define msg.realJid, úsalo para el número
  const senderRaw = msg.key.participant || msg.key.remoteJid;
  const senderNum = DIGITS(typeof msg.realJid === "string" ? msg.realJid : senderRaw);

  if (!isGroup) {
    await conn.sendMessage(chatId, { text: "❌ *Este comando solo funciona en grupos.*" }, { quoted: msg });
    return;
  }

  // owners y bot
  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath, "utf-8")) : [];
  const isOwner = Array.isArray(owners) && owners.some(([id]) => id === senderNum);

  const botRaw = conn.user?.id || "";
  const botNum = DIGITS(botRaw.split(":")[0]);
  const isBot  = botNum === senderNum;

  let metadata;
  try {
    metadata = await conn.groupMetadata(chatId);
  } catch (e) {
    console.error("[kick] metadata error:", e);
    await conn.sendMessage(chatId, { text: "❌ No pude leer la metadata del grupo." }, { quoted: msg });
    return;
  }

  const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const authorP = findParticipantByDigits(participantes, senderNum);
  const isAdmin = !!authorP && (authorP.admin === "admin" || authorP.admin === "superadmin");

  if (!isAdmin && !isOwner && !isBot && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "⛔ *Solo administradores u owners pueden usar este comando.*"
    }, { quoted: msg });
    return;
  }

  // Obtener mencionados o citado
  const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
  const mentioned = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
  const quotedJid = ctx.participant || null;

  // Construir candidatos (por dígitos), de-duplicados
  const targetDigits = new Set(
    [
      ...mentioned.map(j => DIGITS(j)),
      quotedJid ? DIGITS(quotedJid) : ""
    ].filter(Boolean)
  );

  if (targetDigits.size === 0) {
    await conn.sendMessage(chatId, {
      text: "📌 *Debes mencionar o responder al mensaje del usuario que deseas expulsar.*\n\nEjemplo: *.kick @usuario* o responde a su mensaje con *.kick*"
    }, { quoted: msg });
    return;
  }

  const resultados = [];
  const mentionsOut = []; // para @menciones en el resumen
  for (const d of targetDigits) {
    // No te permitas expulsarte a ti ni al bot
    if (d === senderNum) {
      resultados.push(`⚠️ No puedes expulsarte a ti mismo (@${d}).`);
      continue;
    }
    if (d === botNum) {
      resultados.push(`⚠️ No puedo expulsarme a mí (@${d}).`);
      continue;
    }

    const targetP = findParticipantByDigits(participantes, d);
    if (!targetP) {
      resultados.push(`❌ *No encontré al usuario @${d} en este grupo.*`);
      continue;
    }

    // Si el grupo usa LID, targetP.id suele ser @lid. groupParticipantsUpdate acepta ese id.
    const targetGroupId = targetP.id || targetP.jid;

    // Respetar admins/owners
    const isTargetAdmin = targetP.admin === "admin" || targetP.admin === "superadmin";
    const isTargetOwner = Array.isArray(owners) && owners.some(([id]) => id === d);

    if (isTargetAdmin || isTargetOwner) {
      resultados.push(`⚠️ *No se puede expulsar a @${d} (admin/owner).*`);
      continue;
    }

    try {
      await conn.groupParticipantsUpdate(chatId, [targetGroupId], "remove");
      resultados.push(`✅ *Usuario @${d} expulsado.*`);
      mentionsOut.push(targetGroupId);
    } catch (err) {
      console.error("[kick] remove error:", err);
      resultados.push(`❌ *Error al expulsar a @${d}.*`);
      mentionsOut.push(targetGroupId);
    }
  }

  await conn.sendMessage(chatId, {
    text: resultados.join("\n"),
    mentions: mentionsOut
  }, { quoted: msg });

  await conn.sendMessage(chatId, { react: { text: "👢", key: msg.key } }).catch(() => {});
};

handler.command = ["kick"];
module.exports = handler;