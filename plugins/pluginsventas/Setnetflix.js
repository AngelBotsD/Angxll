const fs = require("fs");
const path = require("path");

// ——— Helpers LID-aware ———
const DIGITS = (s = "") => String(s).replace(/\D/g, "");

/** Normaliza: si participante viene como @lid y trae .jid (real), usa .jid */
function lidParser(participants = []) {
  try {
    return participants.map(v => ({
      id: (typeof v?.id === "string" && v.id.endsWith("@lid") && v.jid) ? v.jid : v.id,
      admin: v?.admin ?? null,
      raw: v
    }));
  } catch {
    return participants || [];
  }
}

/** Admin por NÚMERO real (funciona en LID y no-LID) */
async function isAdminByNumber(conn, chatId, number) {
  try {
    const meta = await conn.groupMetadata(chatId);
    const raw  = Array.isArray(meta?.participants) ? meta.participants : [];
    const norm = lidParser(raw);

    const adminNums = new Set();
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i], n = norm[i];
      const isAdm = (r?.admin === "admin" || r?.admin === "superadmin" ||
                     n?.admin === "admin" || n?.admin === "superadmin");
      if (isAdm) {
        [r?.id, r?.jid, n?.id].forEach(x => {
          const d = DIGITS(x || "");
          if (d) adminNums.add(d);
        });
      }
    }
    return adminNums.has(number);
  } catch {
    return false;
  }
}

/** Extrae texto del mensaje citado (manteniendo saltos/espacios) */
function getQuotedText(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  return (
    q.conversation ||
    q?.extendedTextMessage?.text ||
    q?.ephemeralMessage?.message?.conversation ||
    q?.ephemeralMessage?.message?.extendedTextMessage?.text ||
    q?.viewOnceMessageV2?.message?.conversation ||
    q?.viewOnceMessageV2?.message?.extendedTextMessage?.text ||
    q?.viewOnceMessageV2Extension?.message?.conversation ||
    q?.viewOnceMessageV2Extension?.message?.extendedTextMessage?.text ||
    null
  );
}

const handler = async (msg, { conn, args, text, wa }) => {
  const chatId    = msg.key.remoteJid;
  const isGroup   = chatId.endsWith("@g.us");
  const senderJid = msg.key.participant || msg.key.remoteJid; // puede ser @lid
  const senderNum = DIGITS(senderJid);
  const isFromMe  = !!msg.key.fromMe;

  if (!isGroup) {
    return conn.sendMessage(chatId, { text: "❌ Este comando solo funciona en grupos." }, { quoted: msg });
  }

  // Permisos: admin / owner / bot
  const isAdmin = await isAdminByNumber(conn, chatId, senderNum);
  const owners  = Array.isArray(global.owner) ? global.owner : [];
  const isOwner = owners.some(([id]) => id === senderNum);

  if (!isAdmin && !isOwner && !isFromMe) {
    return conn.sendMessage(chatId, { text: "🚫 Este comando solo puede ser usado por administradores." }, { quoted: msg });
  }

  // ——— Texto crudo (NO trim, respeta \n y espacios) ———
  const textoArg   = typeof text === "string" ? text : (Array.isArray(args) ? args.join(" ") : "");
  const textoCrudo = textoArg; // tal cual

  // Texto del citado si no escribieron nada
  const quotedText = !textoCrudo ? getQuotedText(msg) : null;

  // ¿Imagen citada?
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedImage = ctx?.quotedMessage?.imageMessage;

  if (!textoCrudo && !quotedText && !quotedImage) {
    return conn.sendMessage(
      chatId,
      { text: "✏️ Usa el comando así:\n\n• *setnetflix <texto>* (multilínea permitido)\n• O responde a una *imagen* con: *setnetflix <texto>*" },
      { quoted: msg }
    );
  }

  // Descargar imagen si fue citada
  let imagenBase64 = null;
  if (quotedImage) {
    try {
      const stream = await wa.downloadContentFromMessage(quotedImage, "image");
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      imagenBase64 = buffer.toString("base64");
    } catch (e) {
      console.error("[setnetflix] error leyendo imagen citada:", e);
    }
  }

  const textoFinal = (textoCrudo || quotedText || "");

  // Guardar EXACTO
  const filePath = "./ventas365.json";
  let ventas = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : {};
  if (!ventas[chatId]) ventas[chatId] = {};
  ventas[chatId]["setnetflix"] = {
    texto: textoFinal,   // 👈 Se guarda tal cual
    imagen: imagenBase64 // null si no hay imagen
  };

  fs.writeFileSync(filePath, JSON.stringify(ventas, null, 2));
  await conn.sendMessage(chatId, { text: "✅ *NETFLIX actualizado con éxito.*" }, { quoted: msg });
};

handler.command = ["setnetflix"];
module.exports = handler;
