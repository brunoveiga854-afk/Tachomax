import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { secureGet } from '../src/utils/secureStorage'
import { log } from '../src/utils/logger'
import { reutilizarSeIgual, mesmoEstado, type CacheReferencias } from '../src/utils/referencias'

// ── Tipo do estado global ─────────────────────────────────────────────────────

// Origem da recarga (só para logs). 'focus-*' pode reutilizar uma recarga em curso;
// qualquer outra origem (ex.: 'gravacao', ou sem origem) obriga a uma leitura iniciada DEPOIS da chamada.
export type RecarregarOpts = { origem?: string }

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
  recarregarApp: (opts?: RecarregarOpts) => Promise<void>
  actualizarCampo: <K extends keyof AppState>(key: K, value: AppState[K]) => void
}

// ── Criação do context ────────────────────────────────────────────────────────

const AppContext = createContext<AppContextType>({
  state: INITIAL_STATE,
  recarregarApp: async (_opts?: RecarregarOpts) => {},
  actualizarCampo: () => {},
})

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(INITIAL_STATE)

  const emCursoRef = useRef<Promise<void> | null>(null)
  const seguinteRef = useRef<Promise<void> | null>(null)
  // Último conteúdo bruto de cada chave + objecto parseado: se o bruto não mudou, reutiliza-se a referência.
  const cacheRef = useRef<CacheReferencias>(new Map())

  const lerEstado = useCallback(async (origem: string) => {
    log.info('AppContext', 'recarregarApp iniciado', { origem })
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
      secureGet('monSalaire_padrao'),
    ])

    // Cada chave: se o conteúdo bruto é igual ao da leitura anterior, reutiliza o MESMO objecto
    // (mantém memos/effects estáveis); se mudou, faz parse novo e actualiza a referência.
    const cache = cacheRef.current
    const reutilizadas: string[] = []
    const parseObj = (nome: string) => (raw: string): any | null => {
      try { return JSON.parse(raw) } catch { log.warn('AppContext', `${nome} corrompido — ignorado`); return null }
    }
    const parseArray = (nome: string) => (raw: string): any[] | null => {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed
        log.warn('AppContext', `${nome} não é um array — ignorado (chave intacta)`, { tipo: typeof parsed })
        return null
      } catch { log.warn('AppContext', `${nome} corrompido — ignorado`); return null }
    }

    const padrao = reutilizarSeIgual<any>(cache, 'padrao', padraoRaw, parseObj('monSalaire_padrao'), reutilizadas)

    let apRaw: string | null = null
    try { apRaw = await secureGet('aprendizagem_padrao') } catch { log.warn('AppContext', 'aprendizagem_padrao ilegível — ignorado') }
    const padraoAprendido = reutilizarSeIgual<any>(cache, 'padraoAprendido', apRaw, parseObj('aprendizagem_padrao'), reutilizadas)

    const fraisReglesRaw = await AsyncStorage.getItem('frais_regles')
    const fraisRegles = reutilizarSeIgual<any>(cache, 'fraisRegles', fraisReglesRaw, parseObj('frais_regles'), reutilizadas)
    const fraisValoresRaw = await AsyncStorage.getItem('frais_valores')
    const fraisValores = reutilizarSeIgual<any>(cache, 'fraisValores', fraisValoresRaw, parseObj('frais_valores'), reutilizadas)

    const histSalRaw = await AsyncStorage.getItem('monSalaire_v2')
    const histSal = reutilizarSeIgual<any[]>(cache, 'histSal', histSalRaw, parseArray('monSalaire_v2'), reutilizadas)
    const histCalRaw = await AsyncStorage.getItem('historique')
    const histCal = reutilizarSeIgual<any[]>(cache, 'histCal', histCalRaw, parseArray('historique'), reutilizadas)

    const profil = (profilRaw === 'CD' || profilRaw === 'MIXTE' || profilRaw === 'LD')
      ? profilRaw
      : null

    const tracteurType = (tracteurTypeRaw === 'immat' || tracteurTypeRaw === 'parc')
      ? tracteurTypeRaw
      : null

    const remorqueType = (remorqueTypeRaw === 'immat' || remorqueTypeRaw === 'parc')
      ? remorqueTypeRaw
      : null

    const novoEstado: AppState = {
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
    }
    // Se nada mudou (mesmas referências e valores), devolve `prev`: sem novo render nos consumidores.
    setState(prev => (mesmoEstado(prev as any, novoEstado as any) ? prev : novoEstado))
    log.info('AppContext', 'estado carregado', { origem, reutilizadas, profil, histCalLen: histCal?.length ?? 0, histSalLen: histSal?.length ?? 0 })
  }, [])

  // Deduplicação de recargas simultâneas:
  //  - sem recarga em curso → arranca já;
  //  - 'focus-*' durante uma recarga → reutiliza a que está em curso (ou a agendada);
  //  - qualquer outra origem (gravação, sem origem) durante uma recarga → agenda UMA nova leitura
  //    que só começa depois da actual terminar (partilhada por todos os pedidos desse intervalo).
  const arrancar = useCallback((origem: string): Promise<void> => {
    const p: Promise<void> = lerEstado(origem).finally(() => {
      if (emCursoRef.current === p && !seguinteRef.current) emCursoRef.current = null
    })
    emCursoRef.current = p
    return p
  }, [lerEstado])

  const recarregarApp = useCallback((opts?: RecarregarOpts): Promise<void> => {
    const origem = opts?.origem ?? 'sem-origem'
    const atual = emCursoRef.current
    if (!atual) return arrancar(origem)
    if (origem.startsWith('focus-')) {
      log.info('AppContext', 'recarregarApp reutiliza recarga em curso', { origem })
      return seguinteRef.current ?? atual
    }
    if (!seguinteRef.current) {
      seguinteRef.current = atual.catch(() => {}).then(() => {
        seguinteRef.current = null
        return arrancar(origem)
      })
    }
    log.info('AppContext', 'recarregarApp agendada para depois da actual', { origem })
    return seguinteRef.current
  }, [arrancar])

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
