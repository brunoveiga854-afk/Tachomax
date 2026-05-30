import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, TextInput, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'

const { width } = Dimensions.get('window')

type Profil = 'CD' | 'MIXTE' | 'LD'

export default function OnboardingScreen() {
  const [etape, setEtape] = useState(0)
  const [nom, setNom] = useState('Bruno')
  const [profil, setProfil] = useState<Profil>('MIXTE')

  const terminerOnboarding = async () => {
    await AsyncStorage.setItem('onboardingDone', 'true')
    await AsyncStorage.setItem('profil', profil)
    await AsyncStorage.setItem('nom', nom)
    await AsyncStorage.setItem('conducteur_nom', nom)
    router.replace('/(tabs)')
  }

  return (
    <SafeAreaView style={st.safe}>

      {/* ETAPE 0 — BOAS VINDAS */}
      {etape === 0 && (
        <View style={st.page}>
          <View style={st.logoSection}>
            <Text style={st.logo}>TACHO<Text style={st.accent}>MAX</Text></Text>
            <Text style={st.logoSub}>L'app du chauffeur professionnel</Text>
          </View>

          <View style={st.heroSection}>
            <Text style={st.heroEmoji}>🚛</Text>
            <Text style={st.heroTitle}>Bienvenue !</Text>
            <Text style={st.heroText}>
              TachoMax calcule automatiquement tes heures, tes frais et t'alerte avant les limites légales.
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

          <TouchableOpacity style={st.btnNext} onPress={() => setEtape(1)}>
            <Text style={st.btnNextText}>COMMENCER →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ETAPE 1 — PERFIL */}
      {etape === 1 && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={st.page}>
          <View style={st.stepHeader}>
            <Text style={st.stepNum}>1 / 2</Text>
            <Text style={st.stepTitle}>Quel est ton profil ?</Text>
            <Text style={st.stepSub}>Tu pourras changer à tout moment dans les Réglages</Text>
          </View>

          <View style={st.nomSection}>
            <Text style={st.nomLabel}>Ton prénom</Text>
            <TextInput
              style={st.nomInput}
              value={nom}
              onChangeText={setNom}
              placeholder="Ex: Bruno"
              placeholderTextColor="#6b7394"
              autoCapitalize="words"
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

          <TouchableOpacity style={st.btnNext} onPress={() => setEtape(2)}>
            <Text style={st.btnNextText}>SUIVANT →</Text>
          </TouchableOpacity>
        </View>
        </KeyboardAvoidingView>
      )}

      {/* ETAPE 2 — TRIAL */}
      {etape === 2 && (
        <View style={st.page}>
          <View style={st.stepHeader}>
            <Text style={st.stepNum}>2 / 2</Text>
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

          <TouchableOpacity style={st.btnStart} onPress={terminerOnboarding}>
            <Text style={st.btnStartText}>🚛 DÉMARRER GRATUITEMENT</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* DOTS */}
      <View style={st.dots}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[st.dot, etape === i && st.dotActive]} />
        ))}
      </View>

    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1117' },
  page: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },

  // Logo
  logoSection: { alignItems: 'center', marginBottom: 32 },
  logo: { fontSize: 36, fontWeight: '800', color: '#eef0f5', letterSpacing: 2 },
  accent: { color: '#f5a623' },
  logoSub: { fontSize: 13, color: '#6b7394', marginTop: 4 },

  // Hero
  heroSection: { alignItems: 'center', marginBottom: 32 },
  heroEmoji: { fontSize: 60, marginBottom: 16 },
  heroTitle: { fontSize: 28, fontWeight: '800', color: '#eef0f5', marginBottom: 12 },
  heroText: { fontSize: 14, color: '#c4c9d8', textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  heroText2: { fontSize: 13, color: '#f5a623', fontWeight: '700', textAlign: 'center' },

  // Features
  features: { gap: 12, marginBottom: 32 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#181c27', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2a3045' },
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
  btnNext: { backgroundColor: '#f5a623', borderRadius: 16, padding: 18, alignItems: 'center', marginTop: 'auto' as any, marginBottom: 8 },
  btnNextText: { fontSize: 15, fontWeight: '800', color: 'white', letterSpacing: 1 },
  btnStart: { backgroundColor: '#f5a623', borderRadius: 16, padding: 18, alignItems: 'center', marginTop: 'auto' as any, marginBottom: 8 },
  btnStartText: { fontSize: 15, fontWeight: '800', color: 'white', letterSpacing: 1 },

  // Dots
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a3045' },
  dotActive: { backgroundColor: '#f5a623', width: 24 },
})