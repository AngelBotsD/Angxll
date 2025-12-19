const axios = require("axios")
const yts = require("yt-search")
const fs = require("fs")
const path = require("path")
const ffmpeg = require("fluent-ffmpeg")
const { promisify } = require("util")
const { pipeline } = require("stream")
const crypto = require("crypto")

const streamPipe = promisify(pipeline)

const TMP_DIR = path.join(process.cwd(), "tmp")
fs.rmSync(TMP_DIR, { recursive: true, force: true })
fs.mkdirSync(TMP_DIR, { recursive: true })

const AUDIO_DIR = path.join(process.cwd(), "Canciones", "audio")
const VIDEO_DIR = path.join(process.cwd(), "Canciones", "video")
fs.mkdirSync(AUDIO_DIR, { recursive: true })
fs.mkdirSync(VIDEO_DIR, { recursive: true })

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "")
const API_KEY = process.env.API_KEY || "Angxllll"

const MAX_CONCURRENT = 3
const MAX_MB = 99
const DOWNLOAD_TIMEOUT = 60000

let active = 0
const queue = []
const tasks = {}
const cache = {}

function saveCache() {
  return true
}

function safeUnlink(f) {
  try { f && fs.existsSync(f) && fs.unlinkSync(f) } catch {}
}

function fileSizeMB(f) {
  try { return fs.statSync(f).size / 1024 / 1024 } catch { return 0 }
}

function readHeader(file, len = 16) {
  try {
    const fd = fs.openSync(file, "r")
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, 0)
    fs.closeSync(fd)
    return buf.toString("hex")
  } catch {
    return ""
  }
}

function validFile(file) {
  if (!file || !fs.existsSync(file)) return false
  const size = fs.statSync(file).size
  if (size < 150000) return false
  const hex = readHeader(file)
  if (file.endsWith(".mp3") && !(hex.startsWith("494433") || hex.startsWith("fff"))) return false
  if (file.endsWith(".mp4") && !hex.includes("66747970")) return false
  return true
}

async function queueDownload(task) {
  if (active >= MAX_CONCURRENT) await new Promise(r => queue.push(r))
  active++
  try {
    return await task()
  } finally {
    active--
    queue.shift()?.()
  }
}

function isApiUrl(url = "") {
  try {
    const u = new URL(url)
    const b = new URL(API_BASE)
    return u.host === b.host
  } catch {
    return false
  }
}

async function callYoutubeResolve(videoUrl, { type }) {
  const endpoint = `${API_BASE}/youtube/resolve`

  const body =
    type === "video"
      ? { url: videoUrl, type: "video", quality: "360" }
      : { url: videoUrl, type: "audio", format: "mp3" }

  const res = await axios.post(endpoint, body, {
    timeout: 120000,
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      Accept: "application/json"
    },
    validateStatus: () => true
  })

  const data = typeof res.data === "object" ? res.data : null
  if (!data) throw "Respuesta inválida"

  const ok = data.status === true || data.success === true || data.ok === true
  if (!ok) throw (data.message || "Error API")

  const result = data.result || data.data || data
  if (!result?.media) throw "Sin media"

  let dl = result.media.dl_download || result.media.direct || ""
  if (dl.startsWith("/")) dl = API_BASE + dl

  return dl || null
}

async function downloadStream(url, file) {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    Accept: "*/*"
  }

  if (isApiUrl(url)) headers.apikey = API_KEY

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: DOWNLOAD_TIMEOUT,
    maxRedirects: 5,
    headers,
    validateStatus: () => true
  })

  if (res.status >= 400) throw `HTTP ${res.status}`

  await streamPipe(res.data, fs.createWriteStream(file))
  return file
}

async function toMp3(input) {
  if (input.endsWith(".mp3")) return input
  const out = input.replace(/\.\w+$/, ".mp3")
  await new Promise((res, rej) =>
    ffmpeg(input)
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .save(out)
      .on("end", res)
      .on("error", rej)
  )
  safeUnlink(input)
  return out
}

function moveToStore(file, title, type) {
  const safe = title.replace(/[^\w\s\-().]/gi, "").slice(0, 80)
  const dir = type === "audio" ? AUDIO_DIR : VIDEO_DIR
  const ext = type === "audio" ? "mp3" : "mp4"
  const dest = path.join(dir, `${safe}.${ext}`)
  if (fs.existsSync(dest)) {
    safeUnlink(file)
    return dest
  }
  fs.renameSync(file, dest)
  return dest
}

async function startDownload(id, key, mediaUrl) {
  if (tasks[id]?.[key]) return tasks[id][key]

  tasks[id] = tasks[id] || {}

  const ext = key === "audio" ? "mp3" : "mp4"
  const file = path.join(TMP_DIR, `${crypto.randomUUID()}.${ext}`)

  tasks[id][key] = queueDownload(async () => {
    await downloadStream(mediaUrl, file)
    const final = key === "audio" ? await toMp3(file) : file

    if (!validFile(final)) {
      safeUnlink(final)
      throw "Archivo inválido"
    }

    if (fileSizeMB(final) > MAX_MB) throw "Archivo muy grande"

    return final
  })

  return tasks[id][key]
}

