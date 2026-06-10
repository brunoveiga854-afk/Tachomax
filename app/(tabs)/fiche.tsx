import { Swipeable } from 'react-native-gesture-handler'
import React, { useState, useEffect, useRef } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, TextInput, Animated, Easing, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../context/ThemeContext'
import { calcularFraisJour } from '../../src/frais'
import DocumentScanner from '../../src/components/DocumentScanner'
const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? ''

// Valeurs par défaut convention transport français
const DEF_SAL = {
  hbase: 169, hval: 14.76, h25: 18.45, lim25: 17, h50: 22.31,
  hlag: 1, flag: 0, liquidRate: 0.79,
  ptd: 4.42, dej: 16.36, din: 23.94, nui: 23.94,
  valorDiaConges: 0, valorDiaFerie: 0, valorDiaRC: 0,
}
const MIN_CONFIRMACOES_CONTRARIAS_DEFASAGEM = 3

type MoisData = {
  periode: string; moisIndex: number; annee: number; fichePages: number
  mesFicheIndex?: number; anoFiche?: number
  mesTrabalhoIndex?: number; anoTrabalho?: number
  mesPagamentoIndex?: number; anoPagamento?: number
  mesFraisTrabalhoIndex?: number; anoFraisTrabalho?: number
  fonte?: 'confirmado' | 'ia' | 'editado'
  confiancaAprendizagem?: number
  netPaye: number; salairebrut: number; totalCotisations: number
  remboursementFrais: number; fraisBoletim: number; montantTotalRecu: number
  interessement?: number; primeExceptionnelle?: number; participationSalariale?: number; autresPrimes?: number
  jourPaiement1: number; jourPaiement2: number; analysedAt: string
  entreprise: string; conducteur: string
  // Campos novos extraídos pela IA das fiches
  joursConges?: number; montantConges?: number
  joursFeries?: number; montantFeries?: number
  joursRC?: number; montantRC?: number; totalHeures?: number
  // Coeficientes salariais reais extraídos da fiche
  hbase?: number; hval?: number; h25?: number; lim25?: number; h50?: number
  // Confirmações reais dadas pelo motorista (mês/dia em que recebeu)
  salarioConfirmado?: boolean; fraisConfirmado?: boolean
  fraisRecuConfirme?: number
  pagamentoSalMesIndex?: number; pagamentoSalAno?: number
  pagamentoFraisMesIndex?: number; pagamentoFraisAno?: number
}

type Padrao = {
  descoberto: boolean; diaSalario: number; diaFrais: number
  defasagemFrais: number; confianca: number
  hbase: number; hval: number; h25: number; lim25: number; h50: number
  hlag: number; flag: number; liquidRate: number
  horasExtrasMedia: number
  // Valores reais dos frais aprendidos dos boletins
  ptd: number; dej: number; din: number; nui: number
  // Valor por dia de férias/feriado aprendido das fiches
  valorDiaConges: number; valorDiaFerie: number; valorDiaRC: number
  // Regras/limiares aprendidos dos boletins (opcionais)
  regles?: { ptDejAte: number; dejMinAmp: number; dinerDe: number }
  // Taxa salarial efectiva aprendida: net récurrent / horas_trabalhadas_mês_trabalho
  // Exclui intéressement e primes exceptionnelles extraídas da fiche.
  taxaHorariaNetaMedia: number
  // Factor de correcção de frais: fraisBoletim_real / fraisCalc_app
  // Aprende quando há discrepância entre o calculado e o recebido
  fraisFactorReal: number
}

type DocumentoAnalysado = {
  tipo: 'fiche' | 'frais'; periode: string; moisIndex: number; annee: number; dados: any
}

type CalcResult = {
  totalH: number; totalFrais: number; salBrut: number; salLiq: number
  totalLiq: number; jours: number; hExtra25: number; hExtra50: number
  mesReceber: string; diaReceber: number; diaFrais: number
  empresa: string; precisao: number; mesAberto: boolean
  mesHorasLabel: string  // ex: "Mai 2026"
  mesFraisLabel: string  // ex: "Avril 2026"
  salConfirmado?: boolean  // true quando o utilizador confirmou o valor real
}

const MOIS_NOMS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']

const shiftMois = (ano: number, mes: number, delta: number): [number, number] => {
  let m = mes + delta, a = ano
  while (m < 0) { m += 12; a-- }
  while (m > 11) { m -= 12; a++ }
  return [a, m]
}

const calcularPrecisao = (padrao: Padrao, nMeses: number): number => {
  let p = 40
  p += Math.min(nMeses * 15, 45)
  if (padrao.descoberto) p += 10
  if (padrao.liquidRate !== DEF_SAL.liquidRate) p += 5
  return Math.min(p, 98)
}

const DEFAULT_FRAIS_REGLES = { ptDejAte: 6.0, dejMinAmp: 6.017, dinerDe: 21.25 }
const TYPES_TRAVAIL = ['work', 'dec', 'TRAB', 'DEC']
const TYPES_SANS_FRAIS = ['OFF', 'RC', 'FERIE', 'FER', 'vac', 'CONGE', 'FERIADO', 'hol']

function valRegle(v: any, fallback: number, min: number, max: number) {
  const n = parseFloat(v)
  return !isNaN(n) && n >= min && n <= max ? n : fallback
}

function sanitizeFraisRegles(raw: any = {}, fallback: any = DEFAULT_FRAIS_REGLES) {
  return {
    ptDejAte: valRegle(raw.ptDejAte, fallback.ptDejAte ?? DEFAULT_FRAIS_REGLES.ptDejAte, 5, 8),
    dejMinAmp: valRegle(raw.dejMinAmp, fallback.dejMinAmp ?? DEFAULT_FRAIS_REGLES.dejMinAmp, 4, 8),
    dinerDe: valRegle(raw.dinerDe, fallback.dinerDe ?? DEFAULT_FRAIS_REGLES.dinerDe, 18, 23),
  }
}

const isTravailFrais = (type: string) => TYPES_TRAVAIL.includes(type || '')
const isSansFrais = (type: string) => TYPES_SANS_FRAIS.includes(type || '')
const fraisRealConfirme = (d: MoisData) => d.fraisConfirmado ? (d.fraisRecuConfirme || d.remboursementFrais || d.fraisBoletim || 0) : 0

function votoMaisForte(votos: number[]): { valor: number; count: number } | null {
  if (votos.length === 0) return null
  const counts: Record<number, number> = {}
  votos.forEach(v => counts[v] = (counts[v] || 0) + 1)
  const [valorStr, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return { valor: parseInt(valorStr), count }
}

function defasagemProtegida(valor: number, count: number, baseValue: number): number {
  return valor === baseValue || count >= MIN_CONFIRMACOES_CONTRARIAS_DEFASAGEM ? valor : baseValue
}

// ── HELPERS FRAIS POR HORÁRIOS ────────────────────────────────────────────────

function pT(s: string): number | null {
  if (!s) return null
  const [h, mi] = s.split(':').map(Number)
  return isNaN(h) || isNaN(mi) ? null : h + mi / 60
}

function calcFraisHorario(
  type: string,
  inicio: string,
  fim: string,
  prevDec: boolean,
  p: Padrao
): { ptd: number; dej: number; din: number; nui: number; total: number } {
  return calcularFraisJour({
    type,
    debut: inicio,
    fin: fim,
    prevDecouche: prevDec,
    regles: p.regles,
    valeurs: { ptDej: p.ptd, dej: p.dej, diner: p.din, nuit: p.nui },
  })
}

function calcFraisMesPorHorarios(
  hist: any[],
  ano: number,
  mes: number,
  p: Padrao
): { total: number; ptd: number; dej: number; din: number; nui: number } {
  const diasMes = hist
    .filter((j: any) => {
      const parts = j.date?.split('/')
      if (!parts || parts.length < 2) return false
      const m = parseInt(parts[1]) - 1
      const a = j.id ? new Date(parseInt(j.id)).getFullYear() : ano
      return m === mes && a === ano
    })
    .sort((a: any, b: any) => {
      const da = parseInt(a.date?.split('/')[0] || '0')
      const db = parseInt(b.date?.split('/')[0] || '0')
      return da - db
    })

  let total = 0, ptd = 0, dej = 0, din = 0, nui = 0

  // Normalize time format: historique stores "HHhMM", pT() expects "HH:MM"
  const normTime = (t: string) => t ? t.replace('h', ':') : ''

  for (let i = 0; i < diasMes.length; i++) {
    const j = diasMes[i]
    const type = j.type || 'TRAB'
    const prevDec = i > 0 && ['dec', 'DEC'].includes(diasMes[i - 1].type || '') && !isSansFrais(type)

    if (isTravailFrais(type)) {
      // Recalcular pelos horários evita propagar frais antigos guardados com regras erradas.
      const debut = normTime(j.debut || j.inicio || '')
      const fin = normTime(j.fin || j.fim || '')
      if (debut && fin) {
        const f = calcFraisHorario(type, debut, fin, prevDec, p)
        total += f.total; ptd += f.ptd; dej += f.dej; din += f.din; nui += f.nui
      } else if (j.frais != null && j.frais > 0) {
        total += j.frais
        ptd += 1
      }
    }
  }

  return { total, ptd, dej, din, nui }
}

// ── VÉRIFICATION CROISÉE FICHE vs APP ─────────────────────────────────────────
type VerifNivel = 'ok' | 'warn' | 'alert'

type VerifCruzada = {
  mesTrabalhoLabel: string
  mesFraisLabel: string
  salario: { fiche: number; app: number; diff: number; nivel: VerifNivel; aviso?: string; fonteApp: string }
  frais: { fiche: number; app: number; diff: number; pct: number; nivel: VerifNivel }
  horas: { fiche: number; app: number; diff: number; nivel: VerifNivel; aviso?: string }
}

function temDiferencasVerif(verif: VerifCruzada): boolean {
  return verif.salario.nivel !== 'ok' || verif.frais.nivel !== 'ok' || verif.horas.nivel !== 'ok'
}

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function horasCalendarioMesTrabalho(histCal: any[], anoPay: number, mesPay: number, hlag: number): number {
  const [aH, mH] = shiftMois(anoPay, mesPay, -hlag)
  const dias = histCal.filter((j: any) => {
    const parts = j.date?.split('/')
    if (!parts || parts.length < 2) return false
    const mes = parseInt(parts[1]) - 1
    const ano = j.id ? new Date(parseInt(j.id)).getFullYear() : aH
    return mes === mH && ano === aH && ['TRAB', 'DEC', 'work', 'dec'].includes(j.type || '')
  })
  return dias.reduce((a: number, j: any) => a + (j.segServico || 0), 0) / 3600
}

function netCalendarioMesPaye(histCal: any[], anoPay: number, mesPay: number, p: Padrao): number {
  const [aH, mH] = shiftMois(anoPay, mesPay, -p.hlag)
  const todosDoMes = histCal.filter((j: any) => {
    const parts = j.date?.split('/')
    if (!parts || parts.length < 2) return false
    const mes = parseInt(parts[1]) - 1
    const ano = j.id ? new Date(parseInt(j.id)).getFullYear() : aH
    return mes === mH && ano === aH
  })
  const diasTrab = todosDoMes.filter((j: any) => ['TRAB', 'DEC', 'work', 'dec'].includes(j.type || ''))
  if (diasTrab.length === 0) return 0

  const totalH = diasTrab.reduce((a: number, j: any) => a + (j.segServico || 0), 0) / 3600
  const nConges = todosDoMes.filter((j: any) => ['FERIE', 'vac'].includes(j.type || '')).length
  const nFeries = todosDoMes.filter((j: any) => ['FER', 'FERIADO', 'hol'].includes(j.type || '')).length
  const nRC = todosDoMes.filter((j: any) => j.type === 'RC').length
  const valCongeNet = (p.valorDiaConges > 0 ? p.valorDiaConges : (p.hbase / 22) * p.hval) * p.liquidRate
  const valFerieNet = (p.valorDiaFerie > 0 ? p.valorDiaFerie : (p.hbase / 22) * p.hval) * p.liquidRate
  const valRCNet = (p.valorDiaRC > 0 ? p.valorDiaRC : (p.hbase / 22) * p.hval) * p.liquidRate

  if (p.taxaHorariaNetaMedia > 0) {
    return Math.round(
      totalH * p.taxaHorariaNetaMedia + nConges * valCongeNet + nFeries * valFerieNet + nRC * valRCNet
    )
  }
  const extra = Math.max(0, totalH - p.hbase)
  const brut = totalH <= p.hbase
    ? totalH * p.hval
    : p.hbase * p.hval + Math.min(extra, p.lim25) * p.h25 + Math.max(0, extra - p.lim25) * p.h50
  return Math.round(
    brut * p.liquidRate + nConges * valCongeNet + nFeries * valFerieNet + nRC * valRCNet
  )
}

function buildVerificacaoCruzada(
  ficha: DocumentoAnalysado,
  dados: any,
  padrao: Padrao,
  histCal: any[],
  historique: MoisData[],
): VerifCruzada {
  const ano = ficha.annee
  const mes = ficha.moisIndex
  const [aT, mT] = shiftMois(ano, mes, -padrao.hlag)
  const [aF, mF] = shiftMois(ano, mes, -padrao.flag)
  const mesTrabalhoLabel = `${MOIS_NOMS[mT]} ${aT}`
  const mesFraisLabel = `${MOIS_NOMS[mF]} ${aF}`

  const salFiche = dados.netPaye || 0
  const histMes = historique.find(h => h.moisIndex === mes && h.annee === ano && h.netPaye > 0)
  const salApp = histMes?.netPaye || netCalendarioMesPaye(histCal, ano, mes, padrao)
  const fonteApp = histMes ? 'Confirmé précédemment' : 'Estimé calendrier'
  const diffSal = Math.abs(salFiche - salApp)
  let nivelSal: VerifNivel = 'ok'
  let avisoSal: string | undefined
  if (salFiche > 0 && salApp > 0) {
    if (diffSal <= 2) nivelSal = 'ok'
    else if (diffSal <= 20) {
      nivelSal = 'warn'
      avisoSal = 'Écart modeste — vérifie le montant avant de confirmer.'
    } else {
      nivelSal = 'alert'
      avisoSal = 'Écart important — possible heures supplémentaires d\'un autre mois incluses.'
    }
  } else if (salFiche > 0 && salApp === 0) {
    nivelSal = 'warn'
    avisoSal = 'Aucune heure enregistrée au calendrier pour le mois de travail (hlag).'
  }

  const fraisFiche = dados.remboursementFrais || 0
  const fraisCalc = calcFraisMesPorHorarios(histCal, aF, mF, padrao).total
  const fraisApp = padrao.fraisFactorReal > 0 && padrao.fraisFactorReal !== 1
    ? Math.round(fraisCalc * padrao.fraisFactorReal * 100) / 100
    : fraisCalc
  const diffFrais = Math.abs(fraisFiche - fraisApp)
  const pctFrais = fraisApp > 0 ? (diffFrais / fraisApp) * 100 : (fraisFiche > 0 ? 100 : 0)
  let nivelFrais: VerifNivel = 'ok'
  if (fraisFiche > 0 || fraisApp > 0) {
    if (pctFrais <= 5) nivelFrais = 'ok'
    else if (pctFrais <= 15) nivelFrais = 'warn'
    else nivelFrais = 'alert'
  }

  const hFiche = dados.totalHeures || 0
  const hApp = horasCalendarioMesTrabalho(histCal, ano, mes, padrao.hlag)
  const diffH = Math.abs(hFiche - hApp)
  let nivelH: VerifNivel = 'ok'
  let avisoH: string | undefined
  if (hFiche > 0 && hApp > 0) {
    if (diffH <= 5) nivelH = 'ok'
    else {
      nivelH = 'alert'
      avisoH = 'Écart > 5h — possible heures d\'un autre mois incluses sur la fiche.'
    }
  } else if (hFiche > 0 && hApp === 0) {
    nivelH = 'warn'
    avisoH = 'Aucune heure au calendrier pour ce mois de travail.'
  }

  return {
    mesTrabalhoLabel,
    mesFraisLabel,
    salario: { fiche: salFiche, app: salApp, diff: diffSal, nivel: nivelSal, aviso: avisoSal, fonteApp },
    frais: { fiche: fraisFiche, app: fraisApp, diff: diffFrais, pct: pctFrais, nivel: nivelFrais },
    horas: { fiche: hFiche, app: hApp, diff: diffH, nivel: nivelH, aviso: avisoH },
  }
}

// ── VALIDAR HLAG COM TOTAIS CONFIRMADOS ──────────────────────────────────────
// Usa montantTotalRecu (confirmado pelo utilizador) para encontrar o hlag correcto.
// É o método mais fiável porque usa dados reais em vez de estimativas de bruto.
function validarHlagComTotais(
  dados: MoisData[], hist: any[], base: Padrao
): number {
  const mesesConf = dados.filter(d => d.montantTotalRecu > 0 && contaParaSalarioAprendizagem(d))
  if (mesesConf.length < MIN_CONFIRMACOES_CONTRARIAS_DEFASAGEM || hist.length === 0) return DEF_SAL.hlag

  const erros: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [] }

  for (const m of mesesConf) {
    const [anoPay, mesPay] = mesPagamentoSalDe(m)
    for (let lag = 0; lag <= 3; lag++) {
      const [aH, mH] = shiftMois(anoPay, mesPay, -lag)

      const diasMes = hist.filter((j: any) => {
        const parts = j.date?.split('/')
        if (!parts || parts.length < 2) return false
        const me = parseInt(parts[1]) - 1
        const an = j.id ? new Date(parseInt(j.id)).getFullYear() : aH
        return me === mH && an === aH && ['TRAB', 'DEC', 'work', 'dec'].includes(j.type || '')
      })
      if (diasMes.length === 0) continue

      const totalSeg = diasMes.reduce((a: number, j: any) => a + (j.segServico || 0), 0)
      const totalH = totalSeg / 3600
      if (totalH < 1) continue

      const extra = Math.max(0, totalH - base.hbase)
      const brut = totalH <= base.hbase
        ? totalH * base.hval
        : base.hbase * base.hval + Math.min(extra, base.lim25) * base.h25 + Math.max(0, extra - base.lim25) * base.h50
      const salLiq = brut * base.liquidRate

      // Frais do mês correspondente (usa flag actual)
      const [aF, mF] = mesFraisTrabalhoDe(m, base)
      const fraisCalc = calcFraisMesPorHorarios(hist, aF, mF, base)
      const frais = fraisCalc.total > 0 ? fraisCalc.total : (m.fraisBoletim || 0)

      const totalEstimado = salLiq + frais
      if (totalEstimado > 100) {
        const errRel = Math.abs(totalEstimado - m.montantTotalRecu) / m.montantTotalRecu
        erros[lag].push(errRel)
      }
    }
  }

  // Escolhe o lag com menor erro médio, mas só contraria o default com confirmações suficientes.
  let melhorLag = DEF_SAL.hlag, melhorErr = Infinity, melhorCount = 0
  for (let lag = 0; lag <= 3; lag++) {
    if (erros[lag].length < 2) continue
    const med = erros[lag].reduce((a, b) => a + b, 0) / erros[lag].length
    if (med < melhorErr) { melhorErr = med; melhorLag = lag; melhorCount = erros[lag].length }
  }
  return defasagemProtegida(melhorLag, melhorCount, DEF_SAL.hlag)
}

