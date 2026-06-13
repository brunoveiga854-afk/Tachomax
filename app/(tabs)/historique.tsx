import { TachoLogo } from '../../src/TachoLogo'
import DateTimePicker from '@react-native-community/datetimepicker'
import React, { useCallback, useState, useRef } from 'react'
import { useFocusEffect } from 'expo-router'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Share, Alert, Modal, TextInput, PanResponder, Animated, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../context/ThemeContext'
import { calcularFraisJour, DEFAULT_FRAIS_REGLES, DEFAULT_FRAIS_VALEURS, sanitizeFraisRegles, sanitizeFraisValeurs } from '../../src/frais'
type JourType = 'TRAB' | 'DEC' | 'FER' | 'FERIE' | 'RC' | 'OFF' | 'work' | 'dec'
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
  kmDiarios?: number
  kmInicio?: number
  kmFim?: number
  nota?: { categoria: string; emoji: string; texto?: string }
}
const TYPE_CONFIG: Partial<Record<JourType, { label: string, color: string, bg: string, bgLight: string, emoji: string }>> = {
  TRAB:  { label: 'Travail',     color: '#27ae60', bg: 'rgba(39,174,96,0.12)',   bgLight: 'rgba(39,174,96,0.15)',  emoji: '💼' },
  DEC:   { label: 'Découché',    color: '#2980b9', bg: 'rgba(41,128,185,0.12)',  bgLight: 'rgba(41,128,185,0.15)', emoji: '🌙' },
  FER:   { label: 'Férié',       color: '#f39c12', bg: 'rgba(243,156,18,0.12)',  bgLight: 'rgba(243,156,18,0.15)', emoji: '🎉' },
  FERIE: { label: 'Congé',       color: '#9b59b6', bg: 'rgba(155,89,182,0.12)', bgLight: 'rgba(155,89,182,0.15)', emoji: '🏖️' },
  RC:    { label: 'Repos Comp.', color: '#1abc9c', bg: 'rgba(26,188,156,0.12)', bgLight: 'rgba(26,188,156,0.15)', emoji: '🔄' },
  OFF:   { label: 'Repos',       color: '#6b7394', bg: 'rgba(107,115,148,0.08)',bgLight: 'rgba(107,115,148,0.1)', emoji: '❌' },
}
const fmtHM = (seg: number) => {
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  return `${String(h).padStart(2,'0')}h${String(m).padStart(2,'0')}`
}
const calcAmplitudeDe = (debut: string, fin: string) => {
  const parse = (t: string) => {
    const [h, m] = t.replace('h', ':').split(':').map(Number)
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
  }
  let d = parse(debut), f = parse(fin)
  if (f <= d) f += 24 * 60
  return Math.max(0, (f - d) * 60)
}
const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const MOIS_COURT = ['JAN','FÉV','MAR','AVR','MAI','JUN','JUL','AOÛ','SEP','OCT','NOV','DÉC']
const MAX_SEMAINE = 56 * 3600
function JourCardSwipeable({ jour, themeSombre, c, onDelete, onEdit, onNote, index }: {
  jour: Jour, themeSombre: boolean, c: any, onDelete: () => void, onEdit: () => void, onNote: () => void, index: number
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const swipeAtivado = useRef(false)
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dy) < 20,
    onPanResponderMove: (_, g) => {
      if (g.dx < 0) translateX.setValue(g.dx)
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -80) {
        Animated.spring(translateX, { toValue: -300, useNativeDriver: true }).start()
        swipeAtivado.current = true
        Alert.alert(
          '🗑️ Supprimer ce jour?',
          `${jour.jour} ${jour.date} — ${fmtHM(jour.segServico)}\n\nCette action est irréversible.`,
          [
            { text: 'Annuler', style: 'cancel', onPress: () => {
              Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start()
              swipeAtivado.current = false
            }},
            { text: 'Supprimer', style: 'destructive', onPress: onDelete },
          ]
        )
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start()
      }
    },
  })).current
  const cfg = TYPE_CONFIG[jour.type] || TYPE_CONFIG.TRAB
  const temPausa = jour.segPausa > 0
  const temServico = ['TRAB', 'DEC'].includes(jour.type)
  const dateParts = jour.date.split('/')
  const diaNum = dateParts[0] || '—'
  const mesIdx = dateParts[1] ? parseInt(dateParts[1]) - 1 : -1
  const mesNome = mesIdx >= 0 && mesIdx < 12 ? MOIS_COURT[mesIdx] : ''
  const amplitudeSeg = temServico ? calcAmplitudeDe(jour.debut, jour.fin) : 0
  return (
    <View style={{ marginHorizontal: 20, marginBottom: 8 }}>
      <View style={[st.deleteBg]}>
        <Text style={st.deleteIcon}>🗑️</Text>
        <Text style={st.deleteText}>Supprimer</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <TouchableOpacity activeOpacity={0.85} onPress={onEdit}>
          <View style={[st.jourCard, { backgroundColor: c.card, borderColor: cfg.color + '30', borderLeftColor: cfg.color, borderLeftWidth: 4 }]}>
            <View style={st.jourHeader}>
              <View style={st.jourDateBox}>
                <Text style={[st.jourDayName, { color: c.textSub }]}>{jour.jour.toUpperCase()}</Text>
                <Text style={[st.jourDayNum, { color: '#f5a623' }]}>{diaNum}</Text>
                <Text style={[st.jourMonth, { color: c.textSub }]}>{mesNome}</Text>
                <View style={[st.jourDurLine, { backgroundColor: cfg.color + '30' }]} />
              </View>
              <View style={st.jourInfo}>
                <View style={[st.jourTypeBadge, { backgroundColor: cfg.bg }]}>
                  <Text style={[st.jourTypeText, { color: cfg.color }]}>{cfg.emoji} {cfg.label.toUpperCase()}</Text>
                </View>
                {temServico ? (
                  <>
                    <View style={st.jourTimesRow}>
                      <View style={st.jourTimeBlock}>
                        <Text style={[st.jourTimeLabel, { color: c.textSub }]}>DÉBUT</Text>
                        <Text style={[st.jourTimeVal, { color: c.text }]}>{jour.debut}</Text>
                      </View>
                      <View style={st.jourTimeBlock}>
                        <Text style={[st.jourTimeLabel, { color: c.textSub }]}>FIN</Text>
                        <Text style={[st.jourTimeVal, { color: c.text }]}>{jour.fin}</Text>
                      </View>
                    </View>
                    <View style={st.jourAmpServiceRow}>
                      <Text style={st.jourAmplitudeText}>amp. {fmtHM(amplitudeSeg)}</Text>
                      <Text style={[st.jourAmpSep, { color: c.textSub }]}>|</Text>
                      <Text style={st.jourServiceText}>{fmtHM(jour.segServico)}</Text>
                    </View>
                    {temPausa && (
                      <Text style={[st.jourPauseText, { color: '#f39c12' }]}>⏸ pause {fmtHM(jour.segPausa)}</Text>
                    )}
                  </>
                ) : (
                  <Text style={[st.jourReposText, { color: c.textSub }]}>Jour non travaillé</Text>
                )}
                {index === 0 && <Text style={[st.swipeHint, { color: c.textSub }]}>← glisse pour supprimer</Text>}
              </View>
              <View style={st.jourFrais}>
                <View style={{ alignItems: 'flex-end' }}>
                  {['FERIE','FER','RC','OFF'].includes(jour.type)
                    ? <Text style={[st.jourFraisLabel, { color: c.textSub }]}>—</Text>
                    : <>
                        <Text style={[st.jourFraisLabel, { color: c.textSub }]}>FRAIS</Text>
                        {jour.frais > 0
                          ? <Text style={[st.jourFraisVal, { color: '#27ae60' }]}>+{jour.frais.toFixed(2)}€</Text>
                          : <Text style={[st.jourFraisVal, { color: c.textSub }]}>—</Text>
                        }
                      </>
                  }
                  {(jour.kmDiarios ?? 0) > 0 && (
                    <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '600', marginTop: 2 }}>📍 {jour.kmDiarios} km</Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  {jour.nota && (
                    <TouchableOpacity onPress={onNote} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={{ fontSize: 14 }}>{jour.nota.emoji}</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={[st.editHint, { color: c.textSub }]}>✏️ modifier</Text>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}
export default function HistoriqueScreen() {
  const { themeSombre } = useTheme()
  const [historique, setHistorique] = useState<Jour[]>([])
  const [semaine, setSemaine] = useState(0)
  const [vue, setVue] = useState<'semaine' | 'mois'>('semaine')
  const [refreshing, setRefreshing] = useState(false)
  const [moisOffset, setMoisOffset] = useState(0)
  const [jourEdit, setJourEdit] = useState<Jour | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [editDebut, setEditDebut] = useState('')
  const [editFin, setEditFin] = useState('')
  const [editDecouche, setEditDecouche] = useState(false)
  const [editType, setEditType] = useState<JourType>('TRAB')
  const [editFrais, setEditFrais] = useState('')
  const [editServico, setEditServico] = useState('')
  const [editPausaMin, setEditPausaMin] = useState(0)
  const [showPausaPicker, setShowPausaPicker] = useState(false)
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [timePickerTarget, setTimePickerTarget] = useState<'debut' | 'fin'>('debut')
  const [timePickerDate, setTimePickerDate] = useState(new Date())
  const [showReposDetail, setShowReposDetail] = useState(false)
  const [showNoteModal, setShowNoteModal] = useState(false)
  const [noteJour, setNoteJour] = useState<Jour | null>(null)
  const [noteCategoria, setNoteCategoria] = useState('')
  const [noteEmoji, setNoteEmoji] = useState('')
  const [noteTexto, setNoteTexto] = useState('')
  const [notaDataSel, setNotaDataSel] = useState<string>('')
  const [showNotaDatePicker, setShowNotaDatePicker] = useState(false)
  const [editKm, setEditKm] = useState('')
  const [editKmInicio, setEditKmInicio] = useState('')
  const [editKmFim, setEditKmFim] = useState('')
  useFocusEffect(useCallback(() => { setSemaine(0); setMoisOffset(0); chargerHistorique() }, []))
  const chargerHistorique = async () => {
    try {
      const data = await AsyncStorage.getItem('historique')
      if (!data) return
      const lista = JSON.parse(data)
      const migrada = lista.map((j: any) => {
        const parts = j.date.split('/')
        if (parts.length === 2) {
          const ano = new Date(parseInt(j.id)).getFullYear()
          return { ...j, date: `${parts[0]}/${parts[1]}/${ano}` }
        }
        return j
      })
      const mudou = migrada.some((j: any, i: number) => j.date !== lista[i].date)
      if (mudou) await AsyncStorage.setItem('historique', JSON.stringify(migrada))
      setHistorique(migrada)
    } catch (e) { console.log('Erro:', e) }
  }
  const c = {
    bg: themeSombre ? '#0f1117' : '#f0f2f8',
    card: themeSombre ? '#181c27' : '#ffffff',
    cardBorder: themeSombre ? '#2a3045' : '#d0d5e8',
    text: themeSombre ? '#eef0f5' : '#1a1f35',
    textSub: themeSombre ? '#6b7394' : '#555e80',
    textLabel: themeSombre ? '#6b7394' : '#3a4060',
    navBtn: themeSombre ? '#1f2436' : '#e8eaf2',
    navBtnBorder: themeSombre ? '#2a3045' : '#c0c5d8',
    progressBg: themeSombre ? '#0f1117' : '#d8dce8',
    emptyText: themeSombre ? '#6b7394' : '#555e80',
    emptySub: themeSombre ? '#2a3045' : '#9096b0',
    input: themeSombre ? '#1f2436' : '#f0f2f8',
  }
  const getSemaineLabel = () => {
    const maintenant = new Date()
    const debut = new Date(maintenant)
    debut.setDate(maintenant.getDate() - maintenant.getDay() + 1 + (semaine * 7))
    const fin = new Date(debut)
    fin.setDate(debut.getDate() + 6)
    return `${debut.getDate()} ${MOIS[debut.getMonth()].slice(0,3)} — ${fin.getDate()} ${MOIS[fin.getMonth()].slice(0,3)} ${fin.getFullYear()}`
  }
  const getJoursSemaine = () => {
    const maintenant = new Date()
    const lundiBase = new Date(maintenant)
    lundiBase.setDate(maintenant.getDate() - maintenant.getDay() + 1 + (semaine * 7))
    return historique.filter(jour => {
      const parts = jour.date.split('/')
      const d = parseInt(parts[0])
      const m = parseInt(parts[1])
      const ano = parts[2] ? parseInt(parts[2]) : new Date(parseInt(jour.id)).getFullYear()
      const dataJour = new Date(ano, m - 1, d)
      const lundi = new Date(lundiBase)
      lundi.setHours(0, 0, 0, 0)
      const domingo = new Date(lundiBase)
      domingo.setDate(lundi.getDate() + 6)
      domingo.setHours(23, 59, 59, 999)
      return dataJour >= lundi && dataJour <= domingo
    })
  }
  const getMoisLabel = () => {
    const agora = new Date()
    const d = new Date(agora.getFullYear(), agora.getMonth() + moisOffset, 1)
    return `${MOIS[d.getMonth()]} ${d.getFullYear()}`
  }
const getJoursMois = () => {
    const agora = new Date()
    const d = new Date(agora.getFullYear(), agora.getMonth() + moisOffset, 1)
    const mes = d.getMonth() + 1
    const ano = d.getFullYear()
    return historique.filter(jour => {
      const parts = jour.date.split('/')
      const m = parseInt(parts[1])
      const anoJour = parts[2] ? parseInt(parts[2]) : new Date(parseInt(jour.id)).getFullYear()
      return m === mes && anoJour === ano
    })
  }
  const exportarRelatorio = async (jours: Jour[], label: string) => {
    const totalService = jours.reduce((a, j) => a + (['TRAB', 'DEC'].includes(j.type) ? (j.segServico || 0) : 0), 0)
    const totalPauses = jours.reduce((a, j) => a + (j.segPausa || 0), 0)
    const totalFrais = jours.reduce((a, j) => a + (j.frais || 0), 0)
    const nbDecouche = jours.filter(j => j.decouche).length
    const nbTrab = jours.filter(j => j.type === 'TRAB' || j.type === 'DEC').length
    let texte = `🚛 TACHOOFFICE — Rapport ${label}\n`
    texte += `${'─'.repeat(30)}\n\n`
    texte += `📊 RÉSUMÉ\n`
    texte += `Jours travaillés: ${nbTrab}\n`
    texte += `Service total: ${fmtHM(totalService)}\n`
    texte += `Pauses total: ${fmtHM(totalPauses)}\n`
    texte += `Découchés: ${nbDecouche}\n`
    texte += `Frais total: ${totalFrais.toFixed(2)}€\n\n`
    texte += `📅 DÉTAIL\n`
    jours.forEach(j => {
      texte += `${j.jour} ${j.date} | ${j.debut}→${j.fin} | ${fmtHM(j.segServico)} | ${j.frais.toFixed(2)}€`
      if (j.decouche) texte += ` 🌙`
      texte += `\n`
    })
    texte += `\n${'─'.repeat(30)}\nGénéré par TachoOffice`
    await Share.share({ message: texte, title: `Rapport TachoOffice ${label}` })
  }
  const eliminarJour = async (id: string) => {
    const nova = historique.filter(j => j.id !== id)
    setHistorique(nova)
    await AsyncStorage.setItem('historique', JSON.stringify(nova))
  }
  const calcServicoDe = (debut: string, fin: string, pausaMin: number): number => {
    const parse = (t: string) => {
      const [h, m] = t.replace('h', ':').split(':').map(Number)
      return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
    }
    let d = parse(debut), f = parse(fin)
    if (f <= d) f += 24 * 60
    return Math.max(0, (f - d - pausaMin) * 60)
  }
  const abrirEdicao = (jour: Jour) => {
    setJourEdit(jour)
    setEditDebut(jour.debut)
    setEditFin(jour.fin)
    setEditDecouche(jour.decouche)
    setEditType(jour.type)
    setEditFrais(jour.frais.toFixed(2))
    setEditKm(String(jour.kmDiarios ?? 0))
    setEditKmInicio(String(jour.kmInicio ?? 0))
    setEditKmFim(String(jour.kmFim ?? 0))
    const pausaMin = Math.floor((jour.segPausa || 0) / 60)
    setEditPausaMin(pausaMin)
    setEditServico(fmtHM(calcServicoDe(jour.debut, jour.fin, pausaMin)))
    setShowEdit(true)
  }
  const diaAnteriorDecouche = (jour: Jour | null) => {
    if (!jour) return false
    const parts = jour.date.split('/').map(Number)
    if (parts.length < 2) return false
    const ano = parts[2] || new Date(parseInt(jour.id)).getFullYear()
    const atual = new Date(ano, (parts[1] || 1) - 1, parts[0] || 1)
    atual.setDate(atual.getDate() - 1)
    const alvo = `${String(atual.getDate()).padStart(2, '0')}/${String(atual.getMonth() + 1).padStart(2, '0')}`
    return historique.some(j => j.id !== jour.id && (j.date || '').startsWith(alvo) && (j.type === 'DEC' || j.decouche))
  }
  const calcularFraisEdicao = (debut: string, fin: string, servico: string, type: JourType, prevDec = false, regles: any = DEFAULT_FRAIS_REGLES, valeurs: any = DEFAULT_FRAIS_VALEURS) => {
    const [hS, mS] = servico.replace('h', ':').split(':').map(Number)
    return calcularFraisJour({
      type,
      debut,
      fin,
      segServico: (hS * 3600) + ((mS || 0) * 60),
      decouche: type === 'DEC',
      prevDecouche: prevDec,
      regles,
      valeurs,
    }).total
  }
  const abrirNota = (jour: Jour) => {
    setNoteJour(jour)
    setNoteCategoria(jour.nota?.categoria || '')
    setNoteEmoji(jour.nota?.emoji || '')
    setNoteTexto(jour.nota?.texto || '')
    setShowNoteModal(true)
  }
  const guardarNota = async () => {
    if (!noteCategoria) return
    const nota = { categoria: noteCategoria, emoji: noteEmoji, texto: noteTexto || undefined }
    if (noteJour) {
      const nova = historique.map(j => j.id === noteJour.id ? { ...j, nota } : j)
      setHistorique(nova)
      await AsyncStorage.setItem('historique', JSON.stringify(nova))
    } else if (notaDataSel) {
      const nova = historique.map(j => j.date === notaDataSel ? { ...j, nota } : j)
      setHistorique(nova)
      await AsyncStorage.setItem('historique', JSON.stringify(nova))
    }
    setShowNoteModal(false)
    setNoteJour(null)
    setNotaDataSel('')
  }
  const guardarEdicao = async () => {
    if (!jourEdit) return
    const novoSeg = calcServicoDe(editDebut, editFin, editPausaMin)
    const novoServicoStr = fmtHM(novoSeg)
    let regles = DEFAULT_FRAIS_REGLES
    let valeurs = DEFAULT_FRAIS_VALEURS
    try {
      const reglesData = await AsyncStorage.getItem('frais_regles')
      const valeursData = await AsyncStorage.getItem('frais_valores')
      regles = sanitizeFraisRegles(reglesData ? JSON.parse(reglesData) : {})
      valeurs = sanitizeFraisValeurs(valeursData ? JSON.parse(valeursData) : {})
    } catch (e) {}
    const fraisCalculado = calcularFraisEdicao(editDebut, editFin, novoServicoStr, editType, diaAnteriorDecouche(jourEdit), regles, valeurs)
    const jourAtualizado: Jour = {
      ...jourEdit,
      debut: editDebut,
      fin: editFin,
      decouche: editType === 'DEC',
      type: editType,
      frais: fraisCalculado,
      segServico: novoSeg,
      segPausa: editPausaMin * 60,
      kmDiarios: parseFloat(editKm) || 0,
      kmInicio: parseFloat(editKmInicio) || 0,
      kmFim: parseFloat(editKmFim) || 0,
    }
    const nova = historique.map(j => j.id === jourEdit.id ? jourAtualizado : j)
    setHistorique(nova)
    await AsyncStorage.setItem('historique', JSON.stringify(nova))
    setShowEdit(false)
    setJourEdit(null)
  }
  const jousSemaine = getJoursSemaine()
  const joursMois = getJoursMois()
  const joursActuels = vue === 'semaine' ? jousSemaine : joursMois
  const totalService = joursActuels.reduce((a, j) => a + (['TRAB', 'DEC'].includes(j.type) ? (j.segServico || 0) : 0), 0)
  const totalFrais = joursActuels.reduce((a, j) => a + (j.frais || 0), 0)
  const totalKm = joursActuels.reduce((a, j) => a + (j.kmDiarios || 0), 0)
  const nbDecouche = joursActuels.filter(j => j.decouche).length
  const pctSemaine = Math.min((totalService / MAX_SEMAINE) * 100, 100)
  const barColor = pctSemaine > 90 ? '#e74c3c' : pctSemaine > 75 ? '#f39c12' : '#27ae60'
  const invalidos = joursActuels.filter(j => j.segServico < 120 && (j.type === 'TRAB' || j.type === 'DEC'))
  const validos = joursActuels.filter(j => !(j.segServico < 120 && (j.type === 'TRAB' || j.type === 'DEC')))
  const getJoursSemanaOffset = (offset: number) => {
    const maintenant = new Date()
    const lundiBase = new Date(maintenant)
    lundiBase.setDate(maintenant.getDate() - maintenant.getDay() + 1 + (offset * 7))
    return historique.filter(jour => {
      const parts = jour.date.split('/')
      const d = parseInt(parts[0]), m = parseInt(parts[1])
      const ano = parts[2] ? parseInt(parts[2]) : new Date(parseInt(jour.id)).getFullYear()
      const dataJour = new Date(ano, m - 1, d)
      const lundi = new Date(lundiBase); lundi.setHours(0,0,0,0)
      const domingo = new Date(lundiBase); domingo.setDate(lundi.getDate() + 6); domingo.setHours(23,59,59,999)
      return dataJour >= lundi && dataJour <= domingo
    })
  }
  const joursSemanaAnterior = getJoursSemanaOffset(semaine - 1)
  const totalBiSemana = totalService + joursSemanaAnterior.reduce((a, j) => a + (['TRAB', 'DEC'].includes(j.type) ? (j.segServico || 0) : 0), 0)
  const MAX_BI = 90 * 3600
  const pctBiSemana = Math.min((totalBiSemana / MAX_BI) * 100, 100)
  const barColorBi = pctBiSemana > 90 ? '#e74c3c' : pctBiSemana > 80 ? '#f39c12' : '#27ae60'
  const parseDate = (j: Jour) => {
    const p = j.date.split('/')
    const ano = p[2] ? parseInt(p[2]) : new Date(parseInt(j.id)).getFullYear()
    return new Date(ano, parseInt(p[1]) - 1, parseInt(p[0])).getTime()
  }
  const jornatasOrdenadas = [...historique]
    .filter(j => j.type === 'TRAB' || j.type === 'DEC')
    .filter(j => !(j.segServico < 120))
    .sort((a, b) => parseDate(a) - parseDate(b))
  const reposInsuficientes: { jour: string, date: string, gap: number, niveau: 'illegal' | 'reduit' }[] = []
  for (let i = 0; i < jornatasOrdenadas.length - 1; i++) {
    const hoje = jornatasOrdenadas[i]
    const amanha = jornatasOrdenadas[i + 1]
    const [hF, mF] = (hoje.fin || '00h00').replace('h', ':').split(':').map(Number)
    const [hD, mD] = (amanha.debut || '00h00').replace('h', ':').split(':').map(Number)
    const pF = hoje.date.split('/'), pD = amanha.date.split('/')
    const anoF = pF[2] ? parseInt(pF[2]) : new Date(parseInt(hoje.id)).getFullYear()
    const anoD = pD[2] ? parseInt(pD[2]) : new Date(parseInt(amanha.id)).getFullYear()
    const tFim   = new Date(anoF, parseInt(pF[1])-1, parseInt(pF[0]), hF || 0, mF || 0).getTime()
    const tDebut = new Date(anoD, parseInt(pD[1])-1, parseInt(pD[0]), hD || 0, mD || 0).getTime()
    const gapH = (tDebut - tFim) / 3600000
    if (gapH > 0 && gapH < 9) {
      reposInsuficientes.push({ jour: amanha.jour, date: amanha.date, gap: gapH, niveau: 'illegal' })
    } else if (gapH >= 9 && gapH < 11) {
      reposInsuficientes.push({ jour: amanha.jour, date: amanha.date, gap: gapH, niveau: 'reduit' })
    }
  }
  const reposVisiveis = reposInsuficientes.filter(r =>
    joursActuels.some(j => j.date === r.date)
  )
  return (
    <SafeAreaView style={[st.safe, { backgroundColor: c.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await chargerHistorique()
              setRefreshing(false)
            }}
            colors={['#f5a623']}
            tintColor={'#f5a623'}
          />
        }
      >
        <View style={st.header}>
          <TachoLogo textColor={c.text} size={26} />
          <TouchableOpacity onPress={() => { setSemaine(0); setMoisOffset(0) }} style={[st.resetBtn, { backgroundColor: c.navBtn, borderColor: c.navBtnBorder }]}>
            <Text style={[st.resetBtnText, { color: c.textSub }]}>🏠 Aujourd'hui</Text>
          </TouchableOpacity>
        </View>
        <View style={[st.toggleRow, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <TouchableOpacity style={[st.toggleBtn, vue === 'semaine' && st.toggleBtnActive]} onPress={() => setVue('semaine')}>
            <Text style={[st.toggleBtnText, { color: vue === 'semaine' ? 'white' : c.textSub }]}>Semaine</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.toggleBtn, vue === 'mois' && st.toggleBtnActive]} onPress={() => setVue('mois')}>
            <Text style={[st.toggleBtnText, { color: vue === 'mois' ? 'white' : c.textSub }]}>Mois</Text>
          </TouchableOpacity>
        </View>
        <View style={st.semaineNav}>
          <TouchableOpacity style={[st.navBtn, { backgroundColor: c.navBtn, borderColor: c.navBtnBorder }]} onPress={() => vue === 'semaine' ? setSemaine(s => s - 1) : setMoisOffset(m => m - 1)}>
            <Text style={[st.navBtnText, { color: c.text }]}>←</Text>
          </TouchableOpacity>
          <Text style={[st.semaineLabel, { color: c.text }]}>{vue === 'semaine' ? getSemaineLabel() : getMoisLabel()}</Text>
          <TouchableOpacity style={[st.navBtn, { backgroundColor: c.navBtn, borderColor: c.navBtnBorder }]} onPress={() => vue === 'semaine' ? setSemaine(s => s + 1) : setMoisOffset(m => m + 1)}>
            <Text style={[st.navBtnText, { color: c.text }]}>→</Text>
          </TouchableOpacity>
        </View>
        <View style={[st.resumoCard, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <View style={st.resumoAccentBar} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={[st.resumoTitle, { color: c.textLabel, marginBottom: 0 }]}>{vue === 'semaine' ? 'RÉSUMÉ DE LA SEMAINE' : 'RÉSUMÉ DU MOIS'}</Text>
            {vue === 'mois' && (
              <TouchableOpacity
                onPress={() => { setNoteJour(null); setNoteCategoria(''); setNoteEmoji(''); setNoteTexto(''); setShowNoteModal(true) }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(245,166,35,0.15)', borderWidth: 1.5, borderColor: '#f5a623', alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 18, color: '#f5a623', fontWeight: '800', lineHeight: 22 }}>+</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={st.resumoRow}>
            <View style={st.resumoItem}>
              <Text style={[st.resumoVal, { color: c.text }]}>{fmtHM(totalService)}</Text>
              <Text style={[st.resumoLabel, { color: c.textSub }]}>Service</Text>
            </View>
            <View style={[st.resumoDivider, { backgroundColor: c.cardBorder }]} />
            <View style={st.resumoItem}>
              <Text style={[st.resumoVal, { color: '#2980b9' }]}>{nbDecouche}</Text>
              <Text style={[st.resumoLabel, { color: c.textSub }]}>Nuit{nbDecouche > 1 ? 's' : ''}</Text>
            </View>
            <View style={[st.resumoDivider, { backgroundColor: c.cardBorder }]} />
            <View style={st.resumoItem}>
              <Text style={[st.resumoVal, { color: '#27ae60' }]}>{totalFrais.toFixed(2)}€</Text>
              <Text style={[st.resumoLabel, { color: c.textSub }]}>Frais</Text>
            </View>
            <View style={[st.resumoDivider, { backgroundColor: c.cardBorder }]} />
            <View style={st.resumoItem}>
              <Text style={[st.resumoVal, { color: '#2980b9' }]}>{Math.round(totalKm)}</Text>
              <Text style={[st.resumoLabel, { color: c.textSub }]}>km</Text>
            </View>
          </View>
          {vue === 'semaine' && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>SEMAINE</Text>
                <Text style={{ fontSize: 10, color: barColor, fontWeight: '700' }}>{fmtHM(totalService)} / 56h00</Text>
              </View>
              <View style={[st.barraProgressoBg, { backgroundColor: c.progressBg, marginBottom: 10 }]}>
                <View style={[st.barraProgressoFill, { width: `${pctSemaine}%` as any, backgroundColor: barColor }]} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 10, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>2 SEMAINES</Text>
                <Text style={{ fontSize: 10, color: barColorBi, fontWeight: '700' }}>
                  {fmtHM(totalBiSemana)} / 90h00{pctBiSemana > 80 ? ' ⚠️' : ''}
                </Text>
              </View>
              <View style={[st.barraProgressoBg, { backgroundColor: c.progressBg, marginBottom: 12 }]}>
                <View style={[st.barraProgressoFill, { width: `${pctBiSemana}%` as any, backgroundColor: barColorBi }]} />
              </View>
            </>
          )}
          {vue === 'semaine' && (() => {
            const reposReduit = reposVisiveis.filter(r => r.niveau === 'reduit')
            const reposIllegal = reposVisiveis.filter(r => r.niveau === 'illegal')
            const nReduit = reposReduit.length
            const hasAnything = nReduit > 0 || reposIllegal.length > 0
            if (!hasAnything) return null
            return (
              <View style={{ marginBottom: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.cardBorder, gap: 6 }}>
                {nReduit > 0 && (
                  <TouchableOpacity onPress={() => setShowReposDetail(v => !v)} activeOpacity={0.7}
                    style={{ borderLeftWidth: 3, borderLeftColor: nReduit >= 3 ? '#e74c3c' : '#f39c12', backgroundColor: nReduit >= 3 ? 'rgba(231,76,60,0.07)' : 'rgba(243,156,18,0.07)', borderRadius: 6, padding: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: nReduit >= 3 ? '#e74c3c' : '#f39c12' }}>
                        🌙 {nReduit}× repos réduit cette semaine
                      </Text>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: nReduit >= 3 ? '#e74c3c' : '#6b7394' }}>
                        {showReposDetail ? '▲' : '▼'} max 3×
                      </Text>
                    </View>
                    {showReposDetail && (
                      <View style={{ marginTop: 6, gap: 3 }}>
                        {reposReduit.map(r => (
                          <Text key={r.date} style={{ fontSize: 11, color: nReduit >= 3 ? '#e74c3c' : '#f39c12', opacity: 0.85, paddingLeft: 4 }}>
                            • {r.jour} {r.date} — {r.gap.toFixed(1)}h de repos
                          </Text>
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                )}
                {reposIllegal.length > 0 && (
                  <View style={{ flexDirection: 'row', borderLeftWidth: 3, borderLeftColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.07)', borderRadius: 6, padding: 8, gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#e74c3c', marginBottom: 2 }}>🚨 Repos illégal ({'<'}9h)</Text>
                      <Text style={{ fontSize: 10, color: '#e74c3c', opacity: 0.8 }}>
                        {reposIllegal.map(r => `${r.jour} ${r.date.slice(0,5)} — ${r.gap.toFixed(1)}h`).join(' · ')}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: '#e74c3c', lineHeight: 22 }}>{reposIllegal.length}×</Text>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: '#e74c3c', letterSpacing: 0.5 }}>INFRACTION</Text>
                    </View>
                  </View>
                )}
              </View>
            )
          })()}
          <TouchableOpacity
            style={{ backgroundColor: 'rgba(41,128,185,0.12)', borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: '#2980b9', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}
            onPress={() => exportarRelatorio(joursActuels, vue === 'semaine' ? getSemaineLabel() : getMoisLabel())}
          >
            <Text style={{ fontSize: 16 }}>📤</Text>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#2980b9' }}>Partager ce rapport</Text>
          </TouchableOpacity>
        </View>
        {invalidos.length > 0 && (
          <View style={st.avisoBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[st.avisoText, { flex: 1 }]}>⚠️ {invalidos.length} registo{invalidos.length > 1 ? 's' : ''} inválido{invalidos.length > 1 ? 's' : ''} — {invalidos.map(j => j.date).join(', ')}</Text>
              <TouchableOpacity
                style={{ backgroundColor: '#f39c12', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 }}
                onPress={() => {
                  Alert.alert(
                    '🗑️ Supprimer les invalides?',
                    `Supprimer ${invalidos.length} registo${invalidos.length > 1 ? 's' : ''} de moins de 2 minutes?`,
                    [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Supprimer', style: 'destructive', onPress: async () => {
                        const nova = historique.filter(j => !(j.segServico < 120 && (j.type === 'TRAB' || j.type === 'DEC')))
                        setHistorique(nova)
                        await AsyncStorage.setItem('historique', JSON.stringify(nova))
                      }},
                    ]
                  )
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '800', color: 'white' }}>🗑️ Limpar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <Text style={[st.listeTitle, { color: c.textLabel }]}>DÉTAIL DES JOURS</Text>
        {validos.length === 0 ? (
          <View style={st.emptyBox}>
            <Text style={st.emptyIcon}>📭</Text>
            <Text style={[st.emptyText, { color: c.emptyText }]}>Aucun service enregistré</Text>
            <Text style={[st.emptySub, { color: c.emptySub }]}>Les jours terminés apparaîtront ici</Text>
          </View>
        ) : (
          validos.map((jour, idx) => (
            <JourCardSwipeable
              key={jour.id}
              jour={jour}
              themeSombre={themeSombre}
              c={c}
              index={idx}
              onDelete={() => eliminarJour(jour.id)}
              onEdit={() => abrirEdicao(jour)}
              onNote={() => abrirNota(jour)}
            />
          ))
        )}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* MODAL EDIT */}
      <Modal visible={showEdit} transparent animationType="slide">
        <TouchableOpacity activeOpacity={1} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }} onPress={() => setShowEdit(false)}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: c.cardBorder }} onPress={() => {}}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 4, textAlign: 'center' }}>
              ✏️ Modifier le jour
            </Text>
            <Text style={{ fontSize: 14, color: c.textSub, textAlign: 'center', marginBottom: 20 }}>
              {jourEdit?.jour} {jourEdit?.date}
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>DÉBUT</Text>
                <TouchableOpacity
                  style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' }}
                  onPress={() => {
                    const [h, m] = editDebut.replace('h', ':').split(':')
                    const d = new Date()
                    d.setHours(parseInt(h) || 6, parseInt(m) || 0)
                    setTimePickerDate(d)
                    setTimePickerTarget('debut')
                    setShowTimePicker(true)
                  }}
                >
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{editDebut}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>FIN</Text>
                <TouchableOpacity
                  style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' }}
                  onPress={() => {
                    const [h, m] = editFin.replace('h', ':').split(':')
                    const d = new Date()
                    d.setHours(parseInt(h) || 17, parseInt(m) || 0)
                    setTimePickerDate(d)
                    setTimePickerTarget('fin')
                    setShowTimePicker(true)
                  }}
                >
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{editFin}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>PAUSE</Text>
                <TouchableOpacity
                  style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#f39c12', alignItems: 'center' }}
                  onPress={() => setShowPausaPicker(true)}
                >
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#f39c12' }}>
                    {editPausaMin === 0 ? '⏸ Sem pausa' : `⏸ ${editPausaMin >= 60 ? `${Math.floor(editPausaMin/60)}h${String(editPausaMin%60).padStart(2,'0')}` : `${editPausaMin}min`}`}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>SERVICE</Text>
                <View style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#27ae60', alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#27ae60' }}>
                    {fmtHM(calcServicoDe(editDebut, editFin, editPausaMin))}
                  </Text>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>KM DÉBUT</Text>
                <TextInput
                  style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: c.cardBorder, fontSize: 16, fontWeight: '700', color: c.text, textAlign: 'center' }}
                  value={editKmInicio}
                  onChangeText={setEditKmInicio}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={c.textSub}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>KM FIN</Text>
                <TextInput
                  style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: c.cardBorder, fontSize: 16, fontWeight: '700', color: c.text, textAlign: 'center' }}
                  value={editKmFim}
                  onChangeText={setEditKmFim}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={c.textSub}
                />
              </View>
            </View>
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>KM DU JOUR</Text>
              <TextInput
                style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#2980b9', fontSize: 16, fontWeight: '700', color: '#2980b9', textAlign: 'center' }}
                value={editKm}
                onChangeText={setEditKm}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={c.textSub}
              />
            </View>
            <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 8, fontWeight: '600' }}>TYPE DE JOUR</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {(Object.keys(TYPE_CONFIG) as JourType[]).map(t => (
                <TouchableOpacity
                  key={t}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: editType === t ? TYPE_CONFIG[t].color : c.cardBorder, backgroundColor: editType === t ? TYPE_CONFIG[t].bg : 'transparent' }}
                  onPress={() => setEditType(t)}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: editType === t ? TYPE_CONFIG[t].color : c.textSub }}>
                    {TYPE_CONFIG[t].emoji} {TYPE_CONFIG[t].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}
                onPress={() => { setShowEdit(false); setJourEdit(null) }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 12, padding: 14, alignItems: 'center' }}
                onPress={guardarEdicao}
              >
                <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>✅ Sauvegarder</Text>
              </TouchableOpacity>
            </View>
            {showTimePicker && (
              <DateTimePicker
                value={timePickerDate}
                mode="time"
                is24Hour={true}
                display="clock"
                onChange={(event, date) => {
                  setShowTimePicker(false)
                  if (event.type === 'dismissed' || !date) return
                  const h = String(date.getHours()).padStart(2, '0')
                  const m = String(date.getMinutes()).padStart(2, '0')
                  const valor = `${h}h${m}`
                  if (timePickerTarget === 'debut') setEditDebut(valor)
                  else setEditFin(valor)
                }}
              />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* PAUSE PICKER MODAL */}
      <Modal visible={showPausaPicker} transparent animationType="slide">
        <TouchableOpacity activeOpacity={1} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }} onPress={() => setShowPausaPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: c.cardBorder }} onPress={() => {}}>
            <Text style={{ fontSize: 13, color: '#f39c12', fontWeight: '800', letterSpacing: 2, textAlign: 'center', marginBottom: 4 }}>⏸ PAUSE</Text>
            <Text style={{ fontSize: 42, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 20 }}>
              {editPausaMin === 0 ? '—' : editPausaMin >= 60
                ? `${Math.floor(editPausaMin/60)}h${String(editPausaMin%60).padStart(2,'0')}`
                : `${editPausaMin}min`}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              {[15, 20, 30, 45, 60, 75, 90, 120, 150, 180].map(min => (
                <TouchableOpacity
                  key={min}
                  style={{ borderRadius: 12, borderWidth: 2, borderColor: editPausaMin === min ? '#f39c12' : c.cardBorder, backgroundColor: editPausaMin === min ? 'rgba(243,156,18,0.12)' : 'transparent', paddingHorizontal: 16, paddingVertical: 10 }}
                  onPress={() => setEditPausaMin(min)}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: editPausaMin === min ? '#f39c12' : c.textSub }}>
                    {min >= 60 ? `${Math.floor(min/60)}h${min%60 > 0 ? String(min%60).padStart(2,'0') : '00'}` : `${min}min`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={{ borderRadius: 12, borderWidth: 1.5, borderColor: '#e74c3c', padding: 12, alignItems: 'center', marginBottom: 16 }}
              onPress={() => setEditPausaMin(0)}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#e74c3c' }}>✕ Sem pausa</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#f5a623', borderRadius: 14, padding: 16, alignItems: 'center' }}
              onPress={() => setShowPausaPicker(false)}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>✓ Confirmar</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* NOTE MODAL */}
      <Modal visible={showNoteModal} transparent animationType="slide">
        <TouchableOpacity activeOpacity={1} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }} onPress={() => { setShowNoteModal(false); setNoteJour(null) }}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: c.cardBorder }} onPress={() => {}}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 4 }}>📝 Note du jour</Text>
            {noteJour ? (
              <Text style={{ fontSize: 13, color: c.textSub, textAlign: 'center', marginBottom: 16 }}>{noteJour.jour} {noteJour.date}</Text>
            ) : (
              <TouchableOpacity
                onPress={() => setShowNotaDatePicker(true)}
                style={{ backgroundColor: c.input, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#f5a623', alignItems: 'center', marginBottom: 16 }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#f5a623' }}>
                  📅 {notaDataSel || 'Choisir le jour'}
                </Text>
              </TouchableOpacity>
            )}
            {showNotaDatePicker && (
              <DateTimePicker
                value={(() => {
                  if (notaDataSel) {
                    const [d, m, y] = notaDataSel.split('/').map(Number)
                    return new Date(y, m - 1, d)
                  }
                  return new Date()
                })()}
                mode="date"
                display="calendar"
                onChange={(event, date) => {
                  setShowNotaDatePicker(false)
                  if (event.type === 'dismissed' || !date) return
                  const d = String(date.getDate()).padStart(2, '0')
                  const m = String(date.getMonth() + 1).padStart(2, '0')
                  const y = date.getFullYear()
                  setNotaDataSel(`${d}/${m}/${y}`)
                }}
              />
            )}
            <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 8, fontWeight: '600' }}>CATÉGORIE</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {[
                { emoji: '🔋', label: 'Batterie' },
                { emoji: '👮', label: 'Contrôle' },
                { emoji: '🔧', label: 'Panne' },
                { emoji: '📦', label: 'Chargement' },
                { emoji: '📚', label: 'Formation' },
                { emoji: '📌', label: 'Autre' },
              ].map(cat => (
                <TouchableOpacity
                  key={cat.label}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: noteCategoria === cat.label ? '#f5a623' : c.cardBorder, backgroundColor: noteCategoria === cat.label ? 'rgba(245,166,35,0.12)' : 'transparent' }}
                  onPress={() => { setNoteCategoria(cat.label); setNoteEmoji(cat.emoji) }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: noteCategoria === cat.label ? '#f5a623' : c.textSub }}>{cat.emoji} {cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 8, fontWeight: '600' }}>COMMENTAIRE (optionnel)</Text>
            <TextInput
              style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: c.cardBorder, fontSize: 14, color: c.text, minHeight: 72, textAlignVertical: 'top', marginBottom: 16 }}
              value={noteTexto}
              onChangeText={setNoteTexto}
              placeholder="Ajouter un commentaire..."
              placeholderTextColor={c.textSub}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => { setShowNoteModal(false); setNoteJour(null) }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.textSub }}>Annuler</Text>
              </TouchableOpacity>
              {noteCategoria ? (
                <TouchableOpacity style={{ flex: 2, backgroundColor: '#f5a623', borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={guardarNota}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>✅ Sauvegarder</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={{ flex: 2, backgroundColor: '#e74c3c', borderRadius: 12, padding: 14, alignItems: 'center' }} onPress={async () => {
                  const nova = historique.map(j => j.id === noteJour?.id ? { ...j, nota: undefined } : j)
                  setHistorique(nova)
                  await AsyncStorage.setItem('historique', JSON.stringify(nova))
                  setShowNoteModal(false); setNoteJour(null)
                }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: 'white' }}>🗑️ Supprimer la note</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  )
}
const st = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 16 },
  appName: { fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  accent: { color: '#f5a623' },
  resetBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  resetBtnText: { fontSize: 14, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 16, borderRadius: 12, borderWidth: 1, padding: 4 },
  toggleBtn: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 10 },
  toggleBtnActive: { backgroundColor: '#f5a623' },
  toggleBtnText: { fontSize: 13, fontWeight: '700' },
  semaineNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 16 },
  navBtn: { borderRadius: 10, padding: 10, borderWidth: 1 },
  navBtnText: { fontSize: 16, fontWeight: '700' },
  semaineLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 1, textAlign: 'center', flex: 1 },
  resumoCard: { marginHorizontal: 20, marginBottom: 16, borderRadius: 16, borderWidth: 1, padding: 16, overflow: 'hidden' },
  resumoAccentBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#f5a623' },
  resumoTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 3, marginBottom: 12 },
  resumoRow: { flexDirection: 'row', marginBottom: 12 },
  resumoItem: { flex: 1, alignItems: 'center' },
  resumoDivider: { width: 1 },
  resumoVal: { fontSize: 20, fontWeight: '800' },
  resumoLabel: { fontSize: 13, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  barraProgressoBg: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 12 },
  barraProgressoFill: { height: '100%', borderRadius: 3 },
  exportBtn: { backgroundColor: '#f5a623', borderRadius: 10, padding: 12, alignItems: 'center' },
  exportBtnText: { fontSize: 13, fontWeight: '800', color: 'white' },
  avisoBox: { marginHorizontal: 20, marginBottom: 10, backgroundColor: 'rgba(243,156,18,0.1)', borderWidth: 1, borderColor: '#f39c12', borderRadius: 10, padding: 10 },
  avisoText: { fontSize: 14, color: '#f39c12', fontWeight: '600' },
  listeTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 3, marginHorizontal: 20, marginBottom: 10 },
  emptyBox: { alignItems: 'center', padding: 40, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 15, fontWeight: '700' },
  emptySub: { fontSize: 14, textAlign: 'center' },
  jourCard: { borderRadius: 14, borderWidth: 1 },
  jourHeader: { flexDirection: 'row', alignItems: 'stretch', gap: 0 },
  jourDateBox: { width: 68, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', gap: 1 },
  jourDayName: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  jourDayNum: { fontSize: 28, fontWeight: '800', lineHeight: 32 },
  jourMonth: { fontSize: 11, fontWeight: '600', letterSpacing: 1 },
  jourDurLine: { width: 28, height: 1, marginVertical: 6 },
  jourInfo: { flex: 1, paddingVertical: 12, paddingHorizontal: 10, gap: 6 },
  jourTypeBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  jourTypeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  jourTimesRow: { flexDirection: 'row', gap: 14 },
  jourTimeBlock: { gap: 1 },
  jourTimeLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  jourTimeVal: { fontSize: 15, fontWeight: '800' },
  jourAmpServiceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -2 },
  jourAmplitudeText: { fontSize: 11, fontWeight: '700', color: '#2980b9' },
  jourAmpSep: { fontSize: 10, fontWeight: '600', opacity: 0.5 },
  jourServiceText: { fontSize: 11, fontWeight: '800', color: '#f39c12' },
  jourPauseText: { fontSize: 11, fontWeight: '600' },
  jourReposText: { fontSize: 12 },
  jourFrais: { paddingVertical: 12, paddingHorizontal: 10, alignItems: 'flex-end', justifyContent: 'space-between' },
  jourFraisLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  jourFraisVal: { fontSize: 16, fontWeight: '800' },
  deleteBg: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#e74c3c', borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 20, gap: 8 },
  deleteIcon: { fontSize: 20 },
  deleteText: { fontSize: 13, fontWeight: '800', color: 'white' },
  swipeHint: { fontSize: 10, marginTop: 2, opacity: 0.6 },
  editHint: { fontSize: 11, opacity: 0.7 },
})