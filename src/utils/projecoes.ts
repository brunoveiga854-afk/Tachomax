// src/utils/projecoes.ts
// Funções puras de projecção salarial — sem dependências de estado React.
// Todas recebem historique, histCal e padrao como parâmetros explícitos
// para poderem ser usadas em qualquer ecrã (fiche.tsx, index.tsx, …).

import type { MoisData } from '../types/moisdata'
import type { PadraoSalario } from '../engine/migracoes'
import { shiftMois, calcFraisMesPorHorarios } from './calculos'

// ── Tipo público das médias ───────────────────────────────────────────────────

export type Medias = {
  mediaHPorDia: number
  mediaFraisPorDia: number
  nMeses: number
}

// ── Helpers puros sobre MoisData (antes em fiche.tsx) ────────────────────────

export const mesPagamentoSalDe = (d: MoisData): [number, number] => [
  d.pagamentoSalAno ?? d.anoPagamento ?? d.annee,
  d.pagamentoSalMesIndex ?? d.mesPagamentoIndex ?? d.moisIndex,
]

export const mesPagamentoFraisDe = (d: MoisData): [number, number] => [
  d.pagamentoFraisAno ?? d.anoPagamento ?? d.annee,
  d.pagamentoFraisMesIndex ?? d.mesPagamentoIndex ?? d.moisIndex,
]

export const mesTrabalhoDe = (d: MoisData, p: PadraoSalario): [number, number] => {
  if (d.anoTrabalho != null && d.mesTrabalhoIndex != null) return [d.anoTrabalho, d.mesTrabalhoIndex]
  const [anoPay, mesPay] = mesPagamentoSalDe(d)
  return shiftMois(anoPay, mesPay, -p.hlag)
}

export const mesFraisTrabalhoDe = (d: MoisData, p: PadraoSalario): [number, number] => {
  if (d.anoFraisTrabalho != null && d.mesFraisTrabalhoIndex != null) return [d.anoFraisTrabalho, d.mesFraisTrabalhoIndex]
  const [anoPay, mesPay] = mesPagamentoFraisDe(d)
  return shiftMois(anoPay, mesPay, -p.flag)
}

export const fraisRealConfirme = (d: MoisData): number =>
  d.fraisConfirmado ? (d.fraisRecuConfirme || d.remboursementFrais || d.fraisBoletim || 0) : 0

export const contaParaSalarioAprendizagem = (d: MoisData): boolean =>
  !d.moisAtipico && !!(d.salarioConfirmado || (d.netPaye || 0) > 0 || (d.salairebrut || 0) > 0)

// ── Dias úteis Lun-Ven (sem feriados) ────────────────────────────────────────

