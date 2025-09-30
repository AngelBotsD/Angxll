// fb.js — comando Facebook adaptado a api-sky.ultraplus.click (con estilo Suki)
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://api-sky.ultraplus.click";
const SKY_API_KEY = process.env.SKY_API_KEY || global.SKY_API_KEY || ""; // <-- pon tu key
const MAX_MB = 99;

function fmtDur(s) {
  const n = Number(s || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return (h ? `${h}:` : "") + `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

async function callSkyFacebook(url) {
  if (!SKY_API_KEY) throw new Error("Falta SKY_API_KEY");
  const headers = { Authorization: `Bearer ${SKY_API_KEY}` };

  // 1) endpoint .js
  try {
    const r = await axios.get(`${API_BASE}/api/download/facebook`, {
      params: { url },
      headers,
      timeout: 30000
    });
    if (r.data?.status === "true" && r.data?.data) return r.data;
  } catch (_) { /* seguimos al fallback */ }

  // 2) fallback .php (por compatibilidad)
  const r2 = await axios.get(`${API_BASE}/api/download/facebook.php`, {
    params: { url },
    headers,
    timeout: 30000
  });
  if (r2.data?.status === "true" && r2.data?.data) return r2.data;

  // si llega aquí, devolvemos error legible
  const errMsg = r2.data?.error || "no_media_found";
  const httpMsg = r2.status ? `HTTP ${r2.status}` : "sin respuesta";
  throw new Error(`Sky API fallo: ${errMsg} (${httpMsg})`);
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const text = args.join(" ").trim();
  const pref = (global.prefixes?.[0] || ".");

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
        text:
`✳️ 𝙐𝙨𝙖:
${pref}${command} <enlace>
📌 Ej: ${pref}${command} https://fb.watch/ncowLHMp-x/`
      },
      { quoted: msg }
    );
  }

  if (!/(facebook\.com|fb\.watch)/i.test(text)) {
    return conn.sendMessage(
      chatId,
      {
        text:
`❌ 𝙀𝙣𝙡𝙖𝙘𝙚 𝙞𝙣𝙫𝙖́𝙡𝙞𝙙𝙤.

✳️ 𝙐𝙨𝙖:
${pref}${command} <enlace>
📌 Ej: ${pref}${command} https://fb.watch/ncowLHMp-x/`
      },
      { quoted: msg }
    );
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    // Llama a tu API Sky
    const sky = await callSkyFacebook(text);
    const d = sky.data || {};
    const videoUrl = d.video_hd || d.video_sd;
    if (!videoUrl) {
      return conn.sendMessage(chatId, { text: "🚫 𝙉𝙤 𝙨𝙚 𝙥𝙪𝙙𝙤 𝙤𝙗𝙩𝙚𝙣𝙚𝙧 𝙚𝙡 𝙫𝙞𝙙𝙚𝙤." }, { quoted: msg });
    }

    // Descarga temporal
    const tmpDir = path.resolve("./tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `fb-${Date.now()}.mp4`);

    const videoRes = await axios.get(videoUrl, { responseType: "stream", timeout: 120000 });
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath);
      videoRes.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // Límite de tamaño
    const sizeMB = fs.statSync(filePath).size / (1024 * 1024);
    if (sizeMB > MAX_MB) {
      fs.unlinkSync(filePath);
      return conn.sendMessage(
        chatId,
        {
          text:
`⚠️ 𝙀𝙡 𝙖𝙧𝙘𝙝𝙞𝙫𝙤 𝙥𝙚𝙨𝙖 ${sizeMB.toFixed(2)} MB.
🔒 𝙎𝙤𝙡𝙤 𝙨𝙚 𝙥𝙚𝙧𝙢𝙞𝙩𝙚𝙣 𝙫𝙞𝙙𝙚𝙤𝙨 < ${MAX_MB} MB.`
        },
        { quoted: msg }
      );
    }

    // Caption “Suki” futurista
    const resos = [
      d.video_hd ? "HD" : null,
      d.video_sd && !d.video_hd ? "SD" : d.video_sd ? "SD (alt)" : null
    ].filter(Boolean).join(" · ") || "Auto";

    const caption =
`⚡ 𝗙𝗮𝗰𝗲𝗯𝗼𝗼𝗸 𝗩𝗶𝗱𝗲𝗼 — 𝗟𝗶𝘀𝘁𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${d.title || "Facebook Video"}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${fmtDur(d.duration)}
✦ 𝗥𝗲𝘀𝗼𝗹𝘂𝗰𝗶𝗼́𝗻: ${resos}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click

────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

    await conn.sendMessage(
      chatId,
      {
        video: fs.readFileSync(filePath),
        mimetype: "video/mp4",
        caption
      },
      { quoted: msg }
    );

    // Limpieza + reacción ok
    fs.unlinkSync(filePath);
    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("❌ Error en comando Facebook (Sky):", err?.message || err);
    await conn.sendMessage(
      chatId,
      { text: "❌ 𝙊𝙘𝙪𝙧𝙧𝙞𝙤́ 𝙪𝙣 𝙚𝙧𝙧𝙤𝙧 𝙖𝙡 𝙥𝙧𝙤𝙘𝙚𝙨𝙖𝙧 𝙚𝙡 𝙫𝙞𝙙𝙚𝙤 𝙙𝙚 𝙁𝙖𝙘𝙚𝙗𝙤𝙤𝙠." },
      { quoted: msg }
    );
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["facebook", "fb"];
handler.help = ["facebook <url>", "fb <url>"];
handler.tags = ["descargas"];
handler.register = true;

module.exports = handler;
