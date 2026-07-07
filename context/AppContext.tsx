import React, { createContext, useContext, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../src/utils/logger'

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
  padraoAprendido: any | null
  fraisRegles: any | null
  fraisValores: any | null
  histSal: any[] | null
  histCal: any[] | null
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
  padraoAprendido: null,
  fraisRegles: null,
  fraisValores: null,
  histSal: null,
  histCal: null,
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
    log.info('AppContext', 'recarregarApp iniciado')
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

    let padraoAprendido: any | null = null
    try { const apRaw = await AsyncStorage.getItem('aprendizagem_padrao'); if (apRaw) padraoAprendido = JSON.parse(apRaw) } catch {}

    const fraisReglesRaw = await AsyncStorage.getItem('frais_regles')
    const fraisRegles = fraisReglesRaw ? JSON.parse(fraisReglesRaw) : null
    const fraisValoresRaw = await AsyncStorage.getItem('frais_valores')
    const fraisValores = fraisValoresRaw ? JSON.parse(fraisValoresRaw) : null

    const histSalRaw = await AsyncStorage.getItem('monSalaire_v2')
    const histSal = histSalRaw ? JSON.parse(histSalRaw) : null
    const histCalRaw = await AsyncStorage.getItem('historique')
    const histCal = histCalRaw ? JSON.parse(histCalRaw) : null

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
      padraoAprendido,
      fraisRegles,
      fraisValores,
      histSal,
      histCal,
      hbase: padrao?.hbase ?? 0,
      hval: padrao?.hval ?? 0,
    })
    log.info('AppContext', 'estado carregado', { profil, histCalLen: histCal?.length ?? 0, histSalLen: histSal?.length ?? 0 })
  }, [])

  const actualizarCampo = useCallback(<K extends keyof AppState>(key: K, value: AppState[K]) => {
    setState(prev => ({ ...prev, [key]: value }))
  }, [])

  const contextValue = React.useMemo(
    () => ({ state, recarregarApp, actualizarCampo }),
    [state, recarregarApp, actualizarCampo]
  )
  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  )
}

// ── Hook de consumo ───────────────────────────────────────────────────────────

export function useApp(): AppContextType {
  return useContext(AppContext)
}
