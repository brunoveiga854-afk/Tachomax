// src/utils/projecoes.ts
// Funções puras de projecção salarial — sem dependências de estado React.
// Todas recebem historique, histCal e padrao como parâmetros explícitos
// para poderem ser usadas em qualquer ecrã (fiche.tsx, index.tsx, …).

import type { MoisData } from '../types/moisdata'
import type { PadraoSalario } from '../engine/migracoes'
import { shiftMois, calcFraisMesPorHorarios } from './calculos'
import { log } from './logger'
import { anoDoDia } from './dataDia'

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

// ── Resolução do mês de trabalho (fonte única) ──────────────────────────────
// Conceitos distintos (não confundir):
//   • mês de TRABALHO  – quando as horas/frais foram feitos;
//   • mês do BOLETIM   – mês a que o boletim pertence (sem campo próprio em MoisData);
//   • mês BANCÁRIO     – quando o dinheiro foi recebido.
// hlag/flag = desfasamento (mês bancário − mês de trabalho) do salário/frais.
// O rótulo da ficha (moisIndex/annee) pode ser boletim, banco ou nenhum dos dois:
// só se trata como mês bancário "explícito" quando os campos de pagamento DIFEREM do rótulo
// (prova de que vieram de uma data bancária e não de uma cópia do rótulo).

/** Subconjunto estrutural de PadraoAprendido (evita dependência circular). */
export type TimingAprendido = {
  hlag?: number | null; flag?: number | null
  hlagConfirmado?: boolean; flagConfirmado?: boolean
} | null | undefined

export type TipoMes = 'horas' | 'frais'
export type OrigemMes = 'gravado' | 'lag-confirmado' | 'lag-padrao'
export type AncoraMes = 'gravado' | 'banco-explicito' | 'rotulo'
export type FiabilidadeMes = 'gravada' | 'declarada' | 'media' | 'inferida' | 'nao-confirmada'

export type MesTrabalhoResolvido = {
  ano: number; mes: number
  lag: number | null          // null quando o mês está gravado
  origem: OrigemMes
  ancora: AncoraMes
  fiabilidade: FiabilidadeMes
}

/**
 * Desfasamento efectivo: o confirmado (hlagConfirmado/flagConfirmado) prevalece sobre o do padrão.
 * "confirmado" = marcado como tal em PadraoAprendido; NÃO prova que veio de um boletim
 * (o onboarding também o marca) — por isso a fiabilidade resultante é 'declarada', não 'alta'.
 */
export function lagEfectivo(p: PadraoSalario, ap: TimingAprendido, tipo: TipoMes = 'horas'): { lag: number; confirmado: boolean } {
  const conf = tipo === 'horas' ? ap?.hlagConfirmado : ap?.flagConfirmado
  const v = tipo === 'horas' ? ap?.hlag : ap?.flag
  if (conf === true && typeof v === 'number' && Number.isFinite(v)) return { lag: v, confirmado: true }
  return { lag: tipo === 'horas' ? p.hlag : p.flag, confirmado: false }
}

export function resolverMesTrabalho(
  d: MoisData, p: PadraoSalario, ap?: TimingAprendido, tipo: TipoMes = 'horas',
): MesTrabalhoResolvido {
  const gAno = tipo === 'horas' ? d.anoTrabalho : d.anoFraisTrabalho
  const gMes = tipo === 'horas' ? d.mesTrabalhoIndex : d.mesFraisTrabalhoIndex
  if (gAno != null && gMes != null) {
    return { ano: gAno, mes: gMes, lag: null, origem: 'gravado', ancora: 'gravado', fiabilidade: 'gravada' }
  }
  const [anoPay, mesPay] = tipo === 'horas' ? mesPagamentoSalDe(d) : mesPagamentoFraisDe(d)
  const bancoExplicito = anoPay !== d.annee || mesPay !== d.moisIndex
  const { lag, confirmado } = lagEfectivo(p, ap, tipo)
  const [ano, mes] = shiftMois(anoPay, mesPay, -lag)
  const fiabilidade: FiabilidadeMes = bancoExplicito
    ? (confirmado ? 'declarada' : 'media')
    : (confirmado ? 'inferida' : 'nao-confirmada')
  return {
    ano, mes, lag,
    origem: confirmado ? 'lag-confirmado' : 'lag-padrao',
    ancora: bancoExplicito ? 'banco-explicito' : 'rotulo',
    fiabilidade,
  }
}

