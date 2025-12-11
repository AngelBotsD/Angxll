// plugins/nodes.js — cuenta servidores por nodo (Pterodactyl) con credenciales fijas
const fetch = require("node-fetch");

// 🔐 TUS CREDENCIALES
const PTERO_URL = "https://panel.skyultraplus.com";
const PTERO_APP_KEY = "ptla_lphUKfggLhvDYAO4KsIpxAV4sXTny537lNvb7RJVeGj";

async function fetchAll(url, headers) {
  const out = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (Array.isArray(json.data)) out.push(...json.data);
    next =
      json?.meta?.pagination?.links?.next ||
      json?.links?.next ||
      null;
  }
  return out;
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    const base = (PTERO_URL || "").replace(/\/+$/, "");
    const token = PTERO_APP_KEY || "";

    if (!base || !token) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        { text: "⚠️ Falta configurar PTERO_URL o PTERO_APP_KEY." },
        { quoted: msg }
      );
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    // Obtener nodos y servidores
    const nodes = await fetchAll(`${base}/api/application/nodes?per_page=100`, headers);
    const servers = await fetchAll(`${base}/api/application/servers?per_page=100`, headers);

    // Conteo por node_id
    const countByNodeId = {};
    for (const s of servers) {
      const nodeId = s?.attributes?.node;
      if (!nodeId) continue;
      countByNodeId[nodeId] = (countByNodeId[nodeId] || 0) + 1;
    }

    // Filtro opcional: id exacto o parte del nombre
    const q = (args || []).join(" ").trim().toLowerCase();
    const list = nodes.filter(n => {
      if (!q) return true;
      const idMatch = String(n?.attributes?.id) === q;
      const name = (n?.attributes?.name || "").toLowerCase();
      return idMatch || name.includes(q);
    });

    if (!list.length) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(
        chatId,
        { text: "No encontré nodos con ese filtro." },
        { quoted: msg }
      );
    }

    let total = 0;
    const lines = list.map(n => {
      const id = n.attributes.id;
      const name = n.attributes.name;
      const fqdn = n.attributes.fqdn;
      const count = countByNodeId[id] || 0;
      total += count;
      return `🔹 *#${id}* — *${name}*\n   🌐 ${fqdn}\n   🧩 Servidores: *${count}*`;
    });

    if (!q) {
      const sumAll = Object.values(countByNodeId).reduce((a, b) => a + b, 0);
      lines.push(`\n📊 Total servidores (todos los nodos): *${sumAll}*`);
    } else {
      lines.push(`\n📊 Total en lista filtrada: *${total}*`);
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
    return conn.sendMessage(
      chatId,
      { text: `🗄️ *Nodos Pterodactyl*\n\n${lines.join("\n")}` },
      { quoted: msg }
    );
  } catch (err) {
    console.error("[nodes] Error:", err);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(
      chatId,
      { text: "❌ Error obteniendo los nodos/servidores." },
      { quoted: msg }
    );
  }
};

handler.command = ["nodos", "nodes", "countnode"];
module.exports = handler;
