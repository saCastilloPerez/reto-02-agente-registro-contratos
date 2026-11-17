import { z } from 'zod'
import type { LlmAdapter } from '../llm/adapter.js'
import { contratosTools, type Contract, type ToolContext } from '../tools/contratos.js'

export type VisibleToolCall = { name: string; arguments: unknown; result: unknown }
export type HistoryItem = { role: 'user' | 'assistant' | 'tool'; content: string; toolCall?: VisibleToolCall; needsConfirmation?: boolean }
export type ChatResponse = { reply: string; toolCalls: VisibleToolCall[]; needsConfirmation: boolean }
type Pending = { mensajeId: string; contrato: Contract; requestedAlerts: boolean; requestedDate: string }
type Session = { history: HistoryItem[]; pending?: Pending; busy: boolean }

export class AgentRuntime {
  private readonly sessions = new Map<string, Session>()
  constructor(private readonly directory: string, private readonly adapter: LlmAdapter, private readonly maxIterations = 25) {}
  history(id: string): HistoryItem[] { return this.sessions.get(id)?.history ?? [] }
  private session(id: string): Session { const existing = this.sessions.get(id); if (existing) return existing; const next = { history: [], busy: false }; this.sessions.set(id, next); return next }
  private context(sessionId: string): ToolContext { return { directory: this.directory, sessionId } }
  private confirmedContract(contract: Contract, message: string): Contract {
    const fechaFin = message.match(/fecha\s*(?:de\s*)?fin\s*(?:es|=|:)?\s*(\d{4}-\d{2}-\d{2})/i)?.[1]
    const valor = message.match(/valor\s*(?:es|=|:)?\s*([\d.,]+)/i)?.[1]
    const moneda = message.match(/\b(COP|USD|PEN|PAB|HNL)\b/i)?.[1] as Contract['moneda'] | undefined
    const parsedValue = valor ? Number(valor.replace(/[,.]/g, '')) : undefined
    const confianza = { ...contract.confianza }
    if (fechaFin) confianza.fecha_fin = 1
    if (parsedValue !== undefined && Number.isFinite(parsedValue)) confianza.valor = 1
    if (moneda) confianza.moneda = 1
    return {
      ...contract,
      fecha_fin: fechaFin ?? contract.fecha_fin,
      valor: parsedValue !== undefined && Number.isFinite(parsedValue) ? parsedValue : contract.valor,
      moneda: moneda ?? contract.moneda,
      confianza
    }
  }
  private async call(session: Session, sessionId: string, name: keyof typeof contratosTools, args: never, calls: VisibleToolCall[]): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const raw = await contratosTools[name].execute(args, this.context(sessionId))
    const result = JSON.parse(raw) as { ok: boolean; data?: unknown; error?: string }
    const call = { name: `contratos_${name}`, arguments: args, result }
    calls.push(call)
    session.history.push({ role: 'tool', content: raw, toolCall: call })
    return result
  }
  async chat(sessionId: string, message: string): Promise<ChatResponse> {
    const session = this.session(sessionId)
    if (session.busy) return { reply: 'La sesión ya está procesando otro mensaje.', toolCalls: [], needsConfirmation: false }
    session.busy = true
    session.history.push({ role: 'user', content: message })
    const calls: VisibleToolCall[] = []
    try {
      if (session.pending && /^(si|sí|confirmo|confirmar|autorizo|adelante)/i.test(message.trim())) {
        const pending = session.pending
        const confirmed = this.confirmedContract(pending.contrato, message)
        const registered = await this.call(session, sessionId, 'registrar', { mensaje_id: pending.mensajeId, contrato: confirmed, confirmado: true } as never, calls)
        session.pending = undefined
        const lines = [registered.ok ? `Confirmación aplicada: ${pending.mensajeId} quedó registrado como ${(registered.data as { accion: string }).accion}.` : `No fue posible registrar: ${registered.error}`]
        if (pending.requestedAlerts && registered.ok) {
          const alerts = await this.call(session, sessionId, 'alertas', { hoy: pending.requestedDate } as never, calls)
          lines.push(alerts.ok ? `Alertas: reporte generado en ${(alerts.data as { ruta: string }).ruta}.` : `Alertas: no fue posible generar el reporte — ${alerts.error}`)
        }
        const reply = lines.join('\n')
        session.history.push({ role: 'assistant', content: reply })
        return { reply, toolCalls: calls, needsConfirmation: false }
      }
      if (session.pending && /^(no|rechazo|cancelar)/i.test(message.trim())) { const id = session.pending.mensajeId; session.pending = undefined; const reply = `No se registró ${id}. Permanece pendiente de revisión.`; session.history.push({ role: 'assistant', content: reply }); return { reply, toolCalls: calls, needsConfirmation: false } }
      const interpretation = await this.adapter.interpretar({
        sessionId,
        message,
        allowedIntents: ['procesar_buzon', 'alertas', 'confirmar', 'rechazar', 'ayuda']
      })
      const explicitlyRequestsInbox = /buz[oó]n|procesa(?:r)?\s+(?:el\s+)?(?:buz[oó]n|contrato)/i.test(message)
      if (interpretation.intent === 'alertas' && !explicitlyRequestsInbox) {
        const date = message.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '2026-09-03'
        const result = await this.call(session, sessionId, 'alertas', { hoy: date } as never, calls)
        const reply = result.ok ? `Reporte generado en ${(result.data as { ruta: string }).ruta}.` : `No fue posible generar alertas: ${result.error}`
        session.history.push({ role: 'assistant', content: reply }); return { reply, toolCalls: calls, needsConfirmation: false }
      }
      if (interpretation.intent !== 'procesar_buzon' && !explicitlyRequestsInbox) {
        const reply = 'Puedo procesar el buzón, mostrar contratos en revisión o generar alertas. Indica “procesa el buzón”.'
        session.history.push({ role: 'assistant', content: reply }); return { reply, toolCalls: calls, needsConfirmation: false }
      }
      const requestedAlerts = /alerta|reporte|vencimiento/i.test(message)
      const requestedDate = message.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '2026-09-03'
      const inbox = await this.call(session, sessionId, 'leer_buzon', {} as never, calls)
      if (!inbox.ok) throw new Error(inbox.error)
      const messages = (inbox.data as { mensajes: Array<{ id: string; tiene_contrato: boolean }> }).mensajes
      const lines: string[] = []
      for (const item of messages.slice(0, this.maxIterations)) {
        if (!item.tiene_contrato) { lines.push(`${item.id}: rechazado — no contiene contrato.`); continue }
        const extracted = await this.call(session, sessionId, 'extraer', { mensaje_id: item.id } as never, calls)
        if (!extracted.ok) { lines.push(`${item.id}: error de extracción — ${extracted.error}`); continue }
        const contract = extracted.data as Contract
        const validated = await this.call(session, sessionId, 'validar', { mensaje_id: item.id, contrato: contract } as never, calls)
        if (!validated.ok) { lines.push(`${item.id}: error de validación — ${validated.error}`); continue }
        const verdict = validated.data as { clasificacion: string; requiere_revision: string[] }
        if (verdict.clasificacion === 'rechazado' || verdict.clasificacion === 'duplicado') { lines.push(`${item.id}: ${verdict.clasificacion}.`); continue }
        if (verdict.requiere_revision.length) { session.pending = { mensajeId: item.id, contrato: contract, requestedAlerts, requestedDate }; lines.push(`${item.id}: ${verdict.clasificacion}, requiere revisión de ${verdict.requiere_revision.join(', ')}.`); break }
        const registered = await this.call(session, sessionId, 'registrar', { mensaje_id: item.id, contrato: contract } as never, calls)
        lines.push(`${item.id}: ${verdict.clasificacion}, ${registered.ok ? 'registrado.' : registered.error}`)
      }
      if (requestedAlerts && !session.pending) {
        const alerts = await this.call(session, sessionId, 'alertas', { hoy: requestedDate } as never, calls)
        lines.push(alerts.ok ? `Alertas: reporte generado en ${(alerts.data as { ruta: string }).ruta}.` : `Alertas: no fue posible generar el reporte — ${alerts.error}`)
      }
      const reply = `${lines.join('\n')}\n${session.pending ? `\n¿Confirmas registrar ${session.pending.mensajeId} con los campos revisados?` : ''}`
      session.history.push({ role: 'assistant', content: reply, needsConfirmation: Boolean(session.pending) })
      return { reply, toolCalls: calls, needsConfirmation: Boolean(session.pending) }
    } catch (error) { const reply = `No fue posible completar la solicitud: ${error instanceof Error ? error.message : 'error inesperado'}`; session.history.push({ role: 'assistant', content: reply }); return { reply, toolCalls: calls, needsConfirmation: false } } finally { session.busy = false }
  }
}

export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