/**
 * Para ESCRITORES: devolve o mês de trabalho a gravar, ou null se a associação for incerta.
 * Só grava quando o mês bancário é explícito E o desfasamento está confirmado.
 * null = não gravar (o mês resolve-se dinamicamente com resolverMesTrabalho).
 */
export function mesTrabalhoParaGravar(
  ancora: { ano: number; mes: number; bancoExplicito: boolean },
  p: PadraoSalario, ap?: TimingAprendido, tipo: TipoMes = 'horas',
): [number, number] | null {
  if (!ancora.bancoExplicito) return null
  const { lag, confirmado } = lagEfectivo(p, ap, tipo)
  if (!confirmado) return null
  return shiftMois(ancora.ano, ancora.mes, -lag)
}

export const mesTrabalhoDe = (d: MoisData, p: PadraoSalario, ap?: TimingAprendido): [number, number] => {
  const r = resolverMesTrabalho(d, p, ap, 'horas')
  return [r.ano, r.mes]
}

export const mesFraisTrabalhoDe = (d: MoisData, p: PadraoSalario, ap?: TimingAprendido): [number, number] => {
  const r = resolverMesTrabalho(d, p, ap, 'frais')
  return [r.ano, r.mes]
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
  ap?: TimingAprendido,
): Medias | null {
  const anoActual = new Date().getFullYear()
  const amostras: { nDias: number; totalH: number; fraisDia: number }[] = []
  for (const m of historique) {
    if (m.moisAtipico || !contaParaSalarioAprendizagem(m)) continue
    const [aH, mH] = mesTrabalhoDe(m, padrao, ap)
    if (aH < anoActual - 1) continue
    const diasTrab = histCal.filter((j: any) => {
      const parts = j.date?.split('/')
      if (!parts || parts.length < 2) return false
      const mes = parseInt(parts[1]) - 1
      const ano = j.id ? anoDoDia(j) : aH
      return mes === mH && ano === aH && ['TRAB', 'DEC', 'work', 'dec'].includes(j.type || '')
    })
    const totalHCal = diasTrab.reduce((a: number, j: any) => a + (j.segServico || 0), 0) / 3600
    const totalHFiche = m.totalHeures || 0

    let totalH: number
    let nDias: number
    if (diasTrab.length >= 10 && totalHCal >= 10) {
      // Caso normal: calendário suficiente
      totalH = totalHCal * ((padrao as any).horasFactorReal > 1 ? (padrao as any).horasFactorReal : 1)
      nDias = diasTrab.length
    } else if (totalHFiche >= 10 && diasTrab.length > 0) {
      // Fallback: calendário incompleto mas há dias reais + totalHeures da fiche
      totalH = totalHFiche
      nDias = Math.max(1, diasTrab.length)
    } else if (totalHFiche >= 10) {
      // Último recurso: só fiche, estima nDias por jours ouvrés
      totalH = totalHFiche
      nDias = joursOuvresMois(aH, mH)
    } else {
      continue  // sem dados suficientes
    }

    const [aF, mF] = mesFraisTrabalhoDe(m, padrao, ap)
    const fraisCalc = calcFraisMesPorHorarios(histCal, aF, mF, padrao)
    const fraisReal = fraisRealConfirme(m) > 0 ? fraisRealConfirme(m) : (m.fraisBoletim || fraisCalc.total)
    amostras.push({ nDias, totalH, fraisDia: fraisReal / nDias })
  }
  if (amostras.length === 0) return null
  const mediaHPorDia = amostras.reduce((a, s) => a + s.totalH / s.nDias, 0) / amostras.length
  const mediaFraisPorDia = amostras.reduce((a, s) => a + s.fraisDia, 0) / amostras.length
  return { mediaHPorDia, mediaFraisPorDia, nMeses: amostras.length }
}

