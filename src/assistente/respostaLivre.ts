// src/assistente/respostaLivre.ts
// Liga o interpretador (puro) ao motor EXISTENTE. Função pura: recebe a interpretação e o contexto já lido por
// `lerContextoAssistente` e devolve uma resposta em francês. NÃO lê nem escreve armazenamento e NÃO recalcula nada:
//   • amplitude / serviço / repouso → `prepararRespostas` (mesmos contratos do ecrã);
//   • simulação com hora de fim e/ou pausa → `simular`;
//   • pausas → o resultado `motor.pausas` já calculado pelo orquestrador;
//   • regras → `regrasUsadas` / `todasAsRegras`.
// O que o motor não faz (condução, hora-limite de pausa, repos hebdomadaire, sanções) NÃO é inventado: devolve-se
// «Non évalué» / «Non calculée» e explica-se o que falta.
import type { EstadoResultado } from '../engine/regras/tipos'
import {
  prepararRespostas, fmtDuracao, AVISO_NAO_AUTORIZACAO,
  type ContextoAssistente, type Linha, type PerguntaId, type Resposta,
} from '../engine/regras/lerContexto'
import { simular } from '../engine/regras/simulacao'
import { regrasUsadas, todasAsRegras } from '../engine/regras/regrasExplicadas'
import { interpretacaoDireta, ROTULO_INTENCAO, type IntencaoId, type Interpretacao, type Quantidade } from './interpretador'

export type TipoRespostaLivre =
  | 'resposta' | 'simulacao' | 'nao_avaliado' | 'nao_suportada' | 'incompleta' | 'ambigua' | 'fora_ambito' | 'info' | 'a_carregar'

export type RespostaLivre = {
  tipo: TipoRespostaLivre
  intencao: IntencaoId | null
  titulo: string
  estado: EstadoResultado | null
  /** resultado principal, curto */
  destaque: { valor: string; legenda: string } | null
  /** avisos e ressalvas sempre visíveis (curtos) */
  notas: string[]
  hipoteses: string[]
  /** tudo o resto vai para «Détails» (expansível) */
  linhas: Linha[]
  alternativas: Linha[]
  aConfirmer: string[]
  naoVerificadas: string[]
  detalhesTecnicos: string[]
  /** perguntas sugeridas (toque → pergunta rápida / exemplo) */
  sugestoes: { rotulo: string; intencao: IntencaoId }[]
  /** mostra o botão «Voir Règles et sanctions» */
  abrirRegras: boolean
  aviso: string
}

export const AVISO_INTERPRETADOR = "Compréhension par règles simples (pas une IA) : reformule si je ne comprends pas."

/** Perguntas rápidas (grelha 2×2). `perguntaId` liga à simulação existente (que só conhece 3 perguntas). */
export const PERGUNTAS_RAPIDAS: { intencao: 'amplitude' | 'servico' | 'repouso' | 'pausas'; titulo: string; descricao: string; icone: 'time-outline' | 'briefcase-outline' | 'moon-outline' | 'cafe-outline'; perguntaId: PerguntaId }[] = [
  { intencao: 'amplitude', titulo: 'Amplitude', descricao: "Jusqu'à quand", icone: 'time-outline', perguntaId: 'amplitude' },
  { intencao: 'servico', titulo: 'Temps de service', descricao: "Ce qu'il me reste", icone: 'briefcase-outline', perguntaId: 'servico' },
  { intencao: 'repouso', titulo: 'Repos', descricao: 'Quand le commencer', icone: 'moon-outline', perguntaId: 'repos' },
  { intencao: 'pausas', titulo: 'Pauses', descricao: 'Exigée / prise', icone: 'cafe-outline', perguntaId: 'servico' },
]

/** pergunta do ecrã (para a simulação) correspondente a uma intenção */
export function perguntaIdDe(i: IntencaoId): PerguntaId {
  return i === 'amplitude' ? 'amplitude' : i === 'repouso' ? 'repos' : 'servico'
}

const vazia = (p: Partial<RespostaLivre> & Pick<RespostaLivre, 'tipo' | 'titulo'>): RespostaLivre => ({
  intencao: null, estado: null, destaque: null, notas: [], hipoteses: [], linhas: [], alternativas: [], aConfirmer: [],
  naoVerificadas: [], detalhesTecnicos: [], sugestoes: [], abrirRegras: false, aviso: AVISO_NAO_AUTORIZACAO, ...p,
})

const SUGESTOES_BASE: RespostaLivre['sugestoes'] = [
  { rotulo: 'Amplitude', intencao: 'amplitude' },
  { rotulo: 'Temps de service', intencao: 'servico' },
  { rotulo: 'Repos', intencao: 'repouso' },
  { rotulo: 'Pauses', intencao: 'pausas' },
]

