import type { ConversationIntent, LlmAdapter, LlmRequest, LlmResponse } from './adapter.js'

function classify(message: string): ConversationIntent {
  const normalized = message.trim().toLocaleLowerCase('es-CO')
  if (/^(si|sí|confirmo|confirmar|autorizo|adelante)/.test(normalized)) return 'confirmar'
  if (/^(no|rechazo|cancelar)/.test(normalized)) return 'rechazar'
  if (/alerta|vencimiento|reporte/.test(normalized)) return 'alertas'
  if (/buz[oó]n|procesa|contrato/.test(normalized)) return 'procesar_buzon'
  return 'ayuda'
}

export class DeterministicPerxiaAdapter implements LlmAdapter {
  readonly provider = 'PERXIA determinista'
  readonly model = 'reglas locales v1'
  readonly configured = true

  async interpretar(request: LlmRequest): Promise<LlmResponse> {
    const intent = classify(request.message)
    return { intent: request.allowedIntents.includes(intent) ? intent : 'ayuda', source: 'deterministic' }
  }
}
