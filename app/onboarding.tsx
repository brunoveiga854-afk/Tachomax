import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, TextInput, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { TachoLogo } from '../src/TachoLogo'

const { width } = Dimensions.get('window')

type Profil = 'CD' | 'MIXTE' | 'LD'

export default function OnboardingScreen() {
  const [etape, setEtape] = useState(0)
  const [prenom, setPrenom] = useState('')
  const [nom, setNom] = useState('')
  const [profil, setProfil] = useState<Profil>('MIXTE')
  const [tracteurType, setTracteurType] = useState<'immat' | 'parc'>('immat')
  const [tracteurValue, setTracteurValue] = useState('')
  const [remorqueType, setRemorqueType] = useState<'immat' | 'parc'>('immat')
  const [remorqueValue, setRemorqueValue] = useState('')
  const [chariotEmbarque, setChariotEmbarque] = useState(false)
  const [typeVehicule, setTypeVehicule] = useState('semi')
  const [typeCargo, setTypeCargo] = useState('general')
  const [kmInicial, setKmInicial] = useState('')
  // Contrato (etapa 2)
  const [ancienneteAns, setAncienneteAns] = useState('')
  const [ancienneteMois, setAncienneteMois] = useState('')
  const [coefficient, setCoefficient] = useState('')
  const [salBaseEstime, setSalBaseEstime] = useState('')
  const [heuresMensuel, setHeuresMensuel] = useState('')

  const terminerOnboarding = async () => {
    await AsyncStorage.setItem('onboardingDone', 'true')
    if (ancienneteAns || ancienneteMois)
      await AsyncStorage.setItem('anciennete', `${ancienneteAns || '0'} ans ${ancienneteMois || '0'} mois`)
    if (coefficient) await AsyncStorage.setItem('coefficient', coefficient)
    if (salBaseEstime) await AsyncStorage.setItem('sal_base_estime', salBaseEstime)
    if (heuresMensuel) await AsyncStorage.setItem('heures_mensuel', heuresMensuel)
    await AsyncStorage.setItem('vehicule_type', typeVehicule)
    await AsyncStorage.setItem('cargo_type', typeCargo)
    await AsyncStorage.setItem('profil', profil)
    if (prenom) await AsyncStorage.setItem('conducteur_prenom', prenom)
    if (nom) await AsyncStorage.setItem('conducteur_nom', nom)
    // backward compat — keep 'nom' with prenom for the main screen greeting
    await AsyncStorage.setItem('nom', prenom || nom)
    router.replace('/(tabs)/fiche')
  }

  return (
    <SafeAreaView style={st.safe}>

      {/* ETAPE 0 — BOAS VINDAS */}
      {etape === 0 && (
        <View style={st.page}>
          <View style={st.logoSection}>
            <TachoLogo size={32} textColor='#ffffff' />
            <Text style={st.logoSub}>L'app du chauffeur professionnel</Text>
          </View>

          <View style={st.heroSection}>
            <View style={{ width: width, marginHorizontal: -24, marginBottom: 8, position: 'relative' }}>
            <Image
              source={require('../assets/images/icon.png')}
              style={{ width: width, height: Math.round(width * 0.50), resizeMode: 'contain' }}
            />
            {/* Fade esquerdo */}
            {[0.85, 0.6, 0.4, 0.22, 0.1].map((op, i) => (
              <View key={'l'+i} style={{ position: 'absolute', left: i * 12, top: 0, bottom: 0, width: 14, backgroundColor: '#0f1117', opacity: op }} />
            ))}
            {/* Fade direito */}
            {[0.85, 0.6, 0.4, 0.22, 0.1].map((op, i) => (
              <View key={'r'+i} style={{ position: 'absolute', right: i * 12, top: 0, bottom: 0, width: 14, backgroundColor: '#0f1117', opacity: op }} />
            ))}
            {/* Fade inferior */}
            {[0.7, 0.4, 0.15].map((op, i) => (
              <View key={'b'+i} style={{ position: 'absolute', left: 0, right: 0, bottom: i * 10, height: 12, backgroundColor: '#0f1117', opacity: op }} />
            ))}
          </View>
            <Text style={st.heroTitle}>Bienvenue !</Text>
            <Text style={st.heroText}>
              TachoOffice calcule automatiquement tes heures, tes frais et t'alerte avant les limites légales.
            </Text>
            <Text style={st.heroText2}>
              Minimum de saisie. Maximum de précision.
            </Text>
          </View>

          <View style={st.features}>
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

          <TouchableOpacity style={[st.btnNext, { marginTop: 'auto' as any, marginBottom: 32 }]} onPress={() => setEtape(1)}>
            <Text style={st.btnNextText}>COMMENCER →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ETAPE 1 — PERFIL */}
      {etape === 1 && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={st.page}>
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

          <View style={st.profilSection}>
            {[
              {
                id: 'CD' as Profil,
                emoji: '🏠',
                titre: 'Courte Distance',
                desc: 'Je rentre à la maison tous les jours. Découché exceptionnel.',
                limites: 'Max 52h/semaine'
              },
              {
                id: 'MIXTE' as Profil,
                emoji: '🔄',
                titre: 'Mixte',
                desc: 'Surtout local, 1–2 découchés par semaine selon les missions.',
                limites: 'Max 56h/semaine'
              },
              {
                id: 'LD' as Profil,
                emoji: '🛣️',
                titre: 'Longue Distance',
                desc: 'Je fais découché toute la semaine. Je rentre le week-end.',
                limites: 'Max 56h/semaine'
              },
            ].map(p => (
              <TouchableOpacity
                key={p.id}
                style={[st.profilCard, profil === p.id && st.profilCardActive]}
                onPress={() => setProfil(p.id)}
              >
                <View style={st.profilCardLeft}>
                  <Text style={st.profilEmoji}>{p.emoji}</Text>
                  <View style={st.profilInfo}>
                    <Text style={[st.profilTitre, profil === p.id && { color: '#f5a623' }]}>{p.titre}</Text>
                    <Text style={st.profilDesc}>{p.desc}</Text>
                    <Text style={[st.profilLimites, profil === p.id && { color: '#f5a623' }]}>{p.limites}</Text>
                  </View>
                </View>
                <View style={[st.profilCheck, profil === p.id && st.profilCheckActive]}>
                  {profil === p.id && <Text style={{ color: 'white', fontSize: 12, fontWeight: '800' }}>✓</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 'auto' as any, marginBottom: 32, paddingTop: 12 }}>
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={st.stepHeader}>
            <Text style={st.stepNum}>2 / 4</Text>
            <Text style={st.stepTitle}>📋 Ton contrat</Text>
            <Text style={st.stepSub}>Ces infos affinent les estimations de salaire. Tu peux laisser vide.</Text>
          </View>

          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>📅 ANCIENNETÉ DANS L'ENTREPRISE</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: '#6b7394', marginBottom: 6, textAlign: 'center' }}>Années</Text>
              <TextInput
                value={ancienneteAns}
                onChangeText={v => setAncienneteAns(v.replace(/[^0-9]/g, ''))}
                placeholder="ex: 4"
                placeholderTextColor="#6b7394"
                keyboardType="number-pad"
                maxLength={2}
                style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 10, color: '#eef0f5', fontSize: 18, fontWeight: '800', textAlign: 'center', borderWidth: 1, borderColor: '#2a3045' }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: '#6b7394', marginBottom: 6, textAlign: 'center' }}>Mois</Text>
              <TextInput
                value={ancienneteMois}
                onChangeText={v => { const n = parseInt(v.replace(/[^0-9]/g,'')) || 0; setAncienneteMois(n <= 11 ? String(n || '') : '11') }}
                placeholder="ex: 5"
                placeholderTextColor="#6b7394"
                keyboardType="number-pad"
                maxLength={2}
                style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 10, color: '#eef0f5', fontSize: 18, fontWeight: '800', textAlign: 'center', borderWidth: 1, borderColor: '#2a3045' }}
              />
            </View>
          </View>

          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>⚖️ COEFFICIENT CONVENTIONNEL</Text>
          <Text style={{ fontSize: 11, color: '#6b7394', marginBottom: 8, lineHeight: 16 }}>Sur ta fiche de paie (ex: 138, 150…). Laisse vide si tu ne sais pas.</Text>
          <TextInput
            value={coefficient}
            onChangeText={v => setCoefficient(v.replace(/[^0-9]/g, ''))}
            placeholder="ex: 138"
            placeholderTextColor="#6b7394"
            keyboardType="number-pad"
            maxLength={3}
            style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 10, color: '#eef0f5', fontSize: 16, fontWeight: '700', borderWidth: 1, borderColor: '#2a3045', marginBottom: 16 }}
          />

          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>💶 SALAIRE NET MENSUEL (approximatif)</Text>
          <Text style={{ fontSize: 11, color: '#6b7394', marginBottom: 8, lineHeight: 16 }}>Sans les frais. Permet de calibrer les estimations dès l'installation.</Text>
          <TextInput
            value={salBaseEstime}
            onChangeText={v => setSalBaseEstime(v.replace(/[^0-9]/g, ''))}
            placeholder="ex: 2300"
            placeholderTextColor="#6b7394"
            keyboardType="number-pad"
            maxLength={5}
            style={{ backgroundColor: '#181c27', borderRadius: 10, padding: 10, color: '#eef0f5', fontSize: 16, fontWeight: '700', borderWidth: 1, borderColor: '#2a3045', marginBottom: 20 }}
          />

          <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>⏱️ HEURES TRAVAILLÉES PAR MOIS</Text>
          <Text style={{ fontSize: 11, color: '#6b7394', marginBottom: 8, lineHeight: 16 }}>Base légale : 169h/mois. Au-delà → heures supp. Laisse vide si tu ne sais pas.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28 }}>
            <TextInput
              value={heuresMensuel}
              onChangeText={v => { const n = parseInt(v.replace(/[^0-9]/g,'')) || 0; setHeuresMensuel(n <= 300 ? String(n || '') : '300') }}
              placeholder="ex: 186"
              placeholderTextColor="#6b7394"
              keyboardType="number-pad"
              maxLength={3}
              style={{ flex: 1, backgroundColor: '#181c27', borderRadius: 10, padding: 10, color: '#eef0f5', fontSize: 22, fontWeight: '800', textAlign: 'center', borderWidth: 1, borderColor: '#2a3045' }}
            />
            <Text style={{ fontSize: 13, color: '#6b7394', flex: 2, lineHeight: 18 }}>{'heures / mois (légal: 169h)'}</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 32, paddingTop: 12 }}>
            <TouchableOpacity style={[st.btnNext, { flex: 1, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#2a3045', marginTop: 0 }]} onPress={() => setEtape(1)}>
              <Text style={[st.btnNextText, { color: '#6b7394' }]}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.btnNext, { flex: 2, marginTop: 0 }]} onPress={() => setEtape(3)}>
              <Text style={st.btnNextText}>SUIVANT →</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
              ].map(({ val, label, sub }) => (
                <TouchableOpacity
                  key={val}
                  onPress={async () => { setTypeCargo(val); await AsyncStorage.setItem('cargo_type', val) }}
                  style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, backgroundColor: typeCargo === val ? 'rgba(245,166,35,0.12)' : '#181c27', borderWidth: typeCargo === val ? 1.5 : 1, borderColor: typeCargo === val ? '#f5a623' : '#2a3045', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: typeCargo === val ? '#f5a623' : '#eef0f5' }}>{label}</Text>
                  <Text style={{ fontSize: 11, color: typeCargo === val ? '#f5a623' : '#6b7394' }}>{sub}</Text>
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

            {/* CHARIOT EMBARQUÉ */}
            <Text style={{ fontSize: 12, color: '#f5a623', fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>🔧 CHARIOT EMBARQUÉ</Text>
            <View style={{ flexDirection: 'row', marginBottom: 20, gap: 8 }}>
              <TouchableOpacity
                onPress={async () => { setChariotEmbarque(true); await AsyncStorage.setItem('chariot_embarque', 'true') }}
                style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: chariotEmbarque ? 'rgba(245,166,35,0.12)' : '#181c27', alignItems: 'center', borderWidth: chariotEmbarque ? 1.5 : 1, borderColor: chariotEmbarque ? '#f5a623' : '#2a3045' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: chariotEmbarque ? '#f5a623' : '#6b7394' }}>Oui</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => { setChariotEmbarque(false); await AsyncStorage.setItem('chariot_embarque', 'false') }}
                style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: !chariotEmbarque ? 'rgba(245,166,35,0.12)' : '#181c27', alignItems: 'center', borderWidth: !chariotEmbarque ? 1.5 : 1, borderColor: !chariotEmbarque ? '#f5a623' : '#2a3045' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: !chariotEmbarque ? '#f5a623' : '#6b7394' }}>Non</Text>
              </TouchableOpacity>
            </View>

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

          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 32, paddingTop: 12 }}>
            <TouchableOpacity style={[st.btnNext, { flex: 1, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#2a3045' }]} onPress={() => setEtape(2)}>
              <Text style={[st.btnNextText, { color: '#6b7394' }]}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.btnNext, { flex: 2 }]} onPress={() => setEtape(4)}>
              <Text style={st.btnNextText}>SUIVANT →</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      )}

      {/* ETAPE 4 — TRIAL */}
      {etape === 4 && (
        <View style={st.page}>
          <View style={st.stepHeader}>
            <Text style={st.stepNum}>4 / 4</Text>
            <Text style={st.stepTitle}>60 jours gratuits</Text>
            <Text style={st.stepSub}>Accès complet à toutes les fonctionnalités</Text>
          </View>

          <View style={st.trialSection}>
            <Text style={st.trialEmoji}>🎉</Text>
            <Text style={st.trialDays}>60</Text>
            <Text style={st.trialLabel}>jours d'essai gratuit</Text>
            <Text style={st.trialSub}>Aucune carte bancaire requise</Text>
          </View>

          <View style={st.trialFeatures}>
            {[
              '✅ Chronomètre et historique complet',
              '✅ Frais calculés automatiquement',
              '✅ IA lecture fiche de paie',
              '✅ Alertes limites légales',
              '✅ Rapport mensuel exportable',
            ].map(item => (
              <Text key={item} style={st.trialFeatureText}>{item}</Text>
            ))}
          </View>

          <View style={st.trialPrix}>
            <Text style={st.trialPrixText}>Après 60 jours</Text>
            <Text style={st.trialPrixVal}>2,99€/mois</Text>
            <Text style={st.trialPrixSub}>Annulable à tout moment</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 32, paddingTop: 12 }}>
            <TouchableOpacity style={[st.btnNext, { flex: 1, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#2a3045' }]} onPress={() => setEtape(3)}>
              <Text style={[st.btnNextText, { color: '#6b7394' }]}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.btnStart, { flex: 2 }]} onPress={terminerOnboarding}>
              <Text style={st.btnStartText}>🚛 DÉMARRER</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* DOTS */}
      <View style={st.dots}>
        {[0, 1, 2, 3, 4].map(i => (
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
  logoSection: { alignItems: 'center', marginBottom: 16 },
  logo: { fontSize: 36, fontWeight: '800', color: '#eef0f5', letterSpacing: 2 },
  accent: { color: '#f5a623' },
  logoSub: { fontSize: 13, color: '#6b7394', marginTop: 4 },

  // Hero
  heroSection: { alignItems: 'center', marginBottom: 12, overflow: 'hidden' },
  heroEmoji: { fontSize: 60, marginBottom: 16 },
  heroTitle: { fontSize: 28, fontWeight: '800', color: '#eef0f5', marginBottom: 12 },
  heroText: { fontSize: 14, color: '#c4c9d8', textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  heroText2: { fontSize: 13, color: '#f5a623', fontWeight: '700', textAlign: 'center' },

  // Features
  features: { gap: 6, marginBottom: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#181c27', borderRadius: 10, padding: 9, borderWidth: 1, borderColor: '#2a3045' },
  featureEmoji: { fontSize: 20 },
  featureText: { fontSize: 13, color: '#c4c9d8', fontWeight: '500' },

  // Step
  stepHeader: { marginBottom: 24 },
  stepNum: { fontSize: 11, color: '#f5a623', fontWeight: '700', letterSpacing: 2, marginBottom: 8 },
  stepTitle: { fontSize: 26, fontWeight: '800', color: '#eef0f5', marginBottom: 6 },
  stepSub: { fontSize: 13, color: '#6b7394' },

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

  // Trial
  trialSection: { alignItems: 'center', marginBottom: 24 },
  trialEmoji: { fontSize: 48, marginBottom: 8 },
  trialDays: { fontSize: 72, fontWeight: '800', color: '#f5a623', lineHeight: 80 },
  trialLabel: { fontSize: 18, fontWeight: '700', color: '#eef0f5', marginBottom: 4 },
  trialSub: { fontSize: 13, color: '#6b7394' },
  trialFeatures: { backgroundColor: '#181c27', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2a3045', marginBottom: 20, gap: 10 },
  trialFeatureText: { fontSize: 14, color: '#c4c9d8', fontWeight: '500' },

  // Prix
  trialPrix: { alignItems: 'center', marginBottom: 24 },
  trialPrixText: { fontSize: 13, color: '#6b7394', marginBottom: 4 },
  trialPrixVal: { fontSize: 22, fontWeight: '800', color: '#eef0f5' },
  trialPrixSub: { fontSize: 12, color: '#6b7394', marginTop: 4 },

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