async function sendFile(conn, job, file, isDoc, type, quoted) {
  if (!validFile(file)) {
    await conn.sendMessage(job.chatId, { text: "❌ Archivo inválido." }, { quoted })
    return
  }

  const buffer = fs.readFileSync(file)
  const msg = {}

  if (isDoc) msg.document = buffer
  else if (type === "audio") msg.audio = buffer
  else msg.video = buffer

  await conn.sendMessage(
    job.chatId,
    {
      ...msg,
      mimetype: type === "audio" ? "audio/mpeg" : "video/mp4",
      fileName: `${job.title}.${type === "audio" ? "mp3" : "mp4"}`
    },
    { quoted }
  )
}

const pending = {}

function addPending(id, data) {
  pending[id] = data
  setTimeout(() => delete pending[id], 15 * 60 * 1000)
}

async function handler(msg, { conn, text }) {
  const pref = global.prefixes?.[0] || "."

  if (!text?.trim()) {
    return conn.sendMessage(
      msg.chat,
      { text: `✳️ Usa:\n${pref}play <término>\nEj: ${pref}play bad bunny` },
      { quoted: msg }
    )
  }

  await conn.sendMessage(msg.chat, { react: { text: "🕒", key: msg.key } })

  const res = await yts(text)
  const video = res.videos?.[0]
  if (!video) {
    return conn.sendMessage(msg.chat, { text: "❌ Sin resultados." }, { quoted: msg })
  }

  const { url, title, timestamp, views, author, thumbnail } = video

  const caption = `
┏━[ *Angel Bot Music 🎧* ]━┓
┃🎵 Título: ${title}
┃⏱️ Duración: ${timestamp}
┃👁️ Vistas: ${(views || 0).toLocaleString()}
┃👤 Autor: ${author?.name || author}
┗━━━━━━━━━━━━━━━━━━┛

📥 Reacciona:
👍 Audio MP3
❤️ Video MP4
📄 Audio Documento
📁 Video Documento
`.trim()

  const preview = await conn.sendMessage(
    msg.chat,
    { image: { url: thumbnail }, caption },
    { quoted: msg }
  )

  addPending(preview.key.id, {
    chatId: msg.chat,
    videoUrl: url,
    title,
    commandMsg: msg,
    sender: msg.participant || msg.key.participant
  })

  await conn.sendMessage(msg.chat, { react: { text: "✅", key: msg.key } })

  if (conn._playListener) return
  conn._playListener = true

  conn.ev.on("messages.upsert", async ev => {
    for (const m of ev.messages || []) {
      const react = m.message?.reactionMessage
      const ctx = m.message?.extendedTextMessage?.contextInfo
      const stanza = react?.key?.id || ctx?.stanzaId
      const job = pending[stanza]
      if (!job) continue

      const sender = m.key.participant || m.participant
      if (sender !== job.sender) continue

      let choice = react?.text
      if (!choice && ctx) {
        const txt = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim()
        if (["1", "audio"].includes(txt)) choice = "👍"
        else if (["2", "video"].includes(txt)) choice = "❤️"
        else if (["3", "videodoc"].includes(txt)) choice = "📁"
        else if (["4", "audiodoc"].includes(txt)) choice = "📄"
      }

      if (!["👍", "❤️", "📄", "📁"].includes(choice)) continue

      const map = {
        "👍": ["audio", false],
        "📄": ["audio", true],
        "❤️": ["video", false],
        "📁": ["video", true]
      }

      const [type, isDoc] = map[choice]

      const cached = cache[job.videoUrl]?.files?.[type]
      if (cached && fs.existsSync(cached) && validFile(cached)) {
        await conn.sendMessage(
          job.chatId,
          { text: `⚡ Enviando desde tmp: ${type}` },
          { quoted: job.commandMsg }
        )
        await sendFile(conn, job, cached, isDoc, type, job.commandMsg)
        continue
      }

      await conn.sendMessage(
        job.chatId,
        { text: `⏳ Descargando ${type}...` },
        { quoted: job.commandMsg }
      )

      try {
        const mediaUrl = await callYoutubeResolve(job.videoUrl, { type })
        let file = await startDownload(job.videoUrl, type, mediaUrl)
        file = moveToStore(file, job.title, type)

        cache[job.videoUrl] = cache[job.videoUrl] || { timestamp: Date.now(), files: {} }
        cache[job.videoUrl].files[type] = file

        saveCache()
        await sendFile(conn, job, file, isDoc, type, job.commandMsg)
      } catch (e) {
        await conn.sendMessage(job.chatId, { text: `❌ Error: ${e}` }, { quoted: job.commandMsg })
      }
    }
  })
}

handler.help = ["play <texto>"]
handler.tags = ["descargas"]
handler.command = ["play"]
module.exports = handler