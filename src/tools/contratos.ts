import { appendFile, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export type ToolContext = { directory: string; sessionId: string }
type Result<T> = { ok: true; data: T } | { ok: false; error: string }
type Tool<T> = { description: string; args: Record<string, z.ZodType>; execute(args: T, ctx: ToolContext): Promise<string> }
type Email = { id: string; de: string; para: string; asunto: string; fecha: string; cuerpo: string; adjuntos: string[] }
type Commercial = { email: string; nombre: string; region: string }
export type Contract = {
  id_contrato: string | null; cliente: string | null; nit_cliente: string | null; pais: 'CO' | 'EC' | 'PE' | 'PA' | 'HN' | null; objeto: string | null; valor: number | null; valor_indeterminado: boolean; moneda: 'COP' | 'USD' | 'PEN' | 'PAB' | 'HNL' | null; fecha_inicio: string | null; fecha_fin: string | null; requiere_poliza: boolean; tipo_poliza: string; estado_poliza: 'vigente' | 'pendiente' | 'vencida' | 'no_aplica'; comercial: string | null; ruta_sharepoint: string | null; fecha_registro: string | null; fuente: 'buzon'; confianza: Record<string, number>; es_otrosi: boolean
}
type CsvRow = Record<string, string>

const fixtureRoot = (ctx: ToolContext) => path.join(ctx.directory, 'fixtures', 'reto-02')
const outRoot = (ctx: ToolContext) => path.join(ctx.directory, 'out')
const messageId = z.string().regex(/^msg-\d{3}$/).describe('Identificador del mensaje del buzón.')
const contractSchema = z.object({
  id_contrato: z.string().nullable(), cliente: z.string().nullable(), nit_cliente: z.string().nullable(), pais: z.enum(['CO', 'EC', 'PE', 'PA', 'HN']).nullable(), objeto: z.string().nullable(), valor: z.number().nullable(), valor_indeterminado: z.boolean(), moneda: z.enum(['COP', 'USD', 'PEN', 'PAB', 'HNL']).nullable(), fecha_inicio: z.string().nullable(), fecha_fin: z.string().nullable(), requiere_poliza: z.boolean(), tipo_poliza: z.string(), estado_poliza: z.enum(['vigente', 'pendiente', 'vencida', 'no_aplica']), comercial: z.string().nullable(), ruta_sharepoint: z.string().nullable(), fecha_registro: z.string().nullable(), fuente: z.literal('buzon'), confianza: z.record(z.string(), z.number()), es_otrosi: z.boolean()
})

const json = <T>(result: Result<T>) => JSON.stringify(result)
const clean = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const slug = (value: string) => clean(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const pad = (value: number) => String(value).padStart(2, '0')
const monthIndex: Record<string, number> = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 }
const words: Record<string, number> = { primero: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30, 'treinta y uno': 31 }

async function ensureOut(ctx: ToolContext): Promise<void> { await mkdir(path.join(outRoot(ctx), 'sharepoint'), { recursive: true }) }
async function appendLog(ctx: ToolContext, herramienta: string, mensajeId: string | undefined, ok: boolean, resumen: string): Promise<void> {
  await ensureOut(ctx)
  await appendFile(path.join(outRoot(ctx), 'log.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), herramienta, mensaje_id: mensajeId, ok, resumen })}\n`)
}
async function guarded<T>(ctx: ToolContext, herramienta: string, id: string | undefined, action: () => Promise<T>): Promise<string> {
  try { const data = await action(); await appendLog(ctx, herramienta, id, true, 'Ejecución completada'); return json({ ok: true, data }) } catch (error) { const message = error instanceof Error ? error.message : 'Error inesperado.'; await appendLog(ctx, herramienta, id, false, message).catch(() => undefined); return json({ ok: false, error: message }) }
}
async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T }
async function readEmail(ctx: ToolContext, id: string): Promise<Email> { return readJson(path.join(fixtureRoot(ctx), 'buzon', id, 'correo.json')) }
async function processed(ctx: ToolContext): Promise<string[]> { try { return await readJson(path.join(outRoot(ctx), 'procesados.json')) } catch { return [] } }
async function writeProcessed(ctx: ToolContext, ids: string[]): Promise<void> { await writeFile(path.join(outRoot(ctx), 'procesados.json'), JSON.stringify([...new Set(ids)].sort(), null, 2)) }
function csvLine(line: string): string[] {
  const values: string[] = []; let value = ''; let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index++; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (char === ',' && !quoted) { values.push(value); value = ''; continue }
    value += char
  }
  values.push(value)
  return values
}
function csvEscape(value: unknown): string { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }
function csvParse(content: string): CsvRow[] { const [header, ...lines] = content.trim().split(/\r?\n/); const keys = csvLine(header); return lines.map((line) => Object.fromEntries(keys.map((key, index) => [key, csvLine(line)[index] ?? '']))) }
function csvEncode(rows: CsvRow[]): string { const keys = ['id_contrato', 'cliente', 'nit_cliente', 'pais', 'objeto', 'valor', 'moneda', 'fecha_inicio', 'fecha_fin', 'requiere_poliza', 'tipo_poliza', 'estado_poliza', 'comercial', 'ruta_sharepoint', 'fecha_registro', 'fuente']; return `${keys.join(',')}\n${rows.map((row) => keys.map((key) => csvEscape(row[key])).join(',')).join('\n')}\n` }
async function master(ctx: ToolContext): Promise<CsvRow[]> { await ensureOut(ctx); const destination = path.join(outRoot(ctx), 'sharepoint', 'maestro-contratos.csv'); try { return csvParse(await readFile(destination, 'utf8')) } catch { await copyFile(path.join(fixtureRoot(ctx), 'maestro-contratos.csv'), destination); return csvParse(await readFile(destination, 'utf8')) } }
async function saveMaster(ctx: ToolContext, rows: CsvRow[]): Promise<void> { await writeFile(path.join(outRoot(ctx), 'sharepoint', 'maestro-contratos.csv'), csvEncode(rows)) }
function parseSpanishDate(fragment: string): string | null { const direct = fragment.match(/(\d{1,2})\)\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i) ?? fragment.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i); if (!direct) return null; const day = Number(direct[1]); const month = monthIndex[clean(direct[2])]; return month === undefined ? null : `${direct[3]}-${pad(month + 1)}-${pad(day)}` }
function country(text: string): Contract['pais'] { if (/ecuador|\bRUC\s+17/i.test(text)) return 'EC'; if (/per[uú]|\bRUC\s+20/i.test(text)) return 'PE'; if (/panam[aá]|\bRUC\s+1556/i.test(text)) return 'PA'; if (/honduras|\bRTN/i.test(text)) return 'HN'; return 'CO' }
function numberFromWords(value: string): number | null { const compact = clean(value).replace(/\s+/g, ' ').trim(); return words[compact] ?? null }
function derivedDate(start: string | null, months: number | null): string | null { if (!start || !months) return null; const date = new Date(`${start}T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + months); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10) }
function confidence(value: unknown, score = 1): number { return value === null || value === '' ? 0 : score }
function parseContractValue(rawValue: string, currency: string): number | null {
  const compact = rawValue.replace(/\s/g, '')
  if (!compact) return null
  if (currency === 'COP') return Number(compact.replace(/[,.]/g, ''))
  const normalized = compact.replace(/,/g, '')
  const value = Number(normalized)
  return Number.isFinite(value) ? Math.trunc(value) : null
}

function extract(text: string, email: Email, commercial: Commercial | undefined): Contract {
  const isAddendum = /OTROS[IÍ]/i.test(text)
  const id = text.match(/(?:CONTRATO(?:\s+MARCO)?(?:\s+DE[^\n]*)?|OTROS[IÍ][^\n]*?)(?:\s+No\.?)?\s*([A-Z]{2,4}-\d{4}-\d+(?:-\d+)?)/i)?.[1] ?? null
  const customer = text.match(/(?:Entre(?:\s+los\s+suscritos)?,?\s+|Entre\s+)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]+?(?:S\.A\.S\.|S\.A\.|S\.A\.C\.|S\. de R\.L\.|R[.]?L[.]?|del Valle del Río)),/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null
  const tax = text.match(/(?:NIT|RUC|RTN)\s+([\d.-]+)/i)?.[1]?.replace(/\D/g, '') ?? null
  const object = text.match(/PRIMERA\.\s*OBJETO\.\s*([\s\S]*?)(?=\n\s*(?:SEGUNDA|TERCERA)\.)/i)?.[1].replace(/\s+/g, ' ').trim() ?? null
  const demand = /no tiene un valor determinado|por demanda/i.test(text)
  const currency = text.match(/\b(COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d,.]+)/i)
  const rawValue = currency?.[2] ?? ''
  const value = demand ? 0 : currency ? parseContractValue(rawValue, currency[1].toUpperCase()) : null
  const startPhrase = text.match(/desde\s+(?:el\s+)?([^\n]+?de\s+[a-záéíóú]+\s+de\s+\d{4})/i)?.[1]
  const endPhrase = text.match(/hasta\s+(?:el\s+)?([^\n."]+?de\s+[a-záéíóú]+\s+de\s+\d{4})/i)?.[1]
  const parsedStart = startPhrase ? parseSpanishDate(startPhrase) : null
  const start = parsedStart ?? (demand ? email.fecha.slice(0, 10) : null)
  let end = endPhrase ? parseSpanishDate(endPhrase) : null
  const term = text.match(/(?:plazo|duración)[\s\S]{0,100}?de\s+([a-záéíóú]+|\d+)\s*\([^)]*\)?\s*meses/i)?.[1]
  const months = term ? (/^\d+$/.test(term) ? Number(term) : numberFromWords(term)) : null
  if (!end && !isAddendum) end = derivedDate(start, months)
  const needsPolicy = /p[oó]liza|garant[ií]as/i.test(text)
  const policyType = needsPolicy ? ['cumplimiento', /responsabilidad civil/i.test(text) ? 'responsabilidad_civil' : '', /calidad/i.test(text) ? 'calidad' : ''].filter(Boolean).join(';') : ''
  const confidenceMap: Record<string, number> = { id_contrato: confidence(id), cliente: confidence(customer), nit_cliente: confidence(tax), pais: 1, objeto: confidence(object), valor: demand ? 0.65 : confidence(value), moneda: demand ? 0.65 : confidence(currency?.[1] ?? null), fecha_inicio: demand && !parsedStart ? 0.65 : confidence(start), fecha_fin: endPhrase ? confidence(end) : 0.65, requiere_poliza: 1, comercial: commercial ? 1 : 0.6 }
  return { id_contrato: id, cliente: customer, nit_cliente: tax, pais: country(text), objeto: object, valor: value, valor_indeterminado: demand, moneda: demand ? 'COP' : (currency?.[1].toUpperCase() as Contract['moneda'] ?? null), fecha_inicio: start, fecha_fin: end, requiere_poliza: needsPolicy, tipo_poliza: policyType, estado_poliza: needsPolicy ? 'pendiente' : 'no_aplica', comercial: commercial?.nombre ?? null, ruta_sharepoint: null, fecha_registro: email.fecha.slice(0, 10), fuente: 'buzon', confianza: confidenceMap, es_otrosi: isAddendum }
}
function lowConfidence(contract: Contract): string[] { return Object.entries(contract.confianza).filter(([, score]) => score < 0.8).map(([field]) => field) }
function similarity(a: string, b: string): number { return clean(a) === clean(b) ? 1 : 0 }
async function validation(ctx: ToolContext, id: string, contract: Contract): Promise<{ clasificacion: 'nuevo' | 'actualizacion' | 'duplicado' | 'rechazado'; id_contrato_existente?: string; requiere_revision: string[]; diferencias?: string[]; remitente_desconocido: boolean }> {
  const email = await readEmail(ctx, id)
  const commercials = await readJson<Commercial[]>(path.join(fixtureRoot(ctx), 'comerciales.json'))
  const rows = await master(ctx)
  const requires = contract.es_otrosi ? lowConfidence(contract).filter((field) => !['cliente', 'objeto', 'fecha_inicio'].includes(field)) : lowConfidence(contract)
  if (!contract.id_contrato || ((!contract.cliente || !contract.objeto) && !contract.es_otrosi)) return { clasificacion: 'rechazado', requiere_revision: requires, diferencias: ['No se identificaron partes u objeto del contrato.'], remitente_desconocido: !commercials.some((item) => item.email === email.de) }
  const existing = rows.find((row) => row.id_contrato === contract.id_contrato) ?? rows.find((row) => row.nit_cliente === contract.nit_cliente && similarity(row.objeto, contract.objeto ?? '') >= 0.9)
  const unknown = !commercials.some((item) => item.email === email.de)
  if (!existing) return { clasificacion: 'nuevo', requiere_revision: requires, remitente_desconocido: unknown }
  const differences = ['valor', 'fecha_inicio', 'fecha_fin'].filter((field) => contract[field as keyof Contract] !== null && String(existing[field]) !== String(contract[field as keyof Contract] ?? ''))
  if (!contract.es_otrosi && differences.length === 0) return { clasificacion: 'duplicado', id_contrato_existente: existing.id_contrato, requiere_revision: requires, remitente_desconocido: unknown }
  return { clasificacion: 'actualizacion', id_contrato_existente: existing.id_contrato, requiere_revision: requires, diferencias: differences, remitente_desconocido: unknown }
}

export const leer_buzon: Tool<Record<string, never>> = {
  description: 'Lista los mensajes de contrato pendientes de procesar en el buzón.',
  args: {},
  async execute(_args, ctx) {
    return guarded(ctx, 'contratos_leer_buzon', undefined, async () => {
      const seen = await processed(ctx)
      const folders = (await readdir(path.join(fixtureRoot(ctx), 'buzon'), { withFileTypes: true }))
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort()
      const mensajes = await Promise.all(folders.filter((id) => !seen.includes(id)).map(async (id) => {
        const email = await readEmail(ctx, id)
        return { id: email.id, de: email.de, asunto: email.asunto, fecha: email.fecha, adjuntos: email.adjuntos, tiene_contrato: email.adjuntos.some((item) => /contrato|otrosi/i.test(item)) }
      }))
      return { mensajes }
    })
  }
}
export const extraer: Tool<{ mensaje_id: string }> = { description: 'Extrae datos estructurados y confianza desde el contrato adjunto de un mensaje.', args: { mensaje_id: messageId }, async execute({ mensaje_id }, ctx) { return guarded(ctx, 'contratos_extraer', mensaje_id, async () => { const email = await readEmail(ctx, mensaje_id); const attachment = email.adjuntos.find((item) => /contrato|otrosi/i.test(item)); if (!attachment) throw new Error('El mensaje no contiene un adjunto de contrato.'); const text = await readFile(path.join(fixtureRoot(ctx), 'buzon', mensaje_id, attachment), 'utf8'); if (!text.trim()) throw new Error('El texto del contrato está vacío.'); const commercials = await readJson<Commercial[]>(path.join(fixtureRoot(ctx), 'comerciales.json')); return extract(text, email, commercials.find((item) => item.email === email.de)) }) } }
export const validar: Tool<{ mensaje_id: string; contrato: Contract }> = { description: 'Clasifica un contrato contra el maestro y señala campos que requieren revisión humana.', args: { mensaje_id: messageId, contrato: contractSchema.describe('Contrato producido por contratos_extraer.') }, async execute({ mensaje_id, contrato }, ctx) { return guarded(ctx, 'contratos_validar', mensaje_id, () => validation(ctx, mensaje_id, contrato)) } }
export const registrar: Tool<{ mensaje_id: string; contrato: Contract; confirmado?: boolean }> = { description: 'Registra o actualiza un contrato y archiva su documento solo después de la validación y confirmación requerida.', args: { mensaje_id: messageId, contrato: contractSchema.describe('Contrato validado.'), confirmado: z.boolean().optional().describe('Verdadero solo tras confirmación humana explícita.') }, async execute({ mensaje_id, contrato, confirmado = false }, ctx) { return guarded(ctx, 'contratos_registrar', mensaje_id, async () => { const result = await validation(ctx, mensaje_id, contrato); if (result.clasificacion === 'rechazado') throw new Error('No se puede registrar un contrato rechazado.'); if (result.clasificacion === 'duplicado') return { id_contrato: contrato.id_contrato, accion: 'duplicado', ruta_archivo: null }; if (result.requiere_revision.length && !confirmado) throw new Error(`requiere revisión: ${result.requiere_revision.join(', ')}`); const rows = await master(ctx); const email = await readEmail(ctx, mensaje_id); const attachment = email.adjuntos.find((item) => /contrato|otrosi/i.test(item)); if (!attachment || !contrato.id_contrato) throw new Error('Faltan datos para archivar el contrato.');
      const previous = rows.find((item) => item.id_contrato === contrato.id_contrato)
      const client = contrato.cliente ?? previous?.cliente
      const startDate = contrato.fecha_inicio ?? previous?.fecha_inicio
      if (!client || !startDate) throw new Error('Faltan datos para archivar el contrato.'); const extension = path.extname(attachment) || '.txt'; const relative = path.join('Contratos', startDate.slice(0, 4), slug(client), `${contrato.id_contrato}${extension}`).replaceAll('\\', '/'); const target = path.join(outRoot(ctx), 'sharepoint', relative); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(fixtureRoot(ctx), 'buzon', mensaje_id, attachment), target); const row: CsvRow = { id_contrato: contrato.id_contrato, cliente: client, nit_cliente: contrato.nit_cliente ?? previous?.nit_cliente ?? '', pais: contrato.pais ?? previous?.pais ?? '', objeto: contrato.objeto ?? previous?.objeto ?? '', valor: String(contrato.valor ?? previous?.valor ?? 0), moneda: contrato.moneda ?? previous?.moneda ?? '', fecha_inicio: startDate, fecha_fin: contrato.fecha_fin ?? previous?.fecha_fin ?? '', requiere_poliza: String(contrato.requiere_poliza), tipo_poliza: contrato.tipo_poliza || previous?.tipo_poliza || '', estado_poliza: contrato.estado_poliza, comercial: contrato.comercial ?? previous?.comercial ?? 'Remitente no registrado', ruta_sharepoint: relative, fecha_registro: contrato.fecha_registro ?? email.fecha.slice(0, 10), fuente: 'buzon' }; const existingIndex = rows.findIndex((item) => item.id_contrato === contrato.id_contrato); const accion = existingIndex >= 0 ? 'actualizacion' : 'nuevo'; if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...row }; else rows.push(row); await saveMaster(ctx, rows); await appendFile(path.join(outRoot(ctx), 'sharepoint', 'historial.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), id_contrato: contrato.id_contrato, accion, cambios: previous ? Object.keys(row).filter((key) => previous[key] !== row[key]) : Object.keys(row), mensaje_id })}\n`); await writeProcessed(ctx, [...await processed(ctx), mensaje_id]); return { id_contrato: contrato.id_contrato, accion, ruta_archivo: relative } }) } }
