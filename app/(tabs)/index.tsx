import { useFocusEffect } from 'expo-router'
import { Accelerometer } from 'expo-sensors'
import React, { useEffect, useState, useRef } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Switch, Alert, StyleSheet, Modal, AppState, TextInput, KeyboardAvoidingView, Platform, Animated, Easing, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { useTheme } from '../../context/ThemeContext'
import { useLangue } from '../../context/LangueContext'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { LOCATION_TASK_NAME } from '../../src/tasks'
import { calcularFraisJour } from '../../src/frais'
import {
  pedirPermissaoNotificacoes,
  agendarAlertaPausa,
  agendarAlertaAmplitude,
  cancelarTodosAlertas,
  cancelarRappelSaisie,
  agendarRappelSaisie,
} from '../../src/notifications'
type Profil = 'CD' | 'MIXTE' | 'LD'
const PAUSA_MAX = 4.5 * 3600
const VELOCIDADE_MIN = 8
const STORAGE_KEY = 'TACHOMAX_estado'
const CONDUCAO_SEGUNDOS_ON = 8   // consecutive GPS ticks at speed before setEmConducao(true)
const CONDUCAO_PARAR_ABAIXO_3_S = 3
const CONDUCAO_PARAR_ABAIXO_5_S = 12
const CONDUCAO_PARAR_ABAIXO_7_S = 15
const GPS_MOVIMENTO_SALTO_MAX_KM = 1
const GPS_MOVIMENTO_GAP_S = 30
const GPS_MOVIMENTO_GAP_MAX_KM = 50

