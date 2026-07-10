// src/engine/migracoes.ts
// Schema migration utilities for TachoOffice persisted objects

import { PADRAO_INICIAL, PadraoAprendido } from './aprendizagem'

export const PADRAO_VERSAO_ACTUAL = 1

export type PadraoSalario = {
  descoberto: boolean; diaSalario: number; diaFrais: number
  defasagemFrais: number; confianca: number
  hbase: number; hval: number; h25: number; lim25: number; h50: number
  hlag: number; flag: number; liquidRate: number; fraisSepare?: boolean
  horasExtrasMedia: number
  ptd: number; dej: number; din: number; nui: number
  valorDiaConges: number; valorDiaFerie: number; valorDiaRC: number
  regles?: { ptDejAte: number; dejMinAmp: number; dinerDe: number }
  taxaHorariaNetaMedia: number
  fraisFactorReal: number
  _conflitHbase?: { extraido: number; onboarding: number } | null
  _hbaseManual?: boolean
  _hvalManual?: boolean
  versao?: number
  vehiculo?: string
  cargo?: string
}

/**
 * Migrates monSalaire_padrao from any schema version to the current one.
 * v0 → v1: adds taxaHorariaNetaMedia, fraisFactorReal, valorDia* fields.
 */
export function migrarPadrao(raw: any): PadraoSalario {
  const versao = raw?.versao ?? 0
  const migrado = { ...raw }
  if (versao < 1) {
    if (migrado.taxaHorariaNetaMedia === undefined) migrado.taxaHorariaNetaMedia = 0
    if (migrado.fraisFactorReal === undefined) migrado.fraisFactorReal = 1
    if (migrado.valorDiaConges === undefined) migrado.valorDiaConges = 0
    if (migrado.valorDiaFerie === undefined) migrado.valorDiaFerie = 0
    if (migrado.valorDiaRC === undefined) migrado.valorDiaRC = 0
    migrado.versao = PADRAO_VERSAO_ACTUAL
  }
  return migrado as PadraoSalario
}

/**
 * Migrates aprendizagem_padrao from any schema version.
 * Ensures all required fields are present with safe defaults.
 */
export function migrarPadraoAprendido(raw: any): PadraoAprendido {
  if (!raw || typeof raw !== 'object') return { ...PADRAO_INICIAL }
  const migrado = { ...PADRAO_INICIAL, ...raw }
  if (!Array.isArray(migrado.primesConhecidas)) migrado.primesConhecidas = []
  if (!Array.isArray(migrado.liquidRateHistorico)) migrado.liquidRateHistorico = []
  if (typeof migrado.hlag !== 'number') migrado.hlag = PADRAO_INICIAL.hlag
  if (typeof migrado.flag !== 'number') migrado.flag = PADRAO_INICIAL.flag
  if (typeof migrado.diaSalario !== 'number') migrado.diaSalario = PADRAO_INICIAL.diaSalario
  if (typeof migrado.diaFrais !== 'number') migrado.diaFrais = PADRAO_INICIAL.diaFrais
  if (typeof migrado.hlagConfirmado !== 'boolean') migrado.hlagConfirmado = false
  if (typeof migrado.flagConfirmado !== 'boolean') migrado.flagConfirmado = false
  return migrado as PadraoAprendido
}
