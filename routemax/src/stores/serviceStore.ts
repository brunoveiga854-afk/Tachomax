/**
 * ROUTEMAX — Service Store
 * Estado global do serviço diário
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type TypeJour = 'TRAB' | 'DEC' | 'FER' | 'FERIE' | 'RC' | 'OFF'

export type Pause = {
  debut: string    // ISO string
  fin: string | null
}

export type JourService = {
  id: string
  date: string           // YYYY-MM-DD
  type: TypeJour
  debut: string | null   // ISO string
  fin: string | null
  pauses: Pause[]
  decouche: boolean
  conduiteMinutes: number
  serviceMinutes: number
  amplitudeMinutes: number
  fraisTotal: number
  fraisDetail: string[]
  note?: string
}

type ServiceStore = {
  // Estado actual
  enService: boolean
  jourActuel: JourService | null
  pauseActive: boolean

  // Histórico
  historique: JourService[]

  // Actions
  demarrer: () => void
  pauseDebut: () => void
  pauseFin: () => void
  terminer: () => void
  toggleDecouche: () => void
  setTypeJour: (type: TypeJour) => void
  resetJour: () => void
}

const creerJour = (): JourService => ({
  id: Date.now().toString(),
  date: new Date().toISOString().split('T')[0],
  type: 'TRAB',
  debut: null,
  fin: null,
  pauses: [],
  decouche: false,
  conduiteMinutes: 0,
  serviceMinutes: 0,
  amplitudeMinutes: 0,
  fraisTotal: 0,
  fraisDetail: [],
})

export const useServiceStore = create<ServiceStore>()(
  persist(
    (set, get) => ({
      enService: false,
      jourActuel: null,
      pauseActive: false,
      historique: [],

      demarrer: () => {
        const now = new Date().toISOString()
        const jour = creerJour()
        jour.debut = now
        set({
          enService: true,
          jourActuel: jour,
          pauseActive: false,
        })
      },

      pauseDebut: () => {
        const { jourActuel } = get()
        if (!jourActuel) return
        const pause: Pause = {
          debut: new Date().toISOString(),
          fin: null,
        }
        set({
          pauseActive: true,
          jourActuel: {
            ...jourActuel,
            pauses: [...jourActuel.pauses, pause],
          },
        })
      },

      pauseFin: () => {
        const { jourActuel } = get()
        if (!jourActuel) return
        const pauses = [...jourActuel.pauses]
        const dernierePause = pauses[pauses.length - 1]
        if (dernierePause && !dernierePause.fin) {
          dernierePause.fin = new Date().toISOString()
        }
        set({
          pauseActive: false,
          jourActuel: { ...jourActuel, pauses },
        })
      },

      terminer: () => {
        const { jourActuel, historique } = get()
        if (!jourActuel) return
        const jourFinal = {
          ...jourActuel,
          fin: new Date().toISOString(),
        }
        set({
          enService: false,
          pauseActive: false,
          jourActuel: null,
          historique: [jourFinal, ...historique].slice(0, 365), // max 1 ano
        })
      },

      toggleDecouche: () => {
        const { jourActuel } = get()
        if (!jourActuel) return
        set({
          jourActuel: {
            ...jourActuel,
            decouche: !jourActuel.decouche,
          },
        })
      },

      setTypeJour: (type: TypeJour) => {
        const { jourActuel } = get()
        if (!jourActuel) return
        set({ jourActuel: { ...jourActuel, type } })
      },

      resetJour: () => {
        set({ enService: false, jourActuel: null, pauseActive: false })
      },
    }),
    {
      name: 'routemax-service',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
