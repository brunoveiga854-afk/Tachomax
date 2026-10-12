// src/engine/regras/lerContexto.ts
// Liga os dados REAIS da app ao motor regulamentar, em modo EXCLUSIVAMENTE DE LEITURA.
//
//   storage (multiGet) ─► emCurso.ts ─► deJour.ts (entradaMotorDeJour) ─► orquestrador (avaliarRegras)
//                                                                      └► prepararRespostas (texto para a página)
//
// FONTE DE VERDADE ÚNICA: lê as chaves que a app já usa ('TACHOOFFICE_estado', 'historique', 'profil',
// 'pausaFimTimestamp'). Não cria histórico, não guarda cópias, não escreve nada. O leitor recebido só tem
// `multiGet` (por construção não há como escrever); os testes verificam-no.
//
// SINCRONIZAÇÃO — decisão documentada
//   `await recarregarApp()` resolve quando o AppContext fez `setState`, mas o componente que o chamou continua a
//   ver o `appState` ANTIGO até ao re-render (closure). Usar `appState.histCal` logo a seguir pode, por isso,
//   dar histórico desatualizado. Para não depender disso, a consulta faz UMA leitura `multiGet` de todas as
//   chaves (um ponto consistente no tempo): estado do serviço, histórico e perfil vêm do mesmo instante. A
//   página continua a chamar `recarregarApp` para manter o contexto partilhado fresco, mas o cálculo não depende
//   dele. As entradas do histórico são lidas com as mesmas regras do AppContext (JSON inválido ou não-array →
//   ignorado e avisado, nunca corrigido).
//
// SEGURANÇA DE RESULTADO
//   O motor devolve cálculo matemático, nunca autorização. As respostas só mostram valores quando a restrição
//   relevante foi avaliada e o estado global não é 'dados_insuficientes'; caso contrário mostram os dados em
//   falta («Information manquante»). Nada é deduzido de CD/MIXTE/LD. O tempo de condução não é medido nem calculado.
import { chaveDia } from '../../utils/dataDia'
import { entradaMotorDeJour, type JourEntrada, type ProfilApp, type ResultadoDeJour } from './deJour'
import { avaliarRegras, type ResultadoMotor } from './orquestrador'
import { lerEstadoPersistido } from './emCurso'
import { formatarInstante } from './tempo'
import type { EstadoResultado } from './tipos'

// ── Leitor só de leitura ──────────────────────────────────────────────────────
export type LeitorStorage = {
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>
}
export const CHAVE_ESTADO = 'TACHOOFFICE_estado'
export const CHAVE_HISTORICO = 'historique'
export const CHAVE_PERFIL = 'profil'
export const CHAVE_PAUSA_FIM = 'pausaFimTimestamp'
export const CHAVES_LIDAS = [CHAVE_ESTADO, CHAVE_HISTORICO, CHAVE_PERFIL, CHAVE_PAUSA_FIM] as const

export type SituacaoServico = 'sem_servico' | 'invalido' | 'em_curso' | 'transicao' | 'erro_leitura'

export type ContextoAssistente = {
  agoraMs: number
  situacao: SituacaoServico
  /** motivo (PT técnico) quando a situação não é 'em_curso' */
  motivo: string | null
  estado: EstadoResultado
  motor: ResultadoMotor | null
  adaptador: ResultadoDeJour | null
  /** avisos de leitura/conversão (PT técnico) */
  avisos: string[]
  precisaoServico: 'ancorada' | 'aproximada' | null
  emPausa: boolean
  historicoLegivel: boolean
}

const chavesParaLer = (): string[] => [...CHAVES_LIDAS]

function lerHistorico(raw: string | null | undefined, avisos: string[]): { lista: JourEntrada[]; legivel: boolean } {
  if (raw == null) return { lista: [], legivel: true }
  try {
    const p = JSON.parse(raw)
    if (Array.isArray(p)) return { lista: p.filter(x => x && typeof x === 'object') as JourEntrada[], legivel: true }
    avisos.push('Histórico não é uma lista: ignorado (chave intacta).')
  } catch { avisos.push('Histórico ilegível: ignorado (chave intacta).') }
  return { lista: [], legivel: false }
}

const vazio = (agoraMs: number, situacao: SituacaoServico, motivo: string | null, avisos: string[], historicoLegivel: boolean): ContextoAssistente => ({
  agoraMs, situacao, motivo, estado: 'dados_insuficientes', motor: null, adaptador: null, avisos,
  precisaoServico: null, emPausa: false, historicoLegivel,
})

