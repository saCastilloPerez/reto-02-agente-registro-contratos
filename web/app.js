const chat = document.querySelector('#chat')
const form = document.querySelector('#form')
const input = document.querySelector('#message')
const status = document.querySelector('#status')
const sessionId = crypto.randomUUID()

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]))
}

function summarizeTool(call) {
  const result = call.result ?? {}
  if (!result.ok) return result.error ?? 'La herramienta devolvió un error.'
  const data = result.data ?? {}
  if (call.name === 'contratos_leer_buzon') return `${data.mensajes?.length ?? 0} mensajes pendientes.`
  if (call.name === 'contratos_extraer') return `${data.id_contrato ?? 'Contrato'} · confianza disponible por campo.`
  if (call.name === 'contratos_validar') return `${data.clasificacion ?? 'Sin clasificación'}${data.requiere_revision?.length ? ` · revisión: ${data.requiere_revision.join(', ')}` : ''}`
  if (call.name === 'contratos_registrar') return `${data.accion ?? 'Procesado'} · ${data.id_contrato ?? 'sin identificador'}`
  if (call.name === 'contratos_alertas') return `Reporte: ${data.ruta ?? 'generado'}`
  return 'Ejecución completada.'
}

function add(role, text, confirmation = false) {
  const item = document.createElement('article')
  item.className = `${role}${confirmation ? ' confirmation' : ''}`
  item.innerHTML = `<strong>${role === 'user' ? 'Tú' : role === 'tool' ? 'Herramienta' : 'PERXIA'}</strong><pre>${escapeHtml(text)}</pre>`
  chat.append(item)
  chat.scrollTop = chat.scrollHeight
}

function addTool(call) {
  const item = document.createElement('article')
  item.className = `tool${call.result?.ok ? '' : ' error'}`
  item.innerHTML = `<strong>${escapeHtml(call.name)}</strong><p>${escapeHtml(summarizeTool(call))}</p><details><summary>Ver argumentos y resultado</summary><pre>${escapeHtml(JSON.stringify({ argumentos: call.arguments, resultado: call.result }, null, 2))}</pre></details>`
  chat.append(item)
  chat.scrollTop = chat.scrollHeight
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const message = input.value.trim()
  if (!message) return
  add('user', message)
  input.value = ''
  status.textContent = 'Pensando…'
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, message }) })
    const data = await response.json()
    for (const call of data.toolCalls ?? []) addTool(call)
    add('assistant', data.reply, data.needsConfirmation)
  } catch { add('assistant', 'No fue posible contactar el backend.') } finally { status.textContent = 'Listo' }
})

add('assistant', 'Hola. Puedo procesar el buzón de contratos, pedir confirmación de campos dudosos y generar alertas.')
