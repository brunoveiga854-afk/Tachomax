import AsyncStorage from '@react-native-async-storage/async-storage'

export const TROCA_PENDENTE_KEY = 'troca_pendente'
export type EstadoAoContinuar = 'pause' | 'service'
export type TrocaPendente = {
  camiaoA: { type: 'immat' | 'parc' | null; value: string }
  kmInicioA: number
  kmFimA: number
  ts: number
  estadoAoContinuar: EstadoAoContinuar
  segServicoAoContinuar: number
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
  return {
    camiaoA: { type: c.type === 'immat' || c.type === 'parc' ? c.type : null, value: c.value },
    kmInicioA: ki, kmFimA: kf, ts: o.ts,
    estadoAoContinuar: o.estadoAoContinuar, segServicoAoContinuar: seg,
  }
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

/** Apaga a troca pendente. Nunca lança. */
export async function limparTrocaPendente(): Promise<void> {
  try { await AsyncStorage.removeItem(TROCA_PENDENTE_KEY) } catch { /* silêncio */ }
}
