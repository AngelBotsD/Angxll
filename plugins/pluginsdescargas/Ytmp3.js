"use strict";

const express = require("express");
const router = express.Router();
const axios = require("axios");
const { Readable } = require("stream");

// --- CONFIGURACIÓN (Index.js lee esto para el menú) ---
const config = {
  name: "YouTube MP3 Downloader",
  icon: "ri-youtube-fill",
  route: "/youtube-mp3",
  category_id: 1,
};

// -------------------- HELPERS --------------------
function h(v = "") {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeBaseFromTitle(title, def = "youtube") {
  const base = String(title || def).slice(0, 70);
  const safe = base.replace(/[^A-Za-z0-9_\-.]+/g, "_");
  return safe || def;
}

// Auth: sesión (web) o apikey (bots)
function requireAuth(req, res) {
  if (!req.currentUser) {
    if (typeof res.error === "function") return res.error("API Key requerida", 401);
    return res.status(401).json({ status: false, message: "API Key requerida" });
  }
  return null;
}

// SSRF básico
function isPrivateIPv4(ip) {
  const m = String(ip).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = m.slice(1).map((n) => Number(n));
  if (a.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  if (a[0] === 10) return true;
  if (a[0] === 127) return true;
  if (a[0] === 192 && a[1] === 168) return true;
  if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return true;
  if (a[0] === 0) return true;
  return false;
}

function validateRemoteUrl(src) {
  let u;
  try {
    u = new URL(src);
  } catch {
    return { ok: false, reason: "URL inválida" };
  }
  if (!["http:", "https:"].includes(u.protocol)) return { ok: false, reason: "Protocolo no permitido" };

  const host = (u.hostname || "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "Host no permitido" };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateIPv4(host)) return { ok: false, reason: "IP privada bloqueada" };

  return { ok: true, url: u };
}

// -------------------- SCRAPER YOUTUBE MP3 (hub.y2mp3.co) --------------------
async function downloadYouTubeAudio(urlVideo) {
  try {
    const data = {
      url: urlVideo,
      downloadMode: "audio",
      brandName: "ytmp3.gg",
      audioFormat: "mp3",
      audioBitrate: "128"
    };

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    const response = await axios.post('https://hub.y2mp3.co/', data, { headers });

    const { url: mp3Url, filename } = response.data;

    if (!mp3Url) throw new Error("No se encontró enlace MP3");

    return { mp3Url, filename };
  } catch (error) {
    throw new Error('Error al descargar el audio: ' + error.message);
  }
}

// -------------------- 1) PROXY DE DESCARGA / STREAM (NO COBRA) --------------------
// GET /youtube-mp3/dl?type=audio&src=...&filename=...&download=1
router.get("/dl", async (req, res) => {
  const authErr = requireAuth(req, res);
  if (authErr) return;

  const type = String(req.query.type || "").toLowerCase();
  const src = String(req.query.src || "");
  const download = String(req.query.download || "") === "1";
  let filename = String(req.query.filename || "");

  if (!src) return res.error("Falta src", 400);
  if (type !== "audio") return res.error("Type inválido", 400);

  const v = validateRemoteUrl(src);
  if (!v.ok) return res.error(`src inválido: ${v.reason}`, 400);

  // filename seguro
  if (!filename) filename = "youtube.mp3";
  filename = filename.slice(0, 120).replace(/[^A-Za-z0-9_\-.]+/g, "_");
  if (!filename) filename = "youtube.mp3";

  try {
    const range = req.headers.range;
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    };
    if (range) headers["Range"] = range;

    const upstream = await fetch(v.url.toString(), { headers });

    res.status(upstream.status);

    if (!upstream.ok && upstream.status !== 206) {
      return res.error(`Upstream error: ${upstream.status}`, 502);
    }

    const ct = upstream.headers.get("content-type") || "audio/mpeg";
    res.setHeader("Content-Type", ct);

    const cl = upstream.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);

    const cr = upstream.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);

    const ar = upstream.headers.get("accept-ranges");
    if (ar) res.setHeader("Accept-Ranges", ar);

    if (download) {
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    } else {
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    }

    res.setHeader("Cache-Control", "no-store");

    if (!upstream.body) return res.error("Upstream sin body", 502);

    const nodeStream =
      typeof Readable.fromWeb === "function" ? Readable.fromWeb(upstream.body) : upstream.body;

    nodeStream.on("error", () => {
      try { res.end(); } catch {}
    });

    nodeStream.pipe(res);
  } catch (e) {
    return res.error("Error descargando: " + (e?.message || "unknown"), 500);
  }
});