const diffMeses = (anoA: number, mesA: number, anoB: number, mesB: number) =>
  (anoA - anoB) * 12 + (mesA - mesB)

const moneyMatches = (a: number, b: number) =>
  a > 0 && b > 0 && Math.abs(a - b) <= 0.5

const isLagValide = (lag: number) => lag >= 0 && lag <= 3

const moisLabelToIndex = (label: string) => MOIS_NOMS.indexOf(label)

function choisirVoteMajoritaire(votes: number[]): number | null {
  if (votes.length === 0) return null
  const counts: Record<number, number> = {}
  votes.forEach(v => { counts[v] = (counts[v] || 0) + 1 })
  return +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

const mesFicheDe = (d: MoisData): [number, number] => [
  d.anoFiche ?? d.annee,
  d.mesFicheIndex ?? d.moisIndex,
]

const mesPagamentoSalDe = (d: MoisData): [number, number] => [
  d.pagamentoSalAno ?? d.anoPagamento ?? d.annee,
  d.pagamentoSalMesIndex ?? d.mesPagamentoIndex ?? d.moisIndex,
]

const mesPagamentoFraisDe = (d: MoisData): [number, number] => [
  d.pagamentoFraisAno ?? d.anoPagamento ?? d.annee,
  d.pagamentoFraisMesIndex ?? d.mesPagamentoIndex ?? d.moisIndex,
]

function sourceScore(d: MoisData): number {
  let score = 0
  if ((d.fichePages || 0) <= 0) score += 10
  if ((d.salairebrut || 0) <= 0 && (d.totalHeures || 0) <= 0 && (d.hval || 0) <= 0) score += 1
  return score
}

function trouverSourceParValeur(
  dados: MoisData[],
  valeurConfirmee: number,
  anoPagamento: number,
  mesPagamento: number,
  valeursSource: (d: MoisData) => number[],
  apenasDocumentosCarregados = false,
): { source: MoisData; lag: number } | null {
  const candidats = dados
    .map(source => {
      if (apenasDocumentosCarregados && (source.fichePages || 0) <= 0) return null
      const [anoSource, mesSource] = mesFicheDe(source)
      const lag = diffMeses(anoPagamento, mesPagamento, anoSource, mesSource)
      if (!isLagValide(lag)) return null
      const diff = Math.min(...valeursSource(source).filter(v => v > 0).map(v => Math.abs(v - valeurConfirmee)))
      if (!Number.isFinite(diff) || !moneyMatches(valeurConfirmee, valeurConfirmee - diff)) return null
      return { source, lag, diff, score: sourceScore(source) }
    })
    .filter(Boolean) as { source: MoisData; lag: number; diff: number; score: number }[]

  if (candidats.length === 0) return null
  candidats.sort((a, b) => a.score - b.score || a.diff - b.diff || a.lag - b.lag)
  return { source: candidats[0].source, lag: candidats[0].lag }
}

function aprenderHlagPorConfirmacoes(dados: MoisData[]): number[] {
  return dados
    .filter(d => d.salarioConfirmado && (d.netPaye || 0) > 0)
    .map(d => {
      const [anoPay, mesPay] = mesPagamentoSalDe(d)
      const match = trouverSourceParValeur(dados, d.netPaye || 0, anoPay, mesPay, src => [src.netPaye || 0], true)
      return match?.lag
    })
    .filter((lag): lag is number => typeof lag === 'number')
}

function aprenderFlagPorConfirmacoes(dados: MoisData[]): number[] {
  return dados
    .filter(d => d.fraisConfirmado && fraisRealConfirme(d) > 0)
    .map(d => {
      const [anoPay, mesPay] = mesPagamentoFraisDe(d)
      const valor = fraisRealConfirme(d)
      const match = trouverSourceParValeur(dados, valor, anoPay, mesPay, src => [
        src.fraisRecuConfirme || 0,
        src.fraisBoletim || 0,
        src.remboursementFrais || 0,
      ], true)
      return match?.lag
    })
    .filter((lag): lag is number => typeof lag === 'number')
}

function aplicarConfirmacaoSalarioPorValor(
  dados: MoisData[],
  valor: number,
  anoPagamento: number,
  mesPagamento: number,
  totalRecu: number,
  padraoAtual: Padrao,
  fallback: { entreprise: string; frais: number },
): MoisData[] {
  const match = trouverSourceParValeur(dados, valor, anoPagamento, mesPagamento, d => [d.netPaye || 0], true)
  const next = [...dados]
  if (match) {
    const [anoFiche, mesFiche] = mesFicheDe(match.source)
    const idx = next.findIndex(h => h === match.source)
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        netPaye: valor,
        montantTotalRecu: totalRecu,
        salarioConfirmado: true,
        pagamentoSalMesIndex: mesPagamento,
        pagamentoSalAno: anoPagamento,
        mesTrabalhoIndex: mesFiche,
        anoTrabalho: anoFiche,
      }
      return next
    }
  }

  next.push({
    periode: `${MOIS_NOMS[mesPagamento]} ${anoPagamento}`,
    moisIndex: mesPagamento,
    annee: anoPagamento,
    fichePages: 0,
    netPaye: valor,
    salairebrut: Math.round(valor / padraoAtual.liquidRate),
    totalCotisations: 0,
    remboursementFrais: fallback.frais,
    fraisBoletim: fallback.frais,
    montantTotalRecu: totalRecu,
    jourPaiement1: padraoAtual.diaSalario,
    jourPaiement2: padraoAtual.diaFrais,
    analysedAt: new Date().toISOString(),
    entreprise: fallback.entreprise,
    conducteur: '',
    salarioConfirmado: true,
    pagamentoSalMesIndex: mesPagamento,
    pagamentoSalAno: anoPagamento,
  })
  return next
}

function aplicarConfirmacaoFraisPorValor(
  dados: MoisData[],
  valor: number,
  anoPagamento: number,
  mesPagamento: number,
  padraoAtual: Padrao,
  fallback: { periode: string; moisIndex: number; annee: number; entreprise: string },
): MoisData[] {
  const match = trouverSourceParValeur(dados, valor, anoPagamento, mesPagamento, d => [
    d.fraisRecuConfirme || 0,
    d.fraisBoletim || 0,
    d.remboursementFrais || 0,
  ], true)
  const next = [...dados]
  if (match) {
    const [anoFiche, mesFiche] = mesFicheDe(match.source)
    const idx = next.findIndex(h => h === match.source)
    if (idx >= 0) {
      const netPaye = next[idx].netPaye || 0
      next[idx] = {
        ...next[idx],
        fraisRecuConfirme: valor,
        fraisConfirmado: true,
        montantTotalRecu: netPaye > 0 ? netPaye + valor : next[idx].montantTotalRecu,
        pagamentoFraisMesIndex: mesPagamento,
        pagamentoFraisAno: anoPagamento,
        mesFraisTrabalhoIndex: mesFiche,
        anoFraisTrabalho: anoFiche,
      }
      return next
    }
  }

  next.push({
    periode: fallback.periode,
    moisIndex: fallback.moisIndex,
    annee: fallback.annee,
    fichePages: 0,
    netPaye: 0,
    salairebrut: 0,
    totalCotisations: 0,
    remboursementFrais: 0,
    fraisBoletim: 0,
    fraisRecuConfirme: valor,
    montantTotalRecu: 0,
    jourPaiement1: padraoAtual.diaSalario,
    jourPaiement2: padraoAtual.diaFrais,
    analysedAt: new Date().toISOString(),
    entreprise: fallback.entreprise,
    conducteur: '',
    fraisConfirmado: true,
    pagamentoFraisMesIndex: mesPagamento,
    pagamentoFraisAno: anoPagamento,
  })
  return next
}

const mesTrabalhoDe = (d: MoisData, p: Padrao): [number, number] => {
  if (d.anoTrabalho != null && d.mesTrabalhoIndex != null) return [d.anoTrabalho, d.mesTrabalhoIndex]
  const [anoPay, mesPay] = mesPagamentoSalDe(d)
  return shiftMois(anoPay, mesPay, -p.hlag)
}

const mesFraisTrabalhoDe = (d: MoisData, p: Padrao): [number, number] => {
  if (d.anoFraisTrabalho != null && d.mesFraisTrabalhoIndex != null) return [d.anoFraisTrabalho, d.mesFraisTrabalhoIndex]
  const [anoPay, mesPay] = mesPagamentoFraisDe(d)
  return shiftMois(anoPay, mesPay, -p.flag)
}

const contaParaSalarioAprendizagem = (d: MoisData) =>
  d.salarioConfirmado || (d.netPaye || 0) > 0 || (d.salairebrut || 0) > 0

const totalPrimesExceptionnelles = (d: any) =>
  (d?.interessement || 0) +
  (d?.primeExceptionnelle || 0) +
  (d?.participationSalariale || 0) +
  (d?.autresPrimes || 0)

const netPayeRecurrent = (d: Pick<MoisData, 'netPaye'> | any) => Math.max(0, d?.netPaye || 0)

const montantTotalRecuFiche = (d: any) =>
  netPayeRecurrent(d) + totalPrimesExceptionnelles(d) + (d?.remboursementFrais || 0)

const contaParaFraisAprendizagem = (d: MoisData) =>
  d.fraisConfirmado || fraisRealConfirme(d) > 0 || (d.fraisBoletim || 0) > 0 || (d.remboursementFrais || 0) > 0

function diasCalendarioMes(hist: any[], ano: number, mes: number) {
  return hist.filter((j: any) => {
    const parts = j.date?.split('/')
    if (!parts || parts.length < 2) return false
    const m = parseInt(parts[1]) - 1
    const a = j.id ? new Date(parseInt(j.id)).getFullYear() : ano
    return m === mes && a === ano
  })
}

function horasTrabalhoDias(dias: any[]): number {
  return dias
    .filter((j: any) => ['TRAB', 'DEC', 'work', 'dec'].includes(j.type || ''))
    .reduce((a: number, j: any) => a + (j.segServico || 0), 0) / 3600
}

function brutoCalendarioComFiche(totalH: number, fiche: MoisData, p: Padrao): number {
  const extra = Math.max(0, totalH - p.hbase)
  const brutoHoras = totalH <= p.hbase
    ? totalH * p.hval
    : p.hbase * p.hval + Math.min(extra, p.lim25) * p.h25 + Math.max(0, extra - p.lim25) * p.h50

  const conges = (fiche.montantConges || 0) > 0
    ? fiche.montantConges || 0
    : (fiche.joursConges || 0) * (p.valorDiaConges > 0 ? p.valorDiaConges : (p.hbase / 22) * p.hval)
  const feries = (fiche.montantFeries || 0) > 0
    ? fiche.montantFeries || 0
    : (fiche.joursFeries || 0) * (p.valorDiaFerie > 0 ? p.valorDiaFerie : (p.hbase / 22) * p.hval)
  const rc = (fiche.montantRC || 0) > 0
    ? fiche.montantRC || 0
    : (fiche.joursRC || 0) * (p.valorDiaRC > 0 ? p.valorDiaRC : (p.hbase / 22) * p.hval)

  return brutoHoras + conges + feries + rc
}

function calcFraisTotalComRegles(hist: any[], ano: number, mes: number, p: Padrao, regles: any): number {
  return calcFraisMesPorHorarios(hist, ano, mes, { ...p, regles: sanitizeFraisRegles(regles) }).total
}

function melhorarReglesFraisReais(dados: MoisData[], hist: any[], base: Padrao): Padrao {
  const alvos = dados
    .map(d => ({ d, valor: fraisRealConfirme(d) || d.fraisBoletim || 0 }))
    .filter(x => x.valor > 50)
  if (alvos.length === 0 || hist.length === 0) return base

  const atuais = sanitizeFraisRegles(base.regles)
  const candidatosPt = Array.from(new Set([atuais.ptDejAte, 5, 5.5, 6, 6.5, 7, 8]))
  const candidatosDej = Array.from(new Set([atuais.dejMinAmp, 4, 5, 6.017, 7, 8]))
  const candidatosDin = Array.from(new Set([atuais.dinerDe, 18, 19, 20, 21.25, 22, 23]))

  const score = (regles: any) => {
    const diffs: number[] = []
    for (const { d, valor } of alvos) {
      const [aF, mF] = mesFraisTrabalhoDe(d, base)
      const calc = calcFraisTotalComRegles(hist, aF, mF, base, regles)
      if (calc > 0) diffs.push(Math.abs(calc - valor))
    }
    return diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : Infinity
  }

  let melhor = atuais
  let melhorScore = score(atuais)
  for (const ptDejAte of candidatosPt) {
    for (const dejMinAmp of candidatosDej) {
      for (const dinerDe of candidatosDin) {
        const regles = sanitizeFraisRegles({ ptDejAte, dejMinAmp, dinerDe })
        const s = score(regles)
        if (s < melhorScore) { melhorScore = s; melhor = regles }
      }
    }
  }

  const ganho = score(atuais) - melhorScore
  if (ganho >= 20 || (alvos.length >= 2 && ganho >= 8)) {
    return { ...base, regles: melhor, fraisFactorReal: 1 }
  }
  return { ...base, regles: atuais }
}

