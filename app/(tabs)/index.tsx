import { TachoLogo } from '../../src/TachoLogo'
import * as Haptics from 'expo-haptics'
import { useFocusEffect, router } from 'expo-router'
import React, { useEffect, useState, useRef, useMemo } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Switch, Alert, StyleSheet, Modal, AppState, TextInput, KeyboardAvoidingView, Platform, Animated, Easing, RefreshControl, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../context/ThemeContext'
import { useLangue } from '../../context/LangueContext'
import { useApp } from '../../context/AppContext'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { calcularFraisJour } from '../../src/frais'
import { log } from '../../src/utils/logger'
import {
  pedirPermissaoNotificacoes,
  agendarAlertaPausa,
  agendarAlertaAmplitude,
  cancelarTodosAlertas,
  cancelarRappelSaisie,
  agendarRappelSaisie,
} from '../../src/notifications'
type Profil = 'CD' | 'MIXTE' | 'LD'
type JourType = 'TRAB' | 'DEC' | 'FER' | 'FERIE' | 'RC' | 'OFF'
type Jour = {
  id: string
  date: string
  jour: string
  type: JourType
  debut: string
  fin: string
  segServico: number
  segPausa: number
  decouche: boolean
  frais: number
  modeNuit?: boolean
  kmDiarios?: number
  kmInicio?: number
  kmFim?: number
}
const PAUSA_MAX = 4.5 * 3600
const STORAGE_KEY = 'TACHOOFFICE_estado'
export default function AujourdhuiScreen() {
  const { themeSombre } = useTheme()
  const { t } = useLangue()
  const { state: appState, recarregarApp } = useApp()
  const [enService, setEnService] = useState(false)
  const [emPausa, setEmPausa] = useState(false)
  const [demarrando, setDemarrando] = useState(false)
  const [decouche, setDecouche] = useState(false)
  const [segServico, setSegServico] = useState(0)
  const [pausaReglementaireOk, setPausaReglementaireOk] = useState(false)
  const [segAmplitude, setSegAmplitude] = useState(0)
  const [segPausa, setSegPausa] = useState(0)
  const [segPausaTotal, setSegPausaTotal] = useState(0)
  const [kmDiarios, setKmDiarios] = useState(0)
  const [kmInicioTacho, setKmInicioTacho] = useState(0)
  const [kmInicioInput, setKmInicioInput] = useState('')
  const [kmFimInput, setKmFimInput] = useState('')
  const [horaInicio, setHoraInicio] = useState('')
  const [dateInicio, setDateInicio] = useState<Date | null>(null)
  const [modoTacho, setModoTacho] = useState<'crescente' | 'decrescente'>('crescente')
  const [profil, setProfil] = useState<Profil>('MIXTE')
  const [nomeConducteur, setNomeConducteur] = useState('Bruno')
  const [showProfil, setShowProfil] = useState(false)
  const [statsSemaine, setStatsSemaine] = useState({ heures: 0, decouche: 0, frais: 0, jours: 0 })
  const [modeNuit, setModeNuit] = useState(false)
  const [showTerminerModal, setShowTerminerModal] = useState(false)
  const [showKmModal, setShowKmModal] = useState(false)
  const [showKmFimInput, setShowKmFimInput] = useState(false)
  const kmScaleAnim = useRef(new Animated.Value(0.4)).current
  const kmOpacityAnim = useRef(new Animated.Value(0)).current
  const [showSummaryModal, setShowSummaryModal] = useState(false)
  const [summaryData, setSummaryData] = useState<{service: number; conduite: number; km: number; frais: number; semHeures: number; semFrais: number} | null>(null)
  const [showRecuperarHoraModal, setShowRecuperarHoraModal] = useState(false)
  const [recuperarHoraFim, setRecuperarHoraFim] = useState(new Date())
  // Pausas CE 561/2006 — rastrear sequência 15+30
  const [pausas, setPausas] = useState<{dur: number, inicio: number}[]>([])
  const [showPausasModal, setShowPausasModal] = useState(false)
  const [showPausaDuracaoModal, setShowPausaDuracaoModal] = useState(false)
  const [pausaDuracaoInput, setPausaDuracaoInput] = useState('')
  const [showStats, setShowStats] = useState(false)
  const [statsOpen, setStatsOpen] = useState({ repos: true, hebdo: true, bsem: true, sept: true, pauses: true, frais: true, amplitude: true, assiduite: true, records: true })
  const [statsBarDetail, setStatsBarDetail] = useState<any>(null)
  const pausaInicioRef = useRef<number>(0)
  const [pausaBloco1Feita, setPausaBloco1Feita] = useState(false)
  const [pausaBloco2Feita, setPausaBloco2Feita] = useState(false)
  const tsInicioUltimaPausa = useRef<number | null>(null)
  const tsRetomouServico = useRef<number | null>(null)
  const [servicoContinuo, setServicoContinuo] = useState(0)
  const [bannerPause, setBannerPause] = useState<null | '15min' | '30min'>(null)

  // Aviso progressivo condução

  // IA correções
  const [correcaoPickerDate, setCorrecaoPickerDate] = useState(new Date())

  const [showCalendario, setShowCalendario] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [storageErro, setStorageErro] = useState<string | null>(null)
  const [appReady, setAppReady] = useState(false)
  const appReadyRef = useRef(false)
  const [snackbar, setSnackbar] = useState<string | null>(null)
  const snackbarTimer = useRef<any>(null)
  const showSnackbar = (msg: string) => {
    setSnackbar(msg)
    if (snackbarTimer.current) clearTimeout(snackbarTimer.current)
    snackbarTimer.current = setTimeout(() => setSnackbar(null), 3500)
  }
  const [tooltipCard, setTooltipCard] = useState<'service' | 'pause' | 'amplitude' | null>(null)
  const tooltipTimerRef = useRef<any>(null)
  const showCardTooltip = (card: 'service' | 'pause' | 'amplitude') => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    setTooltipCard(card)
    tooltipTimerRef.current = setTimeout(() => setTooltipCard(null), 2000)
  }
  useEffect(() => { return () => { if (snackbarTimer.current) clearTimeout(snackbarTimer.current); if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current) } }, [])
  useEffect(() => {
    if (!enService || emPausa) { setBannerPause(null); return }
    if (pausaBloco2Feita) { setBannerPause(null); return }
    // servicoContinuo é calculado pelo timer — usa o state
    if (!pausaBloco1Feita && servicoContinuo >= 20700) {
      setBannerPause('15min')
    } else if (pausaBloco1Feita && !pausaBloco2Feita && servicoContinuo >= 31500) {
      setBannerPause('30min')
    } else {
      setBannerPause(null)
    }
  }, [servicoContinuo, emPausa, enService, pausaBloco1Feita, pausaBloco2Feita])
  const [showReglementation, setShowReglementation] = useState(false)
  const [diasHistorique, setDiasHistorique] = useState<Jour[]>([])
  const [showAddDia, setShowAddDia] = useState(false)
  const [addDiaStr, setAddDiaStr] = useState('')
  const [addDiaLabel, setAddDiaLabel] = useState('')
  const [addDebut, setAddDebut] = useState('06h00')
  const [addFin, setAddFin] = useState('14h00')
  const [addServico, setAddServico] = useState('08h00')
  const [addFrais, setAddFrais] = useState('0.00')
  const [editandoDiaId, setEditandoDiaId] = useState<string | null>(null)
  const [addType, setAddType] = useState<JourType>('TRAB')
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [timePickerField, setTimePickerField] = useState<'debut'|'fin'|'servico'>('debut')
  const [timePickerValue, setTimePickerValue] = useState(new Date())
  const [calMes, setCalMes] = useState(new Date().getMonth())
  const [calAno, setCalAno] = useState(new Date().getFullYear())
  const [kmInicioAuto, setKmInicioAuto] = useState(false)
  const [showKmInicio, setShowKmInicio] = useState(false)
  const [kmDebutConfirme, setKmDebutConfirme] = useState(false)
  const [ultimoTerminerTs, setUltimoTerminerTs] = useState<number | null>(null)

  const rnAppState = useRef(AppState.currentState)
  const tsBackground = useRef<number | null>(null)
  const ultimaVerificacao = useRef(0)
  const amplitudeAlertado = useRef(false)
  const segPausaRef = useRef(0)
  const autoGuardarTimer = useRef<any>(null)
  const emPausaRef = useRef(false)
  const pulsarBtn = useRef(new Animated.Value(1)).current
  const fadeIn = useRef(new Animated.Value(1)).current
  const estadoAtualRef = useRef<any>({})
  const statsScrollRef = useRef<any>(null)
  const mainScrollRef = useRef<any>(null)

  const MAX_SERVICE = modeNuit ? 10 * 3600 : 12 * 3600
  const MAX_AMPLITUDE = modeNuit ? 13 * 3600 : 15 * 3600
  const MOIS_NOMS = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE']

  const c = useMemo(() => ({
    bg: themeSombre ? '#0f1117' : '#f0f2f8',
    card: themeSombre ? '#181c27' : '#ffffff',
    cardBorder: themeSombre ? '#2a3045' : '#d0d5e8',
    text: themeSombre ? '#eef0f5' : '#1a1f35',
    textSub: themeSombre ? '#8890aa' : '#6b7490',
    textLabel: themeSombre ? '#8890aa' : '#3a4060',
    timerBg: themeSombre ? '#181c27' : '#ffffff',
    miniRow: themeSombre ? '#181c27' : '#ffffff',
    servicoBox: themeSombre ? '#0f1117' : '#e8eaf2',
    progressBg: themeSombre ? '#1f2436' : '#d8dce8',
    statBox: themeSombre ? '#181c27' : '#ffffff',
    decoucheCard: themeSombre ? '#181c27' : '#ffffff',
    tooltipBg: themeSombre ? '#1f2436' : '#ffffff',
    modalBg: themeSombre ? '#181c27' : '#ffffff',
    modalOption: themeSombre ? '#1f2436' : '#f0f2f8',
    conducaoGelada: themeSombre ? '#3a3a3a' : '#c0c5d8',
  }), [themeSombre])

  const navegarMes = (dir: number) => {
    let novoMes = calMes + dir
    let novoAno = calAno
    if (novoMes > 11) { novoMes = 0; novoAno++ }
    if (novoMes < 0) { novoMes = 11; novoAno-- }
    setCalMes(novoMes)
    setCalAno(novoAno)
  }

  const limparInputKm = (valor: string) => valor.replace(/[^0-9.,]/g, '')

  const parseKmInput = (valor: string) => {
    const km = parseFloat(valor.replace(',', '.').trim())
    return Number.isFinite(km) && km > 0 ? km : 0
  }

  const arredondarKm = (valor: number) => Math.round(Math.max(0, valor) * 10) / 10

  const getKmInicioManual = () => parseKmInput(kmInicioInput) || kmInicioTacho

  const calcularKmManual = () => {
    const kmFim = parseKmInput(kmFimInput)
    const kmInicio = getKmInicioManual()
    if (kmInicio > 0) return arredondarKm(kmFim - kmInicio)
    return arredondarKm(kmFim)
  }

  const guardarEstado = async (estado: any) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(estado))
    } catch (e) { log.error('index', 'guardarEstado falhou', e) }
  }

  const criarEstadoSnapshot = (overrides: any = {}) => {
    const snap = estadoAtualRef.current
    return {
      enService: !!snap.enService,
      emPausa: !!snap.emPausa,
      decouche: !!snap.decouche,
      modeNuit: !!snap.modeNuit,
      segServico: snap.segServico || 0,
      segAmplitude: snap.segAmplitude || 0,
      segPausa: snap.segPausa || 0,
      segPausaTotal: snap.segPausaTotal || 0,
      kmDiarios: snap.kmDiarios || 0,
      kmInicioTacho: snap.kmInicioTacho || 0,
      pausaReglementaireOk: !!snap.pausaReglementaireOk,
      pausaBloco1Feita: !!snap.pausaBloco1Feita,
      pausaBloco2Feita: !!snap.pausaBloco2Feita,
      pausas: snap.pausas || [],
      horaInicio: snap.horaInicio || '',
      dateInicio: snap.dateInicio?.toISOString(),
      ...overrides,
    }
  }

  const aplicarEstadoPersistido = (estado: any, tempoBackground = 0) => {
    setEnService(true)
    setEmPausa(!!estado.emPausa)
    emPausaRef.current = !!estado.emPausa
    setDecouche(!!estado.decouche)
    setModeNuit(!!estado.modeNuit)
    setHoraInicio(estado.horaInicio || '')
    setKmDiarios(estado.kmDiarios || 0)
    const kmInicioGuardado = estado.kmInicioTacho || 0
    setKmInicioTacho(kmInicioGuardado)
    setKmInicioInput(kmInicioGuardado > 0 ? String(kmInicioGuardado) : '')
    setKmFimInput('')
    setSegPausaTotal((estado.segPausaTotal || 0) + (estado.emPausa ? tempoBackground : 0))
    setPausaReglementaireOk(!!estado.pausaReglementaireOk)
    setPausaBloco1Feita(!!estado.pausaBloco1Feita)
    setPausaBloco2Feita(!!estado.pausaBloco2Feita)
    if (estado.pausas) setPausas(estado.pausas)
    if (estado.dateInicio) setDateInicio(new Date(estado.dateInicio))

    if (estado.emPausa) {
      setSegServico(estado.segServico || 0)
      setSegAmplitude(estado.segAmplitude || 0)
      setSegPausa((estado.segPausa || 0) + tempoBackground)
    } else {
      setSegServico((estado.segServico || 0) + tempoBackground)
      setSegAmplitude((estado.segAmplitude || 0) + tempoBackground)
      setSegPausa(estado.segPausa || 0)
    }
  }

  const sincronizarEstadoPersistido = async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY)
      if (!data) return false
      const estado = JSON.parse(data)
      if (!estado.enService) return false

      const agora = Date.now()
      const tempoBackground = estado.tsBackground
        ? Math.max(0, Math.min(24 * 3600, Math.floor((agora - estado.tsBackground) / 1000)))
        : 0

      const estadoAtualizado = {
        ...estado,
        tsBackground: null,
        lastBgTick: agora,
        segAmplitude: (estado.segAmplitude || 0) + tempoBackground,
      }

      if (estado.emPausa) {
        estadoAtualizado.segPausa = (estado.segPausa || 0) + tempoBackground
        estadoAtualizado.segPausaTotal = (estado.segPausaTotal || 0) + tempoBackground
      } else {
        estadoAtualizado.segServico = (estado.segServico || 0) + tempoBackground
        estadoAtualizado.segPausa = estado.segPausa || 0
      }

      await guardarEstado(estadoAtualizado)
      aplicarEstadoPersistido(estadoAtualizado, 0)
      return true
    } catch (e) {
      return false
    }
  }

  const restaurarEstado = async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY)
      if (!data) return
      const estado = JSON.parse(data)
      if (!estado.enService) return

      // Sessão de um dia diferente? Limpar — contadores de condução não transitam entre dias
      if (estado.dateInicio) {
        const savedDate = new Date(estado.dateInicio)
        const today = new Date()
        const isDifferentDay =
          savedDate.getDate() !== today.getDate() ||
          savedDate.getMonth() !== today.getMonth() ||
          savedDate.getFullYear() !== today.getFullYear()
        if (isDifferentDay) {
          await AsyncStorage.removeItem(STORAGE_KEY)
          await cancelarTodosAlertas()
          return
        }
      }

      const agora = Date.now()
      const tempoBackground = estado.tsBackground ? Math.floor((agora - estado.tsBackground) / 1000) : 0
      aplicarEstadoPersistido(estado, tempoBackground)
      log.info('index', 'estado restaurado', { enService: estado.enService, emPausa: estado.emPausa })
    } catch (e) { log.error('index', 'restaurarEstado falhou', e) }
  }

  useEffect(() => {
    const init = async () => {
      limparFraisReglesAoArrancar()
      await restaurarEstado()
      carregarDiasMes()
      cancelarTodosAlertas()
      AsyncStorage.getItem('ultimo_terminer').then(v => {
        if (v) setUltimoTerminerTs(parseInt(v))
      })
      appReadyRef.current = true
      setAppReady(true)
    }
    init()
  }, [])

  useEffect(() => {
    carregarDiasMes()
  }, [calMes, calAno])

  useEffect(() => {
    if (!enService) {
      const v = appState.kmUltimoFim
      if (v > 0 && !kmInicioInput) {
        setKmInicioInput(String(v))
        setKmInicioAuto(true)
      }
      setShowKmInicio(false)
    } else {
      setShowKmInicio(false)
    }
  }, [enService, appState.kmUltimoFim])

  useFocusEffect(
    React.useCallback(() => {
      const hoje = new Date()
      setCalMes(hoje.getMonth())
      setCalAno(hoje.getFullYear())
      recarregarApp()
      carregarStatsSemaine()
      carregarDiasMes()
      AsyncStorage.getItem('modoTacho').then(v => {
        setModoTacho(v === 'decrescente' ? 'decrescente' : 'crescente')
      })
    }, [])
  )

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, [])

  useEffect(() => {
    if (enService) { pulsarBtn.stopAnimation(); pulsarBtn.setValue(1); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulsarBtn, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulsarBtn, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => { loop.stop() }
  }, [enService])

  useEffect(() => {
    estadoAtualRef.current = {
      enService, emPausa, decouche, modeNuit,
      segServico, segAmplitude, segPausa,
      segPausaTotal, kmDiarios, kmInicioTacho, pausaReglementaireOk, pausas,
      horaInicio, dateInicio,
    }
  })

  useEffect(() => {
    if (!enService) return
    autoGuardarTimer.current = setInterval(async () => {
      await guardarEstado(criarEstadoSnapshot({ tsBackground: null }))
    }, 30000)
    return () => clearInterval(autoGuardarTimer.current)
  }, [enService])

  // Quando showTerminerModal abre → abrir KM modal após 0.4s
  useEffect(() => {
    if (showTerminerModal) {
      const timer = setTimeout(() => {
        setShowKmFimInput(true)
        kmScaleAnim.setValue(0.4)
        kmOpacityAnim.setValue(0)
        setShowKmModal(true)
        Animated.parallel([
          Animated.spring(kmScaleAnim, { toValue: 1, tension: 120, friction: 7, useNativeDriver: true }),
          Animated.timing(kmOpacityAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start()
      }, 400)
      return () => clearTimeout(timer)
    } else {
      setShowKmFimInput(false)
    }
  }, [showTerminerModal])

  useEffect(() => {
    const sub = AppState.addEventListener('change', async nextState => {
      if (nextState.match(/inactive|background/)) {
        const agora = Date.now()
        tsBackground.current = agora
        if (estadoAtualRef.current.enService) {
          await guardarEstado(criarEstadoSnapshot({
            lastBgTick: agora,
            tsBackground: agora,
          }))
        }
      }

      if (rnAppState.current.match(/inactive|background/) && nextState === 'active') {
        tsBackground.current = null
        await sincronizarEstadoPersistido()
      }

      rnAppState.current = nextState
    })
    return () => sub.remove()
  }, [])

  const carregarStatsSemaine = async () => {
    try {
      const historique = appState.histCal
      if (!historique) return
      const maintenant = new Date()
      const lundi = new Date(maintenant)
      lundi.setDate(maintenant.getDate() - maintenant.getDay() + 1)
      lundi.setHours(0, 0, 0, 0)
      const domingo = new Date(lundi)
      domingo.setDate(lundi.getDate() + 6)
      const semaineRaw = historique.filter((j: any) => {
        const parts = j.date.split('/').map(Number)
        const d = parts[0], m = parts[1]
        const ano = parts.length >= 3
          ? parts[2]
          : (j.id ? new Date(parseInt(j.id)).getFullYear() : maintenant.getFullYear())
        const dataJour = new Date(ano, m - 1, d)
        return dataJour >= lundi && dataJour <= domingo
      })
      // Deduplicar por data — se houver 2 entradas para o mesmo dia, fica só a mais recente
      const vistoPorData = new Map<string, any>()
      for (const j of semaineRaw) {
        const partes = j.date.split('/')
        const chave = partes.length >= 3 ? j.date : `${j.date}/${maintenant.getFullYear()}`
        const existente = vistoPorData.get(chave)
        if (!existente || (j.id && existente.id && parseInt(j.id) > parseInt(existente.id))) {
          vistoPorData.set(chave, j)
        }
      }
      const semaine = Array.from(vistoPorData.values())
      setStatsSemaine({
        heures: semaine.filter((j: any) => ['TRAB','DEC','work','dec'].includes(j.type || 'TRAB')).reduce((a: number, j: any) => a + (j.segServico || 0), 0),
        decouche: semaine.filter((j: any) => j.decouche).length,
        frais: semaine.reduce((a: number, j: any) => a + (j.frais || 0), 0),
        jours: semaine.filter((j: any) => j.type === 'TRAB' || j.type === 'DEC').length,
      })
    } catch (e) { log.warn('index', 'carregarStatsSemaine falhou', e) }
  }

  const carregarDiasMes = async () => {
    try {
      if (appState.histCal) setDiasHistorique(appState.histCal)
    } catch (e) {}
  }

  const horaParaDate = (horaStr: string) => {
    const [h, m] = horaStr.replace('h', ':').split(':').map(Number)
    const d = new Date()
    d.setHours(h || 0, m || 0, 0, 0)
    return d
  }

  const DEFAULT_FRAIS_REGLES = { ptDejAte: 6.0, dejMinAmp: 6.017, dinerDe: 21.25 }
  const valRegleFrais = (v: any, fallback: number, min: number, max: number) => {
    const n = parseFloat(v)
    return !isNaN(n) && n >= min && n <= max ? n : fallback
  }
  const sanitizeFraisRegles = (raw: any = {}, fallback: any = DEFAULT_FRAIS_REGLES) => ({
    ptDejAte: valRegleFrais(raw.ptDejAte, fallback.ptDejAte ?? DEFAULT_FRAIS_REGLES.ptDejAte, 5, 8),
    dejMinAmp: valRegleFrais(raw.dejMinAmp, fallback.dejMinAmp ?? DEFAULT_FRAIS_REGLES.dejMinAmp, 4, 8),
    dinerDe: valRegleFrais(raw.dinerDe, fallback.dinerDe ?? DEFAULT_FRAIS_REGLES.dinerDe, 18, 23),
  })
  const carregarFraisRegles = async () => {
    const reglesData = await AsyncStorage.getItem('frais_regles')
    let regles = DEFAULT_FRAIS_REGLES
    try { regles = sanitizeFraisRegles(reglesData ? JSON.parse(reglesData) : {}) } catch { regles = DEFAULT_FRAIS_REGLES }
    if (reglesData) await AsyncStorage.setItem('frais_regles', JSON.stringify(regles))
    return regles
  }
  const limparFraisReglesAoArrancar = async () => {
    // Limpa/valida frais_regles
    try {
      const reglesData = await AsyncStorage.getItem('frais_regles')
      const regles = sanitizeFraisRegles(reglesData ? JSON.parse(reglesData) : {})
      await AsyncStorage.setItem('frais_regles', JSON.stringify(regles))
    } catch {
      await AsyncStorage.removeItem('frais_regles')
    }
    // frais_valores — validação delegada ao AppContext
    if (!appState.fraisValores) await AsyncStorage.removeItem('frais_valores').catch(() => {})
  }
  const diaAnteriorDecouche = (lista: any[], dataAtual: Date) => {
    const anterior = new Date(dataAtual)
    anterior.setDate(dataAtual.getDate() - 1)
    const alvo = `${String(anterior.getDate()).padStart(2, '0')}/${String(anterior.getMonth() + 1).padStart(2, '0')}`
    return lista.some(j => (j.date || '').startsWith(alvo) && (j.type === 'DEC' || j.decouche))
  }

const calcularFraisAuto = async (debut: string, fin: string, servico: string, type: string) => {
    const semFrais = ['OFF', 'RC', 'FERIE', 'FER'].includes(type)
    if (semFrais) setAddServico('00h00')
    const [hS, mS] = servico.replace('h', ':').split(':').map(Number)
    let fv = { ptDej: 4.42, dej: 16.36, diner: 23.94, nuit: 23.94 }
    let regles = DEFAULT_FRAIS_REGLES
    let prevDec = false
    try {
      if (appState.fraisValores) fv = { ...fv, ...appState.fraisValores }
      regles = await carregarFraisRegles()
      const lista = appState.histCal ?? []
      const [dia, mes] = addDiaStr.split('/').map(Number)
      if (dia && mes) prevDec = diaAnteriorDecouche(lista, new Date(calAno, mes - 1, dia))
    } catch (e) {}
    const result = calcularFraisJour({
      type,
      debut,
      fin,
      segServico: semFrais ? 0 : (hS * 3600) + ((mS || 0) * 60),
      prevDecouche: prevDec,
      regles,
      valeurs: fv,
    })
    setAddFrais(result.total.toFixed(2))
  }

  const abrirPicker = (field: 'debut'|'fin'|'servico') => {
    const val = field === 'debut' ? addDebut : field === 'fin' ? addFin : addServico
    setTimePickerField(field)
    setTimePickerValue(horaParaDate(val))
    setShowTimePicker(true)
  }

  const onTimeChange = (_: any, date?: Date) => {
    setShowTimePicker(false)
    if (!date) return
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    const str = `${h}h${m}`
    const novoDebut = timePickerField === 'debut' ? str : addDebut
    const novoFin = timePickerField === 'fin' ? str : addFin
    const novoServico = timePickerField === 'servico' ? str : addServico
    if (timePickerField === 'debut') setAddDebut(str)
    else if (timePickerField === 'fin') setAddFin(str)
    else setAddServico(str)
    calcularFraisAuto(novoDebut, novoFin, novoServico, addType)
  }

  const guardarNovoDia = async () => {
    const [d, m] = addDiaStr.split('/').map(Number)
    const diasSemana = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
    const dataJour = new Date(calAno, m - 1, d)
    const jour = diasSemana[dataJour.getDay()]
    const horasMin = addServico.replace('h', ':').split(':')
    const novoSeg = (parseInt(horasMin[0]) * 3600) + ((parseInt(horasMin[1]) || 0) * 60)
    const diaDados = {
      date: `${addDiaStr}/${calAno}`,
      jour,
      type: addType,
      debut: addDebut,
      fin: addFin,
      segServico: novoSeg,
      segPausa: 0,
      decouche: addType === 'DEC',
      frais: parseFloat(addFrais) || 0,
      modeNuit: false,
      kmDiarios: 0,
    }
    try {
      const existente = await AsyncStorage.getItem('historique')
      let lista: any[] = []
      if (existente) {
        try { lista = JSON.parse(existente) }
        catch { await AsyncStorage.removeItem('historique'); setStorageErro('Historique corrompu — réinitialisé. Ton nouveau jour a été sauvegardé.') }
      }
      if (editandoDiaId) {
        // EDITAR — substituir o dia existente
        lista = lista.map((j: any) => j.id === editandoDiaId ? { ...j, ...diaDados } : j)
      } else {
        // ADICIONAR — inserir novo
        lista.unshift({ id: Date.now().toString(), ...diaDados })
      }
      lista.sort((a: any, b: any) => {
        const pa = a.date.split('/'); const pb = b.date.split('/')
        const da = new Date(parseInt(pa[2] || calAno), parseInt(pa[1])-1, parseInt(pa[0]))
        const db = new Date(parseInt(pb[2] || calAno), parseInt(pb[1])-1, parseInt(pb[0]))
        return db.getTime() - da.getTime()
      })
      await AsyncStorage.setItem('historique', JSON.stringify(lista.slice(0, 365)))
      setDiasHistorique(lista)
      setEditandoDiaId(null)
      setShowAddDia(false)
    } catch (e) { log.error('index', 'guardarDia (addEdit) falhou', e) }
  }

  const guardarProfil = async (p: Profil) => {
    setProfil(p)
    await AsyncStorage.setItem('profil', p)
    setShowProfil(false)
  }

  // Amplitude counts ALWAYS while in service (including during pauses) — PONTO 6
  useEffect(() => {
    if (!enService) return
    const timer = setInterval(() => setSegAmplitude(a => a + 1), 1000)
    return () => clearInterval(timer)
  }, [enService])

  // Service only counts when not in pause — PONTO 6
  useEffect(() => {
    if (!enService || emPausa) return
    const timer = setInterval(() => {
      setSegServico(s => s + 1)
      if (tsRetomouServico.current) {
        setServicoContinuo(Math.floor((Date.now() - tsRetomouServico.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [enService, emPausa])

  useEffect(() => {
    if (!emPausa) return
    const timer = setInterval(() => {
      setSegPausa(s => {
        segPausaRef.current = s + 1
        return s + 1
      })
      setSegPausaTotal(s => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [emPausa])

  useEffect(() => {
    segPausaRef.current = segPausa
  }, [segPausa])

  // Amplitude overflow check — alert if service open > 16h (possible forgot to end)
  useEffect(() => {
    if (!enService || amplitudeAlertado.current) return
    if (segAmplitude >= 16 * 3600) {
      amplitudeAlertado.current = true
      Alert.alert(
        '⏰ Service ouvert depuis 16h',
        'Tu as oublié de terminer ton service ?',
        [
          { text: 'Non, tout va bien', style: 'cancel' },
          {
            text: 'Oui, corriger',
            onPress: () => {
              // Pre-fill with current time as default
              setRecuperarHoraFim(new Date())
              setShowRecuperarHoraModal(true)
            }
          },
        ]
      )
    }
  }, [segAmplitude, enService])

  const fmt = (seg: number) => {
    const h = String(Math.floor(seg / 3600)).padStart(2, '0')
    const m = String(Math.floor((seg % 3600) / 60)).padStart(2, '00')
    const s = String(seg % 60).padStart(2, '00')
    return `${h}:${m}:${s}`
  }

  const fmtHM = (seg: number) => {
    const h = String(Math.floor(seg / 3600)).padStart(2, '0')
    const m = String(Math.floor((seg % 3600) / 60)).padStart(2, '0')
    return `${h}h${m}`
  }

  const getNomDia = () => {
    const dias = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
    const mois = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
    const agora = new Date()
    const h = String(agora.getHours()).padStart(2, '0')
    const m = String(agora.getMinutes()).padStart(2, '0')
    return `${dias[agora.getDay()]} ${agora.getDate()} ${mois[agora.getMonth()]} · ${h}h${m}`
  }

  const maxSemaine = profil === 'CD' ? 52 * 3600 : 56 * 3600
  const pctSemaine = Math.min((statsSemaine.heures / maxSemaine) * 100, 100)
  const semaineColor = pctSemaine > 90 ? '#e74c3c' : pctSemaine > 75 ? '#f39c12' : '#27ae60'
  const pctServico = Math.min((segServico / MAX_SERVICE) * 100, 100)
  const servicoBarColor = pctServico > 90 ? '#e74c3c' : pctServico > 70 ? '#f39c12' : '#27ae60'

  const handleDemarrer = async () => {
    if (demarrando) return
    setDemarrando(true)
    estadoAtualRef.current = { ...estadoAtualRef.current, enService: true }
    // 1. Pré-limpar TUDO (incluindo notificações de builds anteriores) + permissões
    await cancelarTodosAlertas()
    const notifOk = await pedirPermissaoNotificacoes()
    // Reagendar rappel de saisie que cancelAll apagou
    const rappelAtivo = await AsyncStorage.getItem('rappel_saisie_ativo')
    if (rappelAtivo !== 'false' && notifOk) await agendarRappelSaisie(20, 0)

    // 2. Calcular hora e modo noturno
    const agora = new Date()
    const h = String(agora.getHours()).padStart(2, '0')
    const m = String(agora.getMinutes()).padStart(2, '0')
    const horaNum = agora.getHours()
    const isNuit = horaNum >= 22 || horaNum < 5

    // 3. Atualizar todo o estado de uma vez (React 18 auto-batching)
    setModeNuit(isNuit)
    const kmInicioConfirmado = parseKmInput(kmInicioInput)
    if (kmInicioConfirmado > 0) setKmInicioTacho(kmInicioConfirmado)
    setKmInicioInput('')
    setKmFimInput('')
    setHoraInicio(`${h}h${m}`)
    setDateInicio(agora)
    setEnService(true)
    ultimaVerificacao.current = 0
    amplitudeAlertado.current = false
    setSegServico(0); setSegAmplitude(0); setSegPausa(0)
    setSegPausaTotal(0); setKmDiarios(0)
    setPausas([]); setPausaReglementaireOk(false)
    setPausaBloco1Feita(false); setPausaBloco2Feita(false); tsInicioUltimaPausa.current = null
    setServicoContinuo(0); tsRetomouServico.current = Date.now()

    // 4. Persistir estado
    await guardarEstado({
      enService: true, emPausa: false, decouche, modeNuit: isNuit,
      segServico: 0, segAmplitude: 0, segPausa: 0,
      segPausaTotal: 0, kmDiarios: 0, kmInicioTacho: kmInicioConfirmado, pausaReglementaireOk: false, pausas: [],
      lastBgTick: Date.now(),
      horaInicio: `${h}h${m}`, dateInicio: agora.toISOString(),
      tsBackground: null,
    })
    log.info('index', 'serviço iniciado', { decouche, modeNuit: isNuit, horaInicio: `${h}h${m}` })

    // 5. Agendar notificações
    if (notifOk) {
      const maxAmplitude = isNuit ? 13 * 3600 : 15 * 3600
      await agendarAlertaPausa(PAUSA_MAX)
      await agendarAlertaAmplitude(maxAmplitude)
    }
    if (isNuit) showSnackbar(`🌙 ${t.modeNuitActive} — ${t.modeNuitMsg}`)
    setDemarrando(false)
  }

  // CE 561/2006 — check if pause sequence (15+30 in order) is complete
  const pausaSequenciaValida = (lista: {dur: number, inicio: number}[]): boolean => {
    let found15 = false
    for (const p of lista) {
      if (!found15 && p.dur >= 15 * 60) { found15 = true; continue }
      if (found15 && p.dur >= 30 * 60) return true
    }
    return false
  }

  const handlePause = async () => {
    if (emPausa) {
      // Reprendre — finaliser la pause courante (durée figée avant reset)
      const duracaoPausa = segPausaRef.current
      const pausaAtual = { dur: duracaoPausa, inicio: pausaInicioRef.current }
      const novaListaPausas = [...pausas, pausaAtual]

      const sequenciaOk = pausaSequenciaValida(novaListaPausas)
      const pausaUnica45 = duracaoPausa >= 45 * 60
      const deveResetar = sequenciaOk || pausaUnica45
      if (deveResetar) {
        setPausaReglementaireOk(true)
        setPausas([])
      } else {
        setPausas(novaListaPausas)
      }

      // Rastrear blocos CE 561/2006 para banner
      const duracaoPausaReal = tsInicioUltimaPausa.current
        ? Math.floor((Date.now() - tsInicioUltimaPausa.current) / 1000)
        : duracaoPausa
      if (!pausaBloco1Feita && duracaoPausaReal >= 900) {
        setPausaBloco1Feita(true)
      } else if (pausaBloco1Feita && !pausaBloco2Feita && duracaoPausaReal >= 1800) {
        setPausaBloco2Feita(true)
      }
      tsInicioUltimaPausa.current = null
      tsRetomouServico.current = Date.now()
      setServicoContinuo(0)

      segPausaRef.current = 0
      setSegPausa(0)
      setEmPausa(false)
      emPausaRef.current = false
      await guardarEstado({
        enService, emPausa: false, decouche, modeNuit,
        segServico, segAmplitude, segPausa: 0, segPausaTotal, kmDiarios, kmInicioTacho,
        pausaReglementaireOk: deveResetar || pausaReglementaireOk, pausas: deveResetar ? [] : novaListaPausas,
        lastBgTick: Date.now(),
        horaInicio, dateInicio: dateInicio?.toISOString(), tsBackground: null,
      })
      log.info('index', 'pausa terminada')
      await agendarAlertaPausa(PAUSA_MAX)
    } else {
      // Ouvrir le modal de durée de pause (remplace l'Alert)
      setPausaDuracaoInput('')
      setShowPausaDuracaoModal(true)
    }
  }

  const confirmarIniciarPausa = async () => {
    setShowPausaDuracaoModal(false)
    pausaInicioRef.current = Date.now()
    tsInicioUltimaPausa.current = Date.now()
    segPausaRef.current = 0
    setEmPausa(true)
    emPausaRef.current = true
    setSegPausa(0)
    await guardarEstado({
      enService, emPausa: true, decouche, modeNuit,
      segServico, segAmplitude, segPausa: 0,
      segPausaTotal, kmDiarios, kmInicioTacho, pausaReglementaireOk, pausas,
      lastBgTick: Date.now(),
      horaInicio, dateInicio: dateInicio?.toISOString(), tsBackground: null,
    })
    log.info('index', 'pausa iniciada')
    await cancelarTodosAlertas()
    // Si une durée a été saisie, programmer une alerte de fin de pause
    const parts = pausaDuracaoInput.match(/^(\d{1,2})[h:H]?(\d{2})$/)
    if (parts) {
      const duracaoS = parseInt(parts[1]) * 3600 + parseInt(parts[2]) * 60
      if (duracaoS > 0) await agendarAlertaPausa(duracaoS)
    } else if (/^\d+$/.test(pausaDuracaoInput)) {
      const mins = parseInt(pausaDuracaoInput)
      if (mins > 0) await agendarAlertaPausa(mins * 60)
    }
  }

  const guardarDia = async (fim: Date, kmManual = kmDiarios) => {
    if (!dateInicio) return
    const diasSemana = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
    const jour = diasSemana[dateInicio.getDay()]
    const date = `${String(dateInicio.getDate()).padStart(2, '0')}/${String(dateInicio.getMonth() + 1).padStart(2, '0')}`
    const fimStr = `${String(fim.getHours()).padStart(2, '0')}h${String(fim.getMinutes()).padStart(2, '0')}`
    let fv = { ptDej: 4.42, dej: 16.36, diner: 23.94, nuit: 23.94 }
    let regles = DEFAULT_FRAIS_REGLES
    let lista: any[] = []
    try {
      if (appState.fraisValores) fv = { ...fv, ...appState.fraisValores }
      regles = await carregarFraisRegles()
      const existente = await AsyncStorage.getItem('historique')
      lista = existente ? JSON.parse(existente) : []
    } catch (e) {}
    const prevDec = diaAnteriorDecouche(lista, dateInicio)
    const frais = calcularFraisJour({
      type: decouche ? 'DEC' : 'TRAB',
      debut: horaInicio,
      fin: fimStr,
      segServico,
      segPausa: segPausaTotal,
      decouche,
      prevDecouche: prevDec,
      regles,
      valeurs: fv,
    }).total
    const kmInicioGuardado = getKmInicioManual()
    const kmFimGuardado = parseKmInput(kmFimInput)
    const novoDia: Jour = {
      id: Date.now().toString(), date, jour,
      type: decouche ? 'DEC' : 'TRAB',
      debut: horaInicio, fin: fimStr,
      segServico, segPausa: segPausaTotal, decouche, frais, modeNuit,
      kmDiarios: kmManual, kmInicio: kmInicioGuardado, kmFim: kmFimGuardado,
    }
    try {
      lista.unshift(novoDia)
      await AsyncStorage.setItem('historique', JSON.stringify(lista.slice(0, 365)))
      await AsyncStorage.setItem('km_ultimo_fim', kmFimInput)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      log.info('index', 'dia guardado', { date, type: decouche ? 'DEC' : 'TRAB' })
    } catch (e) { log.error('index', 'guardarDia (terminer) falhou', e) }
  }

  const handleTerminer = () => {
    setKmFimInput('')
    setShowTerminerModal(true)
  }

  const confirmarRecuperarHora = () => {
    if (!dateInicio) return
    setShowRecuperarHoraModal(false)
    // Calculate corrected times based on manually entered end time
    const fimCorrigido = recuperarHoraFim
    // If fim is before inicio (next day), add 24h
    let diffMs = fimCorrigido.getTime() - dateInicio.getTime()
    if (diffMs < 0) diffMs += 24 * 3600 * 1000
    const novoSegAmplitude = Math.floor(diffMs / 1000)
    const novoSegServico = Math.max(0, novoSegAmplitude - segPausaTotal)
    setSegAmplitude(novoSegAmplitude)
    setSegServico(novoSegServico)
    // Open normal terminer modal (with découché toggle) after brief delay
    setTimeout(() => setShowTerminerModal(true), 300)
  }

  const confirmarTerminer = async (comDecouche: boolean) => {
    if (comDecouche) setDecouche(true)
    setDemarrando(true)
    setShowTerminerModal(false)
    setShowKmFimInput(false)

    // Capture values before reset for summary modal
    const snapService = segServico
    const snapKm = calcularKmManual()

    // Compute frais inline for summary
    const fim = new Date()
    const fimStr = `${String(fim.getHours()).padStart(2, '0')}h${String(fim.getMinutes()).padStart(2, '0')}`
    let fv = { ptDej: 4.42, dej: 16.36, diner: 23.94, nuit: 23.94 }
    let regles2 = DEFAULT_FRAIS_REGLES
    let prevDecResumo = false
    try {
      if (appState.fraisValores) fv = { ...fv, ...appState.fraisValores }
      regles2 = await carregarFraisRegles()
      prevDecResumo = dateInicio ? diaAnteriorDecouche(appState.histCal ?? [], dateInicio) : false
    } catch (e) { log.error('index', 'confirmarTerminer frais falhou', e) }
    const snapFrais = calcularFraisJour({
      type: (comDecouche || decouche) ? 'DEC' : 'TRAB',
      debut: horaInicio,
      fin: fimStr,
      segServico: snapService,
      segPausa: segPausaTotal,
      decouche: comDecouche || decouche,
      prevDecouche: prevDecResumo,
      regles: regles2,
      valeurs: fv,
    }).total

    await guardarDia(fim, snapKm)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await cancelarTodosAlertas()
    await cancelarRappelSaisie()
    await AsyncStorage.removeItem(STORAGE_KEY)
    const terminadoTs = Date.now()
    // Só actualizar o timestamp de repouso se o serviço durou pelo menos 30 min
    // (evita que serviços teste/erro reiniciem o contador de repos)
    if (segServico >= 1800) {
      await AsyncStorage.setItem('ultimo_terminer', terminadoTs.toString())
      setUltimoTerminerTs(terminadoTs)
    }
    setEnService(false); setEmPausa(false); setModeNuit(false)
    setSegServico(0); setSegAmplitude(0); setSegPausa(0)
    setSegPausaTotal(0); setKmDiarios(0); setKmInicioTacho(0); setKmInicioInput(''); setKmFimInput(''); setDecouche(false); setDateInicio(null)
    setPausas([]); setPausaReglementaireOk(false)
    setPausaBloco1Feita(false); setPausaBloco2Feita(false); tsInicioUltimaPausa.current = null
    setServicoContinuo(0); tsRetomouServico.current = null
    ultimaVerificacao.current = 0
    amplitudeAlertado.current = false
    await carregarStatsSemaine()
    setDemarrando(false)

    // Show rich summary instead of simple Alert
    setSummaryData({
      service: snapService,
      conduite: 0,
      km: snapKm,
      frais: snapFrais,
      semHeures: statsSemaine.heures + snapService,  // ambos em segundos
      semFrais: statsSemaine.frais + snapFrais,
    })
    setShowSummaryModal(true)
  }

  const REGLES_DATA = [
    { icon: '🚛', title: 'Conduite continue', desc: '4h30 max → pause de 45 min\nou fractionnée: 15 min + 30 min' },
    { icon: '⏸', title: 'Pauses selon service', desc: '> 6h de service → 30 min de pause\n> 9h de service → 45 min de pause' },
    { icon: '📅', title: 'Amplitude journalière', desc: '13h max (mode nuit)\n15h max (mode jour)\nService journalier: 12h max' },
    { icon: '📆', title: 'Temps de service hebdo', desc: '52h/semaine · 56h max exceptionnel\n32 heures journalières max cumulées' },
    { icon: '🌙', title: 'Découché', desc: 'Repos hors domicile\nPt. déjeuner + déjeuner + dîner + nuit\nautomatiquement comptés' },
  ]

  const accordeonReglementation = (
    <View style={{ marginTop: 8 }}>
      <TouchableOpacity
        onPress={() => setShowReglementation(v => !v)}
        style={{ borderRadius: 10, borderWidth: 1, borderColor: showReglementation ? 'rgba(41,128,185,0.4)' : 'rgba(41,128,185,0.2)', backgroundColor: showReglementation ? 'rgba(41,128,185,0.08)' : 'rgba(41,128,185,0.04)', paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Text style={{ fontSize: 14 }}>📋</Text>
          <Text style={{ fontSize: 10, fontWeight: '800', color: '#2980b9', letterSpacing: 0.5 }}>RÉGLEMENTATION TRANSPORT</Text>
        </View>
        <Text style={{ fontSize: 12, color: '#2980b9', fontWeight: '700' }}>{showReglementation ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {showReglementation && (
        <View style={{ marginTop: 4, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(41,128,185,0.2)', backgroundColor: 'rgba(41,128,185,0.05)', padding: 12, gap: 8 }}>
          {REGLES_DATA.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10, paddingBottom: i < REGLES_DATA.length - 1 ? 8 : 0, borderBottomWidth: i < REGLES_DATA.length - 1 ? 1 : 0, borderBottomColor: 'rgba(41,128,185,0.12)' }}>
              <Text style={{ fontSize: 16, marginTop: 1 }}>{r.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#2980b9', letterSpacing: 0.3, marginBottom: 2 }}>{r.title.toUpperCase()}</Text>
                <Text style={{ fontSize: 11, color: c.textSub, lineHeight: 16 }}>{r.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )

  const PROFILS = {
    CD:    { emoji: '🏠', label: 'Courte Distance', max: '52h/sem' },
    MIXTE: { emoji: '🔄', label: 'Mixte',           max: '56h/sem' },
    LD:    { emoji: '🛣️', label: 'Longue Distance', max: '56h/sem' },
  }

  if (!appReady && !appReadyRef.current) {
    return (
      <SafeAreaView edges={['top']} style={[st.safe, { backgroundColor: c.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#f5a623" />
      </SafeAreaView>
    )
  }

  const openKmModal = () => {
    kmScaleAnim.setValue(0.4)
    kmOpacityAnim.setValue(0)
    setShowKmModal(true)
    Animated.parallel([
      Animated.spring(kmScaleAnim, { toValue: 1, tension: 120, friction: 7, useNativeDriver: true }),
      Animated.timing(kmOpacityAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start()
  }

  const closeKmModal = () => {
    Animated.parallel([
      Animated.spring(kmScaleAnim, { toValue: 0.4, tension: 160, friction: 10, useNativeDriver: true }),
      Animated.timing(kmOpacityAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => setShowKmModal(false))
  }

  return (
    <SafeAreaView edges={['top']} style={[st.safe, { backgroundColor: c.bg }]}>
      {storageErro && (
        <TouchableOpacity
          onPress={() => setStorageErro(null)}
          style={{ backgroundColor: 'rgba(231,76,60,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(231,76,60,0.3)', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <Text style={{ fontSize: 14 }}>⚠️</Text>
          <Text style={{ flex: 1, fontSize: 12, color: '#e74c3c', fontWeight: '600', lineHeight: 16 }}>{storageErro}</Text>
          <Text style={{ fontSize: 12, color: '#e74c3c', fontWeight: '800' }}>✕</Text>
        </TouchableOpacity>
      )}
      {snackbar && (
        <TouchableOpacity
          onPress={() => { setSnackbar(null); if (snackbarTimer.current) clearTimeout(snackbarTimer.current) }}
          style={{ backgroundColor: themeSombre ? 'rgba(245,166,35,0.12)' : 'rgba(245,166,35,0.15)', borderBottomWidth: 1, borderBottomColor: 'rgba(245,166,35,0.3)', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <Text style={{ flex: 1, fontSize: 12, color: themeSombre ? '#f5a623' : '#b37a00', fontWeight: '600', lineHeight: 16 }}>{snackbar}</Text>
          <Text style={{ fontSize: 12, color: themeSombre ? '#f5a623' : '#b37a00', fontWeight: '800' }}>✕</Text>
        </TouchableOpacity>
      )}
      <ScrollView
        ref={mainScrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await carregarStatsSemaine()
              await carregarDiasMes()
              setRefreshing(false)
            }}
            colors={['#f5a623']}
            tintColor={'#f5a623'}
          />
        }
      >

        <View style={st.header}>
          <TachoLogo textColor={c.text} size={26} />
          <TouchableOpacity style={[st.badge, { backgroundColor: c.card, borderColor: c.cardBorder }]} onPress={() => setShowProfil(true)}>
            <Text style={st.badgeText}>{profil} ▾</Text>
          </TouchableOpacity>
        </View>

        {!enService ? (
          <Animated.View style={{ opacity: fadeIn }}>
            <View style={st.greeting}>
              <Text style={[st.dateText, { color: c.textSub }]}>{getNomDia()}</Text>
              <Text style={[st.greetingName, { color: c.text }]}>{t.bonjour} {nomeConducteur}</Text>
            </View>

            {/* ── WEEK SUMMARY CARD ── */}
            <View style={[st.semCard, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
              <View style={st.semHeader}>
                <Text style={[st.semTitle, { color: c.textLabel }]}>📊 {t.semainEnCours}</Text>
                <Text style={[st.semHours, { color: semaineColor }]}>{fmtHM(statsSemaine.heures)}<Text style={[st.semMax, { color: c.textSub }]}> / {profil === 'CD' ? '52h' : '56h'}</Text></Text>
              </View>
              <View style={[st.semBarBg, { backgroundColor: c.progressBg }]}>
                <View style={[st.semBarFill, { width: `${pctSemaine}%` as any, backgroundColor: semaineColor }]} />
              </View>
              {statsSemaine.jours === 0 ? (
                <Text style={[st.semEmpty, { color: c.textSub }]}>{t.aucunServiceSemaine}</Text>
              ) : (
                <View style={st.semStats}>
                  <Text style={[st.semStat, { color: c.textSub }]}>📅 {statsSemaine.jours} jours</Text>
                  <Text style={[st.semStatSep, { color: c.cardBorder }]}>·</Text>
                  <Text style={[st.semStat, { color: '#2980b9' }]}>🌙 {statsSemaine.decouche} nuit{statsSemaine.decouche > 1 ? 's' : ''}</Text>
                  <Text style={[st.semStatSep, { color: c.cardBorder }]}>·</Text>
                  <Text style={[st.semStat, { color: '#27ae60' }]}>💰 {statsSemaine.frais.toFixed(0)}€</Text>
                </View>
              )}
            </View>

            {/* ── BARRA DE REPOUSO ENTRE SERVIÇOS ── */}
            {ultimoTerminerTs && (() => {
              const reposS = Math.floor((Date.now() - ultimoTerminerTs) / 1000)
              const reposMin11h = 11 * 3600
              const reposMin45h = 45 * 3600
              const pctRepos = Math.min((reposS / reposMin11h) * 100, 100)
              const reposOk = reposS >= reposMin11h
              const pctRepos45 = Math.min((reposS / reposMin45h) * 100, 100)
              const repos45Ok = reposS >= reposMin45h
              return (
                <>
                  {!reposOk && (
                  <View style={{ marginHorizontal: 16, marginBottom: reposOk ? 4 : 6, backgroundColor: reposOk ? 'rgba(39,174,96,0.08)' : c.card, borderRadius: 12, borderWidth: 1, borderColor: reposOk ? '#27ae60' : c.cardBorder, padding: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: reposOk ? '#27ae60' : c.textLabel, letterSpacing: 0.5 }}>😴 REPOS ENTRE SERVICES</Text>
                      <Text style={{ fontSize: 13, fontWeight: '900', color: reposOk ? '#27ae60' : c.text }}>{fmtHM(reposS)}<Text style={{ fontSize: 10, color: c.textSub }}> / 11h00</Text></Text>
                    </View>
                    <View style={{ height: 5, backgroundColor: c.progressBg, borderRadius: 3 }}>
                      <View style={{ height: 5, width: `${pctRepos}%` as any, backgroundColor: reposOk ? '#27ae60' : pctRepos > 70 ? '#f39c12' : '#e74c3c', borderRadius: 3 }} />
                    </View>
                    {!reposOk && (
                      <Text style={{ fontSize: 10, color: '#e74c3c', fontWeight: '600', marginTop: 4 }}>
                        Repos min. 11h requis — encore {fmtHM(Math.max(0, reposMin11h - reposS))}
                      </Text>
                    )}
                  </View>
                  )}
                  {reposOk && (
                    <View style={{ marginHorizontal: 16, marginBottom: 6, backgroundColor: repos45Ok ? 'rgba(39,174,96,0.06)' : c.card, borderRadius: 12, borderWidth: 1, borderColor: repos45Ok ? '#27ae60' : c.cardBorder, padding: 12 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: repos45Ok ? '#27ae60' : c.textLabel, letterSpacing: 0.5 }}>🏠 REPOS HEBDO</Text>
                        <Text style={{ fontSize: 13, fontWeight: '900', color: repos45Ok ? '#27ae60' : c.text }}>{fmtHM(reposS)}<Text style={{ fontSize: 10, color: c.textSub }}> / 45h00</Text></Text>
                      </View>
                      <View style={{ height: 5, backgroundColor: c.progressBg, borderRadius: 3 }}>
                        <View style={{ height: 5, width: `${pctRepos45}%` as any, backgroundColor: repos45Ok ? '#27ae60' : pctRepos45 > 70 ? '#f39c12' : '#2980b9', borderRadius: 3 }} />
                      </View>
                      {!repos45Ok && (
                        <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', marginTop: 4 }}>
                          Repos hebdomadaire — encore {fmtHM(Math.max(0, reposMin45h - reposS))}
                        </Text>
                      )}
                    </View>
                  )}
                </>
              )
            })()}

            {/* ── DÉMARRER BUTTON ── */}
            <View style={{ alignItems: 'center', marginVertical: 16 }}>
              <Animated.View style={{ transform: [{ scale: pulsarBtn }] }}>
                <TouchableOpacity style={st.btnCircular} onPress={handleDemarrer} disabled={demarrando}>
                  <Text style={st.btnCircularIcon}>▶</Text>
                  <Text style={st.btnCircularLabel}>{t.demarrer}</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>

            {/* ── KM DÉBUT ── */}
            <View style={{ marginHorizontal: 20, marginTop: -4, marginBottom: 10 }}>
              {showKmInicio ? (
                kmDebutConfirme ? (
                  <View style={{ backgroundColor: 'rgba(39,174,96,0.12)', borderColor: '#27ae60', borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center' }}>
                    <Text style={{ color: '#27ae60', fontSize: 15, fontWeight: '800' }}>✓ {kmInicioInput} km enregistré</Text>
                  </View>
                ) : (
                  <View style={{ backgroundColor: c.card, borderColor: c.cardBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 16 }}>📍</Text>
                      <TextInput
                        value={kmInicioInput}
                        onChangeText={v => { setKmInicioInput(limparInputKm(v)); setKmInicioAuto(false) }}
                        placeholder={t.kmDebut}
                        placeholderTextColor={c.textSub}
                        keyboardType="numeric"
                        returnKeyType="done"
                        onSubmitEditing={() => {
                          if (kmInicioInput) { setKmInicioAuto(false); setKmDebutConfirme(true); setTimeout(() => { setKmDebutConfirme(false); setShowKmInicio(false) }, 1200) }
                        }}
                        style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '600', paddingVertical: 6, paddingHorizontal: 8 }}
                      />
                      <TouchableOpacity
                        onPress={() => {
                          if (kmInicioInput) {
                            setKmInicioAuto(false)
                            setKmDebutConfirme(true)
                            setTimeout(() => { setKmDebutConfirme(false); setShowKmInicio(false) }, 1200)
                          } else {
                            setShowKmInicio(false)
                          }
                        }}
                        style={{ backgroundColor: kmInicioInput ? '#27ae60' : 'rgba(180,180,180,0.2)', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ color: kmInicioInput ? '#fff' : c.textSub, fontSize: 16, fontWeight: '800' }}>{kmInicioInput ? '✓' : '✕'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )
              ) : kmInicioAuto && kmInicioInput ? (
                /* Card de confirmação automática — valor pré-preenchido do último dia */
                <View style={{ backgroundColor: 'rgba(245,166,35,0.07)', borderColor: 'rgba(245,166,35,0.35)', borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Text style={{ color: c.textSub, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 6 }}>KM DERNIER JOUR — AUTO-REMPLI</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>📍 {kmInicioInput} km</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => setShowKmInicio(true)}
                        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(180,180,180,0.12)', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ fontSize: 15 }}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setKmInicioAuto(false)}
                        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#27ae60', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>✓</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : kmInicioInput ? (
                <TouchableOpacity onPress={() => setShowKmInicio(true)} style={{ paddingVertical: 6, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: '#f5a623', fontSize: 13, fontWeight: '700' }}>📍 {t.kmDebutLabel} {kmInicioInput}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => setShowKmInicio(true)} style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
                  <Text style={{ fontSize: 12 }}><Text style={{ color: '#e74c3c', fontSize: 14 }}>📍</Text><Text style={{ color: c.textSub, opacity: 0.6 }}> {t.kmDebut}</Text></Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── INLINE CALENDAR ── */}
            {(() => {
              const agora = new Date()
              const primeiroDia = new Date(calAno, calMes, 1)
              const ultimoDia = new Date(calAno, calMes + 1, 0)
              const offset = (primeiroDia.getDay() + 6) % 7
              const totalCelulas = offset + ultimoDia.getDate()
              const semanas = Math.ceil(totalCelulas / 7)
              const hojeD = agora.getDate()
              const hojeM = agora.getMonth()
              const hojeA = agora.getFullYear()
              const eMesAtual = calMes === hojeM && calAno === hojeA
              return (
                <View style={[st.semCard, { backgroundColor: c.card, borderColor: c.cardBorder, paddingBottom: 12 }]}>
                  {/* Month navigation */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <TouchableOpacity onPress={() => navegarMes(-1)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.progressBg, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 16, color: c.text, fontWeight: '700' }}>←</Text>
                    </TouchableOpacity>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: c.textLabel, letterSpacing: 1.5 }}>{MOIS_NOMS[calMes]} {calAno}</Text>
                    <TouchableOpacity onPress={() => navegarMes(1)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.progressBg, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 16, color: c.text, fontWeight: '700' }}>→</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Day-of-week headers */}
                  <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                    {['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map((d, i) => (
                      <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: c.textSub }}>{d}</Text>
                    ))}
                  </View>
                  {/* Calendar grid */}
                  {Array.from({ length: semanas }).map((_, semIdx) => (
                    <View key={semIdx} style={{ flexDirection: 'row', marginBottom: 3 }}>
                      {Array.from({ length: 7 }).map((_, diaIdx) => {
                        const numDia = semIdx * 7 + diaIdx - offset + 1
                        if (numDia < 1 || numDia > ultimoDia.getDate()) return <View key={diaIdx} style={{ flex: 1 }} />
                        const diaStr = `${String(numDia).padStart(2,'0')}/${String(calMes+1).padStart(2,'0')}`
                        const registo = diasHistorique.find(j => {
                          const parts = j.date.split('/')
                          const dataStr = parts.length === 3 ? `${parts[0]}/${parts[1]}` : j.date
                          const anoEntrada = parts.length >= 3 ? parseInt(parts[2]) : new Date(parseInt(j.id)).getFullYear()
                          return dataStr === diaStr && anoEntrada === calAno
                        })
                        const isHoje = eMesAtual && numDia === hojeD
                        const isFuturo = calAno > hojeA || (calAno === hojeA && calMes > hojeM) || (eMesAtual && numDia > hojeD)
                        let bgColor = 'transparent'
                        let typeColor = ''
                        let typeLabel = ''
                        if (registo) {
                          if (registo.type === 'DEC')    { bgColor = 'rgba(41,128,185,0.18)';  typeColor = '#2980b9'; typeLabel = 'DÉC.' }
                          else if (registo.type === 'TRAB')  { bgColor = 'rgba(39,174,96,0.18)';   typeColor = '#27ae60'; typeLabel = 'TRAV.' }
                          else if (registo.type === 'FERIE') { bgColor = 'rgba(155,89,182,0.18)'; typeColor = '#9b59b6'; typeLabel = 'CONGÉ' }
                          else if (registo.type === 'FER')   { bgColor = 'rgba(243,156,18,0.18)';  typeColor = '#f39c12'; typeLabel = 'FÉRIÉ' }
                          else if (registo.type === 'RC')    { bgColor = 'rgba(26,188,156,0.18)';  typeColor = '#1abc9c'; typeLabel = 'R.C.' }
                          else if (registo.type === 'OFF')   { bgColor = 'rgba(107,115,148,0.15)'; typeColor = '#6b7394'; typeLabel = 'REPOS' }
                        }
                        return (
                          <TouchableOpacity key={diaIdx} style={{ flex: 1, alignItems: 'center', opacity: isFuturo ? 0.3 : 1 }}
                            onPress={() => {
                              const diasSemana = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
                              const dataJour = new Date(calAno, calMes, numDia)
                              const label = `${diasSemana[dataJour.getDay()]} ${numDia}/${String(calMes+1).padStart(2,'0')}/${calAno}`
                              if (registo && !isFuturo) {
                                router.push({ pathname: '/(tabs)/historique', params: { scrollToId: registo.id, calMes: String(calMes), calAno: String(calAno) } })
                              } else if (!isFuturo) {
                                setAddDiaStr(diaStr)
                                setAddDiaLabel(label)
                                setAddDebut('06h00'); setAddFin('14h00'); setAddServico('08h00'); setAddType('TRAB')
                                setAddFrais('0.00'); setEditandoDiaId(null)
                                calcularFraisAuto('06h00', '14h00', '08h00', 'TRAB')
                                setShowAddDia(true)
                              }
                            }}>
                            <View style={{ width: 36, height: 40, borderRadius: 8, backgroundColor: bgColor, borderWidth: isHoje ? 2 : 0, borderColor: '#f5a623', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                              <Text style={{ fontSize: 14, fontWeight: '800', color: isHoje ? '#f5a623' : (typeColor || c.textSub), lineHeight: 16 }}>{numDia}</Text>
                              {typeLabel ? (
                                <Text style={{ fontSize: 7, fontWeight: '700', color: isHoje && !typeLabel ? '#f5a623' : typeColor, letterSpacing: 0.3, lineHeight: 9 }}>{typeLabel}</Text>
                              ) : isHoje ? (
                                <Text style={{ fontSize: 7, fontWeight: '700', color: '#f5a623', letterSpacing: 0.3, lineHeight: 9 }}>AUJ.</Text>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  ))}
                  {/* Legend — 2 rows */}
                  <View style={{ marginTop: 10, gap: 6 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
                      {[
                        { color: '#27ae60', label: 'TRAVAIL' },
                        { color: '#2980b9', label: 'DÉCOUCHÉ' },
                        { color: '#6b7394', label: 'REPOS' },
                      ].map(item => (
                        <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: item.color }} />
                          <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700' }}>{item.label}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
                      {[
                        { color: '#9b59b6', label: 'CONGÉ' },
                        { color: '#1abc9c', label: 'R.COMP.' },
                        { color: '#f39c12', label: 'FÉRIÉ' },
                      ].map(item => (
                        <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: item.color }} />
                          <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700' }}>{item.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  {/* Hint editar/adicionar */}
                  <View style={{ marginTop: 10, paddingHorizontal: 4, paddingVertical: 7, backgroundColor: 'rgba(245,166,35,0.07)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 13 }}>👆</Text>
                    <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', textAlign: 'center' }}>
                      Appuie sur un jour passé pour l'ajouter ou le modifier
                    </Text>
                  </View>

                  {/* Accordéon réglementation */}
                  {accordeonReglementation}
                </View>
              )
            })()}

            {/* ── STATS — always accessible ── */}
            <TouchableOpacity
              onPress={() => setShowStats(true)}
              style={{ marginTop: 14, marginBottom: 8, backgroundColor: 'rgba(41,128,185,0.08)', borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(41,128,185,0.25)' }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#2980b9', letterSpacing: 1 }}>📊 STATS DÉTAILLÉES</Text>
            </TouchableOpacity>

          </Animated.View>
        ) : (
          <>
            {/* ── HEADER STATUS ROW ── */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingHorizontal: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <View style={[st.conducaoDot, { backgroundColor: emPausa ? '#f39c12' : '#8890aa' }]} />
                <Text style={{ fontSize: 13, fontWeight: '800', color: emPausa ? '#f39c12' : '#8890aa', letterSpacing: 0.8 }}>
                  {emPausa ? t.enPause.toUpperCase() : t.enService.toUpperCase()}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 12, color: c.textSub, fontWeight: '600' }}>{t.debutA} {horaInicio}</Text>
                <Text style={{ fontSize: 15 }}>{modeNuit ? '🌙' : '☀️'}</Text>
              </View>
            </View>
            {modeNuit && (
              <View style={[st.nuitBandeau, { marginBottom: 6 }]}>
                <Text style={st.nuitBandeauText}>{t.modeNuitBandeau}</Text>
              </View>
            )}

            {/* ── TIMER CARD ── */}
            <View style={[st.timerCard, { backgroundColor: c.timerBg, borderColor: c.cardBorder, overflow: 'hidden' }]}>
              {/* Top accent bar — green service / orange pause / bright green driving */}
              <View style={{ height: 4, backgroundColor: emPausa ? '#f39c12' : '#2980b9', borderRadius: 4, marginBottom: 14 }} />

              {!emPausa ? (
                <>
                  {/* Big timer — crescente (tempo de condução) */}
                  <View style={{ alignItems: 'center', marginBottom: 10 }}>
                    <Text style={[st.timerBig, { color: c.text, fontSize: 52, letterSpacing: 2 }]}>{fmt(segServico)}</Text>
                    <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '600', marginTop: 2, letterSpacing: 0.5 }}>
                      {'⏱ SERVICE'}
                    </Text>
                  </View>

                  {/* Service row */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.servicoBox, borderRadius: 10, padding: 10, marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, color: c.textSub, fontWeight: '700', letterSpacing: 0.4 }}>⏱ SERVICE</Text>
                    <View style={{ flex: 1, height: 4, backgroundColor: c.progressBg, borderRadius: 4, marginHorizontal: 10 }}>
                      <View style={{ height: 4, width: `${pctServico}%` as any, backgroundColor: servicoBarColor, borderRadius: 4 }} />
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{fmt(segServico)}</Text>
                  </View>

                  {/* Pauses & km row — PONTO 2 smart pause box */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {segPausaTotal > 0 && (() => {
                      // CE 561/2006 sequence analysis on committed pauses
                      const toutesLes = [...pausas]
                      // also count any ongoing pause that was committed
                      let found15 = false; let found30After15 = false
                      for (const p of toutesLes) {
                        if (!found15 && p.dur >= 15 * 60) { found15 = true; continue }
                        if (found15 && p.dur >= 30 * 60) { found30After15 = true; break }
                      }
                      const valid = pausaReglementaireOk || found30After15 || (pausas.some(p => p.dur >= 45 * 60))
                      const firstOk = found15 || pausas.some(p => p.dur >= 15 * 60)
                      let label = ''
                      let color = '#f39c12'
                      let bg = 'rgba(243,156,18,0.12)'
                      if (valid) { label = '45 ✓'; color = '#27ae60'; bg = 'rgba(39,174,96,0.12)' }
                      else if (firstOk) { label = '15 ✓ + 30…'; color = '#f39c12'; bg = 'rgba(243,156,18,0.12)' }
                      else { label = '15 min'; color = '#f39c12'; bg = 'rgba(243,156,18,0.12)' }
                      return (
                        <TouchableOpacity onPress={() => setShowPausasModal(true)} style={{ flex: 1, backgroundColor: bg, borderRadius: 8, padding: 8, alignItems: 'center' }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color }}>⏸ {label}</Text>
                          <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', marginTop: 1 }}>pauses CE 561</Text>
                        </TouchableOpacity>
                      )
                    })()}
                    {kmInicioTacho > 0 && (
                      <View style={{ flex: 1, backgroundColor: 'rgba(107,115,148,0.10)', borderRadius: 8, padding: 8, alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: c.textSub }}>📍 {kmInicioTacho} km</Text>
                        <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', marginTop: 1 }}>início tacógrafo</Text>
                      </View>
                    )}
                  </View>

                </>
              ) : (
                /* ── EN PAUSE ── */
                <>
                  <View style={{ alignItems: 'center', marginBottom: 12 }}>
                    <Text style={{ fontSize: 52, fontWeight: '900', color: '#f39c12', letterSpacing: 2 }}>{fmt(segPausa)}</Text>
                    <Text style={{ fontSize: 11, color: '#f39c12', fontWeight: '600', opacity: 0.8, marginTop: 2, letterSpacing: 0.5 }}>{t.pauseEnCours.toUpperCase()}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <View style={{ flex: 1, backgroundColor: c.servicoBox, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: c.conducaoGelada }}>{fmt(segServico)}</Text>
                      <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', marginTop: 2 }}>⏱ SERVICE</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: c.servicoBox, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: c.conducaoGelada }}>{fmtHM(segPausaTotal)}</Text>
                      <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', marginTop: 2 }}>⏸ PAUSES</Text>
                    </View>
                  </View>
                  {(() => {
                    // CE 561/2006 status during pause
                    const pausasAteAgora = [...pausas, { dur: segPausa, inicio: pausaInicioRef.current }]
                    const seqValida = pausaSequenciaValida(pausasAteAgora)
                    const pausaUnica = segPausa >= 45 * 60
                    const first15ok = pausas.some(p => p.dur >= 15 * 60) || segPausa >= 15 * 60
                    let ceLabel = ''; let ceColor = '#f39c12'; let ceBg = 'rgba(243,156,18,0.12)'
                    if (pausaReglementaireOk || seqValida || pausaUnica) { ceLabel = '45 ✓'; ceColor = '#27ae60'; ceBg = 'rgba(39,174,96,0.12)' }
                    else if (first15ok) { ceLabel = '15 ✓ + 30…'; ceColor = '#f39c12'; ceBg = 'rgba(243,156,18,0.12)' }
                    else { ceLabel = '15 min'; ceColor = '#f39c12'; ceBg = 'rgba(243,156,18,0.12)' }
                    return (
                      <TouchableOpacity onPress={() => setShowPausasModal(true)} style={{ backgroundColor: ceBg, borderRadius: 8, padding: 8, alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: ceColor }}>⏸ {fmtHM(segPausaTotal)} · {ceLabel}</Text>
                        <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', marginTop: 2 }}>pauses CE 561/2006</Text>
                      </TouchableOpacity>
                    )
                  })()}
                </>
              )}
            </View>

            {/* ── STATS CARDS ── */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: tooltipCard ? 4 : 10 }}>
              <TouchableOpacity onPress={() => showCardTooltip('service')} style={{ flex: 1, backgroundColor: c.card, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder, activeOpacity: 0.7 } as any}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#f39c12', letterSpacing: 0.8, marginBottom: 4 }}>⏱ SERVICE</Text>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#f39c12' }}>{fmtHM(segServico)}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => showCardTooltip('pause')} style={{ flex: 1, backgroundColor: c.card, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder, activeOpacity: 0.7 } as any}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#9b59b6', letterSpacing: 0.8, marginBottom: 4 }}>⏸ PAUSE</Text>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#9b59b6' }}>{fmtHM(segPausaTotal + (emPausa ? segPausa : 0))}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => showCardTooltip('amplitude')} style={{ flex: 1, backgroundColor: c.card, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder, activeOpacity: 0.7 } as any}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#2980b9', letterSpacing: 0.8, marginBottom: 4 }}>📐 AMPLITUDE</Text>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#2980b9' }}>{fmtHM(segAmplitude)}</Text>
              </TouchableOpacity>
            </View>
            {tooltipCard && (() => {
              let msg = ''; let color = '#f39c12'
              if (tooltipCard === 'service') {
                msg = `Reste ${fmtHM(Math.max(0, MAX_SERVICE - segServico))} avant ${modeNuit ? '10h' : '12h'} de service`
                color = '#f39c12'
              } else if (tooltipCard === 'amplitude') {
                msg = `Reste ${fmtHM(Math.max(0, MAX_AMPLITUDE - segAmplitude))} avant ${modeNuit ? '13h' : '15h'} d'amplitude`
                color = '#2980b9'
              } else {
                const toutesLes = emPausa ? [...pausas, { dur: segPausa, inicio: pausaInicioRef.current }] : pausas
                const pausaValida = pausaReglementaireOk || pausaSequenciaValida(toutesLes) || toutesLes.some(p => p.dur >= 45 * 60)
                const first15ok = pausas.some(p => p.dur >= 15 * 60) || (emPausa && segPausa >= 15 * 60)
                if (pausaValida) { msg = '45min ✅ — pause réglementaire OK'; color = '#27ae60' }
                else if (first15ok) { msg = '15min ✅ — encore 30min requis'; color = '#f39c12' }
                else { msg = 'encore 15min de pause requis'; color = '#e74c3c' }
              }
              return (
                <View style={{ backgroundColor: c.card, borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color }}>{msg}</Text>
                </View>
              )
            })()}

            {/* ── BANNER PAUSE CE 561/2006 ── */}
            {bannerPause === '15min' && (
              <View style={{ backgroundColor: 'rgba(243,156,18,0.12)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(243,156,18,0.4)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 13 }}>⚠️</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#f39c12', flex: 1 }}>5h45 de service — pause de 15 min recommandée</Text>
              </View>
            )}
            {bannerPause === '30min' && (
              <View style={{ backgroundColor: 'rgba(231,76,60,0.10)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(231,76,60,0.4)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 13 }}>🔴</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#e74c3c', flex: 1 }}>Pause obligatoire — encore 30 min pour compléter les 45 min</Text>
              </View>
            )}

            {/* ── ACTION BUTTONS ── */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <TouchableOpacity onPress={handlePause}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: emPausa ? 'rgba(39,174,96,0.10)' : 'rgba(243,156,18,0.08)',
                  borderWidth: 1.5, borderColor: emPausa ? '#27ae60' : '#f39c12',
                  borderRadius: 14, paddingVertical: 14 }}>
                <Text style={{ fontSize: 16 }}>{emPausa ? '▶' : '⏸'}</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: emPausa ? '#27ae60' : '#f39c12', letterSpacing: 0.5 }}>
                  {emPausa ? t.reprendre.toUpperCase() : t.pause.toUpperCase()}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleTerminer}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: 'rgba(192,57,43,0.10)',
                  borderWidth: 1.5, borderColor: '#c0392b',
                  borderRadius: 14, paddingVertical: 14 }}>
                <Text style={{ fontSize: 16 }}>⏹</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#c0392b', letterSpacing: 0.5 }}>
                  {t.terminer.toUpperCase()}
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── LIMITES LÉGALES ── */}
            <View style={[st.limites, { backgroundColor: c.card, borderColor: c.cardBorder, borderWidth: 1, borderRadius: 16, padding: 14 }]}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: c.textLabel, letterSpacing: 1.5, marginBottom: 12 }}>
                {t.limitesLegales} {modeNuit ? '🌙' : '☀️'}
              </Text>
              {[
                { label: t.serviceJournalier,   seg: segServico,         max: MAX_SERVICE,  maxLabel: modeNuit ? '10h00' : '12h00',        baseColor: '#f39c12' },
                { label: t.amplitudeJournaliere, seg: segAmplitude,      max: MAX_AMPLITUDE, maxLabel: modeNuit ? '13h00' : '15h00',       baseColor: '#2980b9' },
                { label: 'Semaine en cours',    seg: statsSemaine.heures + (enService ? segServico : 0), max: maxSemaine,  maxLabel: profil === 'CD' ? '52h00' : '56h00', baseColor: '#9b59b6' },
              ].map((item, idx) => {
                const pct = Math.min((item.seg / item.max) * 100, 100)
                const barColor = pct > 90 ? '#e74c3c' : pct > 75 ? '#f39c12' : item.baseColor
                const valColor = pct > 90 ? '#e74c3c' : pct > 75 ? '#f39c12' : c.text
                return (
                  <View key={item.label} style={{ marginBottom: idx < 3 ? 12 : 0 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.baseColor }} />
                        <Text style={{ fontSize: 11, fontWeight: '700', color: c.textSub }}>{item.label}</Text>
                      </View>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: valColor }}>{fmtHM(item.seg)} / {item.maxLabel}</Text>
                    </View>
                    <View style={{ height: 6, backgroundColor: c.progressBg, borderRadius: 3 }}>
                      <View style={{ height: 6, width: `${pct}%` as any, backgroundColor: barColor, borderRadius: 3 }} />
                    </View>
                  </View>
                )
              })}
              <TouchableOpacity
                onPress={() => setShowStats(true)}
                style={{ marginTop: 14, backgroundColor: 'rgba(41,128,185,0.08)', borderRadius: 10, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(41,128,185,0.25)' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#2980b9', letterSpacing: 1 }}>📊 STATS DÉTAILLÉES</Text>
              </TouchableOpacity>
            </View>

            {/* Accordéon réglementation — visible en pause */}
            {accordeonReglementation}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal visible={showCalendario} transparent animationType="fade">
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 20 }} activeOpacity={1} onPress={() => setShowCalendario(false)}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: c.cardBorder }}>

            {/* CABEÇALHO FIXO — setas nunca se movem */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <TouchableOpacity onPress={(e) => { e.stopPropagation(); navegarMes(-1) }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.progressBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 18, color: c.text, fontWeight: '700' }}>←</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 14, fontWeight: '800', color: c.textLabel, letterSpacing: 2, textAlign: 'center', flex: 1 }}>{MOIS_NOMS[calMes]} {calAno}</Text>
              <TouchableOpacity onPress={(e) => { e.stopPropagation(); navegarMes(1) }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.progressBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 18, color: c.text, fontWeight: '700' }}>→</Text>
              </TouchableOpacity>
            </View>

            {/* DIAS DA SEMANA */}
            <View style={{ flexDirection: 'row', marginBottom: 6 }}>
              {['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map((d, i) => (
                <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: c.textSub }}>{d}</Text>
              ))}
            </View>

            {/* GRELHA COM ALTURA FIXA — nunca muda tamanho ao navegar */}
            <View style={{ height: 246 }}>
            {(() => {
              const agora = new Date()
              const primeiroDia = new Date(calAno, calMes, 1)
              const ultimoDia = new Date(calAno, calMes + 1, 0)
              const offset = (primeiroDia.getDay() + 6) % 7
              const totalCelulas = offset + ultimoDia.getDate()
              const semanas = Math.ceil(totalCelulas / 7)
              const hojeD = agora.getDate()
              const hojeM = agora.getMonth()
              const hojeA = agora.getFullYear()
              const eMesAtual = calMes === hojeM && calAno === hojeA
              const alturaPorLinha = Math.floor(246 / semanas)
              return Array.from({ length: semanas }).map((_, semIdx) => (
                <View key={semIdx} style={{ flexDirection: 'row', height: alturaPorLinha, alignItems: 'center' }}>
                  {Array.from({ length: 7 }).map((_, diaIdx) => {
                    const numDia = semIdx * 7 + diaIdx - offset + 1
                    if (numDia < 1 || numDia > ultimoDia.getDate()) return <View key={diaIdx} style={{ flex: 1 }} />
                    const diaStr = `${String(numDia).padStart(2,'0')}/${String(calMes+1).padStart(2,'0')}`
                    const registo = diasHistorique.find(j => {
          const parts = j.date.split('/')
          const dataStr = parts.length === 3 ? `${parts[0]}/${parts[1]}` : j.date
          return dataStr === diaStr && (parts.length < 3 || parseInt(parts[2]) === calAno)
        })
                    const isHoje = eMesAtual && numDia === hojeD
                    const isFuturo = calAno > hojeA || (calAno === hojeA && calMes > hojeM) || (eMesAtual && numDia > hojeD)
                    let bgColor = 'transparent'
                    let typeColor = ''
                    let typeLabel = ''
                    if (registo) {
                      if (registo.type === 'DEC')   { bgColor = 'rgba(41,128,185,0.18)';  typeColor = '#2980b9'; typeLabel = 'DÉC.' }
                      else if (registo.type === 'TRAB') { bgColor = 'rgba(39,174,96,0.18)';   typeColor = '#27ae60'; typeLabel = 'TRAV.' }
                      else if (registo.type === 'FERIE'){ bgColor = 'rgba(155,89,182,0.18)'; typeColor = '#9b59b6'; typeLabel = 'CONGÉ' }
                      else if (registo.type === 'FER')  { bgColor = 'rgba(243,156,18,0.18)';  typeColor = '#f39c12'; typeLabel = 'FÉRIÉ' }
                      else if (registo.type === 'RC')   { bgColor = 'rgba(26,188,156,0.18)';  typeColor = '#1abc9c'; typeLabel = 'R.C.' }
                      else if (registo.type === 'OFF')  { bgColor = 'rgba(107,115,148,0.15)'; typeColor = '#6b7394'; typeLabel = 'REPOS' }
                    }
                    return (
                      <TouchableOpacity key={diaIdx} style={{ flex: 1, alignItems: 'center', opacity: isFuturo ? 0.3 : 1 }}
                        onPress={(e) => {
                          e.stopPropagation()
                          const diasSemana = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
                          const dataJour = new Date(calAno, calMes, numDia)
                          const label = `${diasSemana[dataJour.getDay()]} ${numDia}/${String(calMes+1).padStart(2,'0')}/${calAno}`
                          if (registo && !isFuturo) {
                            // EDITAR dia existente — pré-preencher formulário
                            const horasMin = Math.floor((registo.segServico || 0) / 3600)
                            const minsMin = Math.floor(((registo.segServico || 0) % 3600) / 60)
                            setAddDiaStr(diaStr)
                            setAddDiaLabel(label)
                            setAddDebut(registo.debut || '06h00')
                            setAddFin(registo.fin || '14h00')
                            setAddServico(`${String(horasMin).padStart(2,'0')}h${String(minsMin).padStart(2,'0')}`)
                            setAddType(registo.type || 'TRAB')
                            setAddFrais((registo.frais || 0).toFixed(2))
                            setEditandoDiaId(registo.id)
                            setShowCalendario(false)
                            setTimeout(() => setShowAddDia(true), 300)
                          } else if (!registo && !isFuturo && !isHoje) {
                            // ADICIONAR dia novo
                            setAddDiaStr(diaStr)
                            setAddDiaLabel(label)
                            setAddDebut('06h00'); setAddFin('14h00'); setAddServico('08h00'); setAddType('TRAB')
                            setEditandoDiaId(null)
                            setShowCalendario(false)
                            setTimeout(() => { calcularFraisAuto('06h00', '14h00', '08h00', 'TRAB'); setShowAddDia(true) }, 300)
                          }
                        }}
                        disabled={isFuturo}>
                        <View style={{ width: 36, height: 40, borderRadius: 8, backgroundColor: bgColor, borderWidth: isHoje ? 2 : 0, borderColor: '#f5a623', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: isHoje ? '#f5a623' : (typeColor || c.textSub), lineHeight: 16 }}>{numDia}</Text>
                          {typeLabel ? (
                            <Text style={{ fontSize: 7, fontWeight: '700', color: isHoje && !typeLabel ? '#f5a623' : typeColor, letterSpacing: 0.3, lineHeight: 9 }}>{isHoje && !registo ? 'AUJ.' : typeLabel}</Text>
                          ) : isHoje ? (
                            <Text style={{ fontSize: 7, fontWeight: '700', color: '#f5a623', letterSpacing: 0.3, lineHeight: 9 }}>AUJ.</Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              ))
            })()}
            </View>{/* fim grelha altura fixa */}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12, justifyContent: 'center' }}>
              {[
                { color: '#27ae60', label: 'Travail' },
                { color: '#2980b9', label: 'Découché' },
                { color: '#9b59b6', label: 'Congé' },
                { color: '#f39c12', label: 'Férié' },
                { color: '#1abc9c', label: 'Repos C.' },
                { color: '#6b7394', label: 'Repos' },
              ].map(item => (
                <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }} />
                  <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '600' }}>{item.label}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginTop: 12, opacity: 0.85 }}>Appuie sur un jour vide pour ajouter</Text>
          </View>
        </TouchableOpacity>
      </Modal>

      {showTimePicker && (
        <DateTimePicker value={timePickerValue} mode="time" is24Hour={true} display="spinner" onChange={onTimeChange} />
      )}

      <Modal visible={showAddDia} transparent animationType="slide">
        <TouchableOpacity activeOpacity={1} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }} onPress={() => { setShowAddDia(false); setEditandoDiaId(null) }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: c.cardBorder }} onPress={() => {}}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 4, textAlign: 'center' }}>{editandoDiaId ? '✏️ Modifier le jour' : '➕ Ajouter un jour'}</Text>
            <Text style={{ fontSize: 14, color: c.textSub, textAlign: 'center', marginBottom: 20 }}>{addDiaLabel}</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>DÉBUT</Text>
                <TouchableOpacity style={{ backgroundColor: c.progressBg, borderRadius: 10, padding: 12, alignItems: 'center' }} onPress={() => abrirPicker('debut')}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>🕐 {addDebut}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>FIN</Text>
                <TouchableOpacity style={{ backgroundColor: c.progressBg, borderRadius: 10, padding: 12, alignItems: 'center' }} onPress={() => abrirPicker('fin')}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>🕐 {addFin}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>SERVICE</Text>
                <TouchableOpacity style={{ backgroundColor: c.progressBg, borderRadius: 10, padding: 12, alignItems: 'center' }} onPress={() => abrirPicker('servico')}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>🕐 {addServico}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>FRAIS (€)</Text>
                <TextInput style={{ backgroundColor: c.progressBg, borderRadius: 10, padding: 12, fontSize: 16, fontWeight: '700', color: c.text, textAlign: 'center' }} value={addFrais} onChangeText={setAddFrais} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.textSub} />
              </View>
            </View>
            <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 8, fontWeight: '600' }}>TYPE DE JOUR</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {(['TRAB','DEC','FER','FERIE','RC','OFF'] as const).map(type => {
                const cfg: Record<string, {emoji: string, label: string}> = { TRAB: { emoji: '💼', label: 'Travail' }, DEC: { emoji: '🌙', label: 'Découché' }, FER: { emoji: '🎉', label: 'Férié' }, FERIE: { emoji: '🏖️', label: 'Congé' }, RC: { emoji: '🔄', label: 'Repos C.' }, OFF: { emoji: '❌', label: 'Repos' } }
                return (
                  <TouchableOpacity key={type} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: addType === type ? '#f5a623' : c.cardBorder, backgroundColor: addType === type ? 'rgba(245,166,35,0.1)' : 'transparent' }} onPress={() => { setAddType(type); calcularFraisAuto(addDebut, addFin, addServico, type) }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: addType === type ? '#f5a623' : c.textSub }}>{cfg[type].emoji} {cfg[type].label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowAddDia(false)}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={guardarNovoDia}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>{editandoDiaId ? '✅ Sauvegarder' : '✅ Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
            {editandoDiaId && (
              <TouchableOpacity
                style={{ marginTop: 10, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(231,76,60,0.4)', backgroundColor: 'rgba(231,76,60,0.06)' }}
                onPress={async () => {
                  const existente = await AsyncStorage.getItem('historique')
                  const lista = existente ? JSON.parse(existente) : []
                  const nova = lista.filter((j: any) => j.id !== editandoDiaId)
                  await AsyncStorage.setItem('historique', JSON.stringify(nova))
                  setDiasHistorique(nova)
                  setEditandoDiaId(null)
                  setShowAddDia(false)
                  carregarStatsSemaine()
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#e74c3c' }}>🗑️ Supprimer ce jour</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
          </ScrollView>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showTerminerModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, marginBottom: 16 }} />
              <Text style={{ fontSize: 22, fontWeight: '800', color: c.text }}>{t.finDeService}</Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 4 }}>{t.confirmerFinJournee}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, padding: 14, alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 22 }}>⏱</Text>
                <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }}>{fmtHM(segServico)}</Text>
                <Text style={{ fontSize: 13, color: c.textSub, fontWeight: '600', letterSpacing: 1 }}>SERVICE</Text>
              </View>
              <TouchableOpacity
                onPress={() => { setShowKmFimInput(true); openKmModal() }}
                style={{ flex: 1, backgroundColor: kmFimInput ? 'rgba(245,166,35,0.08)' : c.bg, borderRadius: 16, padding: 14, alignItems: 'center', gap: 4, borderWidth: kmFimInput ? 1.5 : 1, borderColor: kmFimInput ? '#f5a623' : c.cardBorder }}
              >
                <Text style={{ fontSize: 22 }}>{kmFimInput ? '📍' : '🎯'}</Text>
                <Text style={{ fontSize: 16, fontWeight: '800', color: kmFimInput ? '#f5a623' : c.text }}>
                  {kmFimInput ? calcularKmManual() : '—'}
                </Text>
                <Text style={{ fontSize: 13, color: c.textSub, fontWeight: '600', letterSpacing: 1 }}>KM</Text>
                {!kmFimInput && (
                  <Text style={{ fontSize: 9, color: '#f5a623', fontWeight: '700', letterSpacing: 0.5 }}>SAISIR</Text>
                )}
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: decouche ? 'rgba(41,128,185,0.12)' : c.bg, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: decouche ? '#2980b9' : c.cardBorder }} onPress={() => setDecouche(d => !d)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>🌙</Text>
                <View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: decouche ? '#2980b9' : c.text }}>{t.decoucheCeSoir}</Text>
                  <Text style={{ fontSize: 13, color: c.textSub }}>{t.fraisNuitAuto}</Text>
                </View>
              </View>
              <Switch
                value={decouche}
                onValueChange={v => setDecouche(v)}
                trackColor={{ false: c.cardBorder, true: '#2980b9' }}
                thumbColor={'white'}
                ios_backgroundColor={c.cardBorder}
              />
            </TouchableOpacity>
            <TouchableOpacity style={{ backgroundColor: '#e74c3c', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 10 }} onPress={() => confirmarTerminer(decouche)}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: 'white' }}>{decouche ? '🌙 Terminer (Découché)' : '⏹ Terminer le service'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => { setShowTerminerModal(false); setShowKmFimInput(false) }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textSub }}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL KM FIM — voa para o centro */}
      <Modal visible={showKmModal} transparent animationType="none">
        <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', opacity: kmOpacityAnim }}>
          <Animated.View style={{ transform: [{ scale: kmScaleAnim }], width: '78%', backgroundColor: c.card, borderRadius: 28, padding: 28, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 20, borderWidth: 2, borderColor: '#f5a623' }}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>📍</Text>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 4 }}>KM de fin de service</Text>
            <Text style={{ fontSize: 12, color: c.textSub, marginBottom: 20 }}>Début : {getKmInicioManual()} km</Text>
            <TextInput
              value={kmFimInput}
              onChangeText={v => setKmFimInput(limparInputKm(v))}
              keyboardType="numeric"
              autoFocus
              placeholder="ex: 145 230"
              placeholderTextColor={c.textSub}
              style={{ fontSize: 32, fontWeight: '900', color: '#f5a623', textAlign: 'center', borderBottomWidth: 2, borderBottomColor: '#f5a623', paddingBottom: 8, marginBottom: 8, width: '100%' }}
            />
            {kmFimInput ? (
              <Text style={{ fontSize: 14, color: c.textSub, marginBottom: 24 }}>
                {'Distance : '}<Text style={{ color: '#27ae60', fontWeight: '800' }}>{calcularKmManual()} km</Text>
              </Text>
            ) : <View style={{ height: 38 }} />}
            <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
              <TouchableOpacity
                style={{ flex: 1, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}
                onPress={() => { setKmFimInput(''); closeKmModal() }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Passer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 14, padding: 14, alignItems: 'center' }}
                onPress={closeKmModal}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>{'Confirmer ' + (kmFimInput ? calcularKmManual() + ' km' : '')}</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>



      <Modal visible={showProfil} transparent animationType="slide">
        <TouchableOpacity style={st.modalOverlay} onPress={() => setShowProfil(false)}>
          <View style={[st.modalBox, { backgroundColor: c.modalBg, borderColor: c.cardBorder }]}>
            <Text style={[st.modalTitle, { color: c.text }]}>{t.changerProfil}</Text>
            {(Object.keys(PROFILS) as Profil[]).map(p => (
              <TouchableOpacity key={p} style={[st.modalOption, { backgroundColor: c.modalOption, borderColor: c.cardBorder }, profil === p && st.modalOptionActive]} onPress={() => guardarProfil(p)}>
                <Text style={st.modalEmoji}>{PROFILS[p].emoji}</Text>
                <View style={st.modalOptionInfo}>
                  <Text style={[st.modalOptionTitle, { color: c.text }, profil === p && { color: '#f5a623' }]}>{PROFILS[p].label}</Text>
                  <Text style={[st.modalOptionSub, { color: c.textSub }]}>{PROFILS[p].max}</Text>
                </View>
                {profil === p && <Text style={st.modalCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* RECUPERAR HORA MODAL — manual end time after 16h overflow alert */}
      <Modal visible={showRecuperarHoraModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#f5a623', width: '100%' }}>
            <Text style={{ fontSize: 26, textAlign: 'center', marginBottom: 8 }}>⏰</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 6 }}>{t.aQuelleHeure}</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>
              {t.serviceRecalcule}{'\n'}{t.heureDebut} : <Text style={{ fontWeight: '800', color: c.text }}>{horaInicio}</Text>
            </Text>

            <View style={{ backgroundColor: c.bg, borderRadius: 16, padding: 4, marginBottom: 20, alignItems: 'center' }}>
              <DateTimePicker
                value={recuperarHoraFim}
                mode="time"
                display="spinner"
                onChange={(_, date) => { if (date) setRecuperarHoraFim(date) }}
                textColor={c.text}
              />
            </View>

            <TouchableOpacity
              style={{ backgroundColor: '#f5a623', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 10 }}
              onPress={confirmarRecuperarHora}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: 'white' }}>{t.confirmerEtTerminer}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}
              onPress={() => setShowRecuperarHoraModal(false)}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textSub }}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SUMMARY MODAL — rich end-of-service feedback */}
      <Modal visible={showSummaryModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#f5a623', width: '100%' }}>

            <Text style={{ fontSize: 32, textAlign: 'center', marginBottom: 4 }}>🏁</Text>
            <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>{t.serviceTermineModal}</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 20 }}>{t.bonneJournee} {nomeConducteur} 👋</Text>

            {/* Stats grid */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, overflow: 'hidden' }}>
                <View style={{ height: 4, backgroundColor: '#f5a623' }} />
                <View style={{ padding: 14, alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>SERVICE</Text>
                  <Text style={{ fontSize: 28, fontWeight: '800', color: '#f5a623', letterSpacing: -1 }}>{summaryData ? fmtHM(summaryData.service) : '—'}</Text>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, overflow: 'hidden' }}>
                <View style={{ height: 4, backgroundColor: '#2980b9' }} />
                <View style={{ padding: 14, alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>DISTANCE</Text>
                  <Text style={{ fontSize: 28, fontWeight: '800', color: '#2980b9', letterSpacing: -1 }}>{summaryData ? `${summaryData.km}` : '—'}<Text style={{ fontSize: 14 }}> km</Text></Text>
                </View>
              </View>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, overflow: 'hidden' }}>
                <View style={{ height: 4, backgroundColor: '#8e44ad' }} />
                <View style={{ padding: 14, alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>FRAIS</Text>
                  <Text style={{ fontSize: 28, fontWeight: '800', color: '#8e44ad', letterSpacing: -1 }}>{summaryData ? `${summaryData.frais.toFixed(0)}` : '—'}<Text style={{ fontSize: 14 }}>€</Text></Text>
                </View>
              </View>
            </View>

            {/* Weekly totals */}
            <View style={{ backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)', marginBottom: 20 }}>
              <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>{t.cumulSemaine}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 14, color: c.textSub }}>{t.heuresTotales}</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{summaryData ? fmtHM(summaryData.semHeures) : '—'}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ fontSize: 14, color: c.textSub }}>{t.fraisTotaux}</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#27ae60' }}>{summaryData ? `${summaryData.semFrais.toFixed(2)}€` : '—'}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={{ backgroundColor: '#f5a623', borderRadius: 16, padding: 16, alignItems: 'center' }}
              onPress={() => setShowSummaryModal(false)}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: 'white' }}>{t.parfait}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PONTO 2 — MODAL DÉTAIL PAUSES CE 561/2006 */}
      {/* ── STATS MODAL ── */}
      <Modal visible={showStats} transparent animationType="slide" onRequestClose={() => { setShowStats(false); setStatsBarDetail(null) }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '92%', borderWidth: 1, borderColor: c.cardBorder }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, letterSpacing: 1 }}>📊 STATS</Text>
              <TouchableOpacity onPress={() => { setShowStats(false); setStatsBarDetail(null) }} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.progressBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 16, color: c.textSub, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 1, backgroundColor: c.cardBorder }} />

            <ScrollView ref={statsScrollRef} showsVerticalScrollIndicator={true} scrollEventThrottle={16} removeClippedSubviews bounces={false} keyboardShouldPersistTaps="handled" style={{ padding: 16 }} indicatorStyle="white">
                {(() => {
                  // ── Shared helpers ──────────────────────────────────────────
                  const today = new Date()
                  const parseDate = (dateStr: string): Date | null => {
                    const p = (dateStr || '').split('/')
                    if (p.length === 3) return new Date(+p[2], +p[1] - 1, +p[0])
                    if (p.length === 2) return new Date(today.getFullYear(), +p[1] - 1, +p[0])
                    return null
                  }
                  const parseHM = (s: string): number => {
                    const [h, m] = (s || '0h0').replace('h', ':').split(':').map(Number)
                    return (h || 0) * 60 + (m || 0)
                  }
                  const dayOfWeek = (today.getDay() + 6) % 7
                  const monday = new Date(today); monday.setDate(today.getDate() - dayOfWeek); monday.setHours(0,0,0,0)
                  const thisMonth = today.getMonth(); const thisYear = today.getFullYear()
                  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1
                  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear

                  const qualifying = diasHistorique.filter(j => (j.segServico || 0) > 7200 && ['TRAB','DEC'].includes(j.type))
                  const sortedQ = [...qualifying].sort((a, b) => {
                    const da = parseDate(a.date), db = parseDate(b.date)
                    return (db?.getTime() ?? 0) - (da?.getTime() ?? 0)
                  })

                  // Section accordion header with auto-scroll
                  const sectionPositions: Record<string, number> = {}
                  const AccHeader = ({ label, k }: { label: string; k: keyof typeof statsOpen }) => (
                    <View onLayout={(e) => { sectionPositions[k] = e.nativeEvent.layout.y }}
                      style={{ paddingVertical: 10, paddingHorizontal: 2 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{label}</Text>
                    </View>
                  )
                  const SectionWrap = ({ children }: { children: React.ReactNode }) => (
                    <View style={{ backgroundColor: c.bg, borderRadius: 14, padding: 14, marginBottom: 4 }}>{children}</View>
                  )
                  const ProgBar = ({ pct, color }: { pct: number; color: string }) => (
                    <View style={{ height: 6, backgroundColor: c.progressBg, borderRadius: 3, marginVertical: 6 }}>
                      <View style={{ height: 6, width: `${Math.min(pct, 100)}%` as any, backgroundColor: color, borderRadius: 3 }} />
                    </View>
                  )
                  const Divider = () => <View style={{ height: 1, backgroundColor: c.cardBorder, marginVertical: 8 }} />

                  // ── SECTION 1 — REPOS QUOTIDIEN ───────────────────────────
                  const reposQSec = (() => {
                    if (sortedQ.length < 2) return null
                    const last = sortedQ[0]; const prev = sortedQ[1]
                    const prevDate = parseDate(prev.date)
                    const lastDate = parseDate(last.date)
                    if (!prevDate || !lastDate) return null
                    const prevFinMin = parseHM(prev.fin || '18h00')
                    const lastDebMin = parseHM(last.debut || '06h00')
                    const prevFinDate = new Date(prevDate); prevFinDate.setHours(Math.floor(prevFinMin/60), prevFinMin%60,0,0)
                    const lastDebDate = new Date(lastDate); lastDebDate.setHours(Math.floor(lastDebMin/60), lastDebMin%60,0,0)
                    if (lastDebDate <= prevFinDate) lastDebDate.setDate(lastDebDate.getDate() + 1)
                    const restSec = Math.max(0, (lastDebDate.getTime() - prevFinDate.getTime()) / 1000)
                    return restSec
                  })()
                  const restColor = reposQSec == null ? '#888' : reposQSec >= 39600 ? '#27ae60' : reposQSec >= 32400 ? '#f39c12' : '#e74c3c'
                  const restLabel = reposQSec == null ? '—' : reposQSec >= 39600 ? '✅ ≥ 11h — Normal' : reposQSec >= 32400 ? '⚠️ 9-11h — Réduit' : '❌ < 9h — Insuffisant'
                  const last3 = sortedQ.slice(0, Math.min(4, sortedQ.length))

                  // ── SECTION 2 — REPOS HEBDO ───────────────────────────────
                  const lastFriday = [...diasHistorique].reverse().find(j => j.jour === 'Vendredi')
                  const hebdoSec = (() => {
                    if (!lastFriday) return null
                    const d = parseDate(lastFriday.date)
                    if (!d) return null
                    const finMin = parseHM(lastFriday.fin || '18h00')
                    const finDate = new Date(d); finDate.setHours(Math.floor(finMin/60), finMin%60,0,0)
                    return Math.max(0, (today.getTime() - finDate.getTime()) / 1000)
                  })()
                  const hebdoPct = hebdoSec ? Math.min((hebdoSec / (45*3600)) * 100, 100) : 0
                  const hebdoColor = hebdoSec && hebdoSec >= 45*3600 ? '#27ae60' : '#f39c12'

                  // ── SECTION 3 — 90H / 2 SEM ──────────────────────────────
                  const cutoff14 = new Date(today); cutoff14.setDate(today.getDate() - 14)
                  const last14 = diasHistorique.filter(j => { const d = parseDate(j.date); return d && d >= cutoff14 && ['TRAB','DEC'].includes(j.type) })
                  const tot14Seg = last14.reduce((a, j) => a + (j.segServico || 0), 0)
                  const max90h = 90 * 3600
                  const pct90 = Math.min((tot14Seg / max90h) * 100, 100)
                  const col90 = pct90 >= 100 ? '#e74c3c' : pct90 >= 85 ? '#f39c12' : '#27ae60'
                  const reste90 = max90h - tot14Seg

                  // ── SECTION 4 — 7 DERNIERS JOURS ─────────────────────────
                  const last7Days: Date[] = Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() - 6 + i); return d })
                  const JABBR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']
                  const barDetail = statsBarDetail; const setBarDetail = setStatsBarDetail

                          const semaineDays = diasHistorique.filter(j => { const d = parseDate(j.date); return d && d >= monday && ['TRAB','DEC'].includes(j.type) })
                  const moisDays = diasHistorique.filter(j => { const d = parseDate(j.date); return d && d?.getMonth() === thisMonth && d?.getFullYear() === thisYear && ['TRAB','DEC'].includes(j.type) })
                  const lastMoisDays = diasHistorique.filter(j => { const d = parseDate(j.date); return d && d?.getMonth() === lastMonth && d?.getFullYear() === lastMonthYear && ['TRAB','DEC'].includes(j.type) })

                  // ── SECTION 6 — PAUSES ────────────────────────────────────
                  // Approximate valid pauses from historique: pauseTotal >= 45min = valid
                  const semPauseDays = semaineDays.filter(j => (j.segPausa || 0) >= 2700)
                  const pctValidPauses = semaineDays.length > 0 ? Math.round((semPauseDays.length / semaineDays.length) * 100) : 0
                  const avgPausePerDay = semaineDays.length > 0 ? semaineDays.reduce((a,j) => a + (j.segPausa||0),0) / semaineDays.length : 0

                  // ── SECTION 7 — FRAIS ─────────────────────────────────────
                  const totalFraisMois = moisDays.reduce((a,j) => a + (j.frais||0),0)
                  const totalFraisLastMois = lastMoisDays.reduce((a,j) => a + (j.frais||0),0)
                  const avgFraisDay = moisDays.length > 0 ? totalFraisMois / moisDays.length : 0
                  const daysInMonth = new Date(thisYear, thisMonth+1, 0).getDate()
                  const projFrais = avgFraisDay * daysInMonth
                  const decouchesMois = moisDays.filter(j => j.decouche || j.type === 'DEC').length

                  // ── SECTION 8 — AMPLITUDE ─────────────────────────────────
                  const allTravDays = diasHistorique.filter(j => ['TRAB','DEC'].includes(j.type) && j.debut && j.fin)
                  const ampOf = (j: any) => { let a = parseHM(j.fin) - parseHM(j.debut); if (a < 0) a += 24*60; return a * 60 }
                  const ampSemDays = semaineDays.filter(j => j.debut && j.fin)
                  const avgAmpSem = ampSemDays.length > 0 ? ampSemDays.reduce((a,j) => a + ampOf(j),0) / ampSemDays.length : 0
                  const over12hMois = moisDays.filter(j => j.debut && j.fin && ampOf(j) >= 12*3600).length
                  const longestDay = allTravDays.reduce((best: any, j: any) => (!best || ampOf(j) > ampOf(best)) ? j : best, null)

                  // ── SECTION 9 — ASSIDUITÉ ─────────────────────────────────
                  const travMois = moisDays.length
                  const reposMois = diasHistorique.filter(j => { const d = parseDate(j.date); return d && d?.getMonth() === thisMonth && d?.getFullYear() === thisYear && ['OFF','RC','FERIE','FER'].includes(j.type) }).length
                  const sortedAll = [...diasHistorique].sort((a,b) => { const da=parseDate(a.date),db=parseDate(b.date); return (db?.getTime()??0)-(da?.getTime()??0) })
                  let streak = 0
                  for (let i = 0; i < sortedAll.length; i++) {
                    if (['TRAB','DEC'].includes(sortedAll[i].type)) streak++
                    else break
                  }

                  // ── SECTION 10 — RECORDS ──────────────────────────────────
                  const longestServ = diasHistorique.reduce((best: any, j: any) => (!best || (j.segServico||0) > (best.segServico||0)) ? j : best, null)
                  const weeklyTotals: Record<string,number> = {}
                  diasHistorique.forEach(j => {
                    const d = parseDate(j.date); if (!d || !['TRAB','DEC'].includes(j.type)) return
                    const mon = new Date(d); mon.setDate(d.getDate() - (d.getDay()+6)%7); mon.setHours(0,0,0,0)
                    const k = mon.toISOString(); weeklyTotals[k] = (weeklyTotals[k]||0) + (j.segServico||0)
                  })
                  const bestWeekSec = Object.values(weeklyTotals).reduce((a,b) => Math.max(a,b), 0)
                  const monthlyFrais: Record<string,number> = {}
                  diasHistorique.forEach(j => {
                    const d = parseDate(j.date); if (!d) return
                    const k = `${d.getFullYear()}-${d.getMonth()}`; monthlyFrais[k] = (monthlyFrais[k]||0) + (j.frais||0)
                  })
                  const bestMonthFrais = Object.values(monthlyFrais).reduce((a,b) => Math.max(a,b), 0)
                  const mostKmDay = diasHistorique.reduce((best: any, j: any) => (!best || (j.kmDiarios||0) > (best.kmDiarios||0)) ? j : best, null)

                  return (
                    <>
                      {/* ── S1 REPOS QUOTIDIEN ── */}
                      <View style={{ backgroundColor: c.card, borderRadius: 16, marginBottom: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: c.cardBorder }}>
                        <AccHeader label="🛌 REPOS QUOTIDIEN" k="repos" />
                        {statsOpen.repos && (
                          <SectionWrap>
                            {reposQSec == null ? (
                              <Text style={{ color: c.textSub, fontSize: 13 }}>Pas assez de données (2 jours min.)</Text>
                            ) : (
                              <>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Text style={{ fontSize: 13, color: c.textSub }}>Dernier repos</Text>
                                  <Text style={{ fontSize: 16, fontWeight: '800', color: restColor }}>{fmtHM(reposQSec)}</Text>
                                </View>
                                <ProgBar pct={(reposQSec / (11*3600)) * 100} color={restColor} />
                                <Text style={{ fontSize: 12, fontWeight: '700', color: restColor, marginBottom: 8 }}>{restLabel}</Text>
                                <Divider />
                                <Text style={{ fontSize: 11, fontWeight: '700', color: c.textLabel, letterSpacing: 1, marginBottom: 6 }}>3 DERNIERS JOURS</Text>
                                {last3.slice(0,3).map((j,i) => (
                                  <View key={j.id||i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                                    <Text style={{ fontSize: 12, color: c.textSub }}>{j.jour} {j.date}</Text>
                                    <Text style={{ fontSize: 12, fontWeight: '700', color: c.text }}>{j.debut} → {j.fin}</Text>
                                  </View>
                                ))}
                              </>
                            )}
                          </SectionWrap>
                        )}
                      </View>

                      {/* ── S2 REPOS HEBDO ── */}
                      <View style={{ backgroundColor: c.card, borderRadius: 16, marginBottom: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: c.cardBorder }}>
                        <AccHeader label="🏠 REPOS HEBDOMADAIRE" k="hebdo" />
                        {statsOpen.hebdo && (
                          <SectionWrap>
                            {!lastFriday ? (
                              <Text style={{ color: c.textSub, fontSize: 13 }}>Aucun vendredi trouvé</Text>
                            ) : (
                              <>
                                <Text style={{ fontSize: 11, color: c.textSub, marginBottom: 4 }}>Depuis vendredi {lastFriday.date} fin {lastFriday.fin}</Text>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Text style={{ fontSize: 13, color: c.textSub }}>Repos écoulé</Text>
                                  <Text style={{ fontSize: 16, fontWeight: '800', color: hebdoColor }}>{hebdoSec ? fmtHM(hebdoSec) : '—'}</Text>
                                </View>
                                <ProgBar pct={hebdoPct} color={hebdoColor} />
                                <Text style={{ fontSize: 12, fontWeight: '700', color: hebdoColor }}>
                                  {hebdoSec && hebdoSec >= 45*3600 ? '✅ Repos hebdo normal (45h) respecté' : `⚠️ ${hebdoSec ? fmtHM(Math.max(0,45*3600-hebdoSec)) : '45h00'} restantes`}
                                </Text>
                              </>
                            )}
                          </SectionWrap>
                        )}
                      </View>

                      {/* ── S3 90H / 2 SEM — MIXTE + LD only ── */}
                      {(profil === 'MIXTE' || profil === 'LD') && (
                        <View style={{ backgroundColor: c.card, borderRadius: 16, marginBottom: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: c.cardBorder }}>
                          <AccHeader label="📅 90H / 2 SEM." k="bsem" />
                          {statsOpen.bsem && (
                            <SectionWrap>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={{ fontSize: 13, color: c.textSub }}>14 derniers jours</Text>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: col90 }}>{fmtHM(tot14Seg)} / 90h</Text>
                              </View>
                              <ProgBar pct={pct90} color={col90} />
                              {reste90 < 0
                                ? <Text style={{ fontSize: 13, fontWeight: '800', color: '#e74c3c' }}>🚨 Dépassée de {fmtHM(Math.abs(reste90))}</Text>
                                : <Text style={{ fontSize: 13, fontWeight: '700', color: '#27ae60' }}>Reste {fmtHM(reste90)}</Text>
                              }
                            </SectionWrap>
                          )}
                        </View>
                      )}

                      {/* ── S4 7 DERNIERS JOURS ── */}
                      <View style={{ backgroundColor: c.card, borderRadius: 16, marginBottom: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: c.cardBorder }}>
                        <AccHeader label="📆 7 DERNIERS JOURS" k="sept" />
                        {statsOpen.sept && (
                          <SectionWrap>
                            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 4, marginBottom: 6 }}>
                              {last7Days.map((day, i) => {
                                const dStr = `${String(day.getDate()).padStart(2,'0')}/${String(day.getMonth()+1).padStart(2,'0')}`
                                const entry = diasHistorique.find(j => (j.date||'').startsWith(dStr))
                                const seg = entry ? (entry.segServico||0) : 0
                                const h = seg / 3600
                                const barH = Math.min((h / 12) * 64, 64)
                                const bColor = h > 12 ? '#e74c3c' : h > 10 ? '#f39c12' : h > 0 ? '#27ae60' : c.progressBg
                                const dow = (day.getDay()+6)%7
                                return (
                                  <TouchableOpacity key={i} style={{ flex: 1, alignItems: 'center' }} onPress={() => setBarDetail(barDetail?.date === dStr ? null : (entry || { date: dStr, noData: true }))}>
                                    <View style={{ width: '100%', height: Math.max(barH, 3), backgroundColor: bColor, borderRadius: 4 }} />
                                    <Text style={{ fontSize: 9, color: c.textSub, marginTop: 3, fontWeight: '600' }}>{JABBR[dow]}</Text>
                                    <Text style={{ fontSize: 8, color: c.textSub }}>{String(day.getDate()).padStart(2,'0')}</Text>
                                  </TouchableOpacity>
                                )
                              })}
                            </View>
                            {barDetail && (
                              <View style={{ backgroundColor: c.progressBg, borderRadius: 10, padding: 10, marginTop: 4 }}>
                                {barDetail.noData ? (
                                  <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center' }}>Pas de données</Text>
                                ) : (
                                  <>
                                    <Text style={{ fontSize: 12, fontWeight: '800', color: c.text, marginBottom: 4 }}>{barDetail.jour} {barDetail.date}</Text>
                                    <Text style={{ fontSize: 12, color: c.textSub }}>{barDetail.debut} → {barDetail.fin} · Service {fmtHM(barDetail.segServico||0)}</Text>
                                    <Text style={{ fontSize: 12, color: '#27ae60' }}>Frais {(barDetail.frais||0).toFixed(2)}€{barDetail.kmDiarios ? ` · ${barDetail.kmDiarios} km` : ''}</Text>
                                  </>
                                )}
                              </View>
                            )}
                          </SectionWrap>
                        )}
                      </View>

                      {/* ── S6 PAUSES ── */}
                      <View style={{ backgroundColor: c.card, borderRadius: 16, marginBottom: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: c.cardBorder }}>
                        <AccHeader label="⏸ PAUSES" k="pauses" />
                        {statsOpen.pauses && (
                          <SectionWrap>
                            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>CE VALIDES</Text>
                                <Text style={{ fontSize: 18, fontWeight: '800', color: pctValidPauses >= 80 ? '#27ae60' : '#f39c12', marginTop: 2 }}>{pctValidPauses}%</Text>
                              </View>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>MOY./JOUR</Text>
                                <Text style={{ fontSize: 18, fontWeight: '800', color: '#2980b9', marginTop: 2 }}>{fmtHM(avgPausePerDay)}</Text>
                              </View>
                            </View>
                            <Text style={{ fontSize: 11, color: c.textSub, textAlign: 'center', marginTop: 4 }}>Pause ≥ 45min comptée comme valide CE 561/2006</Text>
                          </SectionWrap>
                        )}
                      </View>

                      {/* ── S7 FRAIS ── */}
                      <View style={{ backgroundColor: c.card, borderRadius: 16, marginBottom: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: c.cardBorder }}>
                        <AccHeader label="💰 FRAIS" k="frais" />
                        {statsOpen.frais && (
                          <SectionWrap>
                            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>CE MOIS</Text>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: '#27ae60', marginTop: 2 }}>{totalFraisMois.toFixed(0)}€</Text>
                              </View>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>PROJECTION</Text>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: '#f5a623', marginTop: 2 }}>{projFrais.toFixed(0)}€</Text>
                              </View>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>DÉCOUCHÉS</Text>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: '#2980b9', marginTop: 2 }}>{decouchesMois}</Text>
                              </View>
                            </View>
                            <Divider />
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                              <Text style={{ fontSize: 12, color: c.textSub }}>Moyenne / jour travaillé</Text>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: c.text }}>{avgFraisDay.toFixed(2)}€</Text>
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                              <Text style={{ fontSize: 12, color: c.textSub }}>Mois précédent</Text>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: totalFraisMois >= totalFraisLastMois ? '#27ae60' : '#e74c3c' }}>
                                {totalFraisLastMois.toFixed(0)}€ {totalFraisMois > totalFraisLastMois ? '↑' : totalFraisMois < totalFraisLastMois ? '↓' : '='}
                              </Text>
                            </View>
                          </SectionWrap>
                        )}
                      </View>

                      {/* ── S8 AMPLITUDE ── */}
                      <View style={{ backgroundColor: c.card, borderRadius: 16, marginBottom: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: c.cardBorder }}>
                        <AccHeader label="📏 AMPLITUDE" k="amplitude" />
                        {statsOpen.amplitude && (
                          <SectionWrap>
                            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>MOY. SEMAINE</Text>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: '#f5a623', marginTop: 2 }}>{fmtHM(avgAmpSem)}</Text>
                              </View>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>&gt;12H CE MOIS</Text>
                                <Text style={{ fontSize: 16, fontWeight: '800', color: over12hMois > 0 ? '#e74c3c' : '#27ae60', marginTop: 2 }}>{over12hMois} j.</Text>
                              </View>
                            </View>
                            {longestDay && (
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                                <Text style={{ fontSize: 12, color: c.textSub }}>Journée la plus longue</Text>
                                <Text style={{ fontSize: 12, fontWeight: '700', color: c.text }}>{longestDay.jour} {longestDay.date} · {fmtHM(ampOf(longestDay))}</Text>
                              </View>
                            )}
                          </SectionWrap>
                        )}
                      </View>

                      {/* ── S9 ASSIDUITÉ ── */}
                      <View style={{ backgroundColor: c.card, borderRadius: 16, marginBottom: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: c.cardBorder }}>
                        <AccHeader label="🗓 ASSIDUITÉ" k="assiduite" />
                        {statsOpen.assiduite && (
                          <SectionWrap>
                            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>TRAVAIL</Text>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#27ae60', marginTop: 2 }}>{travMois}</Text>
                              </View>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>REPOS/CONGÉS</Text>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#9b59b6', marginTop: 2 }}>{reposMois}</Text>
                              </View>
                              <View style={{ flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700' }}>STREAK</Text>
                                <Text style={{ fontSize: 20, fontWeight: '800', color: '#f5a623', marginTop: 2 }}>{streak}🔥</Text>
                              </View>
                            </View>
                          </SectionWrap>
                        )}
                      </View>

                      {/* ── S10 RECORDS ── */}
                      <View style={{ backgroundColor: c.card, borderRadius: 16, marginBottom: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: c.cardBorder }}>
                        <AccHeader label="🏆 RECORDS" k="records" />
                        {statsOpen.records && (
                          <SectionWrap>
                            {[
                              { label: '⏱ Service le plus long', val: longestServ ? `${longestServ.jour} ${longestServ.date} · ${fmtHM(longestServ.segServico||0)}` : '—' },
                              { label: '📅 Meilleure semaine', val: bestWeekSec > 0 ? fmtHM(bestWeekSec) : '—' },
                              { label: '💰 Meilleur mois (frais)', val: bestMonthFrais > 0 ? `${bestMonthFrais.toFixed(0)}€` : '—' },
                              { label: '🛣 Max km en 1 jour', val: mostKmDay && (mostKmDay.kmDiarios||0) > 0 ? `${mostKmDay.kmDiarios} km — ${mostKmDay.jour} ${mostKmDay.date}` : '—' },
                            ].map((r,i) => (
                              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: i < 3 ? 1 : 0, borderBottomColor: c.cardBorder }}>
                                <Text style={{ fontSize: 12, color: c.textSub }}>{r.label}</Text>
                                <Text style={{ fontSize: 12, fontWeight: '800', color: c.text, maxWidth: '55%', textAlign: 'right' }}>{r.val}</Text>
                              </View>
                            ))}
                          </SectionWrap>
                        )}
                      </View>
                    </>
                  )
                })()}
              </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL — Durée de pause (remplace l'Alert) */}
      <Modal visible={showPausaDuracaoModal} transparent animationType="slide" onRequestClose={() => setShowPausaDuracaoModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'flex-end', padding: 16, paddingBottom: 32 }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#f39c12' }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>⏸ Démarrer une pause</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 20, lineHeight: 18 }}>
              {'Durée prévue ? (optionnel — alerte à la fin)'}
            </Text>

            {/* TextInput HH:MM */}
            <TextInput
              value={pausaDuracaoInput}
              onChangeText={v => setPausaDuracaoInput(v.replace(/[^0-9hH:]/g, ''))}
              placeholder="HH:MM  ou  45"
              placeholderTextColor="#6b7394"
              keyboardType="numbers-and-punctuation"
              maxLength={6}
              style={{ borderWidth: 1.5, borderColor: pausaDuracaoInput ? '#f39c12' : '#2a3045', borderRadius: 14, padding: 14, fontSize: 28, fontWeight: '900', color: c.text, backgroundColor: c.bg, textAlign: 'center', marginBottom: 16, letterSpacing: 2 }}
            />

            {/* Presets */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20, justifyContent: 'center' }}>
              {[
                { label: '15min', val: '00:15' },
                { label: '20min', val: '00:20' },
                { label: '30min', val: '00:30' },
                { label: '45min', val: '00:45' },
                { label: '1h00', val: '01:00' },
              ].map(({ label, val }) => (
                <TouchableOpacity
                  key={val}
                  onPress={() => setPausaDuracaoInput(val)}
                  style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: pausaDuracaoInput === val ? 'rgba(243,156,18,0.18)' : c.bg, borderWidth: pausaDuracaoInput === val ? 1.5 : 1, borderColor: pausaDuracaoInput === val ? '#f39c12' : '#2a3045' }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: pausaDuracaoInput === val ? '#f39c12' : c.textSub }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Bouton confirmer */}
            <TouchableOpacity
              style={{ backgroundColor: '#f39c12', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10 }}
              onPress={confirmarIniciarPausa}
            >
              <Text style={{ fontSize: 16, fontWeight: '900', color: 'white' }}>{'\u25b6 Démarrer la pause'}</Text>
            </TouchableOpacity>

            {/* Annuler */}
            <TouchableOpacity style={{ padding: 10, alignItems: 'center' }} onPress={() => setShowPausaDuracaoModal(false)}>
              <Text style={{ fontSize: 13, color: c.textSub }}>Annuler</Text>
            </TouchableOpacity>
          </View>
          </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={showPausasModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#f39c12', width: '100%' }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>⏸ Pauses CE 561/2006</Text>
            {pausas.length === 0 && segPausa === 0 ? (
              <Text style={{ textAlign: 'center', color: c.textSub, fontSize: 13, marginBottom: 16 }}>Aucune pause enregistrée</Text>
            ) : (
              <View style={{ marginBottom: 16, gap: 8 }}>
                {[...pausas, ...(segPausa > 0 ? [{ dur: segPausa, inicio: pausaInicioRef.current }] : [])].map((p, i) => {
                  const min = Math.floor(p.dur / 60)
                  const isValid15 = i === 0 && min >= 15
                  const isValid30 = i > 0 && min >= 30 && pausas.slice(0, i).some(prev => Math.floor(prev.dur / 60) >= 15)
                  const color = (isValid15 || isValid30 || min >= 45) ? '#27ae60' : '#f39c12'
                  return (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: `${color}18`, borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: color }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color }}>Pause {i + 1}{i === pausas.length && segPausa > 0 ? ' (en cours)' : ''}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color }}>{min}min</Text>
                    </View>
                  )
                })}
              </View>
            )}
            <View style={{ backgroundColor: c.bg, borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center' }}>Total pauses : <Text style={{ fontWeight: '800', color: c.text }}>{fmtHM(segPausaTotal)}</Text></Text>
            </View>
            <TouchableOpacity style={{ backgroundColor: '#f39c12', borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={() => setShowPausasModal(false)}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>Fermer</Text>
            </TouchableOpacity>
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
  badgeText: { fontSize: 13, fontWeight: '700', color: '#f5a623', letterSpacing: 1 },
  greeting: { paddingHorizontal: 20, paddingBottom: 12 },
  dateText: { fontSize: 14, marginBottom: 2 },
  greetingSub: { fontSize: 14, marginBottom: 4 },
  greetingName: { fontSize: 24, fontWeight: '800' },
  conducaoStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  conducaoDot: { width: 8, height: 8, borderRadius: 4 },
  conducaoText: { fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  modeEmoji: { fontSize: 14, marginLeft: 4 },
  nuitBandeau: { marginTop: 6, backgroundColor: 'rgba(41,128,185,0.15)', borderWidth: 1, borderColor: '#2980b9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  nuitBandeauText: { fontSize: 13, color: '#2980b9', fontWeight: '600' },
  pausaBandeau: { marginHorizontal: 20, marginBottom: 10, borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pausaBandeauText: { fontSize: 14, fontWeight: '700', flex: 1 },
  pausaBandeauBtns: { flexDirection: 'row', gap: 8 },
  pausaBandeauBtnSim: { backgroundColor: '#27ae60', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  pausaBandeauBtnNao: { borderWidth: 1, borderColor: '#f39c12', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  btnCircularWrap: { alignItems: 'center', paddingVertical: 28 },
  btnCircular: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#f5a623', alignItems: 'center', justifyContent: 'center', elevation: 10, shadowColor: '#f5a623', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
  btnCircularIcon: { fontSize: 36, marginBottom: 4 },
  btnCircularLabel: { fontSize: 14, fontWeight: '800', color: 'white', letterSpacing: 2 },
  statsRow: { flexDirection: 'row', gap: 10, marginHorizontal: 20 },
  statBox: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  statVal: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 13, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  timerCard: { marginHorizontal: 20, marginBottom: 12, borderRadius: 20, borderWidth: 1, padding: 18, overflow: 'hidden' },
  timerCardPause: { borderColor: '#f39c12' },
  timerCardConducao: { borderColor: '#27ae60' },
  accentBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#f5a623' },
  timerStatus: { fontSize: 13, fontWeight: '700', letterSpacing: 3, marginBottom: 8 },
  timerBig: { fontSize: 52, fontWeight: '800', letterSpacing: -1 },
  timerLabel: { fontSize: 13, marginBottom: 4 },
  servicoBox: { position: 'relative', borderRadius: 10, marginTop: 10, overflow: 'hidden' },
  servicoFill: { position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 10 },
  servicoContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10 },
  servicoLabel: { fontSize: 14, fontWeight: '600' },
  servicoVal: { fontSize: 14, fontWeight: '800' },
  pauseBarBg: { height: 8, borderRadius: 4, overflow: 'hidden', marginVertical: 8 },
  pauseBarFill: { height: '100%', borderRadius: 4 },
  pauseAlert: { fontSize: 13, fontWeight: '700', color: '#e74c3c', marginTop: 4 },
  pauseDivider: { height: 0.5, backgroundColor: '#2a3045', marginVertical: 10 },
  conducaoGelada: { fontSize: 28, fontWeight: '800', letterSpacing: -1 },
  tooltipBox: { marginHorizontal: 20, marginBottom: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  tooltipText: { fontSize: 13, fontWeight: '600', lineHeight: 20 },
  miniRow: { flexDirection: 'row', borderRadius: 14, marginHorizontal: 20, marginBottom: 12, overflow: 'hidden', borderWidth: 1 },
  miniBox: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  miniDivider: { width: 1 },
  miniIcon: { fontSize: 16, marginBottom: 4 },
  miniVal: { fontSize: 16, fontWeight: '800' },
  miniLabel: { fontSize: 13, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  actionRow: { flexDirection: 'row', gap: 10, marginHorizontal: 20, marginBottom: 12 },
  btnPause: { flex: 1, backgroundColor: 'rgba(243,156,18,0.12)', borderWidth: 1.5, borderColor: '#f39c12', borderRadius: 50, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  btnReprendre: { borderColor: '#27ae60', backgroundColor: 'rgba(39,174,96,0.12)' },
  btnPauseIcon: { fontSize: 20 },
  btnPauseLabel: { fontSize: 14, fontWeight: '700', color: '#f39c12', letterSpacing: 1 },
  btnStop: { flex: 1, backgroundColor: 'rgba(192,57,43,0.12)', borderWidth: 1.5, borderColor: '#c0392b', borderRadius: 50, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  btnStopIcon: { fontSize: 20 },
  btnStopLabel: { fontSize: 14, fontWeight: '700', color: '#c0392b', letterSpacing: 1 },
  decoucheCard: { borderWidth: 1, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  decoucheLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  decoucheSub: { fontSize: 13, marginTop: 2 },
  limites: { marginHorizontal: 20, marginBottom: 12 },
  limitesTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 3, marginBottom: 10 },
  horaSaidaBox: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  horaSaidaLabel: { fontSize: 14, fontWeight: '600' },
  horaSaidaVal: { fontSize: 18, fontWeight: '800' },
  limiteItem: { marginBottom: 10 },
  limiteRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  limiteName: { fontSize: 14, fontWeight: '600' },
  limiteVal: { fontSize: 14, fontWeight: '700' },
  progressBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1 },
  modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: 16, textAlign: 'center', letterSpacing: 1 },
  modalOption: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, marginBottom: 8, borderWidth: 1 },
  modalOptionActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.08)' },
  modalEmoji: { fontSize: 24 },
  modalOptionInfo: { flex: 1 },

  modalOptionTitle: { fontSize: 15, fontWeight: '700' },
  modalOptionSub: { fontSize: 13, marginTop: 2 },
  modalCheck: { fontSize: 16, color: '#f5a623', fontWeight: '800' },
  semaineCard: { marginHorizontal: 20, marginBottom: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  semaineHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  semaineLabel: { fontSize: 14, fontWeight: '600' },
  semaineVal: { fontSize: 14, fontWeight: '700' },
  semCard: { marginHorizontal: 20, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  semHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  semTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  semHours: { fontSize: 18, fontWeight: '800' },
  semMax: { fontSize: 14, fontWeight: '600' },
  semBarBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  semBarFill: { height: '100%', borderRadius: 3 },
  semEmpty: { fontSize: 14, textAlign: 'center', paddingVertical: 4 },
  semStats: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },

  semStat: { fontSize: 14, fontWeight: '600' },
  semStatSep: { fontSize: 12 },
})