/**
 * Lê, converte e avalia. Nunca lança; nunca escreve. `agoraMs` = instante da consulta (epoch real).
 */
export async function lerContextoAssistente(
  storage: LeitorStorage,
  agoraMs: number,
  opcoes: { relogioParede?: (epochMs: number) => number } = {},
): Promise<ContextoAssistente> {
  const avisos: string[] = []
  let pares: readonly (readonly [string, string | null])[]
  try { pares = await storage.multiGet(chavesParaLer()) }
  catch { return vazio(agoraMs, 'erro_leitura', 'Leitura do armazenamento falhou.', ['Leitura do armazenamento falhou: nada foi calculado.'], false) }
  const m = new Map<string, string | null>()
  for (const par of pares ?? []) if (Array.isArray(par)) m.set(par[0], par[1] ?? null)

  const perfilRaw = m.get(CHAVE_PERFIL)
  const profil: ProfilApp = perfilRaw === 'CD' || perfilRaw === 'MIXTE' || perfilRaw === 'LD' ? perfilRaw : null
  const hist = lerHistorico(m.get(CHAVE_HISTORICO), avisos)

  const leitura = lerEstadoPersistido(m.get(CHAVE_ESTADO), agoraMs, { pausaFimTimestampRaw: m.get(CHAVE_PAUSA_FIM) })
  if (leitura.tipo === 'sem_servico') {
    return vazio(agoraMs, 'sem_servico', leitura.motivo === 'chave_ausente' ? 'Sem snapshot de serviço.' : 'Serviço não ativo.', avisos, hist.legivel)
  }
  if (leitura.tipo === 'invalido') return vazio(agoraMs, 'invalido', leitura.motivo, avisos, hist.legivel)

  const sv = leitura.servico
  avisos.push(...sv.avisos)

  // Transição serviço em curso → terminado: o histórico já tem este serviço (mesmo dia e hora de início) mas o
  // snapshot ainda não foi apagado. Não se conta duas vezes: o snapshot é ignorado.
  const ano = new Date(sv.inicioRealMs).getFullYear()
  const chaveAtual = chaveDia({ date: sv.jour.date }, ano)
  const jaNoHistorico = hist.lista.some(h =>
    (h.type === 'TRAB' || h.type === 'DEC') && h.debut === sv.jour.debut && chaveDia(h, ano) === chaveAtual)
  if (jaNoHistorico) {
    return vazio(agoraMs, 'transicao', 'O serviço já está registado no histórico (fim de serviço em curso): snapshot ignorado para não contar duas vezes.', avisos, hist.legivel)
  }

  const adaptador = entradaMotorDeJour(sv.jour, hist.lista, profil, { agoraMs, ...(opcoes.relogioParede ? { relogioParede: opcoes.relogioParede } : {}) })
  const motor = avaliarRegras(adaptador.entrada)
  return {
    agoraMs, situacao: 'em_curso', motivo: null, estado: motor.estado, motor, adaptador,
    avisos: [...avisos, ...adaptador.avisos], precisaoServico: sv.precisao, emPausa: sv.emPausa, historicoLegivel: hist.legivel,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Apresentação (texto francês para a página). Puro e testável.
// ═════════════════════════════════════════════════════════════════════════════
export type PerguntaId = 'amplitude' | 'servico' | 'repos'

export const PERGUNTAS: { id: PerguntaId; titulo: string }[] = [
  { id: 'amplitude', titulo: 'Quelle amplitude me reste-t-il ?' },
  { id: 'servico', titulo: 'Combien de temps de service me reste-t-il ?' },
  { id: 'repos', titulo: 'Quel repos dois-je prendre ?' },
]

export const AVISO_NAO_AUTORIZACAO = "Calcul mathématique à partir des données de l'application. Ce n'est pas une autorisation réglementaire."

export type Linha = { rotulo: string; valor: string }
export type Resposta = {
  id: PerguntaId
  titulo: string
  /** o motor tem dados suficientes para ESTA pergunta */
  disponivel: boolean
  estado: EstadoResultado
  estadoTexto: string
  linhas: Linha[]
  /** resultado principal em destaque (null se o motor não tem dados suficientes para esta pergunta) */
  destaque: { valor: string; legenda: string } | null
  /** hipóteses usadas no cálculo, curtas e SEMPRE visíveis junto do resultado */
  hipoteses: string[]
  /** alternativas regulamentares — só as que o motor calcula */
  alternativas: Linha[]
  /** avisos críticos (dados aproximados/incompletos): visíveis sem abrir secções */
  alertas: string[]
  /** dados sem os quais não há resultado */
  informationManquante: string[]
  /** dados que condicionam o resultado (simulação) */
  aConfirmer: string[]
  naoVerificadas: string[]
  /** texto técnico do motor (PT), para consulta */
  detalhesTecnicos: string[]
  aviso: string
}

export type Situacao = { situacao: SituacaoServico; texto: string }

const ESTADO_TEXTO: Record<EstadoResultado, string> = {
  confirmado: 'Calcul avec données confirmées (limité aux restrictions évaluées)',
  simulacao_condicionada: 'Simulation conditionnée — dépend de données non confirmées',
  dados_insuficientes: 'Données insuffisantes',
}

export function fmtDuracao(seg: number): string {
  const neg = seg < 0
  const s = Math.round(Math.abs(seg))
  const h = Math.floor(s / 3600)
  const mi = Math.floor((s % 3600) / 60)
  return `${neg ? '−' : ''}${h} h ${String(mi).padStart(2, '0')} min`
}

const NAO_VERIFICADAS_BASE = [
  "Limites de conduite (9 h/10 h par jour, 56 h, 90 h, pause de 45 min après 4 h 30) : non évaluées — l'application ne mesure pas le temps de conduite.",
  'Repos hebdomadaire : non évalué.',
  'Équipage, repos fractionné 3 h + 9 h et dérogations : non pris en charge.',
]

type Falta = { texto: string; bloqueante: boolean; perguntas: PerguntaId[] }

function levantarFaltas(c: ContextoAssistente): Falta[] {
  const out: Falta[] = []
  if (!c.motor || !c.adaptador) return out
  const e = c.adaptador.entrada
  const d = c.adaptador.diagnostico
  const todas: PerguntaId[] = ['amplitude', 'servico', 'repos']
  if (typeof e.inicioServicoMs !== 'number') out.push({ texto: 'Début du service', bloqueante: true, perguntas: todas })
  if (e.contexto.regulamento561 === 'desconhecido') out.push({ texto: 'Application du règlement (CE) 561/2006 à ce véhicule', bloqueante: false, perguntas: ['amplitude', 'repos'] })
  if (e.contexto.enquadramentoFrances === 'desconhecido') out.push({ texto: 'Application du Code des transports (transport public routier de marchandises)', bloqueante: false, perguntas: ['servico'] })
  if (e.contexto.categoria === 'desconhecida') out.push({ texto: 'Catégorie réglementaire (grand routier, autre marchandises, messagerie/fonds) — nécessaire pour la limite hebdomadaire', bloqueante: false, perguntas: ['servico'] })
  if (!e.fimDescansoAnterior) out.push({ texto: "Fin du repos précédent (aucun service précédent exploitable dans l'historique, ou intervalle de moins de 9 h)", bloqueante: true, perguntas: ['amplitude', 'repos'] })
  else if (!e.fimDescansoAnterior.confirmado) out.push({ texto: "Confirmation de la fin du repos précédent (déduite de l'historique)", bloqueante: false, perguntas: ['amplitude', 'repos'] })
  if (!e.descansoSeguinte) out.push({ texto: 'Repos quotidien prévu ensuite (11 h normal ou 9 h réduit)', bloqueante: false, perguntas: ['amplitude', 'repos'] })
  if (!e.reducoes) out.push({ texto: 'Réductions de repos déjà utilisées depuis le dernier repos hebdomadaire', bloqueante: false, perguntas: ['amplitude', 'repos'] })
  else if (e.reducoes.estado !== 'confirmado') out.push({ texto: "Confirmation des réductions de repos déjà utilisées (déduites de l'historique)", bloqueante: false, perguntas: ['amplitude', 'repos'] })
  if (e.confirmacoes?.tempoServicoEquivaleServicoRegulamentar !== true) out.push({ texto: "Confirmation que le « service » de l'application correspond au temps de service réglementaire", bloqueante: false, perguntas: ['servico'] })
  if (!e.semana || !e.semana.completa) out.push({ texto: "Semaine complète dans l'historique (total hebdomadaire)", bloqueante: false, perguntas: ['servico'] })
  if (d.segPausaSemDetalheSeg > 60) out.push({ texto: `Horaire des pauses (${Math.round(d.segPausaSemDetalheSeg / 60)} min de pause sans détail horaire)`, bloqueante: false, perguntas: ['servico', 'repos'] })
  if ((e.pausas?.length ?? 0) > 0) out.push({ texto: "Nature des pauses (temps libre confirmé) — aucune pause n'est comptée comme réglementaire sans cette confirmation", bloqueante: false, perguntas: ['servico', 'repos'] })
  return out
}

function restricao(m: ResultadoMotor, id: string) { return m.restricoes.find(r => r.id === id) }
const detalheNum = (r: { detalhe?: Record<string, number | string | boolean | null> } | undefined, k: string): number | null => {
  const v = r?.detalhe?.[k]
  return typeof v === 'number' ? v : null
}

/** Avisos críticos comuns: dados aproximados/incompletos que o motorista tem de ver SEM abrir secções. */
function alertasComuns(c: ContextoAssistente): string[] {
  const out: string[] = []
  if (c.situacao !== 'em_curso' || !c.adaptador) return out
  const d = c.adaptador.diagnostico
  if (c.precisaoServico === 'aproximada') out.push("Temps de service approximatif : l'heure exacte d'enregistrement n'est pas disponible.")
  if (d.segPausaSemDetalheSeg > 60) out.push(`${Math.round(d.segPausaSemDetalheSeg / 60)} min de pause sans horaire : elles ne sont pas positionnées dans le calcul.`)
  if (d.nPausasDescartadas > 0) out.push(`${d.nPausasDescartadas} pause(s) ignorée(s) : données invalides ou hors du service.`)
  if (!c.historicoLegivel) out.push("Historique illisible : le repos précédent n'a pas pu être déterminé.")
  return out
}

/** Hipóteses efetivamente usadas na conta (curtas) para cada pergunta. */
function hipotesesDe(c: ContextoAssistente, id: PerguntaId): string[] {
  const out: string[] = []
  if (!c.adaptador) return out
  const e = c.adaptador.entrada
  if ((id === 'amplitude' || id === 'repos') && !e.descansoSeguinte) out.push('Repos quotidien suivant supposé normal (11 h)')
  if ((id === 'amplitude' || id === 'repos') && e.fimDescansoAnterior && !e.fimDescansoAnterior.confirmado) out.push("Fin du repos précédent déduite de l'historique")
  if ((id === 'amplitude' || id === 'repos') && e.contexto.regulamento561 === 'desconhecido') out.push('Règlement 561/2006 supposé applicable')
  if (id === 'servico' && e.contexto.enquadramentoFrances === 'desconhecido') out.push('Code des transports supposé applicable')
  if (id === 'servico' && e.confirmacoes?.tempoServicoEquivaleServicoRegulamentar !== true) out.push("« Service » de l'app = temps de service réglementaire")
  if ((e.pausaPrevistaSeg ?? 0) > 0) out.push(`Pause simulée de ${Math.round((e.pausaPrevistaSeg ?? 0) / 60)} min`)
  return out
}

export type CartaoContexto = {
  emServico: boolean
  titulo: string
  linhas: Linha[]
  alertas: string[]
}

/** Cartão «contexto do serviço» com os dados REAIS lidos; nada é preenchido quando não há serviço. */
export function prepararCartaoContexto(c: ContextoAssistente): CartaoContexto {
  if (c.situacao !== 'em_curso' || !c.adaptador) {
    const titulo = c.situacao === 'invalido' ? 'Service illisible'
      : c.situacao === 'erro_leitura' ? 'Lecture impossible'
      : c.situacao === 'transicao' ? 'Service enregistré'
      : 'Aucun service en cours'
    return { emServico: false, titulo, linhas: [], alertas: [] }
  }
  const e = c.adaptador.entrada
  const d = c.adaptador.diagnostico
  const linhas: Linha[] = []
  if (typeof e.inicioServicoMs === 'number') {
    linhas.push({ rotulo: 'Début', valor: formatarInstante(e.inicioServicoMs, true) })
    if (typeof e.referenciaMs === 'number') linhas.push({ rotulo: 'Amplitude écoulée', valor: fmtDuracao(Math.max(0, (e.referenciaMs - e.inicioServicoMs) / 1000)) })
  }
  linhas.push({ rotulo: 'Service accumulé', valor: fmtDuracao(e.servicoAcumuladoSeg ?? 0) })
  linhas.push({ rotulo: 'Pauses cumulées', valor: fmtDuracao(d.segPausa) + (d.segPausaSemDetalheSeg > 60 ? ` (dont ${Math.round(d.segPausaSemDetalheSeg / 60)} min sans horaire)` : '') })
  return { emServico: true, titulo: c.emPausa ? 'Service en cours — en pause' : 'Service en cours', linhas, alertas: alertasComuns(c) }
}

export function prepararRespostas(c: ContextoAssistente): { situacao: Situacao; respostas: Resposta[] } {
  const faltas = levantarFaltas(c)
  const textoSituacao: Record<SituacaoServico, string> = {
    em_curso: c.emPausa ? 'Service en cours — pause en cours.' : 'Service en cours.',
    sem_servico: "Aucun service en cours : l'assistant utilise le service démarré dans l'écran d'accueil.",
    invalido: 'Le service en cours ne peut pas être exploité (données illisibles ou incohérentes).',
    transicao: "Le service vient d'être enregistré dans l'historique : aucun service en cours à évaluer.",
    erro_leitura: 'Lecture des données impossible : rien n’a été calculé.',
  }
  const situacao: Situacao = { situacao: c.situacao, texto: textoSituacao[c.situacao] }
  const bloqueioSemServico = c.situacao === 'em_curso' ? [] : ['Service en cours (début, temps de service, pauses)']

  const respostas: Resposta[] = PERGUNTAS.map(({ id, titulo }) => {
    const da = faltas.filter(f => f.perguntas.includes(id))
    const base: Resposta = {
      id, titulo, disponivel: false, estado: c.estado, estadoTexto: ESTADO_TEXTO[c.estado], linhas: [],
      destaque: null, hipoteses: [], alternativas: [], alertas: alertasComuns(c),
      informationManquante: [...bloqueioSemServico, ...da.filter(f => f.bloqueante).map(f => f.texto)],
      aConfirmer: da.filter(f => !f.bloqueante).map(f => f.texto),
      naoVerificadas: [...NAO_VERIFICADAS_BASE], detalhesTecnicos: [], aviso: AVISO_NAO_AUTORIZACAO,
    }
    const m = c.motor
    if (!m || !c.adaptador || c.estado === 'dados_insuficientes') {
      if (m) {
        base.detalhesTecnicos = [m.resumo, ...m.emFalta]
        if (base.informationManquante.length === 0) base.informationManquante = m.emFalta.length ? ['Données réglementaires essentielles (voir détails)'] : ['Données insuffisantes pour cette question']
      }
      return base
    }
    const ref = c.adaptador.entrada.referenciaMs ?? 0
    const rAmp = restricao(m, 'amplitude_janela_descanso')
    const rSrv = restricao(m, 'servico_diario')
    const rSem = restricao(m, 'servico_semanal_isolado')

    if (id === 'amplitude') {
      if (!rAmp?.avaliada || rAmp.fimMaximoMs === null) { base.informationManquante = base.informationManquante.length ? base.informationManquante : ['Données de repos précédent'] ; base.detalhesTecnicos = [...(rAmp?.pressupostos ?? []), ...(rAmp?.emFalta ?? [])]; return base }
      const fim = rAmp.fimMaximoMs
      base.disponivel = true
      base.hipoteses = hipotesesDe(c, 'amplitude')
      base.destaque = { valor: fim >= ref ? fmtDuracao((fim - ref) / 1000) : 'Dépassée', legenda: `Fin théorique de l'amplitude : ${formatarInstante(fim, true)}` }
      if (fim < ref) base.alertas.push("Selon le calcul, l'amplitude maximale théorique est déjà dépassée.")
      base.linhas.push(
        { rotulo: 'Fin maximale théorique du service (amplitude)', valor: formatarInstante(fim, true) },
        { rotulo: 'Temps restant (calcul)', valor: fim >= ref ? fmtDuracao((fim - ref) / 1000) : `dépassée de ${fmtDuracao((ref - fim) / 1000)}` },
        { rotulo: 'Repos pris comme hypothèse', valor: rAmp.detalhe?.descansoUsado === 'reduzido' ? '9 h (réduit)' : '11 h (normal)' },
        { rotulo: 'Amplitude maximale correspondante', valor: fmtDuracao(detalheNum(rAmp, 'amplitudeMaximaSeg') ?? 0) },
      )
      if (m.janelasDescanso.reduzidoMs !== null) base.alternativas.push({ rotulo: 'Avec un repos réduit de 9 h (si une réduction est disponible)', valor: `fin théorique ${formatarInstante(m.janelasDescanso.reduzidoMs, true)}` })
      base.detalhesTecnicos = [...rAmp.pressupostos, ...rAmp.emFalta]
      return base
    }

    if (id === 'servico') {
      if (!rSrv?.avaliada || rSrv.fimMaximoMs === null) { base.informationManquante = base.informationManquante.length ? base.informationManquante : ['Enquadrement du service (Code des transports)']; base.detalhesTecnicos = [...(rSrv?.pressupostos ?? []), ...(rSrv?.emFalta ?? [])]; return base }
      const restante = detalheNum(rSrv, 'restanteServicoSeg') ?? 0
      const limite = detalheNum(rSrv, 'limiteAplicadoSeg') ?? 0
      base.disponivel = true
      base.hipoteses = hipotesesDe(c, 'servico')
      base.destaque = { valor: fmtDuracao(restante), legenda: `Limite ${fmtDuracao(limite)}${rSrv.detalhe?.trabalhoNoturno === true ? ' (travail de nuit)' : ''} · fin théorique ${formatarInstante(rSrv.fimMaximoMs, true)}` }
      base.linhas.push(
        { rotulo: 'Service effectué', valor: fmtDuracao(c.adaptador.entrada.servicoAcumuladoSeg ?? 0) },
        { rotulo: `Limite journalière appliquée${rSrv.detalhe?.trabalhoNoturno === true ? ' (travail de nuit)' : ''}`, valor: fmtDuracao(limite) },
        { rotulo: 'Service restant (limite journalière, calcul)', valor: fmtDuracao(restante) },
        { rotulo: 'Fin théorique selon cette limite', valor: formatarInstante(rSrv.fimMaximoMs, true) },
      )
      if (rSem?.avaliada) base.linhas.push({ rotulo: 'Reste sur la semaine (semaine isolée, calcul)', valor: fmtDuracao(detalheNum(rSem, 'restanteSeg') ?? 0) })
      else base.naoVerificadas.unshift('Limite hebdomadaire de service : non évaluée (catégorie ou semaine incomplète).')
      if (m.restricaoMaisLimitativa && m.resultadoMatematico.servicoUtilizavelSeg !== null) {
        base.linhas.push({ rotulo: `Service restant selon la restriction la plus limitante (${m.restricaoMaisLimitativa.nome})`, valor: fmtDuracao(m.resultadoMatematico.servicoUtilizavelSeg - (c.adaptador.entrada.servicoAcumuladoSeg ?? 0)) })
      }
      base.detalhesTecnicos = [...rSrv.pressupostos, ...rSrv.emFalta]
      return base
    }

    // repos
    const j = m.janelasDescanso
    if (!rAmp?.avaliada || j.normalMs === null) { base.informationManquante = base.informationManquante.length ? base.informationManquante : ['Fin du repos précédent']; base.detalhesTecnicos = [...(rAmp?.pressupostos ?? []), ...(rAmp?.emFalta ?? [])]; return base }
    base.disponivel = true
    base.hipoteses = hipotesesDe(c, 'repos')
    base.destaque = { valor: formatarInstante(j.normalMs, true), legenda: 'Début du repos quotidien de 11 h au plus tard' }
    base.linhas.push({ rotulo: 'Repos quotidien normal : 11 h', valor: `doit commencer au plus tard à ${formatarInstante(j.normalMs, true)} pour être achevé dans les 24 h suivant la fin du repos précédent` })
    if (j.reduzidoMs !== null) base.alternativas.push({ rotulo: 'Repos quotidien réduit : 9 h (maximum 3 entre deux repos hebdomadaires)', valor: `début au plus tard à ${formatarInstante(j.reduzidoMs, true)}` })
    else if (j.reduzidoDisponivel === false) base.alternativas.push({ rotulo: 'Repos quotidien réduit : 9 h', valor: 'plus de réduction disponible' })
    const r = c.adaptador.entrada.reducoes
    base.linhas.push({ rotulo: 'Réductions utilisées depuis le dernier repos hebdomadaire', valor: r ? `${r.utilizadas} sur 3${r.restantes === null ? ' (restantes inconnues)' : ''}` : 'inconnu' })
    if (m.pausas && m.pausas.exigidoSeg > 0) {
      base.linhas.push({ rotulo: 'Pause de travail exigée (L3312-2)', valor: `${Math.round(m.pausas.exigidoSeg / 60)} min — pauses vérifiées : ${Math.round(m.pausas.validasSeg / 60)} min` })
    }
    base.detalhesTecnicos = [...rAmp.pressupostos, ...rAmp.emFalta, ...(m.pausas ? [...m.pausas.pressupostos, ...m.pausas.emFalta] : [])]
    return base
  })
  return { situacao, respostas }
}