function aplicarConfirmacoesReais(dados: MoisData[], hist: any[], base: Padrao): Padrao {
  const next: Padrao = { ...base }
  const confirmadosSal = dados.filter(d => contaParaSalarioAprendizagem(d) && ((d.netPaye || 0) > 0 || (d.salairebrut || 0) > 0))
  const confirmadosFrais = dados.filter(d => contaParaFraisAprendizagem(d))

  const hlagDiretos = aprenderHlagPorConfirmacoes(dados)
  const hlagDireto = votoMaisForte(hlagDiretos)
  if (hlagDireto !== null) {
    next.hlag = defasagemProtegida(hlagDireto.valor, hlagDireto.count, DEF_SAL.hlag)
  } else {
    const hlagVotos: number[] = []
    for (const fiche of confirmadosSal) {
      const [anoPay, mesPay] = mesPagamentoSalDe(fiche)
      let melhorLag = -1
      let melhorScore = Infinity

      for (let lag = 0; lag <= 3; lag++) {
        const [aH, mH] = shiftMois(anoPay, mesPay, -lag)
        const dias = diasCalendarioMes(hist, aH, mH)
        const totalH = horasTrabalhoDias(dias)
        if (dias.length === 0 || totalH <= 0) continue

        const brutoEst = brutoCalendarioComFiche(totalH, fiche, next)
        const scoreBruto = fiche.salairebrut > 0
          ? Math.abs(brutoEst - fiche.salairebrut) / fiche.salairebrut
          : fiche.netPaye > 0
            ? Math.abs(brutoEst * next.liquidRate - fiche.netPaye) / fiche.netPaye
            : 0
        const scoreHoras = fiche.totalHeures && fiche.totalHeures > 0
          ? Math.abs(totalH - fiche.totalHeures) / fiche.totalHeures
          : 0
        const score = scoreBruto + scoreHoras * 0.35
        if (score < melhorScore) { melhorScore = score; melhorLag = lag }
      }

      if (melhorLag >= 0) hlagVotos.push(melhorLag)
    }

    if (hlagVotos.length > 0) {
      const voto = votoMaisForte(hlagVotos)
      if (voto) next.hlag = defasagemProtegida(voto.valor, voto.count, DEF_SAL.hlag)
    }
  }

  const flagDiretos = aprenderFlagPorConfirmacoes(dados)
  const flagDireto = votoMaisForte(flagDiretos)
  if (flagDireto !== null) {
    next.flag = defasagemProtegida(flagDireto.valor, flagDireto.count, DEF_SAL.flag)
  } else {
    const flagVotos: number[] = []
    for (const fiche of confirmadosFrais) {
      const valorConfirmado = fraisRealConfirme(fiche) || fiche.fraisBoletim || fiche.remboursementFrais || 0
      const [anoPay, mesPay] = mesPagamentoFraisDe(fiche)
      let melhorFlag = -1
      let melhorDiff = Infinity

      for (const fonte of dados) {
        const valoresFonte = [fonte.remboursementFrais || 0, fonte.fraisBoletim || 0].filter(v => v > 0)
        const [anoFonte, mesFonte] = mesFicheDe(fonte)
        for (const valorFonte of valoresFonte) {
          const diff = Math.abs(valorFonte - valorConfirmado)
          const lag = diffMeses(anoPay, mesPay, anoFonte, mesFonte)
          if (isLagValide(lag) && diff <= Math.max(5, valorConfirmado * 0.02) && diff < melhorDiff) {
            melhorDiff = diff
            melhorFlag = lag
          }
        }
      }

      for (let flag = 0; flag <= 3; flag++) {
        const [aF, mF] = shiftMois(anoPay, mesPay, -flag)
        const fraisCalc = calcFraisMesPorHorarios(hist, aF, mF, next).total
        if (fraisCalc <= 0) continue
        const diff = Math.abs(fraisCalc - valorConfirmado)
        if (diff < melhorDiff) { melhorDiff = diff; melhorFlag = flag }
      }

      const tolerancia = Math.max(20, valorConfirmado * 0.08)
      if (melhorFlag >= 0 && melhorDiff <= tolerancia) flagVotos.push(melhorFlag)
    }

    if (flagVotos.length > 0) {
      const voto = votoMaisForte(flagVotos)
      if (voto) next.flag = defasagemProtegida(voto.valor, voto.count, DEF_SAL.flag)
    }
  }

  return next
}

function diagnosticarDadosFaltantes(dados: MoisData[], hist: any[], p: Padrao): string[] {
  const faltas: string[] = []
  const salConf = dados.filter(d => d.salarioConfirmado && d.netPaye > 0)
  const fraisConf = dados.filter(d => d.fraisConfirmado && fraisRealConfirme(d) > 0)
  if (salConf.length < 3) faltas.push(`faltam ${3 - salConf.length} salário(s) confirmado(s) para fechar o hlag`)
  if (fraisConf.length < 3) faltas.push(`faltam ${3 - fraisConf.length} frais confirmado(s) para fechar o flag`)

  for (const fiche of salConf.slice(-3)) {
    const anoPay = fiche.pagamentoSalAno ?? fiche.annee
    const mesPay = fiche.pagamentoSalMesIndex ?? fiche.moisIndex
    const [aH, mH] = shiftMois(anoPay, mesPay, -p.hlag)
    if (diasCalendarioMes(hist, aH, mH).length === 0) {
      faltas.push(`falta calendário de ${MOIS_NOMS[mH]} ${aH}`)
      break
    }
  }

  if (dados.some(d => (d.joursRC || 0) > 0) && p.valorDiaRC === 0) {
    faltas.push('falta valor RC na fiche para aprender valorDiaRC com precisão')
  }

  return faltas
}

function alertasFraisIncoerentes(dados: MoisData[], hist: any[], p: Padrao): string[] {
  const confirmados = dados.filter(d => d.salarioConfirmado || d.fraisConfirmado || d.montantTotalRecu > 0).length
  if (confirmados < 3) return []

  return dados
    .filter(d => (d.fraisBoletim || 0) > 0)
    .map(d => {
      const esperado = calcFraisMesPorHorarios(hist, d.annee, d.moisIndex, p).total
      const pago = d.fraisBoletim || 0
      const diff = Math.round((esperado - pago) * 100) / 100
      const tolerancia = Math.max(5, esperado * 0.02)
      if (esperado <= 0 || diff <= tolerancia) return null
      return `Este mês esperava ${esperado.toFixed(2)}€ de frais mas o boletim diz ${pago.toFixed(2)}€ — diferença de ${diff.toFixed(2)}€. Verifica se todos os dias foram pagos correctamente.`
    })
    .filter(Boolean) as string[]
}

// ── ANALISAR PADRÃO V2 ────────────────────────────────────────────────────────

function analisarPadraoV2(dados: MoisData[], hist: any[], padrao: Padrao): Padrao {
  const base: Padrao = { ...padrao }
  if (dados.length < 1) return base

  // A. Dias de pagamento
  const diasSal = dados.filter(d => d.jourPaiement1 > 0).map(d => d.jourPaiement1)
  const diasFrais = dados.filter(d => d.jourPaiement2 > 0).map(d => d.jourPaiement2)
  if (diasSal.length > 0)
    base.diaSalario = Math.round(diasSal.reduce((a, b) => a + b, 0) / diasSal.length)
  if (diasFrais.length > 0)
    base.diaFrais = Math.round(diasFrais.reduce((a, b) => a + b, 0) / diasFrais.length)

  // B. LiquidRate real — prefere meses sem férias (bruto mais limpo)
  const comSalarioAprendizagem = dados.filter(d => contaParaSalarioAprendizagem(d))
  const comBruto = comSalarioAprendizagem.filter(d => d.salairebrut > 0 && netPayeRecurrent(d) > 0)
  const comBrutoOuNet = comSalarioAprendizagem.filter(d => (d.salairebrut || 0) > 0 || (d.netPaye || 0) > 0)
  if (comBruto.length > 0) {
    const semFerias = comBruto.filter(d => (d.joursConges || 0) === 0 && (d.joursFeries || 0) === 0)
    const fonte = semFerias.length >= 2 ? semFerias : comBruto
    const taxa = fonte.reduce((a, d) => a + netPayeRecurrent(d) / d.salairebrut, 0) / fonte.length
    base.liquidRate = Math.round(taxa * 1000) / 1000
  }

  // C. Coeficientes salariais reais extraídos das fiches
  // Se a IA extraiu directamente da fiche — confiança máxima, substitui defaults
  const comCoef = dados.filter(d => (d.hval || 0) > 0)
  if (comCoef.length > 0) {
    // Média dos coeficientes (devem ser iguais entre fiches da mesma empresa)
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
    const hbases = comCoef.map(d => d.hbase || 0).filter(v => v > 0)
    const hvals  = comCoef.map(d => d.hval  || 0).filter(v => v > 0)
    const h25s   = comCoef.map(d => d.h25   || 0).filter(v => v > 0)
    const lim25s = comCoef.map(d => d.lim25 || 0).filter(v => v > 0)
    const h50s   = comCoef.map(d => d.h50   || 0).filter(v => v > 0)
    if (hbases.length > 0) base.hbase = Math.round(avg(hbases) * 100) / 100
    if (hvals.length  > 0) base.hval  = Math.round(avg(hvals)  * 1000) / 1000
    if (h25s.length   > 0) base.h25   = Math.round(avg(h25s)   * 1000) / 1000
    if (lim25s.length > 0) base.lim25 = Math.round(avg(lim25s) * 100) / 100
    if (h50s.length   > 0) base.h50   = Math.round(avg(h50s)   * 1000) / 1000
  }

  // D. Valor por dia de férias — directo da fiche se a IA extraiu
  const comConges = dados.filter(d => (d.joursConges || 0) > 0 && (d.montantConges || 0) > 0)
  const comFeries = dados.filter(d => (d.joursFeries || 0) > 0 && (d.montantFeries || 0) > 0)
  const comRC = dados.filter(d => (d.joursRC || 0) > 0 && (d.montantRC || 0) > 0)

  if (comConges.length > 0) {
    const vals = comConges.map(d => (d.montantConges || 0) / (d.joursConges || 1))
    base.valorDiaConges = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100
  } else if (comBrutoOuNet.length >= 3 && hist.length > 0) {
    // Fallback: aprende por diferença entre meses — precisa de variação
    const aprendizagens: number[] = []
    for (const fiche of comBrutoOuNet) {
      const joursConges = fiche.joursConges || 0
      if (joursConges === 0) continue
      const [aH, mH] = mesTrabalhoDe(fiche, base)
      const diasMes = hist.filter((j: any) => {
        const parts = j.date?.split('/')
        if (!parts || parts.length < 2) return false
        const m = parseInt(parts[1]) - 1
        const a = j.id ? new Date(parseInt(j.id)).getFullYear() : aH
        return m === mH && a === aH && ['work', 'dec', 'TRAB', 'DEC'].includes(j.type || 'TRAB')
      })
      if (diasMes.length === 0) continue
      const totalSeg = diasMes.reduce((a: number, j: any) => a + (j.segServico || 0), 0)
      const totalH = totalSeg / 3600
      const extra = Math.max(0, totalH - base.hbase)
      const brutSemConges = totalH <= base.hbase
        ? totalH * base.hval
        : base.hbase * base.hval + Math.min(extra, base.lim25) * base.h25 + Math.max(0, extra - base.lim25) * base.h50
      const brutoRef = fiche.salairebrut > 0 ? fiche.salairebrut : (fiche.netPaye || 0) / base.liquidRate
      const brutConges = brutoRef - brutSemConges
      if (brutConges > 0) aprendizagens.push(brutConges / joursConges)
    }
    if (aprendizagens.length > 0)
      base.valorDiaConges = Math.round(aprendizagens.reduce((a, b) => a + b, 0) / aprendizagens.length * 100) / 100
  }

  if (comFeries.length > 0) {
    const vals = comFeries.map(d => (d.montantFeries || 0) / (d.joursFeries || 1))
    base.valorDiaFerie = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100
  }

  if (comRC.length > 0) {
    const vals = comRC.map(d => (d.montantRC || 0) / (d.joursRC || 1))
    base.valorDiaRC = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100
  }

  // E. Detectar hlag automaticamente (com ≥2 fiches + horários)
  if (comBrutoOuNet.length >= 2 && hist.length > 0) {
    const lagsTestados: number[] = []
    for (const fiche of comBrutoOuNet) {
      const [anoPay, mesPay] = mesPagamentoSalDe(fiche)
      let melhorLag = base.hlag, melhorDiff = Infinity
      for (let lag = 0; lag <= 3; lag++) {
        const [aH, mH] = shiftMois(anoPay, mesPay, -lag)
        const diasMes = hist.filter((j: any) => {
          const parts = j.date?.split('/')
          if (!parts || parts.length < 2) return false
          const m = parseInt(parts[1]) - 1
          const a = j.id ? new Date(parseInt(j.id)).getFullYear() : aH
          return m === mH && a === aH && ['work', 'dec', 'TRAB', 'DEC'].includes(j.type || 'TRAB')
        })
        if (diasMes.length === 0) continue
        const totalSeg = diasMes.reduce((a: number, j: any) => a + (j.segServico || 0), 0)
        const totalH = totalSeg / 3600
        const joursConges = fiche.joursConges || 0
        const valorConges = base.valorDiaConges > 0 ? base.valorDiaConges * joursConges : 0
        const extra = Math.max(0, totalH - base.hbase)
        const brutEst = (totalH <= base.hbase
          ? totalH * base.hval
          : base.hbase * base.hval + Math.min(extra, base.lim25) * base.h25 + Math.max(0, extra - base.lim25) * base.h50
        ) + valorConges
        const brutoRef = fiche.salairebrut > 0 ? fiche.salairebrut : (fiche.netPaye || 0) / base.liquidRate
        const diff = Math.abs(brutEst - brutoRef)
        if (diff < melhorDiff) { melhorDiff = diff; melhorLag = lag }
      }
      lagsTestados.push(melhorLag)
    }
    if (lagsTestados.length > 0) {
      const voto = votoMaisForte(lagsTestados)
      if (voto) base.hlag = defasagemProtegida(voto.valor, voto.count, DEF_SAL.hlag)
    }
  }

  // F. Detectar flag automaticamente
  // Método 1 (prioritário): matching directo synthèse↔fiche por valor — não depende do histórico
  // Para cada fiche com frais, procura a synthèse com totalFrais mais próximo e calcula o lag
  const fichasComFrais = dados.filter(d => contaParaFraisAprendizagem(d))
  const sintesesCom = dados.filter(d => (d.fraisBoletim || 0) > 0)
  const fichasComRefPaye = dados.filter(d => (d.remboursementFrais || 0) > 0)

  const flagsDiretos: number[] = []
  // Cross-match: remboursementFrais da fiche vs fraisBoletim da synthèse
  for (const fiche of fichasComRefPaye) {
    const fraisRef = fiche.remboursementFrais
    const [anoFiche, mesFiche] = mesFicheDe(fiche)
    let melhorFlag = -1, melhorDiff = Infinity
    for (const sint of sintesesCom) {
      const [anoSint, mesSint] = mesFicheDe(sint)
      const diff = Math.abs(sint.fraisBoletim - fraisRef)
      if (diff < melhorDiff && diff < fraisRef * 0.02) { // tolerância 2%
        melhorDiff = diff
        let lag = diffMeses(anoFiche, mesFiche, anoSint, mesSint)
        if (lag >= 0 && lag <= 3) melhorFlag = lag
      }
    }
    if (melhorFlag >= 0) flagsDiretos.push(melhorFlag)
  }

  if (flagsDiretos.length > 0) {
    // Método directo funcionou — usa este resultado com alta confiança
    const voto = votoMaisForte(flagsDiretos)
    if (voto) base.flag = defasagemProtegida(voto.valor, voto.count, DEF_SAL.flag)
  } else if (fichasComFrais.length >= 1 && hist.length > 0) {
    // Método 2 (fallback): recalcular frais pelo histórico
    const flagsTestados: number[] = []
    for (const fiche of fichasComFrais) {
      const fraisRef = fiche.fraisBoletim > 0 ? fiche.fraisBoletim : fiche.remboursementFrais
      const [anoPay, mesPay] = mesPagamentoFraisDe(fiche)
      let melhorFlag = base.flag, melhorDiff = Infinity
      for (let flag = 0; flag <= 3; flag++) {
        const [aF, mF] = shiftMois(anoPay, mesPay, -flag)
        const fraisCalc = calcFraisMesPorHorarios(hist, aF, mF, base)
        if (fraisCalc.total === 0) continue
        const diff = Math.abs(fraisCalc.total - fraisRef)
        if (diff < melhorDiff) { melhorDiff = diff; melhorFlag = flag }
      }
      flagsTestados.push(melhorFlag)
    }
    if (flagsTestados.length > 0) {
      const voto = votoMaisForte(flagsTestados)
      if (voto) base.flag = defasagemProtegida(voto.valor, voto.count, DEF_SAL.flag)
    }
  }

  const real = aplicarConfirmacoesReais(dados, hist, base)
  Object.assign(base, real)
  Object.assign(base, melhorarReglesFraisReais(dados, hist, base))

  // G. HorasExtrasMedia (fallback quando não temos valorDiaConges)
  if (base.valorDiaConges === 0) {
    const aprendizagens: number[] = []
    for (const fiche of comBrutoOuNet) {
      const [aH, mH] = mesTrabalhoDe(fiche, base)
      const diasMes = hist.filter((j: any) => {
        const parts = j.date?.split('/')
        if (!parts || parts.length < 2) return false
        const m = parseInt(parts[1]) - 1
        const a = j.id ? new Date(parseInt(j.id)).getFullYear() : aH
        return m === mH && a === aH && ['work', 'dec', 'TRAB', 'DEC'].includes(j.type || 'TRAB')
      })
      if (diasMes.length === 0) continue
      const totalSeg = diasMes.reduce((a: number, j: any) => a + (j.segServico || 0), 0)
      const totalH = totalSeg / 3600
      const extra = Math.max(0, totalH - base.hbase)
      const brutCalculado = totalH <= base.hbase
        ? totalH * base.hval
        : base.hbase * base.hval + Math.min(extra, base.lim25) * base.h25 + Math.max(0, extra - base.lim25) * base.h50
      const brutoRef = fiche.salairebrut > 0 ? fiche.salairebrut : (fiche.netPaye || 0) / base.liquidRate
      const diffH = (brutoRef - brutCalculado) / base.hval
      if (diffH > 0 && diffH < 60) aprendizagens.push(diffH)
    }
    if (aprendizagens.length > 0)
      base.horasExtrasMedia = Math.round(aprendizagens.reduce((a, b) => a + b, 0) / aprendizagens.length * 10) / 10
  }

  // H. Taxa horária neta efectiva — aprende de meses com salário confirmado
  // Usa netPaye recorrente: intéressement e primes exceptionnelles ficam fora da taxa base.
  const mesesComSalReal = dados.filter(d => contaParaSalarioAprendizagem(d) && netPayeRecurrent(d) > 0 && d.montantTotalRecu > 0)
  if (mesesComSalReal.length >= 2 && hist.length > 0) {
    const taxas: number[] = []
    for (const m of mesesComSalReal) {
      const [aH, mH] = mesTrabalhoDe(m, base)
      const todosDiasMes = hist.filter((j: any) => {
        const parts = j.date?.split('/')
        if (!parts || parts.length < 2) return false
        const me = parseInt(parts[1]) - 1
        const an = j.id ? new Date(parseInt(j.id)).getFullYear() : aH
        return me === mH && an === aH
      })
      const diasTrab = todosDiasMes.filter((j: any) => ['TRAB', 'DEC', 'work', 'dec'].includes(j.type || ''))
      if (diasTrab.length === 0) continue
      const totalSeg = diasTrab.reduce((a: number, j: any) => a + (j.segServico || 0), 0)
      const totalH = totalSeg / 3600
      if (totalH < 10) continue
      // Normalizar: subtrair pay de congés/fériés antes de dividir pelas horas
      // Evita que meses com muitos congés inflacionem a taxa por hora
      const nConges = todosDiasMes.filter((j: any) => ['FERIE', 'vac'].includes(j.type || '')).length
      const nFeries = todosDiasMes.filter((j: any) => ['FER', 'FERIADO', 'hol'].includes(j.type || '')).length
      const nRC = todosDiasMes.filter((j: any) => j.type === 'RC').length
      const valCongeNet = (base.valorDiaConges > 0 ? base.valorDiaConges : (base.hbase / 22) * base.hval) * base.liquidRate
      const valFerieNet = (base.valorDiaFerie > 0 ? base.valorDiaFerie : (base.hbase / 22) * base.hval) * base.liquidRate
      const valRCNet = (base.valorDiaRC > 0 ? base.valorDiaRC : (base.hbase / 22) * base.hval) * base.liquidRate
      const netNormalizado = netPayeRecurrent(m) - nConges * valCongeNet - nFeries * valFerieNet - nRC * valRCNet
      if (netNormalizado < 100) continue // skip if result is unreasonable
      taxas.push(netNormalizado / totalH)
    }
    if (taxas.length >= 2) {
      base.taxaHorariaNetaMedia = Math.round(
        taxas.reduce((a, b) => a + b, 0) / taxas.length * 100
      ) / 100
    }
  }

  // I. Factor de correcção de frais — aprende da diferença boletim vs cálculo
  // Quando o utilizador carrega fiches com fraisBoletim real, aprendemos o ratio
  const mesesComFraisBoletim = dados.filter(d => contaParaFraisAprendizagem(d))
  if (mesesComFraisBoletim.length >= 2 && hist.length > 0) {
    const ratios: number[] = []
    for (const m of mesesComFraisBoletim) {
      const [aF, mF] = mesFraisTrabalhoDe(m, base)
      const fraisCalc = calcFraisMesPorHorarios(hist, aF, mF, base)
      const fraisReal = fraisRealConfirme(m) || m.fraisBoletim || 0
      const diff = Math.abs(fraisReal - fraisCalc.total)
      if (fraisCalc.total > 50 && fraisReal > 50 && diff > Math.max(20, fraisReal * 0.08)) {
        ratios.push(fraisReal / fraisCalc.total)
      }
    }
    if (ratios.length >= 2) {
      // Remover outliers extremos (> 2x ou < 0.3x)
      const filtered = ratios.filter(r => r > 0.3 && r < 2.0)
      if (filtered.length >= 1) {
        base.fraisFactorReal = Math.round(
          filtered.reduce((a, b) => a + b, 0) / filtered.length * 1000
        ) / 1000
      }
    }
  }

  base.descoberto = dados.filter(d => contaParaSalarioAprendizagem(d) || contaParaFraisAprendizagem(d) || d.montantTotalRecu > 0).length >= 3 || dados.length >= 2
  base.confianca = calcularPrecisao(base, dados.length)
  return base
}

