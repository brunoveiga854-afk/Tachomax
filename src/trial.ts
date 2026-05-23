/**
 * TachoMax — Sistema de Trial
 * Gere os 60 dias de trial gratuito
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const TRIAL_KEY = 'tachomax_trial_start'
const TRIAL_DIAS = 60

/**
 * Inicializa o trial na primeira abertura da app.
 * Se já existir, não faz nada.
 */
export async function inicializarTrial(): Promise<void> {
  const existente = await AsyncStorage.getItem(TRIAL_KEY)
  if (!existente) {
    await AsyncStorage.setItem(TRIAL_KEY, new Date().toISOString())
  }
}

/**
 * Devolve o número de dias restantes do trial.
 * Retorna 0 se o trial expirou.
 */
export async function getDiasRestantes(): Promise<number> {
  const inicio = await AsyncStorage.getItem(TRIAL_KEY)
  if (!inicio) {
    // Ainda não inicializado — inicializar agora
    await inicializarTrial()
    return TRIAL_DIAS
  }
  const dataInicio = new Date(inicio)
  const agora = new Date()
  const diasPassados = Math.floor(
    (agora.getTime() - dataInicio.getTime()) / (1000 * 60 * 60 * 24)
  )
  return Math.max(TRIAL_DIAS - diasPassados, 0)
}

/**
 * Retorna true se o trial ainda estiver ativo.
 */
export async function isTrialAtivo(): Promise<boolean> {
  const dias = await getDiasRestantes()
  return dias > 0
}

/**
 * Retorna a data de expiração do trial (para mostrar ao utilizador).
 */
export async function getDataExpiracao(): Promise<Date | null> {
  const inicio = await AsyncStorage.getItem(TRIAL_KEY)
  if (!inicio) return null
  const dataInicio = new Date(inicio)
  const expiracao = new Date(dataInicio)
  expiracao.setDate(expiracao.getDate() + TRIAL_DIAS)
  return expiracao
}