const dd = (n: number) => String(n).padStart(2, '0')
const txtQuant = (q: Quantidade) => q.texto

function deResposta(r: Resposta, intencao: IntencaoId): RespostaLivre {
  return vazia({
    tipo: r.disponivel ? 'resposta' : 'nao_avaliado',
    intencao,
    titulo: r.titulo,
    estado: r.estado,
    destaque: r.destaque,
    notas: [...r.alertas, ...r.informationManquante.map(t => `Information manquante : ${t}`)],
    hipoteses: r.hipoteses,
    linhas: r.linhas,
    alternativas: r.alternativas,
    aConfirmer: r.aConfirmer,
    naoVerificadas: r.naoVerificadas,
    detalhesTecnicos: r.detalhesTecnicos,
    aviso: r.aviso || AVISO_NAO_AUTORIZACAO,
  })
}

const CUMPRIMENTO_FR: Record<string, string> = {
  nao_exigida: "Aucune pause exigée pour le service accumulé à ce stade",
  cumprida: 'Pause exigée déjà prise (vérifiée)',
  depende_de_confirmacao: 'Dépend de la nature des pauses (non confirmée)',
  nao_cumprida: 'Pause exigée non atteinte avec les pauses connues',
}

function semServico(ctx: ContextoAssistente): string[] {
  return ctx.situacao === 'em_curso' ? [] : ['Service en cours (début, temps de service, pauses)']
}

function respostaPausas(ctx: ContextoAssistente, intencao: IntencaoId): RespostaLivre {
  const m = ctx.motor
  const base = vazia({ tipo: 'nao_avaliado', intencao, titulo: 'Pauses de travail (L3312-2)' })
  const falta = semServico(ctx)
  if (falta.length > 0 || !m) {
    return { ...base, notas: [...falta.map(t => `Information manquante : ${t}`), ...(m ? [] : ['Aucun calcul disponible.'])] }
  }
  const pa = m.pausas
  if (!pa) {
    return { ...base, estado: m.estado, notas: ["Les pauses ne sont pas évaluées : cadre réglementaire non applicable ou données insuffisantes."], detalhesTecnicos: [m.resumo, ...m.emFalta] }
  }
  const exigidoMin = Math.round(pa.exigidoSeg / 60)
  const linhas: Linha[] = [
    { rotulo: 'Pause exigée à ce stade', valor: pa.exigidoSeg > 0 ? `${exigidoMin} min` : 'aucune' },
    { rotulo: 'Pauses vérifiées', valor: `${Math.round(pa.validasSeg / 60)} min` },
  ]
  if (pa.naoVerificadasSeg > 0) linhas.push({ rotulo: 'Pauses non confirmées', valor: `${Math.round(pa.naoVerificadasSeg / 60)} min` })
  if (pa.previstasSeg > 0) linhas.push({ rotulo: 'Pause simulée', valor: `${Math.round(pa.previstasSeg / 60)} min` })
  linhas.push({ rotulo: 'Plus longue période sans pause vérifiée', valor: fmtDuracao(pa.maiorPeriodoSemPausaVerificadaSeg) })
  const notas: string[] = [...base.notas]
  if (pa.periodoSemPausaExcedido === true) notas.push('Une période sans pause dépasse le calcul, même en comptant les pauses non confirmées.')
  else if (pa.periodoSemPausaExcedido === 'depende_de_confirmacao') notas.push('Une période sans pause dépasse le calcul si les pauses non confirmées ne comptent pas.')
  return {
    ...base,
    tipo: 'resposta',
    estado: pa.estado,
    destaque: { valor: pa.exigidoSeg > 0 ? `${exigidoMin} min` : 'Aucune', legenda: CUMPRIMENTO_FR[pa.cumprimento] ?? '' },
    notas,
    linhas,
    detalhesTecnicos: [...pa.pressupostos, ...pa.emFalta],
    naoVerificadas: ["Seules les pauses d'au moins 15 min et confirmées comme temps libre sont comptées comme vérifiées."],
  }
}

