import { Swipeable } from 'react-native-gesture-handler'
import React, { useState, useEffect, useRef } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, TextInput, Animated, Easing } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../context/ThemeContext'

const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? ''

// Valeurs par défaut convention transport français
const DEF_SAL = {
  hbase: 169, hval: 14.76, h25: 18.45, lim25: 17, h50: 22.31,
  hlag: 2, flag: 1, liquidRate: 0.79,
  ptd: 4.42, dej: 16.36, din: 23.94, nui: 23.94,
  valorDiaConges: 0, valorDiaFerie: 0,
}

type MoisData = {
  periode: string; moisIndex: number; annee: number; fichePages: number
  netPaye: number; salairebrut: number; totalCotisations: number
  remboursementFrais: number; fraisBoletim: number; montantTotalRecu: number
  jourPaiement1: number; jourPaiement2: number; analysedAt: string
  entreprise: string; conducteur: string
  // Campos novos extraídos pela IA das fiches
  joursConges?: number; montantConges?: number
  joursFeries?: number; montantFeries?: number
  joursRC?: number; totalHeures?: number
  // Coeficientes salariais reais extraídos da fiche
  hbase?: number; hval?: number; h25?: number; lim25?: number; h50?: number
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
  valorDiaConges: number; valorDiaFerie: number
}

type DocumentoAnalysado = {
  tipo: 'fiche' | 'frais'; periode: string; moisIndex: number; annee: number; dados: any
}

