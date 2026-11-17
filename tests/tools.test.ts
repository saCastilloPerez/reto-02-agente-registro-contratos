import test from 'node:test'
import assert from 'node:assert/strict'
import { DeterministicPerxiaAdapter } from '../src/llm/deterministic-perxia.js'
import { cleanOutput, extraer, registrar, validar } from '../src/tools/contratos.js'

const ctx = { directory: process.cwd(), sessionId: 'test' }

test('adaptador PERXIA determina intención sin credenciales', async () => {
  const answer = await new DeterministicPerxiaAdapter().interpretar({ sessionId: 'test', message: 'Procesa el buzón de contratos', allowedIntents: ['procesar_buzon', 'alertas', 'confirmar', 'rechazar', 'ayuda'] })
  assert.deepEqual(answer, { intent: 'procesar_buzon', source: 'deterministic' })
})

test('msg-004 se clasifica como duplicado', async () => {
  await cleanOutput(ctx.directory)
  const extracted = JSON.parse(await extraer.execute({ mensaje_id: 'msg-004' }, ctx))
  const result = JSON.parse(await validar.execute({ mensaje_id: 'msg-004', contrato: extracted.data }, ctx))
  assert.equal(result.data.clasificacion, 'duplicado')
})

test('msg-006 exige confirmación antes de registro', async () => {
  await cleanOutput(ctx.directory)
  const extracted = JSON.parse(await extraer.execute({ mensaje_id: 'msg-006' }, ctx))
  const before = JSON.parse(await registrar.execute({ mensaje_id: 'msg-006', contrato: extracted.data }, ctx))
  assert.equal(before.ok, false)
  const after = JSON.parse(await registrar.execute({ mensaje_id: 'msg-006', contrato: extracted.data, confirmado: true }, ctx))
  assert.equal(after.ok, true)
})