export const alertas: Tool<{ hoy: string }> = { description: 'Genera el reporte de vencimientos, pólizas pendientes y contratos registrados desde el corte.', args: { hoy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Fecha de referencia YYYY-MM-DD.') }, async execute({ hoy }, ctx) { return guarded(ctx, 'contratos_alertas', undefined, async () => { const rows = await master(ctx); const reference = new Date(`${hoy}T00:00:00Z`).getTime(); const limit = reference + 60 * 86400000; const due = rows.filter((row) => { const date = new Date(`${row.fecha_fin}T00:00:00Z`).getTime(); return date >= reference && date <= limit }); const pending = rows.filter((row) => row.requiere_poliza === 'true' && row.estado_poliza !== 'vigente'); const registered = rows.filter((row) => row.fecha_registro >= '2026-05-30'); const report = `# Alertas de contratos\n\nFecha de referencia: ${hoy}\n\n## Vencen en ≤ 60 días\n${due.map((row) => `- ${row.id_contrato} · ${row.cliente} · vence ${row.fecha_fin}`).join('\n') || '- Ninguno'}\n\n## Pólizas pendientes\n${pending.map((row) => `- ${row.id_contrato} · ${row.cliente} · ${row.estado_poliza}`).join('\n') || '- Ninguna'}\n\n## Registrados desde el corte 2026-05-30\n${registered.map((row) => `- ${row.id_contrato} · ${row.fecha_registro}`).join('\n') || '- Ninguno'}\n`; await writeFile(path.join(outRoot(ctx), 'alertas.md'), report); return { ruta: 'out/alertas.md', vencen: due.map((row) => row.id_contrato), polizas_pendientes: pending.map((row) => row.id_contrato), registrados_desde_corte: registered.map((row) => row.id_contrato) } }) } }
export const contratosTools = { leer_buzon, extraer, validar, registrar, alertas }
export async function cleanOutput(directory: string): Promise<void> { await rm(path.join(directory, 'out'), { recursive: true, force: true }); await mkdir(path.join(directory, 'out'), { recursive: true }) }
