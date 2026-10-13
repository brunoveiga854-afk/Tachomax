// src/utils/extracaoRubricas.ts
// Etapa 2C — junta, de forma PURA, a resposta da extração detalhada → completude → documentos de rubricas → decisão de fallback.
// • Sem rede, sem armazenamento, sem tocar na aprendizagem; não é importado por nenhum ecrã (integração só na Etapa 2E).
// • O fallback legado só é INDICADO aqui (`acao: 'usar_legado'`); quem fizer a chamada é a app, no futuro.
import { normalizarRespostaExtracao, clonar, type OpcoesNormalizacao } from './rubricas'
import { avaliarCompletudeExtracao, lerRespostaAPI, AVISO_GARANTIA, type ResultadoCompletude } from './completudeRubricas'
import { CHAVES_DETALHADAS, VERSAO_PROMPT_RUBRICAS } from './promptRubricas'
import type { DocumentoRubricas } from '../types/rubricas'

export type CategoriaErroTentativa = 'rede' | 'timeout' | 'http' | 'sem_conteudo' | 'outro'

export type TentativaDetalhada =
  | { tipo: 'api'; data: unknown }                                     // JSON da API, como o proxy o devolve
  | { tipo: 'texto'; texto: string | null; stopReason?: string | null }
  | { tipo: 'erro'; categoria: CategoriaErroTentativa; status?: number }

/** Como a extração deve ser APRESENTADA/rotulada. Nenhum modo afirma que todas as rubricas impressas foram lidas. */
export type ModoExtracao =
  | 'detalhada_estrutura_verificada'
  | 'detalhada_incompleta'
  | 'detalhada_nao_verificada'
  | 'legado'
  | 'nenhuma'

export type DecisaoExtracao = {
  acao: 'usar_detalhada' | 'usar_legado' | 'falhar'
  modo: ModoExtracao
  codigo: string
  motivo: string
  /** Há linhas recuperadas (mesmo que parciais) que podem ser conservadas como «incompletas». */
  rubricasDisponiveis: boolean
  conservarRubricasParciais: boolean
  /** Sempre false: nem a estrutura verificada prova que a IA leu todas as rubricas impressas. */
  garantiaLeituraCompleta: false
}

export type ContextoDecisao = {
  /** true se a extração antiga já foi tentada (e falhou) para este ficheiro. */
  legadoJaTentado?: boolean
}

export type ExtracaoPreparada = {
  completude: ResultadoCompletude
  documentos: DocumentoRubricas[]
  /** Por documento: a resposta SEM as chaves detalhadas — o que o fluxo atual (processarDocumentos) já entende. */
  camposLegados: Record<string, unknown>[]
  avisos: string[]
  decisao: DecisaoExtracao
}

const ehObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

export function rotuloModoExtracao(modo: ModoExtracao): string {
  switch (modo) {
    case 'detalhada_estrutura_verificada': return 'Extração detalhada — estrutura verificada (não garante que todas as rubricas foram lidas)'
    case 'detalhada_incompleta': return 'Extração detalhada INCOMPLETA'
    case 'detalhada_nao_verificada': return 'Extração detalhada não verificada'
    case 'legado': return 'Extração antiga (sem rubricas)'
    default: return 'Sem extração'
  }
}

/** Remove as chaves detalhadas, deixando exatamente o que o fluxo legado já lê. Não altera a entrada. */
export function camposLegadosDe(resposta: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {}
  for (const k of Object.keys(resposta)) if (!(CHAVES_DETALHADAS as readonly string[]).includes(k)) saida[k] = JSON.parse(JSON.stringify(resposta[k] ?? null))
  return saida
}

/** O fluxo legado precisa de tipo/periode/moisIndex/annee válidos. Devolve o motivo da falha, ou null se estiver tudo bem. */
export function problemaCamposLegados(resposta: Record<string, unknown>): string | null {
  if (resposta.tipo !== 'fiche') return 'tipo ≠ «fiche»'
  if (typeof resposta.periode !== 'string' || resposta.periode.trim() === '') return 'periode ausente'
  const m = resposta.moisIndex, a = resposta.annee
  if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > 11) return 'moisIndex inválido'
  if (typeof a !== 'number' || !Number.isInteger(a) || a < 2000 || a > 2100) return 'annee inválido'
  return null
}

function decisaoDeErro(t: Extract<TentativaDetalhada, { tipo: 'erro' }>, ctx: ContextoDecisao): DecisaoExtracao {
  const base = { rubricasDisponiveis: false, conservarRubricasParciais: false, garantiaLeituraCompleta: false as const }
  if (t.categoria === 'http' && (t.status === 401 || t.status === 403 || t.status === 413))
    return { ...base, acao: 'falhar', modo: 'nenhuma', codigo: 'erro_http_sem_alternativa', motivo: `HTTP ${t.status}: a extração antiga receberia o mesmo erro; não adianta tentar.` }
  if (ctx.legadoJaTentado)
    return { ...base, acao: 'falhar', modo: 'nenhuma', codigo: 'legado_ja_tentado', motivo: 'A extração detalhada falhou e a antiga também.' }
  return { ...base, acao: 'usar_legado', modo: 'legado', codigo: `erro_${t.categoria}`, motivo: `A extração detalhada falhou (${t.categoria}${t.status ? ' ' + t.status : ''}); usar a extração antiga, sem rubricas.` }
}

