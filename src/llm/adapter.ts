export type ConversationIntent = 'procesar_buzon' | 'alertas' | 'confirmar' | 'rechazar' | 'ayuda'

export type LlmRequest = {
  sessionId: string
  message: string
  allowedIntents: ConversationIntent[]
}

export type LlmResponse = {
  intent: ConversationIntent
  source: 'deterministic' | 'external'
}

export interface LlmAdapter {
  readonly provider: string
  readonly model: string
  readonly configured: boolean
  interpretar(request: LlmRequest): Promise<LlmResponse>
}
