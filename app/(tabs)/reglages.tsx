import React, { useState, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet, Modal, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useTheme } from '../../context/ThemeContext'
import { useLangue } from '../../context/LangueContext'
import { getDiasRestantes, getDataExpiracao } from '../../src/trial'
import { pedirPermissaoNotificacoes, cancelarTodosAlertas } from '../../src/notifications'

// Chaves a exportar/importar
const BACKUP_KEYS = [
  'historique',
  'monSalaire_v2',
  'monSalaire_padrao',
  'frais_valores',
  'sal_settings',
  'profil',
  'modoTacho',
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

  useEffect(() => {
    AsyncStorage.getItem('profil').then(p => {
      if (p === 'CD' || p === 'MIXTE' || p === 'LD') setProfil(p)
    })
    getDiasRestantes().then(setDiasTrial)
    getDataExpiracao().then(setDataExpiracao)
    AsyncStorage.getItem('notificacoes_ativas').then(v => {
      if (v !== null) setNotifications(v === 'true')
    })
  }, [])

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
        version: 'tachomax-v1',
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
      const filename = `tachomax_backup_${date}.json`
      const path = `${FileSystem.documentDirectory}${filename}`

      await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 })

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/json',
          dialogTitle: 'Sauvegarder TachoMax',
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
        setModalSucessoMsg('❌ Fichier invalide.\nCe fichier ne semble pas être un backup TachoMax.')
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
                      'Active les notifications pour TachoMax dans les Paramètres de ton téléphone.',
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
                  Abonne-toi pour continuer à utiliser TachoMax
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
                {loadingExport ? 'Export en cours...' : 'Exporter mes données'}
              </Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 2 }}>
                Historique · Fiches · Réglages → fichier .json
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
                {loadingImport ? 'Import en cours...' : 'Importer un backup'}
              </Text>
              <Text style={{ fontSize: 13, color: c.textSub, marginTop: 2 }}>
                Restaure à partir d'un fichier .json exporté
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

        <Text style={[st.version, { color: c.version }]}>TachoMax v0.1 — Bruno Pereira Da Veiga</Text>
        <View style={{ height: 100 }} />
      </ScrollView>

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