type CalcResult = {
  totalH: number; totalFrais: number; salBrut: number; salLiq: number
  totalLiq: number; jours: number; hExtra25: number; hExtra50: number
  mesReceber: string; diaReceber: number; diaFrais: number
  empresa: string; precisao: number; mesAberto: boolean
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
  const isDec = type === 'dec' || type === 'DEC'
  const start = pT(inicio)
  const end = pT(fim)

  // Pt.D: entrada ≤ 06:00 OU dia após découché OU próprio découché
  const ptd = (start !== null && start <= 6.0) || prevDec || isDec ? 1 : 0

  // Amplitude sem pausa (para frais a pausa não conta)
  const amp = start !== null && end !== null ? end - start : 0

  // Déjeuner: amplitude ≥ 6h01 OU découché
  const dej = amp >= 6.017 || isDec ? 1 : 0

  // Dîner: saída ≥ 21:15 OU découché
  const din = (end !== null && end >= 21.25) || isDec ? 1 : 0

  // Nuit: só découché
  const nui = isDec ? 1 : 0

  const total = ptd * p.ptd + dej * p.dej + din * p.din + nui * p.nui
  return { ptd, dej, din, nui, total }
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
    const prevDec = i > 0 && ['dec', 'DEC'].includes(diasMes[i - 1].type || '')

    // Use pre-calculated frais from historique if available
    if (j.frais != null && j.frais > 0 && ['work', 'dec', 'TRAB', 'DEC'].includes(type)) {
      total += j.frais
      // Estimate breakdown from stored value (fallback: count as ptd)
      ptd += 1
    } else if (['work', 'dec', 'TRAB', 'DEC'].includes(type)) {
      // debut/fin are the correct field names in historique (format: "HHhMM")
      const debut = normTime(j.debut || j.inicio || '')
      const fin = normTime(j.fin || j.fim || '')
      const f = calcFraisHorario(type, debut, fin, prevDec, p)
      total += f.total; ptd += f.ptd; dej += f.dej; din += f.din; nui += f.nui
    } else if (prevDec) {
      // Dia após découché mesmo sendo folga/RC → Pt.D
      total += p.ptd; ptd += 1
    }
  }

  return { total, ptd, dej, din, nui }
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

  // B. LiquidRate real
  const comBruto = dados.filter(d => d.salairebrut > 0 && d.netPaye > 0)
  if (comBruto.length > 0) {
    const taxa = comBruto.reduce((a, d) => a + d.netPaye / d.salairebrut, 0) / comBruto.length
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

  if (comConges.length > 0) {
    const vals = comConges.map(d => (d.montantConges || 0) / (d.joursConges || 1))
    base.valorDiaConges = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100
  } else if (comBruto.length >= 3 && hist.length > 0) {
    // Fallback: aprende por diferença entre meses — precisa de variação
    const aprendizagens: number[] = []
    for (const fiche of comBruto) {
      const joursConges = fiche.joursConges || 0
      if (joursConges === 0) continue
      let mH = fiche.moisIndex - base.hlag, aH = fiche.annee
      while (mH < 0) { mH += 12; aH-- }
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
      const brutConges = fiche.salairebrut - brutSemConges
      if (brutConges > 0) aprendizagens.push(brutConges / joursConges)
    }
    if (aprendizagens.length > 0)
      base.valorDiaConges = Math.round(aprendizagens.reduce((a, b) => a + b, 0) / aprendizagens.length * 100) / 100
  }

  if (comFeries.length > 0) {
    const vals = comFeries.map(d => (d.montantFeries || 0) / (d.joursFeries || 1))
    base.valorDiaFerie = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100
  }

  // E. Detectar hlag automaticamente (com ≥2 fiches + horários)
  if (comBruto.length >= 2 && hist.length > 0) {
    const lagsTestados: number[] = []
    for (const fiche of comBruto) {
      let melhorLag = 2, melhorDiff = Infinity
      for (let lag = 1; lag <= 3; lag++) {
        let mH = fiche.moisIndex - lag, aH = fiche.annee
        while (mH < 0) { mH += 12; aH-- }
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
        const diff = Math.abs(brutEst - fiche.salairebrut)
        if (diff < melhorDiff) { melhorDiff = diff; melhorLag = lag }
      }
      lagsTestados.push(melhorLag)
    }
    if (lagsTestados.length > 0) {
      const counts: Record<number, number> = {}
      lagsTestados.forEach(l => counts[l] = (counts[l] || 0) + 1)
      base.hlag = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    }
  }

  // F. Detectar flag automaticamente
  if (dados.filter(d => d.fraisBoletim > 0).length >= 2 && hist.length > 0) {
    const flagsTestados: number[] = []
    for (const fiche of dados.filter(d => d.fraisBoletim > 0)) {
      let melhorFlag = 1, melhorDiff = Infinity
      for (let flag = 1; flag <= 2; flag++) {
        let mF = fiche.moisIndex - flag, aF = fiche.annee
        while (mF < 0) { mF += 12; aF-- }
        const fraisCalc = calcFraisMesPorHorarios(hist, aF, mF, base)
        const diff = Math.abs(fraisCalc.total - fiche.fraisBoletim)
        if (diff < melhorDiff) { melhorDiff = diff; melhorFlag = flag }
      }
      flagsTestados.push(melhorFlag)
    }
    if (flagsTestados.length > 0) {
      const counts: Record<number, number> = {}
      flagsTestados.forEach(l => counts[l] = (counts[l] || 0) + 1)
      base.flag = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    }
  }

  // G. HorasExtrasMedia (fallback quando não temos valorDiaConges)
  if (base.valorDiaConges === 0) {
    const aprendizagens: number[] = []
    for (const fiche of comBruto) {
      let mH = fiche.moisIndex - base.hlag, aH = fiche.annee
      while (mH < 0) { mH += 12; aH-- }
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
      const diffH = (fiche.salairebrut - brutCalculado) / base.hval
      if (diffH > 0 && diffH < 60) aprendizagens.push(diffH)
    }
    if (aprendizagens.length > 0)
      base.horasExtrasMedia = Math.round(aprendizagens.reduce((a, b) => a + b, 0) / aprendizagens.length * 10) / 10
  }

  base.descoberto = dados.length >= 2
  base.confianca = calcularPrecisao(base, dados.length)
  return base
}