export default function AujourdhuiScreen() {
  const { themeSombre } = useTheme()
  const { t } = useLangue()
  const [enService, setEnService] = useState(false)
  const [emPausa, setEmPausa] = useState(false)
  const [decouche, setDecouche] = useState(false)
  const [emConducao, setEmConducao] = useState(false)
  const [segServico, setSegServico] = useState(0)
  const [segConducao, setSegConducao] = useState(0)
  const [segConducaoDiario, setSegConducaoDiario] = useState(0)
  const [pausaReglementaireOk, setPausaReglementaireOk] = useState(false)
  const [modeTest, setModeTest] = useState(false)
  const [segAmplitude, setSegAmplitude] = useState(0)
  const [segPausa, setSegPausa] = useState(0)
  const [segPausaTotal, setSegPausaTotal] = useState(0)
  const [kmDiarios, setKmDiarios] = useState(0)
  const [kmInicioTacho, setKmInicioTacho] = useState(0)
  const [kmInicioInput, setKmInicioInput] = useState('')
  const [kmFimInput, setKmFimInput] = useState('')
  const [horaInicio, setHoraInicio] = useState('')
  const [dateInicio, setDateInicio] = useState<Date | null>(null)
  const [profil, setProfil] = useState<Profil>('MIXTE')
  const [modoTacho, setModoTacho] = useState<'crescente' | 'decrescente'>('crescente')
  const [nomeConducteur, setNomeConducteur] = useState('Bruno')
  const [showProfil, setShowProfil] = useState(false)
  const [statsSemaine, setStatsSemaine] = useState({ heures: 0, decouche: 0, frais: 0, jours: 0 })
  const [velocidade, setVelocidade] = useState(0)
  const [modeNuit, setModeNuit] = useState(false)
  const [tooltip, setTooltip] = useState<'conduite' | 'service' | 'amplitude' | null>(null)
  const [showCorrecao, setShowCorrecao] = useState(false)
  const [showInputCorrecao, setShowInputCorrecao] = useState(false)
  const [inputHoras, setInputHoras] = useState('')
  const [inputMinutos, setInputMinutos] = useState('')
  const [gpsOk, setGpsOk] = useState(true)
  const [paradoSegundos, setParadoSegundos] = useState(0)
  const [showPausaBandeau, setShowPausaBandeau] = useState(false)
  const [showTerminerModal, setShowTerminerModal] = useState(false)
  const [showSummaryModal, setShowSummaryModal] = useState(false)
  const [summaryData, setSummaryData] = useState<{service: number; conduite: number; km: number; frais: number; semHeures: number; semFrais: number} | null>(null)
  const [showRecuperarHoraModal, setShowRecuperarHoraModal] = useState(false)
  const [recuperarHoraFim, setRecuperarHoraFim] = useState(new Date())
  // Pausas CE 561/2006 — rastrear sequência 15+30
  const [pausas, setPausas] = useState<{dur: number, inicio: number}[]>([])
  const [showPausasModal, setShowPausasModal] = useState(false)
  const pausaInicioRef = useRef<number>(0)

  // Aviso progressivo condução
  const warnAnim = useRef(new Animated.Value(1)).current
  const warnAnimRef = useRef<any>(null)

  // IA correções
  const [correcaoPickerDate, setCorrecaoPickerDate] = useState(new Date())

  const [showCalendario, setShowCalendario] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showReglementation, setShowReglementation] = useState(false)
  const [diasHistorique, setDiasHistorique] = useState<any[]>([])
  const [showAddDia, setShowAddDia] = useState(false)
  const [addDiaStr, setAddDiaStr] = useState('')
  const [addDiaLabel, setAddDiaLabel] = useState('')
  const [addDebut, setAddDebut] = useState('06h00')
  const [addFin, setAddFin] = useState('14h00')
  const [addServico, setAddServico] = useState('08h00')
  const [addFrais, setAddFrais] = useState('0.00')
  const [editandoDiaId, setEditandoDiaId] = useState<string | null>(null)
  const [addType, setAddType] = useState<'TRAB'|'DEC'|'FER'|'FERIE'|'RC'|'OFF'>('TRAB')
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [timePickerField, setTimePickerField] = useState<'debut'|'fin'|'servico'>('debut')
  const [timePickerValue, setTimePickerValue] = useState(new Date())
  const [calMes, setCalMes] = useState(new Date().getMonth())
  const [calAno, setCalAno] = useState(new Date().getFullYear())
  const [kmSugerido, setKmSugerido] = useState('')
  const [showKmInicio, setShowKmInicio] = useState(false)

  const locationSub = useRef<any>(null)
  const tooltipTimer = useRef<any>(null)
  const appState = useRef(AppState.currentState)
  const tsBackground = useRef<number | null>(null)
  const ultimaVerificacao = useRef(0)
  const amplitudeAlertado = useRef(false)
  const ultimaLocalizacao = useRef<{lat: number, lon: number} | null>(null)
  const ultimoGpsSinal = useRef(Date.now())
  const ultimoGpsCallback = useRef(Date.now())
  const segPausaRef = useRef(0)
  const autoGuardarTimer = useRef<any>(null)
  const paradoTimer = useRef<any>(null)
  const emPausaRef = useRef(false)
  const pulsarBtn = useRef(new Animated.Value(1)).current
  const pulsarDot = useRef(new Animated.Value(1)).current
  const fadeIn = useRef(new Animated.Value(1)).current
  const velocidadeBuffer = useRef<number[]>([])
  const conducaoSegundos = useRef(0)
  const paradoAbaixo3Segundos = useRef(0)
  const paradoAbaixo5Segundos = useRef(0)
  const paradoAbaixo7Segundos = useRef(0)
  const tempoGpsMentiroso = useRef(0)
  const accelMovimento = useRef(false)
  const accelSub = useRef<any>(null)
  const estadoAtualRef = useRef<any>({})

  const MAX_CONDUITE = 9 * 3600
  const MAX_SERVICE = modeNuit ? 10 * 3600 : 12 * 3600
  const MAX_AMPLITUDE = modeNuit ? 13 * 3600 : 15 * 3600
  const MOIS_NOMS = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE']

  const c = {
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
  }

  const navegarMes = (dir: number) => {
    let novoMes = calMes + dir
    let novoAno = calAno
    if (novoMes > 11) { novoMes = 0; novoAno++ }
    if (novoMes < 0) { novoMes = 11; novoAno-- }
    setCalMes(novoMes)
    setCalAno(novoAno)
  }

  const calcularDistancia = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2)
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  }

  const segConducaoHoje = segConducaoDiario + segConducao

  const mediaVelocidade = (vel: number) => {
    velocidadeBuffer.current.push(vel)
    if (velocidadeBuffer.current.length > 5) velocidadeBuffer.current.shift()
    return velocidadeBuffer.current.reduce((a, b) => a + b, 0) / velocidadeBuffer.current.length
  }

  const resetarParagemGps = () => {
    paradoAbaixo3Segundos.current = 0
    paradoAbaixo5Segundos.current = 0
    paradoAbaixo7Segundos.current = 0
  }

  const pararConducaoGps = () => {
    conducaoSegundos.current = 0
    setEmConducao(false)
  }

  const atualizarConducaoGps = (vel: number, velMedia: number, dtGps: number, velGps = 0, velInferida = 0) => {
    const dt = Math.max(1, dtGps)

    paradoAbaixo3Segundos.current = vel < 3 ? paradoAbaixo3Segundos.current + dt : 0
    paradoAbaixo5Segundos.current = vel < 5 ? paradoAbaixo5Segundos.current + dt : 0
    paradoAbaixo7Segundos.current = vel < 7 ? paradoAbaixo7Segundos.current + dt : 0

    const gpsCongelado = tempoVelCongelada.current >= 4

    if (velGps > 20 && velInferida < 5) {
      tempoGpsMentiroso.current += dt
    } else {
      tempoGpsMentiroso.current = 0
    }
    const gpsMentiroso = tempoGpsMentiroso.current >= 5

    const deveParar =
      paradoAbaixo3Segundos.current >= CONDUCAO_PARAR_ABAIXO_3_S ||
      paradoAbaixo5Segundos.current >= CONDUCAO_PARAR_ABAIXO_5_S ||
      paradoAbaixo7Segundos.current >= CONDUCAO_PARAR_ABAIXO_7_S ||
      gpsCongelado ||
      gpsMentiroso

    if (deveParar) {
      pararConducaoGps()
      return
    }

    if (vel >= VELOCIDADE_MIN && velMedia >= VELOCIDADE_MIN) {
      conducaoSegundos.current += dt
      if (conducaoSegundos.current >= CONDUCAO_SEGUNDOS_ON) setEmConducao(true)
    } else if (vel < VELOCIDADE_MIN) {
      conducaoSegundos.current = 0
    }
  }

  const limparInputKm = (valor: string) => valor.replace(/[^0-9.,]/g, '')

  const parseKmInput = (valor: string) => {
    const km = parseFloat(valor.replace(',', '.').trim())
    return Number.isFinite(km) && km > 0 ? km : 0
  }

  const arredondarKm = (valor: number) => Math.round(Math.max(0, valor) * 10) / 10

  const calcularKmManual = () => {
    const kmFim = parseKmInput(kmFimInput)
    if (kmInicioTacho > 0) return arredondarKm(kmFim - kmInicioTacho)
    return arredondarKm(kmFim)
  }

  // PONTO 7 — IA correction history
  const guardarCorrecaoHistorico = async (tachomax: number, corrigido: number) => {
    try {
      const raw = await AsyncStorage.getItem('tachomax_correcoes')
      const hist = raw ? JSON.parse(raw) : []
      hist.push({ ts: Date.now(), tachomax, corrigido, diferenca: corrigido - tachomax, velocidade: velocidade })
      await AsyncStorage.setItem('tachomax_correcoes', JSON.stringify(hist.slice(-50)))
    } catch (e) {}
  }

  const getCorrecaoPrecisao = async (): Promise<string> => {
    try {
      const raw = await AsyncStorage.getItem('tachomax_correcoes')
      if (!raw) return ''
      const hist: any[] = JSON.parse(raw)
      const ultimas = hist.slice(-5)
      if (ultimas.length < 2) return ''
      const desvios = ultimas.map(c => c.tachomax > 0 ? Math.abs(c.diferenca) / c.tachomax : 0)
      const media = desvios.reduce((a, b) => a + b, 0) / desvios.length
      const precisao = Math.max(0, Math.round((1 - media) * 100))
      return `Précision actuelle : ${precisao}%`
    } catch (e) { return '' }
  }

  const guardarEstado = async (estado: any) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(estado))
    } catch (e) { console.log('Erro ao guardar estado:', e) }
  }

  const criarEstadoSnapshot = (overrides: any = {}) => {
    const snap = estadoAtualRef.current
    return {
      enService: !!snap.enService,
      emPausa: !!snap.emPausa,
      emConducao: !!snap.emConducao,
      decouche: !!snap.decouche,
      modeNuit: !!snap.modeNuit,
      segServico: snap.segServico || 0,
      segConducao: snap.segConducao || 0,
      segConducaoDiario: snap.segConducaoDiario || 0,
      segAmplitude: snap.segAmplitude || 0,
      segPausa: snap.segPausa || 0,
      segPausaTotal: snap.segPausaTotal || 0,
      kmDiarios: snap.kmDiarios || 0,
      kmInicioTacho: snap.kmInicioTacho || 0,
      pausaReglementaireOk: !!snap.pausaReglementaireOk,
      pausas: snap.pausas || [],
      horaInicio: snap.horaInicio || '',
      dateInicio: snap.dateInicio?.toISOString(),
      ultimaLocalizacao: ultimaLocalizacao.current,
      ultimoGpsCallback: ultimoGpsCallback.current,
      ...overrides,
    }
  }

  const aplicarEstadoPersistido = (estado: any, tempoBackground = 0) => {
    setEnService(true)
    setEmPausa(!!estado.emPausa)
    emPausaRef.current = !!estado.emPausa
    setEmConducao(!!estado.emConducao)
    setDecouche(!!estado.decouche)
    setModeNuit(!!estado.modeNuit)
    setHoraInicio(estado.horaInicio || '')
    setKmDiarios(estado.kmDiarios || 0)
    const kmInicioGuardado = estado.kmInicioTacho || 0
    setKmInicioTacho(kmInicioGuardado)
    setKmInicioInput(kmInicioGuardado > 0 ? String(kmInicioGuardado) : '')
    setKmFimInput('')
    setSegPausaTotal((estado.segPausaTotal || 0) + (estado.emPausa ? tempoBackground : 0))
    setSegConducaoDiario(estado.segConducaoDiario || 0)
    setPausaReglementaireOk(!!estado.pausaReglementaireOk)
    if (estado.pausas) setPausas(estado.pausas)
    if (estado.ultimaLocalizacao) ultimaLocalizacao.current = estado.ultimaLocalizacao
    if (estado.ultimoGpsCallback) ultimoGpsCallback.current = estado.ultimoGpsCallback
    if (estado.dateInicio) setDateInicio(new Date(estado.dateInicio))

    if (estado.emPausa) {
      setSegServico(estado.segServico || 0)
      setSegConducao(estado.segConducao || 0)
      setSegAmplitude(estado.segAmplitude || 0)
      setSegPausa((estado.segPausa || 0) + tempoBackground)
    } else {
      setSegServico((estado.segServico || 0) + tempoBackground)
      setSegAmplitude((estado.segAmplitude || 0) + tempoBackground)
      setSegConducao(estado.emConducao ? (estado.segConducao || 0) + tempoBackground : (estado.segConducao || 0))
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
        if (estado.emConducao) estadoAtualizado.segConducao = (estado.segConducao || 0) + tempoBackground
      }

      await guardarEstado(estadoAtualizado)
      aplicarEstadoPersistido(estadoAtualizado, 0)
      return true
    } catch (e) {
      console.log('Erro ao sincronizar estado:', e)
      return false
    }
  }

  const iniciarGPSBackground = async () => {
    try {
      let { status: bg } = await Location.getBackgroundPermissionsAsync()
      if (bg !== 'granted') {
        const req = await Location.requestBackgroundPermissionsAsync()
        bg = req.status
      }
      if (bg !== 'granted') {
        Alert.alert(
          'Localisation en arrière-plan',
          'Active "Toujours autoriser" pour que TachoOffice continue à compter conduite et kilomètres écran éteint.',
          [{ text: t.ok }]
        )
        return
      }

      const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
      if (started) return

      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'TachoOffice actif',
          notificationBody: 'Suivi conduite, pauses et kilomètres en cours',
          notificationColor: '#f5a623',
        },
      })
    } catch (e) {
      console.log('Erro ao iniciar GPS background:', e)
    }
  }

  const pararGPSBackground = async () => {
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
      if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME)
    } catch (e) {
      console.log('Erro ao parar GPS background:', e)
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
      await iniciarGPS()
      await iniciarGPSBackground()
    } catch (e) { console.log('Erro ao restaurar estado:', e) }
  }

  const carregarConfigs = async () => {
    const p = await AsyncStorage.getItem('profil')
    if (p) setProfil(p as Profil)
    // Load driver name: onboarding key takes priority, fallback to Mon Salaire
    const nomOnboarding = await AsyncStorage.getItem('conducteur_nom')
    if (nomOnboarding) {
      setNomeConducteur(nomOnboarding)
    } else {
      const dados = await AsyncStorage.getItem('monSalaire_v2')
      if (dados) {
        const hist = JSON.parse(dados)
        if (hist.length > 0 && hist[0].conducteur) {
          const primeiroNome = hist[0].conducteur.split(' ')[0]
          setNomeConducteur(primeiroNome)
        }
      }
    }
  }

  useEffect(() => {
    carregarConfigs()
    limparFraisReglesAoArrancar()
    restaurarEstado()
    carregarDiasMes()
    // Limpar quaisquer notificações pendentes de sessões anteriores ao arrancar
    cancelarTodosAlertas()
  }, [])

  useEffect(() => {
    carregarDiasMes()
  }, [calMes, calAno])

  useEffect(() => {
    if (!enService) {
      AsyncStorage.getItem('km_ultimo_fim').then(v => {
        if (v && parseFloat(v) > 0 && !kmInicioInput) setKmSugerido(v)
      })
      setShowKmInicio(false)
    } else {
      setKmSugerido('')
      setShowKmInicio(false)
    }
  }, [enService])

  useFocusEffect(
    React.useCallback(() => {
      carregarStatsSemaine()
      carregarDiasMes()
      // Reler modoTacho sempre que o separador fica ativo (pode ter mudado nas Definições)
      AsyncStorage.getItem('modoTacho').then(v => {
        setModoTacho(v === 'decrescente' ? 'decrescente' : 'crescente')
      })
      AsyncStorage.getItem('mode_test').then(v => setModeTest(v === 'true'))
    }, [])
  )

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, [])

  useEffect(() => {
    if (enService) { pulsarBtn.stopAnimation(); pulsarBtn.setValue(1); return }
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulsarBtn, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulsarBtn, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start()
  }, [enService])

  useEffect(() => {
    if (!emConducao) { pulsarDot.stopAnimation(); pulsarDot.setValue(1); return }
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulsarDot, { toValue: 1.8, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulsarDot, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start()
  }, [emConducao])

  // PONTO 5 — aviso progressivo pausa obrigatória
  const warnPhase = segConducao >= PAUSA_MAX ? 3 : segConducao >= 4 * 3600 + 15 * 60 ? 2 : segConducao >= 4 * 3600 + 10 * 60 ? 1 : 0
  useEffect(() => {
    if (warnAnimRef.current) { warnAnimRef.current.stop(); warnAnimRef.current = null }
    if (warnPhase === 0) { warnAnim.setValue(1); return }
    const dur = warnPhase === 1 ? 1200 : warnPhase === 2 ? 700 : 500
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(warnAnim, { toValue: 0.3, duration: dur, useNativeDriver: true }),
      Animated.timing(warnAnim, { toValue: 1, duration: dur, useNativeDriver: true }),
    ]))
    warnAnimRef.current = loop
    loop.start()
    return () => { loop.stop() }
  }, [warnPhase])

  useEffect(() => {
    estadoAtualRef.current = {
      enService, emPausa, emConducao, decouche, modeNuit,
      segServico, segConducao, segConducaoDiario, segAmplitude, segPausa,
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

      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        tsBackground.current = null
        const sincronizado = await sincronizarEstadoPersistido()
        if (sincronizado && !locationSub.current) { iniciarGPS() }
      }

      appState.current = nextState
    })
    return () => sub.remove()
  }, [])

  const carregarStatsSemaine = async () => {
    try {
      const data = await AsyncStorage.getItem('historique')
      if (!data) return
      const historique = JSON.parse(data)
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
    } catch (e) { console.log('Erro:', e) }
  }

  const carregarDiasMes = async () => {
    try {
      const data = await AsyncStorage.getItem('historique')
      if (data) setDiasHistorique(JSON.parse(data))
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
    const regles = sanitizeFraisRegles(reglesData ? JSON.parse(reglesData) : {})
    if (reglesData) await AsyncStorage.setItem('frais_regles', JSON.stringify(regles))
    return regles
  }
  const limparFraisReglesAoArrancar = async () => {
    try {
      const reglesData = await AsyncStorage.getItem('frais_regles')
      const regles = sanitizeFraisRegles(reglesData ? JSON.parse(reglesData) : {})
      await AsyncStorage.setItem('frais_regles', JSON.stringify(regles))
    } catch (e) {}
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
      const fvData = await AsyncStorage.getItem('frais_valores')
      if (fvData) fv = { ...fv, ...JSON.parse(fvData) }
      regles = await carregarFraisRegles()
      const existente = await AsyncStorage.getItem('historique')
      const lista = existente ? JSON.parse(existente) : []
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
      let lista = existente ? JSON.parse(existente) : []
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
    } catch (e) { console.log('Erro:', e) }
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
    const timer = setInterval(() => setSegServico(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [enService, emPausa])

  useEffect(() => {
    if (!enService || emPausa || !emConducao) return
    const timer = setInterval(() => {
      setSegConducao(s => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [enService, emPausa, emConducao])

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

  useEffect(() => {
    if (!enService || emPausa || emConducao) {
      setParadoSegundos(0)
      setShowPausaBandeau(false)
      return
    }
    const timer = setInterval(() => {
      setParadoSegundos(s => {
        const novo = s + 1
        if (novo >= 20 * 60 && !showPausaBandeau) setShowPausaBandeau(true)
        return novo
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [enService, emPausa, emConducao])

  useEffect(() => {
    if (!enService) {
      if (accelSub.current) { accelSub.current.remove(); accelSub.current = null }
      return
    }
    Accelerometer.setUpdateInterval(500)
    accelSub.current = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z)
      accelMovimento.current = magnitude > 1.05
    })
    return () => {
      if (accelSub.current) { accelSub.current.remove(); accelSub.current = null }
    }
  }, [enService])

  useEffect(() => {
    if (!enService) return
    const timer = setInterval(() => {
      const agora = Date.now()
      const semSinal = agora - ultimoGpsSinal.current > 5 * 60 * 1000
      setGpsOk(!semSinal)
    }, 30000)
    return () => clearInterval(timer)
  }, [enService])


  const iniciarGPS = async () => {
    if (locationSub.current) return
    let { status: fg } = await Location.getForegroundPermissionsAsync()
    if (fg !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync()
      fg = req.status
    }
    if (fg !== 'granted') {
      Alert.alert(t.localisationNecessaire, t.localisationMsg, [{ text: t.ok }])
      return
    }

    locationSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
      (loc) => {
        const agoraGps = loc.timestamp || Date.now()
        const gapGpsS = Math.max(0, (agoraGps - ultimoGpsCallback.current) / 1000)
        const lat = loc.coords.latitude
        const lon = loc.coords.longitude
        let dist = 0

        if (ultimaLocalizacao.current && !emPausaRef.current) {
          dist = calcularDistancia(
            ultimaLocalizacao.current.lat, ultimaLocalizacao.current.lon, lat, lon
          )
        }

        const velGps = Math.max(0, (loc.coords.speed || 0) * 3.6)
        const saltoMax = gapGpsS > GPS_MOVIMENTO_GAP_S ? GPS_MOVIMENTO_GAP_MAX_KM : GPS_MOVIMENTO_SALTO_MAX_KM
        const velInferida = gapGpsS > 0 && dist > 0.001 && dist <= saltoMax ? (dist / gapGpsS) * 3600 : 0
        const vel = Math.max(velGps, velInferida)
        setVelocidade(Math.round(vel))
        const velMedia = mediaVelocidade(vel)
        const dtGps = Math.max(1, Math.min(300, Math.floor(gapGpsS)))

        if (!emPausaRef.current) {
          atualizarConducaoGps(vel, velMedia, dtGps, velGps, velInferida)
        } else {
          pararConducaoGps()
          resetarParagemGps()
        }

        ultimaLocalizacao.current = { lat, lon }
        ultimoGpsCallback.current = agoraGps
        ultimoGpsSinal.current = agoraGps
        setGpsOk(true)
      }
    )
  }

const pararGPS = async () => {
    if (locationSub.current) { locationSub.current.remove(); locationSub.current = null }
      await pararGPSBackground()
      setEmConducao(false); setVelocidade(0)
  }
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

  const showTooltip = (type: 'conduite' | 'service' | 'amplitude') => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    setTooltip(type)
    tooltipTimer.current = setTimeout(() => setTooltip(null), 3000)
  }

  const getTooltipText = (type: 'conduite' | 'service' | 'amplitude') => {
    switch (type) {
      case 'conduite': {
        const resteCiclo = Math.max(PAUSA_MAX - segConducao, 0)
        const resteJour = Math.max(MAX_CONDUITE - segConducaoHoje, 0)
        return `🚛 ${t.conduite} · Cycle 4h30\nIl te reste ${fmtHM(resteCiclo)}\nMáx 9h/jour · reste ${fmtHM(resteJour)}`
      }
      case 'service':
        return `📊 ${t.service} · Máx ${modeNuit ? '10h' : '12h'}/jour\nIl te reste ${fmtHM(Math.max(MAX_SERVICE - segServico, 0))}`
      case 'amplitude':
        return `📏 ${t.amplitude} · Máx ${modeNuit ? '13h' : '15h'}/jour\nIl te reste ${fmtHM(Math.max(MAX_AMPLITUDE - segAmplitude, 0))}`
    }
  }

  const abrirPickerCorrecao = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: correcaoPickerDate,
        mode: 'time',
        is24Hour: true,
        display: 'default',
        onChange: (event, date) => {
          if (event.type === 'set' && date) setCorrecaoPickerDate(date)
        },
      })
    }
  }

  const countdown = Math.max(PAUSA_MAX - segConducao, 0)
  const timerPrincipal = modoTacho === 'decrescente' ? countdown : segConducao
  const pctConducao = Math.min((segConducao / PAUSA_MAX) * 100, 100)
  const barColor = pctConducao > 90 ? '#e74c3c' : pctConducao > 70 ? '#f39c12' : '#27ae60'
  const maxSemaine = profil === 'CD' ? 52 * 3600 : 56 * 3600
  const pctSemaine = Math.min((statsSemaine.heures / maxSemaine) * 100, 100)
  const semaineColor = pctSemaine > 90 ? '#e74c3c' : pctSemaine > 75 ? '#f39c12' : '#27ae60'
  const pctServico = Math.min((segServico / MAX_SERVICE) * 100, 100)
  const servicoBarColor = pctServico > 90 ? '#e74c3c' : pctServico > 70 ? '#f39c12' : '#27ae60'

  const handleDemarrer = async () => {
    // 1. Pré-limpar TUDO (incluindo notificações de builds anteriores) + permissões
    await cancelarTodosAlertas()
    const notifOk = await pedirPermissaoNotificacoes()
    // Reagendar rappel de saisie que cancelAll apagou
    const rappelAtivo = await AsyncStorage.getItem('rappel_saisie_ativo')
    if (rappelAtivo !== 'false' && notifOk) await agendarRappelSaisie(20, 0)

    // 2. Calcular hora, modo noturno e km inicial opcional
    const kmInicial = parseKmInput(kmInicioInput)
    const agora = new Date()
    const h = String(agora.getHours()).padStart(2, '0')
    const m = String(agora.getMinutes()).padStart(2, '0')
    const horaNum = agora.getHours()
    const isNuit = horaNum >= 22 || horaNum < 5

    // 3. Atualizar todo o estado de uma vez (React 18 auto-batching)
    setModeNuit(isNuit)
    setKmInicioTacho(kmInicial)
    setKmFimInput('')
    setHoraInicio(`${h}h${m}`)
    setDateInicio(agora)
    setEnService(true)
    ultimaVerificacao.current = 0
    amplitudeAlertado.current = false
    setSegServico(0); setSegConducao(0); setSegConducaoDiario(0); setSegAmplitude(0); setSegPausa(0)
    setSegPausaTotal(0); setKmDiarios(0)
    setPausas([]); setPausaReglementaireOk(false)
    ultimaLocalizacao.current = null
    ultimoGpsCallback.current = Date.now()

    // 4. Persistir estado e iniciar GPS
    await guardarEstado({
      enService: true, emPausa: false, emConducao: false, decouche, modeNuit: isNuit,
      segServico: 0, segConducao: 0, segConducaoDiario: 0, segAmplitude: 0, segPausa: 0,
      segPausaTotal: 0, kmDiarios: 0, kmInicioTacho: kmInicial, pausaReglementaireOk: false, pausas: [],
      ultimaLocalizacao: null, ultimoGpsCallback: Date.now(),
      lastBgTick: Date.now(),
      horaInicio: `${h}h${m}`, dateInicio: agora.toISOString(),
      tsBackground: null,
    })
    await iniciarGPS()
    await iniciarGPSBackground()

    // 5. Agendar notificações
    if (notifOk) {
      const maxAmplitude = isNuit ? 13 * 3600 : 15 * 3600
      await agendarAlertaPausa(PAUSA_MAX)
      await agendarAlertaAmplitude(maxAmplitude)
    }
    if (isNuit) Alert.alert(t.modeNuitActive, t.modeNuitMsg)
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

  const pausaTotalLista = (lista: {dur: number, inicio: number}[]): number =>
    lista.reduce((a, p) => a + p.dur, 0)

  const handleStopConduiteTest = () => {
    setEmConducao(false)
    conducaoSegundos.current = 0
    resetarParagemGps()
    ultimaVerificacao.current = segConducao
    setShowCorrecao(true)
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
      const novoSegConducaoDiario = deveResetar ? segConducaoDiario + segConducao : segConducaoDiario
      const novoSegConducao = deveResetar ? 0 : segConducao

      if (deveResetar) {
        setPausaReglementaireOk(true)
        setPausas([])
      } else {
        setPausas(novaListaPausas)
      }

      setSegConducaoDiario(novoSegConducaoDiario)
      setSegConducao(novoSegConducao)
      segPausaRef.current = 0
      setSegPausa(0)
      setEmPausa(false)
      emPausaRef.current = false
      setShowPausaBandeau(false)
      setParadoSegundos(0)
      await guardarEstado({
        enService, emPausa: false, emConducao: false, decouche, modeNuit,
        segServico, segConducao: novoSegConducao, segConducaoDiario: novoSegConducaoDiario,
        segAmplitude, segPausa: 0, segPausaTotal, kmDiarios, kmInicioTacho,
        pausaReglementaireOk: deveResetar || pausaReglementaireOk, pausas: deveResetar ? [] : novaListaPausas,
        ultimaLocalizacao: ultimaLocalizacao.current, ultimoGpsCallback: ultimoGpsCallback.current,
        lastBgTick: Date.now(),
        horaInicio, dateInicio: dateInicio?.toISOString(), tsBackground: null,
      })
      // Reagendar alerta de pausa com tempo restante após retomar
      const tempoRestante = Math.max(PAUSA_MAX - novoSegConducao, 0)
      if (tempoRestante > 0) await agendarAlertaPausa(tempoRestante)
    } else {
      // Entrar em pausa — registar inicio
      pausaInicioRef.current = Date.now()
      segPausaRef.current = 0
      setEmConducao(false)
      setEmPausa(true)
      emPausaRef.current = true
      setShowPausaBandeau(false)
      setParadoSegundos(0)
      setSegPausa(0)
      await guardarEstado({
        enService, emPausa: true, emConducao: false, decouche, modeNuit,
        segServico, segConducao, segConducaoDiario, segAmplitude, segPausa: 0,
        segPausaTotal, kmDiarios, kmInicioTacho, pausaReglementaireOk, pausas,
        ultimaLocalizacao: ultimaLocalizacao.current, ultimoGpsCallback: ultimoGpsCallback.current,
        lastBgTick: Date.now(),
        horaInicio, dateInicio: dateInicio?.toISOString(), tsBackground: null,
      })
      await cancelarTodosAlertas()
      // Verificação tacógrafo: ao entrar em pausa, se houve pelo menos 1h de condução
      // desde a última verificação, perguntar ao condutor
      if (segConducao >= 3600 && segConducao !== ultimaVerificacao.current) {
        ultimaVerificacao.current = segConducao
        setTimeout(() => setShowCorrecao(true), 800)
      }
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
      const fvData = await AsyncStorage.getItem('frais_valores')
      if (fvData) fv = { ...fv, ...JSON.parse(fvData) }
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
    const novoDia = {
      id: Date.now().toString(), date, jour,
      type: decouche ? 'DEC' : 'TRAB',
      debut: horaInicio, fin: fimStr,
      segServico, segPausa: segPausaTotal, decouche, frais, modeNuit, kmDiarios: kmManual,
    }
    try {
      lista.unshift(novoDia)
      await AsyncStorage.setItem('historique', JSON.stringify(lista.slice(0, 365)))
    } catch (e) { console.log('Erro:', e) }
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
    setShowTerminerModal(false)

    // Capture values before reset for summary modal
    const snapService = segServico
    const snapConduite = segConducaoHoje
    const snapKm = calcularKmManual()

    // Compute frais inline for summary
    const fim = new Date()
    const fimStr = `${String(fim.getHours()).padStart(2, '0')}h${String(fim.getMinutes()).padStart(2, '0')}`
    let fv = { ptDej: 4.42, dej: 16.36, diner: 23.94, nuit: 23.94 }
    let regles2 = DEFAULT_FRAIS_REGLES
    let prevDecResumo = false
    try {
      const fvData = await AsyncStorage.getItem('frais_valores')
      if (fvData) fv = { ...fv, ...JSON.parse(fvData) }
      regles2 = await carregarFraisRegles()
      const existente = await AsyncStorage.getItem('historique')
      prevDecResumo = dateInicio ? diaAnteriorDecouche(existente ? JSON.parse(existente) : [], dateInicio) : false
    } catch (e) {}
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
    await pararGPS()
    await cancelarTodosAlertas()
    await cancelarRappelSaisie()
    await AsyncStorage.removeItem(STORAGE_KEY)
    setEnService(false); setEmPausa(false); setEmConducao(false); setModeNuit(false)
    setSegServico(0); setSegConducao(0); setSegConducaoDiario(0); setSegAmplitude(0); setSegPausa(0)
    setSegPausaTotal(0); setKmDiarios(0); setKmInicioTacho(0); setKmInicioInput(''); setKmFimInput(''); setDecouche(false); setDateInicio(null)
    setPausas([]); setPausaReglementaireOk(false)
    ultimaVerificacao.current = 0
    amplitudeAlertado.current = false
    setShowPausaBandeau(false); setParadoSegundos(0)
    await carregarStatsSemaine()

    // Show rich summary instead of simple Alert
    setSummaryData({
      service: snapService,
      conduite: snapConduite,
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

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: c.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
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
          <Text style={[st.appName, { color: c.text }]}>TACHO<Text style={st.accent}>OFFICE</Text></Text>
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

            {/* ── DÉMARRER BUTTON ── */}
            <View style={{ alignItems: 'center', marginVertical: 16 }}>
              <Animated.View style={{ transform: [{ scale: pulsarBtn }] }}>
                <TouchableOpacity style={st.btnCircular} onPress={handleDemarrer}>
                  <Text style={st.btnCircularIcon}>▶</Text>
                  <Text style={st.btnCircularLabel}>{t.demarrer}</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>

            {/* ── KM DÉBUT ── */}
            <View style={{ alignItems: 'center', marginTop: -8, marginBottom: 8 }}>
              {kmSugerido && !kmInicioInput ? (
                <View style={{ backgroundColor: c.card, borderColor: '#f5a623', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: '#f5a623', fontWeight: '700', fontSize: 13 }}>{t.kmDebutLabel}</Text>
                  <Text style={{ color: '#f5a623', fontWeight: '800', fontSize: 15 }}>{kmSugerido}</Text>
                  <TouchableOpacity
                    onPress={() => { setKmInicioInput(kmSugerido); setKmSugerido('') }}
                    style={{ backgroundColor: '#f5a623', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✅</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setKmInicioInput(kmSugerido); setKmSugerido(''); setShowKmInicio(true) }}
                    style={{ backgroundColor: c.progressBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}
                  >
                    <Text style={{ color: c.textSub, fontWeight: '700', fontSize: 12 }}>✏️</Text>
                  </TouchableOpacity>
                </View>
              ) : showKmInicio ? (
                <View style={{ backgroundColor: c.card, borderColor: c.cardBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, width: 260 }}>
                  <TextInput
                    value={kmInicioInput}
                    onChangeText={v => setKmInicioInput(limparInputKm(v))}
                    placeholder={t.kmDebut}
                    placeholderTextColor={c.textSub}
                    keyboardType="numeric"
                    style={{ color: c.text, fontSize: 16, fontWeight: '600', textAlign: 'center' }}
                    autoFocus
                    onBlur={() => { if (!kmInicioInput) setShowKmInicio(false) }}
                  />
                  <Text style={{ color: c.textSub, fontSize: 11, marginTop: 6, textAlign: 'center' }}>{t.appuieAilleurs}</Text>
                </View>
              ) : kmInicioInput ? (
                <TouchableOpacity onPress={() => setShowKmInicio(true)} style={{ paddingVertical: 6, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: '#f5a623', fontSize: 13, fontWeight: '700' }}>📍 {t.kmDebutLabel} {kmInicioInput}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => setShowKmInicio(true)} style={{ paddingVertical: 8, paddingHorizontal: 16 }}>
                  <Text style={{ color: c.textSub, fontSize: 12, opacity: 0.5 }}>+ {t.kmDebut}</Text>
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
                          return dataStr === diaStr && (parts.length < 3 || parseInt(parts[2]) === calAno)
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
                                const hh = Math.floor((registo.segServico || 0) / 3600)
                                const mm = Math.floor(((registo.segServico || 0) % 3600) / 60)
                                setAddDiaStr(diaStr)
                                setAddDiaLabel(label)
                                setAddDebut(registo.debut || '06h00')
                                setAddFin(registo.fin || '14h00')
                                setAddServico(`${String(hh).padStart(2,'0')}h${String(mm).padStart(2,'0')}`)
                                setAddType(registo.type as any || 'TRAB')
                                setAddFrais((registo.frais || 0).toFixed(2))
                                setEditandoDiaId(registo.id)
                                setShowAddDia(true)
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
                  {/* Legend */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, justifyContent: 'center' }}>
                    {[
                      { color: '#27ae60', label: 'TRAV.' },
                      { color: '#2980b9', label: 'DÉC.' },
                      { color: '#6b7394', label: 'REPOS' },
                      { color: '#9b59b6', label: 'CONGÉ' },
                      { color: '#1abc9c', label: 'R.C.' },
                      { color: '#f39c12', label: 'FÉRIÉ' },
                    ].map(item => (
                      <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: item.color }} />
                        <Text style={{ fontSize: 9, color: c.textSub, fontWeight: '700' }}>{item.label}</Text>
                      </View>
                    ))}
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

          </Animated.View>
        ) : (
          <>
            {/* ── HEADER STATUS ROW ── */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingHorizontal: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Animated.View style={[st.conducaoDot, { backgroundColor: emConducao ? '#27ae60' : emPausa ? '#f39c12' : '#8890aa', transform: [{ scale: emConducao ? pulsarDot : 1 }] }]} />
                <Text style={{ fontSize: 13, fontWeight: '800', color: emConducao ? '#27ae60' : emPausa ? '#f39c12' : '#8890aa', letterSpacing: 0.8 }}>
                  {emPausa ? t.enPause.toUpperCase() : emConducao ? t.enConduite.toUpperCase() : t.enService.toUpperCase()}
                </Text>
                {emConducao && velocidade > 0 && (
                  <View style={{ backgroundColor: 'rgba(39,174,96,0.15)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 11, color: '#27ae60', fontWeight: '700' }}>{velocidade} km/h</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 12, color: c.textSub, fontWeight: '600' }}>{t.debutA} {horaInicio}</Text>
                <Text style={{ fontSize: 15 }}>{modeNuit ? '🌙' : '☀️'}</Text>
              </View>
            </View>
            {!gpsOk && (
              <View style={[st.nuitBandeau, { backgroundColor: 'rgba(231,76,60,0.15)', borderColor: '#e74c3c', marginBottom: 6 }]}>
                <Text style={[st.nuitBandeauText, { color: '#e74c3c' }]}>{t.gpsAlert}</Text>
              </View>
            )}
            {modeNuit && (
              <View style={[st.nuitBandeau, { marginBottom: 6 }]}>
                <Text style={st.nuitBandeauText}>{t.modeNuitBandeau}</Text>
              </View>
            )}

            {showPausaBandeau && !emPausa && (
              <View style={[st.pausaBandeau, { backgroundColor: c.card, borderColor: '#f39c12' }]}>
                <Text style={[st.pausaBandeauText, { color: c.text }]}>⏸ {t.paradoMsg}</Text>
                <View style={st.pausaBandeauBtns}>
                  <TouchableOpacity style={st.pausaBandeauBtnSim} onPress={() => { handlePause(); setShowPausaBandeau(false) }}>
                    <Text style={{ color: 'white', fontWeight: '800', fontSize: 12 }}>{t.paradoSim}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={st.pausaBandeauBtnNao} onPress={() => { setShowPausaBandeau(false); setParadoSegundos(0) }}>
                    <Text style={{ color: '#f39c12', fontWeight: '800', fontSize: 12 }}>{t.paradoNao}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── PONTO 5 — AVISO PROGRESSIVO CONDUÇÃO ── */}
            {warnPhase >= 1 && emConducao && !emPausa && (
              <Animated.View style={{ opacity: warnAnim, marginBottom: 6, backgroundColor: warnPhase === 3 ? 'rgba(231,76,60,0.18)' : warnPhase === 2 ? 'rgba(231,76,60,0.13)' : 'rgba(243,156,18,0.13)', borderRadius: 10, borderWidth: 1.5, borderColor: warnPhase >= 2 ? '#e74c3c' : '#f39c12', padding: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: warnPhase >= 2 ? '#e74c3c' : '#f39c12', textAlign: 'center' }}>
                  {warnPhase === 3
                    ? '🛑 PAUSE OBLIGATOIRE MAINTENANT !'
                    : warnPhase === 2
                      ? `⚠️ ${fmtHM(segConducao)} de conduite — pause imminente !`
                      : `⚠️ 4h10 de conduite — pause dans 20 min`
                  }
                </Text>
              </Animated.View>
            )}

            {/* ── TIMER CARD ── */}
            <View style={[st.timerCard, { backgroundColor: c.timerBg, borderColor: c.cardBorder, overflow: 'hidden' }]}>
              {/* Top accent bar — green service / orange pause / bright green driving */}
              <View style={{ height: 4, backgroundColor: emPausa ? '#f39c12' : emConducao ? '#27ae60' : '#2980b9', borderRadius: 4, marginBottom: 14 }} />

              {!emPausa ? (
                <>
                  {/* Big timer — crescente (tempo de condução) */}
                  <View style={{ alignItems: 'center', marginBottom: 10 }}>
                    <Text style={[st.timerBig, { color: emConducao ? barColor : c.text, fontSize: 52, letterSpacing: 2 }]}>{fmt(timerPrincipal)}</Text>
                    <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '600', marginTop: 2, letterSpacing: 0.5 }}>
                      {emConducao
                        ? (modoTacho === 'decrescente' ? t.avantPauseOblig : t.tempsDConduite)
                        : t.enAttente}
                    </Text>
                  </View>

                  {/* Conduite progress bar (only when driving) */}
                  {emConducao && (
                    <View style={{ marginBottom: 10 }}>
                      <View style={[st.pauseBarBg, { backgroundColor: c.servicoBox, marginBottom: 0 }]}>
                        <View style={[st.pauseBarFill, { width: `${pctConducao}%` as any, backgroundColor: barColor }]} />
                      </View>
                    </View>
                  )}

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

                  {/* Pause alerts */}
                  {countdown === 0 && emConducao && (
                    <View style={{ backgroundColor: 'rgba(231,76,60,0.12)', borderRadius: 8, padding: 8, marginTop: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#e74c3c', textAlign: 'center' }}>⚠️ {t.pauseObligatoire}</Text>
                    </View>
                  )}
                  {countdown > 0 && countdown <= 30 * 60 && emConducao && (
                    <View style={{ backgroundColor: 'rgba(243,156,18,0.12)', borderRadius: 8, padding: 8, marginTop: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#f39c12', textAlign: 'center' }}>⚠️ {t.pauseDans} {fmtHM(countdown)}</Text>
                    </View>
                  )}
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
                      <Text style={{ fontSize: 18, fontWeight: '800', color: c.conducaoGelada }}>{fmt(segConducao)}</Text>
                      <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', marginTop: 2 }}>🚛 CONDUITE</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: c.servicoBox, borderRadius: 10, padding: 10, alignItems: 'center' }}>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: c.conducaoGelada }}>{fmt(segServico)}</Text>
                      <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', marginTop: 2 }}>⏱ SERVICE</Text>
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

            {tooltip && (
              <View style={[st.tooltipBox, { backgroundColor: c.tooltipBg, borderColor: c.cardBorder }]}>
                <Text style={[st.tooltipText, { color: c.text }]}>{getTooltipText(tooltip)}</Text>
              </View>
            )}

            {/* ── METRIC BOXES ── */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <TouchableOpacity onPress={() => showTooltip('conduite')}
                style={{ flex: 1, backgroundColor: 'rgba(39,174,96,0.10)', borderRadius: 12, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(39,174,96,0.25)' }}>
                <Text style={{ fontSize: 9, fontWeight: '800', color: '#27ae60', letterSpacing: 1, marginBottom: 4 }}>🚛 CONDUITE</Text>
                <Text style={{ fontSize: 17, fontWeight: '900', color: emConducao ? '#27ae60' : c.text }}>{fmtHM(segConducao)}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => showTooltip('service')}
                style={{ flex: 1, backgroundColor: 'rgba(243,156,18,0.10)', borderRadius: 12, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(243,156,18,0.25)' }}>
                <Text style={{ fontSize: 9, fontWeight: '800', color: '#f39c12', letterSpacing: 1, marginBottom: 4 }}>⏱ SERVICE</Text>
                <Text style={{ fontSize: 17, fontWeight: '900', color: c.text }}>{fmtHM(segServico)}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => showTooltip('amplitude')}
                style={{ flex: 1, backgroundColor: 'rgba(41,128,185,0.10)', borderRadius: 12, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(41,128,185,0.25)' }}>
                <Text style={{ fontSize: 9, fontWeight: '800', color: '#2980b9', letterSpacing: 1, marginBottom: 4 }}>📏 AMPLITUDE</Text>
                <Text style={{ fontSize: 17, fontWeight: '900', color: '#2980b9' }}>{fmtHM(segAmplitude)}</Text>
              </TouchableOpacity>
            </View>

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

            {enService && modeTest && !emPausa && (
              <TouchableOpacity
                onPress={handleStopConduiteTest}
                style={{
                  marginBottom: 12, borderRadius: 14, paddingVertical: 12, alignItems: 'center',
                  backgroundColor: 'rgba(155,89,182,0.12)', borderWidth: 1.5, borderColor: '#9b59b6',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#9b59b6', letterSpacing: 0.5 }}>
                  🧪 STOP CONDUITE (TEST)
                </Text>
              </TouchableOpacity>
            )}

            {/* ── LIMITES LÉGALES ── */}
            <View style={[st.limites, { backgroundColor: c.card, borderColor: c.cardBorder, borderWidth: 1, borderRadius: 16, padding: 14 }]}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: c.textLabel, letterSpacing: 1.5, marginBottom: 12 }}>
                {t.limitesLegales} {modeNuit ? '🌙' : '☀️'}
              </Text>
              {[
                { label: t.conduiteAujourdhui,  seg: segConducaoHoje,     max: MAX_CONDUITE, maxLabel: '9h00',                             baseColor: '#27ae60' },
                { label: t.serviceJournalier,   seg: segServico,         max: MAX_SERVICE,  maxLabel: modeNuit ? '10h00' : '12h00',        baseColor: '#f39c12' },
                { label: t.amplitudeJournaliere, seg: segAmplitude,      max: MAX_AMPLITUDE, maxLabel: modeNuit ? '13h00' : '15h00',       baseColor: '#2980b9' },
                { label: 'Semaine en cours',    seg: statsSemaine.heures, max: maxSemaine,  maxLabel: profil === 'CD' ? '52h00' : '56h00', baseColor: '#9b59b6' },
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
                <Text style={{ fontSize: 22 }}>🚛</Text>
                <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }}>{fmtHM(segConducao)}</Text>
                <Text style={{ fontSize: 13, color: c.textSub, fontWeight: '600', letterSpacing: 1 }}>CONDUITE</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, padding: 14, alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 22 }}>⏱</Text>
                <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }}>{fmtHM(segServico)}</Text>
                <Text style={{ fontSize: 13, color: c.textSub, fontWeight: '600', letterSpacing: 1 }}>SERVICE</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, padding: 14, alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 22 }}>📍</Text>
                <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }}>{calcularKmManual()}</Text>
                <Text style={{ fontSize: 13, color: c.textSub, fontWeight: '600', letterSpacing: 1 }}>KM</Text>
              </View>
            </View>
            <View style={{ backgroundColor: c.bg, borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: c.cardBorder }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: c.textLabel, letterSpacing: 1, marginBottom: 8 }}>KM fim (tacógrafo)</Text>
              <TextInput
                value={kmFimInput}
                onChangeText={v => setKmFimInput(limparInputKm(v))}
                placeholder="0"
                placeholderTextColor={c.textSub}
                keyboardType="numeric"
                style={{ backgroundColor: c.card, borderRadius: 12, padding: 14, color: c.text, fontSize: 20, fontWeight: '900', borderWidth: 1, borderColor: c.cardBorder }}
              />
              <Text style={{ fontSize: 12, color: c.textSub, marginTop: 8 }}>
                KM calculados : <Text style={{ fontWeight: '900', color: '#2980b9' }}>{calcularKmManual()} km</Text>
                {kmInicioTacho > 0 ? <Text> · início {kmInicioTacho} km</Text> : <Text> · início não preenchido</Text>}
              </Text>
            </View>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: decouche ? 'rgba(41,128,185,0.12)' : c.bg, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: decouche ? '#2980b9' : c.cardBorder }} onPress={() => setDecouche(d => !d)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>🌙</Text>
                <View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: decouche ? '#2980b9' : c.text }}>{t.decoucheCeSoir}</Text>
                  <Text style={{ fontSize: 13, color: c.textSub }}>{t.fraisNuitAuto}</Text>
                </View>
              </View>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: decouche ? '#2980b9' : c.cardBorder, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14 }}>{decouche ? '✓' : ''}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={{ backgroundColor: '#e74c3c', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 10 }} onPress={() => confirmarTerminer(decouche)}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: 'white' }}>{decouche ? '🌙 Terminer (Découché)' : '⏹ Terminer le service'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowTerminerModal(false)}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textSub }}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showCorrecao} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#f5a623', width: '100%' }}>
            <Text style={{ fontSize: 22, textAlign: 'center', marginBottom: 6 }}>🖨️</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 8, textAlign: 'center' }}>{t.controleTacho}</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 16, lineHeight: 20 }}>La conduite enregistrée dans TachoOffice correspond-elle à ton tacographe ?</Text>
            <View style={{ backgroundColor: c.bg, borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 12, color: c.textSub, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>{t.conduiteEnregistreeLabel}</Text>
              <Text style={{ color: '#27ae60', fontWeight: '800', fontSize: 32 }}>{fmtHM(segConducao)}</Text>
            </View>
            <TouchableOpacity style={{ backgroundColor: '#27ae60', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 }} onPress={() => setShowCorrecao(false)}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>{t.ouiCestCorrect}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ backgroundColor: c.card, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e74c3c' }} onPress={() => {
              const h = Math.floor(segConducao / 3600)
              const m = Math.floor((segConducao % 3600) / 60)
              const d = new Date(); d.setHours(h, m, 0, 0)
              setCorrecaoPickerDate(d)
              setShowCorrecao(false)
              setTimeout(() => setShowInputCorrecao(true), 300)
            }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#e74c3c' }}>{t.nonCorriger}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showInputCorrecao} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#e74c3c', width: '100%' }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 6, textAlign: 'center' }}>✏️ Corriger la conduite</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 12, lineHeight: 20 }}>{t.indiqueTpsReel}</Text>

            <View style={{ backgroundColor: c.bg, borderRadius: 14, borderWidth: 2, borderColor: '#e74c3c', marginBottom: 16, alignItems: 'center', overflow: 'hidden' }}>
              {Platform.OS === 'android' ? (
                <TouchableOpacity onPress={abrirPickerCorrecao} style={{ width: '100%', paddingVertical: 18, alignItems: 'center' }}>
                  <Text style={{ fontSize: 34, fontWeight: '900', color: c.text }}>
                    {String(correcaoPickerDate.getHours()).padStart(2, '0')}h{String(correcaoPickerDate.getMinutes()).padStart(2, '0')}
                  </Text>
                  <Text style={{ fontSize: 12, color: c.textSub, marginTop: 4 }}>{t.toucherPourModifier}</Text>
                </TouchableOpacity>
              ) : (
                <DateTimePicker
                  value={correcaoPickerDate}
                  mode="time"
                  display="default"
                  is24Hour={true}
                  onChange={(_, date) => { if (date) setCorrecaoPickerDate(date) }}
                  textColor={c.text}
                />
              )}
            </View>

            <TouchableOpacity style={{ backgroundColor: '#e74c3c', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 }} onPress={async () => {
              const h = correcaoPickerDate.getHours()
              const m = correcaoPickerDate.getMinutes()
              const novoVal = h * 3600 + m * 60
              await guardarCorrecaoHistorico(segConducao, novoVal)
              setSegConducao(novoVal)
              setShowInputCorrecao(false)
            }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>{t.confirmerCorrection}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={() => setShowInputCorrecao(false)}>
              <Text style={{ fontSize: 14, color: c.textSub }}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
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
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, overflow: 'hidden' }}>
                <View style={{ height: 4, backgroundColor: '#27ae60' }} />
                <View style={{ padding: 14, alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>CONDUITE</Text>
                  <Text style={{ fontSize: 28, fontWeight: '800', color: '#27ae60', letterSpacing: -1 }}>{summaryData ? fmtHM(summaryData.conduite) : '—'}</Text>
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