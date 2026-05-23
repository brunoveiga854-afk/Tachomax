import DateTimePicker from '@react-native-community/datetimepicker'
import React, { useCallback, useState, useRef } from 'react'
import { useFocusEffect } from 'expo-router'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Share, Alert, Modal, TextInput, PanResponder, Animated } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../context/ThemeContext'

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
}

const TYPE_CONFIG: Record<JourType, { label: string, color: string, bg: string, bgLight: string, emoji: string }> = {
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

const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const MAX_SEMAINE = 56 * 3600

function JourCardSwipeable({ jour, themeSombre, c, onDelete, onEdit, index }: {
  jour: Jour, themeSombre: boolean, c: any, onDelete: () => void, onEdit: () => void, index: number
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
  const bgBox = themeSombre ? cfg.bg : cfg.bgLight

  return (
    <View style={{ marginHorizontal: 20, marginBottom: 8 }}>
      <View style={[st.deleteBg]}>
        <Text style={st.deleteIcon}>🗑️</Text>
        <Text style={st.deleteText}>Supprimer</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <TouchableOpacity activeOpacity={0.85} onPress={onEdit}>
          <View style={[st.jourCard, { backgroundColor: c.card, borderColor: cfg.color + '40' }]}>
            <View style={st.jourHeader}>
              <View style={[st.jourDateBox, { backgroundColor: bgBox }]}>
                <Text style={[st.jourDuracao, { color: cfg.color }]}>{fmtHM(jour.segServico)}</Text>
                <Text style={[st.jourDate, { color: cfg.color }]}>{jour.jour}</Text>
                <Text style={[st.jourDateNum, { color: c.textSub }]}>{jour.date}</Text>
              </View>
              <View style={st.jourInfo}>
                <View style={st.jourInfoRow}>
                  <Text style={[st.jourInfoLabel, { color: c.textSub }]}>Début</Text>
                  <Text style={[st.jourInfoVal, { color: c.text }]}>{jour.debut}</Text>
                  <Text style={[st.jourInfoLabel, { color: c.textSub }]}>Fin</Text>
                  <Text style={[st.jourInfoVal, { color: c.text }]}>{jour.fin}</Text>
                </View>
                {temPausa && (
                  <View style={st.jourInfoRow}>
                    <Text style={[st.jourInfoLabel, { color: c.textSub }]}>Pauses</Text>
                    <Text style={[st.jourInfoVal, { color: '#f39c12' }]}>{fmtHM(jour.segPausa)}</Text>
                  </View>
                )}
                {index === 0 && <Text style={[st.swipeHint, { color: c.textSub }]}>glisse pour supprimer →</Text>}
              </View>
              <View style={st.jourFrais}>
                {jour.frais > 0 && (
                  <Text style={[st.jourFraisVal, { color: '#27ae60' }]}>+{jour.frais.toFixed(2)}€</Text>
                )}
                <View style={[st.jourTypeBadge, { backgroundColor: bgBox }]}>
                  <Text style={[st.jourTypeText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
                <Text style={[st.editHint, { color: c.textSub }]}>✏️ modifier</Text>
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
  const [moisOffset, setMoisOffset] = useState(0)
  const [jourEdit, setJourEdit] = useState<Jour | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [editDebut, setEditDebut] = useState('')
  const [editFin, setEditFin] = useState('')
  const [editDecouche, setEditDecouche] = useState(false)
  const [editType, setEditType] = useState<JourType>('TRAB')
  const [editFrais, setEditFrais] = useState('')
  const [editServico, setEditServico] = useState('')
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [timePickerTarget, setTimePickerTarget] = useState<'debut' | 'fin'>('debut')
  const [timePickerDate, setTimePickerDate] = useState(new Date())

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
    const d = new Date()
    d.setMonth(d.getMonth() + moisOffset)
    return `${MOIS[d.getMonth()]} ${d.getFullYear()}`
  }

  const getJoursMois = () => {
    const d = new Date()
    d.setMonth(d.getMonth() + moisOffset)
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
    const totalService = jours.reduce((a, j) => a + (j.segServico || 0), 0)
    const totalPauses = jours.reduce((a, j) => a + (j.segPausa || 0), 0)
    const totalFrais = jours.reduce((a, j) => a + (j.frais || 0), 0)
    const nbDecouche = jours.filter(j => j.decouche).length
    const nbTrab = jours.filter(j => j.type === 'TRAB' || j.type === 'DEC').length
    let texte = `🚛 TACHOMAX — Rapport ${label}\n`
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
    texte += `\n${'─'.repeat(30)}\nGénéré par TachoMax`
    await Share.share({ message: texte, title: `Rapport TachoMax ${label}` })
  }

  const eliminarJour = async (id: string) => {
    const nova = historique.filter(j => j.id !== id)
    setHistorique(nova)
    await AsyncStorage.setItem('historique', JSON.stringify(nova))
  }

  const abrirEdicao = (jour: Jour) => {
    setJourEdit(jour)
    setEditDebut(jour.debut)
    setEditFin(jour.fin)
    setEditDecouche(jour.decouche)
    setEditType(jour.type)
    setEditFrais(jour.frais.toFixed(2))
    setEditServico(fmtHM(jour.segServico))
    setShowEdit(true)
  }

const calcularFraisEdicao = (debut: string, fin: string, servico: string, type: JourType) => {
    const [hS, mS] = servico.replace('h', ':').split(':').map(Number)
    const servicoMin = hS * 60 + (mS || 0)
    const isDecouche = type === 'DEC'
    if (isDecouche) return 68.66
    if (servicoMin >= 6 * 60) return 20.78
    if (servicoMin >= 5 * 60) return 16.36
    return 4.42
  }

  const guardarEdicao = async () => {
    if (!jourEdit) return
    const horasMin = editServico.replace('h', ':').split(':')
    const novoSeg = (parseInt(horasMin[0]) * 3600) + ((parseInt(horasMin[1]) || 0) * 60)
    const fraisCalculado = calcularFraisEdicao(editDebut, editFin, editServico, editType)
    const jourAtualizado: Jour = {
      ...jourEdit,
      debut: editDebut,
      fin: editFin,
      decouche: editType === 'DEC',
      type: editType,
      frais: fraisCalculado,
      segServico: novoSeg,
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
  const totalService = joursActuels.reduce((a, j) => a + (j.segServico || 0), 0)
  const totalFrais = joursActuels.reduce((a, j) => a + (j.frais || 0), 0)
  const nbDecouche = joursActuels.filter(j => j.decouche).length
  const pctSemaine = Math.min((totalService / MAX_SEMAINE) * 100, 100)
  const barColor = pctSemaine > 90 ? '#e74c3c' : pctSemaine > 75 ? '#f39c12' : '#27ae60'
  const invalidos = joursActuels.filter(j => j.segServico < 120 && (j.type === 'TRAB' || j.type === 'DEC'))
  const validos = joursActuels.filter(j => !(j.segServico < 120 && (j.type === 'TRAB' || j.type === 'DEC')))

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        <View style={st.header}>
          <Text style={[st.appName, { color: c.text }]}>TACHO<Text style={st.accent}>MAX</Text></Text>
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
          <Text style={[st.resumoTitle, { color: c.textLabel }]}>{vue === 'semaine' ? 'RÉSUMÉ DE LA SEMAINE' : 'RÉSUMÉ DU MOIS'}</Text>
          <View style={st.resumoRow}>
            <View style={st.resumoItem}>
              <Text style={[st.resumoVal, { color: c.text }]}>{fmtHM(totalService)}</Text>
              <Text style={[st.resumoLabel, { color: c.textSub }]}>Service</Text>
            </View>
            <View style={[st.resumoDivider, { backgroundColor: c.cardBorder }]} />
            <View style={st.resumoItem}>
              <Text style={[st.resumoVal, { color: '#2980b9' }]}>{nbDecouche}</Text>
              <Text style={[st.resumoLabel, { color: c.textSub }]}>Découché{nbDecouche > 1 ? 's' : ''}</Text>
            </View>
            <View style={[st.resumoDivider, { backgroundColor: c.cardBorder }]} />
            <View style={st.resumoItem}>
              <Text style={[st.resumoVal, { color: '#27ae60' }]}>{totalFrais.toFixed(2)}€</Text>
              <Text style={[st.resumoLabel, { color: c.textSub }]}>Frais</Text>
            </View>
          </View>
          {vue === 'semaine' && (
            <View style={[st.barraProgressoBg, { backgroundColor: c.progressBg }]}>
              <View style={[st.barraProgressoFill, { width: `${pctSemaine}%` as any, backgroundColor: barColor }]} />
            </View>
          )}
          <TouchableOpacity style={st.exportBtn} onPress={() => exportarRelatorio(joursActuels, vue === 'semaine' ? getSemaineLabel() : getMoisLabel())}>
            <Text style={st.exportBtnText}>📤 Exporter le rapport</Text>
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
            />
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal visible={showEdit} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
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
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>SERVICE (ex: 08h30)</Text>
                <TextInput
                  style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, fontSize: 16, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }}
                  value={editServico}
                  onChangeText={setEditServico}
                  placeholder="08h00"
                  placeholderTextColor={c.textSub}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.textSub, marginBottom: 6, fontWeight: '600' }}>FRAIS (€)</Text>
                <TextInput
                  style={{ backgroundColor: c.input, borderRadius: 10, padding: 12, fontSize: 16, fontWeight: '700', color: c.text, borderWidth: 1, borderColor: c.cardBorder, textAlign: 'center' }}
                  value={editFrais}
                  onChangeText={setEditFrais}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={c.textSub}
                />
              </View>
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
  jourCard: { borderRadius: 14, borderWidth: 1, padding: 12 },
  jourHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  jourDateBox: { width: 72, borderRadius: 10, padding: 8, alignItems: 'center' },
  jourDuracao: { fontSize: 15, fontWeight: '800', letterSpacing: -0.5 },
  jourDate: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  jourDateNum: { fontSize: 11, marginTop: 1 },
  jourInfo: { flex: 1, gap: 4 },
  jourInfoRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  jourInfoLabel: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
  jourInfoVal: { fontSize: 14, fontWeight: '600' },
  jourFrais: { alignItems: 'flex-end', gap: 4 },
  jourFraisVal: { fontSize: 13, fontWeight: '800' },
  jourTypeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  jourTypeText: { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  deleteBg: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#e74c3c', borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 20, gap: 8 },
  deleteIcon: { fontSize: 20 },
  deleteText: { fontSize: 13, fontWeight: '800', color: 'white' },
  swipeHint: { fontSize: 14, marginTop: 2, opacity: 0.85 },
  editHint: { fontSize: 14, marginTop: 2, opacity: 0.85 },
})