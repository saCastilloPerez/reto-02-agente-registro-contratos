import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { AgentRuntime, sessionIdSchema } from './agent/runtime.js'
import { createLlmAdapter } from './llm/factory.js'

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 3000)
const adapter = createLlmAdapter(process.env, path.join(directory, 'agent', 'prompt.md'))
const runtime = new AgentRuntime(directory, adapter, Number(process.env.MAX_ITERATIONS ?? 25))
const app = express()
const requestSchema = z.object({ sessionId: sessionIdSchema, message: z.string().min(1).max(4000) })

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))
app.use(express.static(path.join(directory, 'web')))
app.get('/api/health', (_request, response) => response.json({ ok: true, provider: adapter.provider, model: adapter.model, configured: adapter.configured }))
app.get('/api/sessions/:id', (request, response) => response.json({ sessionId: request.params.id, history: runtime.history(request.params.id) }))
app.post('/api/chat', async (request, response) => {
  const parsed = requestSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Solicitud inválida.' })
  return response.json(await runtime.chat(parsed.data.sessionId, parsed.data.message))
})
app.use('/api', (_request, response) => response.status(404).json({ error: 'Ruta no encontrada.' }))
app.listen(port, () => console.log(`Agente de contratos disponible en http://localhost:${port}`))
