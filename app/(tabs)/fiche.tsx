import { TachoLogo } from '../../src/TachoLogo'
import Svg, { Rect, Circle, Line, Path } from 'react-native-svg'
import { Swipeable } from 'react-native-gesture-handler'
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { Alert, View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, TextInput, Animated, Easing, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { useTheme } from '../../context/ThemeContext'
import { useApp } from '../../context/AppContext'
import { calcularFraisJour } from '../../src/frais'
import DocumentScanner from '../../src/components/DocumentScanner'
import {
  PADRAO_INICIAL, PadraoAprendido, PerguntaPendente, BoletimExtraido,
  gerarPerguntasObrigatorias, detectarAnomalias, aplicarRespostaConduteur,
  actualizarPadraoComBoletim, precisaoEstimativa as precisaoEstimativaMotor
} from '../../src/engine/aprendizagem'

// Valeurs par défaut convention transport français
const DEF_SAL = {
  hbase: 169, hval: 14.76, h25: 18.45, lim25: 17, h50: 22.31,
  hlag: 2, flag: 1, liquidRate: 0.79,
  ptd: 4.42, dej: 16.36, din: 23.94, nui: 23.94,
  valorDiaConges: 136.52, valorDiaFerie: 0, valorDiaRC: 0,
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
  primeNonAccident?: number
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
  moisAtipico?: boolean
  fraisRecuConfirme?: number
  pagamentoSalMesIndex?: number; pagamentoSalAno?: number
  pagamentoFraisMesIndex?: number; pagamentoFraisAno?: number
  estimativaSnapshot?: number
}

type Padrao = {
  descoberto: boolean; diaSalario: number; diaFrais: number
  defasagemFrais: number; confianca: number
  hbase: number; hval: number; h25: number; lim25: number; h50: number
  hlag: number; flag: number; liquidRate: number; fraisSepare?: boolean
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
  _conflitHbase?: { extraido: number; onboarding: number } | null
  _hbaseManual?: boolean
  _hvalManual?: boolean
  vehiculo?: string
  cargo?: string
}

type DocumentoAnalysado = {
  tipo: 'fiche' | 'frais'; periode: string; moisIndex: number; annee: number; dados: any
}

type CalcResult = {
  totalH: number; totalFrais: number; salBrut: number; salLiq: number
  totalLiq: number; jours: number; hExtra25: number; hExtra50: number
  mesReceber: string; diaReceber: number; diaFrais: number
  empresa: string; precisao: number; mesAberto: boolean
  mesHorasLabel: string
  mesFraisLabel: string
  salConfirmado?: boolean
  fraisConfirmado?: boolean
  // Campos para painel Analyse
  nConges: number; nFeries: number; nRC: number
  hNormal: number
  fraisDetail: { ptd: number; dej: number; din: number; nui: number }
  modoCalculo: 'preciso' | 'calibrado' | 'estimado'
  liquidRateUsado: number
}

type DriftAlert = {
  tipo: 'salaire' | 'frais' | 'misto' | null
  percentagem: number
  mensagem: string
  mesesAnalisados: number
}

type DriftTuplo = { est: number; real: number; estFrais: number; realFrais: number; estSal: number; realSal: number }

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

// ── Detecção de drift ─────────────────────────────────────────────────────────
const detectarDrift = (tuplos: DriftTuplo[]): DriftAlert => {
  if (tuplos.length < 2) return { tipo: null, percentagem: 0, mensagem: '', mesesAnalisados: 0 }

  const erros = tuplos.map(t => t.real > 0 && t.est > 0 ? ((t.est - t.real) / t.real) * 100 : null)
    .filter(e => e !== null) as number[]

  if (erros.length < 2) return { tipo: null, percentagem: 0, mensagem: '', mesesAnalisados: 0 }

  const media = erros.reduce((a, b) => a + b, 0) / erros.length
  const todosNaMesmaDirecao = erros.every(e => e > 0) || erros.every(e => e < 0)
  const percentagem = Math.abs(Math.round(media))

  if (!todosNaMesmaDirecao || percentagem < 5) {
    return { tipo: null, percentagem: 0, mensagem: '', mesesAnalisados: erros.length }
  }

  const direcao = media > 0 ? 'au-dessus' : 'en-dessous'
  let tipo: DriftAlert['tipo'] = 'misto'
  let mensagem = ''

  const errosSal = tuplos.map(t => t.realSal > 0 && t.estSal > 0 ? ((t.estSal - t.realSal) / t.realSal) * 100 : null)
    .filter(e => e !== null) as number[]
  const errosFrais = tuplos.map(t => t.realFrais > 0 && t.estFrais > 0 ? ((t.estFrais - t.realFrais) / t.realFrais) * 100 : null)
    .filter(e => e !== null) as number[]

  const mediaSal = errosSal.length >= 2 ? Math.abs(errosSal.reduce((a,b)=>a+b,0)/errosSal.length) : 0
  const mediaFrais = errosFrais.length >= 2 ? Math.abs(errosFrais.reduce((a,b)=>a+b,0)/errosFrais.length) : 0

  if (mediaSal > 7 && mediaFrais < 3) {
    tipo = 'salaire'
    mensagem = `Mes estimations de salaire sont systématiquement ${percentagem}% ${direcao} du réel sur ${erros.length} mois. Ton taux de cotisations ou ta grille salariale a peut-être changé. Charge une fiche de paye récente pour recalibrer.`
  } else if (mediaFrais > 7 && mediaSal < 3) {
    tipo = 'frais'
    mensagem = `Mes calculs de frais s'écartent ${percentagem}% du réel sur ${erros.length} mois. Les critères de ton entreprise ont peut-être changé (heure du petit-déj, amplitude pour le déjeuner...). Charge un boletim de frais récent.`
  } else {
    tipo = 'misto'
    mensagem = `Mes estimations sont ${percentagem}% ${direcao} du réel sur ${erros.length} mois consécutifs. Quelque chose a changé — salaire, frais ou les deux. Charge tes derniers documents pour que je me recalibre.`
  }

  return { tipo, percentagem, mensagem, mesesAnalisados: erros.length }
}

const DEFAULT_FRAIS_REGLES = { ptDejAte: 6.0, dejMinAmp: 6.017, dinerDe: 21.25 }
const TYPES_TRAVAIL = ['work', 'dec', 'TRAB', 'DEC']

// Extrai JSON de resposta da IA mesmo que contenha texto extra antes/depois
function extrairDocsIA(text: string): any[] {
  const cleaned = text.replace(/```json\n?|```\n?/g, '').trim()
  // Tentativa 1: prefill — resposta começa directamente com o corpo do array (sem '[')
  try { return JSON.parse('[' + cleaned) } catch {}
  // Tentativa 2: a IA incluiu o '[' na resposta (não deveria acontecer com prefill)
  try { return JSON.parse(cleaned) } catch {}
  // Tentativa 3: extrai o primeiro array JSON encontrado no texto
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)) } catch {}
  }
  throw new Error('Réponse IA non analysable')
}
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

