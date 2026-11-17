import type { LlmAdapter, LlmRequest, LlmResponse } from './adapter.js'

/**
 * Punto de extensión para un proveedor externo. No hace llamadas de red hasta
 * que se implemente el cliente elegido; así la demo conserva costo cero.
 */
export class ExternalLlmAdapter implements LlmAdapter {
  readonly configured: boolean

  constructor(readonly provider: string, readonly model: string, private readonly apiKey: string) {
    this.configured = Boolean(apiKey)
  }

  async interpretar(request: LlmRequest): Promise<LlmResponse> {
    void request
    if (!this.configured) throw new Error(`El proveedor ${this.provider} no está configurado: falta LLM_API_KEY.`)
    throw new Error(`El adaptador externo ${this.provider} está declarado pero no está habilitado en esta entrega. Use LLM_PROVIDER=perxia para la demo determinista.`)
  }
}