function respostaSimulacao(ctx: ContextoAssistente, i: Extract<Interpretacao, { tipo: 'intencao' }>): RespostaLivre {
  const pausaMin = i.duracaoMin ?? 0
  const sim = simular(ctx, { pausaMin, fimDesejado: i.horaFim })
  const titulo = i.horaFim ? `Simulation : fin à ${dd(i.horaFim.h)}h${dd(i.horaFim.m)}` : `Simulation : pause de ${pausaMin} min`
  if (!sim.disponivel) {
    return vazia({ tipo: 'nao_avaliado', intencao: i.intencao, titulo, notas: ['motivo' in sim ? sim.motivo : 'Simulation non disponible.'] })
  }
  const notas: string[] = ['Simulation — ton service réel n’est pas modifié.']
  const r = vazia({ tipo: 'simulacao', intencao: i.intencao, titulo, estado: sim.motor.estado, notas })
  if (sim.comparacao) {
    const c = sim.comparacao
    r.destaque = { valor: c.tudoDentro ? 'Limites calculées non dépassées' : 'Dépasse le calcul', legenda: c.resumo }
    r.linhas = [
      ...c.linhas.map(l => ({ rotulo: l.restricao, valor: `${l.dentro ? 'marge' : 'dépassement'} ${Math.abs(Math.round(l.margemSeg / 60))} min` })),
      { rotulo: "Service total estimé jusqu'à cette heure", valor: fmtDuracao(c.servicoTotalSeg) },
    ]
    if (c.pausaExigidaSeg !== null && c.cumprimentoPausa) r.linhas.push({ rotulo: 'Pause de travail (L3312-2)', valor: c.cumprimentoPausa })
    if (c.linhas.length === 0) r.notas.push('Aucune limite calculable à comparer avec les données actuelles.')
  } else {
    const rs = sim.respostas.find(x => x.id === 'servico')
    if (rs?.destaque) r.destaque = { valor: rs.destaque.valor, legenda: `${rs.destaque.legenda} (avec une pause hypothétique de ${pausaMin} min)` }
    r.linhas = rs?.linhas ?? []
    r.hipoteses = rs?.hipoteses ?? []
  }
  r.aConfirmer = sim.respostas.flatMap(x => x.aConfirmer).filter((t, k, a) => a.indexOf(t) === k)
  r.naoVerificadas = sim.respostas[0]?.naoVerificadas ?? []
  return r
}

function notasIgnoradas(i: Extract<Interpretacao, { tipo: 'intencao' }>): string[] {
  if (i.ignoradas.length === 0) return []
  const lista = i.ignoradas.map(txtQuant).join(', ')
  return [`« ${lista} » n'est pas utilisé pour cette question. Pour comparer une heure de fin, demande par exemple « Si je finis à 18h ? ».`]
}

