// src/assistente/useAssistenteAtivo.ts
// Hook sobre a preferência «Activer l'assistant» (ver preferencia.ts). Sem estado próprio persistente: lê a chave
// do AsyncStorage ao montar e sempre que o ecrã ganha foco, e ouve as gravações feitas nas Réglages.
import { useCallback, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from 'expo-router'
import { gravarAssistenteAtivo, lerAssistenteAtivo, subscreverAssistente } from './preferencia'

/** `ativo === null` enquanto a chave ainda não foi lida (o botão fica escondido, sem «piscar»). */
export function useAssistenteAtivo(): { ativo: boolean | null; definir: (valor: boolean) => Promise<boolean> } {
  const [ativo, setAtivo] = useState<boolean | null>(null)

  useEffect(() => {
    let vivo = true
    void lerAssistenteAtivo(AsyncStorage).then(v => { if (vivo) setAtivo(v) })
    const parar = subscreverAssistente(v => { if (vivo) setAtivo(v) })
    return () => { vivo = false; parar() }
  }, [])

  // Releitura ao ganhar foco: cobre, p.ex., um reset total (AsyncStorage.clear) feito noutro ecrã.
  useFocusEffect(useCallback(() => {
    let vivo = true
    void lerAssistenteAtivo(AsyncStorage).then(v => { if (vivo) setAtivo(v) })
    return () => { vivo = false }
  }, []))

  const definir = useCallback(async (valor: boolean): Promise<boolean> => {
    const ok = await gravarAssistenteAtivo(AsyncStorage, valor)
    if (!ok) setAtivo(await lerAssistenteAtivo(AsyncStorage)) // gravação falhou: volta ao valor realmente guardado
    return ok
  }, [])

  return { ativo, definir }
}
