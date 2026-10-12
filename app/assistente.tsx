// app/assistente.tsx
// Assistant TachoOffice — «ton copilote de service». Rota separada, fora dos separadores.
//
// EXCLUSIVAMENTE DE LEITURA: lê as chaves que a app já usa através de `lerContextoAssistente` (só `multiGet`).
// A única escrita possível nesta página é a preferência «Activer l'assistant» (botão do cartão «désactivé»),
// feita por `useAssistenteAtivo`. A simulação vive só em estado local (useState) e nunca toca em dados persistidos.
//
// SINCRONIZAÇÃO: a cada consulta (entrar no ecrã, tocar numa pergunta, «Actualiser») chama `recarregarApp` para
// manter o contexto partilhado fresco e, SEM depender dele, faz uma leitura única e consistente do armazenamento.
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, StatusBar, Linking, Platform } from 'react-native'
import { router, Stack, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../context/ThemeContext'
import { useApp } from '../context/AppContext'
import { log } from '../src/utils/logger'
import {
  lerContextoAssistente, prepararRespostas, prepararCartaoContexto, PERGUNTAS, AVISO_NAO_AUTORIZACAO,
  type ContextoAssistente, type LeitorStorage, type PerguntaId, type Resposta,
} from '../src/engine/regras/lerContexto'
import {
  simular, parametrosOriginais, saoParametrosOriginais, PAUSA_SIM_MAX_MIN, PAUSA_SIM_PASSO_MIN,
  type ParametrosSimulacao,
} from '../src/engine/regras/simulacao'
import { regrasUsadas, type RegraExplicada } from '../src/engine/regras/regrasExplicadas'
import { useAssistenteAtivo } from '../src/assistente/useAssistenteAtivo'

// O leitor expõe SÓ multiGet: não há como escrever através dele.
const LEITOR: LeitorStorage = { multiGet: keys => AsyncStorage.multiGet([...keys]) }

const COR_ESTADO = { confirmado: '#27ae60', simulacao_condicionada: '#e08e0b', dados_insuficientes: '#d64541' } as const
const TXT_ESTADO = { confirmado: 'Résultat confirmé', simulacao_condicionada: 'Résultat conditionnel', dados_insuficientes: 'Données insuffisantes' } as const
const ICONE: Record<PerguntaId, keyof typeof Ionicons.glyphMap> = { amplitude: 'time-outline', servico: 'briefcase-outline', repos: 'moon-outline' }
const DESCRICAO: Record<PerguntaId, string> = {
  amplitude: "Jusqu'à quand ton amplitude te le permet",
  servico: 'Le temps de service qu’il te reste aujourd’hui',
  repos: 'Quand ton repos doit être terminé',
}

const dd = (n: number) => String(n).padStart(2, '0')
const horaLocal = (ms: number) => { const d = new Date(ms); return `${dd(d.getHours())}:${dd(d.getMinutes())}` }

type Paleta = { bg: string; card: string; texto: string; suave: string; borda: string; btn: string; btnAtivo: string; destaque: string }

export default function AssistenteScreen() {
  const { themeSombre } = useTheme()
  const { recarregarApp } = useApp()
  const { ativo, definir } = useAssistenteAtivo()
  const [ctx, setCtx] = useState<ContextoAssistente | null>(null)
  const [pergunta, setPergunta] = useState<PerguntaId>('amplitude')
  const [aCarregar, setACarregar] = useState(false)
  const [params, setParams] = useState<ParametrosSimulacao>(parametrosOriginais())
  const seq = useRef(0)

  const cor: Paleta = themeSombre
    ? { bg: '#0f1117', card: '#1b1e29', texto: '#ffffff', suave: '#a3aac4', borda: '#2a2e3d', btn: '#252938', btnAtivo: '#33426e', destaque: '#f5a623' }
    : { bg: '#f2f3f8', card: '#ffffff', texto: '#14161f', suave: '#555d78', borda: '#dfe2ec', btn: '#e6e8f1', btnAtivo: '#fff1d6', destaque: '#c47d0e' }

  const consultar = useCallback(async (origem: string) => {
    const minha = ++seq.current
    setACarregar(true)
    try {
      try { await recarregarApp({ origem }) } catch (e) { log.warn('assistente', 'recarregarApp falhou (a leitura direta continua)', { tipo: (e as any)?.name }) }
      const c = await lerContextoAssistente(LEITOR, Date.now())
      if (minha === seq.current) setCtx(c)
    } catch (e) {
      log.error('assistente', 'consulta falhou', e)
    } finally {
      if (minha === seq.current) setACarregar(false)
    }
  }, [recarregarApp])

  useFocusEffect(useCallback(() => { void consultar('focus-assistente') }, [consultar]))

  const voltar = () => { if (router.canGoBack()) router.back(); else router.replace('/' as any) }

  const preparado = useMemo(() => (ctx ? prepararRespostas(ctx) : null), [ctx])
  const cartao = useMemo(() => (ctx ? prepararCartaoContexto(ctx) : null), [ctx])
  const resposta: Resposta | undefined = preparado?.respostas.find(r => r.id === pergunta)
  const regras = useMemo(() => (ctx ? regrasUsadas(ctx.motor) : []), [ctx])

  const estadoServico = !ctx ? 'Lecture…' : cartao?.emServico ? cartao.titulo : cartao?.titulo ?? ''

  return (
    <SafeAreaView style={[s.fundo, { backgroundColor: cor.bg }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle={themeSombre ? 'light-content' : 'dark-content'} backgroundColor={cor.bg} />

      {/* Cabeçalho próprio, no tema da app */}
      <View style={[s.header, { borderBottomColor: cor.borda }]}>
        <TouchableOpacity onPress={voltar} accessibilityRole="button" accessibilityLabel="Retour"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={[s.iconBtn, { backgroundColor: cor.btn }]}>
          <Ionicons name="arrow-back" size={22} color={cor.texto} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text style={[s.titulo, { color: cor.texto }]} numberOfLines={1}>Assistant TachoOffice</Text>
          <Text style={[s.suave, { color: cor.suave }]} numberOfLines={1}>Ton copilote de service</Text>
          <Text style={[s.suave, { color: cor.suave }]} numberOfLines={1}>
            {estadoServico}{ctx ? ` · mis à jour ${horaLocal(ctx.agoraMs)}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => void consultar('consulta-assistente')} disabled={aCarregar} accessibilityRole="button"
          accessibilityLabel="Actualiser les données" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[s.iconBtn, { backgroundColor: cor.btn, opacity: aCarregar ? 0.5 : 1 }]}>
          {aCarregar ? <ActivityIndicator size="small" color={cor.texto} /> : <Ionicons name="refresh" size={20} color={cor.texto} />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        {ativo === false && (
          <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda }]}>
            <Text style={[s.tituloCard, { color: cor.texto }]}>Assistant désactivé</Text>
            <Text style={[s.item, { color: cor.suave }]}>Le bouton de l'écran d'accueil est masqué. Tu peux le réactiver ici ou dans Réglages → Assistant TachoOffice.</Text>
            <TouchableOpacity onPress={() => void definir(true)} style={[s.btnPlein, { backgroundColor: '#f5a623' }]} accessibilityRole="button">
              <Text style={s.btnPleinTxt}>Activer l'assistant</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Contexto do serviço (dados reais) */}
        <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda }]}>
          <Text style={[s.tituloCard, { color: cor.texto }]}>{cartao ? cartao.titulo : 'Lecture en cours…'}</Text>
          {cartao && !cartao.emServico && preparado && (
            <Text style={[s.item, { color: cor.suave }]}>{preparado.situacao.texto}</Text>
          )}
          {cartao?.linhas.map((l, i) => (
            <View key={i} style={s.linhaH}>
              <Text style={[s.suave, { color: cor.suave }]}>{l.rotulo}</Text>
              <Text style={[s.valorH, { color: cor.texto }]}>{l.valor}</Text>
            </View>
          ))}
          {ctx?.precisaoServico === 'aproximada' && (
            <Text style={[s.alerta]}>⚠ Temps de service approximatif (ancre approximative) : les résultats sont à vérifier.</Text>
          )}
          {cartao?.alertas.map((a, i) => <Text key={i} style={s.alerta}>⚠ {a}</Text>)}
        </View>

        {/* Perguntas rápidas */}
        <Text style={[s.seccao, { color: cor.suave }]}>QUESTIONS RAPIDES</Text>
        {PERGUNTAS.map(p => {
          const sel = pergunta === p.id
          return (
            <TouchableOpacity key={p.id} onPress={() => { setPergunta(p.id); void consultar('consulta-assistente') }} activeOpacity={0.8}
              accessibilityRole="button" accessibilityState={{ selected: sel }}
              style={[s.pergunta, { backgroundColor: sel ? cor.btnAtivo : cor.card, borderColor: sel ? '#f5a623' : cor.borda }]}>
              <View style={[s.iconeP, { backgroundColor: sel ? '#f5a623' : cor.btn }]}>
                <Ionicons name={ICONE[p.id]} size={22} color={sel ? '#1a1a1a' : cor.texto} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.perguntaTxt, { color: cor.texto }]}>{p.titulo}</Text>
                <Text style={[s.suave, { color: cor.suave }]}>{DESCRICAO[p.id]}</Text>
              </View>
              {sel && <Ionicons name="checkmark-circle" size={22} color="#f5a623" />}
            </TouchableOpacity>
          )
        })}

        {ctx && !resposta && aCarregar && <ActivityIndicator style={{ marginTop: 12 }} />}
        {resposta && <CartaoResposta r={resposta} cor={cor} avisosCtx={ctx?.avisos ?? []} />}

        {ctx && <Simulacao ctx={ctx} pergunta={pergunta} params={params} setParams={setParams} cor={cor} real={resposta} onActualiser={() => void consultar('consulta-assistente')} aCarregar={aCarregar} />}

        {/* Comprendre cette règle */}
        <Text style={[s.seccao, { color: cor.suave }]}>COMPRENDRE CETTE RÈGLE</Text>
        <Text style={[s.item, { color: cor.suave, marginBottom: 4 }]}>
          {ctx?.motor ? 'Règles utilisées dans le calcul actuel.' : 'Règles prises en charge par l’assistant (aucun service en cours).'}
        </Text>
        {regras.map(r => <CartaoRegra key={r.id} regra={r} cor={cor} />)}
      </ScrollView>
    </SafeAreaView>
  )
}

/* ───────────── Resposta ───────────── */
function CartaoResposta({ r, cor, avisosCtx }: { r: Resposta; cor: Paleta; avisosCtx: string[] }) {
  const [aberto, setAberto] = useState<Record<string, boolean>>({})
  const alt = (k: string) => setAberto(a => ({ ...a, [k]: !a[k] }))
  return (
    <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda }]}>
      <View style={[s.badge, { backgroundColor: COR_ESTADO[r.estado] }]}><Text style={s.badgeTxt}>{TXT_ESTADO[r.estado]}</Text></View>
      <Text style={[s.suave, { color: cor.suave }]}>{r.titulo}</Text>

      {r.destaque ? (
        <View style={{ marginVertical: 8 }}>
          <Text style={[s.grande, { color: cor.destaque }]}>{r.destaque.valor}</Text>
          <Text style={[s.suave, { color: cor.suave }]}>{r.destaque.legenda}</Text>
        </View>
      ) : (
        <Text style={[s.texto, { color: cor.texto, marginVertical: 8 }]}>Résultat non disponible : le moteur n'a pas assez de données.</Text>
      )}

      {r.alertas.map((a, i) => <Text key={i} style={s.alerta}>⚠ {a}</Text>)}
      {r.informationManquante.length > 0 && (
        <View style={{ marginTop: 6 }}>
          <Text style={[s.tituloBloco, { color: '#d64541' }]}>Information manquante</Text>
          {r.informationManquante.map((t, i) => <Text key={i} style={[s.item, { color: cor.texto }]}>• {t}</Text>)}
        </View>
      )}

      {r.linhas.map((l, i) => (
        <View key={i} style={s.linhaH}>
          <Text style={[s.suave, { color: cor.suave, flex: 1 }]}>{l.rotulo}</Text>
          <Text style={[s.valorH, { color: cor.texto, flex: 1, textAlign: 'right' }]}>{l.valor}</Text>
        </View>
      ))}

      {r.hipoteses.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={[s.tituloBloco, { color: cor.texto }]}>Hypothèses utilisées</Text>
          {r.hipoteses.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
        </View>
      )}
      {r.alternativas.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={[s.tituloBloco, { color: cor.texto }]}>Alternative réglementaire calculée</Text>
          {r.alternativas.map((l, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {l.rotulo} : {l.valor}</Text>)}
        </View>
      )}

      {r.aConfirmer.length > 0 && (
        <Expansivel titulo="Ce résultat dépend de…" aberto={!!aberto.dep} alternar={() => alt('dep')} cor={cor}>
          {r.aConfirmer.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
        </Expansivel>
      )}
      <Expansivel titulo="Ce qui n'a pas été vérifié" aberto={!!aberto.nv} alternar={() => alt('nv')} cor={cor}>
        {r.naoVerificadas.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
      </Expansivel>
      <Expansivel titulo="Détails techniques" aberto={!!aberto.tec} alternar={() => alt('tec')} cor={cor}>
        {[...r.detalhesTecnicos, ...avisosCtx].map((t, i) => <Text key={i} style={[s.tecnico, { color: cor.suave }]}>• {t}</Text>)}
      </Expansivel>

      <Text style={[s.aviso, { color: cor.suave }]}>{r.aviso || AVISO_NAO_AUTORIZACAO}</Text>
    </View>
  )
}

function Expansivel({ titulo, aberto, alternar, cor, children }: { titulo: string; aberto: boolean; alternar: () => void; cor: Paleta; children: React.ReactNode }) {
  return (
    <View style={[s.expansivel, { borderTopColor: cor.borda }]}>
      <TouchableOpacity onPress={alternar} accessibilityRole="button" accessibilityState={{ expanded: aberto }} style={s.expCab}>
        <Text style={[s.tituloBloco, { color: cor.texto, flex: 1, marginBottom: 0 }]}>{titulo}</Text>
        <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={18} color={cor.suave} />
      </TouchableOpacity>
      {aberto && <View style={{ marginTop: 6 }}>{children}</View>}
    </View>
  )
}

/* ───────────── Simulação ───────────── */
function Simulacao({ ctx, pergunta, params, setParams, cor, real, onActualiser, aCarregar }: {
  ctx: ContextoAssistente; pergunta: PerguntaId; params: ParametrosSimulacao; setParams: (p: ParametrosSimulacao) => void
  cor: Paleta; real: Resposta | undefined; onActualiser: () => void; aCarregar: boolean
}) {
  const sim = useMemo(() => simular(ctx, params), [ctx, params])
  const original = saoParametrosOriginais(params)
  const ref = ctx.adaptador?.entrada.referenciaMs
  const pausa = (delta: number) => setParams({ ...params, pausaMin: Math.max(0, Math.min(PAUSA_SIM_MAX_MIN, params.pausaMin + delta)) })
  const ligarFim = () => {
    const base = typeof ref === 'number' ? ref + 2 * 3600_000 : Date.UTC(2000, 0, 1, 12, 0)
    const d = new Date(base)
    setParams({ ...params, fimDesejado: { h: d.getUTCHours(), m: Math.floor(d.getUTCMinutes() / 5) * 5 } })
  }
  const h = params.fimDesejado
  const mudarH = (dh: number) => h && setParams({ ...params, fimDesejado: { h: (h.h + dh + 24) % 24, m: h.m } })
  const mudarM = (dm: number) => h && setParams({ ...params, fimDesejado: { h: h.h, m: (h.m + dm + 60) % 60 } })
  const ra = sim.disponivel ? sim.respostas.find(r => r.id === pergunta) : undefined
  const podeSimular = ctx.situacao === 'em_curso'

  return (
    <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda }]}>
      <Text style={[s.tituloCard, { color: cor.texto }]}>Simuler ma journée</Text>
      <Text style={[s.item, { color: cor.suave }]}>Essai temporaire, calculé par le même moteur. Rien n'est enregistré : ton service, ton historique et tes données restent intacts.</Text>

      {!podeSimular ? (
        <Text style={[s.texto, { color: cor.texto, marginTop: 10 }]}>Simulation non disponible : aucun service en cours à simuler.</Text>
      ) : (
        <>
          <Text style={[s.tituloBloco, { color: cor.texto, marginTop: 12 }]}>Pause prévue à partir de maintenant</Text>
          <View style={s.stepper}>
            <Passo icone="remove" onPress={() => pausa(-PAUSA_SIM_PASSO_MIN)} desativado={params.pausaMin <= 0} cor={cor} rotulo="Moins 5 minutes" />
            <Text style={[s.stepVal, { color: cor.texto }]}>{params.pausaMin} min</Text>
            <Passo icone="add" onPress={() => pausa(PAUSA_SIM_PASSO_MIN)} desativado={params.pausaMin >= PAUSA_SIM_MAX_MIN} cor={cor} rotulo="Plus 5 minutes" />
          </View>
          <View style={s.chips}>
            {[15, 30, 45].map(m => (
              <TouchableOpacity key={m} onPress={() => setParams({ ...params, pausaMin: m })} accessibilityRole="button"
                style={[s.chip, { backgroundColor: params.pausaMin === m ? cor.btnAtivo : cor.btn, borderColor: params.pausaMin === m ? '#f5a623' : cor.borda }]}>
                <Text style={[s.chipTxt, { color: cor.texto }]}>{m} min</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[s.tituloBloco, { color: cor.texto, marginTop: 12 }]}>Heure de fin souhaitée</Text>
          {h ? (
            <View>
              <View style={s.stepper}>
                <Passo icone="remove" onPress={() => mudarH(-1)} cor={cor} rotulo="Heure moins 1" />
                <Text style={[s.stepVal, { color: cor.texto }]}>{dd(h.h)}h</Text>
                <Passo icone="add" onPress={() => mudarH(1)} cor={cor} rotulo="Heure plus 1" />
                <View style={{ width: 16 }} />
                <Passo icone="remove" onPress={() => mudarM(-5)} cor={cor} rotulo="Minutes moins 5" />
                <Text style={[s.stepVal, { color: cor.texto }]}>{dd(h.m)}</Text>
                <Passo icone="add" onPress={() => mudarM(5)} cor={cor} rotulo="Minutes plus 5" />
              </View>
              <TouchableOpacity onPress={() => setParams({ ...params, fimDesejado: null })}><Text style={[s.link, { color: cor.suave }]}>Retirer l'heure de fin</Text></TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={ligarFim} style={[s.chip, { backgroundColor: cor.btn, borderColor: cor.borda, alignSelf: 'flex-start' }]} accessibilityRole="button">
              <Text style={[s.chipTxt, { color: cor.texto }]}>Ajouter une heure de fin</Text>
            </TouchableOpacity>
          )}

          <View style={s.chips}>
            <TouchableOpacity onPress={() => setParams(parametrosOriginais())} disabled={original} accessibilityRole="button"
              style={[s.chip, { backgroundColor: cor.btn, borderColor: cor.borda, opacity: original ? 0.4 : 1 }]}>
              <Text style={[s.chipTxt, { color: cor.texto }]}>Réinitialiser</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onActualiser} disabled={aCarregar} accessibilityRole="button"
              style={[s.chip, { backgroundColor: cor.btn, borderColor: cor.borda, opacity: aCarregar ? 0.4 : 1 }]}>
              <Text style={[s.chipTxt, { color: cor.texto }]}>Actualiser les données réelles</Text>
            </TouchableOpacity>
          </View>

          {!sim.disponivel ? (
            <View style={{ marginTop: 10 }}>
              <Text style={[s.tituloBloco, { color: '#d64541' }]}>Simulation non disponible</Text>
              <Text style={[s.item, { color: cor.suave }]}>{'motivo' in sim ? sim.motivo : ''}</Text>
            </View>
          ) : (
            <View style={[s.simRes, { borderColor: cor.borda }]}>
              <Text style={[s.badgeSim]}>SIMULATION — pas ton service réel</Text>
              {ra?.destaque && (
                <View style={{ marginTop: 6 }}>
                  <Text style={[s.grande, { color: cor.destaque }]}>{ra.destaque.valor}</Text>
                  <Text style={[s.suave, { color: cor.suave }]}>{ra.destaque.legenda}</Text>
                </View>
              )}
              <Text style={[s.item, { color: cor.suave, marginTop: 4 }]}>{TXT_ESTADO[sim.motor.estado]}{sim.alterada ? ' (avec une pause hypothétique)' : ''}</Text>
              {real?.destaque && sim.alterada && <Text style={[s.item, { color: cor.suave }]}>Réel : {real.destaque.valor}</Text>}
              {sim.nota[pergunta] && <Text style={[s.item, { color: cor.suave }]}>{sim.nota[pergunta]}</Text>}
              {ra?.hipoteses.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
              {sim.comparacao && (
                <View style={{ marginTop: 8 }}>
                  <Text style={[s.tituloBloco, { color: sim.comparacao.tudoDentro ? '#27ae60' : '#d64541' }]}>{sim.comparacao.resumo}</Text>
                  {sim.comparacao.linhas.map((l, i) => (
                    <Text key={i} style={[s.item, { color: cor.suave }]}>• {l.restricao} : {l.dentro ? 'marge' : 'dépassement'} {Math.abs(Math.round(l.margemSeg / 60))} min</Text>
                  ))}
                  <Text style={[s.item, { color: cor.suave }]}>Service total estimé jusqu'à cette heure : {Math.floor(sim.comparacao.servicoTotalSeg / 3600)} h {dd(Math.round((sim.comparacao.servicoTotalSeg % 3600) / 60))}</Text>
                  {sim.comparacao.pausaExigidaSeg !== null && sim.comparacao.cumprimentoPausa && (
                    <Text style={[s.item, { color: cor.suave }]}>Pause de travail (L3312-2) : {sim.comparacao.cumprimentoPausa}.</Text>
                  )}
                </View>
              )}
              <Text style={[s.aviso, { color: cor.suave }]}>{AVISO_NAO_AUTORIZACAO}</Text>
            </View>
          )}
        </>
      )}
    </View>
  )
}

function Passo({ icone, onPress, desativado, cor, rotulo }: { icone: 'add' | 'remove'; onPress: () => void; desativado?: boolean; cor: Paleta; rotulo: string }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={desativado} accessibilityRole="button" accessibilityLabel={rotulo}
      style={[s.passo, { backgroundColor: cor.btn, borderColor: cor.borda, opacity: desativado ? 0.35 : 1 }]}>
      <Ionicons name={icone} size={22} color={cor.texto} />
    </TouchableOpacity>
  )
}

/* ───────────── Regra ───────────── */
function CartaoRegra({ regra, cor }: { regra: RegraExplicada; cor: Paleta }) {
  const [aberto, setAberto] = useState(false)
  const abrirLigacao = () => { Linking.openURL(regra.lien.url).catch(e => log.warn('assistente', 'ligação não aberta', { tipo: (e as any)?.name })) }
  return (
    <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda, paddingVertical: 10 }]}>
      <TouchableOpacity onPress={() => setAberto(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: aberto }} style={s.expCab}>
        <View style={{ flex: 1 }}>
          <Text style={[s.tituloBloco, { color: cor.texto, marginBottom: 0 }]}>{regra.titre}</Text>
          <Text style={[s.suave, { color: cor.suave }]}>{regra.reference}</Text>
        </View>
        <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={18} color={cor.suave} />
      </TouchableOpacity>
      {aberto && (
        <View style={{ marginTop: 8 }}>
          <Text style={[s.item, { color: cor.texto }]}>{regra.explication}</Text>
          <Text style={[s.tituloBloco, { color: cor.texto, marginTop: 8 }]}>Conditions d'application</Text>
          {regra.conditions.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
          <Text style={[s.tituloBloco, { color: '#e08e0b', marginTop: 8 }]}>Non vérifié</Text>
          {regra.nonVerifie.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
          <TouchableOpacity onPress={abrirLigacao} accessibilityRole="link" style={[s.chip, { backgroundColor: cor.btn, borderColor: cor.borda, alignSelf: 'flex-start', marginTop: 10 }]}>
            <Text style={[s.chipTxt, { color: cor.texto }]}>Source officielle : {regra.lien.origem} ↗</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  fundo: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: Platform.OS === 'android' ? 4 : 0, paddingBottom: 10, borderBottomWidth: 1 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 18, fontWeight: '800' },
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  tituloCard: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  seccao: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 6 },
  pergunta: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 12, minHeight: 64 },
  iconeP: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  perguntaTxt: { fontSize: 15, fontWeight: '700' },
  texto: { fontSize: 14, fontWeight: '600' },
  suave: { fontSize: 12 },
  grande: { fontSize: 30, fontWeight: '900' },
  badge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6 },
  badgeTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  badgeSim: { color: '#e08e0b', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  linhaH: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 },
  valorH: { fontSize: 14, fontWeight: '700' },
  tituloBloco: { fontSize: 13, fontWeight: '800', marginBottom: 4 },
  item: { fontSize: 12, lineHeight: 17, marginBottom: 2 },
  alerta: { color: '#e08e0b', fontSize: 12, fontWeight: '700', marginTop: 6, lineHeight: 17 },
  aviso: { fontSize: 11, marginTop: 12, fontStyle: 'italic' },
  link: { fontSize: 12, marginTop: 8, fontWeight: '700' },
  tecnico: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  expansivel: { borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
  expCab: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  stepper: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  stepVal: { fontSize: 18, fontWeight: '800', minWidth: 64, textAlign: 'center' },
  passo: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  chipTxt: { fontSize: 12, fontWeight: '700' },
  simRes: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 12, marginTop: 14 },
  btnPlein: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  btnPleinTxt: { color: '#1a1a1a', fontWeight: '800', fontSize: 14 },
})
