import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from './logger'
import { registarKm, MapaKm } from './camioes'

export const KM_POR_CAMIAO_KEY = 'km_por_camiao'

/** Lê o mapa { matrículaNormalizada: km }. Nunca lança: qualquer problema devolve {}. */
export async function lerMapaKm(): Promise<MapaKm> {
  try {
    const raw = await AsyncStorage.getItem(KM_POR_CAMIAO_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    const limpo: MapaKm = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) limpo[k] = v
    }
    return limpo
  } catch {
    return {}
  }
}

/** Guarda em silêncio o último km de um camião. Nunca lança. km vazio/≤ 0 ou matrícula vazia: não faz nada. */
export async function gravarKmCamiao(matricula: string, km: number): Promise<void> {
  try {
    const antes = await lerMapaKm()
    const depois = registarKm(antes, matricula, km)
    if (JSON.stringify(depois) === JSON.stringify(antes)) return
    await AsyncStorage.setItem(KM_POR_CAMIAO_KEY, JSON.stringify(depois))
    log.info('kmPorCamiao', 'km do camião registado', { nCamioes: Object.keys(depois).length })
  } catch {
    // silêncio: esta memória é um extra e nunca pode atrasar nem partir o fluxo
  }
}
