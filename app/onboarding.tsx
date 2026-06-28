import React, { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, TextInput, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router, useLocalSearchParams } from 'expo-router'
import { useApp } from '../context/AppContext'
import { TachoLogo } from '../src/TachoLogo'
import { PADRAO_INICIAL } from '../src/engine/aprendizagem'
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker'

const { width } = Dimensions.get('window')

type Profil = 'CD' | 'MIXTE' | 'LD'

export default function OnboardingScreen() {
  const { recarregarApp } = useApp()
  const [etape, setEtape] = useState(0)
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ mode?: string }>()

  useEffect(() => {
    if (params.mode === 'edit') {
      // Carregar TODOS os dados existentes e ir directo ao passo 2 (contrat)
      Promise.all([
        AsyncStorage.getItem('conducteur_prenom'),
        AsyncStorage.getItem('conducteur_nom'),
        AsyncStorage.getItem('profil'),
        AsyncStorage.getItem('anciennete'),
        AsyncStorage.getItem('coefficient'),
        AsyncStorage.getItem('monSalaire_padrao'),
        AsyncStorage.getItem('vehicule_type'),
        AsyncStorage.getItem('cargo_type'),
        AsyncStorage.getItem('tracteur_type'),
        AsyncStorage.getItem('tracteur_value'),
        AsyncStorage.getItem('remorque_type'),
        AsyncStorage.getItem('remorque_value'),
        AsyncStorage.getItem('km_ultimo_fim'),
        AsyncStorage.getItem('equipement_chariot'),
        AsyncStorage.getItem('equipement_hayon'),
        AsyncStorage.getItem('equipement_grue_aux'),
        AsyncStorage.getItem('contrat_net_mensuel'),
        AsyncStorage.getItem('contrat_saisir_brut'),
        AsyncStorage.getItem('date_entree_entreprise'),
      ]).then(([pren, nomV, prof, anc, coef, padraoRaw, vType, cType, tType, tVal, rType, rVal, km, eChar, eHay, eGrue, netMensuel, saisirBrut, dateEntreeStr]) => {
        if (pren) setPrenom(pren)
        if (nomV) setNom(nomV)
        if (prof === 'CD' || prof === 'MIXTE' || prof === 'LD') setProfil(prof)
        if (anc) {
          const matchAns = anc.match(/^(\d+)\s*ans/)
          const matchMois = anc.match(/(\d+)\s*mois/)
          if (matchAns) setAncienneteAns(matchAns[1])
          if (matchMois) setAncienneteMois(matchMois[1])
        }
        if (coef) setCoefficient(coef)
        if (padraoRaw) {
          try {
            const p = JSON.parse(padraoRaw)
            if (p.hbase && p.hbase > 0) {
              setObHbase(p.hbase)
              const presets = [152, 169, 182, 200]
              if (!presets.includes(p.hbase)) {
                setObHbaseIsCustom(true)
                setObHbaseCustomInput(String(p.hbase))
              }
            }
            if (p.hval && p.hval > 0) setObHvalBrut(String(p.hval))
          } catch {}
        }
        if (vType) setTypeVehicule(vType)
        if (cType) setTypeCargo(cType)
        if (tType === 'immat' || tType === 'parc') setTracteurType(tType)
        if (tVal) setTracteurValue(tVal)
        if (rType === 'immat' || rType === 'parc') setRemorqueType(rType)
        if (rVal) setRemorqueValue(rVal)
        if (km) setKmInicial(km)
        if (eChar === 'true') setEquipChariot(true)
        if (eHay === 'true') setEquipHayon(true)
        if (eGrue === 'true') setEquipGrueAux(true)
        if (saisirBrut !== null) setObSaisirBrut(saisirBrut === 'true')
        if (netMensuel) setObSalNet(netMensuel)
        if (dateEntreeStr) {
          const d = new Date(dateEntreeStr)
          if (!isNaN(d.getTime())) setDataEntrada(d)
        }
        // Charger timing de aprendizagem_padrao
        AsyncStorage.getItem('aprendizagem_padrao').then(apRaw => {
          if (apRaw) try {
            const ap = JSON.parse(apRaw)
            if (ap.diaSalario) setObDiaSalario(ap.diaSalario)
            if (ap.hlag !== null && ap.hlag !== undefined) setObHlag(ap.hlag)
            if (ap.diaFrais) setObDiaFrais(ap.diaFrais)
            if (ap.flag !== null && ap.flag !== undefined) setObFlag(ap.flag)
            setObFraisMemeJour(ap.diaSalario === ap.diaFrais && ap.hlag === ap.flag)
          } catch {}
        })
        setEtape(2)
      })
    }
  }, [])
  const [prenom, setPrenom] = useState('')
  const [nom, setNom] = useState('')
  const [profil, setProfil] = useState<Profil>('MIXTE')
  const [tracteurType, setTracteurType] = useState<'immat' | 'parc'>('immat')
  const [tracteurValue, setTracteurValue] = useState('')
  const [remorqueType, setRemorqueType] = useState<'immat' | 'parc'>('immat')
  const [remorqueValue, setRemorqueValue] = useState('')
  const [typeVehicule, setTypeVehicule] = useState('semi')
  const [typeCargo, setTypeCargo] = useState('general')
  const [kmInicial, setKmInicial] = useState('')
  const [equipChariot, setEquipChariot] = useState(false)
  const [equipHayon, setEquipHayon] = useState(false)
  const [equipGrueAux, setEquipGrueAux] = useState(false)
  // Contrato (etapa 2)
  const [ancienneteAns, setAncienneteAns] = useState('')
  const [ancienneteMois, setAncienneteMois] = useState('')
  const [dataEntrada, setDataEntrada] = useState<Date | null>(null)
  const [coefficient, setCoefficient] = useState('')
  const [salBaseEstime, setSalBaseEstime] = useState('')
  const [heuresMensuel, setHeuresMensuel] = useState('')
  const [obHbase, setObHbase] = useState(169)
  const [obSaisirBrut, setObSaisirBrut] = useState(true)
  const [obHvalBrut, setObHvalBrut] = useState('')
  const [obSalNet, setObSalNet] = useState('')
  const [obHbaseIsCustom, setObHbaseIsCustom] = useState(false)
  const [obHbaseCustomInput, setObHbaseCustomInput] = useState('')
  // Timing de paiement
  const [obDiaSalario, setObDiaSalario] = useState(25)
  const [obHlag, setObHlag] = useState(1)
  const [obDiaFrais, setObDiaFrais] = useState(25)
  const [obFlag, setObFlag] = useState(1)
  const mesActual = new Date().getMonth()
  const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
  const [obFraisMemeJour, setObFraisMemeJour] = useState(true)
  const [obDiaSalarioIsAutre, setObDiaSalarioIsAutre] = useState(false)
  const [obDiaSalarioAutreInput, setObDiaSalarioAutreInput] = useState('')
  const [obDiaFraisIsAutre, setObDiaFraisIsAutre] = useState(false)
  const [obDiaFraisAutreInput, setObDiaFraisAutreInput] = useState('')

  const terminerOnboarding = async () => {
    await AsyncStorage.setItem('onboardingDone', 'true')
    if (ancienneteAns || ancienneteMois)
      await AsyncStorage.setItem('anciennete', `${ancienneteAns || '0'} ans ${ancienneteMois || '0'} mois`)
    if (dataEntrada) await AsyncStorage.setItem('date_entree_entreprise', dataEntrada.toISOString())
    if (coefficient) await AsyncStorage.setItem('coefficient', coefficient)
    if (salBaseEstime) await AsyncStorage.setItem('sal_base_estime', salBaseEstime)
    if (heuresMensuel) await AsyncStorage.setItem('heures_mensuel', heuresMensuel)
    await AsyncStorage.setItem('vehicule_type', typeVehicule)
    await AsyncStorage.setItem('cargo_type', typeCargo)
    // Sync cargo_type → transport_* flags so Réglages reflects the choice
    const cargoToTransport: Record<string, string> = {
      frigo: 'transport_frigo', adr: 'transport_adr',
      benne: 'transport_benne', citerne: 'transport_citerne', plateau: 'transport_plateau',
      grue: 'transport_grue', grumier: 'transport_grumier',
    }
    // Clear all flags then enable the selected one
    for (const key of Object.values(cargoToTransport)) await AsyncStorage.setItem(key, 'false')
    if (cargoToTransport[typeCargo]) await AsyncStorage.setItem(cargoToTransport[typeCargo], 'true')
    await AsyncStorage.setItem('equipement_chariot', String(equipChariot))
    await AsyncStorage.setItem('equipement_hayon', String(equipHayon))
    await AsyncStorage.setItem('equipement_grue_aux', String(equipGrueAux))
    await AsyncStorage.setItem('profil', profil)
    if (prenom) await AsyncStorage.setItem('conducteur_prenom', prenom)
    if (nom) await AsyncStorage.setItem('conducteur_nom', nom)
    // backward compat — keep 'nom' with prenom for the main screen greeting
    await AsyncStorage.setItem('nom', prenom || nom)
    // Persister les valeurs de salaire pour restauration en mode edit
    await AsyncStorage.setItem('contrat_saisir_brut', String(obSaisirBrut))
    if (!obSaisirBrut && obSalNet) await AsyncStorage.setItem('contrat_net_mensuel', obSalNet)
    // Pre-populate monSalaire_padrao from onboarding salary data
    const existingPadraoRaw = await AsyncStorage.getItem('monSalaire_padrao')
    const hbase = obHbase
    const salBrut = obSaisirBrut ? (parseFloat(obHvalBrut) || 0) : 0
    const salNet = obSaisirBrut
      ? (salBrut > 0 ? salBrut * hbase * 0.79 : 0)
      : (parseFloat(obSalNet) || 0)
    const hval = salBrut > 0
      ? salBrut
      : (salNet > 0 && hbase > 0 ? Math.round((salNet / hbase) * 100) / 100 : 14.76)
    const liquidRate = 0.79
    const valorDiaConges = salNet > 0 ? Math.round((salNet / 21.67) * 100) / 100 : 136.52
    if (!existingPadraoRaw) {
      const padraoInit = {
        descoberto: false, diaSalario: 5, diaFrais: 10,
        defasagemFrais: 1, confianca: 0,
        hbase, hval, h25: Math.round(hval * 1.25 * 100) / 100, lim25: 17, h50: Math.round(hval * 1.5 * 100) / 100,
        hlag: 1, flag: 1, liquidRate, fraisSepare: false,
        horasExtrasMedia: 0,
        ptd: 4.42, dej: 16.36, din: 23.94, nui: 23.94,
        valorDiaConges, valorDiaFerie: 0, valorDiaRC: 0,
        taxaHorariaNetaMedia: hval * liquidRate,
        fraisFactorReal: 0,
        vehiculo: typeVehicule, cargo: typeCargo,
      }
      await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(padraoInit))
    } else {
      // Padrao existant — mettre à jour hbase/hval/h25/h50 en préservant les données apprises
      try {
        const existing = JSON.parse(existingPadraoRaw)
        const updated = {
          ...existing,
          hbase,
          hval,
          h25: Math.round(hval * 1.25 * 100) / 100,
          h50: Math.round(hval * 1.5 * 100) / 100,
          valorDiaConges,
          taxaHorariaNetaMedia: hval * (existing.liquidRate ?? liquidRate),
        }
        await AsyncStorage.setItem('monSalaire_padrao', JSON.stringify(updated))
      } catch {}
    }
    // Guardar timing no motor de aprendizagem
    const existingAprendRaw = await AsyncStorage.getItem('aprendizagem_padrao')
    const existingAprendizagem = existingAprendRaw ? JSON.parse(existingAprendRaw) : PADRAO_INICIAL
    const padraoAprendizado = {
      ...existingAprendizagem,  // preserva dados aprendidos (ptd, dej, din, nui, taxaHorariaNetaMedia, etc.)
      hlag: obHlag,
      diaSalario: obDiaSalario,
      flag: obFraisMemeJour ? obHlag : obFlag,
      diaFrais: obFraisMemeJour ? obDiaSalario : obDiaFrais,
      hlagConfirmado: true,
      flagConfirmado: true,
      diaSalarioConfirmado: true,
      diaFraisConfirmado: true,
    }
    await AsyncStorage.setItem('aprendizagem_padrao', JSON.stringify(padraoAprendizado))
    await recarregarApp()
    router.replace('/(tabs)/fiche')
  }

  return (
    <SafeAreaView edges={['top']} style={st.safe}>

      {/* ETAPE 0 — BOAS VINDAS */}
      {etape === 0 && (
        <View style={[st.page, { paddingTop: 12, flex: 1 }]}>
          <View style={st.logoSection}>
            <TachoLogo size={28} textColor='#ffffff' />
            <Text style={st.logoSub}>L'app du chauffeur professionnel</Text>
          </View>

          <View style={{ width: width, marginHorizontal: -24, marginBottom: 12, position: 'relative' }}>
            <Image
              source={require('../assets/images/icon.png')}
              style={{ width: width, height: Math.round(width * 0.70), resizeMode: 'cover' }}
            />
            {[0.85, 0.6, 0.35, 0.15].map((op, i) => (
              <View key={'l'+i} style={{ position: 'absolute', left: i * 12, top: 0, bottom: 0, width: 14, backgroundColor: '#0f1117', opacity: op }} />
            ))}
            {[0.85, 0.6, 0.35, 0.15].map((op, i) => (
              <View key={'r'+i} style={{ position: 'absolute', right: i * 12, top: 0, bottom: 0, width: 14, backgroundColor: '#0f1117', opacity: op }} />
            ))}
            {[0.7, 0.4, 0.15].map((op, i) => (
              <View key={'b'+i} style={{ position: 'absolute', left: 0, right: 0, bottom: i * 10, height: 12, backgroundColor: '#0f1117', opacity: op }} />
            ))}
          </View>

          <Text style={[st.heroTitle, { textAlign: 'center' }]}>Bienvenue !</Text>
          <Text style={st.heroText}>
            TachoOffice calcule automatiquement tes heures, tes frais et t'alerte avant les limites légales.
          </Text>
          <Text style={[st.heroText2, { marginBottom: 12 }]}>
            Minimum de saisie. Maximum de précision.
          </Text>

          <View style={[st.features, { marginBottom: 16 }]}>
            {[
              { emoji: '⏱️', text: 'Chronomètre de service et pause' },
              { emoji: '🧾', text: 'Frais calculés automatiquement' },
              { emoji: '⚖️', text: 'Alertes limites légales' },
              { emoji: '🤖', text: 'IA lit ta fiche de paie' },
            ].map(item => (
              <View key={item.text} style={st.featureRow}>
                <Text style={st.featureEmoji}>{item.emoji}</Text>
                <Text style={st.featureText}>{item.text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={[st.btnNext, { marginBottom: insets.bottom > 0 ? insets.bottom + 8 : 24 }]} onPress={() => setEtape(1)}>
            <Text style={st.btnNextText}>COMMENCER →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ETAPE 1 — PERFIL */}
      {etape === 1 && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={st.page}>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={st.stepHeader}>
            <Text style={st.stepNum}>1 / 4</Text>
            <Text style={st.stepTitle}>Quel est ton profil ?</Text>
            <Text style={st.stepSub}>Tu pourras changer à tout moment dans les Réglages</Text>
          </View>

          <View style={st.nomSection}>
            <Text style={st.nomLabel}>PRÉNOM</Text>
            <TextInput
              style={st.nomInput}
              value={prenom}
              onChangeText={setPrenom}
              placeholder="Ex: Bruno"
              placeholderTextColor="#6b7394"
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>
          <View style={st.nomSection}>
            <Text style={st.nomLabel}>NOM DE FAMILLE</Text>
            <TextInput
              style={st.nomInput}
              value={nom}
              onChangeText={setNom}
              placeholder="Ex: Veiga"
              placeholderTextColor="#6b7394"
              autoCapitalize="characters"
              returnKeyType="done"
            />
          </View>

          <View style={{ gap: 8, marginBottom: 24 }}>
            {[
              { id: 'CD' as Profil, emoji: '🏠', titre: 'Courte Distance', sub: 'Rentre chaque jour · Max 52h/sem.' },
              { id: 'MIXTE' as Profil, emoji: '🔄', titre: 'Mixte', sub: '1–2 découchés/semaine · Max 56h/sem.' },
              { id: 'LD' as Profil, emoji: '🛣️', titre: 'Longue Distance', sub: 'Découché toute la semaine · Max 56h/sem.' },
            ].map(p => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setProfil(p.id)}
                style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: profil === p.id ? 'rgba(245,166,35,0.12)' : '#181c27', borderWidth: profil === p.id ? 1.5 : 1, borderColor: profil === p.id ? '#f5a623' : '#2a3045', flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Text style={{ fontSize: 20 }}>{p.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: profil === p.id ? '#f5a623' : '#eef0f5' }}>{p.titre}</Text>
                  <Text style={{ fontSize: 11, color: '#9ba3b8', marginTop: 2 }}>{p.sub}</Text>
                </View>
                <View style={[st.profilCheck, profil === p.id && st.profilCheckActive]}>
                  {profil === p.id && <Text style={{ color: 'white', fontSize: 12, fontWeight: '800' }}>✓</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, marginBottom: insets.bottom > 0 ? insets.bottom + 8 : 24, paddingTop: 12 }}>
            <TouchableOpacity style={[st.btnNext, { flex: 1, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#2a3045' }]} onPress={() => setEtape(0)}>
              <Text style={[st.btnNextText, { color: '#6b7394' }]}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.btnNext, { flex: 2 }]} onPress={() => setEtape(2)}>
              <Text style={st.btnNextText}>SUIVANT →</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      )}

            {/* ETAPE 2 — CONTRAT & ANCIENNETÉ */}
      {etape === 2 && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1, paddingHorizontal: 24 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 20, paddingBottom: 8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={st.stepHeader}>
            <Text style={st.stepNum}>2 / 4</Text>
            <Text style={st.stepTitle}>📋 Ton contrat</Text>
            <Text style={st.stepSub}>Ces infos affinent les estimations de salaire. Tu peux laisser vide.</Text>
          </View>

          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>📅 ANCIENNETÉ DANS L'ENTREPRISE</Text>
          <TouchableOpacity
            onPress={() => {
              DateTimePickerAndroid.open({
                value: dataEntrada || new Date(),
                mode: 'date',
                is24Hour: true,
                maximumDate: new Date(),
                onChange: (event: any, date?: Date) => {
                  if (event.type === 'set' && date) {
                    setDataEntrada(date)
                    const hoje = new Date()
                    const diffMs = hoje.getTime() - date.getTime()
                    const diffMeses = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44))
                    const anos = Math.floor(diffMeses / 12)
                    const meses = diffMeses % 12
                    setAncienneteAns(String(anos))
                    setAncienneteMois(String(meses))
                  }
                },
              })
            }}
            style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: dataEntrada ? '#f5a623' : '#2a3045', alignItems: 'center', marginBottom: 8 }}
          >
            <Text style={{ fontSize: 15, fontWeight: '800', color: dataEntrada ? '#f5a623' : '#6b7394' }}>
              {dataEntrada
                ? `📅 Depuis le ${String(dataEntrada.getDate()).padStart(2, '0')}/${String(dataEntrada.getMonth() + 1).padStart(2, '0')}/${dataEntrada.getFullYear()}`
                : "📅 Choisir la date d'entrée"}
            </Text>
          </TouchableOpacity>
          {dataEntrada ? (
            <Text style={{ fontSize: 12, color: '#9ba3b8', marginBottom: 20, textAlign: 'center' }}>
              {ancienneteAns} an{parseInt(ancienneteAns) > 1 ? 's' : ''} et {ancienneteMois} mois
            </Text>
          ) : (
            <View style={{ marginBottom: 20 }} />
          )}

          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>⚖️ COEFFICIENT CONVENTIONNEL</Text>
          <Text style={{ fontSize: 11, color: '#9ba3b8', marginBottom: 8, lineHeight: 16 }}>Sur ta fiche de paie (ex: 138, 150…). Laisse vide si tu ne sais pas.</Text>
          <TextInput
            value={coefficient}
            onChangeText={v => setCoefficient(v.replace(/[^0-9]/g, ''))}
            placeholder="ex: 138"
            placeholderTextColor="#6b7394"
            keyboardType="number-pad"
            maxLength={3}
            style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 10, color: '#eef0f5', fontSize: 16, fontWeight: '700', borderWidth: 1, borderColor: '#2a3045', marginBottom: 24 }}
          />

          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>⏱️ HEURES DE CONTRAT PAR MOIS</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {[
              { h: 152, sub: '35h/sem' },
              { h: 169, sub: 'standard transport' },
              { h: 182, sub: '42h/sem' },
              { h: 200, sub: '46h+/sem' },
            ].map(({ h, sub }) => (
              <TouchableOpacity
                key={h}
                onPress={() => { setObHbase(h); setObHbaseIsCustom(false); setObHbaseCustomInput('') }}
                style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: !obHbaseIsCustom && obHbase === h ? 'rgba(245,166,35,0.12)' : '#181c27', alignItems: 'center', borderWidth: !obHbaseIsCustom && obHbase === h ? 1.5 : 1, borderColor: !obHbaseIsCustom && obHbase === h ? '#f5a623' : '#2a3045' }}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: !obHbaseIsCustom && obHbase === h ? '#f5a623' : '#eef0f5' }}>{h}h</Text>
                <Text style={{ fontSize: 10, color: !obHbaseIsCustom && obHbase === h ? '#f5a623' : '#6b7394', marginTop: 1 }}>{sub}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => { setObHbaseIsCustom(true); if (!obHbaseCustomInput) setObHbase(0) }}
              style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: obHbaseIsCustom ? 'rgba(245,166,35,0.12)' : '#181c27', alignItems: 'center', borderWidth: obHbaseIsCustom ? 1.5 : 1, borderColor: obHbaseIsCustom ? '#f5a623' : '#2a3045' }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: obHbaseIsCustom ? '#f5a623' : '#eef0f5' }}>Autre</Text>
              <Text style={{ fontSize: 10, color: obHbaseIsCustom ? '#f5a623' : '#6b7394', marginTop: 1 }}>saisir manuellement</Text>
            </TouchableOpacity>
          </View>
          {obHbaseIsCustom && (
            <TextInput
              value={obHbaseCustomInput}
              onChangeText={v => {
                const clean = v.replace(/[^0-9]/g, '')
                setObHbaseCustomInput(clean)
                const n = parseInt(clean) || 0
                if (n > 0) setObHbase(n)
              }}
              keyboardType="number-pad"
              placeholder="ex: 151, 186..."
              placeholderTextColor="#6b7394"
              maxLength={4}
              style={{ borderWidth: 1.5, borderColor: obHbaseCustomInput ? '#f5a623' : '#2a3045', borderRadius: 12, padding: 13, fontSize: 18, fontWeight: '800', color: '#eef0f5', backgroundColor: '#181c27', marginBottom: 12, textAlign: 'center' }}
            />
          )}

          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>💶 TON SALAIRE</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            <TouchableOpacity onPress={() => setObSaisirBrut(true)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: obSaisirBrut ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obSaisirBrut ? 1.5 : 1, borderColor: obSaisirBrut ? '#f5a623' : '#2a3045' }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: obSaisirBrut ? '#f5a623' : '#9ba3b8' }}>Taux brut/h</Text>
              <Text style={{ fontSize: 10, color: obSaisirBrut ? '#f5a623' : '#6b7394', marginTop: 1 }}>je saisis €/h brut</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setObSaisirBrut(false)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: !obSaisirBrut ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: !obSaisirBrut ? 1.5 : 1, borderColor: !obSaisirBrut ? '#f5a623' : '#2a3045' }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: !obSaisirBrut ? '#f5a623' : '#9ba3b8' }}>Net mensuel</Text>
              <Text style={{ fontSize: 10, color: !obSaisirBrut ? '#f5a623' : '#6b7394', marginTop: 1 }}>je saisis € net/mois</Text>
            </TouchableOpacity>
          </View>
          {obSaisirBrut ? (
            <>
              <Text style={{ fontSize: 11, color: '#9ba3b8', marginBottom: 6 }}>Ton taux horaire brut ?</Text>
              <TextInput
                value={obHvalBrut}
                onChangeText={setObHvalBrut}
                keyboardType="numeric"
                placeholder="ex: 18.50"
                placeholderTextColor="#6b7394"
                style={{ borderWidth: 1, borderColor: obHvalBrut ? '#f5a623' : '#2a3045', borderRadius: 12, padding: 13, fontSize: 18, fontWeight: '800', color: '#eef0f5', backgroundColor: '#181c27', marginBottom: 6, textAlign: 'center' }}
              />
              <Text style={{ fontSize: 11, color: '#6b7394', marginBottom: 20, textAlign: 'center' }}>
                {'Brut mensuel: '}
                <Text style={{ color: '#eef0f5', fontWeight: '700' }}>
                  {obHvalBrut && obHbase > 0 ? (parseFloat(obHvalBrut) * obHbase).toFixed(0) + ' €' : '---'}
                </Text>
                {'  →  '}
                <Text style={{ color: '#f5a623', fontWeight: '800' }}>
                  {obHvalBrut && obHbase > 0 ? (parseFloat(obHvalBrut) * obHbase * 0.79).toFixed(0) + ' € net' : '---'}
                </Text>
              </Text>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 11, color: '#9ba3b8', marginBottom: 6 }}>Ton salaire net mensuel ? (sans les frais)</Text>
              <TextInput
                value={obSalNet}
                onChangeText={setObSalNet}
                keyboardType="numeric"
                placeholder="ex: 2800"
                placeholderTextColor="#6b7394"
                style={{ borderWidth: 1, borderColor: obSalNet ? '#f5a623' : '#2a3045', borderRadius: 12, padding: 13, fontSize: 18, fontWeight: '800', color: '#eef0f5', backgroundColor: '#181c27', marginBottom: 6, textAlign: 'center' }}
              />
              <Text style={{ fontSize: 11, color: '#6b7394', marginBottom: 20, textAlign: 'center' }}>
                {'Taux horaire net: '}
                <Text style={{ color: '#f5a623', fontWeight: '700' }}>
                  {obSalNet && obHbase > 0 ? (parseFloat(obSalNet) / obHbase).toFixed(2) + ' €/h' : '---'}
                </Text>
                {'  Valeur congé/j: '}
                <Text style={{ color: '#f5a623', fontWeight: '700' }}>
                  {obSalNet && obHbase > 0 ? (parseFloat(obSalNet) / 21.67).toFixed(2) + ' €' : '---'}
                </Text>
              </Text>
            </>
          )}


          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginTop: 8 }}>📅 JOUR DE PAIEMENT DU SALAIRE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {[1, 5, 10, 15, 25].map(d => (
              <TouchableOpacity key={d} onPress={() => { setObDiaSalario(d); setObDiaSalarioIsAutre(false) }} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: obDiaSalario === d && !obDiaSalarioIsAutre ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obDiaSalario === d && !obDiaSalarioIsAutre ? 1.5 : 1, borderColor: obDiaSalario === d && !obDiaSalarioIsAutre ? '#f5a623' : '#2a3045' }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: obDiaSalario === d && !obDiaSalarioIsAutre ? '#f5a623' : '#eef0f5' }}>{d}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setObDiaSalarioIsAutre(true)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: obDiaSalarioIsAutre ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obDiaSalarioIsAutre ? 1.5 : 1, borderColor: obDiaSalarioIsAutre ? '#f5a623' : '#2a3045' }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: obDiaSalarioIsAutre ? '#f5a623' : '#eef0f5' }}>Autre</Text>
            </TouchableOpacity>
          </View>
          {obDiaSalarioIsAutre && (
            <TextInput
              value={obDiaSalarioAutreInput}
              onChangeText={v => {
                const n = v.replace(/[^0-9]/g, '')
                setObDiaSalarioAutreInput(n)
                const num = parseInt(n)
                if (num >= 1 && num <= 31) setObDiaSalario(num)
              }}
              placeholder="Jour du mois (1-31)"
              placeholderTextColor="#6b7394"
              keyboardType="number-pad"
              maxLength={2}
              style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 10, color: '#eef0f5', fontSize: 18, fontWeight: '800', textAlign: 'center', borderWidth: 1.5, borderColor: '#f5a623', marginBottom: 8 }}
            />
          )}
          <Text style={{ fontSize: 11, color: '#9ba3b8', marginBottom: 6 }}>Ce salaire correspond au travail de quel mois ?</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            <TouchableOpacity onPress={() => setObHlag(0)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: obHlag === 0 ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obHlag === 0 ? 1.5 : 1, borderColor: obHlag === 0 ? '#f5a623' : '#2a3045', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', color: obHlag === 0 ? '#f5a623' : '#eef0f5', fontSize: 13 }}>{MOIS[mesActual]}</Text>
              <Text style={{ fontWeight: '400', color: '#9ba3b8', fontSize: 10 }}>même mois</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setObHlag(1)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: obHlag === 1 ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obHlag === 1 ? 1.5 : 1, borderColor: obHlag === 1 ? '#f5a623' : '#2a3045', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', color: obHlag === 1 ? '#f5a623' : '#eef0f5', fontSize: 13 }}>{MOIS[(mesActual + 1) % 12]}</Text>
              <Text style={{ fontWeight: '400', color: '#9ba3b8', fontSize: 10 }}>1 mois après</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setObHlag(2)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: obHlag === 2 ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obHlag === 2 ? 1.5 : 1, borderColor: obHlag === 2 ? '#f5a623' : '#2a3045', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', color: obHlag === 2 ? '#f5a623' : '#eef0f5', fontSize: 13 }}>{MOIS[(mesActual + 2) % 12]}</Text>
              <Text style={{ fontWeight: '400', color: '#9ba3b8', fontSize: 10 }}>2 mois après</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>🧾 FRAIS — MÊME JOUR QUE LE SALAIRE ?</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: obFraisMemeJour ? 20 : 12 }}>
            <TouchableOpacity onPress={() => setObFraisMemeJour(true)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: obFraisMemeJour ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obFraisMemeJour ? 1.5 : 1, borderColor: obFraisMemeJour ? '#f5a623' : '#2a3045', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', color: obFraisMemeJour ? '#f5a623' : '#eef0f5', fontSize: 13 }}>Oui, même jour</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setObFraisMemeJour(false)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: !obFraisMemeJour ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: !obFraisMemeJour ? 1.5 : 1, borderColor: !obFraisMemeJour ? '#f5a623' : '#2a3045', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', color: !obFraisMemeJour ? '#f5a623' : '#eef0f5', fontSize: 13 }}>Non, autre jour</Text>
            </TouchableOpacity>
          </View>
          {!obFraisMemeJour && (
            <>
              <Text style={{ fontSize: 11, color: '#9ba3b8', marginBottom: 6 }}>Jour de réception des frais</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {[1, 5, 10, 15, 25].map(d => (
                  <TouchableOpacity key={d} onPress={() => { setObDiaFrais(d); setObDiaFraisIsAutre(false) }} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: obDiaFrais === d && !obDiaFraisIsAutre ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obDiaFrais === d && !obDiaFraisIsAutre ? 1.5 : 1, borderColor: obDiaFrais === d && !obDiaFraisIsAutre ? '#f5a623' : '#2a3045' }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: obDiaFrais === d && !obDiaFraisIsAutre ? '#f5a623' : '#eef0f5' }}>{d}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity onPress={() => setObDiaFraisIsAutre(true)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: obDiaFraisIsAutre ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obDiaFraisIsAutre ? 1.5 : 1, borderColor: obDiaFraisIsAutre ? '#f5a623' : '#2a3045' }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: obDiaFraisIsAutre ? '#f5a623' : '#eef0f5' }}>Autre</Text>
                </TouchableOpacity>
              </View>
              {obDiaFraisIsAutre && (
                <TextInput
                  value={obDiaFraisAutreInput}
                  onChangeText={v => {
                    const n = v.replace(/[^0-9]/g, '')
                    setObDiaFraisAutreInput(n)
                    const num = parseInt(n)
                    if (num >= 1 && num <= 31) setObDiaFrais(num)
                  }}
                  placeholder="Jour du mois (1-31)"
                  placeholderTextColor="#6b7394"
                  keyboardType="number-pad"
                  maxLength={2}
                  style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 10, color: '#eef0f5', fontSize: 18, fontWeight: '800', textAlign: 'center', borderWidth: 1.5, borderColor: '#f5a623', marginBottom: 8 }}
                />
              )}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
                <TouchableOpacity onPress={() => setObFlag(0)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: obFlag === 0 ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obFlag === 0 ? 1.5 : 1, borderColor: obFlag === 0 ? '#f5a623' : '#2a3045', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '800', color: obFlag === 0 ? '#f5a623' : '#eef0f5', fontSize: 12 }}>{MOIS[mesActual]}</Text>
                  <Text style={{ fontWeight: '400', color: '#9ba3b8', fontSize: 10 }}>même mois</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setObFlag(1)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: obFlag === 1 ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obFlag === 1 ? 1.5 : 1, borderColor: obFlag === 1 ? '#f5a623' : '#2a3045', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '800', color: obFlag === 1 ? '#f5a623' : '#eef0f5', fontSize: 12 }}>{MOIS[(mesActual + 1) % 12]}</Text>
                  <Text style={{ fontWeight: '400', color: '#9ba3b8', fontSize: 10 }}>1 mois après</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setObFlag(2)} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: obFlag === 2 ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: obFlag === 2 ? 1.5 : 1, borderColor: obFlag === 2 ? '#f5a623' : '#2a3045', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '800', color: obFlag === 2 ? '#f5a623' : '#eef0f5', fontSize: 12 }}>{MOIS[(mesActual + 2) % 12]}</Text>
                  <Text style={{ fontWeight: '400', color: '#9ba3b8', fontSize: 10 }}>2 mois après</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: insets.bottom > 0 ? insets.bottom + 8 : 24, paddingTop: 12 }}>
            <TouchableOpacity style={[st.btnNext, { flex: 1, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#2a3045', marginTop: 0 }]} onPress={() => setEtape(1)}>
              <Text style={[st.btnNextText, { color: '#6b7394' }]}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.btnNext, { flex: 2, marginTop: 0 }]} onPress={() => setEtape(3)}>
              <Text style={st.btnNextText}>SUIVANT →</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      )}

