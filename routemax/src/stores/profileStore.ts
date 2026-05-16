/**
 * ROUTEMAX — Fériados França + Store Perfil
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { FraisConfig, FRAIS_DEFAULT } from '../engine/frais'

// ═══════════════════════════════════════
// FÉRIADOS FRANCE 2024-2027
// ═══════════════════════════════════════

export const FERIADOS_FRANCE: Record<string, string> = {
  // 2024
  '2024-01-01': 'Jour de l\'An',
  '2024-04-01': 'Lundi de Pâques',
  '2024-05-01': 'Fête du Travail',
  '2024-05-08': 'Victoire 1945',
  '2024-05-09': 'Ascension',
  '2024-05-20': 'Lundi de Pentecôte',
  '2024-07-14': 'Fête Nationale',
  '2024-08-15': 'Assomption',
  '2024-11-01': 'Toussaint',
  '2024-11-11': 'Armistice',
  '2024-12-25': 'Noël',
  // 2025
  '2025-01-01': 'Jour de l\'An',
  '2025-04-21': 'Lundi de Pâques',
  '2025-05-01': 'Fête du Travail',
  '2025-05-08': 'Victoire 1945',
  '2025-05-29': 'Ascension',
  '2025-06-09': 'Lundi de Pentecôte',
  '2025-07-14': 'Fête Nationale',
  '2025-08-15': 'Assomption',
  '2025-11-01': 'Toussaint',
  '2025-11-11': 'Armistice',
  '2025-12-25': 'Noël',
  // 2026
  '2026-01-01': 'Jour de l\'An',
  '2026-04-06': 'Lundi de Pâques',
  '2026-05-01': 'Fête du Travail',
  '2026-05-08': 'Victoire 1945',
  '2026-05-14': 'Ascension',
  '2026-05-25': 'Lundi de Pentecôte',
  '2026-07-14': 'Fête Nationale',
  '2026-08-15': 'Assomption',
  '2026-11-01': 'Toussaint',
  '2026-11-11': 'Armistice',
  '2026-12-25': 'Noël',
}

export function estFerie(date: Date): string | null {
  const key = date.toISOString().split('T')[0]
  return FERIADOS_FRANCE[key] || null
}

// ═══════════════════════════════════════
// STORE PERFIL
// ═══════════════════════════════════════

export type Profil = 'CD' | 'MIXTE' | 'LD'
export type Langue = 'fr' | 'pt'
export type Theme = 'dark' | 'light'

export type ProfilStore = {
  // Config pessoal
  nom: string
  entreprise: string
  numeroEntreprise: string
  profil: Profil
  langue: Langue
  theme: Theme

  // Dados financeiros (da fiche de paye)
  tauxHoraire: number
  fraisConfig: FraisConfig
  decalagepaie: number        // meses de décalage
  seuilHeuresSupp: number     // 43h LD / 39h CD
  majorationHeuresSupp: number // 25% ou 50%

  // Trial
  dateInstallation: string | null
  trialActif: boolean
  abonnementActif: boolean

  // Setup
  onboardingComplete: boolean
  ficheUploaded: boolean
  fraisUploaded: boolean

  // Actions
  setProfil: (p: Profil) => void
  setLangue: (l: Langue) => void
  setTheme: (t: Theme) => void
  setNom: (n: string) => void
  setEntreprise: (e: string, num: string) => void
  setFicheData: (data: Partial<ProfilStore>) => void
  completerOnboarding: () => void
  initialiserTrial: () => void
  getDaysRestantsTrial: () => number
}

export const useProfilStore = create<ProfilStore>()(
  persist(
    (set, get) => ({
      nom: '',
      entreprise: '',
      numeroEntreprise: '',
      profil: 'MIXTE',
      langue: 'fr',
      theme: 'dark',

      tauxHoraire: 0,
      fraisConfig: FRAIS_DEFAULT,
      decalagepaie: 0,
      seuilHeuresSupp: 43 * 60,
      majorationHeuresSupp: 25,

      dateInstallation: null,
      trialActif: false,
      abonnementActif: false,

      onboardingComplete: false,
      ficheUploaded: false,
      fraisUploaded: false,

      setProfil: (profil) => set({ profil }),
      setLangue: (langue) => set({ langue }),
      setTheme: (theme) => set({ theme }),
      setNom: (nom) => set({ nom }),
      setEntreprise: (entreprise, numeroEntreprise) =>
        set({ entreprise, numeroEntreprise }),

      setFicheData: (data) => set({ ...data, ficheUploaded: true }),

      completerOnboarding: () => set({ onboardingComplete: true }),

      initialiserTrial: () => {
        const { dateInstallation } = get()
        if (!dateInstallation) {
          set({
            dateInstallation: new Date().toISOString(),
            trialActif: true,
          })
        }
      },

      getDaysRestantsTrial: () => {
        const { dateInstallation, abonnementActif } = get()
        if (abonnementActif) return 999
        if (!dateInstallation) return 60
        const debut = new Date(dateInstallation)
        const maintenant = new Date()
        const jours = Math.floor(
          (maintenant.getTime() - debut.getTime()) / (1000 * 60 * 60 * 24)
        )
        return Math.max(0, 60 - jours)
      },
    }),
    {
      name: 'routemax-profil',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