export default function MonSalaireScreen() {
  const { themeSombre } = useTheme()
  const [historique, setHistorique] = useState<MoisData[]>([])
  const [padrao, setPadrao] = useState<Padrao>({
    descoberto: false, diaSalario: 5, diaFrais: 10, defasagemFrais: 3, confianca: 0,
    horasExtrasMedia: 0,
    ptd: 4.42, dej: 16.36, din: 23.94, nui: 23.94,
    valorDiaConges: 0, valorDiaFerie: 0,
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

  useEffect(() => { charger() }, [])

  const charger = async () => {
    try {
      const data = await AsyncStorage.getItem('monSalaire_v2')
      const pData = await AsyncStorage.getItem('monSalaire_padrao')
      if (data) {
        const hist = JSON.parse(data)
        setHistorique(hist)
        const histCal = JSON.parse(await AsyncStorage.getItem('historique') || '[]')
        const p = pData
          ? { ...padrao, ...JSON.parse(pData) }
          : analisarPadraoV2(hist, histCal, padrao)
        setPadrao(p)
      }
    } catch (e) { console.log('Erro:', e) }
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
      const p = padrao
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

      // Dias de férias e feriados no mês das horas
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

      // Frais: pelos horários reais primeiro, fallback boletim
      const fraisHorario = calcFraisMesPorHorarios(hist, anoFrais, mesFrais, p)
      const fichesFrais = historique.filter(f =>
        f.moisIndex === mesFrais && f.annee === anoFrais && f.fraisBoletim > 0
      )
      const totalFrais = fraisHorario.total > 0
        ? fraisHorario.total
        : fichesFrais.length > 0 ? fichesFrais[0].fraisBoletim : 0

      // Salário
      let salLiq = 0, salBrut = 0, hExtra25 = 0, hExtra50 = 0

      const ficheReal = historique.find(f =>
        f.moisIndex === mesHoras && f.annee === anoHoras && f.netPaye > 0
      )

      if (ficheReal && ficheReal.netPaye > 0) {
        // ✅ MODO PRECISO: usa net real da fiche
        salLiq = ficheReal.netPaye
        salBrut = ficheReal.salairebrut || salLiq / p.liquidRate
      } else {
        // 📊 MODO ESTIMADO
        // Valor das férias: usa valor aprendido ou fallback convenção
        const valorCongesDia = p.valorDiaConges > 0
          ? p.valorDiaConges
          : (p.hbase / 22) * p.hval
        const valorFeriesDia = p.valorDiaFerie > 0
          ? p.valorDiaFerie
          : (p.hbase / 22) * p.hval

        const brutConges = diasConges.length * valorCongesDia
        const brutFeries = diasFeries.length * valorFeriesDia

        // horasExtrasMedia só como fallback se não temos valorDiaConges
        const horasExtra = p.valorDiaConges > 0 ? 0 : (p.horasExtrasMedia || 0)
        totalH = totalH + horasExtra

        if (totalH <= p.hbase) {
          salBrut = totalH * p.hval
        } else {
          const extra = totalH - p.hbase
          hExtra25 = Math.min(extra, p.lim25)
          hExtra50 = Math.max(0, extra - p.lim25)
          salBrut = p.hbase * p.hval + hExtra25 * p.h25 + hExtra50 * p.h50
        }
        salBrut += brutConges + brutFeries
        salLiq = salBrut * p.liquidRate
      }

      const totalLiq = salLiq + totalFrais
      const empresa = historique.length > 0 ? historique[0].entreprise : ''
      const precisao = calcularPrecisao(p, historique.length)

      setCalcResult({
        totalH, totalFrais, salBrut, salLiq, totalLiq,
        jours: diasHoras.length,
        hExtra25, hExtra50,
        mesReceber: `${MOIS_NOMS[mesReceber]} ${anoReceber}`,
        diaReceber: p.diaSalario,
        diaFrais: p.diaFrais,
        empresa, precisao, mesAberto,
      })
      animarContagem(Math.round(totalLiq), mesAberto)
    } catch (e) {
      mostrarErro('Erreur: ' + String(e))
    }
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
      content.push({ type: 'text', text: `Tu es un expert en bulletins de salaire français transport routier.\nAnalyse TOUS ces documents. Réponds UNIQUEMENT avec un JSON array sans markdown:\n[{"tipo":"fiche","periode":"Avril 2026","moisIndex":3,"annee":2026,"netPaye":0,"salairebrut":0,"totalCotisations":0,"remboursementFrais":0,"entreprise":"","conducteur":"","joursConges":0,"montantConges":0,"joursFeries":0,"montantFeries":0,"joursRC":0,"totalHeures":0,"hbase":0,"hval":0,"h25":0,"lim25":0,"h50":0}]\nExtrais TOUS ces champs:\n- netPaye: net à payer\n- salairebrut: salaire brut\n- totalCotisations: total cotisations salariales\n- remboursementFrais: remboursement frais si présent\n- joursConges: nombre jours congés payés ce mois\n- montantConges: montant total payé pour ces congés\n- joursFeries: jours fériés indemnisés\n- montantFeries: montant fériés\n- joursRC: repos compensateur\n- totalHeures: heures totales indiquées sur le bulletin\n- hbase: heures de base contractuelles (ex: 169h)\n- hval: taux horaire de base en € (ex: 14.76)\n- h25: taux horaire majoré 25% en € (ex: 18.45)\n- lim25: nombre d'heures à 25% (ex: 17)\n- h50: taux horaire majoré 50% en € (ex: 22.31)\nCherche les lignes "Heures normales", "Heures supplémentaires 25%", "Heures supplémentaires 50%" pour extraire hbase/hval/h25/lim25/h50. Si une valeur n'existe pas sur le bulletin, mets 0.` })
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 2000, messages: [{ role: 'user', content }] })
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
      content.push({ type: 'text', text: `Tu es un expert en transport routier français. Analyse TOUS ces boletins de frais. Réponds UNIQUEMENT avec un JSON array:\n[{"tipo":"frais","periode":"Février 2026","moisIndex":1,"annee":2026,"entreprise":"","conducteur":"","totalJours":0,"totalKms":0,"decouches":0,"ptDejCount":0,"ptDejValeur":0,"dejCount":0,"dejValeur":0,"dinerCount":0,"dinerValeur":0,"nuitCount":0,"nuitValeur":0,"totalFrais":0},...]` })
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
          // Guardar imediatamente no padrão actual
          setPadrao(prev => ({
            ...prev,
            ptd: fraisVals.ptDej,
            dej: fraisVals.dej,
            din: fraisVals.diner,
            nui: fraisVals.nuit,
          }))
        }
      }
      processarDocumentos(docs)
    } catch (e) { mostrarErro(String(e)) }
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

  const iniciarPerguntas = (docs: DocumentoAnalysado[]) => {
    const fiches = docs.filter(d => d.tipo === 'fiche')
    if (fiches.length === 0) return
    setRespostas([]); setPerguntaAtual(0); setInputValor('')
    setInputDiaSal(String(padrao.diaSalario)); setInputDiaFrais(String(padrao.diaFrais))
    setShowPerguntas(true)
  }

  const responderPergunta = async () => {
    const fiches = documentosAnalisados.filter(d => d.tipo === 'fiche')
    const fraisDoc = documentosAnalisados.filter(d => d.tipo === 'frais')
    const fichaActual = fiches[perguntaAtual]
    if (!inputValor || parseFloat(inputValor) <= 0) { setShowModalValorInvalido(true); return }
    const novaResposta = {
      fiche: fichaActual,
      frais: fraisDoc.find(f => f.moisIndex === fichaActual.moisIndex && f.annee === fichaActual.annee) || null,
      montantTotal: parseFloat(inputValor),
      diaSalario: parseInt(inputDiaSal) || 5,
      diaFrais: parseInt(inputDiaFrais) || 10,
    }
    const novasRespostas = [...respostas, novaResposta]
    setRespostas(novasRespostas); setInputValor('')
    if (perguntaAtual < fiches.length - 1) setPerguntaAtual(perguntaAtual + 1)
    else { await guardarTudo(novasRespostas); setShowPerguntas(false); setDocumentosAnalisados([]) }
  }

  const guardarTudo = async (resps: any[]) => {
    const novoHist = [...historique]
    for (const resp of resps) {
      const fiche = resp.fiche.dados || resp.fiche
      const frais = resp.frais?.dados || resp.frais
      const periodeLabel = resp.fiche.periode || `${MOIS_NOMS[resp.fiche.moisIndex]} ${resp.fiche.annee}`
      const existenteIdx = novoHist.findIndex(h => h.periode === periodeLabel)
      const novoDado: MoisData = {
        periode: periodeLabel, moisIndex: resp.fiche.moisIndex || 0,
        annee: resp.fiche.annee || new Date().getFullYear(), fichePages: 1,
        netPaye: fiche.netPaye || 0, salairebrut: fiche.salairebrut || 0,
        totalCotisations: fiche.totalCotisations || 0, remboursementFrais: fiche.remboursementFrais || 0,
        fraisBoletim: frais?.totalFrais || 0, montantTotalRecu: resp.montantTotal,
        jourPaiement1: resp.diaSalario, jourPaiement2: resp.diaFrais,
        analysedAt: new Date().toISOString(), entreprise: fiche.entreprise || '', conducteur: fiche.conducteur || '',
        // Campos novos das fiches
        joursConges: fiche.joursConges || 0, montantConges: fiche.montantConges || 0,
        joursFeries: fiche.joursFeries || 0, montantFeries: fiche.montantFeries || 0,
        joursRC: fiche.joursRC || 0, totalHeures: fiche.totalHeures || 0,
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
    let padraoBase = { ...padrao }
    if (fraisValsRaw) {
      const fv = JSON.parse(fraisValsRaw)
      padraoBase = { ...padraoBase, ptd: fv.ptDej || padraoBase.ptd, dej: fv.dej || padraoBase.dej, din: fv.diner || padraoBase.din, nui: fv.nuit || padraoBase.nui }
    }
    const novoPadrao = analisarPadraoV2(novoHist, histCal, padraoBase)
    setPadrao(novoPadrao)
    await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(novoPadrao))
    setModalSucessoMsg(`${novoHist.length} mois enregistrés!\nPrécision: ${novoPadrao.confianca}%`)
    setShowModalSucesso(true)
  }

  const fiches = documentosAnalisados.filter(d => d.tipo === 'fiche')
  const fichaActual = fiches[perguntaAtual]
  const precisaoActual = calcularPrecisao(padrao, historique.length)

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>
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
            <View style={{ width: '100%', gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '600' }}>💰 Salaire net</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 16, color: 'white', fontWeight: '800' }}>{fmtInt(calcResult.salLiq)}</Text>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.80)' }}>jour {calcResult.diaReceber}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '600' }}>🍽️ Frais</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 16, color: 'white', fontWeight: '800' }}>{fmtInt(calcResult.totalFrais)}</Text>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.80)' }}>jour {calcResult.diaFrais}</Text>
                </View>
              </View>
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
                backgroundColor: precisaoActual >= 80 ? 'rgba(39,174,96,0.3)' : precisaoActual >= 60 ? 'rgba(243,156,18,0.3)' : 'rgba(255,255,255,0.15)',
                borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3
              }}>
                <Text style={{ fontSize: 11, color: 'white', fontWeight: '700' }}>
                  {precisaoActual >= 80 ? '✅' : precisaoActual >= 60 ? '⚡' : '📊'} {precisaoActual}% de précision
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

        {historique.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[st.histTitle, { color: c.textLabel }]}>HISTORIQUE</Text>
            {historique.slice().reverse().map((m, i) => (
              <Swipeable key={i} renderRightActions={() => (
                <TouchableOpacity
                  style={{ backgroundColor: '#e74c3c', justifyContent: 'center', alignItems: 'center', width: 80, marginBottom: 8, borderRadius: 14, marginHorizontal: 4 }}
                  onPress={async () => {
                    const nova = historique.filter(h => h.periode !== m.periode)
                    setHistorique(nova)
                    await AsyncStorage.setItem('monSalaire_v2', JSON.stringify(nova))
                    const histCal = JSON.parse(await AsyncStorage.getItem('historique') || '[]')
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
                  <View style={st.histLeft}>
                    <Text style={[st.histPeriode, { color: c.text }]}>{m.periode}</Text>
                    <Text style={[st.histSub, { color: c.textSub }]}>Net {fmt(m.netPaye)} · Frais {fmt(m.fraisBoletim)}</Text>
                  </View>
                  <View style={st.histRight}>
                    <Text style={[st.histMontant, { color: '#27ae60' }]}>{fmt(m.montantTotalRecu)}</Text>
                    <Text style={[st.histSub, { color: c.textSub }]}>reçu</Text>
                  </View>
                </TouchableOpacity>
              </Swipeable>
            ))}
          </View>
        )}

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
            {fichaActual && (
              <>
                <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 4 }}>{perguntaAtual + 1} / {fiches.length}</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>📄 {fichaActual.periode}</Text>
                <Text style={{ fontSize: 13, color: '#27ae60', textAlign: 'center', fontWeight: '700', marginBottom: 4 }}>
                  Net payé: {fmt((fichaActual.dados || fichaActual as any)?.netPaye || 0)}
                </Text>
                {documentosAnalisados.find(d => d.tipo === 'frais' && d.moisIndex === fichaActual.moisIndex) ? (
                  <Text style={{ fontSize: 12, color: '#2980b9', textAlign: 'center', marginBottom: 16 }}>🧾 Frais trouvés pour ce mois</Text>
                ) : (
                  <Text style={{ fontSize: 12, color: '#f39c12', textAlign: 'center', marginBottom: 16 }}>⚠️ Pas de boletim de frais pour ce mois</Text>
                )}
                <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', marginBottom: 8 }}>
                  COMBIEN AS-TU REÇU EN TOUT EN {fichaActual.periode.toUpperCase()}? (€)
                </Text>
                <TextInput
                  style={{ backgroundColor: c.input, borderRadius: 12, padding: 14, fontSize: 22, fontWeight: '800', color: c.text, borderWidth: 1, borderColor: '#f5a623', textAlign: 'center', marginBottom: 16 }}
                  value={inputValor} onChangeText={setInputValor} keyboardType="decimal-pad"
                  placeholder="ex: 3199.20" placeholderTextColor={c.textSub} autoFocus
                />
                {perguntaAtual === 0 && (
                  <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>JOUR SALAIRE</Text>
                      <TextInput style={{ backgroundColor: c.input, borderRadius: 12, padding: 12, fontSize: 18, fontWeight: '800', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }} value={inputDiaSal} onChangeText={setInputDiaSal} keyboardType="number-pad" placeholder="5" placeholderTextColor={c.textSub} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 6, fontWeight: '700' }}>JOUR FRAIS</Text>
                      <TextInput style={{ backgroundColor: c.input, borderRadius: 12, padding: 12, fontSize: 18, fontWeight: '800', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }} value={inputDiaFrais} onChangeText={setInputDiaFrais} keyboardType="number-pad" placeholder="10" placeholderTextColor={c.textSub} />
                    </View>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}
                    onPress={() => { if (perguntaAtual > 0) { setPerguntaAtual(perguntaAtual - 1); setRespostas(respostas.slice(0, -1)); setInputValor('') } else setShowModalCancelar(true) }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>{perguntaAtual > 0 ? '← Précédent' : 'Annuler'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={responderPergunta}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>{perguntaAtual < fiches.length - 1 ? '✅ Suivant →' : '✅ Enregistrer tout'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* MODAL DETALHE */}
      <Modal visible={!!modalDetail} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 4, textAlign: 'center' }}>📄 {modalDetail?.periode}</Text>
            <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginBottom: 16 }}>{modalDetail?.entreprise} · {modalDetail?.conducteur}</Text>
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.textSub, fontSize: 13 }}>Salaire brut</Text>
                <Text style={{ color: '#f5a623', fontWeight: '700', fontSize: 13 }}>{fmt(modalDetail?.salairebrut || 0)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.textSub, fontSize: 13 }}>Net payé</Text>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>{fmt(modalDetail?.netPaye || 0)}</Text>
              </View>
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
          </View>
        </View>
      </Modal>

      {/* MODAL ESCOLHA */}
      <Modal visible={showEscolhaModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
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
            <TouchableOpacity style={{ borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowEscolhaModal(false)}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textSub }}>Annuler</Text>
            </TouchableOpacity>
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
                const updated = { ...modalDetail, netPaye: parseFloat(editNetPaye) || 0, fraisBoletim: parseFloat(editFraisBoletim) || 0, montantTotalRecu: parseFloat(editMontantTotal) || 0 }
                const nova = historique.map(h => h.periode === modalDetail.periode ? updated : h)
                setHistorique(nova)
                await AsyncStorage.setItem('monSalaire_v2', JSON.stringify(nova))
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