{/* ETAPE 3 — VÉHICULE */}
      {etape === 3 && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={st.page}>
          <View style={st.stepHeader}>
            <Text style={st.stepNum}>3 / 4</Text>
            <Text style={st.stepTitle}>🚛 Ton véhicule</Text>
            <Text style={st.stepSub}>Optionnel — tu peux le faire plus tard dans Réglages</Text>
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {/* TYPE DE VÉHICULE */}
            <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>🚛 TYPE DE VÉHICULE</Text>
            <View style={{ gap: 8, marginBottom: 20 }}>
              {[
                { val: 'semi',    label: '🚚 Semi-remorque',    sub: 'tracteur + semi, ensemble articulé' },
                { val: 'porteur', label: '🚛 Porteur',           sub: 'camion rigide, benne, citerne...' },
                { val: 'train',   label: '🚛🚌 Train routier',   sub: 'porteur + remorque' },
              ].map(({ val, label, sub }) => (
                <TouchableOpacity
                  key={val}
                  onPress={async () => { setTypeVehicule(val); await AsyncStorage.setItem('vehicule_type', val) }}
                  style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: typeVehicule === val ? 'rgba(245,166,35,0.12)' : '#181c27', borderWidth: typeVehicule === val ? 1.5 : 1, borderColor: typeVehicule === val ? '#f5a623' : '#2a3045', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: typeVehicule === val ? '#f5a623' : '#eef0f5' }}>{label}</Text>
                  <Text style={{ fontSize: 11, color: typeVehicule === val ? '#f5a623' : '#6b7394' }}>{sub}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* TYPE DE CARGAISON */}
            <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>📦 TYPE DE CARGAISON</Text>
            <View style={{ gap: 8, marginBottom: 20 }}>
              {[
                { val: 'general',  label: '📦 Général / Fourgon', sub: 'marchandise générale, rideaux' },
                { val: 'benne',    label: '🏗 Benne / TP',         sub: 'travaux publics, matériaux' },
                { val: 'frigo',    label: '🧊 Frigo / Temp. dir.', sub: 'denrées périssables' },
                { val: 'citerne',  label: '🛢 Citerne',            sub: 'liquides, produits en vrac' },
                { val: 'plateau',  label: '🪵 Plateau / Hayon',    sub: 'charges encombrantes, bois' },
                { val: 'adr',      label: '☢️ ADR — Dangereux',    sub: 'matières dangereuses' },
                { val: 'grue',    label: '🏗️ Grue / Ampliroll',   sub: 'levage, ampliroll' },
                { val: 'grumier', label: '🌲 Grumier',             sub: 'transport de bois, grumes' },
              ].map(({ val, label, sub }) => (
                <TouchableOpacity
                  key={val}
                  onPress={async () => {
                    setTypeCargo(val)
                    await AsyncStorage.setItem('cargo_type', val)
                    const cargoMap: Record<string, string> = { frigo: 'transport_frigo', adr: 'transport_adr', benne: 'transport_benne', citerne: 'transport_citerne', plateau: 'transport_plateau' }
                    for (const k of Object.values(cargoMap)) await AsyncStorage.setItem(k, 'false')
                    if (cargoMap[val]) await AsyncStorage.setItem(cargoMap[val], 'true')
                  }}
                  style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: typeCargo === val ? 'rgba(245,166,35,0.12)' : '#181c27', borderWidth: typeCargo === val ? 1.5 : 1, borderColor: typeCargo === val ? '#f5a623' : '#2a3045', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: typeCargo === val ? '#f5a623' : '#eef0f5' }}>{label}</Text>
                  <Text style={{ fontSize: 11, color: typeCargo === val ? '#f5a623' : '#6b7394' }}>{sub}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ÉQUIPEMENT EMBARQUÉ */}
            <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>🔧 ÉQUIPEMENT EMBARQUÉ</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              {[
                { key: 'chariot', label: '🏗️ Chariot', state: equipChariot, set: setEquipChariot },
                { key: 'hayon',   label: '🚪 Hayon',   state: equipHayon,   set: setEquipHayon   },
                { key: 'grue_aux',label: '🔧 Grue aux.',state: equipGrueAux, set: setEquipGrueAux },
              ].map(({ key, label, state, set }) => (
                <TouchableOpacity
                  key={key}
                  onPress={async () => { set(!state); await AsyncStorage.setItem('equipement_' + key, String(!state)) }}
                  style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, backgroundColor: state ? 'rgba(245,166,35,0.15)' : '#181c27', borderWidth: state ? 1.5 : 1, borderColor: state ? '#f5a623' : '#2a3045' }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: state ? '#f5a623' : '#6b7394' }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* TRACTEUR */}
            <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>🚛 TRACTEUR</Text>
            <View style={{ flexDirection: 'row', marginBottom: 12, gap: 8 }}>
              <TouchableOpacity
                onPress={async () => { setTracteurType('immat'); await AsyncStorage.setItem('tracteur_type', 'immat') }}
                style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: tracteurType === 'immat' ? 'rgba(245,166,35,0.12)' : '#181c27', alignItems: 'center', borderWidth: tracteurType === 'immat' ? 1.5 : 1, borderColor: tracteurType === 'immat' ? '#f5a623' : '#2a3045' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: tracteurType === 'immat' ? '#f5a623' : '#6b7394' }}>Immatriculation</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => { setTracteurType('parc'); await AsyncStorage.setItem('tracteur_type', 'parc') }}
                style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: tracteurType === 'parc' ? 'rgba(245,166,35,0.12)' : '#181c27', alignItems: 'center', borderWidth: tracteurType === 'parc' ? 1.5 : 1, borderColor: tracteurType === 'parc' ? '#f5a623' : '#2a3045' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: tracteurType === 'parc' ? '#f5a623' : '#6b7394' }}>Numéro de parc</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              value={tracteurValue}
              onChangeText={async (v) => { setTracteurValue(v); await AsyncStorage.setItem('tracteur_value', v) }}
              placeholder={tracteurType === 'immat' ? 'ex: AB-123-CD' : 'ex: T042'}
              placeholderTextColor="#6b7394"
              autoCapitalize="characters"
              style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 12, color: '#eef0f5', fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: '#2a3045', marginBottom: 20 }}
            />

            {/* SEMI-REMORQUE */}
            <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>🔗 SEMI-REMORQUE</Text>
            <View style={{ flexDirection: 'row', marginBottom: 12, gap: 8 }}>
              <TouchableOpacity
                onPress={async () => { setRemorqueType('immat'); await AsyncStorage.setItem('remorque_type', 'immat') }}
                style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: remorqueType === 'immat' ? 'rgba(245,166,35,0.12)' : '#181c27', alignItems: 'center', borderWidth: remorqueType === 'immat' ? 1.5 : 1, borderColor: remorqueType === 'immat' ? '#f5a623' : '#2a3045' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: remorqueType === 'immat' ? '#f5a623' : '#6b7394' }}>Immatriculation</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => { setRemorqueType('parc'); await AsyncStorage.setItem('remorque_type', 'parc') }}
                style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: remorqueType === 'parc' ? 'rgba(245,166,35,0.12)' : '#181c27', alignItems: 'center', borderWidth: remorqueType === 'parc' ? 1.5 : 1, borderColor: remorqueType === 'parc' ? '#f5a623' : '#2a3045' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: remorqueType === 'parc' ? '#f5a623' : '#6b7394' }}>Numéro de parc</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              value={remorqueValue}
              onChangeText={async (v) => { setRemorqueValue(v); await AsyncStorage.setItem('remorque_value', v) }}
              placeholder={remorqueType === 'immat' ? 'ex: AB-123-CD' : 'ex: AP2'}
              placeholderTextColor="#6b7394"
              autoCapitalize="characters"
              style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 12, color: '#eef0f5', fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: '#2a3045', marginBottom: 20 }}
            />


            {/* KM INITIAL */}
            <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>📍 KM AU COMPTEUR (TACOGRAPHE)</Text>
            <TextInput
              value={kmInicial}
              onChangeText={async (v) => { setKmInicial(v); if (v) await AsyncStorage.setItem('km_ultimo_fim', v) }}
              placeholder="ex: 847320"
              placeholderTextColor="#6b7394"
              keyboardType="numeric"
              style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 12, color: '#eef0f5', fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: '#2a3045', marginBottom: 20 }}
            />
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, marginBottom: insets.bottom > 0 ? insets.bottom + 8 : 24, paddingTop: 12 }}>
            <TouchableOpacity style={[st.btnNext, { flex: 1, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#2a3045' }]} onPress={() => setEtape(2)}>
              <Text style={[st.btnNextText, { color: '#6b7394' }]}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.btnNext, { flex: 2 }]} onPress={terminerOnboarding}>
              <Text style={st.btnNextText}>DÉMARRER 🚛</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      )}


      {/* DOTS */}
      <View style={st.dots}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={[st.dot, etape === i && st.dotActive]} />
        ))}
      </View>

    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1117', position: 'relative' },
  page: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },

  // Logo
  logoSection: { alignItems: 'center', marginBottom: 4 },
  logo: { fontSize: 36, fontWeight: '800', color: '#eef0f5', letterSpacing: 2 },
  accent: { color: '#f5a623' },
  logoSub: { fontSize: 12, color: '#9ba3b8', marginTop: 3 },

  // Hero
  heroSection: { alignItems: 'center', marginTop: 0, marginBottom: 8, overflow: 'hidden' },
  heroEmoji: { fontSize: 60, marginBottom: 16 },
  heroTitle: { fontSize: 25, fontWeight: '800', color: '#eef0f5', marginBottom: 8 },
  heroText: { fontSize: 13, color: '#c4c9d8', textAlign: 'center', lineHeight: 20, marginBottom: 6 },
  heroText2: { fontSize: 12, color: '#f5a623', fontWeight: '700', textAlign: 'center' },

  // Features
  features: { gap: 6, marginBottom: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#181c27', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 9, borderWidth: 1, borderColor: '#2a3045' },
  featureEmoji: { fontSize: 20 },
  featureText: { fontSize: 13, color: '#c4c9d8', fontWeight: '500' },

  // Step
  stepHeader: { marginBottom: 24 },
  stepNum: { fontSize: 11, color: '#f5a623', fontWeight: '700', letterSpacing: 2, marginBottom: 8 },
  stepTitle: { fontSize: 26, fontWeight: '800', color: '#eef0f5', marginBottom: 6 },
  stepSub: { fontSize: 13, color: '#9ba3b8' },

  // Nom
  nomSection: { marginBottom: 20 },
  nomLabel: { fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  nomInput: { backgroundColor: '#181c27', borderWidth: 2, borderColor: '#2a3045', borderRadius: 14, padding: 16, fontSize: 16, color: '#eef0f5', fontWeight: '600' },

  // Profil
  profilSection: { gap: 12, marginBottom: 24 },
  profilCard: { backgroundColor: '#181c27', borderWidth: 2, borderColor: '#2a3045', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profilCardActive: { borderColor: '#f5a623', backgroundColor: 'rgba(245,166,35,0.06)' },
  profilCardLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  profilEmoji: { fontSize: 28 },
  profilInfo: { flex: 1 },
  profilTitre: { fontSize: 16, fontWeight: '800', color: '#eef0f5', marginBottom: 4 },
  profilDesc: { fontSize: 12, color: '#6b7394', lineHeight: 18, marginBottom: 4 },
  profilLimites: { fontSize: 11, color: '#6b7394', fontWeight: '700' },
  profilCheck: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#2a3045', alignItems: 'center', justifyContent: 'center' },
  profilCheckActive: { backgroundColor: '#f5a623', borderColor: '#f5a623' },

  // Buttons
  btnNext: { backgroundColor: '#f5a623', borderRadius: 16, padding: 14, alignItems: 'center' },
  btnNextText: { fontSize: 15, fontWeight: '800', color: 'white', letterSpacing: 1 },
  btnStart: { backgroundColor: '#f5a623', borderRadius: 16, padding: 14, alignItems: 'center' },
  btnStartText: { fontSize: 15, fontWeight: '800', color: 'white', letterSpacing: 1 },

  // Dots
  dots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a3045' },
  dotActive: { backgroundColor: '#f5a623', width: 24 },
})