export function responderIntencao(i: Extract<Interpretacao, { tipo: 'intencao' }>, ctx: ContextoAssistente | null): RespostaLivre {
  const id = i.intencao
  const nIgn = notasIgnoradas(i)
  const com = (r: RespostaLivre): RespostaLivre => (nIgn.length ? { ...r, notas: [...r.notas, ...nIgn] } : r)

  // Respostas que NÃO dependem do serviço em curso
  if (id === 'conducao') {
    return vazia({
      tipo: 'nao_avaliado', intencao: id, titulo: 'Temps de conduite',
      destaque: { valor: 'Non évalué', legenda: "Le temps de conduite n'est pas mesuré séparément du temps de service." },
      notas: ["Pour la conduite (durées de conduite et pauses de conduite), consulte ton chronotachygraphe : l'application ne le remplace pas."],
      detalhesTecnicos: ["Le moteur évalue l'amplitude, le temps de service, le repos quotidien et les pauses de travail, pas la conduite."],
      sugestoes: SUGESTOES_BASE,
    })
  }
  if (id === 'repouso_semanal') {
    return vazia({
      tipo: 'nao_avaliado', intencao: id, titulo: 'Repos hebdomadaire',
      destaque: { valor: 'Non évalué', legenda: 'Repos hebdomadaire non pris en charge par le moteur actuel.' },
      notas: ["Il n'existe pas d'enregistrement fiable des repos hebdomadaires ni de leurs compensations dans l'application."],
      sugestoes: [{ rotulo: 'Repos quotidien', intencao: 'repouso' }],
    })
  }
  if (id === 'sancoes') {
    return vazia({
      tipo: 'nao_suportada', intencao: id, titulo: 'Sanctions',
      destaque: { valor: 'Non affichées', legenda: "Aucun montant, aucune classe d'infraction ni aucun article de sanction vérifié n'est disponible dans l'assistant." },
      notas: [
        "Un dépassement calculé par l'assistant n'est pas une infraction constatée : seul un contrôle officiel qualifie une infraction.",
        'Les règles utilisées et leurs sources officielles sont consultables dans « Règles et sanctions ».',
      ],
      abrirRegras: true,
    })
  }
  if (id === 'regras') {
    const regras = ctx?.motor ? regrasUsadas(ctx.motor) : todasAsRegras()
    return vazia({
      tipo: 'info', intencao: id, titulo: ctx?.motor ? 'Règles utilisées dans le calcul actuel' : "Règles prises en charge par l'assistant",
      linhas: regras.map(r => ({ rotulo: r.titre, valor: r.reference })),
      notas: ["Les références n'ont pas été relues dans le texte officiel primaire par l'application. Détail et sources : « Règles et sanctions »."],
      abrirRegras: true,
    })
  }

  if (!ctx) return vazia({ tipo: 'a_carregar', intencao: id, titulo: 'Lecture en cours…' })

  if (id === 'pausa_limite') {
    const p = respostaPausas(ctx, id)
    return vazia({
      ...p,
      tipo: 'nao_suportada',
      titulo: "Heure limite pour commencer une pause",
      destaque: { valor: 'Non calculée', legenda: "Le moteur actuel ne calcule pas de façon fiable l'heure limite pour commencer une pause." },
      notas: ["Le moteur évalue les pauses déjà prises (détails ci-dessous), mais ne calcule pas l'heure limite pour en commencer une.", ...p.notas],
      sugestoes: [{ rotulo: 'Pauses', intencao: 'pausas' }, { rotulo: 'Temps de service', intencao: 'servico' }],
    })
  }

  if (id === 'simulacao_fim' || ((id === 'servico' || id === 'pausas') && i.duracaoMin !== null)) {
    if (id === 'simulacao_fim' && i.falta) {
      const msg: Record<NonNullable<typeof i.falta>, string> = {
        hora_fim: "Il me manque l'heure de fin. Exemple : « Si je finis à 18h30 ? ».",
        hora_ou_duracao: "Je ne sais pas si tu parles d'une heure ou d'une durée. Écris par exemple « à 18h » ou « 30 min ».",
        hora_unica: "J'ai trouvé plusieurs horaires ou durées. Pose la question avec une seule heure de fin.",
      }
      return vazia({ tipo: 'incompleta', intencao: id, titulo: ROTULO_INTENCAO[id], notas: [msg[i.falta]], sugestoes: SUGESTOES_BASE })
    }
    return com(respostaSimulacao(ctx, i))
  }

  if (id === 'pausas') return com(respostaPausas(ctx, id))

  const r = prepararRespostas(ctx).respostas.find(x => x.id === perguntaIdDe(id))
  if (!r) return vazia({ tipo: 'nao_avaliado', intencao: id, titulo: ROTULO_INTENCAO[id], notas: ['Aucune réponse disponible.'] })
  return com(deResposta(r, id))
}

export function responder(i: Interpretacao, ctx: ContextoAssistente | null): RespostaLivre {
  if (i.tipo === 'intencao') return responderIntencao(i, ctx)
  if (i.tipo === 'vazia') return vazia({ tipo: 'fora_ambito', titulo: 'Pose ta question', notas: ['Écris une question, ou touche une des questions rapides.'], sugestoes: SUGESTOES_BASE })
  if (i.tipo === 'ambigua') {
    return vazia({
      tipo: 'ambigua', titulo: 'Je ne suis pas sûr de ta question',
      notas: ['Tu veux parler de quoi ? Touche une option ou reformule.'],
      sugestoes: i.candidatas.map(c => ({ rotulo: ROTULO_INTENCAO[c], intencao: c })),
    })
  }
  return vazia({
    tipo: 'fora_ambito', titulo: 'Question hors de mon domaine',
    notas: [
      "Je réponds seulement sur ton service en cours : amplitude, temps de service, repos, pauses ou une simulation avec une heure de fin.",
      'Exemples : « Jusqu\'à quand puis-je rouler ? », « Si je finis à 18h ? », « Combien de pause dois-je faire ? ».',
    ],
    sugestoes: SUGESTOES_BASE,
  })
}

/** Texto curto do cartão rápido; «—» quando o motor não tem dados (nunca inventa). */
export function previewRapido(intencao: IntencaoId, ctx: ContextoAssistente | null): string {
  if (!ctx) return '…'
  try {
    const r = responderIntencao(interpretacaoDireta(intencao) as Extract<Interpretacao, { tipo: 'intencao' }>, ctx)
    return r.tipo === 'resposta' && r.destaque ? r.destaque.valor : '—'
  } catch { return '—' }
}

/** Resposta de recurso se algo inesperado falhar ao responder (nunca deixa o ecrã quebrar). */
export const respostaErro = (): RespostaLivre => vazia({
  tipo: 'nao_avaliado', titulo: 'Réponse indisponible', notas: ["Une erreur est survenue pendant le calcul. Rien n'a été modifié ; réessaie après « Actualiser »."], sugestoes: SUGESTOES_BASE,
})
