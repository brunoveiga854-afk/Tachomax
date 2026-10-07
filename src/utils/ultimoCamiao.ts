import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from './logger'
import { parseUltimoCamiao, normalizarMatricula, Camiao } from './camioes'

export const ULTIMO_CAMIAO_KEY = 'ultimo_camiao_servico'

/** Camião do último serviço terminado, ou null (sem a chave, inválido ou erro). Nunca lança. */
export async function lerUltimoCamiao(): Promise<Camiao | null> {
  try {
    return parseUltimoCamiao(await AsyncStorage.getItem(ULTIMO_CAMIAO_KEY))
  } catch {
    return null
  }
}

/** Guarda em silêncio o camião do último serviço. Matrícula vazia: não faz nada. Nunca lança. */
export async function gravarUltimoCamiao(c: Camiao | null | undefined): Promise<void> {
  try {
    const value = String(c?.value ?? '').trim()
    if (normalizarMatricula(value) === '') return
    await AsyncStorage.setItem(ULTIMO_CAMIAO_KEY, JSON.stringify({ type: c?.type === 'parc' ? 'parc' : 'immat', value }))
    log.info('ultimoCamiao', 'camião do último serviço registado')
  } catch {
    // silêncio: nunca pode partir o fluxo de guardar o dia
  }
}