export default function MonSalaireScreen() {
  const { themeSombre } = useTheme()
  const [historique, setHistorique] = useState<MoisData[]>([])
  const [padrao, setPadrao] = useState<Padrao>({
    descoberto: false, diaSalario: 5, diaFrais: 10, defasagemFrais: 3, confianca: 0,
    horasExtrasMedia: 0, taxaHorariaNetaMedia: 0, fraisFactorReal: 0,
    ptd: 4.42, dej: 16.36, din: 23.94, nui: 23.94,
    valorDiaConges: 0, valorDiaFerie: 0, valorDiaRC: 0,
    ...DEF_SAL
  })
  const [showModalEdit, setShowModalEdit] = useState(false)
  const [editNetPaye, setEditNetPaye] = useState('')
  const [editFraisBoletim, setEditFraisBoletim] = useState('')
  const [editMontantTotal, setEditMontantTotal] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPrevision, setShowPrevision] = useState(false)
  const [countingVal, setCountingVal] = useState(0)
  const [modalDetail, setModalDetail] = useState<MoisData | null>(null)
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [documentosAnalisados, setDocumentosAnalisados] = useState<DocumentoAnalysado[]>([])
  const [showPerguntas, setShowPerguntas] = useState(false)
  const [perguntaAtual, setPerguntaAtual] = useState(0)
  const [respostas, setRespostas] = useState<any[]>([])
  const [inputValor, setInputValor] = useState('')
  const [inputDiaSal, setInputDiaSal] = useState('')
  const [inputDiaFrais, setInputDiaFrais] = useState('')
  const [showEscolhaModal, setShowEscolhaModal] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [showModalErro, setShowModalErro] = useState(false)
  const [modalErroMsg, setModalErroMsg] = useState('')
  const [showModalDocs, setShowModalDocs] = useState(false)
  const [modalDocsFiches, setModalDocsFiches] = useState<string[]>([])
  const [modalDocsFrais, setModalDocsFrais] = useState<string[]>([])
  const [modalDocsFaltando, setModalDocsFaltando] = useState<string[]>([])
  const [modalDocsTodos, setModalDocsTodos] = useState<DocumentoAnalysado[]>([])
  const [showModalValorInvalido, setShowModalValorInvalido] = useState(false)
  const [showModalSucesso, setShowModalSucesso] = useState(false)
  const [modalSucessoMsg, setModalSucessoMsg] = useState('')
  const [showModalCancelar, setShowModalCancelar] = useState(false)
  const [showModalFraisReel, setShowModalFraisReel] = useState(false)
  const [showModalSalNet, setShowModalSalNet] = useState(false)
  const [inputSalNet, setInputSalNet] = useState('')
  const [inputFraisReel, setInputFraisReel] = useState('')
  const [inputMontantFraisQ, setInputMontantFraisQ] = useState('')
  const [inputMontantSalQ, setInputMontantSalQ] = useState('')
  const [showVerifDetalhes, setShowVerifDetalhes] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const breathAnim = useRef(new Animated.Value(1)).current
  const pulseAnim = useRef(new Animated.Value(1)).current
  const countRef = useRef<any>(null)

  const c = {
    bg: themeSombre ? '#0f1117' : '#f0f2f8',
    card: themeSombre ? '#181c27' : '#ffffff',
    cardBorder: themeSombre ? '#2a3045' : '#d0d5e8',
    text: themeSombre ? '#eef0f5' : '#1a1f35',
    textSub: themeSombre ? '#6b7394' : '#555e80',
    textLabel: themeSombre ? '#6b7394' : '#3a4060',
    input: themeSombre ? '#1f2436' : '#f0f2f8',
  }

  const [histCal, setHistCal] = useState<any[]>([])

  const limparFraisReglesAoArrancar = async () => {
    try {
      const fraisReglesRaw = await AsyncStorage.getItem('frais_regles')
      if (!fraisReglesRaw) return sanitizeFraisRegles({})
      const reglesAtuais = JSON.parse(fraisReglesRaw)
      const reglesLimpas = sanitizeFraisRegles(reglesAtuais)
      if (JSON.stringify(reglesAtuais) !== JSON.stringify(reglesLimpas)) {
        await AsyncStorage.setItem('frais_regles', JSON.stringify(reglesLimpas))
      }
      return reglesLimpas
    } catch (e) {
      const reglesLimpas = sanitizeFraisRegles({})
      await AsyncStorage.setItem('frais_regles', JSON.stringify(reglesLimpas))
      return reglesLimpas
    }
  }

  useEffect(() => { charger() }, [])

  const charger = async () => {
    try {
      const data = await AsyncStorage.getItem('monSalaire_v2')
      const pData = await AsyncStorage.getItem('monSalaire_padrao')
      const cal = JSON.parse(await AsyncStorage.getItem('historique') || '[]')
      setHistCal(cal)
      const reglesLimpas = await limparFraisReglesAoArrancar()
      if (data) {
        const hist = JSON.parse(data)
        setHistorique(hist)
        // Sempre re-analisa com o algoritmo actual para apanhar melhorias de detecção
        let base = pData ? { ...padrao, ...JSON.parse(pData) } : { ...padrao }
        // Salvaguarda: se hlag/flag ainda está no default de fábrica mas o método directo
        // já provou o valor correcto numa sessão anterior, não regredir.
        // (O guard ≥2 no analisarPadraoV2 trata disso — aqui só garantimos base limpa)
        base = { ...base, regles: reglesLimpas }
        const fraisValsRaw = await AsyncStorage.getItem('frais_valores')
        if (fraisValsRaw) {
          const fv = JSON.parse(fraisValsRaw)
          base = { ...base, ptd: fv.ptDej || base.ptd, dej: fv.dej || base.dej, din: fv.diner || base.din, nui: fv.nuit || base.nui }
        }
        // Valida hlag com totais confirmados — mais fiável que detecção por bruto estimado
        const hlagValidado = validarHlagComTotais(hist, cal, base)
        if (hlagValidado !== base.hlag) base = { ...base, hlag: hlagValidado }

        const p = analisarPadraoV2(hist, cal, base)
        setPadrao(p)
        await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(p))
      }
    } catch (e) { console.log('Erro:', e) }
  }

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await charger()
    } finally {
      setRefreshing(false)
    }
  }

  const carregarPadraoAtual = async (histSal: MoisData[], histDiario: any[]) => {
    const pData = await AsyncStorage.getItem('monSalaire_padrao')
    let atual: Padrao = pData ? { ...padrao, ...JSON.parse(pData) } : { ...padrao }
    const fraisReglesRaw = await AsyncStorage.getItem('frais_regles')
    const reglesLimpas = sanitizeFraisRegles(fraisReglesRaw ? JSON.parse(fraisReglesRaw) : atual.regles)
    if (fraisReglesRaw) await AsyncStorage.setItem('frais_regles', JSON.stringify(reglesLimpas))
    atual = { ...atual, regles: reglesLimpas }
    const fraisValsRaw = await AsyncStorage.getItem('frais_valores')
    if (fraisValsRaw) {
      const fv = JSON.parse(fraisValsRaw)
      atual = { ...atual, ptd: fv.ptDej || atual.ptd, dej: fv.dej || atual.dej, din: fv.diner || atual.din, nui: fv.nuit || atual.nui }
    }
    setPadrao(atual)
    await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(atual))
    return atual
  }

  // CÁLCULO PRINCIPAL
  const calcularSalario = async () => {
    try {
      const histData = await AsyncStorage.getItem('historique')
      if (!histData) {
        mostrarErro("Aucun historique trouvé.\nAjoute tes jours dans l'onglet Aujourd'hui ou le Calendrier.")
        return
      }
      const hist = JSON.parse(histData)
      const histSalData = await AsyncStorage.getItem('monSalaire_v2')
      const histSal: MoisData[] = histSalData ? JSON.parse(histSalData) : historique
      if (histSalData) setHistorique(histSal)
      const p = await carregarPadraoAtual(histSal, hist)
      const agora = new Date()
      const anoActual = agora.getFullYear()
      const mesActual = agora.getMonth()

      const [anoHoras, mesHoras] = shiftMois(anoActual, mesActual, -p.hlag)
      const [anoFrais, mesFrais] = shiftMois(anoActual, mesActual, -p.flag)
      const [anoReceber, mesReceber] = shiftMois(anoActual, mesActual, 0)
      const mesAberto = mesHoras === mesActual && anoHoras === anoActual

      // Dias trabalhados do mês das horas
      const diasHoras = hist.filter((j: any) => {
        const parts = j.date?.split('/')
        if (!parts || parts.length < 2) return false
        const m = parseInt(parts[1]) - 1
        const a = j.id ? new Date(parseInt(j.id)).getFullYear() : anoHoras
        return m === mesHoras && a === anoHoras && ['TRAB', 'DEC', 'work', 'dec'].includes(j.type)
      })

      if (diasHoras.length === 0) {
        mostrarErro(`Aucun jour trouvé pour ${MOIS_NOMS[mesHoras]} ${anoHoras}.\n\nAjoute tes jours via le Calendrier.`)
        return
      }

      const totalSeg = diasHoras.reduce((a: number, j: any) => a + (j.segServico || 0), 0)
      let totalH = totalSeg / 3600

      // Dias de férias, feriados e RC no mês das horas
      const diasConges = hist.filter((j: any) => {
        const parts = j.date?.split('/')
        if (!parts || parts.length < 2) return false
        const m = parseInt(parts[1]) - 1
        const a = j.id ? new Date(parseInt(j.id)).getFullYear() : anoHoras
        return m === mesHoras && a === anoHoras && ['FERIE', 'vac'].includes(j.type)
      })
      const diasFeries = hist.filter((j: any) => {
        const parts = j.date?.split('/')
        if (!parts || parts.length < 2) return false
        const m = parseInt(parts[1]) - 1
        const a = j.id ? new Date(parseInt(j.id)).getFullYear() : anoHoras
        return m === mesHoras && a === anoHoras && ['FER', 'FERIADO', 'hol'].includes(j.type)
      })
      const diasRC = hist.filter((j: any) => {
        const parts = j.date?.split('/')
        if (!parts || parts.length < 2) return false
        const m = parseInt(parts[1]) - 1
        const a = j.id ? new Date(parseInt(j.id)).getFullYear() : anoHoras
        return m === mesHoras && a === anoHoras && j.type === 'RC'
      })

      // Frais: pelos horários reais primeiro, fallback boletim
      const fraisHorario = calcFraisMesPorHorarios(hist, anoFrais, mesFrais, p)
      const fichesFrais = histSal.filter(f =>
        f.moisIndex === mesFrais && f.annee === anoFrais && ((f.fraisRecuConfirme || 0) > 0 || f.fraisBoletim > 0)
      )
      // Frais confirmado pelo utilizador tem prioridade sobre o cálculo automático
      const factorFrais = (p.fraisFactorReal || 0) > 0.1 ? p.fraisFactorReal : 1
      const totalFrais = fichesFrais.length > 0
        ? (fichesFrais[0].fraisRecuConfirme || fichesFrais[0].fraisBoletim)
        : fraisHorario.total > 0 ? Math.round(fraisHorario.total * factorFrais) : 0

      // Salário
      let salLiq = 0, salBrut = 0, hExtra25 = 0, hExtra50 = 0

      // Procura fiche do mês de RECEBIMENTO (não de trabalho)
      // ex: estimativa Maio → fiche Maio (se existir); se não existe → modo estimado
      const ficheReal = histSal.find(f =>
        f.moisIndex === mesReceber && f.annee === anoReceber && f.netPaye > 0
      )

      if (ficheReal && ficheReal.netPaye > 0) {
        // ✅ MODO PRECISO: usa net real da fiche
        salLiq = ficheReal.netPaye
        salBrut = ficheReal.salairebrut || salLiq / p.liquidRate
      } else {
        // 📊 MODO ESTIMADO
        if (totalH <= p.hbase) {
          salBrut = totalH * p.hval
        } else {
          const extra = totalH - p.hbase
          hExtra25 = Math.min(extra, p.lim25)
          hExtra50 = Math.max(0, extra - p.lim25)
          salBrut = p.hbase * p.hval + hExtra25 * p.h25 + hExtra50 * p.h50
        }

        if (p.taxaHorariaNetaMedia > 0) {
          // ✅ MODO CALIBRADO: taxa limpa (só horas normais) + dias especiais explícitos
          const valCongeNet = (p.valorDiaConges > 0 ? p.valorDiaConges : (p.hbase / 22) * p.hval) * p.liquidRate
          const valFerieNet = (p.valorDiaFerie > 0 ? p.valorDiaFerie : (p.hbase / 22) * p.hval) * p.liquidRate
          const valRCNet    = (p.valorDiaRC > 0 ? p.valorDiaRC : (p.hbase / 22) * p.hval) * p.liquidRate
          salLiq = Math.round(
            totalH * p.taxaHorariaNetaMedia
            + diasConges.length * valCongeNet
            + diasFeries.length * valFerieNet
            + diasRC.length    * valRCNet
          )
          salBrut = Math.round(salLiq / p.liquidRate)
        } else {
          // Fallback: fórmula clássica + férias do calendário
          const valorCongesDia = p.valorDiaConges > 0
            ? p.valorDiaConges : (p.hbase / 22) * p.hval
          const valorFeriesDia = p.valorDiaFerie > 0
            ? p.valorDiaFerie : (p.hbase / 22) * p.hval
          const valorRCDia = p.valorDiaRC > 0
            ? p.valorDiaRC : (p.hbase / 22) * p.hval
          salBrut += diasConges.length * valorCongesDia + diasFeries.length * valorFeriesDia + diasRC.length * valorRCDia
          if (p.valorDiaConges === 0) totalH = totalH + (p.horasExtrasMedia || 0)
          salLiq = salBrut * p.liquidRate
        }
      }

      const totalLiq = salLiq + totalFrais
      const empresa = histSal.length > 0 ? histSal[0].entreprise : ''

      // Precisão real: compara estimativas passadas vs valores confirmados
      const mesesComReal = histSal.filter(m => m.montantTotalRecu > 0)
      const acertosReais = mesesComReal.map(m => {
        const est = calcEstimativaMes(m)
        if (est === 0 || m.montantTotalRecu === 0) return null
        return 100 - Math.min(100, Math.abs(est - m.montantTotalRecu) / m.montantTotalRecu * 100)
      }).filter(v => v !== null) as number[]
      const precisao = acertosReais.length >= 2
        ? Math.round(acertosReais.reduce((a, b) => a + b, 0) / acertosReais.length)
        : calcularPrecisao(p, histSal.length)

      setCalcResult({
        totalH, totalFrais, salBrut, salLiq, totalLiq,
        jours: diasHoras.length,
        hExtra25, hExtra50,
        mesReceber: `${MOIS_NOMS[mesReceber]} ${anoReceber}`,
        diaReceber: p.diaSalario,
        diaFrais: p.diaFrais,
        empresa, precisao, mesAberto,
        mesHorasLabel: `${MOIS_NOMS[mesHoras]} ${anoHoras}`,
        mesFraisLabel: `${MOIS_NOMS[mesFrais]} ${anoFrais}`,
      })
      animarContagem(Math.round(totalLiq), mesAberto)
    } catch (e) {
      mostrarErro('Erreur: ' + String(e))
    }
  }

  // ── Calcula estimativa da app para um mês passado ─────────────────────────
  const calcEstimativaMes = (m: MoisData): number => {
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
    if (diasTrab.length === 0) return 0

    const totalSeg = diasTrab.reduce((a: number, j: any) => a + (j.segServico || 0), 0)
    const totalH   = totalSeg / 3600

    // Dias especiais (congé, fériés, RC) — idêntico ao calcularSalario
    const nConges = todosDoMes.filter((j: any) => ['FERIE', 'vac'].includes(j.type || '')).length
    const nFeries = todosDoMes.filter((j: any) => ['FER', 'FERIADO', 'hol'].includes(j.type || '')).length
    const nRC     = todosDoMes.filter((j: any) => j.type === 'RC').length

    const valCongeNet = (p.valorDiaConges > 0 ? p.valorDiaConges : (p.hbase / 22) * p.hval) * p.liquidRate
    const valFerieNet = (p.valorDiaFerie  > 0 ? p.valorDiaFerie  : (p.hbase / 22) * p.hval) * p.liquidRate
    const valRCNet    = (p.valorDiaRC > 0 ? p.valorDiaRC : (p.hbase / 22) * p.hval) * p.liquidRate

    // Salário — MODO CALIBRADO com dias especiais explícitos
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
      // 2ª prioridade: cálculo do calendário × factor de correcção aprendido
      const fraisCalc = calcFraisMesPorHorarios(histCal, aF, mF, p)
      const factor    = (p.fraisFactorReal || 0) > 0.1 ? p.fraisFactorReal : 1
      totalFrais = fraisCalc.total > 0
        ? Math.round(fraisCalc.total * factor)
        : (m.fraisBoletim || 0)
    }

    return Math.round(salLiq + totalFrais)
  }

  const animarRespiracao = () => {
    Animated.loop(Animated.sequence([
      Animated.timing(breathAnim, { toValue: 1.03, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathAnim, { toValue: 0.98, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathAnim, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start()
  }

  const animarPulse = () => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.04, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0.97, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start()
  }

  const animarContagem = (alvo: number, mesAberto: boolean) => {
    setCountingVal(0); setShowPrevision(true)
    const duracao = 2400, intervalo = 30, passos = duracao / intervalo
    let atual = 0
    countRef.current = setInterval(() => {
      atual += alvo / passos
      if (atual >= alvo) {
        atual = alvo; clearInterval(countRef.current)
        if (mesAberto) animarPulse()
        else animarRespiracao()
      }
      setCountingVal(Math.round(atual))
    }, intervalo)
  }

  const mostrarErro = (msg: string) => { setModalErroMsg(msg); setShowModalErro(true) }
  const fmtH = (h: number) => `${Math.floor(h)}h${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`
  const fmt = (val: number) => val > 0 ? `${val.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€` : '—'
  const fmtInt = (val: number) => `${Math.round(val).toLocaleString('fr-FR')}€`

  const importerDocumentos = () => setShowEscolhaModal(true)

  const importerImagens = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
      multiple: true,
    })
    if (result.canceled || !result.assets?.length) return
    setLoading(true)
    try {
      const content: any[] = []
      for (let i = 0; i < result.assets.length; i++) {
        const file = result.assets[i]
        const r2 = await fetch(file.uri)
        const blob = await r2.blob()
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.readAsDataURL(blob)
        })
        if (file.mimeType === 'application/pdf') {
          content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } })
        } else {
          content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } })
        }
        content.push({ type: 'text', text: `Document ${i + 1} de ${result.assets.length}.` })
      }
      content.push({ type: 'text', text: `Tu es un expert en bulletins de salaire français transport routier.

RÈGLE ABSOLUE: lis TOUTES les lignes de chaque fiche de paye, sans exception. Ne te limite jamais aux totaux. Inspecte chaque ligne individuelle: salaire de base, heures normales, heures supplémentaires, primes, avantages en nature, intéressement, participation, remboursements, retenues, cotisations et net à payer.

Réponds UNIQUEMENT avec un JSON array sans markdown, exactement sous cette forme:
[{"tipo":"fiche","periode":"Avril 2026","moisIndex":3,"annee":2026,"netPaye":0,"salairebrut":0,"totalCotisations":0,"interessement":0,"primeExceptionnelle":0,"participationSalariale":0,"autresPrimes":0,"remboursementFrais":0,"entreprise":"","conducteur":"","joursConges":0,"montantConges":0,"joursFeries":0,"montantFeries":0,"joursRC":0,"montantRC":0,"totalHeures":0,"hbase":0,"hval":0,"h25":0,"lim25":0,"h50":0}]

Définition stricte des champs salaire:
- netPaye: salaire NET RÉCURRENT / net à payer AVANT intéressement, participation, primes exceptionnelles, avantages exceptionnels et tout paiement non récurrent. Si la fiche affiche un net final qui inclut ces montants, SOUSTRAIS-les et mets ici seulement le net salaire récurrent.
- salairebrut: salaire brut de base/récurrent du bulletin, hors intéressement et primes exceptionnelles si elles sont affichées séparément.
- totalCotisations: total cotisations salariales.
- interessement: ligne intéressement versé, prime intéressement, ou versement équivalent (ex: 464.80). 0 si absent.
- primeExceptionnelle: prime exceptionnelle / prime non récurrente explicite. 0 si absent.
- participationSalariale: participation salariale / participation aux bénéfices. 0 si absent.
- autresPrimes: total de tout autre montant exceptionnel non récurrent qui ne doit PAS entrer dans netPaye (prime bilan, prime ponctuelle, avantage exceptionnel, régularisation exceptionnelle, etc.). 0 si absent.
- remboursementFrais: remboursement frais professionnels / frais de déplacement / indemnités non soumises si présent.

Définition des heures et coefficients:
- totalHeures: heures totales indiquées sur le bulletin.
- hbase: heures de base contractuelles (ex: 169h).
- hval: taux horaire de base en € (ex: 14.76).
- h25: taux horaire majoré 25% en € (ex: 18.45).
- lim25: nombre d'heures à 25% (ex: 17).
- h50: taux horaire majoré 50% en € (ex: 22.31).

Congés/absences:
- joursConges, montantConges, joursFeries, montantFeries, joursRC, montantRC: extrais les quantités et montants si les lignes existent.

Cherche explicitement toutes les lignes possibles: "Heures normales", "Heures supplémentaires 25%", "Heures supplémentaires 50%", "Intéressement", "Participation", "Prime exceptionnelle", "Avantage en nature", "Remboursement frais", "Frais professionnels", "Net à payer avant impôt", "Net payé".
Si une valeur n'existe pas sur le bulletin, mets 0. Ne fusionne jamais intéressement/participation/primes exceptionnelles dans netPaye.` })
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 3500, messages: [{ role: 'user', content }] })
      })
      const data = await response.json()
      if (!data.content?.[0]) { mostrarErro("Impossible d'analyser les documents."); setLoading(false); return }
      const docs: DocumentoAnalysado[] = JSON.parse(data.content[0].text.replace(/```json|```/g, '').trim())
      processarDocumentos(docs)
    } catch (e) { mostrarErro("Erreur d'analyse. Essaie avec des fichiers plus nets.") }
    setLoading(false)
  }

  const importerPdfs = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: true })
      if (result.canceled) return
      setLoading(true)
      const content: any[] = []
      for (let i = 0; i < result.assets.length; i++) {
        const file = result.assets[i]
        const r2 = await fetch(file.uri)
        const blob = await r2.blob()
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.readAsDataURL(blob)
        })
        if (file.mimeType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } })
        else content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } })
        content.push({ type: 'text', text: `Document ${i + 1} de ${result.assets.length}.` })
      }
      content.push({ type: 'text', text: `Tu es un expert en transport routier français. Analyse TOUS ces boletins de frais. Réponds UNIQUEMENT avec un JSON array:\n[{"tipo":"frais","periode":"Février 2026","moisIndex":1,"annee":2026,"entreprise":"","conducteur":"","totalJours":0,"totalKms":0,"decouches":0,"ptDejCount":0,"ptDejValeur":0,"dejCount":0,"dejValeur":0,"dinerCount":0,"dinerValeur":0,"nuitCount":0,"nuitValeur":0,"totalFrais":0,"regles":{"ptDejAte":null,"dejMinAmp":null,"dinerDe":null}},...]\n\nPour le champ "regles", extrait les critères d'attribution si explicitement mentionnés dans le document (sinon laisse null):\n- ptDejAte: heure limite de début de service pour avoir droit au petit déjeuner (nombre décimal, ex: 6.5 pour 06h30)\n- dejMinAmp: amplitude minimale en heures pour avoir droit au déjeuner (ex: 6.017 pour 6h01)\n- dinerDe: heure minimale de fin de service pour avoir droit au dîner (ex: 21.25 pour 21h15)` })
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 3000, messages: [{ role: 'user', content }] })
      })
      const data = await response.json()
      if (!data.content?.[0]) { mostrarErro("Impossible d'analyser les documents."); setLoading(false); return }
      const docs: DocumentoAnalysado[] = JSON.parse(data.content[0].text.replace(/```json|```/g, '').trim())
      if (docs.length > 0) {
        const d = docs[0] as any
        if (d.ptDejValeur > 0 || d.dejValeur > 0) {
          const fraisVals = {
            ptDej: d.ptDejValeur || 4.42, dej: d.dejValeur || 16.36,
            diner: d.dinerValeur || 23.94, nuit: d.nuitValeur || 23.94,
          }
          await AsyncStorage.setItem('frais_valores', JSON.stringify(fraisVals))
          setPadrao(prev => ({
            ...prev,
            ptd: fraisVals.ptDej,
            dej: fraisVals.dej,
            din: fraisVals.diner,
            nui: fraisVals.nuit,
          }))
        }
        // Aprender as regras/limiares se o boletim as mencionar explicitamente
        if (d.regles) {
          const reglesActuais = sanitizeFraisRegles(JSON.parse(await AsyncStorage.getItem('frais_regles') || '{}'))
          const novasRegles = sanitizeFraisRegles(d.regles, reglesActuais)
          await AsyncStorage.setItem('frais_regles', JSON.stringify(novasRegles))
        }
      }
      processarDocumentos(docs)
    } catch (e) { mostrarErro(String(e)) }
    setLoading(false)
  }

  const importarEscaneado = async (uri: string) => {
    setShowScanner(false)
    setLoading(true)
    try {
      const r2 = await fetch(uri)
      const blob = await r2.blob()
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.readAsDataURL(blob)
      })
      const content: any[] = [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: 'Document 1 de 1.' },
      ]
      content.push({ type: 'text', text: `Tu es un expert en bulletins de salaire français transport routier.

RÈGLE ABSOLUE: lis TOUTES les lignes de chaque fiche de paye, sans exception. Ne te limite jamais aux totaux. Inspecte chaque ligne individuelle: salaire de base, heures normales, heures supplémentaires, primes, avantages en nature, intéressement, participation, remboursements, retenues, cotisations et net à payer.

Réponds UNIQUEMENT avec un JSON array sans markdown, exactement sous cette forme:
[{"tipo":"fiche","periode":"Avril 2026","moisIndex":3,"annee":2026,"netPaye":0,"salairebrut":0,"totalCotisations":0,"interessement":0,"primeExceptionnelle":0,"participationSalariale":0,"autresPrimes":0,"remboursementFrais":0,"entreprise":"","conducteur":"","joursConges":0,"montantConges":0,"joursFeries":0,"montantFeries":0,"joursRC":0,"montantRC":0,"totalHeures":0,"hbase":0,"hval":0,"h25":0,"lim25":0,"h50":0}]

Définition stricte des champs salaire:
- netPaye: salaire NET RÉCURRENT / net à payer AVANT intéressement, participation, primes exceptionnelles, avantages exceptionnels et tout paiement non récurrent. Si la fiche affiche un net final qui inclut ces montants, SOUSTRAIS-les et mets ici seulement le net salaire récurrent.
- salairebrut: salaire brut de base/récurrent du bulletin, hors intéressement et primes exceptionnelles si elles sont affichées séparément.
- totalCotisations: total cotisations salariales.
- interessement: ligne intéressement versé, prime intéressement, ou versement équivalent (ex: 464.80). 0 si absent.
- primeExceptionnelle: prime exceptionnelle / prime non récurrente explicite. 0 si absent.
- participationSalariale: participation salariale / participation aux bénéfices. 0 si absent.
- autresPrimes: total de tout autre montant exceptionnel non récurrent qui ne doit PAS entrer dans netPaye (prime bilan, prime ponctuelle, avantage exceptionnel, régularisation exceptionnelle, etc.). 0 si absent.
- remboursementFrais: remboursement frais professionnels / frais de déplacement / indemnités non soumises si présent.

Définition des heures et coefficients:
- totalHeures: heures totales indiquées sur le bulletin.
- hbase: heures de base contractuelles (ex: 169h).
- hval: taux horaire de base en € (ex: 14.76).
- h25: taux horaire majoré 25% en € (ex: 18.45).
- lim25: nombre d'heures à 25% (ex: 17).
- h50: taux horaire majoré 50% en € (ex: 22.31).

Congés/absences:
- joursConges, montantConges, joursFeries, montantFeries, joursRC, montantRC: extrais les quantités et montants si les lignes existent.

Cherche explicitement toutes les lignes possibles: "Heures normales", "Heures supplémentaires 25%", "Heures supplémentaires 50%", "Intéressement", "Participation", "Prime exceptionnelle", "Avantage en nature", "Remboursement frais", "Frais professionnels", "Net à payer avant impôt", "Net payé".
Si une valeur n'existe pas sur le bulletin, mets 0. Ne fusionne jamais intéressement/participation/primes exceptionnelles dans netPaye.` })
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 3500, messages: [{ role: 'user', content }] }),
      })
      const data = await response.json()
      if (!data.content?.[0]) { mostrarErro("Impossible d'analyser le document scanné."); setLoading(false); return }
      const docs: DocumentoAnalysado[] = JSON.parse(data.content[0].text.replace(/```json|```/g, '').trim())
      processarDocumentos(docs)
    } catch (e) { mostrarErro("Erreur d'analyse. Essaie avec une image plus nette.") }
    setLoading(false)
  }

  const processarDocumentos = (docs: DocumentoAnalysado[]) => {
    const todosDoc = [...documentosAnalisados, ...docs].filter((doc, index, self) =>
      index === self.findIndex(d => d.moisIndex === doc.moisIndex && d.annee === doc.annee && d.tipo === doc.tipo)
    )
    setDocumentosAnalisados(todosDoc)
    const fichesMeses = todosDoc.filter(d => d.tipo === 'fiche').map(d => d.periode)
    const fraisMeses = todosDoc.filter(d => d.tipo === 'frais').map(d => d.periode)
    const faltando: string[] = []
    if (fichesMeses.length < 2) faltando.push(`encore ${2 - fichesMeses.length} fiche(s) de paye`)
    if (fraisMeses.length < 1) faltando.push('au moins 1 boletim de frais')
    setModalDocsFiches(fichesMeses); setModalDocsFrais(fraisMeses)
    setModalDocsFaltando(faltando); setModalDocsTodos(todosDoc)
    setShowModalDocs(true)
  }

  const iniciarPerguntas = async (docs: DocumentoAnalysado[]) => {
    const fiches = docs.filter(d => d.tipo === 'fiche')
    if (fiches.length === 0) return
    const confirmados = historique.filter(h => h.salarioConfirmado || h.fraisConfirmado || h.montantTotalRecu > 0).length
    if (confirmados >= 3) {
      const fraisDoc = docs.filter(d => d.tipo === 'frais')
      const respostasAuto = fiches.map(f => {
        const pf = f.dados || f as any
        return {
          fiche: f,
          frais: fraisDoc.find(fr => fr.moisIndex === f.moisIndex && fr.annee === f.annee) || null,
          montantTotal: montantTotalRecuFiche(pf),
          montantSalReel: netPayeRecurrent(pf),
          montantFraisReel: pf?.remboursementFrais || 0,
          diaSalario: padrao.diaSalario,
          diaFrais: padrao.diaFrais,
          autoDetectado: true,
        }
      })
      const semValores = respostasAuto.filter(r => r.montantSalReel <= 0 && r.montantFraisReel <= 0)
      if (semValores.length > 0) {
        mostrarErro(`Faltam valores extraídos pela IA em ${semValores[0].fiche.periode}.\nCarrega uma fiche mais nítida ou confirma manualmente.`)
        return
      }
      await guardarTudo(respostasAuto)
      setDocumentosAnalisados([])
      return
    }
    setRespostas([]); setPerguntaAtual(0); setInputValor('')
    setInputDiaSal(String(padrao.diaSalario)); setInputDiaFrais(String(padrao.diaFrais))
    // Pré-preenche sal + frais da primeira fiche se a IA os extraiu
    const pf = fiches[0]?.dados || fiches[0] as any
    setInputMontantSalQ((pf?.netPaye || 0) > 0 ? String(pf.netPaye) : '')
    setInputMontantFraisQ((pf?.remboursementFrais || 0) > 0 ? String(pf.remboursementFrais) : '')
    setShowVerifDetalhes(false)
    setShowPerguntas(true)
  }

  const responderPergunta = async () => {
    const fiches = documentosAnalisados.filter(d => d.tipo === 'fiche')
    const fraisDoc = documentosAnalisados.filter(d => d.tipo === 'frais')
    const fichaActual = fiches[perguntaAtual]
    const sal = parseFloat(inputMontantSalQ.replace(',', '.')) || 0
    const fraisReel = parseFloat(inputMontantFraisQ.replace(',', '.')) || 0
    if (sal <= 0 && fraisReel <= 0) { setShowModalValorInvalido(true); return }
    const mesFicheIndex = fichaActual.moisIndex
    const anoFiche = fichaActual.annee
    const [anoTrabalho, mesTrabalhoIndex] = shiftMois(anoFiche, mesFicheIndex, -padrao.hlag)
    const [anoFraisTrabalho, mesFraisTrabalhoIndex] = shiftMois(anoFiche, mesFicheIndex, -padrao.flag)
    const novaResposta = {
      fiche: fichaActual,
      frais: fraisDoc.find(f => f.moisIndex === fichaActual.moisIndex && f.annee === fichaActual.annee) || null,
      montantTotal: sal + fraisReel,
      montantSalReel: sal,
      montantFraisReel: fraisReel,
      diaSalario: parseInt(inputDiaSal) || 5,
      diaFrais: parseInt(inputDiaFrais) || 10,
      pagamentoSalMesIndex: fichaActual.moisIndex,
      pagamentoSalAno: fichaActual.annee,
      pagamentoFraisMesIndex: fichaActual.moisIndex,
      pagamentoFraisAno: fichaActual.annee,
      mesFicheIndex,
      anoFiche,
      mesTrabalhoIndex,
      anoTrabalho,
      mesPagamentoIndex: fichaActual.moisIndex,
      anoPagamento: fichaActual.annee,
      mesFraisTrabalhoIndex,
      anoFraisTrabalho,
      autoDetectado: false,
    }
    const novasRespostas = [...respostas, novaResposta]
    setRespostas(novasRespostas)
    if (perguntaAtual < fiches.length - 1) {
      // Pré-preenche sal + frais para a próxima fiche
      const pf = fiches[perguntaAtual + 1]?.dados || fiches[perguntaAtual + 1] as any
      setInputMontantSalQ((pf?.netPaye || 0) > 0 ? String(pf.netPaye) : '')
      setInputMontantFraisQ((pf?.remboursementFrais || 0) > 0 ? String(pf.remboursementFrais) : '')
      setShowVerifDetalhes(false)
      setPerguntaAtual(perguntaAtual + 1)
    } else {
      await guardarTudo(novasRespostas); setShowPerguntas(false); setDocumentosAnalisados([])
    }
  }

  const guardarTudo = async (resps: any[]) => {
    const novoHist = [...historique]
    for (const resp of resps) {
      const fiche = resp.fiche.dados || resp.fiche
      const frais = resp.frais?.dados || resp.frais
      const periodeLabel = resp.fiche.periode || `${MOIS_NOMS[resp.fiche.moisIndex]} ${resp.fiche.annee}`
      const existenteIdx = novoHist.findIndex(h => h.periode === periodeLabel)
      const fraisRecebido = resp.montantFraisReel > 0 ? resp.montantFraisReel : 0
      const fraisFiche = fiche.remboursementFrais || 0
      const mesFicheIndex = resp.mesFicheIndex ?? resp.fiche.moisIndex ?? 0
      const anoFiche = resp.anoFiche ?? resp.fiche.annee ?? new Date().getFullYear()
      const [anoTrabalhoCalc, mesTrabalhoCalc] = shiftMois(anoFiche, mesFicheIndex, -padrao.hlag)
      const [anoFraisTrabalhoCalc, mesFraisTrabalhoCalc] = shiftMois(anoFiche, mesFicheIndex, -padrao.flag)
      const fonte = resp.autoDetectado ? 'ia' : 'confirmado'
      const novoDado: MoisData = {
        periode: periodeLabel, moisIndex: resp.fiche.moisIndex || 0,
        annee: resp.fiche.annee || new Date().getFullYear(), fichePages: 1,
        mesFicheIndex,
        anoFiche,
        mesTrabalhoIndex: resp.mesTrabalhoIndex ?? mesTrabalhoCalc,
        anoTrabalho: resp.anoTrabalho ?? anoTrabalhoCalc,
        mesPagamentoIndex: resp.mesPagamentoIndex ?? resp.pagamentoSalMesIndex ?? resp.fiche.moisIndex,
        anoPagamento: resp.anoPagamento ?? resp.pagamentoSalAno ?? resp.fiche.annee,
        mesFraisTrabalhoIndex: resp.mesFraisTrabalhoIndex ?? mesFraisTrabalhoCalc,
        anoFraisTrabalho: resp.anoFraisTrabalho ?? anoFraisTrabalhoCalc,
        fonte,
        confiancaAprendizagem: fonte === 'ia' ? 0.65 : 1,
        netPaye: resp.montantSalReel > 0 ? resp.montantSalReel : netPayeRecurrent(fiche),
        salairebrut: fiche.salairebrut || 0,
        totalCotisations: fiche.totalCotisations || 0,
        remboursementFrais: fraisFiche,
        fraisBoletim: frais?.totalFrais > 0 ? frais.totalFrais : 0,
        interessement: fiche.interessement || 0,
        primeExceptionnelle: fiche.primeExceptionnelle || 0,
        participationSalariale: fiche.participationSalariale || 0,
        autresPrimes: fiche.autresPrimes || 0,
        fraisRecuConfirme: fraisRecebido,
        montantTotalRecu: resp.montantTotal,
        jourPaiement1: resp.diaSalario, jourPaiement2: resp.diaFrais,
        analysedAt: new Date().toISOString(), entreprise: fiche.entreprise || '', conducteur: fiche.conducteur || '',
        salarioConfirmado: !resp.autoDetectado && resp.montantSalReel > 0,
        fraisConfirmado: !resp.autoDetectado && fraisRecebido > 0,
        pagamentoSalMesIndex: resp.pagamentoSalMesIndex ?? resp.fiche.moisIndex,
        pagamentoSalAno: resp.pagamentoSalAno ?? resp.fiche.annee,
        pagamentoFraisMesIndex: resp.pagamentoFraisMesIndex ?? resp.fiche.moisIndex,
        pagamentoFraisAno: resp.pagamentoFraisAno ?? resp.fiche.annee,
        // Campos novos das fiches
        joursConges: fiche.joursConges || 0, montantConges: fiche.montantConges || 0,
        joursFeries: fiche.joursFeries || 0, montantFeries: fiche.montantFeries || 0,
        joursRC: fiche.joursRC || 0, montantRC: fiche.montantRC || 0, totalHeures: fiche.totalHeures || 0,
        // Coeficientes salariais reais
        hbase: fiche.hbase || 0, hval: fiche.hval || 0,
        h25: fiche.h25 || 0, lim25: fiche.lim25 || 0, h50: fiche.h50 || 0,
      }
      if (existenteIdx >= 0) novoHist[existenteIdx] = novoDado; else novoHist.push(novoDado)
    }
    novoHist.sort((a, b) => a.annee !== b.annee ? a.annee - b.annee : a.moisIndex - b.moisIndex)
    setHistorique(novoHist)
    await AsyncStorage.setItem('monSalaire_v2', JSON.stringify(novoHist))

    // Analisar padrão com horários do calendário
    const histCal = JSON.parse(await AsyncStorage.getItem('historique') || '[]')
    // Aplicar valores de frais dos boletins se existirem
    const fraisValsRaw = await AsyncStorage.getItem('frais_valores')
    const fraisReglesRaw = await AsyncStorage.getItem('frais_regles')
    let padraoBase = { ...padrao, hlag: DEF_SAL.hlag, flag: DEF_SAL.flag }
    if (fraisValsRaw) {
      const fv = JSON.parse(fraisValsRaw)
      padraoBase = { ...padraoBase, ptd: fv.ptDej || padraoBase.ptd, dej: fv.dej || padraoBase.dej, din: fv.diner || padraoBase.din, nui: fv.nuit || padraoBase.nui }
    }
    if (fraisReglesRaw) {
      const reglesLimpas = sanitizeFraisRegles(JSON.parse(fraisReglesRaw))
      await AsyncStorage.setItem('frais_regles', JSON.stringify(reglesLimpas))
      padraoBase = { ...padraoBase, regles: reglesLimpas }
    }
    const hlagValidado = validarHlagComTotais(novoHist, histCal, padraoBase)
    if (hlagValidado !== padraoBase.hlag) padraoBase = { ...padraoBase, hlag: hlagValidado }
    const novoPadrao = analisarPadraoV2(novoHist, histCal, padraoBase)
    setPadrao(novoPadrao)
    await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(novoPadrao))
    const faltas = diagnosticarDadosFaltantes(novoHist, histCal, novoPadrao)
    const alertasFrais = alertasFraisIncoerentes(novoHist, histCal, novoPadrao)
    const baseMsg = `${novoHist.length} mois enregistrés!\nhlag: ${novoPadrao.hlag} · flag: ${novoPadrao.flag} · Précision: ${novoPadrao.confianca}%`
    const msgAprendizagem = faltas.length > 0 ? `${baseMsg}\n\nFalta: ${faltas.join(' · ')}` : `${baseMsg}\n\nPadrão aprendido com dados confirmados.`
    setModalSucessoMsg(alertasFrais.length > 0 ? `${msgAprendizagem}\n\n⚠️ ${alertasFrais.join('\n\n⚠️ ')}` : msgAprendizagem)
    setShowModalSucesso(true)
  }

  const fiches = documentosAnalisados.filter(d => d.tipo === 'fiche')
  const fichaActual = fiches[perguntaAtual]
  const precisaoActual = calcularPrecisao(padrao, historique.length)

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: c.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#f5a623"
            colors={['#f5a623']}
          />
        }
      >
        <View style={st.header}>
          <Text style={[st.appName, { color: c.text }]}>TACHO<Text style={st.accent}>MAX</Text></Text>
          <View style={[st.badge, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
            <Text style={st.badgeText}>💰 MON SALAIRE</Text>
          </View>
        </View>

        {showPrevision && calcResult ? (
          <Animated.View style={[st.previsionCard, { transform: [{ scale: calcResult.mesAberto ? pulseAnim : breathAnim }] }]}>
            <Text style={st.previsionLabel}>ESTIMÉ {calcResult.mesReceber.toUpperCase()}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
              {calcResult.mesAberto && (
                <Text style={{ fontSize: 28, color: 'rgba(255,255,255,0.8)', fontWeight: '800', marginTop: 8, marginRight: 4 }}>≈</Text>
              )}
              <Text style={st.previsionMontant}>{countingVal.toLocaleString('fr-FR')}€</Text>
            </View>
            <Text style={st.previsionJour}>
              net · tout reçu avant le {calcResult.diaFrais} {calcResult.mesReceber.split(' ')[0]} 🎉
            </Text>
            {(() => {
              const hoje = new Date().getDate()
              const diasRestantes = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - hoje
              if (diasRestantes <= 10) {
                const proximoMes = MOIS_NOMS[(new Date().getMonth() + 1) % 12]
                return (
                  <View style={{ backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginTop: 8 }}>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', textAlign: 'center', fontWeight: '600' }}>
                      ⏳ Dans {diasRestantes} jour{diasRestantes > 1 ? 's' : ''} — estimation {proximoMes} disponible
                    </Text>
                  </View>
                )
              }
              return null
            })()}
            {calcResult.mesAberto && (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 10, padding: 8, marginTop: 10, marginBottom: 4 }}>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontWeight: '600' }}>Mois en cours · valeur provisoire</Text>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 2 }}>Ce montant augmentera avec tes heures restantes</Text>
              </View>
            )}
            <View style={{ width: '100%', height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 14 }} />
            {/* ── DOIS BLOCOS DE PAGAMENTO ── */}
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              {/* Salário — clicável para confirmar valor real */}
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'rgba(39,174,96,0.18)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: calcResult.salConfirmado ? '#27ae60' : 'rgba(39,174,96,0.35)' }}
                onPress={() => { setInputSalNet(calcResult.salLiq.toFixed(2)); setShowModalSalNet(true) }}
              >
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 }}>
                  💰 SALAIRE NET <Text style={{ fontSize: 9, opacity: 0.6 }}>{calcResult.salConfirmado ? '✅' : '✏️'}</Text>
                </Text>
                <Text style={{ fontSize: 22, color: 'white', fontWeight: '900', letterSpacing: 0.5 }}>{fmtInt(calcResult.salLiq)}</Text>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.62)', fontWeight: '600', marginTop: 3 }}>
                  Horas de {calcResult.mesHorasLabel}
                </Text>
                <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ backgroundColor: 'rgba(39,174,96,0.35)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, color: 'white', fontWeight: '800' }}>le {calcResult.diaReceber}</Text>
                  </View>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{calcResult.mesReceber.split(' ')[0]}</Text>
                </View>
              </TouchableOpacity>
              {/* Frais */}
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'rgba(41,128,185,0.18)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(41,128,185,0.35)' }}
                onPress={() => { setInputFraisReel(calcResult.totalFrais.toFixed(2)); setShowModalFraisReel(true) }}
              >
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 }}>🍽️ FRAIS <Text style={{ fontSize: 9, opacity: 0.6 }}>✏️</Text></Text>
                <Text style={{ fontSize: 22, color: 'white', fontWeight: '900', letterSpacing: 0.5 }}>{fmtInt(calcResult.totalFrais)}</Text>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.62)', fontWeight: '600', marginTop: 3 }}>
                  Frais de {calcResult.mesFraisLabel}
                </Text>
                <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ backgroundColor: 'rgba(41,128,185,0.35)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, color: 'white', fontWeight: '800' }}>le {calcResult.diaFrais}</Text>
                  </View>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{calcResult.mesFraisLabel}</Text>
                </View>
              </TouchableOpacity>
            </View>
            <View style={{ width: '100%', height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 12 }} />
            <View style={{ width: '100%', gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.80)' }}>Brut estimé</Text>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '700' }}>{fmtInt(calcResult.salBrut)}</Text>
              </View>
              {calcResult.hExtra25 > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>dont +25%: {fmtH(calcResult.hExtra25)}</Text>
                  {calcResult.hExtra50 > 0 && (
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>+50%: {fmtH(calcResult.hExtra50)}</Text>
                  )}
                </View>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{calcResult.jours} jours · {fmtH(calcResult.totalH)}</Text>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{Math.round(padrao.liquidRate * 100)}% net</Text>
              </View>
            </View>
            <View style={{ marginTop: 12, alignItems: 'center', gap: 4 }}>
              <Text style={st.previsionConfianca}>{calcResult.precisao}% de précision · {historique.length} mois de données</Text>
              {calcResult.empresa ? (
                <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)' }}>* basé sur ton historique · {calcResult.empresa}</Text>
              ) : (
                <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)' }}>* basé sur ton historique · pattern détecté</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => setShowPrevision(false)} style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>↩ Retour</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <TouchableOpacity style={st.calcularBtn} onPress={calcularSalario} disabled={loading}>
            <Text style={st.calcularIcon}>💰</Text>
            <Text style={st.calcularLabel}>CALCULER</Text>
            <Text style={st.calcularSub}>Combien tu vas recevoir ce mois</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <View style={{
          backgroundColor: precisaoActual >= 94 ? 'rgba(39,174,96,0.3)' : precisaoActual >= 85 ? 'rgba(243,156,18,0.3)' : precisaoActual >= 79 ? 'rgba(243,156,18,0.3)' : 'rgba(231,76,60,0.3)',
                borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3
              }}>
                <Text style={{ fontSize: 11, color: 'white', fontWeight: '700' }}>
                  {precisaoActual >= 94 ? '✅' : precisaoActual >= 85 ? '⚡' : precisaoActual >= 79 ? '⚡' : '🔴'} {precisaoActual}% de précision
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>· {historique.length} mois</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[st.uploadBtnGrande, { borderColor: '#f5a623', backgroundColor: c.card }]}
          onPress={importerDocumentos} disabled={loading}
        >
          {loading ? <ActivityIndicator color="#f5a623" size="large" /> : (
            <>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>📁</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#f5a623' }}>Charger les documents</Text>
              <Text style={{ fontSize: 12, color: c.textSub, marginTop: 4, textAlign: 'center' }}>
                Fiches de paye · Boletins de frais{'\n'}Charge tout ce que tu as — l'IA organise
              </Text>
            </>
          )}
        </TouchableOpacity>

        {historique.length > 0 && (() => {
          // Calcula precisão global apenas para meses com valor real confirmado
          const mesesComReal = historique.filter(m => m.montantTotalRecu > 0)
          const precisoes = mesesComReal.map(m => {
            const est = calcEstimativaMes(m)
            if (est === 0 || m.montantTotalRecu === 0) return null
            return 100 - Math.min(100, Math.abs(est - m.montantTotalRecu) / m.montantTotalRecu * 100)
          }).filter(v => v !== null) as number[]
          const precisaoGlobal = precisoes.length > 0
            ? Math.round(precisoes.reduce((a, b) => a + b, 0) / precisoes.length)
            : null

          return (
            <View style={{ marginTop: 16 }}>
              {/* ── BADGE GLOBAL DE PRECISÃO ── */}
              {precisaoGlobal !== null && (() => {
                  const pgColor = precisaoGlobal >= 95 ? '#27ae60' : precisaoGlobal >= 85 ? '#2ecc71' : precisaoGlobal >= 75 ? '#f5a623' : '#e74c3c'
                  const pgBg   = precisaoGlobal >= 95 ? 'rgba(39,174,96,0.15)' : precisaoGlobal >= 85 ? 'rgba(243,156,18,0.12)' : precisaoGlobal >= 75 ? 'rgba(245,166,35,0.15)' : 'rgba(231,76,60,0.15)'
                  const pgBdr  = precisaoGlobal >= 95 ? 'rgba(39,174,96,0.4)'  : precisaoGlobal >= 85 ? 'rgba(243,156,18,0.35)' : precisaoGlobal >= 75 ? 'rgba(245,166,35,0.4)'  : 'rgba(231,76,60,0.4)'
                  return (
                    <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: pgBdr }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <View>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: c.textLabel, letterSpacing: 1.2 }}>PRÉCISION DE L'APP</Text>
                          <Text style={{ fontSize: 11, color: c.textSub, marginTop: 2 }}>{mesesComReal.length} mois comparés · Estimé vs Réel</Text>
                        </View>
                        <View style={{ backgroundColor: pgBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: pgColor }}>
                          <Text style={{ fontSize: 24, fontWeight: '900', color: pgColor }}>{precisaoGlobal}%</Text>
                        </View>
                      </View>
                      {/* Barra de progresso até 100% */}
                      <View style={{ height: 8, backgroundColor: themeSombre ? '#1f2436' : '#e8eaf2', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                        <View style={{ height: '100%', width: `${precisaoGlobal}%` as any, backgroundColor: pgColor, borderRadius: 4 }} />
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600' }}>0%</Text>
                        <Text style={{ fontSize: 10, color: pgColor, fontWeight: '800' }}>
                          {precisaoGlobal >= 95 ? '🎯 Excellent !' : precisaoGlobal >= 85 ? `${100 - precisaoGlobal}% pour 100%` : `Objectif 100% — carrega mais fiches`}
                        </Text>
                        <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600' }}>100%</Text>
                      </View>
                      {/* Alerta proactivo — o que faz subir a precisão */}
                      {precisaoGlobal < 95 && (() => {
                        const semFiche = historique.filter(h => !h.netPaye || h.netPaye === 0)
                        const semReal  = historique.filter(h => !h.montantTotalRecu || h.montantTotalRecu === 0)
                        if (semFiche.length > 0) return (
                          <View style={{ marginTop: 10, backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)' }}>
                            <Text style={{ fontSize: 11, color: '#f5a623', fontWeight: '700' }}>
                              💡 Carrega a fiche de {semFiche[0].periode} → precisão sobe para ~{Math.min(99, precisaoGlobal + 8)}%
                            </Text>
                          </View>
                        )
                        if (semReal.length > 0) return (
                          <View style={{ marginTop: 10, backgroundColor: 'rgba(41,128,185,0.08)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(41,128,185,0.2)' }}>
                            <Text style={{ fontSize: 11, color: '#2980b9', fontWeight: '700' }}>
                              💡 Confirma o valor real de {semReal[0].periode} → app aprende e melhora automaticamente
                            </Text>
                          </View>
                        )
                        return null
                      })()}
                    </View>
                  )
                })()}

              <Text style={[st.histTitle, { color: c.textLabel }]}>HISTORIQUE</Text>

              {historique.slice().reverse().map((m, i) => {
                const estimativa = calcEstimativaMes(m)
                const temReal = m.montantTotalRecu > 0
                const delta = temReal && estimativa > 0 ? m.montantTotalRecu - estimativa : null
                const pctAcerto = delta !== null && estimativa > 0
                  ? Math.round(100 - Math.abs(delta) / m.montantTotalRecu * 100)
                  : null
                const deltaColor = delta === null ? c.textSub : Math.abs(delta) <= 30 ? '#27ae60' : Math.abs(delta) <= 100 ? '#f5a623' : '#e74c3c'

                return (
                  <Swipeable key={i} renderRightActions={() => (
                    <TouchableOpacity
                      style={{ backgroundColor: '#e74c3c', justifyContent: 'center', alignItems: 'center', width: 80, marginBottom: 8, borderRadius: 14, marginHorizontal: 4 }}
                      onPress={async () => {
                        const nova = historique.filter(h => h.periode !== m.periode)
                        setHistorique(nova)
                        await AsyncStorage.setItem('monSalaire_v2', JSON.stringify(nova))
                        const novoPadrao = analisarPadraoV2(nova, histCal, padrao)
                        setPadrao(novoPadrao)
                        await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(novoPadrao))
                      }}
                    >
                      <Text style={{ fontSize: 20 }}>🗑️</Text>
                      <Text style={{ fontSize: 10, color: 'white', fontWeight: '700', marginTop: 2 }}>Supprimer</Text>
                    </TouchableOpacity>
                  )}>
                    <TouchableOpacity style={[st.histCard, { backgroundColor: c.card, borderColor: c.cardBorder }]} onPress={() => setModalDetail(m)}>
                      <View style={{ flex: 1 }}>
                        <Text style={[st.histPeriode, { color: c.text }]}>{m.periode}</Text>
                        {/* Linha comparação */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          {estimativa > 0 && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600' }}>App</Text>
                              <Text style={{ fontSize: 11, fontWeight: '800', color: c.textSub }}>{Math.round(estimativa).toLocaleString('fr-FR')}€</Text>
                            </View>
                          )}
                          {estimativa > 0 && temReal && <Text style={{ fontSize: 10, color: c.cardBorder }}>→</Text>}
                          {temReal && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Text style={{ fontSize: 10, color: '#27ae60', fontWeight: '600' }}>Réel</Text>
                              <Text style={{ fontSize: 11, fontWeight: '800', color: '#27ae60' }}>{Math.round(m.montantTotalRecu).toLocaleString('fr-FR')}€</Text>
                            </View>
                          )}
                          {delta !== null && (
                            <View style={{ backgroundColor: Math.abs(delta) <= 30 ? 'rgba(39,174,96,0.12)' : Math.abs(delta) <= 100 ? 'rgba(245,166,35,0.12)' : 'rgba(231,76,60,0.12)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: '800', color: deltaColor }}>
                                {delta >= 0 ? '+' : ''}{Math.round(delta)}€
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                      {pctAcerto !== null ? (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 18, fontWeight: '900', color: pctAcerto >= 95 ? '#27ae60' : pctAcerto >= 85 ? '#f39c12' : pctAcerto >= 75 ? '#f5a623' : '#e74c3c' }}>{pctAcerto}%</Text>
                          <Text style={{ fontSize: 9, color: c.textSub, fontWeight: '600' }}>précision</Text>
                        </View>
                      ) : estimativa > 0 ? (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: c.textSub }}>{Math.round(estimativa).toLocaleString('fr-FR')}€</Text>
                          <Text style={{ fontSize: 9, color: c.textSub }}>estimé</Text>
                        </View>
                      ) : (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: '#27ae60' }}>{fmt(m.montantTotalRecu)}</Text>
                          <Text style={[st.histSub, { color: c.textSub }]}>reçu</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </Swipeable>
                )
              })}
            </View>
          )
        })()}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* MODAL ERRO */}
      <Modal visible={showModalErro} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 40 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: '#e74c3c' }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>❌</Text>
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#e74c3c', marginBottom: 8, textAlign: 'center' }}>Erreur</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', lineHeight: 20, marginBottom: 20 }}>{modalErroMsg}</Text>
            <TouchableOpacity style={{ backgroundColor: '#f5a623', borderRadius: 14, padding: 14, alignItems: 'center', width: '100%' }} onPress={() => setShowModalErro(false)}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL DOCUMENTOS */}
      <Modal visible={showModalDocs} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
            <View style={{ width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 16 }}>📊 Documents analysés</Text>
            <View style={{ backgroundColor: c.bg, borderRadius: 14, padding: 14, marginBottom: 12, gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: c.textLabel, letterSpacing: 1 }}>📄 FICHES DE PAYE</Text>
              {modalDocsFiches.length > 0
                ? modalDocsFiches.map((f, i) => <Text key={i} style={{ fontSize: 13, color: '#27ae60', fontWeight: '600' }}>✅ {f}</Text>)
                : <Text style={{ fontSize: 13, color: '#e74c3c' }}>Aucune fiche trouvée</Text>
              }
            </View>
            <View style={{ backgroundColor: c.bg, borderRadius: 14, padding: 14, marginBottom: 16, gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: c.textLabel, letterSpacing: 1 }}>🧾 BOLETINS DE FRAIS</Text>
              {modalDocsFrais.length > 0
                ? modalDocsFrais.map((f, i) => <Text key={i} style={{ fontSize: 13, color: '#2980b9', fontWeight: '600' }}>✅ {f}</Text>)
                : <Text style={{ fontSize: 13, color: '#e74c3c' }}>Aucun boletim trouvé</Text>
              }
            </View>
            {modalDocsFaltando.length > 0 ? (
              <View style={{ backgroundColor: 'rgba(243,156,18,0.1)', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#f39c12' }}>
                <Text style={{ fontSize: 12, color: '#f39c12', fontWeight: '700' }}>⚠️ Manque: {modalDocsFaltando.join(' · ')}</Text>
              </View>
            ) : (
              <View style={{ backgroundColor: 'rgba(39,174,96,0.1)', borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#27ae60' }}>
                <Text style={{ fontSize: 12, color: '#27ae60', fontWeight: '700' }}>✅ Données suffisantes!</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowModalDocs(false)}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.textSub }}>➕ Ajouter plus</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 14, padding: 14, alignItems: 'center' }} onPress={() => { setShowModalDocs(false); setTimeout(() => iniciarPerguntas(modalDocsTodos), 300) }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: 'white' }}>✅ Continuer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL VALOR INVALIDO */}
      <Modal visible={showModalValorInvalido} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 40 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: '#f39c12' }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>⚠️</Text>
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#f39c12', marginBottom: 8 }}>Valeur invalide</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 20 }}>Introduis le montant total reçu ce mois.</Text>
            <TouchableOpacity style={{ backgroundColor: '#f5a623', borderRadius: 14, padding: 14, alignItems: 'center', width: '100%' }} onPress={() => setShowModalValorInvalido(false)}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL SUCESSO */}
      <Modal visible={showModalSucesso} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 40 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: '#27ae60' }}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>✅</Text>
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#27ae60', marginBottom: 8 }}>Enregistré!</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', lineHeight: 20, marginBottom: 20 }}>{modalSucessoMsg}</Text>
            <TouchableOpacity style={{ backgroundColor: '#f5a623', borderRadius: 14, padding: 14, alignItems: 'center', width: '100%' }} onPress={() => setShowModalSucesso(false)}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL CANCELAR */}
      <Modal visible={showModalCancelar} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 40 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>⚠️</Text>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 8 }}>Annuler?</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 20 }}>Les données déjà saisies seront perdues.</Text>
            <TouchableOpacity style={{ backgroundColor: '#e74c3c', borderRadius: 14, padding: 14, alignItems: 'center', width: '100%', marginBottom: 10 }} onPress={() => { setShowModalCancelar(false); setShowPerguntas(false); setDocumentosAnalisados([]) }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>Annuler quand même</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ borderRadius: 14, padding: 14, alignItems: 'center', width: '100%', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowModalCancelar(false)}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Continuer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL PERGUNTAS */}
      <Modal visible={showPerguntas} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: '#f5a623' }}>
            {fichaActual && (() => {
              const dadosFicha = (fichaActual.dados || fichaActual) as any
              const verif = buildVerificacaoCruzada(fichaActual, dadosFicha, padrao, histCal, historique)
              const temDiff = temDiferencasVerif(verif)
              const mesLabel = MESES_PT[fichaActual.moisIndex] || fichaActual.periode
              const diaSal = perguntaAtual === 0 ? (inputDiaSal || String(padrao.diaSalario)) : String(padrao.diaSalario)
              const diaFrais = perguntaAtual === 0 ? (inputDiaFrais || String(padrao.diaFrais)) : String(padrao.diaFrais)

              return (
                <>
                  {fiches.length > 1 && (
                    <Text style={{ fontSize: 11, color: c.textSub, textAlign: 'right', marginBottom: 8 }}>
                      {perguntaAtual + 1}/{fiches.length}
                    </Text>
                  )}

                  {temDiff && (
                    <View style={{ marginBottom: 16, padding: 14, backgroundColor: 'rgba(243,156,18,0.10)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(243,156,18,0.35)' }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: c.text, lineHeight: 22, marginBottom: 12 }}>
                        ⚠️ Encontrei diferenças entre a fiche e os meus cálculos. Usar os valores da fiche?
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: '#27ae60', borderRadius: 12, padding: 12, alignItems: 'center' }}
                          onPress={() => {
                            if (verif.salario.fiche > 0) setInputMontantSalQ(String(verif.salario.fiche))
                            if (verif.frais.fiche > 0) setInputMontantFraisQ(String(verif.frais.fiche))
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '800', color: 'white' }}>✅ Sim, usar fiche</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: c.card, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}
                          onPress={() => {
                            if (verif.salario.app > 0) setInputMontantSalQ(String(Math.round(verif.salario.app)))
                            if (verif.frais.app > 0) setInputMontantFraisQ(String(verif.frais.app))
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>❌ Não, os meus</Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity onPress={() => setShowVerifDetalhes(v => !v)} style={{ alignItems: 'center', paddingVertical: 4 }}>
                        <Text style={{ fontSize: 12, color: c.textSub, textDecorationLine: 'underline' }}>
                          {showVerifDetalhes ? 'Ocultar detalhes' : 'Ver detalhes'}
                        </Text>
                      </TouchableOpacity>
                      {showVerifDetalhes && (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(243,156,18,0.25)' }}>
                          <Text style={{ fontSize: 12, color: c.textSub, marginBottom: 4 }}>
                            💰 Salário — fiche {Math.round(verif.salario.fiche)}€ · app {Math.round(verif.salario.app)}€
                          </Text>
                          <Text style={{ fontSize: 12, color: c.textSub, marginBottom: 4 }}>
                            🍽️ Frais — fiche {verif.frais.fiche.toFixed(2)}€ · app {verif.frais.app.toFixed(2)}€
                          </Text>
                          <Text style={{ fontSize: 12, color: c.textSub }}>
                            ⏱ Horas — fiche {verif.horas.fiche.toFixed(1)}h · calendário {verif.horas.app.toFixed(1)}h
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 20, lineHeight: 28 }}>
                    Em {mesLabel} {fichaActual.annee}, quanto recebeste?
                  </Text>

                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8 }}>
                        💰 Dia {diaSal} — salário?
                      </Text>
                      <TextInput
                        style={{ backgroundColor: c.input, borderRadius: 12, padding: 14, fontSize: 22, fontWeight: '800', color: '#27ae60', borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }}
                        value={inputMontantSalQ}
                        onChangeText={setInputMontantSalQ}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={c.textSub}
                        autoFocus={!temDiff}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8 }}>
                        🍽️ Dia {diaFrais} — frais?
                      </Text>
                      <TextInput
                        style={{ backgroundColor: c.input, borderRadius: 12, padding: 14, fontSize: 22, fontWeight: '800', color: '#2980b9', borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }}
                        value={inputMontantFraisQ}
                        onChangeText={setInputMontantFraisQ}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={c.textSub}
                      />
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      style={{ padding: 14, alignItems: 'center' }}
                      onPress={() => {
                        if (perguntaAtual > 0) {
                          setPerguntaAtual(perguntaAtual - 1)
                          setRespostas(respostas.slice(0, -1))
                          setShowVerifDetalhes(false)
                        } else {
                          setShowModalCancelar(true)
                        }
                      }}
                    >
                      <Text style={{ fontSize: 14, color: c.textSub }}>{perguntaAtual > 0 ? '←' : 'Cancelar'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, backgroundColor: '#f5a623', borderRadius: 14, padding: 16, alignItems: 'center' }}
                      onPress={responderPergunta}
                    >
                      <Text style={{ fontSize: 16, fontWeight: '800', color: 'white' }}>
                        {perguntaAtual < fiches.length - 1 ? 'Seguinte →' : 'Guardar'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )
            })()}
          </View>
        </View>
      </Modal>

      {/* MODAL DETALHE */}
      <Modal visible={!!modalDetail} transparent animationType="slide">
        <TouchableOpacity activeOpacity={1} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }} onPress={() => setModalDetail(null)}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: c.cardBorder }} onPress={() => {}}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 4, textAlign: 'center' }}>📄 {modalDetail?.periode}</Text>
            <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 16 }}>{modalDetail?.entreprise} · {modalDetail?.conducteur}</Text>
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.textSub, fontSize: 13 }}>Salaire brut</Text>
                <Text style={{ color: '#f5a623', fontWeight: '700', fontSize: 13 }}>{fmt(modalDetail?.salairebrut || 0)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.textSub, fontSize: 13 }}>Net payé récurrent</Text>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>{fmt(modalDetail?.netPaye || 0)}</Text>
              </View>
              {totalPrimesExceptionnelles(modalDetail) > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: c.textSub, fontSize: 13 }}>Primes non récurrentes</Text>
                  <Text style={{ color: '#9b59b6', fontWeight: '700', fontSize: 13 }}>{fmt(totalPrimesExceptionnelles(modalDetail))}</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.textSub, fontSize: 13 }}>Frais boletim</Text>
                <Text style={{ color: '#2980b9', fontWeight: '700', fontSize: 13 }}>{fmt(modalDetail?.fraisBoletim || 0)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: c.cardBorder }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>Total reçu</Text>
                <Text style={{ color: '#27ae60', fontWeight: '800', fontSize: 17 }}>{fmt(modalDetail?.montantTotalRecu || 0)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.textSub, fontSize: 12 }}>Jour salaire · Jour frais</Text>
                <Text style={{ color: '#f5a623', fontWeight: '700', fontSize: 12 }}>Jour {modalDetail?.jourPaiement1} · Jour {modalDetail?.jourPaiement2}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => {
                if (!modalDetail) return
                setEditNetPaye(String(modalDetail.netPaye))
                setEditFraisBoletim(String(modalDetail.fraisBoletim))
                setEditMontantTotal(String(modalDetail.montantTotalRecu))
                setShowModalEdit(true)
              }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>✏️ Modifier</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: '#f5a623', borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={() => setModalDetail(null)}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* MODAL ESCOLHA */}
      <Modal visible={showEscolhaModal} transparent animationType="slide">
        <TouchableOpacity activeOpacity={1} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }} onPress={() => setShowEscolhaModal(false)}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder }} onPress={() => {}}>
            <View style={{ width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ fontSize: 22, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 6 }}>📁 Charger les documents</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 24 }}>Quel type de documents veux-tu charger?</Text>
            <TouchableOpacity style={{ backgroundColor: 'rgba(245,166,35,0.1)', borderWidth: 1.5, borderColor: '#f5a623', borderRadius: 16, padding: 18, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14 }} onPress={() => { setShowEscolhaModal(false); setTimeout(() => importerImagens(), 300) }}>
              <Text style={{ fontSize: 28 }}>📄</Text>
              <View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#f5a623' }}>Fiches de paye</Text>
                <Text style={{ fontSize: 14, color: c.textSub, marginTop: 2 }}>JPG · PNG · PDF · jusqu'à 10 fichiers</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={{ backgroundColor: 'rgba(41,128,185,0.1)', borderWidth: 1.5, borderColor: '#2980b9', borderRadius: 16, padding: 18, marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 14 }} onPress={() => { setShowEscolhaModal(false); setTimeout(() => importerPdfs(), 300) }}>
              <Text style={{ fontSize: 28 }}>🧾</Text>
              <View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#2980b9' }}>Boletins de frais</Text>
                <Text style={{ fontSize: 14, color: c.textSub, marginTop: 2 }}>PDF · IMG · jusqu'à 5 fichiers</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={{ backgroundColor: 'rgba(39,174,96,0.1)', borderWidth: 1.5, borderColor: '#27ae60', borderRadius: 16, padding: 18, marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 14 }} onPress={() => { setShowEscolhaModal(false); setTimeout(() => setShowScanner(true), 300) }}>
              <Text style={{ fontSize: 28 }}>📷</Text>
              <View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#27ae60' }}>Scanner un document</Text>
                <Text style={{ fontSize: 14, color: c.textSub, marginTop: 2 }}>Prend une photo avec la caméra</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={{ borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowEscolhaModal(false)}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textSub }}>Annuler</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* MODAL SCANNER */}
      <Modal visible={showScanner} animationType="fade" statusBarTranslucent>
        <DocumentScanner
          onCapture={(uri) => importarEscaneado(uri)}
          onClose={() => setShowScanner(false)}
        />
      </Modal>

      {/* MODAL FRAIS RÉELS */}
      <Modal visible={showModalFraisReel} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: '#2980b9' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>🍽️ Corriger les frais</Text>
            <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 6 }}>
              Estimé depuis <Text style={{ color: '#f5a623', fontWeight: '700' }}>{calcResult?.mesFraisLabel}</Text>
            </Text>
            <Text style={{ fontSize: 11, color: '#f39c12', textAlign: 'center', marginBottom: 18, lineHeight: 16 }}>
              Si le mois est incorrect, entre le montant réel reçu.{'\n'}La prochaine estimation utilisera cette valeur.
            </Text>
            <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', marginBottom: 8 }}>FRAIS RÉELS REÇUS (€)</Text>
            <TextInput
              style={{ backgroundColor: c.input, borderRadius: 12, padding: 14, fontSize: 24, fontWeight: '800', color: c.text, borderWidth: 1, borderColor: '#2980b9', textAlign: 'center', marginBottom: 20 }}
              value={inputFraisReel}
              onChangeText={setInputFraisReel}
              keyboardType="decimal-pad"
              placeholder="ex: 615.40"
              placeholderTextColor={c.textSub}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowModalFraisReel(false)}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, backgroundColor: '#2980b9', borderRadius: 12, padding: 14, alignItems: 'center' }}
                onPress={async () => {
                  const fraisReel = parseFloat(inputFraisReel.replace(',', '.')) || 0
                  if (fraisReel > 0 && calcResult) {
                    const novoTotal = calcResult.salLiq + fraisReel
                    setCalcResult({ ...calcResult, totalFrais: fraisReel, totalLiq: novoTotal })
                    setCountingVal(Math.round(novoTotal))

                    // Guardar frais confirmado no histórico para persistir entre cálculos
                    const [mesFraisLabel] = calcResult.mesFraisLabel.split(' ')
                    const anoFrais = parseInt(calcResult.mesFraisLabel.split(' ')[1])
                    const mesFraisIdx = moisLabelToIndex(mesFraisLabel)
                    const [mesPagamentoLabel] = calcResult.mesReceber.split(' ')
                    const mesPagamentoCalc = moisLabelToIndex(mesPagamentoLabel)
                    const anoPagamentoCalc = parseInt(calcResult.mesReceber.split(' ')[1])
                    const agora = new Date()
                    const mesPagamento = mesPagamentoCalc >= 0 ? mesPagamentoCalc : agora.getMonth()
                    const anoPagamento = Number.isFinite(anoPagamentoCalc) ? anoPagamentoCalc : agora.getFullYear()
                    const novoHist = aplicarConfirmacaoFraisPorValor(
                      historique,
                      fraisReel,
                      anoPagamento,
                      mesPagamento,
                      padrao,
                      {
                        periode: calcResult.mesFraisLabel,
                        moisIndex: mesFraisIdx >= 0 ? mesFraisIdx : mesPagamento,
                        annee: Number.isFinite(anoFrais) ? anoFrais : anoPagamento,
                        entreprise: calcResult.empresa || '',
                      }
                    )
                    novoHist.sort((a, b) => a.annee !== b.annee ? a.annee - b.annee : a.moisIndex - b.moisIndex)
                    setHistorique(novoHist)
                    await AsyncStorage.setItem('monSalaire_v2', JSON.stringify(novoHist))
                    const histCal = JSON.parse(await AsyncStorage.getItem('historique') || '[]')
                    const novoPadrao = analisarPadraoV2(novoHist, histCal, padrao)
                    setPadrao(novoPadrao)
                    await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(novoPadrao))
                  }
                  setShowModalFraisReel(false)
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>✅ Appliquer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL SALAIRE NET RÉEL */}
      <Modal visible={showModalSalNet} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: '#27ae60' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>💰 Confirmer le salaire net</Text>
            <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 6 }}>
              Estimé pour <Text style={{ color: '#f5a623', fontWeight: '700' }}>{calcResult?.mesReceber}</Text>
            </Text>
            <Text style={{ fontSize: 11, color: '#f39c12', textAlign: 'center', marginBottom: 18, lineHeight: 16 }}>
              Entre le net réel reçu sur ta fiche de paye.{'\n'}L'IA s'en souviendra pour améliorer les prochaines estimations.
            </Text>
            <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', marginBottom: 8 }}>SALAIRE NET RÉEL REÇU (€)</Text>
            <TextInput
              style={{ backgroundColor: c.input, borderRadius: 12, padding: 14, fontSize: 24, fontWeight: '800', color: c.text, borderWidth: 1, borderColor: '#27ae60', textAlign: 'center', marginBottom: 20 }}
              value={inputSalNet}
              onChangeText={setInputSalNet}
              keyboardType="decimal-pad"
              placeholder="ex: 1842.50"
              placeholderTextColor={c.textSub}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowModalSalNet(false)}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, backgroundColor: '#27ae60', borderRadius: 12, padding: 14, alignItems: 'center' }}
                onPress={async () => {
                  const salReel = parseFloat(inputSalNet.replace(',', '.')) || 0
                  if (salReel > 0 && calcResult) {
                    const novoTotal = salReel + calcResult.totalFrais
                    setCalcResult({ ...calcResult, salLiq: salReel, totalLiq: novoTotal, salConfirmado: true })
                    setCountingVal(Math.round(novoTotal))

                    // Guardar no histórico para aprendizagem da IA
                    const [mesReceberLabel] = calcResult.mesReceber.split(' ')
                    const mesIdx = moisLabelToIndex(mesReceberLabel)
                    const ano = parseInt(calcResult.mesReceber.split(' ')[1]) || new Date().getFullYear()
                    const novoHist = aplicarConfirmacaoSalarioPorValor(
                      historique,
                      salReel,
                      ano,
                      mesIdx >= 0 ? mesIdx : new Date().getMonth(),
                      novoTotal,
                      padrao,
                      { entreprise: calcResult.empresa || '', frais: calcResult.totalFrais },
                    )
                    novoHist.sort((a, b) => a.annee !== b.annee ? a.annee - b.annee : a.moisIndex - b.moisIndex)
                    setHistorique(novoHist)
                    await AsyncStorage.setItem('monSalaire_v2', JSON.stringify(novoHist))

                    // Re-analisar padrão com o novo valor confirmado
                    const histCal = JSON.parse(await AsyncStorage.getItem('historique') || '[]')
                    const novoPadrao = analisarPadraoV2(novoHist, histCal, padrao)
                    setPadrao(novoPadrao)
                    await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(novoPadrao))
                  }
                  setShowModalSalNet(false)
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>✅ Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL EDITAR */}
      <Modal visible={showModalEdit} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: '#f5a623' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 4, textAlign: 'center' }}>✏️ Modifier {modalDetail?.periode}</Text>
            <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 20 }}>Corrige les valeurs incorrectes</Text>
            <View style={{ gap: 12, marginBottom: 20 }}>
              <View>
                <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>NET PAYÉ (€)</Text>
                <TextInput style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, fontSize: 18, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }} value={editNetPaye} onChangeText={setEditNetPaye} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textSub} />
              </View>
              <View>
                <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>FRAIS BOLETIM (€)</Text>
                <TextInput style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, fontSize: 18, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }} value={editFraisBoletim} onChangeText={setEditFraisBoletim} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textSub} />
              </View>
              <View>
                <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>TOTAL REÇU (€)</Text>
                <TextInput style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, fontSize: 18, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }} value={editMontantTotal} onChangeText={setEditMontantTotal} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textSub} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowModalEdit(false)}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={async () => {
                if (!modalDetail) return
                const netEdit = parseFloat(editNetPaye) || 0
                const fraisEdit = parseFloat(editFraisBoletim) || 0
                const totalEdit = parseFloat(editMontantTotal) || 0
                const updated = {
                  ...modalDetail,
                  netPaye: netEdit,
                  fraisBoletim: fraisEdit,
                  remboursementFrais: fraisEdit > 0 ? fraisEdit : modalDetail.remboursementFrais,
                  fraisRecuConfirme: fraisEdit > 0 ? fraisEdit : modalDetail.fraisRecuConfirme,
                  montantTotalRecu: totalEdit,
                  salarioConfirmado: netEdit > 0,
                  fraisConfirmado: fraisEdit > 0,
                  pagamentoSalMesIndex: modalDetail.pagamentoSalMesIndex ?? modalDetail.moisIndex,
                  pagamentoSalAno: modalDetail.pagamentoSalAno ?? modalDetail.annee,
                  pagamentoFraisMesIndex: modalDetail.pagamentoFraisMesIndex ?? modalDetail.moisIndex,
                  pagamentoFraisAno: modalDetail.pagamentoFraisAno ?? modalDetail.annee,
                }
                const nova = historique.map(h => h.periode === modalDetail.periode ? updated : h)
                setHistorique(nova)
                await AsyncStorage.setItem('monSalaire_v2', JSON.stringify(nova))
                const histCal = JSON.parse(await AsyncStorage.getItem('historique') || '[]')
                const novoPadrao = analisarPadraoV2(nova, histCal, padrao)
                setPadrao(novoPadrao)
                await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(novoPadrao))
                setModalDetail(updated)
                setShowModalEdit(false)
              }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>✅ Sauvegarder</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 16 },
  appName: { fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  accent: { color: '#f5a623' },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#f5a623', letterSpacing: 1 },
  previsionCard: { marginHorizontal: 20, marginBottom: 16, borderRadius: 24, padding: 24, alignItems: 'center', backgroundColor: '#f5a623', elevation: 8 },
  previsionLabel: { fontSize: 15, fontWeight: '800', color: 'rgba(0,0,0,0.65)', letterSpacing: 2, marginBottom: 6, textAlign: 'center' },
  previsionMontant: { fontSize: 66, fontWeight: '800', color: 'white', letterSpacing: -2, lineHeight: 74 },
  previsionJour: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.85)', marginTop: 4, textAlign: 'center' },
  previsionConfianca: { fontSize: 14, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  calcularBtn: { marginHorizontal: 20, marginBottom: 16, borderRadius: 24, padding: 28, alignItems: 'center', backgroundColor: '#f5a623', elevation: 8 },
  calcularIcon: { fontSize: 40, marginBottom: 8 },
  calcularLabel: { fontSize: 22, fontWeight: '800', color: 'white', letterSpacing: 3 },
  calcularSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  uploadBtnGrande: { marginHorizontal: 20, marginBottom: 16, borderWidth: 2, borderStyle: 'dashed', borderRadius: 20, padding: 28, alignItems: 'center' },
  histTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 3, marginHorizontal: 20, marginBottom: 8 },
  histCard: { marginHorizontal: 20, marginBottom: 8, borderRadius: 14, borderWidth: 1, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  histLeft: { gap: 4, flex: 1 },
  histRight: { alignItems: 'flex-end', gap: 2 },
  histPeriode: { fontSize: 14, fontWeight: '700' },
  histSub: { fontSize: 11 },
  histMontant: { fontSize: 18, fontWeight: '800' },
})