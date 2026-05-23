import { useFocusEffect } from 'expo-router'
import { Accelerometer } from 'expo-sensors'
import React, { useEffect, useState, useRef } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Switch, Alert, StyleSheet, Modal, AppState, TextInput, KeyboardAvoidingView, Platform, Animated, Easing } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { useTheme } from '../../context/ThemeContext'
import { useLangue } from '../../context/LangueContext'
import DateTimePicker from '@react-native-community/datetimepicker'
import {
  pedirPermissaoNotificacoes,
  agendarAlertaPausa,
  agendarAlertaAmplitude,
  cancelarTodosAlertas,
} from '../../src/notifications'
type Profil = 'CD' | 'MIXTE' | 'LD'
const PAUSA_MAX = 4.5 * 3600
const VELOCIDADE_MIN = 5
const STORAGE_KEY = 'TACHOMAX_estado'

export default function AujourdhuiScreen() {
  const { themeSombre } = useTheme()
  const { t } = useLangue()
  const [enService, setEnService] = useState(false)
  const [emPausa, setEmPausa] = useState(false)
  const [decouche, setDecouche] = useState(false)
  const [emConducao, setEmConducao] = useState(false)
  const [segServico, setSegServico] = useState(0)
  const [segConducao, setSegConducao] = useState(0)
  const [segAmplitude, setSegAmplitude] = useState(0)
  const [segPausa, setSegPausa] = useState(0)
  const [segPausaTotal, setSegPausaTotal] = useState(0)
  const [kmDiarios, setKmDiarios] = useState(0)
  const [modoTacho, setModoTacho] = useState<'crescente' | 'decrescente'>('decrescente')
  const [horaInicio, setHoraInicio] = useState('')
  const [dateInicio, setDateInicio] = useState<Date | null>(null)
  const [profil, setProfil] = useState<Profil>('MIXTE')
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
  const [showCalendario, setShowCalendario] = useState(false)
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

  const locationSub = useRef<any>(null)
  const tooltipTimer = useRef<any>(null)
  const appState = useRef(AppState.currentState)
  const tsBackground = useRef<number | null>(null)
  const ultimaVerificacao = useRef(0)
  const amplitudeAlertado = useRef(false)
  const ultimaLocalizacao = useRef<{lat: number, lon: number} | null>(null)
  const ultimoGpsSinal = useRef(Date.now())
  const autoGuardarTimer = useRef<any>(null)
  const paradoTimer = useRef<any>(null)
  const emPausaRef = useRef(false)
  const pulsarBtn = useRef(new Animated.Value(1)).current
  const pulsarDot = useRef(new Animated.Value(1)).current
  const fadeIn = useRef(new Animated.Value(1)).current
  const velocidadeBuffer = useRef<number[]>([])
  const conducaoSegundos = useRef(0)
  const paradoSegundosGps = useRef(0)
  const accelMovimento = useRef(false)
  const accelSub = useRef<any>(null)

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

  const mediaVelocidade = (vel: number) => {
    velocidadeBuffer.current.push(vel)
    if (velocidadeBuffer.current.length > 5) velocidadeBuffer.current.shift()
    return velocidadeBuffer.current.reduce((a, b) => a + b, 0) / velocidadeBuffer.current.length
  }

  const guardarEstado = async (estado: any) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(estado))
    } catch (e) { console.log('Erro ao guardar estado:', e) }
  }

  const restaurarEstado = async () => {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY)
      if (!data) return
      const estado = JSON.parse(data)
      if (!estado.enService) return
      const agora = Date.now()
      const tempoBackground = estado.tsBackground ? Math.floor((agora - estado.tsBackground) / 1000) : 0
      setEnService(true)
      setEmPausa(estado.emPausa)
      setDecouche(estado.decouche)
      setModeNuit(estado.modeNuit)
      setHoraInicio(estado.horaInicio)
      setKmDiarios(estado.kmDiarios || 0)
      setSegPausaTotal(estado.segPausaTotal || 0)
      if (estado.dateInicio) setDateInicio(new Date(estado.dateInicio))
      if (estado.emPausa) {
        setSegServico(estado.segServico)
        setSegConducao(estado.segConducao)
        setSegAmplitude(estado.segAmplitude)
        setSegPausa(estado.segPausa + tempoBackground)
        setSegPausaTotal((estado.segPausaTotal || 0) + tempoBackground)
      } else {
        setSegServico(estado.segServico + tempoBackground)
        setSegAmplitude(estado.segAmplitude + tempoBackground)
        if (estado.emConducao) setSegConducao(estado.segConducao + tempoBackground)
        else setSegConducao(estado.segConducao)
        setSegPausa(estado.segPausa)
      }
      await iniciarGPS()
    } catch (e) { console.log('Erro ao restaurar estado:', e) }
  }

  const carregarConfigs = async () => {
    const p = await AsyncStorage.getItem('profil')
    if (p) setProfil(p as Profil)
    const mt = await AsyncStorage.getItem('modoTacho')
    if (mt) setModoTacho(mt as 'crescente' | 'decrescente')
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
    restaurarEstado()
  }, [])

  useFocusEffect(
    React.useCallback(() => {
      carregarStatsSemaine()
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

  useEffect(() => {
    if (!enService) return
    autoGuardarTimer.current = setInterval(async () => {
      await guardarEstado({
        enService, emPausa, emConducao, decouche, modeNuit,
        segServico, segConducao, segAmplitude, segPausa,
        segPausaTotal, kmDiarios,
        horaInicio, dateInicio: dateInicio?.toISOString(),
        tsBackground: null,
      })
    }, 30000)
    return () => clearInterval(autoGuardarTimer.current)
  }, [enService, emPausa, segServico, segConducao, segAmplitude, segPausa, segPausaTotal, kmDiarios])

  useEffect(() => {
    const sub = AppState.addEventListener('change', async nextState => {
      if (nextState.match(/inactive|background/)) {
        tsBackground.current = Date.now()
        if (enService) {
          await guardarEstado({
            enService, emPausa, emConducao, decouche, modeNuit,
            segServico, segConducao, segAmplitude, segPausa,
            segPausaTotal, kmDiarios,
            horaInicio, dateInicio: dateInicio?.toISOString(),
            tsBackground: tsBackground.current,
          })
        }
      }
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        if (enService && tsBackground.current) {
          const agora = Date.now()
          const tempoBackground = Math.floor((agora - tsBackground.current) / 1000)
          tsBackground.current = null
          if (!emPausa) {
            setSegServico(s => s + tempoBackground)
            setSegAmplitude(a => a + tempoBackground)
            if (emConducao) setSegConducao(s => s + tempoBackground)
          } else {
            setSegPausa(p => p + tempoBackground)
            setSegPausaTotal(p => p + tempoBackground)
          }
        }
      }
      appState.current = nextState
    })
    return () => sub.remove()
  }, [enService, emPausa, segServico, segAmplitude, segPausa, segPausaTotal, segConducao, decouche, modeNuit, horaInicio, dateInicio, kmDiarios])

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
      const semaine = historique.filter((j: any) => {
        const [d, m] = j.date.split('/').map(Number)
        const dataJour = new Date(maintenant.getFullYear(), m - 1, d)
        return dataJour >= lundi && dataJour <= domingo
      })
      setStatsSemaine({
        heures: semaine.reduce((a: number, j: any) => a + (j.segServico || 0), 0),
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

const calcularFraisAuto = async (debut: string, fin: string, servico: string, type: string) => {
    // Dias sem serviço real não têm direito a frais
    if (['OFF', 'RC', 'FERIE', 'FER'].includes(type)) {
      setAddFrais('0.00')
      return
    }
    const [hS, mS] = servico.replace('h', ':').split(':').map(Number)
    const servicoMin = hS * 60 + (mS || 0)
    const isDecouche = type === 'DEC'
    let frais = 0
    if (isDecouche) {
      frais = 68.66
    } else {
      if (servicoMin >= 6 * 60) frais = 20.78
      else if (servicoMin >= 5 * 60) frais = 16.36
      else frais = 4.42
    }
    setAddFrais(frais.toFixed(2))
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

  useEffect(() => {
    if (!enService || emPausa) return
    const timer = setInterval(() => {
      setSegServico(s => s + 1)
      setSegAmplitude(a => a + 1)
    }, 1000)
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
      setSegPausa(s => s + 1)
      setSegPausaTotal(s => s + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [emPausa])

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
      accelMovimento.current = magnitude > 1.3
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
    const { status: fg } = await Location.requestForegroundPermissionsAsync()
    if (fg !== 'granted') {
      Alert.alert(t.localisationNecessaire, t.localisationMsg, [{ text: t.ok }])
      return
    }
    const { status: bg } = await Location.requestBackgroundPermissionsAsync()
    if (bg !== 'granted') {
      Alert.alert('Localização em fundo', 'Para registar condução com ecrã bloqueado, vai a Definições → TachoMax → Localização → Permitir sempre.', [{ text: 'OK' }])
    } 

    locationSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
      (loc) => {
        const vel = (loc.coords.speed || 0) * 3.6
        setVelocidade(Math.round(vel))
        const velMedia = mediaVelocidade(vel)
        if (!emPausaRef.current) {
    if (velMedia >= VELOCIDADE_MIN) {
            conducaoSegundos.current += 1
            paradoSegundosGps.current = 0
            if (conducaoSegundos.current >= 5) setEmConducao(true)
          } else {
            paradoSegundosGps.current += 1
            conducaoSegundos.current = 0
            if (paradoSegundosGps.current >= 8) setEmConducao(false)
          }
        } else {
          setEmConducao(false)
          conducaoSegundos.current = 0
          paradoSegundosGps.current = 0
        }
        ultimoGpsSinal.current = Date.now()
        setGpsOk(true)
        if (vel >= VELOCIDADE_MIN && ultimaLocalizacao.current) {
          const dist = calcularDistancia(
            ultimaLocalizacao.current.lat, ultimaLocalizacao.current.lon,
            loc.coords.latitude, loc.coords.longitude
          )
          if (dist > 0.01) setKmDiarios(k => Math.round((k + dist) * 10) / 10)
        }
        ultimaLocalizacao.current = { lat: loc.coords.latitude, lon: loc.coords.longitude }
      }
    )
  }

const pararGPS = async () => {
    if (locationSub.current) { locationSub.current.remove(); locationSub.current = null }
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
      case 'conduite':
        return `🚛 ${t.conduite} · Máx 9h/jour\nIl te reste ${fmtHM(Math.max(MAX_CONDUITE - segConducao, 0))}`
      case 'service':
        return `📊 ${t.service} · Máx ${modeNuit ? '10h' : '12h'}/jour\nIl te reste ${fmtHM(Math.max(MAX_SERVICE - segServico, 0))}`
      case 'amplitude':
        return `📏 ${t.amplitude} · Máx ${modeNuit ? '13h' : '15h'}/jour\nIl te reste ${fmtHM(Math.max(MAX_AMPLITUDE - segAmplitude, 0))}`
    }
  }

  const countdown = Math.max(PAUSA_MAX - segConducao, 0)
  const countup = segConducao
  const timerPrincipal = modoTacho === 'decrescente' ? countdown : countup
  const pctConducao = Math.min((segConducao / PAUSA_MAX) * 100, 100)
  const barColor = pctConducao > 90 ? '#e74c3c' : pctConducao > 70 ? '#f39c12' : '#27ae60'
  const maxSemaine = profil === 'CD' ? 52 * 3600 : 56 * 3600
  const pctSemaine = Math.min((statsSemaine.heures / maxSemaine) * 100, 100)
  const semaineColor = pctSemaine > 90 ? '#e74c3c' : pctSemaine > 75 ? '#f39c12' : '#27ae60'
  const pctServico = Math.min((segServico / MAX_SERVICE) * 100, 100)
  const servicoBarColor = pctServico > 90 ? '#e74c3c' : pctServico > 70 ? '#f39c12' : '#27ae60'

  const handleDemarrer = async () => {
    const agora = new Date()
    const h = String(agora.getHours()).padStart(2, '0')
    const m = String(agora.getMinutes()).padStart(2, '0')
    const horaNum = agora.getHours()
    const isNuit = horaNum >= 22 || horaNum < 5
    setModeNuit(isNuit)
    setHoraInicio(`${h}h${m}`)
    setDateInicio(agora)
    setEnService(true)
    ultimaVerificacao.current = 0
    amplitudeAlertado.current = false
    setSegServico(0); setSegConducao(0); setSegAmplitude(0); setSegPausa(0)
    setSegPausaTotal(0); setKmDiarios(0)
    await guardarEstado({
      enService: true, emPausa: false, emConducao: false, decouche, modeNuit: isNuit,
      segServico: 0, segConducao: 0, segAmplitude: 0, segPausa: 0,
      segPausaTotal: 0, kmDiarios: 0,
      horaInicio: `${h}h${m}`, dateInicio: agora.toISOString(),
      tsBackground: null,
    })
    await iniciarGPS()
    // Notificações: pedir permissão e agendar alertas do dia
    const notifOk = await pedirPermissaoNotificacoes()
    if (notifOk) {
      const maxAmplitude = isNuit ? 13 * 3600 : 15 * 3600
      await agendarAlertaPausa(PAUSA_MAX)           // alerta de pausa aos 4h30
      await agendarAlertaAmplitude(maxAmplitude)    // alerta de amplitude
    }
    if (isNuit) Alert.alert(t.modeNuitActive, t.modeNuitMsg)
  }

  const handlePause = async () => {
    if (emPausa) {
      const novoSegConducao = segPausa >= 45 * 60 ? 0 : segConducao
      setSegConducao(novoSegConducao)
      setSegPausa(0)
      setEmPausa(false)
      emPausaRef.current = false
      setShowPausaBandeau(false)
      setParadoSegundos(0)
      await guardarEstado({
        enService, emPausa: false, decouche, modeNuit,
        segServico, segConducao: novoSegConducao, segAmplitude, segPausa: 0,
        segPausaTotal, kmDiarios,
        horaInicio, dateInicio: dateInicio?.toISOString(), tsBackground: null,
      })
      // Reagendar alerta de pausa com tempo restante após retomar
      const tempoRestante = Math.max(PAUSA_MAX - novoSegConducao, 0)
      if (tempoRestante > 0) await agendarAlertaPausa(tempoRestante)
    } else {
      setEmConducao(false)
      setEmPausa(true)
      emPausaRef.current = true
      setShowPausaBandeau(false)
      setParadoSegundos(0)
      await guardarEstado({
        enService, emPausa: true, decouche, modeNuit,
        segServico, segConducao, segAmplitude, segPausa: 0,
        segPausaTotal, kmDiarios,
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

  const guardarDia = async (fim: Date) => {
    if (!dateInicio) return
    const diasSemana = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
    const jour = diasSemana[dateInicio.getDay()]
    const date = `${String(dateInicio.getDate()).padStart(2, '0')}/${String(dateInicio.getMonth() + 1).padStart(2, '0')}`
    const fimStr = `${String(fim.getHours()).padStart(2, '0')}h${String(fim.getMinutes()).padStart(2, '0')}`
    const horaInicioNum = dateInicio.getHours() * 60 + dateInicio.getMinutes()
    const horaFimNum = fim.getHours() * 60 + fim.getMinutes()
    const amplitudeMin = Math.floor(segAmplitude / 60)
    let fv = { ptDej: 4.42, dej: 16.36, diner: 23.94, nuit: 23.94 }
    try {
      const fvData = await AsyncStorage.getItem('frais_valores')
      if (fvData) fv = { ...fv, ...JSON.parse(fvData) }
    } catch (e) {}
    let frais = 0
    if (horaInicioNum <= 6 * 60 + 30 || decouche) frais += fv.ptDej
    if (amplitudeMin >= 6 * 60 + 1) frais += fv.dej
    if (horaFimNum >= 21 * 60 + 15 || decouche) frais += fv.diner
    if (decouche) frais += fv.nuit
    const novoDia = {
      id: Date.now().toString(), date, jour,
      type: decouche ? 'DEC' : 'TRAB',
      debut: horaInicio, fin: fimStr,
      segServico, segPausa: segPausaTotal, decouche, frais, modeNuit, kmDiarios,
    }
    try {
      const existente = await AsyncStorage.getItem('historique')
      const lista = existente ? JSON.parse(existente) : []
      lista.unshift(novoDia)
      await AsyncStorage.setItem('historique', JSON.stringify(lista.slice(0, 365)))
    } catch (e) { console.log('Erro:', e) }
  }

  const handleTerminer = () => setShowTerminerModal(true)

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
    const snapConduite = segConducao
    const snapKm = kmDiarios

    // Compute frais inline for summary
    const fim = new Date()
    const horaFimNum = fim.getHours() * 60 + fim.getMinutes()
    const horaInicioNum = dateInicio ? dateInicio.getHours() * 60 + dateInicio.getMinutes() : 0
    const amplitudeMin = Math.floor(segAmplitude / 60)
    let fv = { ptDej: 4.42, dej: 16.36, diner: 23.94, nuit: 23.94 }
    try {
      const fvData = await AsyncStorage.getItem('frais_valores')
      if (fvData) fv = { ...fv, ...JSON.parse(fvData) }
    } catch (e) {}
    let snapFrais = 0
    if (horaInicioNum <= 6 * 60 + 30 || comDecouche || decouche) snapFrais += fv.ptDej
    if (amplitudeMin >= 6 * 60 + 1) snapFrais += fv.dej
    if (horaFimNum >= 21 * 60 + 15 || comDecouche || decouche) snapFrais += fv.diner
    if (comDecouche || decouche) snapFrais += fv.nuit

    await guardarDia(fim)
    pararGPS()
    await cancelarTodosAlertas()
    await AsyncStorage.removeItem(STORAGE_KEY)
    setEnService(false); setEmPausa(false); setEmConducao(false); setModeNuit(false)
    setSegServico(0); setSegConducao(0); setSegAmplitude(0); setSegPausa(0)
    setSegPausaTotal(0); setKmDiarios(0); setDecouche(false); setDateInicio(null)
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
      semHeures: statsSemaine.heures + snapService / 3600,
      semFrais: statsSemaine.frais + snapFrais,
    })
    setShowSummaryModal(true)
  }

  const PROFILS = {
    CD:    { emoji: '🏠', label: 'Courte Distance', max: '52h/sem' },
    MIXTE: { emoji: '🔄', label: 'Mixte',           max: '56h/sem' },
    LD:    { emoji: '🛣️', label: 'Longue Distance', max: '56h/sem' },
  }

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        <View style={st.header}>
          <Text style={[st.appName, { color: c.text }]}>TACHO<Text style={st.accent}>MAX</Text></Text>
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

            <View style={st.btnCircularWrap}>
              <Animated.View style={{ transform: [{ scale: pulsarBtn }] }}>
                <TouchableOpacity style={st.btnCircular} onPress={handleDemarrer}>
                  <Text style={st.btnCircularIcon}>▶</Text>
                  <Text style={st.btnCircularLabel}>{t.demarrer}</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>

            <TouchableOpacity activeOpacity={1} onLongPress={() => { carregarDiasMes(); setCalMes(new Date().getMonth()); setCalAno(new Date().getFullYear()); setShowCalendario(true) }} delayLongPress={300}>
              <View style={[st.semCard, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
                <View style={st.semHeader}>
                  <Text style={[st.semTitle, { color: c.textLabel }]}>📊 SEMAINE EN COURS</Text>
                  <Text style={[st.semHours, { color: semaineColor }]}>{fmtHM(statsSemaine.heures)}<Text style={[st.semMax, { color: c.textSub }]}> / {profil === 'CD' ? '52h' : '56h'}</Text></Text>
                </View>
                <View style={[st.semBarBg, { backgroundColor: c.progressBg }]}>
                  <View style={[st.semBarFill, { width: `${pctSemaine}%` as any, backgroundColor: semaineColor }]} />
                </View>
                {statsSemaine.jours === 0 ? (
                  <Text style={[st.semEmpty, { color: c.textSub }]}>Aucun service cette semaine — bon repos! 😴</Text>
                ) : (
                  <View style={st.semStats}>
                    <Text style={[st.semStat, { color: c.textSub }]}>📅 {statsSemaine.jours} jour{statsSemaine.jours > 1 ? 's' : ''}</Text>
                    <Text style={[st.semStatSep, { color: c.cardBorder }]}>·</Text>
                    <Text style={[st.semStat, { color: '#2980b9' }]}>🌙 {statsSemaine.decouche} découché{statsSemaine.decouche > 1 ? 's' : ''}</Text>
                    <Text style={[st.semStatSep, { color: c.cardBorder }]}>·</Text>
                    <Text style={[st.semStat, { color: '#27ae60' }]}>💰 {statsSemaine.frais.toFixed(0)}€</Text>
                  </View>
                )}
              </View>
              <Text style={{ fontSize: 14, color: '#f5a623', opacity: 0.5, textAlign: 'right', marginHorizontal: 20 }}>
                Maintiens 2s · 📅 Calendrier
              </Text>
            </TouchableOpacity>

          </Animated.View>
        ) : (
          <>
            <View style={st.greeting}>
              <Text style={[st.greetingSub, { color: c.textSub }]}>Démarré à {horaInicio}</Text>
              <View style={st.conducaoStatus}>
                <Animated.View style={[st.conducaoDot, { backgroundColor: emConducao ? '#27ae60' : emPausa ? '#f39c12' : '#8890aa', transform: [{ scale: emConducao ? pulsarDot : 1 }] }]} />
                <Text style={[st.conducaoText, { color: emConducao ? '#27ae60' : emPausa ? '#f39c12' : '#8890aa' }]}>
                  {emPausa ? t.enPause : emConducao ? `${t.enConduite} · ${velocidade} km/h` : t.enService}
                </Text>
                <Text style={st.modeEmoji}>{modeNuit ? '🌙' : '☀️'}</Text>
              </View>
              {!gpsOk && (
                <View style={[st.nuitBandeau, { backgroundColor: 'rgba(231,76,60,0.15)', borderColor: '#e74c3c' }]}>
                  <Text style={[st.nuitBandeauText, { color: '#e74c3c' }]}>{t.gpsAlert}</Text>
                </View>
              )}
              {modeNuit && (
                <View style={st.nuitBandeau}>
                  <Text style={st.nuitBandeauText}>{t.modeNuitBandeau}</Text>
                </View>
              )}
            </View>

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

            <View style={[st.timerCard, { backgroundColor: c.timerBg, borderColor: c.cardBorder }, emPausa && st.timerCardPause, emConducao && st.timerCardConducao]}>
              <View style={[st.accentBar, emPausa && { backgroundColor: '#f39c12' }, emConducao && { backgroundColor: '#27ae60' }]} />
              {!emPausa ? (
                <>
                  <Text style={[st.timerStatus, { color: c.textSub }, emConducao && { color: '#27ae60' }]}>
                    {emConducao ? `🚛 ${t.enConduite}` : `● ${t.enService}`}
                  </Text>
                  <TouchableOpacity onPress={() => {
                    const novo = modoTacho === 'decrescente' ? 'crescente' : 'decrescente'
                    setModoTacho(novo)
                    AsyncStorage.setItem('modoTacho', novo)
                  }}>
                    <Text style={[st.timerBig, { color: emConducao ? barColor : c.textSub }]}>{fmt(timerPrincipal)}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[st.timerLabel, { color: c.textSub }]}>
                        {emConducao ? (modoTacho === 'decrescente' ? t.avantPause : '⬆ Temps de conduite') : t.attente}
                      </Text>
                      <View style={{ backgroundColor: c.progressBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 14, color: c.textSub, fontWeight: '700' }}>
                          {modoTacho === 'decrescente' ? '↓ 04:30' : '↑ 00:00'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                  {emConducao && (
                    <View style={[st.pauseBarBg, { backgroundColor: c.servicoBox }]}>
                      <View style={[st.pauseBarFill, { width: `${pctConducao}%` as any, backgroundColor: barColor }]} />
                    </View>
                  )}
                  <View style={[st.servicoBox, { backgroundColor: c.servicoBox }]}>
                    <View style={[st.servicoFill, { width: `${pctServico}%` as any, backgroundColor: servicoBarColor, opacity: 0.15 }]} />
                    <View style={st.servicoContent}>
                      <Text style={[st.servicoLabel, { color: c.textSub }]}>⏱ {t.service}</Text>
                      <Text style={[st.servicoVal, { color: c.text }]}>{fmt(segServico)}</Text>
                    </View>
                  </View>
                  {segPausaTotal > 0 && (
                    <Text style={{ fontSize: 13, color: segPausaTotal >= 45 * 60 ? '#27ae60' : '#f39c12', fontWeight: '700', marginTop: 6 }}>
                      ⏸ {t.pausasHoje} {fmtHM(segPausaTotal)} {segPausaTotal >= 45 * 60 ? '✅' : ''}
                    </Text>
                  )}
                  {kmDiarios > 0 && (
                    <Text style={{ fontSize: 13, color: c.textSub, fontWeight: '600', marginTop: 4 }}>
                      📍 {kmDiarios} km aujourd'hui
                    </Text>
                  )}
                  {countdown === 0 && emConducao && <Text style={st.pauseAlert}>⚠️ {t.pauseObligatoire}</Text>}
                  {countdown > 0 && countdown <= 30 * 60 && emConducao && (
                    <Text style={[st.pauseAlert, { color: '#f39c12' }]}>⚠️ {t.pauseDans} {fmtHM(countdown)}</Text>
                  )}
                </>
              ) : (
                <>
                  <Text style={[st.timerStatus, { color: '#f39c12' }]}>⏸ {t.enPause}</Text>
                  <Text style={[st.timerBig, { color: '#f39c12' }]}>{fmt(segPausa)}</Text>
                  <Text style={[st.timerLabel, { color: '#f39c12', opacity: 0.8 }]}>{t.pauseEnCours}</Text>
                  <View style={st.pauseDivider} />
                  <Text style={[st.conducaoGelada, { color: c.conducaoGelada }]}>{fmt(segConducao)}</Text>
                  <Text style={[st.timerLabel, { color: c.textSub }]}>{t.conduiteGelée}</Text>
                  <View style={st.pauseDivider} />
                  <Text style={[st.conducaoGelada, { color: c.conducaoGelada }]}>{fmt(segServico)}</Text>
                  <Text style={[st.timerLabel, { color: c.textSub }]}>{t.serviceGele}</Text>
                  <View style={st.pauseDivider} />
                  <Text style={{ fontSize: 13, color: segPausaTotal >= 45 * 60 ? '#27ae60' : '#f39c12', fontWeight: '700', marginTop: 4 }}>
                    ⏸ Pauses aujourd'hui: {fmtHM(segPausaTotal)} {segPausaTotal >= 45 * 60 ? '✅' : ''}
                  </Text>
                  {segPausa >= 45 * 60 && (
                    <Text style={{ fontSize: 13, color: '#27ae60', fontWeight: '700', marginTop: 4 }}>{t.pauseValide}</Text>
                  )}
                </>
              )}
            </View>

            {tooltip && (
              <View style={[st.tooltipBox, { backgroundColor: c.tooltipBg, borderColor: c.cardBorder }]}>
                <Text style={[st.tooltipText, { color: c.text }]}>{getTooltipText(tooltip)}</Text>
              </View>
            )}

            <View style={[st.miniRow, { backgroundColor: c.miniRow, borderColor: c.cardBorder }]}>
              <TouchableOpacity style={st.miniBox} onPress={() => showTooltip('conduite')}>
                <Text style={st.miniIcon}>🚛</Text>
                <Text style={[st.miniVal, { color: c.text }, emConducao && { color: '#27ae60' }]}>{fmtHM(segConducao)}</Text>
                <Text style={[st.miniLabel, { color: c.textSub }]}>{t.conduite}</Text>
              </TouchableOpacity>
              <View style={[st.miniDivider, { backgroundColor: c.cardBorder }]} />
              <TouchableOpacity style={st.miniBox} onPress={() => showTooltip('service')}>
                <Text style={st.miniIcon}>📊</Text>
                <Text style={[st.miniVal, { color: c.text }]}>{fmtHM(segServico)}</Text>
                <Text style={[st.miniLabel, { color: c.textSub }]}>{t.service}</Text>
              </TouchableOpacity>
              <View style={[st.miniDivider, { backgroundColor: c.cardBorder }]} />
              <TouchableOpacity style={st.miniBox} onPress={() => showTooltip('amplitude')}>
                <Text style={st.miniIcon}>📏</Text>
                <Text style={[st.miniVal, { color: '#2980b9' }]}>{fmtHM(segAmplitude)}</Text>
                <Text style={[st.miniLabel, { color: c.textSub }]}>{t.amplitude}</Text>
              </TouchableOpacity>
            </View>

            <View style={st.actionRow}>
              <TouchableOpacity style={[st.btnPause, emPausa && st.btnReprendre]} onPress={handlePause}>
                <Text style={st.btnPauseIcon}>{emPausa ? '▶' : '⏸'}</Text>
                <Text style={[st.btnPauseLabel, emPausa && { color: '#27ae60', fontSize: 10 }]}>{emPausa ? t.reprendre : t.pause}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.btnStop} onPress={handleTerminer}>
                <Text style={st.btnStopIcon}>⏹</Text>
                <Text style={st.btnStopLabel}>{t.terminer}</Text>
              </TouchableOpacity>
            </View>

            <View style={st.limites}>
              <Text style={[st.limitesTitle, { color: c.textLabel }]}>{t.limitesLegales} {modeNuit ? '🌙' : '☀️'}</Text>
              {[
                { label: t.conduiteAujourdhui, seg: segConducao, max: MAX_CONDUITE, maxLabel: '9h00' },
                { label: t.serviceJournalier, seg: segServico, max: MAX_SERVICE, maxLabel: modeNuit ? '10h00' : '12h00' },
                { label: t.amplitudeJournaliere, seg: segAmplitude, max: MAX_AMPLITUDE, maxLabel: modeNuit ? '13h00' : '15h00' },
                { label: '🚛 Semaine en cours', seg: statsSemaine.heures, max: maxSemaine, maxLabel: profil === 'CD' ? '52h00' : '56h00' },
              ].map(item => {
                const pct = Math.min((item.seg / item.max) * 100, 100)
                const color = pct > 90 ? '#e74c3c' : pct > 75 ? '#f39c12' : '#27ae60'
                return (
                  <View key={item.label} style={st.limiteItem}>
                    <View style={st.limiteRow}>
                      <Text style={[st.limiteName, { color: c.textSub }]}>{item.label}</Text>
                      <Text style={[st.limiteVal, { color }]}>{fmtHM(item.seg)} / {item.maxLabel}</Text>
                    </View>
                    <View style={[st.progressBg, { backgroundColor: c.progressBg }]}>
                      <View style={[st.progressFill, { width: `${pct}%` as any, backgroundColor: color }]} />
                    </View>
                  </View>
                )
              })}
            </View>
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
                    let emoji = ''
                    if (registo) {
                      if (registo.type === 'DEC') { bgColor = 'rgba(41,128,185,0.2)'; emoji = '🌙' }
                      else if (registo.type === 'TRAB') { bgColor = 'rgba(39,174,96,0.2)'; emoji = '✅' }
                      else if (registo.type === 'FERIE') { bgColor = 'rgba(155,89,182,0.2)'; emoji = '🏖️' }
                      else if (registo.type === 'FER') { bgColor = 'rgba(243,156,18,0.2)'; emoji = '🎉' }
                      else if (registo.type === 'RC') { bgColor = 'rgba(26,188,156,0.2)'; emoji = '🔄' }
                      else if (registo.type === 'OFF') { bgColor = 'rgba(107,115,148,0.15)'; emoji = '❌' }
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
                        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: bgColor, borderWidth: isHoje ? 2 : (registo ? 1 : 0), borderColor: isHoje ? '#f5a623' : (registo ? bgColor.replace('0.2', '0.6').replace('0.15', '0.5') : 'transparent'), alignItems: 'center', justifyContent: 'center' }}>
                         {emoji ? (
  <>
    <Text style={{ fontSize: 13 }}>{emoji}</Text>
    <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>{numDia}</Text>
  </>
) : (
  <Text style={{ fontSize: 12, fontWeight: isHoje ? '800' : '500', color: isHoje ? '#f5a623' : c.textSub }}>{numDia}</Text>
)}
                        </View>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              ))
            })()}
            </View>{/* fim grelha altura fixa */}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'center' }}>
              {[{ emoji: '✅', label: 'Travail' }, { emoji: '🌙', label: 'Découché' }, { emoji: '🏖️', label: 'Congé' }, { emoji: '🎉', label: 'Férié' }, { emoji: '🔄', label: 'Repos C.' }, { emoji: '❌', label: 'Repos' }].map(item => (
                <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 12 }}>{item.emoji}</Text>
                  <Text style={{ fontSize: 13, color: c.textSub, fontWeight: '600' }}>{item.label}</Text>
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
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
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
          </View>
        </View>
      </Modal>

      <Modal visible={showTerminerModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, marginBottom: 16 }} />
              <Text style={{ fontSize: 22, fontWeight: '800', color: c.text }}>Fin de service</Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 4 }}>Confirmes-tu la fin de journée?</Text>
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
                <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }}>{kmDiarios}</Text>
                <Text style={{ fontSize: 13, color: c.textSub, fontWeight: '600', letterSpacing: 1 }}>KM</Text>
              </View>
            </View>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: decouche ? 'rgba(41,128,185,0.12)' : c.bg, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: decouche ? '#2980b9' : c.cardBorder }} onPress={() => setDecouche(d => !d)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>🌙</Text>
                <View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: decouche ? '#2980b9' : c.text }}>Découché ce soir</Text>
                  <Text style={{ fontSize: 13, color: c.textSub }}>Frais de nuit appliqués automatiquement</Text>
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
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 8, textAlign: 'center' }}>Contrôle tacographe</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 16, lineHeight: 20 }}>La conduite enregistrée dans TachoMax correspond-elle à ton tacographe ?</Text>
            <View style={{ backgroundColor: c.bg, borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 12, color: c.textSub, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>CONDUITE ENREGISTRÉE</Text>
              <Text style={{ color: '#27ae60', fontWeight: '800', fontSize: 32 }}>{fmtHM(segConducao)}</Text>
            </View>
            <TouchableOpacity style={{ backgroundColor: '#27ae60', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 }} onPress={() => setShowCorrecao(false)}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>✅ Oui, c'est correct</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ backgroundColor: c.card, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e74c3c' }} onPress={() => {
              const h = Math.floor(segConducao / 3600)
              const m = Math.floor((segConducao % 3600) / 60)
              setInputHoras(String(h))
              setInputMinutos(String(m).padStart(2, '0'))
              setShowCorrecao(false)
              setTimeout(() => setShowInputCorrecao(true), 300)
            }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#e74c3c' }}>❌ Non, corriger</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showInputCorrecao} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#e74c3c', width: '100%' }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 6, textAlign: 'center' }}>✏️ Corriger la conduite</Text>
              <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>Indique le temps réel affiché sur ton tacographe</Text>

              {/* HH : MM picker */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>HEURES</Text>
                  <TextInput
                    style={{ backgroundColor: c.bg, borderRadius: 14, borderWidth: 2, borderColor: '#e74c3c', width: 90, height: 72, fontSize: 36, fontWeight: '800', color: c.text, textAlign: 'center' }}
                    value={inputHoras}
                    onChangeText={v => { const n = v.replace(/[^0-9]/g, ''); if (parseInt(n) <= 9 || n === '') setInputHoras(n) }}
                    keyboardType="number-pad"
                    maxLength={1}
                    autoFocus
                  />
                </View>
                <Text style={{ fontSize: 36, fontWeight: '800', color: c.textSub, marginTop: 18 }}>:</Text>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>MINUTES</Text>
                  <TextInput
                    style={{ backgroundColor: c.bg, borderRadius: 14, borderWidth: 2, borderColor: '#e74c3c', width: 90, height: 72, fontSize: 36, fontWeight: '800', color: c.text, textAlign: 'center' }}
                    value={inputMinutos}
                    onChangeText={v => { const n = v.replace(/[^0-9]/g, ''); if (parseInt(n) <= 59 || n === '') setInputMinutos(n) }}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                </View>
              </View>

              <TouchableOpacity style={{ backgroundColor: '#e74c3c', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 }} onPress={() => {
                const h = parseInt(inputHoras || '0')
                const m = parseInt(inputMinutos || '0')
                if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 9 && m >= 0 && m <= 59) {
                  setSegConducao(h * 3600 + m * 60)
                  setShowInputCorrecao(false)
                } else {
                  Alert.alert('Valeur invalide', 'Heures : 0–9 | Minutes : 0–59')
                }
              }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>✅ Confirmer la correction</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={() => setShowInputCorrecao(false)}>
                <Text style={{ fontSize: 14, color: c.textSub }}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 6 }}>À quelle heure as-tu terminé ?</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>
              Le service sera recalculé à partir de cette heure.{'\n'}Heure de début : <Text style={{ fontWeight: '800', color: c.text }}>{horaInicio}</Text>
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
              <Text style={{ fontSize: 16, fontWeight: '800', color: 'white' }}>✅ Confirmer et terminer</Text>
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
            <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>Service terminé !</Text>
            <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 20 }}>Bonne journée {nomeConducteur} 👋</Text>

            {/* Stats grid */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, padding: 14, alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 22 }}>⏱️</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#f5a623' }}>{summaryData ? fmtHM(summaryData.service) : '—'}</Text>
                <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>SERVICE</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, padding: 14, alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 22 }}>🚛</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#27ae60' }}>{summaryData ? fmtHM(summaryData.conduite) : '—'}</Text>
                <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>CONDUITE</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, padding: 14, alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 22 }}>📍</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: c.text }}>{summaryData ? `${summaryData.km} km` : '—'}</Text>
                <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>DISTANCE</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: 16, padding: 14, alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 22 }}>🧾</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#27ae60' }}>{summaryData ? `${summaryData.frais.toFixed(2)}€` : '—'}</Text>
                <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>FRAIS</Text>
              </View>
            </View>

            {/* Weekly totals */}
            <View style={{ backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)', marginBottom: 20 }}>
              <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>CUMUL SEMAINE</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 14, color: c.textSub }}>Heures totales</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{summaryData ? `${summaryData.semHeures.toFixed(1)}h` : '—'}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ fontSize: 14, color: c.textSub }}>Frais totaux</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#27ae60' }}>{summaryData ? `${summaryData.semFrais.toFixed(2)}€` : '—'}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={{ backgroundColor: '#f5a623', borderRadius: 16, padding: 16, alignItems: 'center' }}
              onPress={() => setShowSummaryModal(false)}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: 'white' }}>✅ Parfait !</Text>
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