/**
 * Avalia UMA tentativa de extração detalhada (já feita pela app) e decide o que fazer a seguir.
 * Nunca faz rede. Nunca apresenta o legado, nem uma extração parcial, como extração detalhada completa.
 */
export function prepararExtracaoRubricas(tentativa: TentativaDetalhada, opcoes: OpcoesNormalizacao & ContextoDecisao = {}): ExtracaoPreparada {
  const ctx: ContextoDecisao = { legadoJaTentado: opcoes.legadoJaTentado === true }
  const vazia = (): ResultadoCompletude => avaliarCompletudeExtracao({ texto: null })
  if (tentativa.tipo === 'erro') {
    return { completude: vazia(), documentos: [], camposLegados: [], avisos: [], decisao: decisaoDeErro(tentativa, ctx) }
  }
  let texto: string | null, stopReason: string | null
  if (tentativa.tipo === 'api') {
    const r = lerRespostaAPI(tentativa.data)
    if (r.erroApi !== null)
      return { completude: vazia(), documentos: [], camposLegados: [], avisos: [], decisao: decisaoDeErro({ tipo: 'erro', categoria: 'outro' }, ctx) }
    texto = r.texto; stopReason = r.stopReason
  } else { texto = tentativa.texto; stopReason = tentativa.stopReason ?? null }

  const completude = avaliarCompletudeExtracao({ texto, stopReason })
  const avisos: string[] = []
  const documentos: DocumentoRubricas[] = []
  const camposLegados: Record<string, unknown>[] = []

  for (const rec of completude.documentos) {
    const doc = normalizarRespostaExtracao(rec.resposta, { ...opcoes, versaoPrompt: opcoes.versaoPrompt ?? VERSAO_PROMPT_RUBRICAS })
    const c = clonar(rec.completude)
    if (rec.resposta.versionPrompt !== VERSAO_PROMPT_RUBRICAS)
      c.motivos.push({ codigo: 'versionPrompt_diferente', gravidade: 'info', mensagem: `versionPrompt «${String(rec.resposta.versionPrompt ?? '')}» ≠ «${VERSAO_PROMPT_RUBRICAS}».` })
    doc.completude = c
    if (c.estado === 'incompleto') doc.problemas.push({ codigo: 'extracao_incompleta', gravidade: 'erro', mensagem: 'Extração incompleta: podem faltar rubricas; linhas conservadas como recuperadas.' })
    else if (c.estado === 'desconhecido') doc.problemas.push({ codigo: 'completude_desconhecida', gravidade: 'aviso', mensagem: 'Completude não verificável.' })
    if (rec.linhasIlegiveis.length > 0) doc.desconhecidos = { ...doc.desconhecidos, linhasIlegiveisBrutas: [...rec.linhasIlegiveis] }
    documentos.push(doc)
    camposLegados.push(camposLegadosDe(rec.resposta))
  }
  if (completude.documentos.length > 1) avisos.push('A resposta trouxe mais de uma fiche; o plano é uma fiche por pedido.')
  avisos.push(AVISO_GARANTIA)

  const temLinhas = documentos.some(d => d.linhas.length > 0)
  const base = { rubricasDisponiveis: temLinhas, garantiaLeituraCompleta: false as const }
  let decisao: DecisaoExtracao

  const legadoInvalido = completude.documentos.map(d => problemaCamposLegados(d.resposta)).find(x => x !== null) ?? null
  if (completude.estado === 'completo_estrutural' && documentos.length >= 1 && legadoInvalido === null) {
    decisao = { ...base, acao: 'usar_detalhada', modo: 'detalhada_estrutura_verificada', codigo: 'estrutura_verificada', conservarRubricasParciais: false,
      motivo: 'Estrutura verificada (JSON inteiro, contagem e numeração coerentes). Não garante que todas as rubricas impressas foram lidas.' }
  } else if (ctx.legadoJaTentado) {
    decisao = temLinhas
      ? { ...base, acao: 'usar_detalhada', modo: completude.estado === 'incompleto' ? 'detalhada_incompleta' : 'detalhada_nao_verificada', codigo: 'legado_ja_tentado_usa_parcial', conservarRubricasParciais: true,
          motivo: 'A extração antiga já falhou; conserva-se o que a detalhada devolveu, identificado como não completo.' }
      : { ...base, acao: 'falhar', modo: 'nenhuma', codigo: 'legado_ja_tentado', conservarRubricasParciais: false, motivo: 'A extração detalhada falhou e a antiga também.' }
  } else {
    const codigo = legadoInvalido !== null && completude.estado === 'completo_estrutural' ? 'campos_legados_invalidos' : completude.estado === 'incompleto' ? 'extracao_incompleta' : 'completude_desconhecida'
    decisao = { ...base, acao: 'usar_legado', modo: 'legado', codigo, conservarRubricasParciais: temLinhas,
      motivo: legadoInvalido !== null && completude.estado === 'completo_estrutural'
        ? `Campos legados inválidos na resposta detalhada (${legadoInvalido}); usar a extração antiga.`
        : `Extração detalhada ${completude.estado === 'incompleto' ? 'incompleta' : 'não verificável'}; usar a extração antiga (as linhas recuperadas, se houver, ficam marcadas como incompletas).` }
  }
  return { completude, documentos, camposLegados, avisos, decisao }
}