// ── calcEstimativaMes ─────────────────────────────────────────────────────────

// DEBUG_CALC_INTERNO — remover após diagnóstico
let _ultimoDebugCalcInterno = ''

export function calcEstimativaMes(
  m: MoisData,
  historique: MoisData[],
  histCal: any[],
  padrao: PadraoSalario,
  mediasPreComp?: Medias | null,
  ap?: TimingAprendido,
): number {
  const p = padrao

  // Mês de TRABALHO
  const [aH, mH] = mesTrabalhoDe(m, p, ap)

  // Todos os dias do mês de trabalho
  const todosDoMes = histCal.filter((j: any) => {
    const parts = j.date?.split('/')
    if (!parts || parts.length < 2) return false
    const mes = parseInt(parts[1]) - 1
    const ano = j.id ? anoDoDia(j) : aH
    return mes === mH && ano === aH
  })
  const diasTrab = todosDoMes.filter((j: any) => ['TRAB', 'DEC', 'work', 'dec'].includes(j.type || ''))

  if (diasTrab.length === 0) {
    const medias = mediasPreComp ?? calcMediasDiasTrabalho(historique, histCal, p, ap)
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
  const [aF, mF] = mesFraisTrabalhoDe(m, p, ap)

  // 1ª prioridade: fraisBoletim confirmado para este mês de frais
  const FRAIS_SANIDADE_MAX = 3000  // acima disto = valor corrompido (AI scan / bug)

  const ficheComFrais = historique.find(f => {
    const [anoFrais, mesFrais] = mesFraisTrabalhoDe(f, p, ap)
    return mesFrais === mF && anoFrais === aF && !!f.fraisConfirmado && ((f.fraisRecuConfirme || 0) > 0 || (f.fraisBoletim || 0) > 0)
  })
  const fraisCalc = calcFraisMesPorHorarios(histCal, aF, mF, p)
  const factor    = (p.fraisFactorReal || 0) > 0.1 && p.fraisFactorReal < 3.0 ? p.fraisFactorReal : 1
  let totalFrais: number
  if (ficheComFrais) {
    const valorFiche = ficheComFrais.fraisRecuConfirme || ficheComFrais.fraisBoletim || 0
    if (valorFiche <= FRAIS_SANIDADE_MAX) {
      totalFrais = valorFiche
    } else {
      // valor corrompido — cai no cálculo por horários
      totalFrais = fraisCalc.total > 0
        ? Math.round(fraisCalc.total * factor)
        : (m.fraisBoletim || 0)
    }
  } else {
    totalFrais = fraisCalc.total > 0
      ? Math.round(fraisCalc.total * factor)
      : (m.fraisBoletim || 0)
  }

  // DEBUG_CALC_INTERNO — remover após diagnóstico
  if (m.moisIndex === 4 && m.annee === 2026) {
    const _salBase = totalH * p.taxaHorariaNetaMedia
    const _valConges = nConges * valCongeNet
    const _valFeries = nFeries * valFerieNet
    const _valRC = nRC * valRCNet
    const _raw = salLiq + totalFrais
    const _payload = {
      totalH, taxaHorariaNetaMedia: p.taxaHorariaNetaMedia,
      salBase: _salBase,
      nConges, valCongeNet, valCongesTotal: _valConges,
      nFeries, valFerieNet, valFeriesTotal: _valFeries,
      nRC, valRCNet, valRCTotal: _valRC,
      salLiq,
      ficheComFraisFound: !!ficheComFrais,
      fraisCalcTotal: fraisCalc.total, factor, totalFrais,
      rawAvantRound: _raw,
      resultatFinal: Math.round(_raw),
    }
    const _assinatura = JSON.stringify(_payload)
    if (_assinatura !== _ultimoDebugCalcInterno) {
      _ultimoDebugCalcInterno = _assinatura
      log.info('DEBUG_CALC_INTERNO', 'decomposição Mai 2026', _payload)
    }
  }
  return Math.round(salLiq + totalFrais)
}