function calcFraisHorario(
  type: string,
  inicio: string,
  fim: string,
  prevDec: boolean,
  p: Padrao,
  segServico?: number,
  decouche?: boolean,
): { ptd: number; dej: number; din: number; nui: number; total: number } {
  return calcularFraisJour({
    type,
    debut: inicio,
    fin: fim,
    prevDecouche: prevDec,
    segServico,
    decouche,
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
        const f = calcFraisHorario(type, debut, fin, prevDec, p, j.segServico || 0, !!j.decouche)
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
    .filter(d => d.salarioConfirmado && (d.netPaye || 0) > 0 && !d.moisAtipico)
    .map(d => {
      const [anoPay, mesPay] = mesPagamentoSalDe(d)
      const match = trouverSourceParValeur(dados, d.netPaye || 0, anoPay, mesPay, src => [src.netPaye || 0], true)
      return match?.lag !== undefined && match.lag > 0 ? match.lag : undefined
    })
    .filter((lag): lag is number => typeof lag === 'number')
}

function aprenderFlagPorConfirmacoes(dados: MoisData[]): number[] {
  return dados
    .filter(d => d.fraisConfirmado && fraisRealConfirme(d) > 0 && !d.moisAtipico)
    .map(d => {
      const [anoPay, mesPay] = mesPagamentoFraisDe(d)
      const valor = fraisRealConfirme(d)
      const match = trouverSourceParValeur(dados, valor, anoPay, mesPay, src => [
        src.fraisRecuConfirme || 0,
        src.fraisBoletim || 0,
        src.remboursementFrais || 0,
      ], true)
      return match?.lag !== undefined && match.lag > 0 ? match.lag : undefined
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
  !d.moisAtipico && (d.salarioConfirmado || (d.netPaye || 0) > 0 || (d.salairebrut || 0) > 0)

const totalPrimesExceptionnelles = (d: any) =>
  (d?.interessement || 0) +
  (d?.primeExceptionnelle || 0) +
  (d?.participationSalariale || 0) +
  (d?.primeNonAccident || 0) +
  (d?.autresPrimes || 0)

const netPayeRecurrent = (d: Pick<MoisData, 'netPaye'> | any) => Math.max(0, (d?.netPaye || 0) - (d?.interessement || 0) - (d?.participationSalariale || 0) - (d?.primeExceptionnelle || 0))

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
    const fonte = comBruto
    const taxa = fonte.reduce((a, d) => a + netPayeRecurrent(d) / d.salairebrut, 0) / fonte.length
    base.liquidRate = Math.round(Math.min(taxa, 0.95) * 1000) / 1000
  }

  // C. Coeficientes salariais reais extraídos das fiches
  // Se a IA extraiu directamente da fiche — confiança máxima, substitui defaults
  const comCoef = dados.filter(d => (d.hval || 0) > 0)
  if (comCoef.length > 0) {
    // Média dos coeficientes (devem ser iguais entre fiches da mesma empresa)
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
    const ARMADILHAS_HBASE = [157.67, 151.67, 133.92]
    const hbases = comCoef.map(d => d.hbase || 0).filter(v => v > 0 && !ARMADILHAS_HBASE.some(a => Math.abs(v - a) < 0.1))
    const hvals  = comCoef.map(d => d.hval  || 0).filter(v => v > 0)
    const h25s   = comCoef.map(d => d.h25   || 0).filter(v => v > 0)
    const lim25s = comCoef.map(d => d.lim25 || 0).filter(v => v > 0)
    const h50s   = comCoef.map(d => d.h50   || 0).filter(v => v > 0)
    // Só actualiza hbase se não foi definido manualmente pelo utilizador
    if (hbases.length > 0 && !base._hbaseManual) base.hbase = Math.round(avg(hbases) * 100) / 100
    if (hvals.length  > 0 && !base._hvalManual) base.hval  = Math.round(avg(hvals)  * 1000) / 1000
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
  const { state: appState, recarregarApp } = useApp()
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
  const [editMoisIndex, setEditMoisIndex] = useState(0)
  const [editAnnee, setEditAnnee] = useState(new Date().getFullYear())
  const [editInteressement, setEditInteressement] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState(0)
  const scrollAnim = useRef(new Animated.Value(0)).current
  const dustAnim = useRef(new Animated.Value(0)).current
  const [showPrevision, setShowPrevision] = useState(false)
  const [showAnalyse, setShowAnalyse] = useState(false)
  const [driftAlert, setDriftAlert] = useState<DriftAlert | null>(null)
  const [conflitHbase, setConflitHbase] = useState<{extraido: number; onboarding: number} | null>(null)
  const [editHbaseVisible, setEditHbaseVisible] = useState(false)
  const [editHbaseVal, setEditHbaseVal] = useState('')
  const [countingVal, setCountingVal] = useState(0)
  const [modalDetail, setModalDetail] = useState<MoisData | null>(null)
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [documentosAnalisados, setDocumentosAnalisados] = useState<DocumentoAnalysado[]>([])
  const [showPerguntas, setShowPerguntas] = useState(false)
  const [rascunhoActual, setRascunhoActual] = useState<any>(null)
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
  const [inputInteressement, setInputInteressement] = useState('')
  const [inputPrimeNonAcc, setInputPrimeNonAcc] = useState('')
  const [inputFraisReel, setInputFraisReel] = useState('')
  const [inputMontantFraisQ, setInputMontantFraisQ] = useState('')
  const [inputMontantSalQ, setInputMontantSalQ] = useState('')
  const [savedSalBeforeVerif, setSavedSalBeforeVerif] = useState('')
  const [savedFraisBeforeVerif, setSavedFraisBeforeVerif] = useState('')
  const [inputInteressementQ, setInputInteressementQ] = useState('')
  const [inputPrimeNonAccQ, setInputPrimeNonAccQ] = useState('')
  const [showVerifDetalhes, setShowVerifDetalhes] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showOnboardingSalaire, setShowOnboardingSalaire] = useState(false)
  const [onbStep, setOnbStep] = useState(1)
  const [onbHlag, setOnbHlag] = useState(DEF_SAL.hlag)
  const [onbFlag, setOnbFlag] = useState(DEF_SAL.flag)
  const [onbFraisSepare, setOnbFraisSepare] = useState(false)
  const [onbDiaSalario, setOnbDiaSalario] = useState(5)
  const [onbDiaFrais, setOnbDiaFrais] = useState(10)
  const [onbVehiculo, setOnbVehiculo] = useState('porteur')
  const [onbCargo, setOnbCargo] = useState('general')
  const [onbHbase, setOnbHbase] = useState(169)
  // pré-preencher tipo veículo, cargo e hbase do onboarding se já definidos
  React.useEffect(() => {
    AsyncStorage.getItem('vehicule_type').then(v => { if (v) setOnbVehiculo(v) })
    AsyncStorage.getItem('cargo_type').then(v => { if (v) setOnbCargo(v) })
    // hbase: AppContext se disponível, senão AsyncStorage
    if (appState.padrao?.hbase) {
      setOnbHbase(appState.padrao.hbase)
    } else {
      AsyncStorage.getItem('monSalaire_padrao').then(raw => {
        if (raw) { try { const p = JSON.parse(raw); if (p.hbase) setOnbHbase(p.hbase) } catch {} }
      })
    }
  }, [])
  const [verifApplied, setVerifApplied] = useState<false | 'fiche' | 'app'>(false)
  const [inputMoisAtipico, setInputMoisAtipico] = useState(false)
  const [editMoisAtipico, setEditMoisAtipico] = useState(false)
  const [camposOk, setCamposOk] = useState('')
  const [padraoAprendido, setPadraoAprendido] = useState<PadraoAprendido>(PADRAO_INICIAL)
  const [perguntasPendentes, setPerguntasPendentes] = useState<PerguntaPendente[]>([])
  const [perguntaActual, setPerguntaActual] = useState<PerguntaPendente | null>(null)
  const [showModalPerguntas, setShowModalPerguntas] = useState(false)
  const [respostaData, setRespostaData] = useState('')
  const [respostaMes, setRespostaMes] = useState<number | null>(null)
  const [respostaMesAno, setRespostaMesAno] = useState<number>(new Date().getFullYear())
  const [montantSalTemp, setMontantSalTemp] = useState<number>(0)
  const [montantFraisTemp, setMontantFraisTemp] = useState<number>(0)
  const [respostaMesManual, setRespostaMesManual] = useState(false)
  useEffect(() => {
    setRespostaMesManual(false)
    if (!perguntaActual) return
    if (perguntaActual.tipo === 'timing_salario' && (perguntaActual.valorContexto?.netPaye || 0) > 0)
      setMontantSalTemp(perguntaActual.valorContexto.netPaye)
    if (perguntaActual.tipo === 'timing_frais' && (perguntaActual.valorContexto?.fraisBoletim || 0) > 0)
      setMontantFraisTemp(perguntaActual.valorContexto.fraisBoletim)
    const offsetSugerido = perguntaActual.tipo === 'timing_frais'
      ? (padraoAprendido.flag ?? padrao.flag ?? 1)
      : (padraoAprendido.hlag ?? padrao.hlag ?? 2)
    const baseSug = respostaData ? (() => {
      const [dd, mm, yyyy] = respostaData.split('/')
      return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
    })() : new Date()
    const dSug = new Date(baseSug)
    dSug.setMonth(dSug.getMonth() - offsetSugerido)
    setRespostaMes(dSug.getMonth())
    setRespostaMesAno(dSug.getFullYear())
  }, [perguntaActual])
  useEffect(() => {
    if (!respostaData || respostaMesManual || !perguntaActual) return
    const offsetSugerido = perguntaActual.tipo === 'timing_frais'
      ? (padraoAprendido.flag ?? padrao.flag ?? 1)
      : (padraoAprendido.hlag ?? padrao.hlag ?? 2)
    const [dd, mm, yyyy] = respostaData.split('/')
    const base = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
    const dSug = new Date(base)
    dSug.setMonth(dSug.getMonth() - offsetSugerido)
    setRespostaMes(dSug.getMonth())
    setRespostaMesAno(dSug.getFullYear())
  }, [respostaData])
  useEffect(() => {
    if (montantSalTemp > 0) setInputMontantSalQ(String(montantSalTemp))
  }, [montantSalTemp])
  useEffect(() => {
    if (montantFraisTemp > 0) setInputMontantFraisQ(String(montantFraisTemp))
  }, [montantFraisTemp])
  const [mesesConfirmados, setMesesConfirmados] = useState(0)
  const [showCadeado, setShowCadeado] = useState(false)
  const [showConfirmTiming, setShowConfirmTiming] = useState(false)
  const [confirmTimingNet, setConfirmTimingNet] = useState(0)
  const [confirmTimingPeriode, setConfirmTimingPeriode] = useState('')
  const [confirmTimingMesPag, setConfirmTimingMesPag] = useState('')
  const pendingDocsRef = useRef<DocumentoAnalysado[]>([])
  const router = useRouter()

  const breathAnim = useRef(new Animated.Value(1)).current
  const pulseAnim = useRef(new Animated.Value(1)).current
  const countRef = useRef<any>(null)

  const c = useMemo(() => ({
    bg: themeSombre ? '#0f1117' : '#f0f2f8',
    card: themeSombre ? '#181c27' : '#ffffff',
    cardBorder: themeSombre ? '#2a3045' : '#d0d5e8',
    text: themeSombre ? '#eef0f5' : '#1a1f35',
    textSub: themeSombre ? '#6b7394' : '#555e80',
    textLabel: themeSombre ? '#6b7394' : '#3a4060',
    input: themeSombre ? '#1f2436' : '#f0f2f8',
  }), [themeSombre])

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

  useEffect(() => {
    AsyncStorage.getItem('onboarding_salaire_done').then(v => {
      if (!v) setShowOnboardingSalaire(true)
    })
    // campos_obrigatorios_ok via AppContext
    setCamposOk(appState.camposObrigatoriosOk ? 'true' : 'false')
    charger()
  }, [])

  // Recarregar padrao + historique sempre que a aba ganha foco
  // (ex: após editar nas Réglages ou adicionar dia no Historique)
  useFocusEffect(useCallback(() => {
    const sincronizar = async () => {
      await recarregarApp()
      // monSalaire_padrao: AppContext se disponível, senão AsyncStorage
      if (appState.padrao) {
        setPadrao(appState.padrao)
        if (appState.padrao._conflitHbase) setConflitHbase(appState.padrao._conflitHbase)
        else setConflitHbase(null)
      } else {
        AsyncStorage.getItem('monSalaire_padrao').then(async raw => {
          if (raw) {
            try {
              const p = JSON.parse(raw)
              setPadrao(p)
              if (p._conflitHbase) setConflitHbase(p._conflitHbase)
              else setConflitHbase(null)
            } catch {
              await AsyncStorage.removeItem('monSalaire_padrao')
            }
          }
        })
      }
      // campos_obrigatorios_ok via AppContext
      setCamposOk(appState.camposObrigatoriosOk ? 'true' : 'false')
      // historique não está no AppContext — continua via AsyncStorage
      AsyncStorage.getItem('historique').then(histRaw => {
        if (histRaw) {
          try { setHistCal(JSON.parse(histRaw)) } catch {}
        }
      })
    }
    sincronizar()
  }, []))

  useEffect(() => {
    setCamposOk(appState.camposObrigatoriosOk ? 'true' : 'false')
  }, [appState.camposObrigatoriosOk])

  useEffect(() => {
    if (!loading) { setLoadingMsg(0); scrollAnim.setValue(0); dustAnim.setValue(0); return }
    const msgs = 4
    const iv = setInterval(() => setLoadingMsg(i => (i + 1) % msgs), 1500)
    const scrollLoop = Animated.loop(
      Animated.timing(scrollAnim, { toValue: 240, duration: 2400, useNativeDriver: true, easing: Easing.linear })
    )
    const dustLoop = Animated.loop(
      Animated.timing(dustAnim, { toValue: 1, duration: 950, useNativeDriver: true })
    )
    scrollLoop.start(); dustLoop.start()
    return () => { clearInterval(iv); scrollLoop.stop(); dustLoop.stop() }
  }, [loading])

  const charger = async () => {
    try {
      const data = await AsyncStorage.getItem('monSalaire_v2')
      const pData = await AsyncStorage.getItem('monSalaire_padrao')
      const cal = JSON.parse(await AsyncStorage.getItem('historique') || '[]')
      const aprendRaw = await AsyncStorage.getItem('aprendizagem_padrao')
      if (aprendRaw) {
        try { setPadraoAprendido(JSON.parse(aprendRaw)) }
        catch { await AsyncStorage.removeItem('aprendizagem_padrao'); setPadraoAprendido(PADRAO_INICIAL) }
      }
      const mesesRaw = await AsyncStorage.getItem('aprendizagem_meses_confirmados')
      if (mesesRaw) setMesesConfirmados(parseInt(mesesRaw) || 0)
      setHistCal(cal)
      const reglesLimpas = await limparFraisReglesAoArrancar()
      if (data) {
        const hist = JSON.parse(data)
        setHistorique(hist)
        // Sempre re-analisa com o algoritmo actual para apanhar melhorias de detecção
        let base: Padrao
        if (pData) {
          try { base = { ...padrao, ...JSON.parse(pData) } }
          catch { await AsyncStorage.removeItem('monSalaire_padrao'); base = { ...padrao } }
        } else { base = { ...padrao } }
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
    } catch (e) { }
  }

  const guardarPadraoAprendido = async (novoPadrao: PadraoAprendido) => {
    await AsyncStorage.setItem('aprendizagem_padrao', JSON.stringify(novoPadrao))
    setPadraoAprendido(novoPadrao)
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
    let atual: Padrao
    if (pData) {
      try { atual = { ...padrao, ...JSON.parse(pData) } }
      catch { await AsyncStorage.removeItem('monSalaire_padrao'); atual = { ...padrao } }
    } else { atual = { ...padrao } }
    const fraisReglesRaw = await AsyncStorage.getItem('frais_regles')
    const reglesLimpas = sanitizeFraisRegles(fraisReglesRaw ? JSON.parse(fraisReglesRaw) : atual.regles)
    if (fraisReglesRaw) await AsyncStorage.setItem('frais_regles', JSON.stringify(reglesLimpas))
    atual = { ...atual, regles: reglesLimpas }
    const fraisValsRaw = await AsyncStorage.getItem('frais_valores')
    if (fraisValsRaw) {
      const fv = JSON.parse(fraisValsRaw)
      atual = { ...atual, ptd: fv.ptDej || atual.ptd, dej: fv.dej || atual.dej, din: fv.diner || atual.din, nui: fv.nuit || atual.nui }
    }
    // Merge timing confirmado do motor de aprendizagem
    try {
      const apRaw = await AsyncStorage.getItem('aprendizagem_padrao')
      if (apRaw) {
        const ap = JSON.parse(apRaw)
        if (ap.hlagConfirmado && ap.hlag != null) atual.hlag = ap.hlag
        if (ap.hlagConfirmado && ap.diaSalario != null) atual.diaSalario = ap.diaSalario
        if (ap.flagConfirmado && ap.flag != null) atual.flag = ap.flag
        if (ap.flagConfirmado && ap.diaFrais != null) atual.diaFrais = ap.diaFrais
      }
    } catch {}
    setPadrao(atual)
    await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(atual))
    return atual
  }

  // CÁLCULO PRINCIPAL
  const calcularSalario = async () => {
    if (camposOk !== 'true') return
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
      if (p._conflitHbase) {
        setConflitHbase(p._conflitHbase)
      } else {
        setConflitHbase(null)
      }
      const agora = new Date()
      const anoActual = agora.getFullYear()
      const mesActual = agora.getMonth()
      const diaRollover = Math.max(p.diaSalario || 5, p.diaFrais || 10)
      const deltaReceber = agora.getDate() > diaRollover ? 1 : 0
      const [anoReceber, mesReceber] = shiftMois(anoActual, mesActual, deltaReceber)
      const [anoHoras, mesHoras] = shiftMois(anoReceber, mesReceber, -p.hlag)
      const [anoFrais, mesFrais] = shiftMois(anoReceber, mesReceber, -p.flag)
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
      const fichesFrais = histSal.filter(f => {
        const fMes = (f.mesFraisTrabalhoIndex != null) ? f.mesFraisTrabalhoIndex : f.moisIndex
        const fAno = (f.anoFraisTrabalho != null) ? f.anoFraisTrabalho : f.annee
        return fMes === mesFrais && fAno === anoFrais && ((f.fraisRecuConfirme || 0) > 0 || f.fraisBoletim > 0)
      })
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
        const diff6 = Math.abs(est - m.montantTotalRecu)
        // Tolerância realista: ≤30€=100%, ≤70€=98%, ≤120€=95%, ≤200€=88%
        return diff6 <= 30 ? 100 : diff6 <= 70 ? 98 : diff6 <= 120 ? 95 : diff6 <= 200 ? 88
          : Math.max(60, Math.round(100 - Math.min(38, diff6 / m.montantTotalRecu * 100)))
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
        salConfirmado: ficheReal?.salarioConfirmado || false,
        fraisConfirmado: fichesFrais.length > 0 && (fichesFrais[0].fraisConfirmado || (fichesFrais[0].fraisRecuConfirme || 0) > 0),
        nConges: diasConges.length,
        nFeries: diasFeries.length,
        nRC: diasRC.length,
        hNormal: Math.min(totalH, p.hbase),
        fraisDetail: { ptd: fraisHorario.ptd, dej: fraisHorario.dej, din: fraisHorario.din, nui: fraisHorario.nui },
        modoCalculo: ficheReal?.netPaye ? 'preciso' : p.taxaHorariaNetaMedia > 0 ? 'calibrado' : 'estimado',
        liquidRateUsado: p.liquidRate,
      })
      // Drift detection usando calcEstimativaMes para dados sem snapshot
      const tuplosParaDrift: DriftTuplo[] = histSal
        .filter(m => m.montantTotalRecu > 0 && m.salarioConfirmado)
        .slice(0, 4)
        .map(m => {
          const est = m.estimativaSnapshot || calcEstimativaMes(m)
          const realFrais = m.fraisRecuConfirme || m.fraisBoletim || 0
          const estFrais = m.fraisBoletim || 0
          const realSal = m.netPaye || 0
          const estSal = est > 0 && estFrais > 0 ? Math.max(0, est - estFrais) : 0
          return { est, real: m.montantTotalRecu, estFrais, realFrais, estSal, realSal }
        })
      setDriftAlert(detectarDrift(tuplosParaDrift))
      setShowAnalyse(false)
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
- netPaye: montant “Net payé” APRÈS prélèvement à la source (PAS) — c’est la somme réellement virée sur le compte bancaire du salarié. NE PAS utiliser “Net à payer avant impôt sur le revenu”. NE PAS soustraire le PAS. Si la fiche affiche les deux valeurs, prendre uniquement la valeur finale après PAS.
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
      const response = await fetch('https://super-salamander-252e93.netlify.app/.netlify/functions/anthropic-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3500, system: 'Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans texte avant ou après.', messages: [{ role: 'user', content }] })
      })
      const data = await response.json()
      if (data.error) { mostrarErro(`Erreur API: ${data.error.message || data.error.type || 'inconnue'}`); setLoading(false); return }
      if (!data.content?.[0]) { mostrarErro("Impossible d'analyser les documents."); setLoading(false); return }
      const docs: DocumentoAnalysado[] = extrairDocsIA(data.content[0].text)
      processarDocumentos(docs)
    } catch (e) { mostrarErro("Réponse IA invalide. Réessaie ou utilise un fichier plus net.") }
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
      const response = await fetch('https://super-salamander-252e93.netlify.app/.netlify/functions/anthropic-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, system: 'Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans texte avant ou après.', messages: [{ role: 'user', content }] })
      })
      const data = await response.json()
      if (data.error) { mostrarErro(`Erreur API: ${data.error.message || data.error.type || 'inconnue'}`); setLoading(false); return }
      if (!data.content?.[0]) { mostrarErro("Impossible d'analyser les documents."); setLoading(false); return }
      const docs: DocumentoAnalysado[] = extrairDocsIA(data.content[0].text)
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
    } catch (e) { mostrarErro("Réponse IA invalide. Réessaie ou utilise un fichier plus net.") }
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
- netPaye: montant “Net payé” APRÈS prélèvement à la source (PAS) — c’est la somme réellement virée sur le compte bancaire du salarié. NE PAS utiliser “Net à payer avant impôt sur le revenu”. NE PAS soustraire le PAS. Si la fiche affiche les deux valeurs, prendre uniquement la valeur finale après PAS.
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
      const response = await fetch('https://super-salamander-252e93.netlify.app/.netlify/functions/anthropic-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3500, system: 'Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans texte avant ou après.', messages: [{ role: 'user', content }] }),
      })
      const data = await response.json()
      if (!data.content?.[0]) { mostrarErro("Impossible d'analyser le document scanné."); setLoading(false); return }
      if (data.error) { mostrarErro(`Erreur API: ${data.error.message || data.error.type || 'inconnue'}`); setLoading(false); return }
      const docs: DocumentoAnalysado[] = extrairDocsIA(data.content[0].text)
      processarDocumentos(docs)
    } catch (e) { mostrarErro("Réponse IA invalide. Réessaie ou utilise une image plus nette.") }
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
    if (padraoAprendido.hlagConfirmado && padraoAprendido.flagConfirmado) {
      const moisIdx = fiches[0].moisIndex ?? new Date().getMonth()
      const ano = fiches[0].annee ?? new Date().getFullYear()
      const [anoP, mesP] = shiftMois(ano, moisIdx, padraoAprendido.hlag ?? 1)
      const mesPagNom = MOIS_NOMS[mesP] ?? ''
      const pfRaw = (fiches[0].dados as any) || (fiches[0] as any)
      if ((pfRaw?.netPaye || 0) > 0) setMontantSalTemp(pfRaw.netPaye)
      if ((pfRaw?.remboursementFrais || 0) > 0) setMontantFraisTemp(pfRaw.remboursementFrais)
      setConfirmTimingNet(pfRaw?.netPaye || 0)
      setConfirmTimingPeriode(fiches[0].periode || '')
      setConfirmTimingMesPag(`${mesPagNom} ${anoP}`)
      pendingDocsRef.current = docs
      setShowPerguntas(false)
      setShowConfirmTiming(true)
      return
    }
    await processarPerguntas(docs)
  }

  const confirmarTimingEProsseguir = async () => {
    setShowConfirmTiming(false)
    await processarPerguntas(pendingDocsRef.current)
  }

  const processarPerguntas = async (docs: DocumentoAnalysado[], padraoOverride?: PadraoAprendido) => {
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
          montantSalReel: pf.netPaye || 0,
          montantFraisReel: pf?.remboursementFrais || 0,
          diaSalario: padrao.diaSalario,
          diaFrais: padrao.diaFrais,
          autoDetectado: true,
        }
      })
      const semValores = respostasAuto.filter(r => r.montantSalReel <= 0 && r.montantFraisReel <= 0)
      if (semValores.length > 0) {
        mostrarErro(`Valeurs manquantes extraites par l'IA pour ${semValores[0].fiche.periode}.\nCharge une fiche plus nette ou confirme manuellement.`)
        return
      }
      // Motor de aprendizagem (modo auto)
      {
        let padAtual = padraoOverride ?? padraoAprendido
        for (const ficheDoc of fiches) {
          const pf = ficheDoc.dados || ficheDoc as any
          const boletim: BoletimExtraido = {
            periodo: ficheDoc.periode || '',
            moisIndex: ficheDoc.moisIndex || 0,
            annee: ficheDoc.annee || new Date().getFullYear(),
            netPaye: pf.netPaye || 0,
            salairebrut: pf.salairebrut || 0,
            hval: pf.hval || null,
            heuresSuppl25: pf.heuresSuppl25 || null,
            heuresSuppl50: pf.heuresSuppl50 || null,
            heuresNuit: pf.heuresNuit || null,
            joursCongesN: pf.joursCongesN || null,
            joursCongesN1: pf.joursCongesN1 || null,
            joursRC: pf.joursRC || null,
            fraisBoletim: pf.remboursementFrais || null,
            rubriquesDesconhecidas: pf.rubriquesDesconhecidas || [],
            dataPagamento: null,
            mesTrabalho: null,
          }
          padAtual = actualizarPadraoComBoletim(boletim, padAtual)
        }
        await guardarPadraoAprendido(padAtual)
        if (!padAtual.hlagConfirmado || !padAtual.flagConfirmado) setShowCadeado(true)
      }
      await guardarTudo(respostasAuto)
      setDocumentosAnalisados([])
      return
    }
    setRespostas([]); setPerguntaAtual(0); setInputValor('')
    setInputDiaSal(String(padrao.diaSalario)); setInputDiaFrais(String(padrao.diaFrais))
    // Pré-preenche sal + frais da primeira fiche se a IA os extraiu
    const fichaZero = fiches[0]
    const pf = fichaZero?.dados || fichaZero as any
    const netPayeZero = (fichaZero?.dados?.netPaye || (fichaZero as any)?.netPaye || 0)
    const fraisZero = (fichaZero?.dados?.remboursementFrais || (fichaZero as any)?.remboursementFrais || 0)
    setInputMontantSalQ(montantSalTemp > 0 ? String(montantSalTemp) : netPayeZero > 0 ? String(netPayeZero) : '')
    setInputMontantFraisQ(montantFraisTemp > 0 ? String(montantFraisTemp) : fraisZero > 0 ? String(fraisZero) : '')
    setInputInteressementQ((pf?.interessement || 0) > 0 ? String(pf.interessement) : '')
    setInputPrimeNonAccQ((pf?.primeNonAccident || 0) > 0 ? String(pf.primeNonAccident) : '')
    setShowVerifDetalhes(false)
    setInputMoisAtipico(false)
    setShowPerguntas(true)
    // Motor de aprendizagem (modo manual)
    {
      let padAtual = padraoOverride ?? padraoAprendido
      const todasPerguntasMotor: PerguntaPendente[] = []
      for (const ficheDoc of fiches) {
        const pf = ficheDoc.dados || ficheDoc as any
        const boletim: BoletimExtraido = {
          periodo: ficheDoc.periode || '',
          moisIndex: ficheDoc.moisIndex || 0,
          annee: ficheDoc.annee || new Date().getFullYear(),
          netPaye: pf.netPaye || 0,
          salairebrut: pf.salairebrut || 0,
          hval: pf.hval || null,
          heuresSuppl25: pf.heuresSuppl25 || null,
          heuresSuppl50: pf.heuresSuppl50 || null,
          heuresNuit: pf.heuresNuit || null,
          joursCongesN: pf.joursCongesN || null,
          joursCongesN1: pf.joursCongesN1 || null,
          joursRC: pf.joursRC || null,
          fraisBoletim: pf.remboursementFrais || null,
          rubriquesDesconhecidas: pf.rubriquesDesconhecidas || [],
          dataPagamento: null,
          mesTrabalho: null,
        }
        padAtual = actualizarPadraoComBoletim(boletim, padAtual)
        const pergsObrig = gerarPerguntasObrigatorias(padAtual, boletim)
        const pergsAnom = detectarAnomalias(boletim, padAtual)
        todasPerguntasMotor.push(...pergsObrig, ...pergsAnom)
      }
      if (todasPerguntasMotor.length > 0) {
        setPerguntasPendentes(todasPerguntasMotor)
        setPerguntaActual(todasPerguntasMotor[0])
        setShowModalPerguntas(true)
      } else {
        await guardarPadraoAprendido(padAtual)
      }
      if (!padAtual.hlagConfirmado || !padAtual.flagConfirmado) setShowCadeado(true)
    }
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
      moisAtipico: inputMoisAtipico,
      interessementQ: parseFloat(inputInteressementQ.replace(',','.')) || 0,
      primeNonAccQ: parseFloat(inputPrimeNonAccQ.replace(',','.')) || 0,
    }
    const novasRespostas = [...respostas, novaResposta]
    setRespostas(novasRespostas)
    if (perguntaAtual < fiches.length - 1) {
      // Pré-preenche sal + frais para a próxima fiche (rascunho tem prioridade)
      const proxIndex = perguntaAtual + 1
      const temRascunho = rascunhoActual?.index === proxIndex
      const fichaProx = fiches[proxIndex]
      const pf = fichaProx?.dados || fichaProx as any
      const netPayeProx = (fichaProx?.dados?.netPaye || (fichaProx as any)?.netPaye || 0)
      const fraisProx = (fichaProx?.dados?.remboursementFrais || (fichaProx as any)?.remboursementFrais || 0)
      setInputMontantSalQ(temRascunho ? (rascunhoActual.montantSalReel > 0 ? String(Math.round((rascunhoActual.montantSalReel || 0) * 100) / 100) : '') : montantSalTemp > 0 ? String(montantSalTemp) : (netPayeProx > 0 ? String(Math.round(netPayeProx * 100) / 100) : ''))
      setInputMontantFraisQ(temRascunho ? (rascunhoActual.montantFraisReel > 0 ? String(Math.round((rascunhoActual.montantFraisReel || 0) * 100) / 100) : '') : montantFraisTemp > 0 ? String(montantFraisTemp) : (fraisProx > 0 ? String(Math.round(fraisProx * 100) / 100) : ''))
      setInputInteressementQ(temRascunho ? (rascunhoActual.interessementQ > 0 ? String(Math.round((rascunhoActual.interessementQ || 0) * 100) / 100) : '') : ((pf?.interessement || 0) > 0 ? String(Math.round((pf?.interessement || 0) * 100) / 100) : ''))
      setInputPrimeNonAccQ(temRascunho ? (rascunhoActual.primeNonAccQ > 0 ? String(Math.round((rascunhoActual.primeNonAccQ || 0) * 100) / 100) : '') : ((pf?.primeNonAccident || 0) > 0 ? String(Math.round((pf?.primeNonAccident || 0) * 100) / 100) : ''))
      setInputMoisAtipico(temRascunho ? rascunhoActual.moisAtipico : false)
      if (temRascunho) setRascunhoActual(null)
      setShowVerifDetalhes(false)
      setVerifApplied(false)
      setPerguntaAtual(proxIndex)
    } else {
      await guardarTudo(novasRespostas); setShowPerguntas(false); setDocumentosAnalisados([])
    }
  }

  const handleResponderPergunta = async (resposta: string) => {
    if (!perguntaActual) return
    if (perguntaActual.tipo === 'timing_salario') {
      const sal = perguntaActual.valorContexto?.netPaye || 0
      if (sal > 0) setMontantSalTemp(sal)
    }
    if (perguntaActual.tipo === 'timing_frais') {
      const fr = perguntaActual.valorContexto?.fraisBoletim || 0
      if (fr > 0) setMontantFraisTemp(fr)
    }
    const dataPag = respostaData ? (() => {
      const [dd, mm, yyyy] = respostaData.split('/')
      return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
    })() : null
    const boletimTiming: BoletimExtraido = {
      periodo: '', moisIndex: 0, annee: 0, netPaye: 0, salairebrut: 0,
      hval: null, heuresSuppl25: null, heuresSuppl50: null, heuresNuit: null,
      joursCongesN: null, joursCongesN1: null, joursRC: null, fraisBoletim: null,
      rubriquesDesconhecidas: [],
      dataPagamento: dataPag,
      mesTrabalho: respostaMes !== null ? respostaMes : null,
    }
    const novoPadrao = aplicarRespostaConduteur(perguntaActual, resposta, padraoAprendido, boletimTiming)
    await guardarPadraoAprendido(novoPadrao)
    if (perguntaActual.tipo === 'taxa_mudou' && resposta.startsWith('Oui') && novoPadrao.hval !== null) {
      const padraoActualizado = { ...padrao, hval: novoPadrao.hval, h25: Math.round(novoPadrao.hval * 1.25 * 100) / 100, h50: Math.round(novoPadrao.hval * 1.5 * 100) / 100 }
      setPadrao(padraoActualizado)
      await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(padraoActualizado))
    }
    const restantes = perguntasPendentes.filter(p => p.id !== perguntaActual.id)
    setPerguntasPendentes(restantes)
    if (restantes.length > 0) {
      setPerguntaActual(restantes[0])
    } else {
      setPerguntaActual(null)
      setShowModalPerguntas(false)
      const novosConfirmados = mesesConfirmados + 1
      setMesesConfirmados(novosConfirmados)
      await AsyncStorage.setItem('aprendizagem_meses_confirmados', String(novosConfirmados))
      if (novoPadrao.hlagConfirmado && novoPadrao.flagConfirmado) setShowCadeado(false)
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
        netPaye: resp.montantSalReel > 0 ? resp.montantSalReel : (fiche.netPaye || 0),
        salairebrut: fiche.salairebrut || 0,
        totalCotisations: fiche.totalCotisations || 0,
        remboursementFrais: fraisFiche,
        fraisBoletim: frais?.totalFrais > 0 ? frais.totalFrais : 0,
        interessement: (resp.interessementQ || 0) > 0 ? resp.interessementQ : (fiche.interessement || 0),
        primeNonAccident: (resp.primeNonAccQ || 0) > 0 ? resp.primeNonAccQ : (fiche.primeNonAccident || 0),
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
        moisAtipico: resp.moisAtipico || false,
        joursConges: fiche.joursConges || 0, montantConges: fiche.montantConges || 0,
        joursFeries: fiche.joursFeries || 0, montantFeries: fiche.montantFeries || 0,
        joursRC: fiche.joursRC || 0, montantRC: fiche.montantRC || 0, totalHeures: fiche.totalHeures || 0,
        // Coeficientes salariais reais
        hbase: fiche.hbase || 0, hval: fiche.hval || 0,
        h25: fiche.h25 || 0, lim25: fiche.lim25 || 0, h50: fiche.h50 || 0,
      }
      if (existenteIdx >= 0) {
        const ex = novoHist[existenteIdx]
        const merged: MoisData = {
          ...novoDado,
          // salário — só substituir se NÃO confirmado antes
          netPaye: ex.salarioConfirmado ? ex.netPaye : novoDado.netPaye,
          salairebrut: ex.salarioConfirmado ? ex.salairebrut : novoDado.salairebrut,
          salarioConfirmado: ex.salarioConfirmado || novoDado.salarioConfirmado,
          // primes extras — preservar se já confirmadas
          interessement: (ex.salarioConfirmado && (ex.interessement || 0) > 0) ? ex.interessement : novoDado.interessement,
          primeNonAccident: (ex.salarioConfirmado && (ex.primeNonAccident || 0) > 0) ? ex.primeNonAccident : novoDado.primeNonAccident,
          primeExceptionnelle: (ex.salarioConfirmado && (ex.primeExceptionnelle || 0) > 0) ? ex.primeExceptionnelle : novoDado.primeExceptionnelle,
          // frais — só substituir se NÃO confirmado antes
          fraisRecuConfirme: ex.fraisConfirmado ? (ex.fraisRecuConfirme ?? novoDado.fraisRecuConfirme) : novoDado.fraisRecuConfirme,
          fraisBoletim: ex.fraisConfirmado ? (ex.fraisBoletim || novoDado.fraisBoletim) : novoDado.fraisBoletim,
          fraisConfirmado: ex.fraisConfirmado || novoDado.fraisConfirmado,
          // montant total — preservar se > 0
          montantTotalRecu: ex.montantTotalRecu > 0 ? ex.montantTotalRecu : novoDado.montantTotalRecu,
          // fonte e confiança — upgradar para confirmado se aplicável
          fonte: (ex.salarioConfirmado || ex.fraisConfirmado) ? 'confirmado' : novoDado.fonte,
          confiancaAprendizagem: (ex.salarioConfirmado || ex.fraisConfirmado) ? 1 : novoDado.confiancaAprendizagem,
          // atipico — só atualizar se novo valor foi explicitamente definido
          moisAtipico: novoDado.moisAtipico !== undefined ? novoDado.moisAtipico : ex.moisAtipico,
        }
        novoHist[existenteIdx] = merged
      } else {
        novoHist.push(novoDado)
      }
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
    <SafeAreaView edges={['top']} style={[st.safe, { backgroundColor: c.bg }]}>
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
          <TachoLogo textColor={c.text} size={26} />
          <View style={[st.badge, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
            <Text style={st.badgeText}>💰 MON SALAIRE</Text>
          </View>
        </View>

        {showPrevision && calcResult ? (
          <Animated.View style={[st.previsionCard, { transform: [{ scale: calcResult.mesAberto ? pulseAnim : breathAnim }] }]}>
            <Text style={st.previsionLabel}>ESTIMÉ {calcResult.mesHorasLabel.split(' ')[0].toUpperCase()} {calcResult.mesHorasLabel.split(' ')[1]}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
              {calcResult.mesAberto && (
                <Text style={{ fontSize: 28, color: 'rgba(255,255,255,0.8)', fontWeight: '800', marginTop: 8, marginRight: 4 }}>≈</Text>
              )}
              <Text style={st.previsionMontant}>{countingVal.toLocaleString('fr-FR')}€</Text>
            </View>
            <Text style={st.previsionConfianca}>
              {'\u{1F4CA}'} Confiance : {precisaoEstimativaMotor(padraoAprendido, mesesConfirmados)}%
            </Text>
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
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 }}>
                  💰 SALAIRE NET <Text style={{ fontSize: 9, opacity: 0.6 }}>{calcResult.salConfirmado ? '✅' : '✏️'}</Text>
                </Text>
                <Text style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>estimé hors primes</Text>
                <Text style={{ fontSize: 22, color: 'white', fontWeight: '900', letterSpacing: 0.5 }}>{fmtInt(calcResult.salLiq)}</Text>
              </TouchableOpacity>
              {/* Frais */}
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: calcResult.fraisConfirmado ? 'rgba(41,128,185,0.22)' : 'rgba(41,128,185,0.12)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: calcResult.fraisConfirmado ? '#2980b9' : 'rgba(41,128,185,0.35)' }}
                onPress={() => { setInputFraisReel(calcResult.totalFrais.toFixed(2)); setShowModalFraisReel(true) }}
              >
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 }}>
                  🍽️ FRAIS <Text style={{ fontSize: 9, opacity: 0.7 }}>{calcResult.fraisConfirmado ? '✅' : '✏️'}</Text>
                </Text>
                <Text style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>
                  {calcResult.fraisConfirmado ? 'depuis historique' : 'estimé depuis calendrier'}
                </Text>
                <Text style={{ fontSize: 22, color: 'white', fontWeight: '900', letterSpacing: 0.5 }}>{fmtInt(calcResult.totalFrais)}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ width: '100%', height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 12 }} />
            <View style={{ width: '100%', gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.80)' }}>Brut estimé</Text>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1 }}>{calcResult.mesHorasLabel.split(' ')[0].toUpperCase()}</Text>
                </View>
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
              <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 5, paddingHorizontal: 12, fontStyle: 'italic' }}>
                Estimation indicative basée sur tes données. Les résultats réels varient selon ton contrat et ton employeur — même les entreprises se trompent parfois. TachoOffice n'assume aucune responsabilité pour les écarts avec ton bulletin de salaire.
              </Text>
              {calcResult.empresa ? (
                <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)' }}>* basé sur ton historique · {calcResult.empresa}</Text>
              ) : (
                <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)' }}>* basé sur ton historique · pattern détecté</Text>
              )}
            </View>
            {/* ── Bouton Analyse ─────────────────────────────────────────── */}
            <TouchableOpacity
              onPress={() => setShowAnalyse(v => !v)}
              style={{ marginTop: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }}
            >
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: '700' }}>
                {showAnalyse ? "▲ Masquer l'analyse" : "🔍 Voir l'analyse"}
              </Text>
            </TouchableOpacity>

            {showAnalyse && (
              <View style={{ marginTop: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 16,
                padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', gap: 14 }}>

                {driftAlert && driftAlert.tipo && (
                  <View style={{ backgroundColor: 'rgba(243,156,18,0.18)', borderRadius: 12, padding: 12,
                    borderWidth: 1, borderColor: 'rgba(243,156,18,0.5)', gap: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#f5a623' }}>⚠️ Quelque chose a changé</Text>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 16 }}>{driftAlert.mensagem}</Text>
                    <TouchableOpacity onPress={importerDocumentos}
                      style={{ marginTop: 4, alignSelf: 'flex-start', backgroundColor: 'rgba(243,156,18,0.3)',
                        borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 }}>
                      <Text style={{ fontSize: 11, color: '#f5a623', fontWeight: '700' }}>📄 Charger des documents</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.5)',
                    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>Détail du calcul</Text>

                  {calcResult.modoCalculo === 'preciso' ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>✅ Salaire réel (fiche confirmée)</Text>
                      <Text style={{ fontSize: 12, color: 'white', fontWeight: '700' }}>{fmtInt(calcResult.salLiq)} €</Text>
                    </View>
                  ) : (
                    <>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>⏱ {fmtH(calcResult.hNormal)}h norm. × {padrao.hval.toFixed(2)} €</Text>
                        <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>{fmtInt(calcResult.hNormal * padrao.hval)} €</Text>
                      </View>
                      {calcResult.hExtra25 > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>⏱ {fmtH(calcResult.hExtra25)}h +25% × {padrao.h25.toFixed(2)} €</Text>
                          <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>{fmtInt(calcResult.hExtra25 * padrao.h25)} €</Text>
                        </View>
                      )}
                      {calcResult.hExtra50 > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>⏱ {fmtH(calcResult.hExtra50)}h +50% × {padrao.h50.toFixed(2)} €</Text>
                          <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>{fmtInt(calcResult.hExtra50 * padrao.h50)} €</Text>
                        </View>
                      )}
                      {calcResult.nConges > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>🏖 {calcResult.nConges}j congés × {(padrao.valorDiaConges > 0 ? padrao.valorDiaConges : (padrao.hbase / 22) * padrao.hval).toFixed(2)} €</Text>
                          <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>{fmtInt(calcResult.nConges * (padrao.valorDiaConges > 0 ? padrao.valorDiaConges : (padrao.hbase / 22) * padrao.hval))} €</Text>
                        </View>
                      )}
                      {calcResult.nRC > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>🔄 {calcResult.nRC}j R.C. × {(padrao.valorDiaRC > 0 ? padrao.valorDiaRC : (padrao.hbase / 22) * padrao.hval).toFixed(2)} €</Text>
                          <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>{fmtInt(calcResult.nRC * (padrao.valorDiaRC > 0 ? padrao.valorDiaRC : (padrao.hbase / 22) * padrao.hval))} €</Text>
                        </View>
                      )}
                      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 2 }} />
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                          Brut→Net ({Math.round(calcResult.liquidRateUsado * 100)}%{calcResult.liquidRateUsado === 0.79 ? ' · défaut ⚠️' : ' · réel ✅'})
                        </Text>
                        <Text style={{ fontSize: 12, color: 'white', fontWeight: '700' }}>{fmtInt(calcResult.salLiq)} €</Text>
                      </View>
                      <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
                        Mode: {calcResult.modoCalculo === 'calibrado' ? '⚡ calibré (taxa neta média)' : '📊 estimé (formule classique)'}
                      </Text>
                    </>
                  )}

                  {calcResult.totalFrais > 0 && (
                    <>
                      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 2 }} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)' }}>Frais ({calcResult.mesFraisLabel})</Text>
                      {calcResult.fraisDetail.ptd > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>🍵 Pt-déj × {calcResult.fraisDetail.ptd}</Text>
                          <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>{fmtInt(calcResult.fraisDetail.ptd * padrao.ptd)} €</Text>
                        </View>
                      )}
                      {calcResult.fraisDetail.dej > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>🥗 Déjeuner × {calcResult.fraisDetail.dej}</Text>
                          <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>{fmtInt(calcResult.fraisDetail.dej * padrao.dej)} €</Text>
                        </View>
                      )}
                      {calcResult.fraisDetail.din > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>🍽 Dîner × {calcResult.fraisDetail.din}</Text>
                          <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>{fmtInt(calcResult.fraisDetail.din * padrao.din)} €</Text>
                        </View>
                      )}
                      {calcResult.fraisDetail.nui > 0 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>🌙 Nuit × {calcResult.fraisDetail.nui}</Text>
                          <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>{fmtInt(calcResult.fraisDetail.nui * padrao.nui)} €</Text>
                        </View>
                      )}
                      {calcResult.fraisConfirmado && (
                        <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>✅ Frais depuis boletim confirmé</Text>
                      )}
                    </>
                  )}

                  <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: 'white' }}>TOTAL ESTIMÉ</Text>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: '#2ecc71' }}>{fmtInt(calcResult.totalLiq)} €</Text>
                  </View>
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.5)',
                    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>Données essentielles</Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 14 }}>{padrao.hval > 0 ? '🟢' : '🔴'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>Taux horaire brut</Text>
                      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                        {padrao.hval > 0 ? `${padrao.hval.toFixed(2)} €/h · défini au démarrage` : 'Non défini — indispensable'}
                      </Text>
                    </View>
                  </View>

                  {(() => {
                    const ARMADILHAS = [157.67, 151.67, 133.92]
                    const isArmadilha = ARMADILHAS.some(v => Math.abs(padrao.hbase - v) < 0.1)
                    return (
                      <View style={{ gap: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 14 }}>{padrao.hbase <= 0 ? '🔴' : isArmadilha ? '🟠' : '🟢'}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>Heures base/mois</Text>
                            <Text style={{ fontSize: 11, color: isArmadilha ? '#FFD54F' : 'rgba(255,255,255,0.55)' }}>
                              {padrao.hbase > 0 ? `${padrao.hbase}h · défini au démarrage` : 'Non défini — indispensable'}
                            </Text>
                          </View>
                          {padrao.hbase > 0 && (
                            <TouchableOpacity
                              style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}
                              onPress={() => setEditHbaseVisible(true)}>
                              <Text style={{ fontSize: 10, color: 'white' }}>Corriger</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        {isArmadilha && (
                          <View style={{ backgroundColor: 'rgba(255,152,0,0.15)', borderRadius: 8, padding: 8, borderLeftWidth: 2, borderLeftColor: '#FF9800' }}>
                            <Text style={{ fontSize: 11, color: '#FFD54F', lineHeight: 15 }}>
                              {'⚠️ Ce chiffre ressemble à des heures annuelles ÷ 12. Vérifie la ligne "Sous total Salaire de base" sur ta fiche et corrige si nécessaire.'}
                            </Text>
                            <TouchableOpacity
                              style={{ marginTop: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(255,152,0,0.3)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}
                              onPress={() => setEditHbaseVisible(true)}>
                              <Text style={{ fontSize: 11, color: 'white', fontWeight: '700' }}>Corriger maintenant</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                        <Modal visible={editHbaseVisible} transparent animationType="fade">
                          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
                            <View style={{ backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, width: '100%' }}>
                              <Text style={{ fontSize: 14, color: 'white', fontWeight: '700', marginBottom: 4 }}>Heures de base / mois</Text>
                              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
                                {'Regarde la colonne "Base" sur la ligne "Sous total Salaire de base" de ta fiche de paye.'}
                              </Text>
                              <TextInput
                                style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, padding: 10, color: 'white', fontSize: 18, textAlign: 'center', marginBottom: 16 }}
                                keyboardType="decimal-pad"
                                defaultValue={String(padrao.hbase)}
                                onChangeText={v => setEditHbaseVal(v)}
                                placeholder="ex: 169"
                                placeholderTextColor="rgba(255,255,255,0.3)"
                              />
                              <View style={{ flexDirection: 'row', gap: 10 }}>
                                <TouchableOpacity
                                  style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                                  onPress={() => setEditHbaseVisible(false)}>
                                  <Text style={{ color: 'white', fontSize: 13 }}>Annuler</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={{ flex: 1, backgroundColor: '#27ae60', borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                                  onPress={async () => {
                                    const val = parseFloat(editHbaseVal.replace(',', '.'))
                                    if (!isNaN(val) && val > 0) {
                                      const p = { ...padrao, hbase: val, _conflitHbase: null, _hbaseManual: true }
                                      await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(p))
                                      setPadrao(p)
                                    }
                                    setEditHbaseVisible(false)
                                  }}>
                                  <Text style={{ color: 'white', fontSize: 13, fontWeight: '700' }}>Enregistrer</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                        </Modal>
                      </View>
                    )
                  })()}

                  {conflitHbase && (
                    <View style={{ backgroundColor: 'rgba(255,160,0,0.15)', borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: '#FFA000' }}>
                      <Text style={{ fontSize: 12, color: '#FFD54F', fontWeight: '700', marginBottom: 4 }}>
                        {"⚠️ Conflit détecté sur les heures de base"}
                      </Text>
                      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', lineHeight: 16, marginBottom: 8 }}>
                        {`Ta fiche indique ${conflitHbase.extraido}h/mois mais tu as configuré ${conflitHbase.onboarding}h au démarrage. Lequel est correct?`}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: 'rgba(255,160,0,0.3)', borderRadius: 8, paddingVertical: 6, alignItems: 'center' }}
                          onPress={async () => {
                            const p = { ...padrao, hbase: conflitHbase.onboarding, _conflitHbase: null, _hbaseManual: true }
                            await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(p))
                            setPadrao(p)
                            setConflitHbase(null)
                          }}>
                          <Text style={{ fontSize: 11, color: 'white', fontWeight: '700' }}>{`Garder ${conflitHbase.onboarding}h`}</Text>
                          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>ma config</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: 'rgba(39,174,96,0.3)', borderRadius: 8, paddingVertical: 6, alignItems: 'center' }}
                          onPress={async () => {
                            const p = { ...padrao, hbase: conflitHbase.extraido, _conflitHbase: null, _hbaseManual: true }
                            await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(p))
                            setPadrao(p)
                            setConflitHbase(null)
                          }}>
                          <Text style={{ fontSize: 11, color: 'white', fontWeight: '700' }}>{`Utiliser ${conflitHbase.extraido}h`}</Text>
                          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>depuis ma fiche</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 14 }}>{padrao.liquidRate !== 0.79 ? '🟢' : '🟡'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>Taux cotisations (brut→net)</Text>
                      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                        {padrao.liquidRate !== 0.79
                          ? `${Math.round(padrao.liquidRate * 100)}% net · appris depuis tes fiches ✅`
                          : "79% · valeur par défaut — charge une fiche avec brut + net pour l'améliorer"}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 14 }}>{(padrao.fraisFactorReal > 0 && padrao.fraisFactorReal !== 1) || padrao.ptd !== 4.42 ? '🟢' : '🟡'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>Frais (PTD / Déj / Dîner / Nuit)</Text>
                      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                        {padrao.ptd !== 4.42 || (padrao.fraisFactorReal > 0 && padrao.fraisFactorReal !== 1)
                          ? `${padrao.ptd}€ · ${padrao.dej}€ · ${padrao.din}€ · ${padrao.nui}€ · depuis boletins ✅`
                          : 'Valeurs génériques — charge un boletim de frais pour calibrer'}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 14 }}>{padrao.valorDiaConges > 0 ? '🟢' : '🟡'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>Valeur jour congé</Text>
                      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
                        {padrao.valorDiaConges > 0
                          ? `${padrao.valorDiaConges.toFixed(2)} €/j · appris depuis fiches ✅`
                          : `${((padrao.hbase / 22) * padrao.hval).toFixed(2)} €/j estimé (hbase÷22 × taux)`}
                      </Text>
                    </View>
                  </View>

                  <View style={{ marginTop: 4, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 10, padding: 10 }}>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 16 }}>
                      {calcResult.modoCalculo === 'preciso'
                        ? '✅ Mode précis — salaire réel depuis ta fiche de paye confirmée.'
                        : calcResult.modoCalculo === 'calibrado'
                        ? '⚡ Mode calibré — taxa neta moyenne apprise de ton historique. Très fiable.'
                        : '📊 Mode estimé — formule classique. Charge plus de fiches pour améliorer.'}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <TouchableOpacity onPress={() => setShowPrevision(false)} style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>↩ Retour</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : camposOk === 'false' ? (
          <View style={{ marginHorizontal: 20, marginTop: 16, marginBottom: 8, backgroundColor: 'rgba(231,76,60,0.12)', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: 'rgba(231,76,60,0.4)' }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#e74c3c', marginBottom: 10, lineHeight: 21 }}>
              {"⚠️ Pour estimer ton salaire, renseigne d'abord les champs obligatoires dans Réglages."}
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: '#e74c3c', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start' }}
              onPress={async () => {
                  try {
                    const profilOk = !!(await AsyncStorage.getItem('profil'))
                    if (!profilOk) {
                      router.push('/(tabs)/reglages?scrollTo=salaire')
                    } else {
                      router.push('/onboarding?mode=edit')
                    }
                  } catch (e) {
                    console.error('Nav error:', e)
                  }
                }}
            >
              <Text style={{ fontSize: 13, fontWeight: '800', color: 'white' }}>{'→ Aller aux Réglages'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={st.calcularBtn} onPress={calcularSalario} disabled={loading}>
            <Text style={st.calcularIcon}>💰</Text>
            <Text style={st.calcularLabel}>CALCULER</Text>
            <Text style={st.calcularSub}>Combien tu vas recevoir ce mois</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <View style={{
          backgroundColor: precisaoActual >= 95 ? 'rgba(39,174,96,0.3)' : precisaoActual >= 85 ? 'rgba(46,204,113,0.25)' : precisaoActual >= 79 ? 'rgba(243,156,18,0.3)' : 'rgba(231,76,60,0.3)',
                borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3
              }}>
                <Text style={{ fontSize: 11, color: 'white', fontWeight: '700' }}>
                  {precisaoActual >= 85 ? '✅' : precisaoActual >= 79 ? '⚡' : '🔴'} {precisaoActual}% de précision
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>· {historique.length} mois</Text>
            </View>
            {historique.length < 6 && (
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 8, textAlign: 'center' }}>
                {historique.length === 0
                  ? '📊 Charge tes fiches pour démarrer les estimations'
                  : `📊 Encore ${6 - historique.length} mois de fiches pour atteindre 95% de précision`}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {showCadeado && (
          <View style={{ marginHorizontal: 20, marginBottom: 12, backgroundColor: 'rgba(243,156,18,0.12)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(243,156,18,0.5)', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ fontSize: 22 }}>{'\u{1F512}'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: '#f39c12', marginBottom: 6 }}>
                {'2 questions en attente pour activer la pr\u00E9vision'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {perguntaActual && (
                <TouchableOpacity
                  style={{ backgroundColor: '#f39c12', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}
                  onPress={() => setShowModalPerguntas(true)}
                >
                  <Text style={{ fontSize: 12, fontWeight: '800', color: 'white' }}>{'R\u00E9pondre maintenant'}</Text>
                </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={{ borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(243,156,18,0.4)' }}
                  onPress={() => setShowCadeado(false)}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#f39c12' }}>Plus tard</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[st.uploadBtnGrande, { borderColor: '#f5a623', backgroundColor: c.card }]}
          onPress={importerDocumentos} disabled={loading}
        >
          {loading ? (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#f5a623', marginBottom: 14, textAlign: 'center', letterSpacing: 0.5 }}>
                {['📄 Lecture des documents...', '🔍 Analyse en cours...', '🧮 Calcul des montants...', '✨ Presque fini...'][loadingMsg]}
              </Text>
              {/* Cena animada — camião da direita para a esquerda */}
              {(() => {
                const SCENE_W = 240
                const neg = Animated.multiply(scrollAnim, -1)
                const dustOpacity = dustAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.55, 0.25, 0] })
                const dustScale  = dustAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] })
                const dust2Opacity = dustAnim.interpolate({ inputRange: [0, 0.25, 0.65, 1], outputRange: [0, 0.45, 0.15, 0] })
                const dust2Scale   = dustAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 2.2] })
                const dust3Opacity = dustAnim.interpolate({ inputRange: [0, 0.15, 0.5, 1], outputRange: [0, 0.35, 0.1, 0] })
                const dust3Scale   = dustAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.8] })
                const trees: [number, number, number][] = [
                  [195, 435, 52], [148, 388, 36], [105, 345, 26], [60, 300, 44], [22, 262, 20],
                ]
                const roadMarks: number[] = [8, 68, 128, 188]
                const renderTree = (x: number, h: number, key: string) => {
                  const w = h * 0.46
                  return (
                    <Animated.View key={key} style={{ position: 'absolute', bottom: 18, transform: [{ translateX: Animated.add(new Animated.Value(x), neg) }] }}>
                      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
                        <Rect x={(w - 4) / 2} y={h * 0.67} width={4} height={h * 0.33} fill="#3a2010" />
                        <Path d={`M ${w/2} 0 L ${w} ${h*0.67} L 0 ${h*0.67} Z`} fill="#0a240a" />
                        <Path d={`M ${w/2} ${h*0.18} L ${w*0.85} ${h*0.55} L ${w*0.15} ${h*0.55} Z`} fill="#0e300e" />
                      </Svg>
                    </Animated.View>
                  )
                }
                return (
                  <View style={{ width: SCENE_W, height: 118, overflow: 'hidden', backgroundColor: '#07090f', borderRadius: 14, marginBottom: 6 }}>
                    {[[18,8,3],[55,5,2],[90,12,2],[140,4,3],[185,9,2],[210,6,3]].map(([x,y,r],i) => (
                      <View key={i} style={{ position: 'absolute', top: y, left: x, width: r, height: r, borderRadius: r/2, backgroundColor: 'rgba(255,255,220,0.45)' }} />
                    ))}
                    {trees.map(([x1, x2, h], i) => [renderTree(x1, h, `ta${i}`), renderTree(x2, h, `tb${i}`)])}
                    <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 18, backgroundColor: '#10131c' }} />
                    <View style={{ position: 'absolute', bottom: 17, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                    {roadMarks.map((x, i) => [
                      <Animated.View key={`ra${i}`} style={{ position: 'absolute', bottom: 7, height: 2, width: 24, backgroundColor: '#f5a623', opacity: 0.35, borderRadius: 1, transform: [{ translateX: Animated.add(new Animated.Value(x), neg) }] }} />,
                      <Animated.View key={`rb${i}`} style={{ position: 'absolute', bottom: 7, height: 2, width: 24, backgroundColor: '#f5a623', opacity: 0.35, borderRadius: 1, transform: [{ translateX: Animated.add(new Animated.Value(x + SCENE_W), neg) }] }} />,
                    ])}
                    {/* Peira (atras do camiao, lado esquerdo) */}
                    <Animated.View style={{ position: 'absolute', bottom: 22, left: 45, width: 12, height: 8, borderRadius: 6, backgroundColor: 'rgba(180,165,140,0.5)', opacity: dustOpacity, transform: [{ scale: dustScale }] }} />
                    <Animated.View style={{ position: 'absolute', bottom: 26, left: 38, width: 9, height: 6, borderRadius: 5, backgroundColor: 'rgba(170,155,130,0.4)', opacity: dust2Opacity, transform: [{ scale: dust2Scale }] }} />
                    <Animated.View style={{ position: 'absolute', bottom: 20, left: 35, width: 7, height: 5, borderRadius: 4, backgroundColor: 'rgba(160,145,120,0.35)', opacity: dust3Opacity, transform: [{ scale: dust3Scale }] }} />
                    {/* Camiao laranja original, virado a direita */}
                    <View style={{ position: 'absolute', bottom: 18, left: 65 }}>
                      <Svg width={110} height={48} viewBox="0 0 110 48">
                        {/* Reboque */}
                        <Rect x="0" y="8" width="68" height="30" rx="3" fill="#f5a623" opacity={0.9} />
                        <Rect x="4" y="12" width="60" height="8" rx="1" fill="rgba(0,0,0,0.2)" />
                        <Rect x="4" y="23" width="60" height="1" fill="rgba(255,255,255,0.15)" />
                        <Rect x="4" y="27" width="60" height="1" fill="rgba(255,255,255,0.1)" />
                        <Rect x="66" y="20" width="8" height="4" rx="1" fill="#cc8800" />
                        {/* Cabine */}
                        <Rect x="72" y="4" width="36" height="34" rx="4" fill="#e6950f" />
                        <Rect x="80" y="9" width="22" height="14" rx="2" fill="#0f1117" opacity={0.85} />
                        <Rect x="82" y="11" width="6" height="10" rx="1" fill="rgba(255,255,255,0.07)" />
                        <Rect x="105" y="16" width="4" height="18" rx="1" fill="#cc8800" />
                        <Line x1="106" y1="19" x2="108" y2="19" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                        <Line x1="106" y1="23" x2="108" y2="23" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                        <Line x1="106" y1="27" x2="108" y2="27" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                        <Rect x="106" y="13" width="3" height="4" rx="1" fill="#ffe066" />
                        {/* Rodas reboque */}
                        <Circle cx="16" cy="40" r="7" fill="#1a1a2e" stroke="#f5a623" strokeWidth="2" />
                        <Circle cx="16" cy="40" r="2.5" fill="#f5a623" opacity={0.6} />
                        <Circle cx="48" cy="40" r="7" fill="#1a1a2e" stroke="#f5a623" strokeWidth="2" />
                        <Circle cx="48" cy="40" r="2.5" fill="#f5a623" opacity={0.6} />
                        {/* Rodas cabine */}
                        <Circle cx="83" cy="40" r="7" fill="#1a1a2e" stroke="#e6950f" strokeWidth="2" />
                        <Circle cx="83" cy="40" r="2.5" fill="#e6950f" opacity={0.6} />
                        <Circle cx="99" cy="40" r="7" fill="#1a1a2e" stroke="#e6950f" strokeWidth="2" />
                        <Circle cx="99" cy="40" r="2.5" fill="#e6950f" opacity={0.6} />
                      </Svg>
                    </View>
                  </View>
                )
              })()}
              {/* Barra de progresso */}
              <View style={{ width: 180, height: 3, backgroundColor: 'rgba(245,166,35,0.15)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                <Animated.View style={{
                  height: '100%', backgroundColor: '#f5a623', borderRadius: 2,
                  width: `${[25, 50, 75, 95][loadingMsg]}%` as any,
                  opacity: 0.85
                }} />
              </View>
            </View>
          ) : (
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
            const diff6 = Math.abs(est - m.montantTotalRecu)
        // Tolerância realista: ≤30€=100%, ≤70€=98%, ≤120€=95%, ≤200€=88%
        return diff6 <= 30 ? 100 : diff6 <= 70 ? 98 : diff6 <= 120 ? 95 : diff6 <= 200 ? 88
          : Math.max(60, Math.round(100 - Math.min(38, diff6 / m.montantTotalRecu * 100)))
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
                          {precisaoGlobal >= 95 ? '🎯 Excellent !' : precisaoGlobal >= 85 ? `${100 - precisaoGlobal}% pour 100%` : `Objectif 100% — charge plus de fiches`}
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
                              💡 Charge la fiche de {semFiche[0].periode} → précision monte à ~{Math.min(99, precisaoGlobal + 8)}%
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
                        {/* Extras breakdown */}
                        {((m.interessement || 0) > 0 || (m.primeNonAccident || 0) > 0) && (
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                            {(m.interessement || 0) > 0 && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(155,89,182,0.1)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 9, color: '#9b59b6', fontWeight: '700' }}>🤝 Intéressement</Text>
                                <Text style={{ fontSize: 9, color: '#9b59b6', fontWeight: '800' }}>+{Math.round(m.interessement || 0)}€</Text>
                              </View>
                            )}
                            {(m.primeNonAccident || 0) > 0 && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(39,174,96,0.1)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 9, color: '#27ae60', fontWeight: '700' }}>🛡 Non-accident</Text>
                                <Text style={{ fontSize: 9, color: '#27ae60', fontWeight: '800' }}>+{Math.round(m.primeNonAccident || 0)}€</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                      {pctAcerto !== null ? (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 18, fontWeight: '900', color: pctAcerto >= 95 ? '#27ae60' : pctAcerto >= 85 ? '#2ecc71' : pctAcerto >= 75 ? '#f5a623' : '#e74c3c' }}>{pctAcerto}%</Text>
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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: '#f5a623' }}>
            {fichaActual && (() => {
              const dadosFicha = (fichaActual.dados || fichaActual) as any
              const verif = buildVerificacaoCruzada(fichaActual, dadosFicha, padrao, histCal, historique)
              const temDiff = temDiferencasVerif(verif)
              const mesLabel = MESES_PT[fichaActual.moisIndex] || (fichaActual.periode || '').split(' ')[0]
              const diaSal = perguntaAtual === 0 ? (inputDiaSal || String(padrao.diaSalario)) : String(padrao.diaSalario)
              const diaFrais = perguntaAtual === 0 ? (inputDiaFrais || String(padrao.diaFrais)) : String(padrao.diaFrais)
              const [, mesTravIdx] = shiftMois(fichaActual.annee, fichaActual.moisIndex, -padrao.hlag)
              const mesTravail = MESES_PT[mesTravIdx] || ''
              const [, mesFraisIdx] = shiftMois(fichaActual.annee, fichaActual.moisIndex, -padrao.flag)
              const mesFraisTravail = MESES_PT[mesFraisIdx] || ''

              return (
                <>
                  {fiches.length > 1 && (
                    <Text style={{ fontSize: 11, color: c.textSub, textAlign: 'right', marginBottom: 8 }}>
                      {perguntaAtual + 1}/{fiches.length}
                    </Text>
                  )}

                  {temDiff && (
                    <View style={{ marginBottom: 16, padding: 14, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: '#f5a623' }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: c.text, lineHeight: 22, marginBottom: 12 }}>
                        ⚠️ J'ai trouvé des différences entre la fiche et mes calculs. Utiliser les valeurs de la fiche ?
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: verifApplied === 'fiche' ? 'rgba(39,174,96,0.12)' : c.input, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: verifApplied === 'fiche' ? 1.5 : 1, borderColor: verifApplied === 'fiche' ? '#27ae60' : c.cardBorder }}
                          onPress={() => {
                            setSavedSalBeforeVerif(inputMontantSalQ)
                            setSavedFraisBeforeVerif(inputMontantFraisQ)
                            if (verif.salario.fiche > 0) setInputMontantSalQ(String(verif.salario.fiche))
                            if (verif.frais.fiche > 0) setInputMontantFraisQ(String(verif.frais.fiche))
                            setVerifApplied('fiche')
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '800', color: verifApplied === 'fiche' ? '#27ae60' : c.textSub }}>Oui, utiliser la fiche</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, backgroundColor: verifApplied === 'app' ? 'rgba(41,128,185,0.12)' : c.input, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: verifApplied === 'app' ? 1.5 : 1, borderColor: verifApplied === 'app' ? '#2980b9' : c.cardBorder }}
                          onPress={() => {
                            setInputMontantSalQ(savedSalBeforeVerif)
                            setInputMontantFraisQ(savedFraisBeforeVerif)
                            setVerifApplied('app')
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '800', color: verifApplied === 'app' ? '#2980b9' : c.textSub }}>Non, les miens</Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity onPress={() => setShowVerifDetalhes(v => !v)} style={{ alignItems: 'center', paddingVertical: 4 }}>
                        <Text style={{ fontSize: 12, color: c.textSub, textDecorationLine: 'underline' }}>
                          {showVerifDetalhes ? 'Masquer détails' : 'Voir détails'}
                        </Text>
                      </TouchableOpacity>
                      {showVerifDetalhes && (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.25)' }}>
                          <Text style={{ fontSize: 12, color: c.textSub, marginBottom: 4 }}>
                            💰 Salaire — fiche {Math.round(verif.salario.fiche)}€ · app {Math.round(verif.salario.app)}€
                          </Text>
                          <Text style={{ fontSize: 12, color: c.textSub, marginBottom: 4 }}>
                            🍽️ Frais — fiche {verif.frais.fiche.toFixed(2)}€ · app {verif.frais.app.toFixed(2)}€
                          </Text>
                          <Text style={{ fontSize: 12, color: c.textSub }}>
                            ⏱ Heures — fiche {verif.horas.fiche.toFixed(1)}h · calendrier {verif.horas.app.toFixed(1)}h
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 20, lineHeight: 28 }}>
                    Reçu en {mesLabel} {fichaActual.annee} — pour le travail de {mesTravail}
                  </Text>

                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8 }}>
                        💰 Salaire reçu le {diaSal} {mesLabel} (heures de {mesTravail}) — net fiche, sans primes ni frais
                      </Text>
                      <TextInput
                        style={{ backgroundColor: c.input, borderRadius: 12, padding: 14, fontSize: 22, fontWeight: '800', color: '#27ae60', borderWidth: verifApplied ? 2 : 1, borderColor: verifApplied === 'fiche' ? '#f5a623' : verifApplied === 'app' ? '#3498db' : c.cardBorder, textAlign: 'center' }}
                        value={inputMontantSalQ}
                        onChangeText={(v) => { setInputMontantSalQ(v); setVerifApplied(false) }}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={c.textSub}
                        autoFocus={!temDiff}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8 }}>
                        🍽️ Frais reçus le {diaFrais} {mesLabel} (frais de {mesFraisTravail}) — total indemnités reçues
                      </Text>
                      <TextInput
                        style={{ backgroundColor: c.input, borderRadius: 12, padding: 14, fontSize: 22, fontWeight: '800', color: '#2980b9', borderWidth: verifApplied ? 2 : 1, borderColor: verifApplied === 'fiche' ? '#f5a623' : verifApplied === 'app' ? '#3498db' : c.cardBorder, textAlign: 'center' }}
                        value={inputMontantFraisQ}
                        onChangeText={(v) => { setInputMontantFraisQ(v); setVerifApplied(false) }}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={c.textSub}
                      />
                    </View>
                  </View>
                  {/* Primes (pré-preenchidas pela IA, editáveis) */}
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#9b59b6', marginBottom: 6 }}>🤝 INTÉRESSEMENT</Text>
                      <TextInput
                        style={{ backgroundColor: c.input, borderRadius: 10, padding: 10, fontSize: 15, fontWeight: '700', color: '#9b59b6', borderWidth: inputInteressementQ ? 1.5 : 1, borderColor: inputInteressementQ ? '#9b59b6' : c.cardBorder, textAlign: 'center' }}
                        value={inputInteressementQ}
                        onChangeText={setInputInteressementQ}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={c.textSub}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#27ae60', marginBottom: 6 }}>🛡 NON-ACCIDENT</Text>
                      <TextInput
                        style={{ backgroundColor: c.input, borderRadius: 10, padding: 10, fontSize: 15, fontWeight: '700', color: '#27ae60', borderWidth: inputPrimeNonAccQ ? 1.5 : 1, borderColor: inputPrimeNonAccQ ? '#27ae60' : c.cardBorder, textAlign: 'center' }}
                        value={inputPrimeNonAccQ}
                        onChangeText={setInputPrimeNonAccQ}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={c.textSub}
                      />
                    </View>
                  </View>

                  {/* ── Ce mois était-il normal ? ── */}
                  <Text style={{ fontSize: 13, fontWeight: '700', color: c.text, marginBottom: 8 }}>Ce mois était-il habituel ?</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                    <TouchableOpacity
                      onPress={() => setInputMoisAtipico(false)}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: !inputMoisAtipico ? 'rgba(39,174,96,0.12)' : c.input, borderWidth: !inputMoisAtipico ? 1.5 : 1, borderColor: !inputMoisAtipico ? '#27ae60' : c.cardBorder }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '800', color: !inputMoisAtipico ? '#27ae60' : c.textSub }}>✅ Oui, normal</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setInputMoisAtipico(true)}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: inputMoisAtipico ? 'rgba(231,76,60,0.12)' : c.input, borderWidth: inputMoisAtipico ? 1.5 : 1, borderColor: inputMoisAtipico ? '#e74c3c' : c.cardBorder }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '800', color: inputMoisAtipico ? '#e74c3c' : c.textSub }}>⚠️ Non, exceptionnel</Text>
                    </TouchableOpacity>
                  </View>
                  {!inputMoisAtipico && (
                    <Text style={{ fontSize: 11, color: c.textSub, textAlign: 'center', marginBottom: 12, lineHeight: 16 }}>
                      Mois classique — sera utilisé pour calibrer les estimations.
                    </Text>
                  )}
                  {inputMoisAtipico && (
                    <Text style={{ fontSize: 11, color: '#e74c3c', textAlign: 'center', marginBottom: 12, lineHeight: 16 }}>
                      Ex : congés, maladie, prime annuelle, acompte… Ce mois ne calibrera pas les estimations.
                    </Text>
                  )}

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      style={{ padding: 14, alignItems: 'center' }}
                      onPress={() => {
                        if (perguntaAtual > 0) {
                          const popped = respostas[respostas.length - 1]
                          if (popped) {
                            setInputMontantSalQ((popped.montantSalReel || 0) > 0 ? String(Math.round((popped.montantSalReel || 0) * 100) / 100) : '')
                            setInputMontantFraisQ((popped.montantFraisReel || 0) > 0 ? String(Math.round((popped.montantFraisReel || 0) * 100) / 100) : '')
                          setInputMoisAtipico(popped.moisAtipico || false)
                          setInputInteressementQ((popped.interessementQ || 0) > 0 ? String(Math.round((popped.interessementQ || 0) * 100) / 100) : '')
                          setInputPrimeNonAccQ((popped.primeNonAccQ || 0) > 0 ? String(Math.round((popped.primeNonAccQ || 0) * 100) / 100) : '')
                          }
                          setRascunhoActual({
                            index: perguntaAtual,
                            montantSalReel: parseFloat(inputMontantSalQ) || 0,
                            montantFraisReel: parseFloat(inputMontantFraisQ) || 0,
                            interessementQ: parseFloat(inputInteressementQ) || 0,
                            primeNonAccQ: parseFloat(inputPrimeNonAccQ) || 0,
                            moisAtipico: inputMoisAtipico,
                          })
                          setPerguntaAtual(perguntaAtual - 1)
                          setRespostas(respostas.slice(0, -1))
                          setShowVerifDetalhes(false)
                          setVerifApplied(false)
                        } else {
                          setShowModalCancelar(true)
                        }
                      }}
                    >
                      <Text style={{ fontSize: 14, color: c.textSub }}>{perguntaAtual > 0 ? '←' : 'Annuler'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, backgroundColor: '#f5a623', borderRadius: 14, padding: 16, alignItems: 'center' }}
                      onPress={responderPergunta}
                    >
                      <Text style={{ fontSize: 16, fontWeight: '800', color: 'white' }}>
                        {perguntaAtual < fiches.length - 1 ? 'Suivant →' : 'Enregistrer'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )
            })()}
          </View>
          </ScrollView>
          </KeyboardAvoidingView>
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
              {(modalDetail?.interessement || 0) > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: c.textSub, fontSize: 13 }}>🤝 Intéressement</Text>
                  <Text style={{ color: '#9b59b6', fontWeight: '700', fontSize: 13 }}>+{fmt(modalDetail?.interessement || 0)}</Text>
                </View>
              )}
              {(modalDetail?.primeNonAccident || 0) > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: c.textSub, fontSize: 13 }}>🛡 Prime non-accident</Text>
                  <Text style={{ color: '#27ae60', fontWeight: '700', fontSize: 13 }}>+{fmt(modalDetail?.primeNonAccident || 0)}</Text>
                </View>
              )}
              {(modalDetail?.primeExceptionnelle || 0) > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: c.textSub, fontSize: 13 }}>🎁 Prime exceptionnelle</Text>
                  <Text style={{ color: '#9b59b6', fontWeight: '700', fontSize: 13 }}>+{fmt(modalDetail?.primeExceptionnelle || 0)}</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.textSub, fontSize: 13 }}>Frais reçus</Text>
                <Text style={{ color: '#2980b9', fontWeight: '700', fontSize: 13 }}>{fmt(modalDetail?.fraisRecuConfirme || modalDetail?.fraisBoletim || modalDetail?.remboursementFrais || 0)}</Text>
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
                setEditNetPaye(parseFloat((modalDetail.netPaye || 0).toFixed(2)).toString())
                setEditFraisBoletim(parseFloat((modalDetail.fraisRecuConfirme || modalDetail.fraisBoletim || modalDetail.remboursementFrais || 0).toFixed(2)).toString())
                setEditMontantTotal(parseFloat((modalDetail.montantTotalRecu || 0).toFixed(2)).toString())
                setEditMoisIndex(modalDetail.moisIndex)
                setEditAnnee(modalDetail.annee)
                setEditInteressement(String(modalDetail.interessement || 0))
                setEditMoisAtipico(modalDetail?.moisAtipico || false)
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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
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
          </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* MODAL SALAIRE NET RÉEL */}
      <Modal visible={showModalSalNet} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: '#27ae60' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>💰 Confirmer le salaire net</Text>
            <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 6 }}>
              Estimé pour <Text style={{ color: '#f5a623', fontWeight: '700' }}>{calcResult?.mesReceber}</Text>
            </Text>
            <Text style={{ fontSize: 11, color: '#f39c12', textAlign: 'center', marginBottom: 14, lineHeight: 16 }}>
              Entre le net récurrent (sans primes). L'IA améliore les prochaines estimations.
            </Text>

            {/* Salaire net base */}
            <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', marginBottom: 6 }}>💶 SALAIRE NET RÉEL (hors primes)</Text>
            <TextInput
              style={{ backgroundColor: c.input, borderRadius: 12, padding: 12, fontSize: 22, fontWeight: '800', color: c.text, borderWidth: 1.5, borderColor: '#27ae60', textAlign: 'center', marginBottom: 14 }}
              value={inputSalNet}
              onChangeText={setInputSalNet}
              keyboardType="decimal-pad"
              placeholder="ex: 2748.25"
              placeholderTextColor={c.textSub}
              autoFocus
            />

            {/* Extras */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, color: '#9b59b6', fontWeight: '700', marginBottom: 5 }}>🤝 INTÉRESSEMENT (€)</Text>
                <TextInput
                  style={{ backgroundColor: c.input, borderRadius: 10, padding: 10, fontSize: 16, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: inputInteressement ? '#9b59b6' : c.cardBorder, textAlign: 'center' }}
                  value={inputInteressement}
                  onChangeText={setInputInteressement}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={c.textSub}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, color: '#27ae60', fontWeight: '700', marginBottom: 5 }}>🛡 NON-ACCIDENT (€)</Text>
                <TextInput
                  style={{ backgroundColor: c.input, borderRadius: 10, padding: 10, fontSize: 16, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: inputPrimeNonAcc ? '#27ae60' : c.cardBorder, textAlign: 'center' }}
                  value={inputPrimeNonAcc}
                  onChangeText={setInputPrimeNonAcc}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={c.textSub}
                />
              </View>
            </View>

            {/* Total preview */}
            {inputSalNet ? (
              <View style={{ backgroundColor: 'rgba(39,174,96,0.08)', borderRadius: 10, padding: 10, marginBottom: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: c.textSub }}>Total estimé reçu</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#27ae60' }}>
                  {Math.round((parseFloat(inputSalNet.replace(',','.')) || 0) + (parseFloat(inputInteressement.replace(',','.')) || 0) + (parseFloat(inputPrimeNonAcc.replace(',','.')) || 0) + (calcResult?.totalFrais || 0)).toLocaleString('fr-FR')} €
                </Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => { setShowModalSalNet(false); setInputInteressement(''); setInputPrimeNonAcc('') }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, backgroundColor: '#27ae60', borderRadius: 12, padding: 14, alignItems: 'center' }}
                onPress={async () => {
                  const salReel = parseFloat(inputSalNet.replace(',', '.')) || 0
                  const extraInteressement = parseFloat(inputInteressement.replace(',', '.')) || 0
                  const extraNonAcc = parseFloat(inputPrimeNonAcc.replace(',', '.')) || 0
                  const totalExtras = extraInteressement + extraNonAcc
                  if (salReel > 0 && calcResult) {
                    const novoTotal = salReel + calcResult.totalFrais + totalExtras
                    setCalcResult({ ...calcResult, salLiq: salReel, totalLiq: novoTotal, salConfirmado: true })
                    setCountingVal(Math.round(novoTotal))

                    const [mesReceberLabel] = calcResult.mesReceber.split(' ')
                    const mesIdx = moisLabelToIndex(mesReceberLabel)
                    const ano = parseInt(calcResult.mesReceber.split(' ')[1]) || new Date().getFullYear()
                    let novoHist = aplicarConfirmacaoSalarioPorValor(
                      historique,
                      salReel,
                      ano,
                      mesIdx >= 0 ? mesIdx : new Date().getMonth(),
                      novoTotal,
                      padrao,
                      { entreprise: calcResult.empresa || '', frais: calcResult.totalFrais },
                    )
                    // Add extras to the confirmed entry
                    if (totalExtras > 0) {
                      const targetPeriode = `${MOIS_NOMS[mesIdx >= 0 ? mesIdx : new Date().getMonth()]} ${ano}`
                      novoHist = novoHist.map(h =>
                        (h.periode === targetPeriode || (h.moisIndex === (mesIdx >= 0 ? mesIdx : new Date().getMonth()) && h.annee === ano))
                          ? { ...h, interessement: extraInteressement || h.interessement, primeNonAccident: extraNonAcc || h.primeNonAccident, montantTotalRecu: novoTotal }
                          : h
                      )
                    }
                    novoHist.sort((a, b) => a.annee !== b.annee ? a.annee - b.annee : a.moisIndex - b.moisIndex)
                    setHistorique(novoHist)
                    await AsyncStorage.setItem('monSalaire_v2', JSON.stringify(novoHist))

                    const histCal = JSON.parse(await AsyncStorage.getItem('historique') || '[]')
                    const novoPadrao = analisarPadraoV2(novoHist, histCal, padrao)
                    setPadrao(novoPadrao)
                    await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(novoPadrao))
                  }
                  setShowModalSalNet(false)
                  setInputInteressement('')
                  setInputPrimeNonAcc('')
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>✅ Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
          </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* MODAL EDITAR */}
      <Modal visible={showModalEdit} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: '#f5a623' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 4, textAlign: 'center' }}>✏️ Modifier {modalDetail?.periode}</Text>
            <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 20 }}>Corrige les valeurs incorrectes</Text>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ gap: 12, marginBottom: 20 }}>
              <View>
                <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>NET PAYÉ DE LA FICHE (€) — sans frais, sans primes exceptionnelles</Text>
                <TextInput style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, fontSize: 18, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }} value={editNetPaye} onChangeText={setEditNetPaye} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textSub} />
              </View>
              <View>
                <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>FRAIS REÇUS (€) — indemnités repas + découché</Text>
                <TextInput style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, fontSize: 18, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }} value={editFraisBoletim} onChangeText={setEditFraisBoletim} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textSub} />
              </View>
              <View>
                <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>TOTAL REÇU (€) — calculé automatiquement</Text>
                <View style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#f5a623', alignItems: 'center' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#f5a623' }}>
                    {((parseFloat(editNetPaye) || 0) + (parseFloat(editFraisBoletim) || 0)).toFixed(2)}
                  </Text>
                </View>
              </View>
              <View>
                <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>INTÉRESSEMENT (€) — 0 pour effacer</Text>
                <TextInput style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, fontSize: 18, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }} value={editInteressement} onChangeText={setEditInteressement} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={c.textSub} />
              </View>
            </View>
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>PÉRIODE</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <TouchableOpacity onPress={() => {
                  setEditMoisIndex(editMoisIndex - 1 < 0 ? 11 : editMoisIndex - 1)
                  setEditAnnee(editMoisIndex - 1 < 0 ? editAnnee - 1 : editAnnee)
                }} style={{ padding: 10 }}>
                  <Text style={{ fontSize: 22, color: '#f5a623' }}>◀</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, minWidth: 140, textAlign: 'center' }}>
                  {['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'][editMoisIndex]} {editAnnee}
                </Text>
                <TouchableOpacity onPress={() => {
                  setEditMoisIndex(editMoisIndex + 1 > 11 ? 0 : editMoisIndex + 1)
                  setEditAnnee(editMoisIndex + 1 > 11 ? editAnnee + 1 : editAnnee)
                }} style={{ padding: 10 }}>
                  <Text style={{ fontSize: 22, color: '#f5a623' }}>▶</Text>
                </TouchableOpacity>
              </View>
            </View>
            </ScrollView>
            <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 6, marginTop: 12 }}>CE MOIS ÉTAIT-IL HABITUEL ?</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, padding: 10, borderRadius: 10, alignItems: 'center', backgroundColor: !editMoisAtipico ? 'rgba(39,174,96,0.2)' : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: !editMoisAtipico ? '#27ae60' : 'rgba(255,255,255,0.1)' }}
                onPress={() => setEditMoisAtipico(false)}
              >
                <Text style={{ color: !editMoisAtipico ? '#27ae60' : '#aaa', fontSize: 12, fontWeight: '700' }}>✅ Oui, normal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, padding: 10, borderRadius: 10, alignItems: 'center', backgroundColor: editMoisAtipico ? 'rgba(243,156,18,0.2)' : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: editMoisAtipico ? '#f39c12' : 'rgba(255,255,255,0.1)' }}
                onPress={() => setEditMoisAtipico(true)}
              >
                <Text style={{ color: editMoisAtipico ? '#f39c12' : '#aaa', fontSize: 12, fontWeight: '700' }}>⚠️ Non, exceptionnel</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowModalEdit(false)}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={async () => {
                if (!modalDetail) return
                const netEdit = parseFloat(editNetPaye) || 0
                const fraisEdit = parseFloat(editFraisBoletim) || 0
                const totalEdit = (parseFloat(editNetPaye) || 0) + (parseFloat(editFraisBoletim) || 0)
                const moisNoms = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
                const novePeriode = `${moisNoms[editMoisIndex]} ${editAnnee}`
                const interessEdit = parseFloat(editInteressement) || 0
                const updated = {
                  ...modalDetail,
                  periode: novePeriode,
                  moisIndex: editMoisIndex,
                  annee: editAnnee,
                  mesFicheIndex: editMoisIndex,
                  anoFiche: editAnnee,
                  netPaye: netEdit,
                  fraisBoletim: fraisEdit,
                  remboursementFrais: fraisEdit > 0 ? fraisEdit : modalDetail.remboursementFrais,
                  fraisRecuConfirme: fraisEdit > 0 ? fraisEdit : modalDetail.fraisRecuConfirme,
                  montantTotalRecu: totalEdit,
                  interessement: interessEdit,
                  salarioConfirmado: netEdit > 0,
                  fraisConfirmado: fraisEdit > 0,
                  moisAtipico: editMoisAtipico,
                  pagamentoSalMesIndex: modalDetail.pagamentoSalMesIndex ?? editMoisIndex,
                  pagamentoSalAno: modalDetail.pagamentoSalAno ?? editAnnee,
                  pagamentoFraisMesIndex: modalDetail.pagamentoFraisMesIndex ?? editMoisIndex,
                  pagamentoFraisAno: modalDetail.pagamentoFraisAno ?? editAnnee,
                }
                // Remove old entry (old periode), insert updated, re-sort
                const nova = historique.filter(h => h.periode !== modalDetail.periode)
                nova.push(updated)
                nova.sort((a, b) => a.annee !== b.annee ? a.annee - b.annee : a.moisIndex - b.moisIndex)
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
        </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── ONBOARDING SALAIRE ── */}
      <Modal visible={showOnboardingSalaire} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#f5a623' }}>

            {/* Header + progress */}
            <Text style={{ fontSize: 17, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>💰 Mon Salaire</Text>
            <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 14 }}>Étape {onbStep} / 4</Text>
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: 22 }}>
              {[1,2,3,4].map(s => (
                <View key={s} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: s <= onbStep ? '#f5a623' : c.cardBorder }} />
              ))}
            </View>

            {/* ── ÉTAPE 1 : type de véhicule ── */}
            {/* ── ÉTAPE 1 : décalage salaire ── */}
            {onbStep === 1 && (
              <>
                <Text style={{ fontSize: 15, fontWeight: '800', color: c.text, marginBottom: 6 }}>📅 Les heures de Janvier — tu les reçois quel mois ?</Text>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 16, lineHeight: 18 }}>
                  Tu as travaillé en <Text style={{ color: '#f5a623', fontWeight: '700' }}>Janvier</Text> — ce bulletin de salaire, tu le reçois en quel mois ?
                </Text>
                <View style={{ gap: 8, marginBottom: 20 }}>
                  {[
                    { lag: 0, label: 'Janvier même', sub: 'même mois que le travail' },
                    { lag: 1, label: 'Février',       sub: '1 mois après' },
                    { lag: 2, label: 'Mars',           sub: '2 mois après' },
                    { lag: 3, label: 'Avril',          sub: '3 mois après' },
                  ].map(({ lag, label, sub }) => (
                    <TouchableOpacity
                      key={lag}
                      onPress={() => setOnbHlag(lag)}
                      style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: onbHlag === lag ? 'rgba(245,166,35,0.12)' : c.input, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: onbHlag === lag ? 1.5 : 1, borderColor: onbHlag === lag ? '#f5a623' : c.cardBorder }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '800', color: onbHlag === lag ? '#f5a623' : c.text }}>{label}</Text>
                      <Text style={{ fontSize: 11, color: onbHlag === lag ? '#f5a623' : c.textSub }}>{sub}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={async () => { await AsyncStorage.setItem('onboarding_salaire_done','true'); setShowOnboardingSalaire(false) }} style={{ flex: 1, borderRadius: 14, padding: 13, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>{'<-'} Retour</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setOnbStep(2)} style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 14, padding: 13, alignItems: 'center' }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>Suivant {'->'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* ── ÉTAPE 4 : jour du salaire ── */}
            {onbStep === 2 && (
              <>
                <Text style={{ fontSize: 15, fontWeight: '800', color: c.text, marginBottom: 6 }}>📆 Quel jour tombe ton salaire ?</Text>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 16 }}>Le jour du mois où l'argent arrive sur ton compte.</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <TextInput
                    value={onbDiaSalario > 0 ? String(onbDiaSalario) : ''}
                    onChangeText={v => { const n = parseInt(v.replace(/[^0-9]/g,'')) || 0; if (n >= 1 && n <= 31) setOnbDiaSalario(n) }}
                    keyboardType='number-pad'
                    maxLength={2}
                    placeholder='ex: 5'
                    placeholderTextColor={c.textSub}
                    style={{ flex: 1, backgroundColor: c.input, borderRadius: 12, borderWidth: 1.5, borderColor: '#f5a623', padding: 14, fontSize: 28, fontWeight: '800', color: '#f5a623', textAlign: 'center' }}
                  />
                  <Text style={{ fontSize: 13, color: c.textSub, flex: 2, lineHeight: 20 }}>{'Saisir le jour du mois (1–31) où ton salaire arrive sur ton compte.'}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => setOnbStep(1)} style={{ flex: 1, borderRadius: 14, padding: 13, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>{'<-'} Retour</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setOnbStep(3)} style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 14, padding: 13, alignItems: 'center' }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>Suivant {'->'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* ── ÉTAPE 5 : décalage frais + jour ── */}
            {onbStep === 3 && (
              <>
                <Text style={{ fontSize: 15, fontWeight: '800', color: c.text, marginBottom: 6 }}>🚛 Les frais de Janvier — tu les reçois quel mois ?</Text>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 12, lineHeight: 18 }}>
                  Tes frais de <Text style={{ color: '#f5a623', fontWeight: '700' }}>Janvier</Text> (découchés, repas...) tombent en...
                </Text>
                <View style={{ gap: 7, marginBottom: 14 }}>
                  {[
                    { lag: 0, label: 'Janvier même', sub: 'même mois' },
                    { lag: 1, label: 'Février',       sub: '1 mois après' },
                    { lag: 2, label: 'Mars',           sub: '2 mois après' },
                  ].map(({ lag, label, sub }) => (
                    <TouchableOpacity
                      key={lag}
                      onPress={() => setOnbFlag(lag)}
                      style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: onbFlag === lag ? 'rgba(245,166,35,0.12)' : c.input, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: onbFlag === lag ? 1.5 : 1, borderColor: onbFlag === lag ? '#f5a623' : c.cardBorder }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '800', color: onbFlag === lag ? '#f5a623' : c.text }}>{label}</Text>
                      <Text style={{ fontSize: 11, color: onbFlag === lag ? '#f5a623' : c.textSub }}>{sub}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSub, marginBottom: 8 }}>Quel jour du mois ?</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                  <TextInput
                    value={onbDiaFrais > 0 ? String(onbDiaFrais) : ''}
                    onChangeText={v => { const n = parseInt(v.replace(/[^0-9]/g,'')) || 0; if (n >= 1 && n <= 31) setOnbDiaFrais(n) }}
                    keyboardType='number-pad'
                    maxLength={2}
                    placeholder='ex: 10'
                    placeholderTextColor={c.textSub}
                    style={{ flex: 1, backgroundColor: c.input, borderRadius: 12, borderWidth: 1.5, borderColor: '#f5a623', padding: 14, fontSize: 28, fontWeight: '800', color: '#f5a623', textAlign: 'center' }}
                  />
                  <Text style={{ fontSize: 13, color: c.textSub, flex: 2, lineHeight: 20 }}>{'Saisir le jour du mois (1–31) où tes frais arrivent.'}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => setOnbStep(2)} style={{ flex: 1, borderRadius: 14, padding: 13, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>{'<-'} Retour</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setOnbStep(4)} style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 14, padding: 13, alignItems: 'center' }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>Suivant {'->'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* ── ÉTAPE 4 : frais sur fiche ou séparé ── */}
            {onbStep === 4 && (
              <>
                <Text style={{ fontSize: 15, fontWeight: '800', color: c.text, marginBottom: 6 }}>{'📄'} Comment arrivent tes frais ?</Text>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 16, lineHeight: 18 }}>
                  Est-ce que tes indemnites de repas et de decouches apparaissent sur ta fiche de paye, ou arrivent dans un document / virement separe ?
                </Text>
                <View style={{ gap: 8, marginBottom: 22 }}>
                  <TouchableOpacity
                    onPress={() => setOnbFraisSepare(false)}
                    style={{ paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, backgroundColor: !onbFraisSepare ? 'rgba(245,166,35,0.12)' : c.input, borderWidth: !onbFraisSepare ? 1.5 : 1, borderColor: !onbFraisSepare ? '#f5a623' : c.cardBorder }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '800', color: !onbFraisSepare ? '#f5a623' : c.text }}>Sur ma fiche de paye</Text>
                    <Text style={{ fontSize: 11, color: !onbFraisSepare ? '#f5a623' : c.textSub, marginTop: 2 }}>Remboursement frais visible sur le bulletin</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setOnbFraisSepare(true)}
                    style={{ paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, backgroundColor: onbFraisSepare ? 'rgba(245,166,35,0.12)' : c.input, borderWidth: onbFraisSepare ? 1.5 : 1, borderColor: onbFraisSepare ? '#f5a623' : c.cardBorder }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '800', color: onbFraisSepare ? '#f5a623' : c.text }}>Document / virement separe</Text>
                    <Text style={{ fontSize: 11, color: onbFraisSepare ? '#f5a623' : c.textSub, marginTop: 2 }}>Les frais n'apparaissent pas sur le bulletin de salaire</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => setOnbStep(3)} style={{ flex: 1, borderRadius: 14, padding: 13, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>{'<-'} Retour</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={async () => {
                      const hval = padrao.hval ?? DEF_SAL.hval
                      const liquidRate = padrao.liquidRate ?? DEF_SAL.liquidRate
                      const newPadrao = {
                        ...padrao,
                        hlag: onbHlag, flag: onbFlag, fraisSepare: onbFraisSepare,
                        diaSalario: onbDiaSalario, diaFrais: onbDiaFrais,
                        vehiculo: onbVehiculo,
                        cargo: onbCargo,
                      }
                      setPadrao(newPadrao)
                      await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(newPadrao))
                      await AsyncStorage.setItem('onboarding_salaire_done', 'true')
                      setShowOnboardingSalaire(false)
                      setOnbStep(1)
                    }}
                    style={{ flex: 2, backgroundColor: '#27ae60', borderRadius: 14, padding: 13, alignItems: 'center' }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>{"C'est parti !"}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

          </View>
        </View>
      </Modal>
      {/* MODAL CONFIRMAÇÃO RÁPIDA DO TIMING */}
      <Modal visible={showConfirmTiming} transparent animationType="fade" onRequestClose={() => setShowConfirmTiming(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 18, padding: 24, width: '100%', borderWidth: 1, borderColor: c.cardBorder }}>
            <Text style={{ fontSize: 12, color: c.textSub, marginBottom: 6, textAlign: 'center', letterSpacing: 1, fontWeight: '700' }}>CONFIRMATION DU PAIEMENT</Text>
            <Text style={{ fontSize: 28, fontWeight: '900', color: c.text, textAlign: 'center', marginBottom: 4 }}>
              {'💰 '}{confirmTimingNet > 0 ? confirmTimingNet.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}{'\u20AC'}
            </Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 16 }}>{confirmTimingPeriode}</Text>
            <View style={{ backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)' }}>
              <Text style={{ fontSize: 15, color: c.text, textAlign: 'center', lineHeight: 24 }}>
                {'Reçu en '}<Text style={{ fontWeight: '800', color: '#f5a623' }}>{confirmTimingMesPag}</Text>{'\n'}
                {'le jour '}<Text style={{ fontWeight: '800', color: '#f5a623' }}>{padraoAprendido.diaSalario}</Text>
              </Text>
              <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginTop: 6 }}>{'C\'est correct\u00A0?'}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#2ecc71', alignItems: 'center' }}
                onPress={confirmarTimingEProsseguir}
              >
                <Text style={{ fontWeight: '800', color: '#fff', fontSize: 15 }}>{'✅ Oui'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#f5a623', alignItems: 'center' }}
                onPress={() => { setShowConfirmTiming(false); processarPerguntas(pendingDocsRef.current, { ...padraoAprendido, hlagConfirmado: false, flagConfirmado: false }) }}
              >
                <Text style={{ fontWeight: '800', color: '#f5a623', fontSize: 15 }}>{'✏️ Corriger'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* MODAL MOTOR DE APRENDIZAGEM */}
      <Modal visible={showModalPerguntas} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
              <View style={{ width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
              <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 16 }}>
                {'\u{1F4CA} Une question rapide'}
              </Text>
              {perguntaActual && (
                <>
                  <Text style={{ fontSize: 14, color: c.textSub, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>
                    {perguntaActual.pergunta}
                  </Text>
                  {(perguntaActual.tipo === 'timing_salario' || perguntaActual.tipo === 'timing_frais') && (
                    <View style={{ gap: 12, marginBottom: 16 }}>
                      <View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSub, marginBottom: 6 }}>DATE DE PAIEMENT</Text>
                        <TouchableOpacity
                          style={{ backgroundColor: c.input, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: respostaData ? '#f5a623' : c.cardBorder, alignItems: 'center' }}
                          onPress={() => {
                            const parts = respostaData ? respostaData.split('/') : []
                            const initDate = parts.length === 3 ? new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])) : new Date()
                            DateTimePickerAndroid.open({
                              value: isNaN(initDate.getTime()) ? new Date() : initDate,
                              mode: 'date',
                              onChange: (_, date) => {
                                if (date) {
                                  const dd = String(date.getDate()).padStart(2, '0')
                                  const mm = String(date.getMonth() + 1).padStart(2, '0')
                                  const yyyy = date.getFullYear()
                                  setRespostaData(`${dd}/${mm}/${yyyy}`)
                                }
                              }
                            })
                          }}
                        >
                          <Text style={{ fontSize: 16, color: respostaData ? c.text : c.textSub, fontWeight: '600' }}>
                            {respostaData || '📅 Choisir la date'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSub, marginBottom: 8 }}>CE PAIEMENT CORRESPOND AU TRAVAIL DE QUEL MOIS ?</Text>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          {[0,1,2,3].map((offset: number) => {
                            const base = respostaData ? (() => {
                              const [dd, mm, yyyy] = respostaData.split('/')
                              return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
                            })() : new Date()
                            const d = new Date(base)
                            d.setMonth(d.getMonth() - offset)
                            const idx = d.getMonth()
                            const yr = d.getFullYear()
                            const label = MOIS_NOMS[idx] + ' ' + yr
                            return (
                              <TouchableOpacity
                                key={offset}
                                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: respostaMes === idx ? 2 : 1, borderColor: respostaMes === idx ? '#f5a623' : c.cardBorder, backgroundColor: respostaMes === idx ? 'rgba(245,166,35,0.1)' : c.input }}
                                onPress={() => { setRespostaMes(idx); setRespostaMesAno(yr); setRespostaMesManual(true) }}
                              >
                                <Text style={{ fontSize: 12, fontWeight: '700', color: respostaMes === idx ? '#f5a623' : c.textSub }}>{label}</Text>
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                      </View>
                    </View>
                  )}
                  {perguntaActual.opcoes && perguntaActual.tipo !== 'timing_salario' && perguntaActual.tipo !== 'timing_frais' && (
                    <View style={{ gap: 8, marginBottom: 16 }}>
                      {perguntaActual.opcoes.map((op: string, i: number) => (
                        <TouchableOpacity
                          key={i}
                          style={{ backgroundColor: c.input, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.cardBorder }}
                          onPress={() => handleResponderPergunta(op)}
                        >
                          <Text style={{ fontSize: 14, fontWeight: '700', color: c.text, textAlign: 'center' }}>{op}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  {(!perguntaActual.opcoes || perguntaActual.tipo === 'timing_salario' || perguntaActual.tipo === 'timing_frais') && (
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity
                        style={{ flex: 1, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}
                        onPress={() => { setShowModalPerguntas(false); setRespostaData(''); setRespostaMes(null); setRespostaMesAno(new Date().getFullYear()) }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Plus tard</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 14, padding: 14, alignItems: 'center' }}
                        onPress={() => {
                          const rep = respostaData || (respostaMes !== null ? String(respostaMes) : '')
                          if (!rep) { Alert.alert('', 'Choisis une date et un mois avant de confirmer'); return }
                          handleResponderPergunta(rep); setRespostaData(''); setRespostaMes(null); setRespostaMesAno(new Date().getFullYear())
                        }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>Confirmer</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
              {!perguntaActual && (
                <TouchableOpacity
                  style={{ padding: 14, alignItems: 'center' }}
                  onPress={() => setShowModalPerguntas(false)}
                >
                  <Text style={{ color: '#aaa', fontSize: 14 }}>Fermer</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
          </KeyboardAvoidingView>
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
