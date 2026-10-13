// src/utils/completudeRubricas.ts
// Etapa 2C — avaliação PURA da completude ESTRUTURAL de uma resposta de extração detalhada.
// • Sem rede, sem armazenamento, sem aleatoriedade; não altera a entrada.
// • «completo_estrutural» = as verificações estruturais passaram. NÃO prova que a IA leu todas as rubricas impressas
//   (o resultado traz sempre `garantiaLeituraCompleta: false`).
// • Linhas recuperadas de uma resposta truncada são conservadas, identificadas como parciais, e nunca confirmadas.
import { clonar } from './rubricas'
import type { CompletudeDocumento, EstadoCompletude, MotivoCompletude } from '../types/rubricas'

export const AVISO_GARANTIA =
  'Completude estrutural: o JSON está inteiro e coerente (contagem, numeração, «fin»). Isto NÃO garante que a IA leu todas as rubricas impressas no documento.'

export type EntradaCompletude = {
  /** Texto devolvido pelo modelo (todos os blocos de texto concatenados). */
  texto: string | null | undefined
  /** `stop_reason` da API (ex.: 'end_turn', 'max_tokens'). Ausente/null = desconhecido. */
  stopReason?: string | null
}

export type DocumentoRecuperado = {
  /** Objeto pronto para `normalizarRespostaExtracao` (pode ter `lignes` parcial). Nunca inclui nada inventado. */
  resposta: Record<string, unknown>
  completude: CompletudeDocumento
  /** Texto bruto de linhas completas em JSON mas ilegíveis (preservado, nunca descartado em silêncio). */
  linhasIlegiveis: string[]
}

export type ResultadoCompletude = {
  estado: EstadoCompletude
  motivos: MotivoCompletude[]
  jsonValido: boolean
  stopReason: string | null
  documentos: DocumentoRecuperado[]
  /** Elementos do array de topo que não eram objetos. */
  ignorados: { indice: number; motivo: string }[]
  garantiaLeituraCompleta: false
  aviso: string
}

const ehObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const motivo = (codigo: string, gravidade: MotivoCompletude['gravidade'], mensagem: string): MotivoCompletude => ({ codigo, gravidade, mensagem })

