// app/assistente.tsx
// Assistant TachoOffice — «copilote du chauffeur». Rota separada, fora dos separadores.
//
// EXCLUSIVAMENTE DE LEITURA: lê as chaves que a app já usa através de `lerContextoAssistente` (só `multiGet`).
// A única escrita possível nesta página é a preferência «Activer l'assistant» (botão do cartão «désactivé»),
// feita por `useAssistenteAtivo`. A simulação e as perguntas livres vivem só em estado local (useState) e nunca
// tocam em dados persistidos: o interpretador (src/assistente/interpretador.ts) só devolve uma intenção, e
// `respostaLivre.ts` responde com o motor existente (prepararRespostas / simular), sem recalcular nada.
//
// SINCRONIZAÇÃO: a cada consulta (entrar no ecrã, tocar numa pergunta, enviar uma pergunta, «Actualiser») chama
// `recarregarApp` para manter o contexto partilhado fresco e, SEM depender dele, faz uma leitura única e consistente.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, StatusBar, Linking, Platform,
  TextInput, KeyboardAvoidingView, Keyboard, type LayoutChangeEvent,
} from 'react-native'
import { router, Stack, useFocusEffect } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../context/ThemeContext'
import { useApp } from '../context/AppContext'
import { log } from '../src/utils/logger'
import {
  lerContextoAssistente, prepararRespostas, prepararCartaoContexto, AVISO_NAO_AUTORIZACAO,
  type ContextoAssistente, type LeitorStorage, type PerguntaId, type Resposta,
} from '../src/engine/regras/lerContexto'
import {
  simular, parametrosOriginais, saoParametrosOriginais, PAUSA_SIM_MAX_MIN, PAUSA_SIM_PASSO_MIN,
  type ParametrosSimulacao,
} from '../src/engine/regras/simulacao'
import { regrasUsadas, type RegraExplicada } from '../src/engine/regras/regrasExplicadas'
import { useAssistenteAtivo } from '../src/assistente/useAssistenteAtivo'
import { interpretar, interpretacaoDireta, type IntencaoId, type Interpretacao } from '../src/assistente/interpretador'
import {
  responder, respostaErro, previewRapido, perguntaIdDe, PERGUNTAS_RAPIDAS, AVISO_INTERPRETADOR, type RespostaLivre,
} from '../src/assistente/respostaLivre'

// O leitor expõe SÓ multiGet: não há como escrever através dele.
const LEITOR: LeitorStorage = { multiGet: keys => AsyncStorage.multiGet([...keys]) }

const COR_ESTADO = { confirmado: '#27ae60', simulacao_condicionada: '#e08e0b', dados_insuficientes: '#d64541' } as const
const TXT_ESTADO = { confirmado: 'Résultat confirmé', simulacao_condicionada: 'Résultat conditionnel', dados_insuficientes: 'Données insuffisantes' } as const

const dd = (n: number) => String(n).padStart(2, '0')
const horaLocal = (ms: number) => { const d = new Date(ms); return `${dd(d.getHours())}:${dd(d.getMinutes())}` }

type Paleta = { bg: string; card: string; texto: string; suave: string; borda: string; btn: string; btnAtivo: string; destaque: string }
/** pedido atual: pergunta rápida (textoLivre = null) ou pergunta escrita; a resposta é recalculada quando o contexto muda */
type Pedido = { chave: number; textoLivre: string | null; interp: Interpretacao }

