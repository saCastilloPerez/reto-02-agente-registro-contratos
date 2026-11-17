import 'dotenv/config'
import path from 'node:path'
import { AgentRuntime } from '../src/agent/runtime.js'
import { createLlmAdapter } from '../src/llm/factory.js'
import { cleanOutput } from '../src/tools/contratos.js'

const directory = process.cwd()
const adapter = createLlmAdapter(process.env, path.join(directory, 'agent', 'prompt.md'))
const runtime = new AgentRuntime(directory, adapter, Number(process.env.MAX_ITERATIONS ?? 20))

await cleanOutput(directory)
const first = await runtime.chat('opencode-e2e', 'Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.')
console.log(JSON.stringify({ phase: 'first-turn', provider: adapter.provider, configured: adapter.configured, reply: first.reply, needsConfirmation: first.needsConfirmation, toolCalls: first.toolCalls.map((call) => call.name) }, null, 2))
if (!first.needsConfirmation) throw new Error('El primer turno no solicitó la confirmación humana esperada.')
const second = await runtime.chat('opencode-e2e', 'Confirmo el valor 0 y la fecha fin 2027-08-31 para msg-006.')
console.log(JSON.stringify({ phase: 'confirmation', reply: second.reply, needsConfirmation: second.needsConfirmation, toolCalls: second.toolCalls.map((call) => call.name) }, null, 2))
if (!second.toolCalls.some((call) => call.name === 'contratos_alertas')) throw new Error('La confirmación no generó el reporte de alertas solicitado en el primer turno.')
if (!second.reply.includes('Confirmación aplicada')) throw new Error('La confirmación humana no concluyó el registro de msg-006.')