// ───────────────────────── leitura do texto ─────────────────────────
const limparCercas = (t: string) => t.replace(/```(?:json)?/gi, '')
const INICIO_JSON = /\[\s*\{|\{\s*"/

type Parse = { ok: true; valor: unknown; textoExtra: boolean } | { ok: false }

function parseCompleto(s: string): Parse {
  try { return { ok: true, valor: JSON.parse(s), textoExtra: false } } catch { /* tenta com texto à volta */ }
  const fecho = s[0] === '[' ? ']' : '}'
  const k = s.lastIndexOf(fecho)
  if (k > 0) {
    try { return { ok: true, valor: JSON.parse(s.slice(0, k + 1)), textoExtra: true } } catch { /* inválido */ }
  }
  return { ok: false }
}

type Acc = {
  inicio: number
  lignesChave: number
  esperaLignes: boolean
  emLignes: boolean
  linhas: unknown[]
  ilegiveis: string[]
  fim: number // índice do '}' final; -1 se não fechou
}

/** Varre um JSON possivelmente truncado/inválido e recupera, sem inventar nada, os documentos e as linhas COMPLETAS. */
function recuperar(s: string): { docs: Acc[] } {
  const raizArray = s[0] === '['
  const docLen = raizArray ? 2 : 1
  const pilha: string[] = []
  const docs: Acc[] = []
  let cur: Acc | null = null
  let emStr = false, esc = false, strIni = -1, linhaIni = -1
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (emStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') {
        emStr = false
        if (cur && pilha.length === docLen && s.slice(strIni + 1, i) === 'lignes') {
          let j = i + 1
          while (j < s.length && /\s/.test(s[j])) j++
          if (s[j] === ':') { cur.lignesChave = strIni; cur.esperaLignes = true }
        }
      }
      continue
    }
    if (c === '"') { emStr = true; strIni = i; continue }
    if (c === '{') {
      pilha.push('{')
      if (!cur && pilha.length === docLen) cur = { inicio: i, lignesChave: -1, esperaLignes: false, emLignes: false, linhas: [], ilegiveis: [], fim: -1 }
      else if (cur && cur.emLignes && pilha.length === docLen + 2) linhaIni = i
    } else if (c === '[') {
      pilha.push('[')
      if (cur && cur.esperaLignes && pilha.length === docLen + 1) { cur.emLignes = true; cur.esperaLignes = false }
    } else if (c === ']') {
      pilha.pop()
      if (cur && cur.emLignes && pilha.length === docLen) cur.emLignes = false
    } else if (c === '}') {
      pilha.pop()
      if (cur && cur.emLignes && pilha.length === docLen + 1 && linhaIni >= 0) {
        const bruto = s.slice(linhaIni, i + 1)
        try { cur.linhas.push(JSON.parse(bruto)) } catch { cur.ilegiveis.push(bruto) }
        linhaIni = -1
      } else if (cur && pilha.length === docLen - 1) {
        cur.fim = i
        docs.push(cur)
        cur = null
      }
    }
  }
  if (cur) docs.push(cur) // truncado dentro do documento
  return { docs }
}

function respostaDeAcc(s: string, a: Acc): { resposta: Record<string, unknown>; fechado: boolean } {
  if (a.fim >= 0) {
    try {
      const v = JSON.parse(s.slice(a.inicio, a.fim + 1))
      if (ehObj(v)) return { resposta: v, fechado: true }
    } catch { /* cai para a recuperação por prefixo */ }
  }
  let campos: Record<string, unknown> = {}
  if (a.lignesChave >= 0) {
    const prefixo = s.slice(a.inicio, a.lignesChave).replace(/[\s,]+$/, '') + '}'
    try { const v = JSON.parse(prefixo); if (ehObj(v)) campos = v } catch { campos = {} }
    campos.lignes = a.linhas
  }
  return { resposta: campos, fechado: false }
}

// ───────────────────────── verificações de um documento ─────────────────────────
function verificarDocumento(r: Record<string, unknown>, parcial: boolean, ilegiveis: string[], stopReason: string | null): { motivos: MotivoCompletude[]; nbDeclarado: number | null; nLinhas: number } {
  const m: MotivoCompletude[] = []
  const lig = r.lignes
  const linhas = Array.isArray(lig) ? lig : null
  if (!linhas) m.push(motivo('lignes_ausentes', 'erro', 'lignes[] ausente ou não é uma lista.'))
  if (parcial) m.push(motivo('resposta_parcial', 'erro', 'Documento recuperado de uma resposta truncada ou inválida; podem faltar linhas.'))
  if (ilegiveis.length > 0) m.push(motivo('linha_ilegivel', 'erro', `${ilegiveis.length} linha(s) completa(s) mas ilegível(is); texto bruto preservado.`))

  if (r.fin !== true) m.push(motivo(r.fin === undefined ? 'fin_ausente' : 'fin_invalido', 'erro', '«fin: true» ausente: a lista pode estar incompleta.'))

  const nb = r.nbLignes
  let nbDeclarado: number | null = null
  if (typeof nb === 'number' && Number.isInteger(nb) && nb >= 0) nbDeclarado = nb
  else m.push(motivo('nbLignes_ausente', 'aviso', 'nbLignes ausente ou inválido: a contagem não pode ser verificada.'))
  if (nbDeclarado !== null && linhas && nbDeclarado !== linhas.length)
    m.push(motivo('contagem_diferente', 'erro', `nbLignes (${nbDeclarado}) ≠ linhas recebidas (${linhas.length}).`))

  if (linhas) {
    const ns: number[] = []
    let semN = 0
    linhas.forEach((l, i) => {
      if (!ehObj(l)) { m.push(motivo('linha_invalida', 'erro', `lignes[${i}] não é um objeto.`)); return }
      if (l.n === undefined || l.n === null) { semN++; return }
      if (typeof l.n !== 'number' || !Number.isInteger(l.n) || l.n < 1) { m.push(motivo('numeracao_invalida', 'erro', `lignes[${i}].n inválido.`)); return }
      ns.push(l.n)
    })
    if (semN > 0) m.push(motivo('numeracao_ausente', 'aviso', `${semN} linha(s) sem «n»: a numeração não pode ser verificada.`))
    const repetidos = ns.filter((x, i) => ns.indexOf(x) !== i)
    if (repetidos.length > 0) m.push(motivo('numeracao_duplicada', 'erro', `«n» repetido: ${Array.from(new Set(repetidos)).join(', ')}.`))
    else if (semN === 0 && ns.length === linhas.length && ns.some((x, i) => x !== i + 1))
      m.push(motivo('numeracao_descontinua', 'erro', 'A numeração «n» não é 1, 2, 3... em sequência.'))
    if (linhas.length === 0 && !parcial) m.push(motivo('zero_linhas', 'aviso', 'Nenhuma linha extraída: não é possível afirmar que o documento está completo.'))
  }

  if (stopReason === 'max_tokens') m.push(motivo('stop_reason_max_tokens', 'erro', 'A resposta foi cortada por limite de tokens.'))
  else if (stopReason === null) m.push(motivo('stop_reason_nao_fornecido', 'info', 'stop_reason não fornecido.'))
  else if (stopReason !== 'end_turn' && stopReason !== 'stop_sequence') m.push(motivo('stop_reason_inesperado', 'erro', `stop_reason «${stopReason}».`))

  return { motivos: m, nbDeclarado, nLinhas: linhas ? linhas.length : 0 }
}

function estadoDe(motivos: MotivoCompletude[]): EstadoCompletude {
  if (motivos.some(x => x.gravidade === 'erro')) return 'incompleto'
  if (motivos.some(x => x.gravidade === 'aviso')) return 'desconhecido'
  return 'completo_estrutural'
}
const pior = (a: EstadoCompletude, b: EstadoCompletude): EstadoCompletude => {
  const ordem: EstadoCompletude[] = ['completo_estrutural', 'desconhecido', 'incompleto']
  return ordem[Math.max(ordem.indexOf(a), ordem.indexOf(b))]
}

function montarDoc(r: Record<string, unknown>, parcial: boolean, ilegiveis: string[], stopReason: string | null): DocumentoRecuperado {
  const v = verificarDocumento(r, parcial, ilegiveis, stopReason)
  return {
    resposta: clonar(r),
    linhasIlegiveis: [...ilegiveis],
    completude: {
      estado: estadoDe(v.motivos), motivos: v.motivos, parcial, nLinhas: v.nLinhas, nbLinhasDeclarado: v.nbDeclarado,
      stopReason, garantiaLeituraCompleta: false,
    },
  }
}

// ───────────────────────── API pública ─────────────────────────
export function avaliarCompletudeExtracao(entrada: EntradaCompletude): ResultadoCompletude {
  const stopReason = typeof entrada.stopReason === 'string' ? entrada.stopReason : null
  const base = { stopReason, garantiaLeituraCompleta: false as const, aviso: AVISO_GARANTIA }
  const motivos: MotivoCompletude[] = []
  const ignorados: { indice: number; motivo: string }[] = []
  const texto = typeof entrada.texto === 'string' ? entrada.texto : ''

  if (stopReason === 'max_tokens') motivos.push(motivo('stop_reason_max_tokens', 'erro', 'A resposta foi cortada por limite de tokens (stop_reason = max_tokens).'))
  else if (stopReason !== null && stopReason !== 'end_turn' && stopReason !== 'stop_sequence')
    motivos.push(motivo('stop_reason_inesperado', 'erro', `stop_reason «${stopReason}».`))

  if (texto.trim() === '') {
    motivos.push(motivo('resposta_vazia', 'aviso', 'Sem texto de resposta.'))
    return { ...base, estado: motivos.some(x => x.gravidade === 'erro') ? 'incompleto' : 'desconhecido', motivos, jsonValido: false, documentos: [], ignorados }
  }

  const limpo = limparCercas(texto)
  const ini = limpo.search(INICIO_JSON)
  if (ini < 0) {
    motivos.push(motivo('sem_json', 'aviso', 'A resposta não contém JSON reconhecível.'))
    return { ...base, estado: motivos.some(x => x.gravidade === 'erro') ? 'incompleto' : 'desconhecido', motivos, jsonValido: false, documentos: [], ignorados }
  }
  const s = limpo.slice(ini).trim()
  const p = parseCompleto(s)
  const documentos: DocumentoRecuperado[] = []

  if (p.ok) {
    if (ini > 0 || p.textoExtra) motivos.push(motivo('texto_fora_do_json', 'info', 'Havia texto fora do JSON; ignorado.'))
    const elementos = Array.isArray(p.valor) ? p.valor : [p.valor]
    elementos.forEach((e, i) => {
      if (ehObj(e)) documentos.push(montarDoc(e, false, [], stopReason))
      else { ignorados.push({ indice: i, motivo: 'elemento que não é um objeto' }); motivos.push(motivo('documento_invalido', 'erro', `Elemento ${i} da resposta não é um objeto.`)) }
    })
    if (documentos.length === 0 && ignorados.length === 0) motivos.push(motivo('sem_documentos', 'aviso', 'A resposta não contém nenhuma fiche.'))
  } else {
    motivos.push(motivo('json_invalido', 'erro', 'JSON inválido ou truncado; só se conservam as linhas completas recuperadas.'))
    const { docs } = recuperar(s)
    docs.forEach(a => {
      if (a.fim < 0 && a.lignesChave < 0) return // cortado antes de «lignes»: nada recuperável com segurança
      const { resposta, fechado } = respostaDeAcc(s, a)
      documentos.push(montarDoc(resposta, !fechado, a.ilegiveis, stopReason))
    })
    if (documentos.length === 0) motivos.push(motivo('nada_recuperavel', 'erro', 'Nenhum documento recuperável antes do corte.'))
  }

  let estado: EstadoCompletude = motivos.some(x => x.gravidade === 'erro') ? 'incompleto' : (motivos.some(x => x.gravidade === 'aviso') ? 'desconhecido' : 'completo_estrutural')
  for (const d of documentos) estado = pior(estado, d.completude.estado)
  return { ...base, estado, motivos, jsonValido: p.ok, documentos, ignorados }
}

/** Lê a resposta da API Anthropic (como devolvida pelo proxy): junta TODOS os blocos de texto e devolve o stop_reason. */
export function lerRespostaAPI(data: unknown): { texto: string | null; stopReason: string | null; erroApi: string | null } {
  if (!ehObj(data)) return { texto: null, stopReason: null, erroApi: null }
  let erroApi: string | null = null
  if (data.error !== undefined && data.error !== null) {
    const e = data.error
    erroApi = ehObj(e) ? String(e.message ?? e.type ?? 'erro') : String(e)
  }
  const blocos = Array.isArray(data.content) ? data.content : []
  const partes = blocos.filter((b): b is Record<string, unknown> => ehObj(b) && b.type === 'text' && typeof b.text === 'string').map(b => b.text as string)
  return { texto: partes.length > 0 ? partes.join('') : null, stopReason: typeof data.stop_reason === 'string' ? data.stop_reason : null, erroApi }
}