export const joursOuvresMois = (ano: number, mes: number): number => {
  const diasNoMes = new Date(ano, mes + 1, 0).getDate()
  let count = 0
  for (let d = 1; d <= diasNoMes; d++) {
    const dow = new Date(ano, mes, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

export const joursOuvresRestantes = (ano: number, mes: number): number => {
  const hoje = new Date()
  const diaInicio = (mes === hoje.getMonth() && ano === hoje.getFullYear()) ? hoje.getDate() : 1
  const diasNoMes = new Date(ano, mes + 1, 0).getDate()
  let count = 0
  for (let d = diaInicio; d <= diasNoMes; d++) {
    const dow = new Date(ano, mes, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

// ── calcMediasDiasTrabalho ────────────────────────────────────────────────────

export function calcMediasDiasTrabalho(
  historique: MoisData[],
  histCal: any[],
  padrao: PadraoSalario,
): Medias | null {
  const anoActual = new Date().getFullYear()
  const amostras: { nDias: number; totalH: number; fraisDia: number }[] = []
  for (const m of historique) {
    if (m.moisAtipico || !contaParaSalarioAprendizagem(m)) continue
    const [aH, mH] = mesTrabalhoDe(m, padrao)
    if (aH < anoActual - 1) continue
    const diasTrab = histCal.filter((j: any) => {
      const parts = j.date?.split('/')
      if (!parts || parts.length < 2) return false
      const mes = parseInt(parts[1]) - 1
      const ano = j.id ? new Date(parseInt(j.id)).getFullYear() : aH
      return mes === mH && ano === aH && ['TRAB', 'DEC', 'work', 'dec'].includes(j.type || '')
    })
    if (diasTrab.length < 10) continue
    const totalH = diasTrab.reduce((a: number, j: any) => a + (j.segServico || 0), 0) / 3600
    if (totalH < 10) continue
    const [aF, mF] = mesFraisTrabalhoDe(m, padrao)
    const fraisCalc = calcFraisMesPorHorarios(histCal, aF, mF, padrao)
    const fraisReal = fraisRealConfirme(m) > 0 ? fraisRealConfirme(m) : (m.fraisBoletim || fraisCalc.total)
    amostras.push({ nDias: diasTrab.length, totalH, fraisDia: fraisReal / diasTrab.length })
  }
  if (amostras.length === 0) return null
  const mediaHPorDia = amostras.reduce((a, s) => a + s.totalH / s.nDias, 0) / amostras.length
  const mediaFraisPorDia = amostras.reduce((a, s) => a + s.fraisDia, 0) / amostras.length
  return { mediaHPorDia, mediaFraisPorDia, nMeses: amostras.length }
}

// ── calcEstimativaMes ─────────────────────────────────────────────────────────

export function calcEstimativaMes(
  m: MoisData,
  historique: MoisData[],
  histCal: any[],
  padrao: PadraoSalario,
  mediasPreComp?: Medias | null,
): number {
  const p = padrao

  // Mês de TRABALHO
  const [aH, mH] = mesTrabalhoDe(m, p)

  // Todos os dias do mês de trabalho
  const todosDoMes = histCal.filter((j: any) => {
    const parts = j.date?.split('/')
    if (!parts || parts.length < 2) return false
    const mes = parseInt(parts[1]) - 1
    const ano = j.id ? new Date(parseInt(j.id)).getFullYear() : aH
    return mes === mH && ano === aH
  })
  const diasTrab = todosDoMes.filter((j: any) => ['TRAB', 'DEC', 'work', 'dec'].includes(j.type || ''))

  if (diasTrab.length === 0) {
    const medias = mediasPreComp ?? calcMediasDiasTrabalho(historique, histCal, p)
    if (!medias) return 0
    const nDias = joursOuvresMois(aH, mH)
    const salEstimado = p.taxaHorariaNetaMedia > 0
      ? Math.round(nDias * medias.mediaHPorDia * p.taxaHorariaNetaMedia)
      : Math.round(nDias * medias.mediaHPorDia * p.hval * p.liquidRate)
    const fraisEstimado = Math.round(nDias * medias.mediaFraisPorDia)
    return salEstimado + fraisEstimado
  }

  const totalSeg = diasTrab.reduce((a: number, j: any) => a + (j.segServico || 0), 0)
  const totalH   = totalSeg / 3600

  // Dias especiais (congé, fériés, RC)
  const nConges = todosDoMes.filter((j: any) => ['FERIE', 'vac'].includes(j.type || '')).length
  const nFeries = todosDoMes.filter((j: any) => ['FER', 'FERIADO', 'hol'].includes(j.type || '')).length
  const nRC     = todosDoMes.filter((j: any) => j.type === 'RC').length

  const valCongeNet = (p.valorDiaConges > 0 ? p.valorDiaConges : (p.hbase / 22) * p.hval) * p.liquidRate
  const valFerieNet = (p.valorDiaFerie  > 0 ? p.valorDiaFerie  : (p.hbase / 22) * p.hval) * p.liquidRate
  const valRCNet    = (p.valorDiaRC > 0 ? p.valorDiaRC : (p.hbase / 22) * p.hval) * p.liquidRate

  let salLiq: number
  if (p.taxaHorariaNetaMedia > 0) {
    salLiq = Math.round(
      totalH * p.taxaHorariaNetaMedia
      + nConges * valCongeNet
      + nFeries * valFerieNet
      + nRC     * valRCNet
    )
  } else {
    const extra = Math.max(0, totalH - p.hbase)
    const brut  = totalH <= p.hbase
      ? totalH * p.hval
      : p.hbase * p.hval + Math.min(extra, p.lim25) * p.h25 + Math.max(0, extra - p.lim25) * p.h50
    salLiq = Math.round(
      brut * p.liquidRate
      + nConges * valCongeNet
      + nFeries * valFerieNet
      + nRC     * valRCNet
    )
  }

  // Frais — mês de trabalho dos frais
  const [aF, mF] = mesFraisTrabalhoDe(m, p)

  // 1ª prioridade: fraisBoletim confirmado para este mês de frais
  const ficheComFrais = historique.find(f => {
    const [anoFrais, mesFrais] = mesFraisTrabalhoDe(f, p)
    return mesFrais === mF && anoFrais === aF && ((f.fraisRecuConfirme || 0) > 0 || (f.fraisBoletim || 0) > 0)
  })
  let totalFrais: number
  if (ficheComFrais) {
    totalFrais = ficheComFrais.fraisRecuConfirme || ficheComFrais.fraisBoletim
  } else {
    const fraisCalc = calcFraisMesPorHorarios(histCal, aF, mF, p)
    const factor    = (p.fraisFactorReal || 0) > 0.1 ? p.fraisFactorReal : 1
    totalFrais = fraisCalc.total > 0
      ? Math.round(fraisCalc.total * factor)
      : (m.fraisBoletim || 0)
  }

  return Math.round(salLiq + totalFrais)
}
