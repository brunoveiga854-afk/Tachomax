// app/assistente.tsx
// Página de VALIDAÇÃO TÉCNICA do assistente regulamentar (rota separada, fora dos separadores; sem botões de acesso).
// Acesso: deep link  tachooffice://assistente   ou   router.push('/assistente')  (ver instruções de entrega).
//
// EXCLUSIVAMENTE DE LEITURA: lê as chaves que a app já usa através de `lerContextoAssistente` (só `multiGet`),
// nunca escreve em AsyncStorage nem no AppContext, e não cria nenhum histórico próprio.
//
// SINCRONIZAÇÃO: a cada consulta (ao entrar no ecrã, ao tocar numa pergunta, ao «Actualiser») chama
// `recarregarApp` para manter o contexto partilhado fresco e, SEM depender dele, faz uma leitura única e
// consistente do armazenamento no instante da consulta (ver lerContexto.ts).
import React, { useCallback, useRef, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { Stack, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../context/ThemeContext'
import { useApp } from '../context/AppContext'
import { log } from '../src/utils/logger'
import {
  lerContextoAssistente, prepararRespostas, PERGUNTAS,
  type ContextoAssistente, type LeitorStorage, type PerguntaId, type Resposta,
} from '../src/engine/regras/lerContexto'

// O leitor expõe SÓ multiGet: não há como escrever através dele.
const LEITOR: LeitorStorage = { multiGet: keys => AsyncStorage.multiGet([...keys]) }

const COR_ESTADO = { confirmado: '#27ae60', simulacao_condicionada: '#f39c12', dados_insuficientes: '#e74c3c' } as const

const dd = (n: number) => String(n).padStart(2, '0')
const horaLocal = (ms: number) => { const d = new Date(ms); return `${dd(d.getHours())}:${dd(d.getMinutes())}:${dd(d.getSeconds())}` }

export default function AssistenteScreen() {
  const { themeSombre } = useTheme()
  const { recarregarApp } = useApp()
  const [ctx, setCtx] = useState<ContextoAssistente | null>(null)
  const [pergunta, setPergunta] = useState<PerguntaId>('amplitude')
  const [aCarregar, setACarregar] = useState(false)
  const [tecnico, setTecnico] = useState(false)
  const seq = useRef(0)

  const cor = themeSombre
    ? { bg: '#0f1117', card: '#1b1e29', texto: '#ffffff', suave: '#8b92ad', borda: '#2a2e3d', btn: '#252938', btnAtivo: '#3a4a7a' }
    : { bg: '#f2f3f8', card: '#ffffff', texto: '#14161f', suave: '#5d6580', borda: '#dfe2ec', btn: '#e6e8f1', btnAtivo: '#c9d3f5' }

  // Consulta = (1) pedir recarga do contexto partilhado, (2) ler o armazenamento NESTE instante.
  const consultar = useCallback(async (origem: string) => {
    const minha = ++seq.current
    setACarregar(true)
    try {
      try { await recarregarApp({ origem }) } catch (e) { log.warn('assistente', 'recarregarApp falhou (a leitura direta continua)', { tipo: (e as any)?.name }) }
      const c = await lerContextoAssistente(LEITOR, Date.now())
      if (minha === seq.current) {
        setCtx(c)
        log.debug('assistente', 'consulta', { origem, situacao: c.situacao, estado: c.estado })
      }
    } catch (e) {
      log.error('assistente', 'consulta falhou', e)
    } finally {
      if (minha === seq.current) setACarregar(false)
    }
  }, [recarregarApp])

  useFocusEffect(useCallback(() => { void consultar('focus-assistente') }, [consultar]))

  const escolher = (id: PerguntaId) => { setPergunta(id); void consultar('consulta-assistente') }

  const preparado = ctx ? prepararRespostas(ctx) : null
  const resposta: Resposta | undefined = preparado?.respostas.find(r => r.id === pergunta)

  return (
    <SafeAreaView style={[s.fundo, { backgroundColor: cor.bg }]} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Assistant', headerShown: true }} />
      <ScrollView contentContainerStyle={s.conteudo}>
        <Text style={[s.suave, { color: cor.suave }]}>Lecture seule — aucune donnée n'est modifiée. Page de validation technique.</Text>

        <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda }]}>
          <Text style={[s.texto, { color: cor.texto }]}>{preparado ? preparado.situacao.texto : 'Lecture en cours…'}</Text>
          {ctx && <Text style={[s.suave, { color: cor.suave }]}>Données lues à {horaLocal(ctx.agoraMs)}{ctx.precisaoServico === 'aproximada' ? ' · temps de service approximatif (ancre approximative)' : ''}</Text>}
        </View>

        {PERGUNTAS.map(p => (
          <TouchableOpacity key={p.id} onPress={() => escolher(p.id)} activeOpacity={0.8}
            style={[s.pergunta, { backgroundColor: pergunta === p.id ? cor.btnAtivo : cor.btn, borderColor: cor.borda }]}>
            <Text style={[s.perguntaTxt, { color: cor.texto }]}>{p.titulo}</Text>
          </TouchableOpacity>
        ))}

        {aCarregar && !resposta && <ActivityIndicator style={{ marginTop: 16 }} />}

        {resposta && (
          <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda }]}>
            <View style={[s.badge, { backgroundColor: COR_ESTADO[resposta.estado] }]}>
              <Text style={s.badgeTxt}>{resposta.estadoTexto}</Text>
            </View>

            {resposta.disponivel
              ? resposta.linhas.map((l, i) => (
                <View key={i} style={s.linha}>
                  <Text style={[s.suave, { color: cor.suave }]}>{l.rotulo}</Text>
                  <Text style={[s.valor, { color: cor.texto }]}>{l.valor}</Text>
                </View>
              ))
              : <Text style={[s.texto, { color: cor.texto }]}>Résultat non disponible : le moteur n'a pas assez de données.</Text>}

            {resposta.informationManquante.length > 0 && (
              <Bloco titulo="Information manquante" itens={resposta.informationManquante} cor={cor} destaque />
            )}
            {resposta.aConfirmer.length > 0 && (
              <Bloco titulo="À confirmer (le résultat en dépend)" itens={resposta.aConfirmer} cor={cor} />
            )}
            <Bloco titulo="Non vérifié" itens={resposta.naoVerificadas} cor={cor} />

            <Text style={[s.aviso, { color: cor.suave }]}>{resposta.aviso}</Text>

            <TouchableOpacity onPress={() => setTecnico(v => !v)}>
              <Text style={[s.link, { color: cor.suave }]}>{tecnico ? '▾ Masquer les détails techniques' : '▸ Détails techniques'}</Text>
            </TouchableOpacity>
            {tecnico && (
              <View>
                {[...resposta.detalhesTecnicos, ...(ctx?.avisos ?? [])].map((t, i) => (
                  <Text key={i} style={[s.tecnico, { color: cor.suave }]}>• {t}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        <TouchableOpacity onPress={() => void consultar('consulta-assistente')} disabled={aCarregar}
          style={[s.refresh, { backgroundColor: cor.btn, borderColor: cor.borda, opacity: aCarregar ? 0.5 : 1 }]}>
          <Text style={[s.perguntaTxt, { color: cor.texto }]}>{aCarregar ? 'Lecture…' : 'Actualiser'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

function Bloco({ titulo, itens, cor, destaque }: { titulo: string; itens: string[]; cor: { texto: string; suave: string }; destaque?: boolean }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={[s.tituloBloco, { color: destaque ? '#e74c3c' : cor.texto }]}>{titulo}</Text>
      {itens.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
    </View>
  )
}

const s = StyleSheet.create({
  fundo: { flex: 1 },
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14 },
  pergunta: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 14 },
  perguntaTxt: { fontSize: 15, fontWeight: '700' },
  texto: { fontSize: 14, fontWeight: '600' },
  suave: { fontSize: 12 },
  badge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 10 },
  badgeTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  linha: { marginBottom: 10 },
  valor: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  tituloBloco: { fontSize: 13, fontWeight: '800', marginBottom: 4 },
  item: { fontSize: 12, lineHeight: 17, marginBottom: 2 },
  aviso: { fontSize: 11, marginTop: 14, fontStyle: 'italic' },
  link: { fontSize: 12, marginTop: 12, fontWeight: '700' },
  tecnico: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  refresh: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
})