// -------------------- 2) API (POST) - Lógica de Descarga (COBRA EN ÉXITO) --------------------
router.post("/", async (req, res) => {
  const authErr = requireAuth(req, res);
  if (authErr) return;

  try {
    const url = String((req.body?.url || req.query?.url || "").trim());

    if (!url) return res.error("Falta la URL", 400);
    if (!/youtube\.com|youtu\.be/i.test(url)) return res.error("Enlace no válido", 400);

    const { mp3Url, filename } = await downloadYouTubeAudio(url);

    const result = {
      title: filename.replace(/\.mp3$/, "") || "YouTube Audio",
      artist: "YouTube",
      album: "",
      duration: 0, // scraper no da duración
      cover: "",
      media: {
        audio: mp3Url,
      },
    };

    return res.success(result); // cobra 1 soli
  } catch (e) {
    return res.error("Error interno: " + (e?.message || "unknown"), 500);
  }
});

// -------------------- 3) INTERFAZ (GET) --------------------
router.get("/", (req, res) => {
  const user = req.session?.user;
  if (!user) return res.redirect("/login");

  const apiKey = String(user.apikey || "");

  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = req.get("host");
  const fullUrl = `\( {proto}:// \){host}${config.route}`;

  res.type("html").send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YouTube MP3 - SkyUltraPlus</title>
  <link href="https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Rajdhani:wght@500;700&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#050508;--card:rgba(16,20,35,.9);--neon:#00f3ff;--pink:#ff0000;--text:#e0f7ff;--border:1px solid rgba(0,243,255,0.2)}
    body.light-mode{--bg:#f0f4f8;--card:#fff;--neon:#0056b3;--text:#1e293b;--border:1px solid #ccc}
    body{background:var(--bg);color:var(--text);font-family:'Rajdhani';padding:20px;transition:.3s;overflow-x:hidden}
    .bg-container{position:fixed;inset:0;pointer-events:none;z-index:-1}
    .grid-bg{position:absolute;inset:-50%;width:200%;height:200%;background-image:linear-gradient(rgba(0,243,255,0.1) 1px,transparent 1px),linear-gradient(90deg,rgba(0,243,255,0.1) 1px,transparent 1px);background-size:50px 50px;transform:perspective(500px) rotateX(60deg);animation:moveGrid 20s linear infinite;opacity:.5}
    .moon{position:absolute;top:30px;right:30px;width:100px}
    .star-container{position:absolute;inset:0}
    .cloud{position:absolute;opacity:0;transition:.5s}
    body.light-mode .cloud{opacity:.9}
    body.light-mode .grid-bg,body.light-mode .moon,body.light-mode .star-container{display:none}
    .cloud-1{top:10%;left:-10%;width:200px;animation:float 30s linear infinite}
    .cloud-2{top:40%;right:-5%;width:280px;animation:float 45s linear infinite reverse}
    .cloud-3{top:70%;left:20%;width:150px;animation:float 35s linear infinite}
    @keyframes moveGrid{0%{transform:perspective(500px) rotateX(60deg) translateY(0)}100%{transform:perspective(500px) rotateX(60deg) translateY(50px)}}
    @keyframes float{0%{transform:translateX(0)}100%{transform:translateX(100vw)}}
    .container{max-width:900px;margin:0 auto;position:relative;z-index:10}
    .header{text-align:center;margin-bottom:30px;margin-top:40px}
    .header h1{font-family:'Orbitron';font-size:30px;background:linear-gradient(90deg,#fff,var(--pink));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .nav-btn{position:absolute;top:0;padding:8px 15px;border-radius:8px;text-decoration:none;font-weight:bold;background:var(--card);border:var(--border);color:var(--text);display:flex;align-items:center;gap:5px}
    .back-btn{left:0}
    .theme-btn{right:0;cursor:pointer}
    .card{background:var(--card);border:var(--border);border-radius:12px;padding:25px;margin-bottom:20px}
    .input-group{display:flex;gap:10px;flex-wrap:wrap}
    input{flex:1;min-width:220px;padding:12px;background:rgba(0,0,0,0.5);border:1px solid #555;color:var(--text);border-radius:6px;outline:none}
    button.action{padding:12px 18px;background:var(--neon);color:black;border:none;font-weight:bold;border-radius:6px;cursor:pointer}
    button.ghost{padding:12px 18px;background:transparent;border:1px solid rgba(255,255,255,.25);color:var(--text);border-radius:6px;cursor:pointer}
    #result{display:none;margin-top:20px;text-align:center;animation:fadeIn .5s}
    audio{width:100%;max-width:600px;border-radius:8px;border:1px solid #333;margin:10px 0}
    .dl-btns{display:flex;justify-content:center;gap:10px;margin-top:10px;flex-wrap:wrap}
    .dl-btn{padding:10px 16px;border-radius:6px;text-decoration:none;color:white;font-weight:bold;display:flex;align-items:center;gap:5px}
    .aud-btn{background:var(--pink)}
    .json-btn{background:#334155}
    pre{background:#111;padding:10px;border-radius:6px;overflow-x:auto;border:1px solid #333;color:#0f0;text-align:left}
    .tiny{opacity:.85;font-size:13px}
    .pill{display:inline-flex;gap:8px;align-items:center;padding:6px 10px;border-radius:999px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18)}
    .row{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}
    .tabbar{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
    .tab{padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);cursor:pointer;font-weight:700}
    .tab.active{border-color:rgba(0,243,255,.45)}
    .docs{display:none}
    .docs.active{display:block}
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  </style>
</head>
<body class="dark-mode">
  <div class="bg-container">
    <div class="grid-bg"></div>
    <div class="star-container"></div>
    <img src="https://cdn.russellxz.click/31fc9323.png" class="moon">
    <img src="https://cdn.russellxz.click/38601416.png" class="cloud cloud-1">
    <img src="https://cdn.russellxz.click/53762552.png" class="cloud cloud-2">
    <img src="https://cdn.russellxz.click/96338b12.png" class="cloud cloud-3">
  </div>

  <div class="container">
    <a href="/" class="nav-btn back-btn"><i class="ri-arrow-left-line"></i> Dashboard</a>
    <button class="nav-btn theme-btn" onclick="toggleTheme()"><i class="ri-contrast-line"></i></button>

    <div class="header">
      <i class="ri-youtube-fill" style="font-size: 50px; color: var(--pink);"></i>
      <h1>YOUTUBE MP3 DOWNLOADER</h1>
      <div class="row tiny">
        <span class="pill"><b>Usuario:</b> ${h(user.username || "")}</span>
        <span class="pill"><b>API Key:</b> <span id="apiMask">${h(apiKey.slice(0, 4))}••••••••••</span>
          <button class="ghost" style="padding:6px 10px" id="revealKey" type="button">👁️</button>
          <button class="ghost" style="padding:6px 10px" id="copyKey" type="button" data-apikey="${h(apiKey)}">📋</button>
        </span>
      </div>
    </div>

    <div class="card">
      <h3 style="font-family:'Orbitron'; color:var(--neon); margin-bottom:15px;">🚀 Probador en Vivo</h3>
      <div class="input-group">
        <input type="text" id="url" placeholder="Pega el enlace de YouTube aquí...">
        <button class="action" onclick="download()">DESCARGAR</button>
        <button class="ghost" onclick="showJson()">VER JSON</button>
      </div>

      <div id="loader" style="display:none; text-align:center; margin-top:20px;">
        <i class="ri-loader-4-line ri-spin" style="font-size:30px; color:var(--neon)"></i>
      </div>

      <div id="result">
        <h4 id="vTitle" style="color:var(--text)"></h4>
        <p id="vAuthor" style="color:var(--pink)"></p>

        <audio id="player" controls playsinline></audio>

        <div class="dl-btns">
          <a id="dlAudio" class="dl-btn aud-btn" target="_blank" rel="noopener"><i class="ri-music-2-line"></i> Descargar MP3</a>
          <button id="btnJson" class="dl-btn json-btn" type="button" onclick="toggleJson()"><i class="ri-braces-line"></i> Mostrar JSON</button>
        </div>

        <div id="jsonBox" style="display:none;margin-top:12px">
          <pre id="jsonOut">{ }</pre>
        </div>

        <p class="tiny" style="margin-top:10px;opacity:.8">
          Tip: el reproductor usa <code>${h(config.route)}/dl</code> en modo <b>inline</b>. El botón de descarga usa <b>download=1</b>.
        </p>
      </div>
    </div>

    <div class="card">
      <h3 style="font-family:'Orbitron'; color:var(--neon); margin-bottom:10px;">💻 Documentación API</h3>

      <div class="tabbar">
        <button class="tab active" id="tabEs" type="button" onclick="switchDocs('es')">🇪🇸 Español</button>
        <button class="tab" id="tabEn" type="button" onclick="switchDocs('en')">🇺🇸 English</button>
      </div>

      <div class="docs active" id="docsEs">
        <p><b>Endpoint:</b> <code>POST ${h(fullUrl)}</code></p>
        <p><b>Headers (elige uno):</b></p>
        <ul class="tiny">
          <li><code>apikey: TU_API_KEY</code></li>
          <li><code>Authorization: Bearer TU_API_KEY</code></li>
        </ul>
        <p><b>Body JSON:</b> <code>{"url":"https://www.youtube.com/watch?v=123"}</code></p>

        <p><b>Ejemplo (cURL):</b></p>
        <pre>curl -X POST "${h(fullUrl)}" \\
  -H "Content-Type: application/json" \\
  -H "apikey: ${h(apiKey)}" \\
  -d '{"url":"https://www.youtube.com/watch?v=123"}'</pre>

        <p><b>Ejemplo (Node + axios):</b></p>
        <pre>const axios = require("axios");

async function ytMp3(url) {
  const { data } = await axios.post("${h(fullUrl)}", { url }, {
    headers: { apikey: "${h(apiKey)}" }
  });
  if (data.status) return data.result;
  throw new Error(data.message || "Error");
}</pre>

        <p class="tiny">✅ En éxito cobra 1 soli. En error no cobra.</p>
      </div>

      <div class="docs" id="docsEn">
        <p><b>Endpoint:</b> <code>POST ${h(fullUrl)}</code></p>
        <p><b>Headers (choose one):</b></p>
        <ul class="tiny">
          <li><code>apikey: YOUR_API_KEY</code></li>
          <li><code>Authorization: Bearer YOUR_API_KEY</code></li>
        </ul>
        <p><b>JSON Body:</b> <code>{"url":"https://www.youtube.com/watch?v=123"}</code></p>

        <p><b>Example (cURL):</b></p>
        <pre>curl -X POST "${h(fullUrl)}" \\
  -H "Content-Type: application/json" \\
  -H "apikey: ${h(apiKey)}" \\
  -d '{"url":"https://www.youtube.com/watch?v=123"}'</pre>

        <p><b>Example (Node + axios):</b></p>
        <pre>const axios = require("axios");

async function ytMp3(url) {
  const { data } = await axios.post("${h(fullUrl)}", { url }, {
    headers: { apikey: "${h(apiKey)}" }
  });
  if (data.status) return data.result;
  throw new Error(data.message || "Error");
}</pre>

        <p class="tiny">✅ Success charges 1 soli. Errors do not charge.</p>
      </div>
    </div>
  </div>

<script>
  // TEMA
  const body = document.body;
  function toggleTheme() {
    if (body.classList.contains('light-mode')) {
      body.classList.remove('light-mode');
      localStorage.setItem('theme','dark');
    } else {
      body.classList.add('light-mode');
      localStorage.setItem('theme','light');
    }
  }
  if (localStorage.getItem('theme') === 'light') toggleTheme();

  // DOCS tabs
  function switchDocs(lang){
    const es = document.getElementById('docsEs');
    const en = document.getElementById('docsEn');
    const tabEs = document.getElementById('tabEs');
    const tabEn = document.getElementById('tabEn');
    if(lang === 'en'){
      es.classList.remove('active'); en.classList.add('active');
      tabEs.classList.remove('active'); tabEn.classList.add('active');
    } else {
      en.classList.remove('active'); es.classList.add('active');
      tabEn.classList.remove('active'); tabEs.classList.add('active');
    }
  }

  // API key UI
  const revealBtn = document.getElementById('revealKey');
  const copyBtn   = document.getElementById('copyKey');
  const apiMask   = document.getElementById('apiMask');
  const fullKey   = (copyBtn.dataset.apikey || '');
  let revealed=false;
  revealBtn.addEventListener('click', ()=>{
    revealed = !revealed;
    apiMask.textContent = revealed ? fullKey : (fullKey.slice(0,4) + '••••••••••');
  });
  copyBtn.addEventListener('click', async ()=>{
    try{ await navigator.clipboard.writeText(fullKey); copyBtn.textContent='✔'; setTimeout(()=>copyBtn.textContent='📋',1200);}catch{}
  });

  let lastJson = null;
  function toggleJson(){
    const box = document.getElementById('jsonBox');
    box.style.display = (box.style.display === 'none' || !box.style.display) ? 'block' : 'none';
  }

  async function callApi(){
    const url = document.getElementById('url').value.trim();
    if(!url) throw new Error("Ingresa una URL");

    const req = await fetch("${h(config.route)}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });

    const txt = await req.text();
    try { return JSON.parse(txt); }
    catch { return { status:false, message:"Respuesta no JSON", raw: txt }; }
  }

  function makeLinks(d){
    const base = (d && d.title) ? (String(d.title).slice(0,70).replace(/[^A-Za-z0-9_\\-.]+/g,'_') || 'youtube') : 'youtube';

    const aInline = "${h(config.route)}" + "/dl?type=audio&src=" + encodeURIComponent(d.media.audio || "") + "&filename=" + encodeURIComponent(base + ".mp3");
    const aDown   = aInline + "&download=1";

    return { aInline, aDown };
  }

  async function download(){
    const loader = document.getElementById('loader');
    const resDiv = document.getElementById('result');
    loader.style.display = 'block';
    resDiv.style.display = 'none';

    try{
      const res = await callApi();
      lastJson = res;

      loader.style.display = 'none';
      if(res.status){
        const d = res.result;
        const links = makeLinks(d);

        document.getElementById('vTitle').innerText = (d.title || "YouTube Audio").slice(0, 80);
        document.getElementById('vAuthor').innerText = d.author?.username ? ("@" + d.author.username) : "";

        // ✅ reproductor INLINE
        document.getElementById('player').src = links.aInline;

        // ✅ botón DESCARGA
        document.getElementById('dlAudio').href = links.aDown;

        document.getElementById('jsonOut').textContent = JSON.stringify(res, null, 2);
        document.getElementById('jsonBox').style.display = 'none';

        resDiv.style.display = 'block';
      } else {
        alert(res.message || "Error");
      }
    } catch(e){
      loader.style.display = 'none';
      alert(e?.message || "Error de conexión");
    }
  }

  async function showJson(){
    const loader = document.getElementById('loader');
    const resDiv = document.getElementById('result');
    loader.style.display = 'block';

    try{
      const res = await callApi();
      lastJson = res;

      loader.style.display = 'none';

      document.getElementById('jsonOut').textContent = JSON.stringify(res, null, 2);
      document.getElementById('jsonBox').style.display = 'block';

      if(res.status){
        const d = res.result;
        const links = makeLinks(d);

        document.getElementById('vTitle').innerText = (d.title || "YouTube Audio").slice(0, 80);
        document.getElementById('vAuthor').innerText = d.author?.username ? ("@" + d.author.username) : "";

        document.getElementById('player').src = links.aInline;
        document.getElementById('dlAudio').href = links.aDown;

        resDiv.style.display = 'block';
      } else {
        resDiv.style.display = 'none';
      }
    } catch(e){
      loader.style.display = 'none';
      alert(e?.message || "Error de conexión");
    }
  }
</script>
</body>
</html>`);
});

module.exports = { router, config };
