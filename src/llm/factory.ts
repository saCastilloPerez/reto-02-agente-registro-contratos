import { readFileSync } from 'node:fs'
import type { LlmAdapter } from './adapter.js'
import { DeterministicPerxiaAdapter } from './deterministic-perxia.js'
import { ExternalLlmAdapter } from './external.js'
import { OpenCodeGoAdapter } from './opencode.js'

export function createLlmAdapter(environment: NodeJS.ProcessEnv, promptPath: string): LlmAdapter {
  const provider = (environment.LLM_PROVIDER ?? 'perxia').toLowerCase()
  if (provider === 'perxia') return new DeterministicPerxiaAdapter()
  if (provider === 'opencode-go') {
    return new OpenCodeGoAdapter(
      environment.OPENCODE_MODEL ?? 'minimax-m3',
      readFileSync(promptPath, 'utf8'),
      environment.OPENCODE_API_KEY ?? '',
      Number(environment.LLM_TIMEOUT_MS ?? 30000)
    )
  }
  return new ExternalLlmAdapter(provider, environment.LLM_MODEL ?? 'pendiente-de-configurar', environment.LLM_API_KEY ?? '')
}
