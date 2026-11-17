import Anthropic from '@anthropic-ai/sdk'
import type { ConversationIntent, LlmAdapter, LlmRequest, LlmResponse } from './adapter.js'

const intentSchema = {
  type: 'object' as const,
  properties: {
    intent: {
      type: 'string',
      enum: ['procesar_buzon', 'alertas', 'confirmar', 'rechazar', 'ayuda'],
      description: 'La intención operativa del mensaje del usuario.'
    }
  },
  required: ['intent'],
  additionalProperties: false
}

/** Adaptación del cliente OpenCode Go usado en ai_agent-supplier-register. */
export class OpenCodeGoAdapter implements LlmAdapter {
  readonly provider = 'opencode-go'
  readonly configured: boolean
  private readonly client: Anthropic

  constructor(readonly model: string, private readonly system: string, apiKey: string, timeout: number) {
    this.configured = Boolean(apiKey)
    this.client = new Anthropic({
      apiKey: null,
      authToken: apiKey,
      baseURL: 'https://opencode.ai/inference/go/anthropic',
      timeout,
      maxRetries: 0,
      defaultHeaders: { 'User-Agent': 'registro-contratos/1.0' }
    })
  }

  async interpretar(request: LlmRequest): Promise<LlmResponse> {
    if (!this.configured) throw new Error('OpenCode Go no está configurado: falta OPENCODE_API_KEY en el backend.')
    const result = await this.client.messages.create({
      model: this.model,
      system: this.system,
      max_tokens: 300,
      messages: [{ role: 'user', content: request.message }],
      tools: [{
        name: 'seleccionar_intencion',
        description: 'Clasifica el mensaje para que el runtime PERXIA ejecute únicamente las herramientas permitidas.',
        input_schema: intentSchema
      }],
      tool_choice: { type: 'tool', name: 'seleccionar_intencion' }
    }, { headers: { 'x-opencode-session': request.sessionId } })
    const toolUse = result.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === 'seleccionar_intencion')
    if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null || !('intent' in toolUse.input)) throw new Error('El proveedor no devolvió una intención estructurada.')
    const intent = toolUse.input.intent as ConversationIntent
    if (!request.allowedIntents.includes(intent)) throw new Error('El proveedor devolvió una intención no permitida.')
    return { intent, source: 'external' }
  }
}
