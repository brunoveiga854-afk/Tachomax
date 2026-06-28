import { TachoLogo } from '../../src/TachoLogo'
import React, { useState, useEffect, useRef } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet, Modal, Alert, TextInput, Image, Share, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router, useLocalSearchParams } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useTheme } from '../../context/ThemeContext'
import { useLangue } from '../../context/LangueContext'
import { useApp } from '../../context/AppContext'
import { getDiasRestantes, getDataExpiracao } from '../../src/trial'
import { pedirPermissaoNotificacoes, cancelarTodosAlertas, agendarRappelSaisie, cancelarRappelSaisie } from '../../src/notifications'

// Chaves a exportar/importar
const BACKUP_KEYS = [
  'historique',
]

const BACKUP_KEYS_COMPLETO = [
  'historique', 'monSalaire_v2', 'monSalaire_padrao',
  'frais_valores', 'frais_regles', 'sal_settings', 'profil',
]

export default function ReglagesScreen() {
  const { themeSombre, toggleTheme } = useTheme()
  const { langue, setLangue, t } = useLangue()
  const { recarregarApp, actualizarCampo } = useApp()
  const [profil, setProfil] = useState<'CD' | 'MIXTE' | 'LD'>('MIXTE')
  const [conducteurPrenom, setConducteurPrenom] = useState('')
  const [conducteurNom, setConducteurNom] = useState('')
  const [showNomModal, setShowNomModal] = useState(false)
  const [editPrenom, setEditPrenom] = useState('')
  const [editNom, setEditNom] = useState('')
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
  const [tracteurType, setTracteurType] = useState<'immat' | 'parc'>('immat')
  const [tracteurValue, setTracteurValue] = useState('')
  const [kmTracteurActuel, setKmTracteurActuel] = useState('')
  const [remorqueType, setRemorqueType] = useState<'immat' | 'parc'>('immat')
  const [remorqueValue, setRemorqueValue] = useState('')
  const [transportFrigo, setTransportFrigo] = useState(false)
  const [transportGrue, setTransportGrue] = useState(false)
  const [transportAdr, setTransportAdr] = useState(false)
  const [transportBenne, setTransportBenne] = useState(false)
  const [transportCiterne, setTransportCiterne] = useState(false)
  const [transportPlateau, setTransportPlateau] = useState(false)
  const [transportGrumier, setTransportGrumier] = useState(false)
  const [equipChariot, setEquipChariot] = useState(false)
  const [equipHayon, setEquipHayon] = useState(false)
  const [equipGrueAux, setEquipGrueAux] = useState(false)
  const [transportOpen, setTransportOpen] = useState(false)

  // Novos — secção escondida + campos obrigatórios
  const [versionTapCount, setVersionTapCount] = useState(0)
  const [secretUnlocked, setSecretUnlocked] = useState(false)
  const [camposOk, setCamposOk] = useState({ profil: true, hbase: true, hval: true, km: true })
  const scrollViewRef = useRef<import('react-native').ScrollView>(null)
  const salaireSectionY = useRef(0)
  const scrolledToSalaire = useRef(false)
  const { scrollTo: scrollToParam } = useLocalSearchParams<{ scrollTo?: string }>()

  // Verifica os 4 campos obrigatórios e persiste o estado
  const atualizarCamposOk = async () => {
    const pSalvo = await AsyncStorage.getItem('profil')
    const padData = await AsyncStorage.getItem('monSalaire_padrao')
    const kmRaw = await AsyncStorage.getItem('km_ultimo_fim')
    let hbase = 0, hval = 0
    if (padData) { try { const p = JSON.parse(padData); hbase = p.hbase || 0; hval = p.hval || 0 } catch {} }
    const novosCampos = {
      profil: !!pSalvo,
      hbase: hbase > 0,
      hval: hval > 0,
      km: parseFloat(kmRaw || '') > 0,
    }
    setCamposOk(novosCampos)
    const allOk = novosCampos.profil && novosCampos.hbase && novosCampos.hval  // km não é obrigatório para estimativa
    await AsyncStorage.setItem('campos_obrigatorios_ok', allOk ? 'true' : 'false')
    actualizarCampo('camposObrigatoriosOk', allOk)
  }

  useEffect(() => {
    AsyncStorage.getItem('profil').then(p => {
      if (p === 'CD' || p === 'MIXTE' || p === 'LD') setProfil(p)
    })
    AsyncStorage.getItem('conducteur_prenom').then(v => { if (v) setConducteurPrenom(v) })
    AsyncStorage.getItem('conducteur_nom').then(v => { if (v) setConducteurNom(v) })
    getDiasRestantes().then(setDiasTrial)
    getDataExpiracao().then(setDataExpiracao)
    AsyncStorage.getItem('notificacoes_ativas').then(v => {
      if (v !== null) setNotifications(v === 'true')
    })

    AsyncStorage.getItem('rappel_saisie_ativo').then(v => {
      const ativo = v !== 'false'
      setRappelAtivo(ativo)
    })
    AsyncStorage.getItem('tracteur_type').then(v => { if (v === 'immat' || v === 'parc') setTracteurType(v) })
    AsyncStorage.getItem('tracteur_value').then(v => { if (v) setTracteurValue(v) })
    AsyncStorage.getItem('km_ultimo_fim').then(v => { if (v && parseFloat(v) > 0) setKmTracteurActuel(v) })
    AsyncStorage.getItem('remorque_type').then(v => { if (v === 'immat' || v === 'parc') setRemorqueType(v) })
    AsyncStorage.getItem('remorque_value').then(v => { if (v) setRemorqueValue(v) })
    AsyncStorage.getItem('transport_frigo').then(v => setTransportFrigo(v === 'true'))
    AsyncStorage.getItem('transport_grue').then(v => setTransportGrue(v === 'true'))
    AsyncStorage.getItem('transport_adr').then(v => setTransportAdr(v === 'true'))
    AsyncStorage.getItem('transport_benne').then(v => setTransportBenne(v === 'true'))
    AsyncStorage.getItem('transport_citerne').then(v => setTransportCiterne(v === 'true'))
    AsyncStorage.getItem('transport_plateau').then(v => setTransportPlateau(v === 'true'))
    AsyncStorage.getItem('transport_grumier').then(v => setTransportGrumier(v === 'true'))
    AsyncStorage.getItem('equipement_chariot').then(v => setEquipChariot(v === 'true'))
    AsyncStorage.getItem('equipement_hayon').then(v => setEquipHayon(v === 'true'))
    AsyncStorage.getItem('equipement_grue_aux').then(v => setEquipGrueAux(v === 'true'))
    atualizarCamposOk()
  }, [])

  // Scroll auto jusqu'à Paramètres Salaire si param scrollTo=salaire
  useEffect(() => {
    if (scrollToParam === 'salaire' && salaireSectionY.current > 0 && !scrolledToSalaire.current) {
      scrolledToSalaire.current = true
      setTimeout(() => scrollViewRef.current?.scrollTo({ y: salaireSectionY.current, animated: true }), 350)
    }
  }, [scrollToParam])

  const fmtHM = (seg: number) => {
    const h = Math.floor(seg / 3600)
    const m = Math.floor((seg % 3600) / 60)
    return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}`
  }

  const apagaHistorique = async () => {
    await AsyncStorage.removeItem('historique')
    setShowModalHistorique(false)
    setModalSucessoMsg("✅ Historique effacé\nTon historique a été supprimé.")
    setTimeout(() => setShowModalSucesso(true), 300)
  }

  const criarBackupSilencioso = async (): Promise<string | null> => {
    try {
      const backup: any = { version: 'tachooffice-v1', exportedAt: new Date().toISOString(), data: {} }
      const allKeys = await AsyncStorage.getAllKeys()
      for (const key of allKeys) {
        const val = await AsyncStorage.getItem(key)
        if (val) { try { backup.data[key] = JSON.parse(val) } catch { backup.data[key] = val } }
      }
      const date = new Date().toISOString().slice(0, 10)
      const filename = `tachooffice_backup_avant_reset_${date}.json`
      const path = `${FileSystem.documentDirectory}${filename}`
      await FileSystem.writeAsStringAsync(path, JSON.stringify(backup, null, 2), { encoding: FileSystem.EncodingType.UTF8 })
      return path
    } catch { return null }
  }

  const apagaTudo = async () => {
    const backupPath = await criarBackupSilencioso()
    await AsyncStorage.clear()
    setShowModalReset(false)
    const backupMsg = backupPath
      ? "\n\n💾 Sauvegarde automatique créée avant la réinitialisation."
      : "\n\n⚠️ Impossible de créer la sauvegarde automatique."
    setModalSucessoMsg(`✅ App réinitialisée\nRedémarre l'app pour recommencer.${backupMsg}`)
    setTimeout(() => setShowModalSucesso(true), 300)
  }

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
      setModalSucessoMsg("❌ Erreur lors de l'export.\n" + String(e))
      setShowModalSucesso(true)
    }
    setLoadingExport(false)
  }

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
      if (!backup.data || !backup.version) {
        setModalSucessoMsg('❌ Fichier invalide.\nCe fichier ne semble pas être un backup TachoOffice.')
        setShowModalSucesso(true)
        setLoadingImport(false)
        return
      }
      const nJours = backup.data.historique?.length || 0
      const nFiches = backup.data.monSalaire_v2?.length || 0
      setImportData({ backup, nJours, nFiches })
      setShowModalImport(true)
    } catch (e) {
      setModalSucessoMsg("❌ Erreur lors de l'import.\n" + String(e))
      setShowModalSucesso(true)
    }
    setLoadingImport(false)
  }

  const confirmarImport = async () => {
    if (!importData) return
    setShowModalImport(false)
    try {
      const { backup } = importData
      for (const key of BACKUP_KEYS) {
        if (backup.data[key] !== undefined) {
          await AsyncStorage.setItem(key, JSON.stringify(backup.data[key]))
        }
      }
      await recarregarApp()
      setModalSucessoMsg(`✅ Import réussi!\n${importData.nJours} jours · ${importData.nFiches} fiches importés.\n\nRedémarre l'app pour voir tes données.`)
      setTimeout(() => setShowModalSucesso(true), 300)
    } catch (e) {
      setModalSucessoMsg("❌ Erreur lors de l'import.\n" + String(e))
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

  // Separador visual entre secções
  const SecSep = ({ label }: { label: string }) => (
    <View style={{ marginHorizontal: 20, marginTop: 22, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.divider }} />
      <Text style={{ fontSize: 9, fontWeight: '800', color: c.textSub, letterSpacing: 2, textTransform: 'uppercase' }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: c.divider }} />
    </View>
  )

  // Badge campo obrigatório
  const ReqBadge = () => (
    <View style={{ backgroundColor: '#e74c3c', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginLeft: 6 }}>
      <Text style={{ fontSize: 9, fontWeight: '800', color: 'white', letterSpacing: 0.3 }}>REQUIS</Text>
    </View>
  )

  return (
    <SafeAreaView edges={['top']} style={[st.safe, { backgroundColor: c.bg }]}>
      <ScrollView ref={scrollViewRef} showsVerticalScrollIndicator={false}>

        <View style={st.header}>
          <TachoLogo textColor={c.text} size={26} />
        </View>

        <View style={st.titleSection}>
          <Text style={[st.title, { color: c.text }]}>{t.reglages}</Text>
        </View>

        {/* ── 1. CONDUCTEUR + PROFIL ── */}
        <SecSep label="👤 CONDUCTEUR + PROFIL" />

        {/* Conducteur */}
        <TouchableOpacity
          style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}
          onPress={() => { setEditPrenom(conducteurPrenom); setEditNom(conducteurNom); setShowNomModal(true) }}
          activeOpacity={0.75}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#f5a623', letterSpacing: 1.5, marginBottom: 6 }}>👤 CONDUCTEUR</Text>
              {conducteurPrenom || conducteurNom ? (
                <Text style={{ fontSize: 20, fontWeight: '800', color: c.text }}>
                  {conducteurPrenom}{conducteurPrenom && conducteurNom ? ' ' : ''}{conducteurNom ? conducteurNom.toUpperCase() : ''}
                </Text>
              ) : (
                <Text style={{ fontSize: 15, fontWeight: '600', color: c.textSub, fontStyle: 'italic' }}>
                  Appuie pour ajouter ton nom
                </Text>
              )}
            </View>
            <Text style={{ fontSize: 20, color: c.textSub }}>✏️</Text>
          </View>
        </TouchableOpacity>

        {/* Profil */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <Text style={[st.sectionTitle, { color: c.textLabel, marginBottom: 0 }]}>{t.monProfil}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={[st.label, { color: c.textLabel, marginBottom: 0 }]}>{t.typeConducteur}</Text>
            {!camposOk.profil && <ReqBadge />}
          </View>
          <View style={st.profilRow}>
            {(['CD', 'MIXTE', 'LD'] as const).map(p => (
              <TouchableOpacity
                key={p}
                style={[st.profilBtn, { backgroundColor: c.profilBtnBg, borderColor: c.profilBtnBorder }, profil === p && st.profilBtnActive]}
                onPress={async () => {
                  setProfil(p)
                  await AsyncStorage.setItem('profil', p)
                  actualizarCampo('profil', p)
                  atualizarCamposOk()
                }}
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

        {/* ── 2. VÉHICULE ── */}
        <SecSep label="🚛 VÉHICULE" />

        {/* Tracteur */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>🚛 TRACTEUR</Text>
          <View style={{ flexDirection: 'row', marginBottom: 12, gap: 8 }}>
            <TouchableOpacity
              onPress={async () => { setTracteurType('immat'); await AsyncStorage.setItem('tracteur_type', 'immat'); actualizarCampo('tracteurType', 'immat') }}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: tracteurType === 'immat' ? '#f5a623' : c.infoBox, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: tracteurType === 'immat' ? '#fff' : c.textSub }}>Immatriculation</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => { setTracteurType('parc'); await AsyncStorage.setItem('tracteur_type', 'parc'); actualizarCampo('tracteurType', 'parc') }}
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
              actualizarCampo('tracteurValue', v)
            }}
            placeholder={tracteurType === 'immat' ? 'ex: AB-123-CD' : 'ex: T042'}
            placeholderTextColor={c.textSub}
            autoCapitalize="characters"
            style={{ backgroundColor: c.infoBox, borderRadius: 10, padding: 12, color: c.text, fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: c.cardBorder }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 6 }}>
            <Text style={{ fontSize: 11, color: c.textSub, fontWeight: '700' }}>KM ACTUEL DU CAMION</Text>
            {!camposOk.km && <ReqBadge />}
          </View>
          <TextInput
            value={kmTracteurActuel}
            onChangeText={setKmTracteurActuel}
            placeholder='ex: 467225'
            placeholderTextColor={c.textSub}
            keyboardType='numeric'
            style={{ backgroundColor: c.infoBox, borderRadius: 10, padding: 12, color: c.text, fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: c.cardBorder }}
          />
          <Text style={{ fontSize: 10, color: c.textSub, marginTop: 5, fontStyle: 'italic' }}>Sera utilisé comme KM début du prochain jour</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: '#f5a623', borderRadius: 10, padding: 10, alignItems: 'center' }}
              onPress={async () => {
                const km = kmTracteurActuel.trim()
                if (!km || parseFloat(km) <= 0) return
                await AsyncStorage.setItem('km_ultimo_fim', km)
                actualizarCampo('kmUltimoFim', parseInt(km))
                await atualizarCamposOk()
                setModalSucessoMsg('✅ KM enregistré\nKM début du prochain jour: ' + km + ' km')
                setShowModalSucesso(true)
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '800', color: 'white' }}>✅ Enregistrer</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: 'rgba(231,76,60,0.1)', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#e74c3c' }}
              onPress={() => Alert.alert(
                '🔄 Changer de camion',
                'Met à jour le numéro ci-dessus, saisis les KM actuels du nouveau camion et appuie sur Enregistrer.',
                [
                  { text: 'Compris', style: 'default', onPress: async () => {
                    setTracteurValue('')
                    await AsyncStorage.setItem('tracteur_value', '')
                    actualizarCampo('tracteurValue', '')
                    setKmTracteurActuel('')
                    await AsyncStorage.setItem('km_ultimo_fim', '0')
                    actualizarCampo('kmUltimoFim', 0)
                    await atualizarCamposOk()
                  }},
                  { text: 'Annuler', style: 'cancel' },
                ]
              )}
            >
              <Text style={{ fontSize: 13, fontWeight: '800', color: '#e74c3c' }}>🔄 Changer</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Semi-Remorque */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>🔗 SEMI-REMORQUE</Text>
          <View style={{ flexDirection: 'row', marginBottom: 12, gap: 8 }}>
            <TouchableOpacity
              onPress={async () => { setRemorqueType('immat'); await AsyncStorage.setItem('remorque_type', 'immat'); actualizarCampo('remorqueType', 'immat') }}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: remorqueType === 'immat' ? '#f5a623' : c.infoBox, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: remorqueType === 'immat' ? '#fff' : c.textSub }}>Immatriculation</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => { setRemorqueType('parc'); await AsyncStorage.setItem('remorque_type', 'parc'); actualizarCampo('remorqueType', 'parc') }}
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
              actualizarCampo('remorqueValue', v)
            }}
            placeholder={remorqueType === 'immat' ? 'ex: AB-123-CD' : 'ex: AP2'}
            placeholderTextColor={c.textSub}
            autoCapitalize="characters"
            style={{ backgroundColor: c.infoBox, borderRadius: 10, padding: 12, color: c.text, fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: c.cardBorder }}
          />
        </View>

        {/* Transport & Équipement — accordion */}
        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder, marginBottom: 16 }]}>
          <TouchableOpacity onPress={() => setTransportOpen(!transportOpen)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[st.sectionTitle, { color: c.textLabel, marginBottom: 0, flex: 1, marginRight: 8 }]} numberOfLines={1} adjustsFontSizeToFit>
              TYPE DE TRANSPORT & ÉQUIPEMENT
            </Text>
            <Text style={{ fontSize: 14, color: c.textSub, fontWeight: '700' }}>{transportOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {transportOpen && (
            <View style={{ marginTop: 14 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: c.textSub, letterSpacing: 1.2, marginBottom: 8 }}>TYPE DE TRANSPORT</Text>
              <View style={[st.settingRow, { opacity: 0.5 }]}>
                <Text style={[st.settingLabel, { color: c.text }]}>🚛 Normal / Tautliner</Text>
                <Switch value={true} disabled trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>❄️ Frigorifique</Text>
                <Switch value={transportFrigo} onValueChange={async (v) => { setTransportFrigo(v); await AsyncStorage.setItem('transport_frigo', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>☢️ ADR — Matières dangereuses</Text>
                <Switch value={transportAdr} onValueChange={async (v) => { setTransportAdr(v); await AsyncStorage.setItem('transport_adr', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#e74c3c' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🪣 Benne</Text>
                <Switch value={transportBenne} onValueChange={async (v) => { setTransportBenne(v); await AsyncStorage.setItem('transport_benne', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🛢️ Citerne</Text>
                <Switch value={transportCiterne} onValueChange={async (v) => { setTransportCiterne(v); await AsyncStorage.setItem('transport_citerne', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🚧 Plateau</Text>
                <Switch value={transportPlateau} onValueChange={async (v) => { setTransportPlateau(v); await AsyncStorage.setItem('transport_plateau', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🌲 Grumier / Forestier</Text>
                <Switch value={transportGrumier} onValueChange={async (v) => { setTransportGrumier(v); await AsyncStorage.setItem('transport_grumier', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🏗️ Grue / Ampliroll</Text>
                <Switch value={transportGrue} onValueChange={async (v) => { setTransportGrue(v); await AsyncStorage.setItem('transport_grue', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={{ height: 12 }} />
              <Text style={{ fontSize: 10, fontWeight: '800', color: c.textSub, letterSpacing: 1.2, marginBottom: 8 }}>ÉQUIPEMENT EMBARQUÉ</Text>
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🚜 Chariot élévateur</Text>
                <Switch value={equipChariot} onValueChange={async (v) => { setEquipChariot(v); await AsyncStorage.setItem('equipement_chariot', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🚪 Hayon élévateur</Text>
                <Switch value={equipHayon} onValueChange={async (v) => { setEquipHayon(v); await AsyncStorage.setItem('equipement_hayon', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
              <View style={[st.divider, { backgroundColor: c.divider }]} />
              <View style={st.settingRow}>
                <Text style={[st.settingLabel, { color: c.text }]}>🦾 Grue auxiliaire</Text>
                <Switch value={equipGrueAux} onValueChange={async (v) => { setEquipGrueAux(v); await AsyncStorage.setItem('equipement_grue_aux', String(v)) }} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
              </View>
            </View>
          )}
        </View>

        {/* ── 3. APPARENCE ── */}
        <SecSep label="🎨 APPARENCE" />

        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>{t.apparence}</Text>
          <View style={st.settingRow}>
            <View>
              <Text style={[st.settingLabel, { color: c.text }]}>{t.modeSombre}</Text>
              <Text style={[st.settingSub, { color: c.textSub }]}>{t.themeFonce}</Text>
            </View>
            <Switch value={themeSombre} onValueChange={toggleTheme} trackColor={{ false: '#d0d5e8', true: '#f5a623' }} thumbColor="white" />
          </View>
        </View>

        {/* ── 4. NOTIFICATIONS ── */}
        <SecSep label="🔔 NOTIFICATIONS" />

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


        {/* ── 5. PARAMÈTRES SALAIRE ── */}
        <SecSep label="💶 PARAMÈTRES SALAIRE" />

        <View
          onLayout={e => {
            salaireSectionY.current = e.nativeEvent.layout.y
            if (scrollToParam === 'salaire' && !scrolledToSalaire.current) {
              scrolledToSalaire.current = true
              setTimeout(() => scrollViewRef.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: true }), 200)
            }
          }}
          style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>💶 PARAMÈTRES SALAIRE</Text>
          <TouchableOpacity
            style={[st.backupBtn, { backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.35)' }]}
            onPress={() => router.push('/onboarding?mode=edit')}
          >
            <Text style={{ fontSize: 18 }}>✏️</Text>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#f5a623' }}>Modifier mon contrat</Text>
                {(!camposOk.hbase || !camposOk.hval) && <ReqBadge />}
              </View>
              <Text style={{ fontSize: 12, color: c.textSub, marginTop: 2 }}>Relancer l'assistant contrat et salaire</Text>
            </View>
          </TouchableOpacity>
        </View>


        {/* ── 6. ABONNEMENT ── */}
        <SecSep label="⭐ ABONNEMENT" />

        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>{t.abonnement}</Text>
          {diasTrial !== null && diasTrial > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 }}>
              <Text style={{ fontSize: 40, fontWeight: '800', color: '#f5a623', lineHeight: 46 }}>{diasTrial}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{t.joursEssai}</Text>
                {dataExpiracao && (
                  <Text style={{ fontSize: 12, color: c.textSub, marginTop: 2 }}>
                    Expire le {dataExpiracao.getDate()}/{String(dataExpiracao.getMonth() + 1).padStart(2, '0')}/{dataExpiracao.getFullYear()}
                  </Text>
                )}
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Text style={{ fontSize: 28 }}>⏰</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#e74c3c' }}>Essai terminé</Text>
                <Text style={{ fontSize: 12, color: c.textSub, marginTop: 2 }}>Abonne-toi pour continuer</Text>
              </View>
            </View>
          )}
          <TouchableOpacity style={[st.subscribeBtn, diasTrial !== null && diasTrial <= 0 ? { backgroundColor: '#e74c3c' } : {}]}>
            <Text style={st.subscribeBtnText}>
              {diasTrial !== null && diasTrial <= 0 ? "🔓 S'abonner — 2,99€/mois" : t.sabonner}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── 7. SAUVEGARDE ── */}
        <SecSep label="🔒 SAUVEGARDE" />

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

        {/* ── 8. MES DONNÉES ── */}
        <SecSep label="🗑️ MES DONNÉES" />

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

        {/* ── 9. LÉGAL + VERSION ── */}
        <SecSep label="📋 LÉGAL" />

        <View style={[st.section, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <Text style={[st.sectionTitle, { color: c.textLabel }]}>LÉGAL</Text>
          <TouchableOpacity
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }}
            onPress={() => Linking.openURL('https://super-salamander-252e93.netlify.app')}
          >
            <Text style={[st.settingLabel, { color: c.text }]}>🔒 Politique de confidentialité</Text>
            <Text style={{ color: c.textSub, fontSize: 16 }}>›</Text>
          </TouchableOpacity>
          <View style={{ height: 1, backgroundColor: c.cardBorder }} />
          <View style={{ paddingVertical: 12 }}>
            <Text style={[st.settingLabel, { color: c.text }]}>📦 Version</Text>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => {
                const next = versionTapCount + 1
                setVersionTapCount(next)
                if (next >= 5) { setSecretUnlocked(true); setVersionTapCount(0) }
              }}
            >
              <Text style={[st.settingSub, { color: c.textSub, marginTop: 2 }]}>
                TachoOffice v1.0.7 · build 13/06/2026{versionTapCount > 0 && versionTapCount < 5 ? ` (${5 - versionTapCount})` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 10. SECTION ESCONDIDA — 5 toques na versão ── */}
        {secretUnlocked && (
          <>
            <SecSep label="⚙️ CONFIGURATION AVANCÉE" />
            <View style={[st.section, { backgroundColor: c.card, borderColor: '#9b59b6' }]}>
              <Text style={[st.sectionTitle, { color: '#9b59b6' }]}>🔧 DÉVELOPPEMENT</Text>

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



              <View style={{ marginTop: 4 }}>
                <TouchableOpacity
                  style={{ backgroundColor: 'rgba(155,89,182,0.1)', borderRadius: 8, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(155,89,182,0.3)' }}
                  onPress={() => { setSecretUnlocked(false); setVersionTapCount(0) }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#9b59b6' }}>✕ Masquer cette section</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* MODAL NOM / PRÉNOM */}
      <Modal visible={showNomModal} transparent animationType="slide">
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setShowNomModal(false)}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, borderWidth: 1, borderColor: c.cardBorder }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 20, textAlign: 'center' }}>👤 Conducteur</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#f5a623', letterSpacing: 1.5, marginBottom: 6 }}>PRÉNOM</Text>
            <TextInput
              style={{ backgroundColor: c.card, borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: '#f5a623', fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 16 }}
              value={editPrenom}
              onChangeText={setEditPrenom}
              placeholder="Ex: Bruno"
              placeholderTextColor={c.textSub}
              autoCapitalize="words"
            />
            <Text style={{ fontSize: 11, fontWeight: '700', color: c.textLabel, letterSpacing: 1.5, marginBottom: 6 }}>NOM DE FAMILLE</Text>
            <TextInput
              style={{ backgroundColor: c.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.cardBorder, fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 24 }}
              value={editNom}
              onChangeText={v => setEditNom(v.toUpperCase())}
              placeholder="Ex: VEIGA"
              placeholderTextColor={c.textSub}
              autoCapitalize="characters"
            />
            <TouchableOpacity
              style={{ backgroundColor: '#f5a623', borderRadius: 14, padding: 16, alignItems: 'center' }}
              onPress={async () => {
                const p = editPrenom.trim()
                const n = editNom.trim()
                setConducteurPrenom(p)
                setConducteurNom(n)
                await AsyncStorage.setItem('conducteur_prenom', p)
                await AsyncStorage.setItem('conducteur_nom', n)
                await AsyncStorage.setItem('nom', p || n)
                actualizarCampo('nom', p || n)
                setShowNomModal(false)
                setTimeout(() => { setModalSucessoMsg('✅ Nom enregistré'); setShowModalSucesso(true) }, 350)
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: 'white' }}>✅ Sauvegarder</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
                { titre: 'Données collectées', texte: "TachoOffice stocke uniquement les données que tu saisis toi-même : heures de service, types de journée, frais professionnels et paramètres de l'app. Aucune donnée n'est envoyée vers des serveurs externes." },
                { titre: 'Stockage local', texte: "Toutes tes données sont conservées localement sur ton appareil via AsyncStorage. Elles ne quittent jamais ton téléphone sauf si tu utilises la fonction d'export manuel." },
                { titre: 'Localisation GPS', texte: "L'accès à la localisation est utilisé uniquement pour calculer les kilomètres parcourus pendant ton service. Les coordonnées GPS ne sont jamais enregistrées ni transmises." },
                { titre: 'Intelligence artificielle', texte: "La fonctionnalité de lecture de fiche de paie utilise l'API Anthropic Claude. Les images que tu envoies sont traitées par Anthropic conformément à leur politique de confidentialité (anthropic.com/privacy). Aucune image n'est conservée par TachoOffice." },
                { titre: 'Notifications', texte: "Les alertes (pause obligatoire, amplitude, rappel de saisie) sont gérées localement par ton appareil. Aucune notification n'est envoyée depuis un serveur externe." },
                { titre: 'Pas de publicité', texte: "TachoOffice ne contient aucune publicité et ne partage aucune donnée avec des tiers à des fins commerciales." },
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
  container: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  section: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600' },
  header: { alignItems: 'center', paddingVertical: 20 },
  titleSection: { paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  profilRow: { flexDirection: 'row', gap: 8 },
  profilBtn: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
  profilBtnActive: { backgroundColor: 'rgba(245,166,35,0.1)' },
  profilBtnText: { fontSize: 13, fontWeight: '700' },
  infoBox: { borderRadius: 10, padding: 12, marginTop: 8 },
  infoText: { fontSize: 13, lineHeight: 18 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  settingLabel: { fontSize: 14, fontWeight: '600' },
  settingSub: { fontSize: 13, marginTop: 2 },
  divider: { height: 1, marginVertical: 14 },
  langueRow: { flexDirection: 'row', gap: 10 },
  langueBtn: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
  langueBtnActive: { backgroundColor: 'rgba(245,166,35,0.1)' },
  langueBtnText: { fontSize: 13, fontWeight: '700' },
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
