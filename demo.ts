import { alertas, cleanOutput, extraer, leer_buzon, registrar, validar, type Contract } from './src/tools/contratos.js'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const ctx = { directory: process.cwd(), sessionId: 'demo' }

async function run(): Promise<void> {
  await cleanOutput(ctx.directory)
  const inbox = JSON.parse(await leer_buzon.execute({}, ctx)) as Result<{ mensajes: Array<{ id: string; tiene_contrato: boolean }> }>
  if (!inbox.ok) throw new Error(inbox.error)
  for (const message of inbox.data.mensajes) {
    if (!message.tiene_contrato) { console.log(`${message.id} | rechazado | sin contrato | sin acción`); continue }
    const extraction = JSON.parse(await extraer.execute({ mensaje_id: message.id }, ctx)) as Result<Contract>
    if (!extraction.ok) { console.log(`${message.id} | error | ${extraction.error}`); continue }
    const validation = JSON.parse(await validar.execute({ mensaje_id: message.id, contrato: extraction.data }, ctx)) as Result<{ clasificacion: string; requiere_revision: string[] }>
    if (!validation.ok) { console.log(`${message.id} | error | ${validation.error}`); continue }
    if (validation.data.clasificacion === 'duplicado' || validation.data.clasificacion === 'rechazado') { console.log(`${message.id} | ${validation.data.clasificacion} | sin escritura`); continue }
    if (validation.data.requiere_revision.length) {
      console.log(`${message.id} | ${validation.data.clasificacion} | revisión: ${validation.data.requiere_revision.join(', ')} | sin registrar`)
      if (message.id === 'msg-006') {
        const confirmed = JSON.parse(await registrar.execute({ mensaje_id: message.id, contrato: extraction.data, confirmado: true }, ctx)) as Result<{ accion: string }>
        console.log(`${message.id} | confirmación humana | ${confirmed.ok ? confirmed.data.accion : confirmed.error}`)
      }
      continue
    }
    const registration = JSON.parse(await registrar.execute({ mensaje_id: message.id, contrato: extraction.data }, ctx)) as Result<{ accion: string }>
    console.log(`${message.id} | ${validation.data.clasificacion} | ${registration.ok ? registration.data.accion : registration.error}`)
  }
  const report = JSON.parse(await alertas.execute({ hoy: '2026-09-03' }, ctx)) as Result<{ ruta: string }>
  console.log(`alertas | ${report.ok ? report.data.ruta : report.error}`)
}

await run()
