import React, { useState, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet, Modal, Alert, TextInput, Image } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useTheme } from '../../context/ThemeContext'
import { useLangue } from '../../context/LangueContext'
import { getDiasRestantes, getDataExpiracao } from '../../src/trial'
import { pedirPermissaoNotificacoes, cancelarTodosAlertas, agendarRappelSaisie, cancelarRappelSaisie } from '../../src/notifications'

// Chaves a exportar/importar
const BACKUP_KEYS = [
  'historique',
  'monSalaire_v2',
  'monSalaire_padrao',
  'frais_valores',
  'frais_regles',
  'sal_settings',
  'profil',
]

export default function ReglagesScreen() {
  const { themeSombre, toggleTheme } = useTheme()
  const { langue, setLangue, t } = useLangue()
  const [profil, setProfil] = useState<'CD' | 'MIXTE' | 'LD'>('MIXTE')
  const [notifications, setNotifications] = useState(true)
  const [showModalHistorique, setShowModalHistorique] = useState(false)
  const [showModalReset, setShowModalReset] = useState(false)
  const [showModalSucesso, setShowModalSucesso] = useState(false)
  const [modalSucessoMsg, setModalSucessoMsg] = useState('')
  const [showModalImport, setShowModalImport] = useState(false)
  const [importData, setImportData] = useState<any>(null)
  const [loadingExport, setLoadingExport] = useState(false)
  const [loadingImport, setLoadingImport] = useState(false)
  const [diasTrial, setDiasTrial] = useState<number | null>(null)
  const [dataExpiracao, setDataExpiracao] = useState<Date | null>(null)
  const [rappelAtivo, setRappelAtivo] = useState(true)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [modoDecrescente, setModoDecrescente] = useState(false)
  const [modeTest, setModeTest] = useState(false)
  const [tracteurType, setTracteurType] = useState<'immat' | 'parc'>('immat')
  const [tracteurValue, setTracteurValue] = useState('')
  const [remorqueType, setRemorqueType] = useState<'immat' | 'parc'>('immat')
  const [remorqueValue, setRemorqueValue] = useState('')
  const [transportFrigo, setTransportFrigo] = useState(false)
  const [transportGrue, setTransportGrue] = useState(false)
  const [transportAdr, setTransportAdr] = useState(false)
  const [transportBenne, setTransportBenne] = useState(false)
  const [transportCiterne, setTransportCiterne] = useState(false)
  const [transportPlateau, setTransportPlateau] = useState(false)
  const [transportGrumier, setTransportGrumier] = useState(false)
  const [transportOpen, setTransportOpen] = useState(false)
  const [ficheEntrepriseUri, setFicheEntrepriseUri] = useState<string | null>(null)
  const [showRapportModal, setShowRapportModal] = useState(false)
  const [rapportData, setRapportData] = useState<any[] | null>(null)
  const [loadingRapport, setLoadingRapport] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem('profil').then(p => {
      if (p === 'CD' || p === 'MIXTE' || p === 'LD') setProfil(p)
    })
    getDiasRestantes().then(setDiasTrial)
    getDataExpiracao().then(setDataExpiracao)
    AsyncStorage.getItem('notificacoes_ativas').then(v => {
      if (v !== null) setNotifications(v === 'true')
    })
    AsyncStorage.getItem('rappel_saisie_ativo').then(v => {
      const ativo = v !== 'false'
      setRappelAtivo(ativo)
    })
    AsyncStorage.getItem('modoTacho').then(v => {
      setModoDecrescente(v === 'decrescente')
    })
    AsyncStorage.getItem('mode_test').then(v => setModeTest(v === 'true'))
    AsyncStorage.getItem('tracteur_type').then(v => { if (v === 'immat' || v === 'parc') setTracteurType(v) })
    AsyncStorage.getItem('tracteur_value').then(v => { if (v) setTracteurValue(v) })
    AsyncStorage.getItem('remorque_type').then(v => { if (v === 'immat' || v === 'parc') setRemorqueType(v) })
    AsyncStorage.getItem('remorque_value').then(v => { if (v) setRemorqueValue(v) })
    AsyncStorage.getItem('transport_frigo').then(v => setTransportFrigo(v === 'true'))
    AsyncStorage.getItem('transport_grue').then(v => setTransportGrue(v === 'true'))
    AsyncStorage.getItem('transport_adr').then(v => setTransportAdr(v === 'true'))
    AsyncStorage.getItem('transport_benne').then(v => setTransportBenne(v === 'true'))
    AsyncStorage.getItem('transport_citerne').then(v => setTransportCiterne(v === 'true'))
    AsyncStorage.getItem('transport_plateau').then(v => setTransportPlateau(v === 'true'))
    AsyncStorage.getItem('transport_grumier').then(v => setTransportGrumier(v === 'true'))
    AsyncStorage.getItem('fiche_entreprise_uri').then(v => { if (v) setFicheEntrepriseUri(v) })
  }, [])

  const importerFicheEntreprise = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    })
    if (result.canceled || !result.assets?.length) return
    const uri = result.assets[0].uri
    setFicheEntrepriseUri(uri)
    await AsyncStorage.setItem('fiche_entreprise_uri', uri)
  }

  const supprimerFicheEntreprise = async () => {
    setFicheEntrepriseUri(null)
    await AsyncStorage.removeItem('fiche_entreprise_uri')
  }

  const fmtHM = (seg: number) => {
    const h = Math.floor(seg / 3600)
    const m = Math.floor((seg % 3600) / 60)
    return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}`
  }

  const genererRapportSemaine = async () => {
    setLoadingRapport(true)
    try {
      const raw = await AsyncStorage.getItem('historique')
      const historique: any[] = raw ? JSON.parse(raw) : []

      // Determine Monday and Sunday of current week
      const today = new Date()
      const dayOfWeek = (today.getDay() + 6) % 7 // Mon=0 … Sun=6
      const monday = new Date(today)
      monday.setDate(today.getDate() - dayOfWeek)
      monday.setHours(0, 0, 0, 0)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      sunday.setHours(23, 59, 59, 999)

      const parseJourDate = (dateStr: string): Date | null => {
        const parts = dateStr.split('/')
        if (parts.length === 3) {
          return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]))
        } else if (parts.length === 2) {
          const d = new Date()
          d.setMonth(parseInt(parts[1]) - 1, parseInt(parts[0]))
          d.setHours(0, 0, 0, 0)
          return d
        }
        return null
      }

      const semaine = historique.filter(j => {
        const d = parseJourDate(j.date || '')
        return d && d >= monday && d <= sunday
      }).sort((a, b) => {
        const da = parseJourDate(a.date)
        const db = parseJourDate(b.date)
        return (da?.getTime() ?? 0) - (db?.getTime() ?? 0)
      })

      setRapportData(semaine)
      setShowRapportModal(true)
    } catch {}
    setLoadingRapport(false)
  }

  const exporterRapport = async (jours: any[]) => {
    try {
      const today = new Date()
      const dayOfWeek = (today.getDay() + 6) % 7
      const monday = new Date(today)
      monday.setDate(today.getDate() - dayOfWeek)
      const lundi = `${String(monday.getDate()).padStart(2, '0')}/${String(monday.getMonth() + 1).padStart(2, '0')}/${monday.getFullYear()}`

      let texte = `RAPPORT SEMAINE — ${lundi}\n`
      texte += `${'─'.repeat(40)}\n`
      let totalSeg = 0, totalFrais = 0, totalKm = 0
      for (const j of jours) {
        const typeEmoji = j.type === 'TRAB' ? '💼' : j.type === 'DEC' ? '🌙' : j.type === 'FER' ? '🎉' : j.type === 'FERIE' ? '🏖️' : j.type === 'RC' ? '🔄' : '❌'
        texte += `${typeEmoji} ${j.jour} ${j.date}\n`
        if (j.debut && j.fin) texte += `   ${j.debut} → ${j.fin}\n`
        if (j.segServico > 0) texte += `   Service : ${fmtHM(j.segServico)}\n`
        if (j.frais > 0) texte += `   Frais   : ${j.frais.toFixed(2)}€\n`
        if (j.kmDiarios > 0) texte += `   KM      : ${j.kmDiarios} km\n`
        texte += '\n'
        if (['TRAB', 'DEC'].includes(j.type)) totalSeg += j.segServico || 0
        totalFrais += j.frais || 0
        totalKm += j.kmDiarios || 0
      }
      texte += `${'─'.repeat(40)}\n`
      texte += `TOTAL SERVICE : ${fmtHM(totalSeg)}\n`
      texte += `TOTAL FRAIS   : ${totalFrais.toFixed(2)}€\n`
      if (totalKm > 0) texte += `TOTAL KM      : ${totalKm} km\n`

      const filename = `rapport_semaine_${lundi.replace(/\//g, '-')}.txt`
      const path = `${FileSystem.documentDirectory}${filename}`
      await FileSystem.writeAsStringAsync(path, texte, { encoding: FileSystem.EncodingType.UTF8 })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: 'Exporter le rapport' })
      }
    } catch (e) {
      Alert.alert('Erreur', "Impossible d'exporter le rapport.")
    }
  }

  const apagaHistorique = async () => {
    await AsyncStorage.removeItem('historique')
    setShowModalHistorique(false)
    setModalSucessoMsg("✅ Historique effacé\nTon historique a été supprimé.")
    setTimeout(() => setShowModalSucesso(true), 300)
  }

  const apagaTudo = async () => {
    await AsyncStorage.clear()
    setShowModalReset(false)
    setModalSucessoMsg("✅ App réinitialisée\nRedémarre l'app pour recommencer.")
    setTimeout(() => setShowModalSucesso(true), 300)
  }

  // EXPORTAR — gera JSON com todos os dados
  const exportarDados = async () => {
    setLoadingExport(true)
    try {
      const backup: any = {
        version: 'tachooffice-v1',
        exportedAt: new Date().toISOString(),
        data: {}
      }

      for (const key of BACKUP_KEYS) {
        const val = await AsyncStorage.getItem(key)
        if (val) {
        try { backup.data[key] = JSON.parse(val) } catch { backup.data[key] = val }
      }
      }

      const json = JSON.stringify(backup, null, 2)
      const date = new Date().toISOString().slice(0, 10)
      const filename = `tachooffice_backup_${date}.json`
      const path = `${FileSystem.documentDirectory}${filename}`

      await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 })

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/json',
          dialogTitle: 'Sauvegarder TachoOffice',
          UTI: 'public.json',
        })
      } else {
        setModalSucessoMsg(`✅ Backup créé!\n${filename}`)
        setShowModalSucesso(true)
      }
    } catch (e) {
      setModalSucessoMsg('❌ Erreur lors de l\'export.\n' + String(e))
      setShowModalSucesso(true)
    }
    setLoadingExport(false)
  }

  // IMPORTAR — lê JSON e restaura dados
  const importarDados = async () => {
    setLoadingImport(true)
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      })

      if (result.canceled) { setLoadingImport(false); return }

      const file = result.assets[0]
      const content = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 })
      const backup = JSON.parse(content)

      // Validar formato
      if (!backup.data || !backup.version) {
        setModalSucessoMsg('❌ Fichier invalide.\nCe fichier ne semble pas être un backup TachoOffice.')
        setShowModalSucesso(true)
        setLoadingImport(false)
        return
      }

      // Contar dados
      const nJours = backup.data.historique?.length || 0
      const nFiches = backup.data.monSalaire_v2?.length || 0

      setImportData({ backup, nJours, nFiches })
      setShowModalImport(true)
    } catch (e) {
      setModalSucessoMsg('❌ Erreur lors de l\'import.\n' + String(e))
      setShowModalSucesso(true)
    }
    setLoadingImport(false)
  }

  const confirmarImport = async () => {
    if (!importData) return
    setShowModalImport(false)
    try {
      const { backup } = importData
      for (const [key, val] of Object.entries(backup.data)) {
        await AsyncStorage.setItem(key, JSON.stringify(val))
      }
      setModalSucessoMsg(`✅ Import réussi!\n${importData.nJours} jours · ${importData.nFiches} fiches importés.\n\nRedémarre l'app pour voir tes données.`)
      setTimeout(() => setShowModalSucesso(true), 300)
    } catch (e) {
      setModalSucessoMsg('❌ Erreur lors de l\'import.\n' + String(e))
      setShowModalSucesso(true)
    }
    setImportData(null)
  }

  const c = {
    bg: themeSombre ? '#0f1117' : '#f0f2f8',
    card: themeSombre ? '#181c27' : '#ffffff',
    cardBorder: themeSombre ? '#2a3045' : '#d0d5e8',
    text: themeSombre ? '#eef0f5' : '#1a1f35',
    textSub: themeSombre ? '#6b7394' : '#555e80',
    textLabel: themeSombre ? '#6b7394' : '#3a4060',
    infoBox: themeSombre ? '#0f1117' : '#e8eaf2',
    profilBtnBg: themeSombre ? '#1f2436' : '#e8eaf2',
    profilBtnBorder: themeSombre ? '#2a3045' : '#c0c5d8',
    profilBtnText: themeSombre ? '#6b7394' : '#3a4060',
    langueBtn: themeSombre ? '#1f2436' : '#e8eaf2',
    langueBtnBorder: themeSombre ? '#2a3045' : '#c0c5d8',
    divider: themeSombre ? '#2a3045' : '#d0d5e8',
    dangerText: themeSombre ? '#eef0f5' : '#1a1f35',
    dangerSub: themeSombre ? '#6b7394' : '#555e80',
    version: themeSombre ? '#2a3045' : '#9096b0',
  }

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: c.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        <View style={st.header}>
          <Text style={[st.appName, { color: c.text }]}>
            TACHO<Text style={st.accent}>MAX</Text>
          </Text>
        </View>

        <View style={st.titleSection}>
          <Text style={[st.title, { color: c.text }]}>{t.reglages}</Text>
        </View>

        {/* PROFIL */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>{t.monProfil}</Text>
          <Text style={[st.label, { color: c.textLabel }]}>{t.typeConducteur}</Text>
          <View style={st.profilRow}>
            {(['CD', 'MIXTE', 'LD'] as const).map(p => (
              <TouchableOpacity
                key={p}
                style={[st.profilBtn, { backgroundColor: c.profilBtnBg, borderColor: c.profilBtnBorder }, profil === p && st.profilBtnActive]}
                onPress={async () => { setProfil(p); await AsyncStorage.setItem('profil', p) }}
              >
                <Text style={[st.profilBtnText, { color: profil === p ? '#f5a623' : c.profilBtnText }]}>
                  {p === 'CD' ? '🏠 CD' : p === 'MIXTE' ? '🔄 Mixte' : '🛣️ LD'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={[st.infoBox, { backgroundColor: c.infoBox }]}>
            <Text style={[st.infoText, { color: c.textSub }]}>
              {profil === 'CD' && '🏠 Courte Distance — tu rentres à la maison tous les jours'}
              {profil === 'MIXTE' && '🔄 Mixte — surtout local, découché occasionnel'}
              {profil === 'LD' && '🛣️ Longue Distance — découché toute la semaine'}
            </Text>
          </View>
        </View>

        {/* TRACTEUR */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>🚛 TRACTEUR</Text>
          <View style={{ flexDirection: 'row', marginBottom: 12, gap: 8 }}>
            <TouchableOpacity
              onPress={async () => { setTracteurType('immat'); await AsyncStorage.setItem('tracteur_type', 'immat') }}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: tracteurType === 'immat' ? '#f5a623' : c.infoBox, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: tracteurType === 'immat' ? '#fff' : c.textSub }}>Immatriculation</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => { setTracteurType('parc'); await AsyncStorage.setItem('tracteur_type', 'parc') }}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: tracteurType === 'parc' ? '#f5a623' : c.infoBox, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: tracteurType === 'parc' ? '#fff' : c.textSub }}>Numéro de parc</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            value={tracteurValue}
            onChangeText={async (v) => {
              setTracteurValue(v)
              await AsyncStorage.setItem('tracteur_value', v)
            }}
            placeholder={tracteurType === 'immat' ? 'ex: AB-123-CD' : 'ex: T042'}
            placeholderTextColor={c.textSub}
            autoCapitalize="characters"
            style={{ backgroundColor: c.infoBox, borderRadius: 10, padding: 12, color: c.text, fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: c.cardBorder }}
          />
        </View>

        {/* SEMI-REMORQUE */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>🔗 SEMI-REMORQUE</Text>
          <View style={{ flexDirection: 'row', marginBottom: 12, gap: 8 }}>
            <TouchableOpacity
              onPress={async () => { setRemorqueType('immat'); await AsyncStorage.setItem('remorque_type', 'immat') }}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: remorqueType === 'immat' ? '#f5a623' : c.infoBox, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: remorqueType === 'immat' ? '#fff' : c.textSub }}>Immatriculation</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => { setRemorqueType('parc'); await AsyncStorage.setItem('remorque_type', 'parc') }}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: remorqueType === 'parc' ? '#f5a623' : c.infoBox, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: remorqueType === 'parc' ? '#fff' : c.textSub }}>Numéro de parc</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            value={remorqueValue}
            onChangeText={async (v) => {
              setRemorqueValue(v)
              await AsyncStorage.setItem('remorque_value', v)
            }}
            placeholder={remorqueType === 'immat' ? 'ex: AB-123-CD' : 'ex: AP2'}
            placeholderTextColor={c.textSub}
            autoCapitalize="characters"
            style={{ backgroundColor: c.infoBox, borderRadius: 10, padding: 12, color: c.text, fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: c.cardBorder }}
          />
        </View>

        {/* TYPE DE TRANSPORT — accordion */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <TouchableOpacity onPress={() => setTransportOpen(!transportOpen)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[st.sectionTitle, { color: c.textLabel, marginBottom: 0 }]}>
              {transportFrigo ? '❄️' : transportGrue ? '🏗️' : transportAdr ? '⚠️' : transportBenne ? '🪣' : transportCiterne ? '🚽' : transportPlateau ? '📦' : transportGrumier ? '🌲' : '🚛'}{' '}
              {transportFrigo ? 'Frigorifique' : transportGrue ? 'Grue / Ampliroll' : transportAdr ? 'ADR' : transportBenne ? 'Benne' : transportCiterne ? 'Citerne' : transportPlateau ? 'Plateau' : transportGrumier ? 'Grumier' : 'Normal'}
            </Text>
            <Text style={{ fontSize: 14, color: c.textSub, fontWeight: '700' }}>{transportOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {transportOpen && (
            <View style={{ marginTop: 14 }}>
              <View style={[st.settingRow, { opacity: 0.5 }]}>
                <Text style={[st.settingLabel, { color: c.text }]}>🚛 Normal</Text>
                <Switch value={true} disabled trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>❄️ Frigorifique</Text>
                <Switch value={transportFrigo} onValueChange={async (v) => { setTransportFrigo(v); await AsyncStorage.setItem('transport_frigo', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🏗️ Grue / Ampliroll</Text>
                <Switch value={transportGrue} onValueChange={async (v) => { setTransportGrue(v); await AsyncStorage.setItem('transport_grue', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>⚠️ ADR — Matières dangereuses</Text>
                <Switch value={transportAdr} onValueChange={async (v) => { setTransportAdr(v); await AsyncStorage.setItem('transport_adr', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#e74c3c' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🪣 Benne</Text>
                <Switch value={transportBenne} onValueChange={async (v) => { setTransportBenne(v); await AsyncStorage.setItem('transport_benne', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🚽 Citerne</Text>
                <Switch value={transportCiterne} onValueChange={async (v) => { setTransportCiterne(v); await AsyncStorage.setItem('transport_citerne', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>📦 Plateau</Text>
                <Switch value={transportPlateau} onValueChange={async (v) => { setTransportPlateau(v); await AsyncStorage.setItem('transport_plateau', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🌲 Grumier</Text>
                <Switch value={transportGrumier} onValueChange={async (v) => { setTransportGrumier(v); await AsyncStorage.setItem('transport_grumier', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
            </View>
          )}
        </View>

        {/* MA FICHE ENTREPRISE */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>MA FICHE ENTREPRISE</Text>
          <Text style={[st.settingSub, { color: c.textSub, marginBottom: 14 }]}>
            Digitalise la fiche vierge de ton entreprise pour générer automatiquement ton rapport hebdomadaire
          </Text>

          {/* Status indicator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: ficheEntrepriseUri ? '#27ae60' : '#f5a623' }}>
              {ficheEntrepriseUri ? '✅ Fiche configurée' : '⚠️ Aucune fiche'}
            </Text>
          </View>

          {/* Thumbnail preview + delete */}
          {ficheEntrepriseUri && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <Image
                source={{ uri: ficheEntrepriseUri }}
                style={{ width: 72, height: 100, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder }}
                resizeMode="cover"
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.text, fontWeight: '600', marginBottom: 6 }}>Fiche importée</Text>
                <TouchableOpacity
                  onPress={supprimerFicheEntreprise}
                  style={{ backgroundColor: 'rgba(231,76,60,0.1)', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e74c3c', alignSelf: 'flex-start' }}
                >
                  <Text style={{ fontSize: 12, color: '#e74c3c', fontWeight: '700' }}>🗑️ Supprimer</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Import button */}
          <TouchableOpacity
            style={[st.backupBtn, { backgroundColor: 'rgba(245,166,35,0.08)', borderColor: '#f5a623', marginBottom: 10 }]}
            onPress={importerFicheEntreprise}
          >
            <Text style={{ fontSize: 22 }}>📄</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#f5a623' }}>
                {ficheEntrepriseUri ? 'Remplacer la fiche vierge' : 'Importer fiche vierge'}
              </Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 2 }}>JPG · PNG depuis ta galerie</Text>
            </View>
          </TouchableOpacity>

          {/* Generate rapport button */}
          <TouchableOpacity
            style={[st.backupBtn, { backgroundColor: 'rgba(39,174,96,0.08)', borderColor: '#27ae60' }]}
            onPress={genererRapportSemaine}
            disabled={loadingRapport}
          >
            <Text style={{ fontSize: 22 }}>📊</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#27ae60' }}>
                {loadingRapport ? 'Chargement...' : 'Générer rapport semaine'}
              </Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 2 }}>Résumé hebdomadaire · export PDF</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* APPARENCE */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>{t.apparence}</Text>
          <View style={st.settingRow}>
            <View>
              <Text style={[st.settingLabel, { color: c.text }]}>{t.modeSombre}</Text>
              <Text style={[st.settingSub, { color: c.textSub }]}>{t.themeFonce}</Text>
            </View>
            <Switch value={themeSombre} onValueChange={toggleTheme} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
          </View>
          <View style={[st.divider, { backgroundColor: c.divider }]} />
          <View style={st.settingRow}>
            <Text style={[st.settingLabel, { color: c.text }]}>⏱ Chrono décroissant</Text>
            <Switch
              value={modoDecrescente}
              onValueChange={async (valor) => {
                setModoDecrescente(valor)
                await AsyncStorage.setItem('modoTacho', valor ? 'decrescente' : 'crescente')
              }}
              trackColor={{ false: '#d0d5e8', true: '#f5a623' }}
              thumbColor="white"
            />
          </View>
          <View style={[st.divider, { backgroundColor: c.divider }]} />
          <Text style={[st.label, { color: c.textLabel, marginBottom: 10 }]}>{t.langue}</Text>
          <View style={st.langueRow}>
            <TouchableOpacity
              style={[st.langueBtn, { backgroundColor: c.langueBtn, borderColor: langue === 'fr' ? '#f5a623' : c.langueBtnBorder }, langue === 'fr' && st.langueBtnActive]}
              onPress={() => setLangue('fr')}
            >
              <Text style={[st.langueBtnText, { color: langue === 'fr' ? '#f5a623' : c.text }]}>🇫🇷 Français</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.langueBtn, { backgroundColor: c.langueBtn, borderColor: langue === 'pt' ? '#f5a623' : c.langueBtnBorder }, langue === 'pt' && st.langueBtnActive]}
              onPress={() => setLangue('pt')}
            >
              <Text style={[st.langueBtnText, { color: langue === 'pt' ? '#f5a623' : c.text }]}>🇵🇹 Português</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* MODE TEST */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>DÉVELOPPEMENT</Text>
          <View style={st.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={[st.settingLabel, { color: c.text }]}>🧪 Mode test</Text>
              <Text style={[st.settingSub, { color: c.textSub }]}>Affiche le bouton « Stop conduite » pour tests sans polluer les données</Text>
            </View>
            <Switch
              value={modeTest}
              onValueChange={async (valor) => {
                setModeTest(valor)
                await AsyncStorage.setItem('mode_test', String(valor))
              }}
              trackColor={{ false: '#d0d5e8', true: '#9b59b6' }}
              thumbColor="white"
            />
          </View>
        </View>

        {/* NOTIFICATIONS */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>{t.notifications}</Text>
          <View style={st.settingRow}>
            <View>
              <Text style={[st.settingLabel, { color: c.text }]}>{t.alertesPause}</Text>
              <Text style={[st.settingSub, { color: c.textSub }]}>{t.rappelPause}</Text>
            </View>
            <Switch
              value={notifications}
              onValueChange={async (valor) => {
                if (valor) {
                  const ok = await pedirPermissaoNotificacoes()
                  if (!ok) {
                    Alert.alert(
                      'Notifications désactivées',
                      'Active les notifications pour TachoOffice dans les Paramètres de ton téléphone.',
                      [{ text: 'OK' }]
                    )
                    return
                  }
                } else {
                  await cancelarTodosAlertas()
                }
                setNotifications(valor)
                await AsyncStorage.setItem('notificacoes_ativas', String(valor))
              }}
              trackColor={{ false: '#d0d5e8', true: '#f5a623' }}
              thumbColor="white"
            />
          </View>

          <View style={[st.settingRow, { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.cardBorder }]}>
            <View style={{ flex: 1 }}>
              <Text style={[st.settingLabel, { color: c.text }]}>📋 Rappel de saisie</Text>
              <Text style={[st.settingSub, { color: c.textSub }]}>Rappel quotidien à 20h si tu n'as pas enregistré ta journée</Text>
            </View>
            <Switch
              value={rappelAtivo}
              onValueChange={async (valor) => {
                setRappelAtivo(valor)
                await AsyncStorage.setItem('rappel_saisie_ativo', String(valor))
                if (valor) {
                  const ok = await pedirPermissaoNotificacoes()
                  if (ok) await agendarRappelSaisie(20, 0)
                } else {
                  await cancelarRappelSaisie()
                }
              }}
              trackColor={{ false: '#d0d5e8', true: '#f5a623' }}
              thumbColor="white"
            />
          </View>
        </View>

        {/* LECTEUR TACHYGRAPHE */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>LECTEUR TACHYGRAPHE</Text>
          <Text style={[st.settingSub, { color: c.textSub }]}>Connecte un lecteur Bluetooth pour importer automatiquement les données de ta carte conducteur</Text>
          <TouchableOpacity style={[st.leitoresBtn, { backgroundColor: c.profilBtnBg, borderColor: c.cardBorder }]}>
            <Text style={st.leitoresBtnText}>📡 Voir les appareils recommandés</Text>
          </TouchableOpacity>
        </View>

        {/* ABONNEMENT */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>{t.abonnement}</Text>
          {diasTrial !== null && diasTrial > 0 ? (
            <>
              <View style={st.trialBox}>
                <Text style={st.trialDays}>{diasTrial}</Text>
                <Text style={[st.trialLabel, { color: c.textSub }]}>{t.joursEssai}</Text>
                {dataExpiracao && (
                  <Text style={{ fontSize: 13, color: c.textSub, marginTop: 4 }}>
                    Expire le {dataExpiracao.getDate()}/{String(dataExpiracao.getMonth() + 1).padStart(2, '0')}/{dataExpiracao.getFullYear()}
                  </Text>
                )}
              </View>
              <TouchableOpacity style={st.subscribeBtn}>
                <Text style={st.subscribeBtnText}>{t.sabonner}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={[st.trialBox, { backgroundColor: 'rgba(231,76,60,0.08)', borderRadius: 12, padding: 16 }]}>
                <Text style={{ fontSize: 36, marginBottom: 4 }}>⏰</Text>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#e74c3c', textAlign: 'center' }}>
                  Essai terminé
                </Text>
                <Text style={{ fontSize: 13, color: c.textSub, marginTop: 4, textAlign: 'center' }}>
                  Abonne-toi pour continuer à utiliser TachoOffice
                </Text>
              </View>
              <TouchableOpacity style={[st.subscribeBtn, { backgroundColor: '#e74c3c' }]}>
                <Text style={st.subscribeBtnText}>🔓 S'abonner — 2,99€/mois</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* SAUVEGARDE */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>🔒 SAUVEGARDE</Text>

          <TouchableOpacity
            style={[st.backupBtn, { backgroundColor: 'rgba(39,174,96,0.1)', borderColor: '#27ae60' }]}
            onPress={exportarDados}
            disabled={loadingExport}
          >
            <Text style={{ fontSize: 22 }}>📤</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#27ae60' }}>
                {loadingExport ? 'Export en cours...' : '💾 Sauvegarder mes données'}
              </Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 2 }}>
                Pour changer de téléphone ou réinstaller l'app
              </Text>
            </View>
          </TouchableOpacity>

          <View style={{ height: 10 }} />

          <TouchableOpacity
            style={[st.backupBtn, { backgroundColor: 'rgba(41,128,185,0.1)', borderColor: '#2980b9' }]}
            onPress={importarDados}
            disabled={loadingImport}
          >
            <Text style={{ fontSize: 22 }}>📥</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#2980b9' }}>
                {loadingImport ? 'Import en cours...' : '📥 Restaurer depuis une sauvegarde'}
              </Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 2 }}>
                Récupère tout ton historique et tes réglages
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* DADOS */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>{t.mesDonnees}</Text>
          <TouchableOpacity style={st.btnDanger} onPress={() => setShowModalHistorique(true)}>
            <Text style={st.btnDangerIcon}>🗑️</Text>
            <View>
              <Text style={[st.btnDangerText, { color: c.dangerText }]}>{t.effacerHistorique}</Text>
              <Text style={[st.btnDangerSub, { color: c.dangerSub }]}>{t.supprimeTousJours}</Text>
            </View>
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: c.divider }]} />
          <TouchableOpacity style={st.btnDangerRed} onPress={() => setShowModalReset(true)}>
            <Text style={st.btnDangerIcon}>⚠️</Text>
            <View>
              <Text style={[st.btnDangerText, { color: '#e74c3c' }]}>{t.reinitialiserApp}</Text>
              <Text style={[st.btnDangerSub, { color: c.dangerSub }]}>{t.effaceToutesDonnees}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* LÉGAL */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>LÉGAL</Text>
          <TouchableOpacity
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }}
            onPress={() => setShowPrivacy(true)}
          >
            <Text style={[st.settingLabel, { color: c.text }]}>🔒 Politique de confidentialité</Text>
            <Text style={{ color: c.textSub, fontSize: 16 }}>›</Text>
          </TouchableOpacity>
          <View style={{ height: 1, backgroundColor: c.cardBorder }} />
          <View style={{ paddingVertical: 12 }}>
            <Text style={[st.settingLabel, { color: c.text }]}>📦 Version</Text>
            <Text style={[st.settingSub, { color: c.textSub, marginTop: 2 }]}>TachoOffice v1.0.0 — Bruno Pereira Da Veiga</Text>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* MODAL PRIVACY POLICY */}
      <Modal visible={showPrivacy} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: c.cardBorder, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: c.text }}>🔒 Politique de confidentialité</Text>
              <TouchableOpacity onPress={() => setShowPrivacy(false)}>
                <Text style={{ fontSize: 22, color: c.textSub }}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[
                { titre: 'Données collectées', texte: 'TachoOffice stocke uniquement les données que tu saisis toi-même : heures de service, types de journée, frais professionnels et paramètres de l\'app. Aucune donnée n\'est envoyée vers des serveurs externes.' },
                { titre: 'Stockage local', texte: 'Toutes tes données sont conservées localement sur ton appareil via AsyncStorage. Elles ne quittent jamais ton téléphone sauf si tu utilises la fonction d\'export manuel.' },
                { titre: 'Localisation GPS', texte: 'L\'accès à la localisation est utilisé uniquement pour calculer les kilomètres parcourus pendant ton service. Les coordonnées GPS ne sont jamais enregistrées ni transmises.' },
                { titre: 'Intelligence artificielle', texte: 'La fonctionnalité de lecture de fiche de paie utilise l\'API Anthropic Claude. Les images que tu envoies sont traitées par Anthropic conformément à leur politique de confidentialité (anthropic.com/privacy). Aucune image n\'est conservée par TachoOffice.' },
                { titre: 'Notifications', texte: 'Les alertes (pause obligatoire, amplitude, rappel de saisie) sont gérées localement par ton appareil. Aucune notification n\'est envoyée depuis un serveur externe.' },
                { titre: 'Pas de publicité', texte: 'TachoOffice ne contient aucune publicité et ne partage aucune donnée avec des tiers à des fins commerciales.' },
                { titre: 'Contact', texte: 'Pour toute question concernant tes données : brunoveiga854@gmail.com' },
              ].map(item => (
                <View key={item.titre} style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: '#f5a623', marginBottom: 4, letterSpacing: 0.5 }}>{item.titre.toUpperCase()}</Text>
                  <Text style={{ fontSize: 13, color: c.textSub, lineHeight: 20 }}>{item.texte}</Text>
                </View>
              ))}
              <Text style={{ fontSize: 12, color: c.textSub, textAlign: 'center', marginTop: 8 }}>Dernière mise à jour : Mai 2025</Text>
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL CONFIRMAR IMPORT */}
      <Modal visible={showModalImport} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, marginBottom: 16 }} />
              <Text style={{ fontSize: 40, marginBottom: 8 }}>📥</Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center' }}>Importer ce backup?</Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
                Ce backup contient:{'\n'}
                <Text style={{ color: '#27ae60', fontWeight: '700' }}>✅ {importData?.nJours} jours d'historique{'\n'}</Text>
                <Text style={{ color: '#2980b9', fontWeight: '700' }}>✅ {importData?.nFiches} fiches de paye</Text>
              </Text>
              <View style={{ backgroundColor: 'rgba(231,76,60,0.1)', borderRadius: 10, padding: 10, marginTop: 12, borderWidth: 1, borderColor: '#e74c3c' }}>
                <Text style={{ fontSize: 14, color: '#e74c3c', textAlign: 'center', fontWeight: '600' }}>
                  ⚠️ Tes données actuelles seront remplacées.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={{ backgroundColor: '#2980b9', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 10 }}
              onPress={confirmarImport}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>📥 Importer quand même</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}
              onPress={() => { setShowModalImport(false); setImportData(null) }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textSub }}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL EFFACER HISTORIQUE */}
      <Modal visible={showModalHistorique} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, marginBottom: 16 }} />
              <Text style={{ fontSize: 40, marginBottom: 8 }}>🗑️</Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center' }}>{t.effacerHistorique}</Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
                Tous tes jours enregistrés seront supprimés.{'\n'}Cette action est irréversible.
              </Text>
            </View>
            <TouchableOpacity style={{ backgroundColor: '#e74c3c', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 10 }} onPress={apagaHistorique}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>🗑️ Effacer l'historique</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowModalHistorique(false)}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textSub }}>{t.annuler}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL RÉINITIALISER */}
      <Modal visible={showModalReset} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder }}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, marginBottom: 16 }} />
              <Text style={{ fontSize: 40, marginBottom: 8 }}>⚠️</Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#e74c3c', textAlign: 'center' }}>{t.reinitialiserApp}</Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
                Toutes tes données seront supprimées.{'\n'}Historique, fiches de paie, réglages.{'\n'}Cette action est irréversible.
              </Text>
            </View>
            <TouchableOpacity style={{ backgroundColor: '#e74c3c', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 10 }} onPress={apagaTudo}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>⚠️ Réinitialiser l'app</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }} onPress={() => setShowModalReset(false)}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textSub }}>{t.annuler}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL RAPPORT SEMAINE */}
      <Modal visible={showRapportModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: c.cardBorder, maxHeight: '88%' }}>
            <View style={{ alignItems: 'center', marginBottom: 4 }}>
              <View style={{ width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, marginBottom: 16 }} />
              <Text style={{ fontSize: 20, fontWeight: '800', color: c.text }}>📊 Rapport semaine</Text>
            </View>

            {(() => {
              const jours = rapportData || []
              const totalSeg = jours.filter(j => ['TRAB', 'DEC'].includes(j.type)).reduce((a: number, j: any) => a + (j.segServico || 0), 0)
              const totalFrais = jours.reduce((a: number, j: any) => a + (j.frais || 0), 0)
              const totalKm = jours.reduce((a: number, j: any) => a + (j.kmDiarios || 0), 0)
              return (
                <>
                  {/* Summary bar */}
                  <View style={{ flexDirection: 'row', gap: 8, marginVertical: 16 }}>
                    <View style={{ flex: 1, backgroundColor: c.infoBox, borderRadius: 12, padding: 10, alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>SERVICE</Text>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: '#f5a623', marginTop: 2 }}>{fmtHM(totalSeg)}</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: c.infoBox, borderRadius: 12, padding: 10, alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>FRAIS</Text>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: '#27ae60', marginTop: 2 }}>{totalFrais.toFixed(0)}€</Text>
                    </View>
                    {totalKm > 0 && (
                      <View style={{ flex: 1, backgroundColor: c.infoBox, borderRadius: 12, padding: 10, alignItems: 'center' }}>
                        <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700', letterSpacing: 1 }}>KM</Text>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: '#2980b9', marginTop: 2 }}>{totalKm}</Text>
                      </View>
                    )}
                  </View>

                  {/* Day list */}
                  <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                    {jours.length === 0 ? (
                      <Text style={{ color: c.textSub, textAlign: 'center', paddingVertical: 24, fontSize: 14 }}>
                        Aucun service enregistré cette semaine
                      </Text>
                    ) : jours.map((j: any, i: number) => {
                      const typeColor = j.type === 'TRAB' ? '#27ae60' : j.type === 'DEC' ? '#2980b9' : j.type === 'FER' ? '#f39c12' : j.type === 'FERIE' ? '#9b59b6' : j.type === 'RC' ? '#1abc9c' : '#6b7394'
                      const typeEmoji = j.type === 'TRAB' ? '💼' : j.type === 'DEC' ? '🌙' : j.type === 'FER' ? '🎉' : j.type === 'FERIE' ? '🏖️' : j.type === 'RC' ? '🔄' : '❌'
                      return (
                        <View key={j.id || i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder }}>
                          <Text style={{ fontSize: 20, marginRight: 10 }}>{typeEmoji}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: typeColor }}>{j.jour} {j.date}</Text>
                            {j.debut && j.fin && (
                              <Text style={{ fontSize: 12, color: c.textSub, marginTop: 1 }}>{j.debut} → {j.fin}</Text>
                            )}
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            {j.segServico > 0 && (
                              <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>{fmtHM(j.segServico)}</Text>
                            )}
                            {j.frais > 0 && (
                              <Text style={{ fontSize: 12, color: '#27ae60' }}>{j.frais.toFixed(2)}€</Text>
                            )}
                          </View>
                        </View>
                      )
                    })}
                  </ScrollView>

                  {/* Actions */}
                  <View style={{ marginTop: 16, gap: 10 }}>
                    <TouchableOpacity
                      style={{ backgroundColor: '#2980b9', borderRadius: 16, padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                      onPress={() => exporterRapport(jours)}
                    >
                      <Text style={{ fontSize: 16 }}>📤</Text>
                      <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>Exporter / Partager</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}
                      onPress={() => setShowRapportModal(false)}
                    >
                      <Text style={{ fontSize: 15, fontWeight: '700', color: c.textSub }}>Fermer</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )
            })()}
          </View>
        </View>
      </Modal>

      {/* MODAL SUCESSO */}
      <Modal visible={showModalSucesso} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 40 }}>
          <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder }}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>✅</Text>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text, textAlign: 'center', lineHeight: 24 }}>{modalSucessoMsg}</Text>
            <TouchableOpacity style={{ backgroundColor: '#f5a623', borderRadius: 16, padding: 14, alignItems: 'center', marginTop: 20, width: '100%' }} onPress={() => setShowModalSucesso(false)}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: 'white' }}>OK</Text>
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
  titleSection: { paddingHorizontal: 20, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800' },
  section: { marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderRadius: 16, padding: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 3, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  profilRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  profilBtn: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  profilBtnActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.1)' },
  profilBtnText: { fontSize: 14, fontWeight: '700' },
  infoBox: { borderRadius: 10, padding: 10 },
  infoText: { fontSize: 14, lineHeight: 18 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingLabel: { fontSize: 14, fontWeight: '600' },
  settingSub: { fontSize: 13, marginTop: 2 },
  divider: { height: 1, marginVertical: 14 },
  langueRow: { flexDirection: 'row', gap: 10 },
  langueBtn: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
  langueBtnActive: { backgroundColor: 'rgba(245,166,35,0.1)' },
  langueBtnText: { fontSize: 13, fontWeight: '700' },
  leitoresBtn: { marginTop: 12, borderWidth: 1, borderRadius: 10, padding: 14, alignItems: 'center' },
  leitoresBtnText: { fontSize: 13, fontWeight: '700', color: '#f5a623' },
  trialBox: { alignItems: 'center', paddingVertical: 16 },
  trialDays: { fontSize: 48, fontWeight: '800', color: '#f5a623' },
  trialLabel: { fontSize: 13, marginTop: 4 },
  subscribeBtn: { backgroundColor: '#f5a623', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  subscribeBtnText: { fontSize: 15, fontWeight: '800', color: 'white', letterSpacing: 1 },
  backupBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 14 },
  btnDanger: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 4 },
  btnDangerRed: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 4 },
  btnDangerIcon: { fontSize: 24 },
  btnDangerText: { fontSize: 14, fontWeight: '700' },
  btnDangerSub: { fontSize: 13, marginTop: 2 },
  version: { textAlign: 'center', fontSize: 13, marginBottom: 8, marginTop: 8 },
})