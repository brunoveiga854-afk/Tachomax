import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ── Tipo do estado global ─────────────────────────────────────────────────────

export type AppState = {
  profil: 'CD' | 'MIXTE' | 'LD' | null
  nom: string
  kmUltimoFim: number
  tracteurType: 'immat' | 'parc' | null
  tracteurValue: string
  remorqueType: 'immat' | 'parc' | null
  remorqueValue: string
  camposObrigatoriosOk: boolean
  hbase: number
  hval: number
  padrao: any | null
}

const INITIAL_STATE: AppState = {
  profil: null,
  nom: '',
  kmUltimoFim: 0,
  tracteurType: null,
  tracteurValue: '',
  remorqueType: null,
  remorqueValue: '',
  camposObrigatoriosOk: false,
  hbase: 0,
  hval: 0,
  padrao: null,
}

// ── Tipo do contexto ──────────────────────────────────────────────────────────

type AppContextType = {
  state: AppState
  recarregarApp: () => Promise<void>
  actualizarCampo: <K extends keyof AppState>(key: K, value: AppState[K]) => void
}

// ── Criação do context ────────────────────────────────────────────────────────

const AppContext = createContext<AppContextType>({
  state: INITIAL_STATE,
  recarregarApp: async () => {},
  actualizarCampo: () => {},
})

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(INITIAL_STATE)

  const recarregarApp = useCallback(async () => {
    const [
      profilRaw,
      nomRaw,
      kmRaw,
      tracteurTypeRaw,
      tracteurValueRaw,
      remorqueTypeRaw,
      remorqueValueRaw,
      padraoRaw,
    ] = await Promise.all([
      AsyncStorage.getItem('profil'),
      AsyncStorage.getItem('nom'),
      AsyncStorage.getItem('km_ultimo_fim'),
      AsyncStorage.getItem('tracteur_type'),
      AsyncStorage.getItem('tracteur_value'),
      AsyncStorage.getItem('remorque_type'),
      AsyncStorage.getItem('remorque_value'),
      AsyncStorage.getItem('monSalaire_padrao'),
    ])

    let padrao: any | null = null
    try { if (padraoRaw) padrao = JSON.parse(padraoRaw) } catch {}

    const profil = (profilRaw === 'CD' || profilRaw === 'MIXTE' || profilRaw === 'LD')
      ? profilRaw
      : null

    const tracteurType = (tracteurTypeRaw === 'immat' || tracteurTypeRaw === 'parc')
      ? tracteurTypeRaw
      : null

    const remorqueType = (remorqueTypeRaw === 'immat' || remorqueTypeRaw === 'parc')
      ? remorqueTypeRaw
      : null

    setState({
      profil,
      nom: nomRaw ?? '',
      kmUltimoFim: parseInt(kmRaw ?? '0') || 0,
      tracteurType,
      tracteurValue: tracteurValueRaw ?? '',
      remorqueType,
      remorqueValue: remorqueValueRaw ?? '',
      // Calcula em fresco: profil + hbase + hval (km não é necessário para estimativa)
      camposObrigatoriosOk: !!(profilRaw) && (padrao?.hbase ?? 0) > 0 && (padrao?.hval ?? 0) > 0,
      padrao,
      hbase: padrao?.hbase ?? 0,
      hval: padrao?.hval ?? 0,
    })
  }, [])

  const actualizarCampo = useCallback(<K extends keyof AppState>(key: K, value: AppState[K]) => {
    setState(prev => ({ ...prev, [key]: value }))
  }, [])

  useEffect(() => {
    recarregarApp()
  }, [])

  return (
    <AppContext.Provider value={{ state, recarregarApp, actualizarCampo }}>
      {children}
    </AppContext.Provider>
  )
}

// ── Hook de consumo ───────────────────────────────────────────────────────────

export function useApp(): AppContextType {
  return useContext(AppContext)
}
