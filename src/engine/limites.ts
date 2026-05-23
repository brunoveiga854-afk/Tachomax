/**
 * ROUTEMAX — Limites Légaux
 * Règlement (CE) 561/2006 + Code du travail français
 */

export type Profil = 'CD' | 'MIXTE' | 'LD'

export type AlerteNiveau = 'ok' | 'attention' | 'danger'

export type LimiteStatus = {
  valeur: number        // valeur actuelle en minutes
  maximum: number       // maximum légal en minutes
  pourcentage: number   // 0-100
  niveau: AlerteNiveau
  message?: string
}

export type LimitesJour = {
  conduite: LimiteStatus
  service: LimiteStatus
  amplitude: LimiteStatus
  pauseProchaine: number | null  // minutes avant pause obligatoire
}

export type LimitesSemaine = {
  conduite: LimiteStatus        // max 56h
  service: LimiteStatus         // max 56h CD / 52h LD
  conduite2semaines: LimiteStatus // max 90h sur 2 semaines
}

// ═══════════════════════════════════════
// LIMITES PAR PROFIL (en minutes)
// ═══════════════════════════════════════

const LIMITES = {
  // Journalières
  CONDUITE_JOUR_NORMAL: 9 * 60,      // 9h standard
  CONDUITE_JOUR_EXTENDED: 10 * 60,   // 10h max 2x/semaine
  PAUSE_OBLIGATOIRE_APRES: 4.5 * 60, // 4h30 conduite continue
  AMPLITUDE_NORMAL: 12 * 60,         // 12h standard
  AMPLITUDE_REDUIT: 15 * 60,         // 15h repos réduit
  AMPLITUDE_NUIT: 10 * 60,           // 10h si nuit (00h-05h)

  // Hebdomadaires
  CONDUITE_SEMAINE: 56 * 60,         // 56h max
  SERVICE_CD: 52 * 60,               // Courte Distance
  SERVICE_LD: 56 * 60,               // Longue Distance
  SERVICE_MIXTE: 56 * 60,            // Mixte

  // Bi-hebdomadaire
  CONDUITE_2_SEMAINES: 90 * 60,      // 90h sur 2 semaines
}

// ═══════════════════════════════════════
// CALCUL STATUT
// ═══════════════════════════════════════

function calculerStatut(valeur: number, maximum: number, seuilAttention = 0.80): LimiteStatus {
  const pourcentage = Math.min((valeur / maximum) * 100, 100)
  let niveau: AlerteNiveau = 'ok'

  if (pourcentage >= 100) niveau = 'danger'
  else if (pourcentage >= seuilAttention * 100) niveau = 'attention'

  return { valeur, maximum, pourcentage, niveau }
}

// ═══════════════════════════════════════
// LIMITES DU JOUR
// ═══════════════════════════════════════

export function calculerLimitesJour(
  conduiteMinutes: number,
  serviceMinutes: number,
  amplitudeMinutes: number,
  conduiteDepuisDernierePause: number,
  estNuit: boolean
): LimitesJour {

  const ampMax = estNuit ? LIMITES.AMPLITUDE_NUIT : LIMITES.AMPLITUDE_NORMAL

  // Minutes avant pause obligatoire
  const pauseRestante = LIMITES.PAUSE_OBLIGATOIRE_APRES - conduiteDepuisDernierePause
  const pauseProchaine = pauseRestante > 0 ? pauseRestante : null

  // Alerte pause à 30 minutes avant
  const conduiteStatus = calculerStatut(conduiteMinutes, LIMITES.CONDUITE_JOUR_NORMAL)
  if (pauseProchaine !== null && pauseProchaine <= 30) {
    conduiteStatus.niveau = 'attention'
    conduiteStatus.message = `Pause obligatoire dans ${Math.round(pauseProchaine)} min`
  }
  if (pauseProchaine === null) {
    conduiteStatus.niveau = 'danger'
    conduiteStatus.message = 'Pause obligatoire maintenant!'
  }

  return {
    conduite: conduiteStatus,
    service: calculerStatut(serviceMinutes, LIMITES.CONDUITE_JOUR_NORMAL),
    amplitude: calculerStatut(amplitudeMinutes, ampMax),
    pauseProchaine,
  }
}

// ═══════════════════════════════════════
// LIMITES SEMAINE
// ═══════════════════════════════════════

export function calculerLimitesSemaine(
  conduiteMinutesSemaine: number,
  serviceMinutesSemaine: number,
  conduiteMinutes2Semaines: number,
  profil: Profil
): LimitesSemaine {

  const maxService = profil === 'CD'
    ? LIMITES.SERVICE_CD
    : LIMITES.SERVICE_LD

  return {
    conduite: calculerStatut(conduiteMinutesSemaine, LIMITES.CONDUITE_SEMAINE),
    service: calculerStatut(serviceMinutesSemaine, maxService),
    conduite2semaines: calculerStatut(conduiteMinutes2Semaines, LIMITES.CONDUITE_2_SEMAINES),
  }
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

export function formaterMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h${m.toString().padStart(2, '0')}`
}

export function estPeriodeNuit(heure: Date): boolean {
  const h = heure.getHours()
  return h >= 0 && h < 5
}