export default function AssistenteScreen() {
  const { themeSombre } = useTheme()
  const { recarregarApp } = useApp()
  const { ativo, definir } = useAssistenteAtivo()
  const insets = useSafeAreaInsets()
  const [ctx, setCtx] = useState<ContextoAssistente | null>(null)
  const [pergunta, setPergunta] = useState<PerguntaId>('amplitude')
  const [pedido, setPedido] = useState<Pedido>({ chave: 0, textoLivre: null, interp: interpretacaoDireta('amplitude') })
  const [aCarregar, setACarregar] = useState(false)
  const [params, setParams] = useState<ParametrosSimulacao>(parametrosOriginais())
  const [texto, setTexto] = useState('')
  const [tecladoAberto, setTecladoAberto] = useState(false)
  const [regrasAberto, setRegrasAberto] = useState(false)
  const [simAberto, setSimAberto] = useState(false)
  const seq = useRef(0)
  const chave = useRef(0)
  const scrollRef = useRef<ScrollView>(null)
  const yResposta = useRef(0)
  const yRegras = useRef(0)

  const cor: Paleta = themeSombre
    ? { bg: '#0f1117', card: '#1b1e29', texto: '#ffffff', suave: '#a3aac4', borda: '#2a2e3d', btn: '#252938', btnAtivo: '#33426e', destaque: '#f5a623' }
    : { bg: '#f2f3f8', card: '#ffffff', texto: '#14161f', suave: '#555d78', borda: '#dfe2ec', btn: '#e6e8f1', btnAtivo: '#fff1d6', destaque: '#c47d0e' }

  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setTecladoAberto(true))
    const b = Keyboard.addListener('keyboardDidHide', () => setTecladoAberto(false))
    return () => { a.remove(); b.remove() }
  }, [])

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
  const respostaPergunta: Resposta | undefined = preparado?.respostas.find(r => r.id === pergunta)
  const regras = useMemo(() => (ctx ? regrasUsadas(ctx.motor) : []), [ctx])
  const previews = useMemo(() => PERGUNTAS_RAPIDAS.map(q => previewRapido(q.intencao, ctx)), [ctx])
  const resposta: RespostaLivre = useMemo(() => {
    try { return responder(pedido.interp, ctx) } catch (e) { log.error('assistente', 'responder falhou', e); return respostaErro() }
  }, [pedido, ctx])

  const rolarPara = (y: number) => setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }), 150)

  const pedir = (interp: Interpretacao, textoLivre: string | null) => {
    chave.current += 1
    setPedido({ chave: chave.current, textoLivre, interp })
    if (interp.tipo === 'intencao') setPergunta(perguntaIdDe(interp.intencao))
    void consultar('consulta-assistente')
    rolarPara(yResposta.current)
  }

  const enviar = () => {
    const t = texto.trim()
    if (!t) return
    Keyboard.dismiss()
    const interp = interpretar(t)
    log.info('assistente', 'pergunta livre interpretada', {
      tipo: interp.tipo,
      intencao: interp.tipo === 'intencao' ? interp.intencao : null,
      candidatas: interp.tipo === 'ambigua' ? interp.candidatas : null,
      idioma: interp.tipo === 'vazia' ? null : interp.idioma,
      pontuacao: interp.tipo === 'intencao' ? interp.pontuacao : null,
      falta: interp.tipo === 'intencao' ? interp.falta : null,
      horaFim: interp.tipo === 'intencao' ? interp.horaFim : null,
      duracaoMin: interp.tipo === 'intencao' ? interp.duracaoMin : null,
      texto: interp.tipo === 'vazia' ? '' : interp.textoNormalizado.slice(0, 80),
    })
    pedir(interp, t)
    setTexto('')
  }

  const escolherRapida = (intencao: IntencaoId) => {
    log.info('assistente', 'pergunta rápida', { intencao })
    pedir(interpretacaoDireta(intencao), null)
  }

  const abrirRegras = () => {
    setRegrasAberto(true)
    rolarPara(yRegras.current)
  }

  const selecionada = pedido.interp.tipo === 'intencao' ? pedido.interp.intencao : null
  const simAlterada = !saoParametrosOriginais(params)

  return (
    <SafeAreaView style={[s.fundo, { backgroundColor: cor.bg }]} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle={themeSombre ? 'light-content' : 'dark-content'} backgroundColor={cor.bg} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* Cabeçalho compacto */}
        <View style={[s.header, { borderBottomColor: cor.borda }]}>
          <TouchableOpacity onPress={voltar} accessibilityRole="button" accessibilityLabel="Retour"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={[s.iconBtn, { backgroundColor: cor.btn }]}>
            <Ionicons name="arrow-back" size={22} color={cor.texto} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text style={[s.titulo, { color: cor.texto }]} numberOfLines={1}>Assistant</Text>
            <Text style={[s.suave, { color: cor.suave }]} numberOfLines={1}>{ctx ? `Mis à jour ${horaLocal(ctx.agoraMs)}` : 'Lecture…'}</Text>
          </View>
          <TouchableOpacity onPress={() => void consultar('consulta-assistente')} disabled={aCarregar} accessibilityRole="button"
            accessibilityLabel="Actualiser les données" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[s.iconBtn, { backgroundColor: cor.btn, opacity: aCarregar ? 0.5 : 1 }]}>
            {aCarregar ? <ActivityIndicator size="small" color={cor.texto} /> : <Ionicons name="refresh" size={20} color={cor.texto} />}
          </TouchableOpacity>
        </View>

        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
          {ativo === false && (
            <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda }]}>
              <Text style={[s.tituloCard, { color: cor.texto }]}>Assistant désactivé</Text>
              <Text style={[s.item, { color: cor.suave }]}>Le bouton de l'écran d'accueil est masqué. Tu peux le réactiver ici ou dans Réglages → Assistant TachoOffice.</Text>
              <TouchableOpacity onPress={() => void definir(true)} style={[s.btnPlein, { backgroundColor: '#f5a623' }]} accessibilityRole="button">
                <Text style={s.btnPleinTxt}>Activer l'assistant</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Estado do serviço (dados reais) */}
          <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda }]}>
            <View style={s.linhaTopo}>
              <View style={[s.ponto, { backgroundColor: cartao?.emServico ? '#27ae60' : cor.suave }]} />
              <Text style={[s.tituloCard, { color: cor.texto, marginBottom: 0, flex: 1 }]} numberOfLines={1}>{cartao ? cartao.titulo : 'Lecture en cours…'}</Text>
            </View>
            {cartao && !cartao.emServico && preparado && (
              <Text style={[s.item, { color: cor.suave, marginTop: 4 }]}>{preparado.situacao.texto}</Text>
            )}
            {cartao && cartao.linhas.length > 0 && (
              <View style={s.celulas}>
                {cartao.linhas.map((l, i) => (
                  <View key={i} style={s.celula}>
                    <Text style={[s.suave, { color: cor.suave }]} numberOfLines={1}>{l.rotulo}</Text>
                    <Text style={[s.valorH, { color: cor.texto }]} numberOfLines={2}>{l.valor}</Text>
                  </View>
                ))}
              </View>
            )}
            {ctx?.precisaoServico === 'aproximada' && (
              <Text style={s.alerta}>⚠ Temps de service approximatif (ancre approximative) : résultats à vérifier.</Text>
            )}
            {cartao?.alertas.map((a, i) => <Text key={i} style={s.alerta}>⚠ {a}</Text>)}
          </View>

          {/* Perguntas rápidas 2×2 */}
          <Text style={[s.seccao, { color: cor.suave }]}>QUESTIONS RAPIDES</Text>
          <View style={s.grelha}>
            {PERGUNTAS_RAPIDAS.map((q, k) => {
              const sel = selecionada === q.intencao
              return (
                <TouchableOpacity key={q.intencao} onPress={() => escolherRapida(q.intencao)} activeOpacity={0.8}
                  accessibilityRole="button" accessibilityState={{ selected: sel }} accessibilityLabel={`${q.titulo} : ${previews[k]}`}
                  style={[s.quick, { backgroundColor: sel ? cor.btnAtivo : cor.card, borderColor: sel ? '#f5a623' : cor.borda }]}>
                  <View style={s.quickTopo}>
                    <View style={[s.iconeP, { backgroundColor: sel ? '#f5a623' : cor.btn }]}>
                      <Ionicons name={q.icone} size={18} color={sel ? '#1a1a1a' : cor.texto} />
                    </View>
                    <Text style={[s.quickValor, { color: previews[k] === '—' ? cor.suave : cor.destaque }]} numberOfLines={1} adjustsFontSizeToFit>{previews[k]}</Text>
                  </View>
                  <Text style={[s.perguntaTxt, { color: cor.texto }]} numberOfLines={1}>{q.titulo}</Text>
                  <Text style={[s.suave, { color: cor.suave }]} numberOfLines={1}>{q.descricao}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Resposta principal */}
          <View onLayout={(e: LayoutChangeEvent) => { yResposta.current = e.nativeEvent.layout.y }}>
            {aCarregar && !ctx && <ActivityIndicator style={{ marginTop: 12 }} />}
            <CartaoLivre r={resposta} cor={cor} textoLivre={pedido.textoLivre} avisosCtx={ctx?.avisos ?? []}
              onSugestao={i => escolherRapida(i)} onAbrirRegras={abrirRegras} />
          </View>

          {/* Simulação (compacta, fechada por defeito) */}
          <Acordeao titulo="Simuler ma journée" subtitulo={simAlterada ? 'Paramètres modifiés' : 'Pause et heure de fin hypothétiques'}
            aberto={simAberto} alternar={() => setSimAberto(v => !v)} cor={cor}>
            {ctx && <Simulacao ctx={ctx} pergunta={pergunta} params={params} setParams={setParams} cor={cor} real={respostaPergunta} onActualiser={() => void consultar('consulta-assistente')} aCarregar={aCarregar} />}
          </Acordeao>

          {/* Regras e sanções: um único acordeão, fechado por defeito */}
          <View onLayout={(e: LayoutChangeEvent) => { yRegras.current = e.nativeEvent.layout.y }}>
            <Acordeao titulo="Règles et sanctions" subtitulo="Règles utilisées, sources officielles"
              aberto={regrasAberto} alternar={() => setRegrasAberto(v => !v)} cor={cor}>
              <Text style={[s.item, { color: cor.suave, marginBottom: 6 }]}>
                {ctx?.motor ? 'Règles utilisées dans le calcul actuel.' : 'Règles prises en charge par l’assistant (aucun service en cours).'}
              </Text>
              <View style={[s.nota, { borderColor: cor.borda, backgroundColor: cor.btn }]}>
                <Text style={[s.tituloBloco, { color: cor.texto }]}>Sanctions</Text>
                <Text style={[s.item, { color: cor.suave }]}>
                  Aucun montant d'amende, aucune classe d'infraction ni aucun article de sanction n'est affiché : ces informations n'ont pas été vérifiées dans le texte officiel. Un dépassement calculé par l'assistant n'est pas une infraction constatée.
                </Text>
              </View>
              {regras.map(r => <CartaoRegra key={r.id} regra={r} cor={cor} />)}
            </Acordeao>
          </View>
        </ScrollView>

        {/* Campo fixo, fora do ScrollView */}
        <View style={[s.barra, { backgroundColor: cor.bg, borderTopColor: cor.borda, paddingBottom: tecladoAberto ? 8 : Math.max(insets.bottom, 8) }]}>
          <TextInput
            value={texto}
            onChangeText={setTexto}
            placeholder="Pose ta question..."
            placeholderTextColor={cor.suave}
            style={[s.entrada, { color: cor.texto, backgroundColor: cor.card, borderColor: cor.borda }]}
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={enviar}
            maxLength={200}
            autoCorrect={false}
            accessibilityLabel="Pose ta question"
          />
          <TouchableOpacity onPress={enviar} disabled={!texto.trim()} accessibilityRole="button" accessibilityLabel="Envoyer la question"
            style={[s.enviar, { backgroundColor: texto.trim() ? '#f5a623' : cor.btn }]}>
            <Ionicons name="send" size={20} color={texto.trim() ? '#1a1a1a' : cor.suave} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

/* ───────────── Resposta (curta; detalhes expansíveis) ───────────── */
function CartaoLivre({ r, cor, textoLivre, avisosCtx, onSugestao, onAbrirRegras }: {
  r: RespostaLivre; cor: Paleta; textoLivre: string | null; avisosCtx: string[]
  onSugestao: (i: IntencaoId) => void; onAbrirRegras: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const informativa = r.tipo === 'ambigua' || r.tipo === 'fora_ambito' || r.tipo === 'incompleta' || r.tipo === 'info' || r.tipo === 'a_carregar'
  const temDetalhes = r.linhas.length + r.alternativas.length + r.aConfirmer.length + r.naoVerificadas.length + r.detalhesTecnicos.length + avisosCtx.length > 0
  const corBadge = r.tipo === 'simulacao' ? '#e08e0b' : r.estado ? COR_ESTADO[r.estado] : cor.suave
  const txtBadge = r.tipo === 'simulacao' ? 'SIMULATION' : r.estado ? TXT_ESTADO[r.estado] : r.tipo === 'nao_suportada' ? 'Non disponible' : r.tipo === 'nao_avaliado' ? 'Non évalué' : ''
  return (
    <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda }]}>
      {textoLivre !== null && <Text style={[s.eco, { color: cor.suave }]} numberOfLines={3}>Toi : « {textoLivre} »</Text>}
      {txtBadge !== '' && <View style={[s.badge, { backgroundColor: corBadge }]}><Text style={s.badgeTxt}>{txtBadge}</Text></View>}
      <Text style={[s.suave, { color: cor.suave }]}>{r.titulo}</Text>

      {r.destaque && (
        <View style={{ marginVertical: 6 }}>
          <Text style={[s.grande, { color: cor.destaque }]} numberOfLines={2}>{r.destaque.valor}</Text>
          <Text style={[s.suave, { color: cor.suave }]}>{r.destaque.legenda}</Text>
        </View>
      )}

      {r.notas.map((n, i) => informativa
        ? <Text key={i} style={[s.item, { color: cor.texto, marginTop: 4 }]}>{n}</Text>
        : <Text key={i} style={s.alerta}>⚠ {n}</Text>)}
      {r.hipoteses.length > 0 && (
        <View style={{ marginTop: 6 }}>
          <Text style={[s.tituloBloco, { color: cor.texto }]}>Hypothèses utilisées</Text>
          {r.hipoteses.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
        </View>
      )}

      {r.sugestoes.length > 0 && (
        <View style={s.chips}>
          {r.sugestoes.map((g, i) => (
            <TouchableOpacity key={i} onPress={() => onSugestao(g.intencao)} accessibilityRole="button"
              style={[s.chip, { backgroundColor: cor.btn, borderColor: cor.borda }]}>
              <Text style={[s.chipTxt, { color: cor.texto }]}>{g.rotulo}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {r.abrirRegras && (
        <TouchableOpacity onPress={onAbrirRegras} accessibilityRole="button" style={[s.chip, { backgroundColor: cor.btn, borderColor: cor.borda, alignSelf: 'flex-start', marginTop: 10 }]}>
          <Text style={[s.chipTxt, { color: cor.texto }]}>Voir « Règles et sanctions »</Text>
        </TouchableOpacity>
      )}

      {temDetalhes && (
        <Expansivel titulo="Détails" aberto={aberto} alternar={() => setAberto(v => !v)} cor={cor}>
          {r.linhas.map((l, i) => (
            <View key={i} style={s.linhaH}>
              <Text style={[s.suave, { color: cor.suave, flex: 1 }]}>{l.rotulo}</Text>
              <Text style={[s.valorH, { color: cor.texto, flex: 1, textAlign: 'right' }]}>{l.valor}</Text>
            </View>
          ))}
          {r.alternativas.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={[s.tituloBloco, { color: cor.texto }]}>Alternative réglementaire calculée</Text>
              {r.alternativas.map((l, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {l.rotulo} : {l.valor}</Text>)}
            </View>
          )}
          {r.aConfirmer.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={[s.tituloBloco, { color: cor.texto }]}>Ce résultat dépend de…</Text>
              {r.aConfirmer.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
            </View>
          )}
          {r.naoVerificadas.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={[s.tituloBloco, { color: cor.texto }]}>Ce qui n'a pas été vérifié</Text>
              {r.naoVerificadas.map((t, i) => <Text key={i} style={[s.item, { color: cor.suave }]}>• {t}</Text>)}
            </View>
          )}
          {[...r.detalhesTecnicos, ...avisosCtx].length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={[s.tituloBloco, { color: cor.texto }]}>Détails techniques</Text>
              {[...r.detalhesTecnicos, ...avisosCtx].map((t, i) => <Text key={i} style={[s.tecnico, { color: cor.suave }]}>• {t}</Text>)}
            </View>
          )}
        </Expansivel>
      )}

      <Text style={[s.aviso, { color: cor.suave }]}>{r.aviso || AVISO_NAO_AUTORIZACAO}</Text>
      {textoLivre !== null && <Text style={[s.aviso, { color: cor.suave, marginTop: 4 }]}>{AVISO_INTERPRETADOR}</Text>}
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

/** Cartão-acordeão (simulação; regras e sanções). O conteúdo só é montado quando aberto. */
function Acordeao({ titulo, subtitulo, aberto, alternar, cor, children }: {
  titulo: string; subtitulo: string; aberto: boolean; alternar: () => void; cor: Paleta; children: React.ReactNode
}) {
  return (
    <View style={[s.card, { backgroundColor: cor.card, borderColor: cor.borda, paddingVertical: 10 }]}>
      <TouchableOpacity onPress={alternar} accessibilityRole="button" accessibilityState={{ expanded: aberto }} style={s.expCab}>
        <View style={{ flex: 1 }}>
          <Text style={[s.tituloCard, { color: cor.texto, marginBottom: 0 }]}>{titulo}</Text>
          <Text style={[s.suave, { color: cor.suave }]}>{subtitulo}</Text>
        </View>
        <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={20} color={cor.suave} />
      </TouchableOpacity>
      {aberto && <View style={{ marginTop: 10 }}>{children}</View>}
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
    <View>
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
  conteudo: { padding: 12, paddingBottom: 16, gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  tituloCard: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  seccao: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 6 },
    iconeP: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  perguntaTxt: { fontSize: 15, fontWeight: '700' },
  texto: { fontSize: 14, fontWeight: '600' },
  suave: { fontSize: 12 },
  grande: { fontSize: 26, fontWeight: '900' },
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
  linhaTopo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ponto: { width: 10, height: 10, borderRadius: 5 },
  celulas: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, rowGap: 8 },
  celula: { width: '50%', paddingRight: 8 },
  grelha: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quick: { flexBasis: '48%', flexGrow: 1, borderWidth: 1.5, borderRadius: 14, padding: 10, minHeight: 84 },
  quickTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 },
  quickValor: { fontSize: 15, fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  eco: { fontSize: 12, fontStyle: 'italic', marginBottom: 6 },
  nota: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8 },
  barra: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1 },
  entrada: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, fontSize: 15 },
  enviar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
