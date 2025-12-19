let handler = async (m, { conn, args, participants }) => {
  if (!m.isGroup) return
  if (!args[0]) return m.reply('⚠️ Ingresa un número\nEjemplo: .add 5215900665488')

  await m.react('🕓')

  let number = args[0].replace(/\D/g, '')
  if (number.length < 8) {
    await m.react('❌')
    return m.reply('❌ Número inválido')
  }

  let jid = number + '@s.whatsapp.net'

  if (participants.some(p => p.id === jid)) {
    await m.react('⚠️')
    return m.reply('⚠️ Ese número ya está en el grupo')
  }

  try {
    let [exists] = await conn.onWhatsApp(jid)
    if (!exists?.exists) {
      await m.react('❌')
      return m.reply('❌ Ese número NO está registrado en WhatsApp')
    }

    let res = await conn.groupParticipantsUpdate(m.chat, [jid], 'add')
    let status = res[0]?.status

    // agregado correctamente
    if (status === 200) {
      await m.react('✅')
      return m.reply('✅ Usuario agregado correctamente')
    }

    // privacidad activada → enviar invitación
    if (status === 403) {
      let code = await conn.groupInviteCode(m.chat)
      let link = `https://chat.whatsapp.com/${code}`

      await conn.sendMessage(jid, {
        text:
          `👋 Hola\n` +
          `No pude agregarte directamente por tu privacidad.\n` +
          `Aquí está la invitación al grupo:\n\n` +
          `${link}`
      })

      await m.react('📨')
      return m.reply('📨 Privacidad activada, invitación enviada por DM')
    }

    if (status === 409) {
      await m.react('⚠️')
      return m.reply('⚠️ El usuario ya está en el grupo')
    }

    await m.react('❌')
    m.reply(`❌ No se pudo agregar (código ${status})`)

  } catch (e) {
    console.error(e)
    await m.react('❌')
    m.reply('❌ Error inesperado al procesar la solicitud')
  }
}

handler.help = ['add <número>']
handler.tags = ['group']
handler.command = /^add$/i
handler.group = true
handler.admin = true

export default handler