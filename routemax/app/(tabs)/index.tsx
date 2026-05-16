/**
 * ROUTEMAX — Ecrã Principal (Aujourd'hui)
 * Timer + DÉMARRER / PAUSE / REPRENDRE / TERMINER
 * Toggle Découché + Limites legais
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Switch, Alert
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useServiceStore } from '../../src/stores/serviceStore'
import { useProfilStore } from '../../src/stores/profileStore'
import { calculerLimitesJour, formaterMinutes } from '../../src/engine/limites'
import { calculerFrais } from '../../src/engine/frais'
import { Colors, Spacing, Radius } from '../../src/theme/colors'

export default function AujourdhuiScreen() {
  const {
    enService, pauseActive, jourActuel,
    demarrer, pauseDebut, pauseFin, terminer, toggleDecouche
  } = useServiceStore()

  const { profil, theme, nom, fraisConfig } = useProfilStore()

  const [tempsEcoule, setTempsEcoule] = useState(0)        // segundos
  const [tempsPause, setTempsPause] = useState(0)
  const [conduiteMinutes, setConduiteMinutes] = useState(0)

  const C = theme === 'dark' ? Colors.dark : Colors.light

  // ── Cronómetro ──────────────────────────────────────
  useEffect(() => {
    if (!enService || !jourActuel?.debut) return

    const interval = setInterval(() => {
      const agora = new Date()
      const inicio = new Date(jourActuel.debut!)
      const totalSeg = Math.floor((agora.getTime() - inicio.getTime()) / 1000)

      // Calcular tempo total de pausas
      let pausasSeg = 0
      for (const pausa of jourActuel.pauses) {
        const fim = pausa.fin ? new Date(pausa.fin) : agora
        pausasSeg += Math.floor((fim.getTime() - new Date(pausa.debut).getTime()) / 1000)
      }

      setTempsEcoule(totalSeg)
      setTempsPause(pausasSeg)
      setConduiteMinutes(Math.floor((totalSeg - pausasSeg) / 60))
    }, 1000)

    return () => clearInterval(interval)
  }, [enService, jourActuel, pauseActive])

  // ── Formatação do timer ──────────────────────────────
  const formatTimer = (segundos: number) => {
    const h = Math.floor(segundos / 3600)
    const m = Math.floor((segundos % 3600) / 60)
    const s = segundos % 60
    return {
      h: h.toString().padStart(2, '0'),
      m: m.toString().padStart(2, '0'),
      s: s.toString().padStart(2, '0'),
    }
  }

  const timer = formatTimer(enService ? tempsEcoule : 0)
  const serviceMinutes = Math.floor(tempsEcoule / 60)
  const amplitudeMinutes = serviceMinutes // simplificado

  // ── Limites ──────────────────────────────────────────
  const limites = enService
    ? calculerLimitesJour(
        conduiteMinutes,
        serviceMinutes,
        amplitudeMinutes,
        conduiteMinutes, // conduite depuis dernière pause (simplificado)
        false
      )
    : null

  // ── Frais ─────────────────────────────────────────────
  const fraisHoje = jourActuel?.debut && jourActuel?.fin
    ? calculerFrais(
        new Date(jourActuel.debut),
        new Date(jourActuel.fin),
        jourActuel.decouche,
        fraisConfig
      )
    : null

  // ── Handlers ─────────────────────────────────────────
  const handleTerminer = () => {
    Alert.alert(
      'Terminer le service ?',
      'Confirmes-tu la fin de ton service ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Terminer', style: 'destructive', onPress: terminer },
      ]
    )
  }

  const s = StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.bg },
    scroll: { flex: 1 },

    // Header
    header: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    },
    appName: {
      fontSize: 28, fontWeight: '800',
      color: C.text, letterSpacing: 1,
    },
    appNameAccent: { color: Colors.accent },
    profilBadge: {
      backgroundColor: C.surface2, borderWidth: 1,
      borderColor: C.border, borderRadius: Radius.full,
      paddingHorizontal: 12, paddingVertical: 5,
    },
    profilBadgeText: {
      fontSize: 11, fontWeight: '700',
      color: Colors.accent, letterSpacing: 1,
    },

    // Saudação
    greeting: {
      paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg,
    },
    greetingLabel: {
      fontSize: 13, fontWeight: '600',
      color: C.muted, letterSpacing: 2,
      textTransform: 'uppercase',
    },
    greetingName: {
      fontSize: 26, fontWeight: '800', color: C.text,
    },

    // Timer card
    timerCard: {
      marginHorizontal: Spacing.xl, marginBottom: Spacing.md,
      backgroundColor: C.surface, borderRadius: Radius.lg,
      borderWidth: 1, borderColor: C.border,
      padding: Spacing.lg, overflow: 'hidden',
    },
    timerAccentBar: {
      position: 'absolute', top: 0, left: 0, right: 0, height: 3,
      backgroundColor: Colors.accent,
    },
    timerStatus: {
      flexDirection: 'row', alignItems: 'center',
      gap: 6, marginBottom: 4,
    },
    timerDot: {
      width: 7, height: 7, borderRadius: 4,
      backgroundColor: Colors.green,
    },
    timerStatusText: {
      fontSize: 11, fontWeight: '700',
      color: Colors.green, letterSpacing: 3,
      textTransform: 'uppercase',
    },
    timerDisplay: {
      flexDirection: 'row', alignItems: 'baseline',
    },
    timerDigits: {
      fontSize: 56, fontWeight: '800',
      color: C.text, letterSpacing: -1,
    },
    timerSep: { fontSize: 56, fontWeight: '800', color: Colors.accent },
    timerMeta: {
      flexDirection: 'row', gap: 16, marginTop: 8, flexWrap: 'wrap',
    },
    timerMetaText: { fontSize: 12, color: C.muted },
    timerMetaVal: { fontWeight: '600', color: C.text },

    // Alerta de pausa
    alertBanner: {
      marginHorizontal: Spacing.xl, marginBottom: Spacing.md,
      backgroundColor: 'rgba(243,156,18,0.08)',
      borderWidth: 1, borderColor: 'rgba(243,156,18,0.25)',
      borderRadius: Radius.md, padding: 11,
      flexDirection: 'row', gap: 10, alignItems: 'center',
    },
    alertText: { fontSize: 12, color: Colors.yellow, flex: 1 },

    // Botões de acção
    actionRow: {
      flexDirection: 'row', gap: 10,
      marginHorizontal: Spacing.xl, marginBottom: Spacing.md,
    },
    btnPause: {
      flex: 1, backgroundColor: C.surface,
      borderWidth: 2, borderColor: Colors.yellow,
      borderRadius: Radius.md, padding: Spacing.lg,
      alignItems: 'center', gap: 5,
    },
    btnStop: {
      flex: 1, backgroundColor: C.surface,
      borderWidth: 2, borderColor: Colors.red,
      borderRadius: Radius.md, padding: Spacing.lg,
      alignItems: 'center', gap: 5,
    },
    btnDemarrer: {
      marginHorizontal: Spacing.xl, marginBottom: Spacing.md,
      backgroundColor: Colors.accent,
      borderRadius: Radius.lg, padding: 22,
      alignItems: 'center',
      shadowColor: Colors.accent, shadowOpacity: 0.3,
      shadowOffset: { width: 0, height: 8 }, shadowRadius: 20,
      elevation: 8,
    },
    btnIcon: { fontSize: 24 },
    btnLabelPause: {
      fontSize: 15, fontWeight: '700',
      color: Colors.yellow, letterSpacing: 1,
      textTransform: 'uppercase',
    },
    btnLabelStop: {
      fontSize: 15, fontWeight: '700',
      color: Colors.red, letterSpacing: 1,
      textTransform: 'uppercase',
    },
    btnLabelDemarrer: {
      fontSize: 22, fontWeight: '800',
      color: 'white', letterSpacing: 2,
      textTransform: 'uppercase',
    },
    btnSub: { fontSize: 10, color: C.muted },

    // Toggle découché
    decoucheCard: {
      marginHorizontal: Spacing.xl, marginBottom: Spacing.md,
      backgroundColor: C.surface, borderWidth: 1,
      borderColor: C.border, borderRadius: Radius.md,
      padding: Spacing.lg, flexDirection: 'row',
      justifyContent: 'space-between', alignItems: 'center',
    },
    decoucheLabel: {
      fontSize: 14, fontWeight: '700',
      color: C.text, letterSpacing: 1,
      textTransform: 'uppercase',
    },
    decoucheSub: { fontSize: 11, color: C.muted, marginTop: 2 },

    // Limites
    limitesSection: { marginHorizontal: Spacing.xl, marginBottom: Spacing.md },
    limitesTitle: {
      fontSize: 11, fontWeight: '700',
      color: C.muted, letterSpacing: 3,
      textTransform: 'uppercase', marginBottom: 10,
    },
    limiteItem: { marginBottom: 10 },
    limiteHeader: {
      flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5,
    },
    limiteName: { fontSize: 12, fontWeight: '600', color: C.text2 },
    limiteVal: { fontSize: 12, fontWeight: '700' },
    progressBg: {
      height: 6, backgroundColor: C.surface2, borderRadius: 3, overflow: 'hidden',
    },
    progressFill: { height: '100%', borderRadius: 3 },
  })

  const getLimiteColor = (nivel: string) => {
    if (nivel === 'danger') return Colors.red
    if (nivel === 'attention') return Colors.yellow
    return Colors.green
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.appName}>
            ROUTE<Text style={s.appNameAccent}>MAX</Text>
          </Text>
          <View style={s.profilBadge}>
            <Text style={s.profilBadgeText}>{profil}</Text>
          </View>
        </View>

        {/* Saudação */}
        <View style={s.greeting}>
          <Text style={s.greetingLabel}>Bonjour,</Text>
          <Text style={s.greetingName}>{nom || 'Chauffeur'} 👋</Text>
        </View>

        {/* Timer — só mostra quando em serviço */}
        {enService && (
          <View style={s.timerCard}>
            <View style={s.timerAccentBar} />
            <View style={s.timerStatus}>
              <View style={s.timerDot} />
              <Text style={s.timerStatusText}>
                {pauseActive ? 'EN PAUSE' : 'EN SERVICE'}
              </Text>
            </View>
            <View style={s.timerDisplay}>
              <Text style={s.timerDigits}>{timer.h}</Text>
              <Text style={s.timerSep}>:</Text>
              <Text style={s.timerDigits}>{timer.m}</Text>
              <Text style={s.timerSep}>:</Text>
              <Text style={s.timerDigits}>{timer.s}</Text>
            </View>
            <View style={s.timerMeta}>
              <Text style={s.timerMetaText}>
                Conduite <Text style={s.timerMetaVal}>{formaterMinutes(conduiteMinutes)}</Text>
              </Text>
              {limites?.pauseProchaine !== null && limites?.pauseProchaine !== undefined && (
                <Text style={s.timerMetaText}>
                  Pause dans{' '}
                  <Text style={[s.timerMetaVal, { color: Colors.yellow }]}>
                    {Math.round(limites.pauseProchaine!)}min
                  </Text>
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Alerta de pausa */}
        {enService && limites?.pauseProchaine !== null &&
          limites?.pauseProchaine !== undefined &&
          limites.pauseProchaine <= 30 && (
          <View style={s.alertBanner}>
            <Text style={{ fontSize: 16 }}>⚠️</Text>
            <Text style={s.alertText}>
              {limites.pauseProchaine <= 0
                ? 'Pause obligatoire maintenant !'
                : `Pause obligatoire dans ${Math.round(limites.pauseProchaine)} minutes`
              }
            </Text>
          </View>
        )}

        {/* Botões */}
        {!enService ? (
          <TouchableOpacity style={s.btnDemarrer} onPress={demarrer}>
            <Text style={{ fontSize: 40, marginBottom: 4 }}>▶</Text>
            <Text style={s.btnLabelDemarrer}>DÉMARRER</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.actionRow}>
            <TouchableOpacity
              style={s.btnPause}
              onPress={pauseActive ? pauseFin : pauseDebut}
            >
              <Text style={s.btnIcon}>{pauseActive ? '▶' : '⏸'}</Text>
              <Text style={s.btnLabelPause}>
                {pauseActive ? 'REPRENDRE' : 'PAUSE'}
              </Text>
              <Text style={s.btnSub}>Durée libre</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.btnStop} onPress={handleTerminer}>
              <Text style={s.btnIcon}>⏹</Text>
              <Text style={s.btnLabelStop}>TERMINER</Text>
              <Text style={s.btnSub}>Fin de service</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Toggle Découché */}
        {enService && (
          <View style={s.decoucheCard}>
            <View>
              <Text style={s.decoucheLabel}>🌙 Découché ce soir</Text>
              <Text style={s.decoucheSub}>Frais appliqués automatiquement</Text>
            </View>
            <Switch
              value={jourActuel?.decouche ?? false}
              onValueChange={toggleDecouche}
              trackColor={{ false: C.border, true: Colors.accent }}
              thumbColor="white"
            />
          </View>
        )}

        {/* Limites légales */}
        {enService && limites && (
          <View style={s.limitesSection}>
            <Text style={s.limitesTitle}>Limites légales</Text>

            {[
              { label: "Conduite aujourd'hui", status: limites.conduite },
              { label: 'Service total', status: limites.service },
              { label: 'Amplitude', status: limites.amplitude },
            ].map((item) => (
              <View key={item.label} style={s.limiteItem}>
                <View style={s.limiteHeader}>
                  <Text style={s.limiteName}>{item.label}</Text>
                  <Text style={[s.limiteVal, { color: getLimiteColor(item.status.niveau) }]}>
                    {formaterMinutes(item.status.valeur)} / {formaterMinutes(item.status.maximum)}
                  </Text>
                </View>
                <View style={s.progressBg}>
                  <View
                    style={[
                      s.progressFill,
                      {
                        width: `${item.status.pourcentage}%` as any,
                        backgroundColor: getLimiteColor(item.status.niveau),
                      }
                    ]}
                  />
                </View>
                {item.status.message && (
                  <Text style={{ fontSize: 10, color: Colors.yellow, marginTop: 3 }}>
                    {item.status.message}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  )
}
