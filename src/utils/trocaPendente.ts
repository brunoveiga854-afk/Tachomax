import AsyncStorage from '@react-native-async-storage/async-storage'

export const TROCA_PENDENTE_KEY = 'troca_pendente'
export type EstadoAoContinuar = 'pause' | 'service'
export type RespostaPausa = 'pause' | 'service'
export type CamiaoRegisto = { type: 'immat' | 'parc' | null; value: string }
export type TrocaPendente = {
  camiaoA: CamiaoRegisto
  kmInicioA: number
  kmFimA: number
  ts: number
  estadoAoContinuar: EstadoAoContinuar
  segServicoAoContinuar: number
  // Preenchidos quando o condutor indica o camião B (todos juntos ou nenhum)
  b?: { camiao: CamiaoRegisto; kmInicio: number }
  segParaPausa?: number
  respostaPausa?: RespostaPausa
}

const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

function validar(o: any): TrocaPendente | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const c = o.camiaoA
  if (!c || typeof c !== 'object' || typeof c.value !== 'string') return null
  const ki = num(o.kmInicioA), kf = num(o.kmFimA), seg = num(o.segServicoAoContinuar)
  if (ki === null || kf === null || seg === null) return null
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts) || o.ts <= 0) return null
  if (o.estadoAoContinuar !== 'pause' && o.estadoAoContinuar !== 'service') return null
  const out: TrocaPendente = {
    camiaoA: { type: c.type === 'immat' || c.type === 'parc' ? c.type : null, value: c.value },
    kmInicioA: ki, kmFimA: kf, ts: o.ts,
    estadoAoContinuar: o.estadoAoContinuar, segServicoAoContinuar: seg,
  }
  // Camião B: só conta se vier completo e válido; senão ignora-se (registo da peça 1 continua válido)
  const b = o.b
  if (b && typeof b === 'object' && b.camiao && typeof b.camiao === 'object' && typeof b.camiao.value === 'string') {
    const kb = num(b.kmInicio), sp = num(o.segParaPausa)
    if (kb !== null && sp !== null && (o.respostaPausa === 'pause' || o.respostaPausa === 'service')) {
      out.b = { camiao: { type: b.camiao.type === 'immat' || b.camiao.type === 'parc' ? b.camiao.type : null, value: b.camiao.value }, kmInicio: kb }
      out.segParaPausa = sp
      out.respostaPausa = o.respostaPausa
    }
  }
  return out
}

/** Lê a troca pendente. Nunca lança: ausente, corrompida ou inválida devolve null. */
export async function lerTrocaPendente(): Promise<TrocaPendente | null> {
  try {
    const raw = await AsyncStorage.getItem(TROCA_PENDENTE_KEY)
    return raw ? validar(JSON.parse(raw)) : null
  } catch { return null }
}

let gravando = false

/** Grava só se NÃO existir uma válida. true = gravou; false = já existia, em curso ou falhou. Nunca lança. */
export async function gravarTrocaPendente(t: TrocaPendente): Promise<boolean> {
  if (gravando) return false
  gravando = true
  try {
    if (await lerTrocaPendente()) return false
    await AsyncStorage.setItem(TROCA_PENDENTE_KEY, JSON.stringify(t))
    return true
  } catch { return false }
  finally { gravando = false }
}

let completando = false

/**
 * Acrescenta o camião B à troca pendente. Só grava se existir uma troca válida SEM b.
 * Devolve a troca actualizada, ou null (sem troca, já tem b, em curso, dados inválidos ou falha). Nunca lança.
 */
export async function completarTrocaPendente(
  b: { camiao: CamiaoRegisto; kmInicio: number },
  segParaPausa: number,
  resposta: RespostaPausa,
): Promise<TrocaPendente | null> {
  if (completando) return null
  completando = true
  try {
    const atual = await lerTrocaPendente()
    if (!atual || atual.b) return null
    const nova = validar({ ...atual, b, segParaPausa, respostaPausa: resposta })
    if (!nova || !nova.b) return null
    await AsyncStorage.setItem(TROCA_PENDENTE_KEY, JSON.stringify(nova))
    return nova
  } catch { return null }
  finally { completando = false }
}

/** Apaga a troca pendente. Nunca lança. */
export async function limparTrocaPendente(): Promise<void> {
  try { await AsyncStorage.removeItem(TROCA_PENDENTE_KEY) } catch { /* silêncio */ }
}
