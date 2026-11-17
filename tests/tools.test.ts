import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { AgentRuntime } from '../src/agent/runtime.js'
import { DeterministicPerxiaAdapter } from '../src/llm/deterministic-perxia.js'
import { cleanOutput, extraer, registrar, validar } from '../src/tools/contratos.js'

const ctx = { directory: process.cwd(), sessionId: 'test' }

test('adaptador PERXIA determina intención sin credenciales', async () => {
  const answer = await new DeterministicPerxiaAdapter().interpretar({ sessionId: 'test', message: 'Procesa el buzón de contratos', allowedIntents: ['procesar_buzon', 'alertas', 'confirmar', 'rechazar', 'ayuda'] })
  assert.deepEqual(answer, { intent: 'procesar_buzon', source: 'deterministic' })
})

test('extrae USD y PEN sin convertir los decimales en millones', async () => {
  await cleanOutput(ctx.directory)
  const usd = JSON.parse(await extraer.execute({ mensaje_id: 'msg-002' }, ctx))
  const pen = JSON.parse(await extraer.execute({ mensaje_id: 'msg-003' }, ctx))
  assert.equal(usd.data.valor, 120000)
  assert.equal(pen.data.valor, 520000)
})

test('msg-004 se clasifica como duplicado', async () => {
  await cleanOutput(ctx.directory)
  const extracted = JSON.parse(await extraer.execute({ mensaje_id: 'msg-004' }, ctx))
  const result = JSON.parse(await validar.execute({ mensaje_id: 'msg-004', contrato: extracted.data }, ctx))
  assert.equal(result.data.clasificacion, 'duplicado')
})

test('la confirmación conserva la fecha final explícita de msg-006', async () => {
  await cleanOutput(ctx.directory)
  const runtime = new AgentRuntime(ctx.directory, new DeterministicPerxiaAdapter())
  await runtime.chat('confirmacion-explicita', 'Procesa el buzón de contratos y termina con el reporte de alertas.')
  const confirmation = await runtime.chat('confirmacion-explicita', 'Confirmo el valor 0 y la fecha fin 2027-08-31 para msg-006.')
  assert.equal(confirmation.needsConfirmation, false)
  const master = await readFile(path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv'), 'utf8')
  const row = master.split(/\r?\n/).find((line) => line.startsWith('CM-2026-03,'))
  assert.match(row ?? '', /,2027-08-31,true,/)
})

test('msg-006 exige confirmación antes de registro', async () => {
  await cleanOutput(ctx.directory)
  const extracted = JSON.parse(await extraer.execute({ mensaje_id: 'msg-006' }, ctx))
  const before = JSON.parse(await registrar.execute({ mensaje_id: 'msg-006', contrato: extracted.data }, ctx))
  assert.equal(before.ok, false)
  const after = JSON.parse(await registrar.execute({ mensaje_id: 'msg-006', contrato: extracted.data, confirmado: true }, ctx))
  assert.equal(after.ok, true)
})
