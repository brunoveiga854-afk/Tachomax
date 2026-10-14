// src/utils/importacaoRubricas.ts — Etapa 2E/E1: adaptador PURO da extração detalhada de rubricas (ainda NÃO ligado à app).
//
// O que faz: para cada ficheiro, pede (através de uma função injetada) a extração detalhada, avalia-a (2C), associa-a de forma
// fiável ao resultado legado e guarda-a no armazém (2D) como informação documental NÃO CONFIRMADA. Mede latência, tamanho e resultado.
//
// O que NUNCA faz:
//  • não faz rede, não usa AsyncStorage, React, fiche.tsx nem reglages.tsx: tudo entra por `deps` (chamar, armazem, agora, registo);
//  • não lê nem altera o resultado legado (a entrada é só consultada; nada é devolvido para o fluxo salarial);
//  • não toca em salários, frais, pagamentos, calendário, aprendizagem ou Motor V2;
//  • não confirma nada: os documentos guardados ficam em estado «extraido» e as classificações em «sugerida»;
//  • não lança exceções: qualquer falha fica no resultado, por código (sem dados privados);
//  • não associa documentos a ficheiros pela ORDEM da resposta legada (ver `associarFicheirosAoLegado`).
//
// Cancelamento: depois de o sinal estar ativo não se fazem novas chamadas nem novas gravações.
// Concorrência: as gravações passam pela fila própria do armazém; os ficheiros são processados em sequência.
import { acrescentarDocumentos, limparDados, type ArmazenamentoRubricas, type RegistoRubricas } from './rubricasStore'
import { prepararExtracaoRubricas, type TentativaDetalhada, type ModoExtracao } from './extracaoRubricas'
import { construirPedidoRubricas, type BlocoFicheiro, type PedidoProxy } from './promptRubricas'
import { lerRespostaAPI } from './completudeRubricas'
import { identidadeFicheiro } from './identidadeFicheiro'
import type { DocumentoRubricas, EstadoCompletude } from '../types/rubricas'

export const LIMITE_BASE64_FICHEIRO = 4_500_000      // igual ao limite do fluxo legado (por pedido)
export const LIMITE_MS_PADRAO = 120_000              // deliberadamente largo: o objetivo é MEDIR, não decidir um limite

// ───────────────────────── tipos públicos ─────────────────────────
export type SinalCancelamento = { aborted: boolean }
export type FicheiroParaRubricas = { base64: string; mimeType?: string | null }

export type EntradaImportacao = {
  /** Fornecido pelo chamador (a flag de ativação só existirá na E2). false ⇒ nenhuma chamada, nenhuma gravação. */
  ativo: boolean
  /** Consentimento IA já existente. false ⇒ nenhuma chamada, nenhuma gravação. */
  consentimentoIA: boolean
  ficheiros: readonly FicheiroParaRubricas[]
  /** Resultado do fluxo legado para os MESMOS ficheiros (array tal como veio da IA). Só é consultado; nunca alterado. */
  legado?: readonly unknown[] | null
  sinal?: SinalCancelamento
  limiteMsPorFicheiro?: number
}

export type ContextoChamada = { indice: number; sinal?: SinalCancelamento }
export type DependenciasImportacao = {
  /** Envia o pedido e devolve a tentativa já classificada (api | erro). A implementação real (E2) trata do seu próprio timeout. */
  chamar: (pedido: PedidoProxy, ctx: ContextoChamada) => Promise<TentativaDetalhada>
  armazem: ArmazenamentoRubricas
  /** Relógio MONOTÓNICO em ms (para medir latência). */
  agora: () => number
  agoraISO?: () => string
  registo?: RegistoRubricas
}

export type EstadoAssociacao = 'certa' | 'provavel' | 'indeterminada'
export type Associacao = { estado: EstadoAssociacao; motivo: string; indiceLegado: number | null; tipoLegado: 'fiche' | 'frais' | 'outro' | null }
export type Verificacao = 'coincide' | 'diverge' | 'nao_comparavel'

export type MedicaoExtracao = {
  indice: number
  duracaoMs: number | null
  resultado: string                 // código curto (nunca texto livre)
  categoriaErro: string | null
  status: number | null
  tokensEntrada: number | null
  tokensSaida: number | null
  stopReason: string | null
  tamanhoBase64: number
  nLinhas: number | null
  truncada: boolean
}

export type EstadoFicheiro = 'guardado' | 'identico' | 'conflito' | 'ignorado' | 'nao_guardado' | 'falhou' | 'cancelado'
export type ResultadoFicheiro = {
  indice: number
  estado: EstadoFicheiro
  codigo: string
  idFicheiro: string | null
  idDocumento: string | null
  associacao: Associacao | null
  verificacao: Verificacao | null
  nLinhas: number | null
  modo: ModoExtracao | null
  completude: EstadoCompletude | null
  medicao: MedicaoExtracao | null
}
export type EstadoImportacao = 'desativado' | 'sem_consentimento' | 'entrada_invalida' | 'concluido' | 'parcial' | 'falhou' | 'cancelado'
export type ResultadoImportacao = {
  estado: EstadoImportacao
  ficheiros: ResultadoFicheiro[]
  medicoes: MedicaoExtracao[]
  /** Códigos distintos dos ficheiros que não ficaram guardados por erro/incompletude (para o diagnóstico). */
  codigos: string[]
}

// ───────────────────────── utilitários ─────────────────────────
const ehObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const numOuNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function registar(deps: DependenciasImportacao, nivel: 'info' | 'warn' | 'error', mensagem: string, dados?: Record<string, unknown>) {
  try { deps.registo?.[nivel](mensagem, limparDados(dados)) } catch { /* o registo nunca pode quebrar a importação */ }
}

function blocoDe(mimeType: string | null | undefined, base64: string): BlocoFicheiro {
  // espelha o fluxo legado: PDF como «document»; tudo o resto como imagem JPEG
  if (mimeType === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } }
}

type LimiteResultado<T> = { estado: 'ok'; valor: T } | { estado: 'timeout' }
function comLimite<T>(p: Promise<T>, ms: number): Promise<LimiteResultado<T>> {
  return new Promise<LimiteResultado<T>>((resolve, reject) => {
    const t = setTimeout(() => resolve({ estado: 'timeout' }), ms)
    p.then(valor => { clearTimeout(t); resolve({ estado: 'ok', valor }) }, e => { clearTimeout(t); reject(e) })
  })
}

// ───────────────────────── associação ficheiro ↔ resultado legado ─────────────────────────
export type ItemV2 = { mes: number | null; ano: number | null }
type LegadoLido = { tipo: 'fiche' | 'frais' | 'outro'; mes: number | null; ano: number | null; net: number | null }

function lerLegado(d: unknown): LegadoLido {
  const o = ehObj(d) ? d : {}
  const dados = ehObj(o.dados) ? o.dados : o
  const tipo = o.tipo === 'fiche' ? 'fiche' : o.tipo === 'frais' ? 'frais' : 'outro'
  return { tipo, mes: numOuNull(o.moisIndex ?? dados.moisIndex), ano: numOuNull(o.annee ?? dados.annee), net: numOuNull(dados.netPaye ?? o.netPaye) }
}

/**
 * Associa cada documento detalhado (um por ficheiro, que é fiável PORQUE cada pedido leva um só ficheiro) ao resultado legado.
 * A resposta legada vem num array SEM indicação do ficheiro de origem; por isso a ORDEM nunca é usada:
 *  • «certa»: 1 ficheiro, 1 documento detalhado e 1 documento legado (não há mais nada com que se confundir);
 *  • «provavel»: o período (mês/ano) é único entre os documentos detalhados E único entre os legados;
 *  • «indeterminada»: tudo o resto (sem legado, períodos repetidos/ilegíveis, sem correspondência).
 */
export function associarFicheirosAoLegado(v2: readonly ItemV2[], nFicheiros: number, legado: readonly unknown[] | null | undefined): Associacao[] {
  const leg = Array.isArray(legado) ? legado.map(lerLegado) : []
  return v2.map((item): Associacao => {
    const indet = (motivo: string): Associacao => ({ estado: 'indeterminada', motivo, indiceLegado: null, tipoLegado: null })
    if (leg.length === 0) return indet('sem_legado')
    if (nFicheiros === 1 && v2.length === 1 && leg.length === 1) return { estado: 'certa', motivo: 'um_ficheiro_um_documento', indiceLegado: 0, tipoLegado: leg[0].tipo }
    if (item.mes === null || item.ano === null) return indet('periodo_ilegivel')
    const pares = v2.filter(x => x.mes === item.mes && x.ano === item.ano).length
    const candidatos = leg.map((l, i) => ({ l, i })).filter(x => x.l.mes === item.mes && x.l.ano === item.ano)
    if (candidatos.length === 0) return indet('sem_correspondencia')
    if (pares > 1 || candidatos.length > 1) return indet('periodo_ambiguo')
    return { estado: 'provavel', motivo: 'periodo_unico', indiceLegado: candidatos[0].i, tipoLegado: candidatos[0].l.tipo }
  })
}

/** Compara só o «net payé» documental com o legado. Devolve um CÓDIGO, nunca valores. */
function verificarCruzada(doc: DocumentoRubricas, assoc: Associacao, legado: readonly unknown[] | null | undefined): Verificacao {
  if (assoc.estado === 'indeterminada' || assoc.indiceLegado === null || !Array.isArray(legado)) return 'nao_comparavel'
  const a = doc.totaisImpressos.netPaye
  const b = lerLegado(legado[assoc.indiceLegado]).net
  if (a === null || b === null) return 'nao_comparavel'
  return Math.abs(a - b) < 0.005 ? 'coincide' : 'diverge'
}

// ───────────────────────── medições ─────────────────────────
export type ResumoMedicoes = {
  n: number
  comResposta: number
  falhas: Record<string, number>
  truncadas: number
  duracaoMs: { min: number | null; p50: number | null; p95: number | null; max: number | null; media: number | null }
  /** Contagem por faixa de latência, SEM assumir qual é o limite real do serviço. */
  faixas: { ate5s: number; ate10s: number; ate26s: number; ate30s: number; ate60s: number; acima60s: number }
  tokensSaidaMedia: number | null
  tamanhoBase64Medio: number | null
}
const percentil = (ord: number[], p: number): number | null => (ord.length === 0 ? null : ord[Math.min(ord.length - 1, Math.max(0, Math.ceil(p * ord.length) - 1))])

const RESULTADOS_OK = ['estrutura_verificada', 'guardado', 'identico', 'conflito_conteudo_diferente']

export function resumirMedicoes(medicoes: readonly MedicaoExtracao[]): ResumoMedicoes {
  const dur = medicoes.map(m => m.duracaoMs).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b)
  const falhas: Record<string, number> = {}
  let comResposta = 0, truncadas = 0
  for (const m of medicoes) {
    if (m.tokensSaida !== null || m.stopReason !== null) comResposta++
    if (m.truncada) truncadas++
    if (!RESULTADOS_OK.includes(m.resultado)) falhas[m.resultado] = (falhas[m.resultado] ?? 0) + 1
  }
  const faixas = { ate5s: 0, ate10s: 0, ate26s: 0, ate30s: 0, ate60s: 0, acima60s: 0 }
  for (const d of dur) {
    if (d <= 5000) faixas.ate5s++; else if (d <= 10000) faixas.ate10s++; else if (d <= 26000) faixas.ate26s++
    else if (d <= 30000) faixas.ate30s++; else if (d <= 60000) faixas.ate60s++; else faixas.acima60s++
  }
  const tok = medicoes.map(m => m.tokensSaida).filter((x): x is number => typeof x === 'number')
  const tam = medicoes.map(m => m.tamanhoBase64)
  const media = (v: number[]) => (v.length === 0 ? null : Math.round(v.reduce((a, b) => a + b, 0) / v.length))
  return {
    n: medicoes.length, comResposta, falhas, truncadas,
    duracaoMs: { min: dur.length ? dur[0] : null, p50: percentil(dur, 0.5), p95: percentil(dur, 0.95), max: dur.length ? dur[dur.length - 1] : null, media: media(dur) },
    faixas, tokensSaidaMedia: media(tok), tamanhoBase64Medio: media(tam),
  }
}

/** Acrescenta uma medição a uma lista com tamanho máximo (as mais antigas saem primeiro). Pura: devolve uma lista nova. */
export function acrescentarMedicao(lista: readonly MedicaoExtracao[], nova: MedicaoExtracao, max = 100): MedicaoExtracao[] {
  const r = [...lista, nova]
  return r.length > max ? r.slice(r.length - max) : r
}

// ───────────────────────── adaptador ─────────────────────────
type Pendente = { pos: number; resultado: ResultadoFicheiro; doc: DocumentoRubricas }

function vazioFicheiro(indice: number, estado: EstadoFicheiro, codigo: string, extra: Partial<ResultadoFicheiro> = {}): ResultadoFicheiro {
  return { indice, estado, codigo, idFicheiro: null, idDocumento: null, associacao: null, verificacao: null, nLinhas: null, modo: null, completude: null, medicao: null, ...extra }
}

function medirTentativa(indice: number, tamanho: number, duracaoMs: number | null, resultado: string, t: TentativaDetalhada): MedicaoExtracao {
  const m: MedicaoExtracao = { indice, duracaoMs, resultado, categoriaErro: null, status: null, tokensEntrada: null, tokensSaida: null, stopReason: null, tamanhoBase64: tamanho, nLinhas: null, truncada: false }
  if (t.tipo === 'erro') { m.categoriaErro = t.categoria; m.status = typeof t.status === 'number' ? t.status : null; return m }
  if (t.tipo === 'api') {
    const r = lerRespostaAPI(t.data)
    m.stopReason = r.stopReason
    const usage = ehObj(t.data) && ehObj(t.data.usage) ? t.data.usage : null
    if (usage) { m.tokensEntrada = numOuNull(usage.input_tokens); m.tokensSaida = numOuNull(usage.output_tokens) }
  } else m.stopReason = t.stopReason ?? null
  m.truncada = m.stopReason === 'max_tokens'
  return m
}

export async function importarRubricasDeFicheiros(entrada: EntradaImportacao, deps: DependenciasImportacao): Promise<ResultadoImportacao> {
  const vazio = (estado: EstadoImportacao): ResultadoImportacao => ({ estado, ficheiros: [], medicoes: [], codigos: [] })
  try {
    if (!entrada || !Array.isArray(entrada.ficheiros)) { registar(deps, 'warn', 'rubricasV2: entrada inválida'); return vazio('entrada_invalida') }
    if (entrada.ativo !== true) return vazio('desativado')
    if (entrada.consentimentoIA !== true) { registar(deps, 'info', 'rubricasV2: sem consentimento IA — nada foi feito'); return vazio('sem_consentimento') }

    const limiteMs = typeof entrada.limiteMsPorFicheiro === 'number' && entrada.limiteMsPorFicheiro > 0 ? entrada.limiteMsPorFicheiro : LIMITE_MS_PADRAO
    const cancelado = () => entrada.sinal?.aborted === true
    const iso = () => (deps.agoraISO ? deps.agoraISO() : new Date().toISOString())
    const n = entrada.ficheiros.length
    const resultados: ResultadoFicheiro[] = new Array(n)
    const medicoes: MedicaoExtracao[] = []
    const pendentes: Pendente[] = []
    const vistos = new Set<string>()

    // ── fase 1: extrair (em sequência) ──
    for (let pos = 0; pos < n; pos++) {
      const f = entrada.ficheiros[pos]
      if (cancelado()) { resultados[pos] = vazioFicheiro(pos, 'cancelado', 'cancelado_antes_da_chamada'); continue }
      const base64 = ehObj(f) && typeof f.base64 === 'string' ? f.base64 : ''
      const ident = identidadeFicheiro(base64)
      if (ident === null) { resultados[pos] = vazioFicheiro(pos, 'ignorado', 'ficheiro_invalido'); continue }
      if (vistos.has(ident.id)) { resultados[pos] = vazioFicheiro(pos, 'ignorado', 'duplicado_no_lote', { idFicheiro: ident.id }); continue }
      vistos.add(ident.id)
      if (ident.tamanhoBase64 > LIMITE_BASE64_FICHEIRO) { resultados[pos] = vazioFicheiro(pos, 'ignorado', 'demasiado_grande', { idFicheiro: ident.id }); continue }

      const pedido = construirPedidoRubricas(blocoDe(f.mimeType, base64))
      const t0 = deps.agora()
      let tentativa: TentativaDetalhada
      let codigoChamada: string | null = null
      try {
        const r = await comLimite(deps.chamar(pedido, { indice: pos, sinal: entrada.sinal }), limiteMs)
        if (r.estado === 'ok') tentativa = r.valor
        else { tentativa = { tipo: 'erro', categoria: 'timeout' }; codigoChamada = 'timeout_adaptador' }
      } catch { tentativa = { tipo: 'erro', categoria: 'outro' }; codigoChamada = 'excecao_chamada' }
      const duracao = Math.max(0, deps.agora() - t0)

      if (cancelado()) {   // resposta tardia depois do cancelamento: descartada, nada é gravado
        resultados[pos] = vazioFicheiro(pos, 'cancelado', 'cancelado_apos_chamada', { idFicheiro: ident.id })
        registar(deps, 'info', 'rubricasV2: cancelado — resposta descartada', { indice: pos, duracaoMs: duracao })
        continue
      }

      let prep: ReturnType<typeof prepararExtracaoRubricas>
      try { prep = prepararExtracaoRubricas(tentativa, { agora: iso(), hashDocumento: ident.id }) }
      catch {
        const med = medirTentativa(pos, ident.tamanhoBase64, duracao, 'erro_avaliacao', tentativa)
        medicoes.push(med)
        resultados[pos] = vazioFicheiro(pos, 'falhou', 'erro_avaliacao', { idFicheiro: ident.id, medicao: med })
        continue
      }

      const docs = prep.documentos
      const decisao = prep.decisao
      const codigo = codigoChamada ?? decisao.codigo
      const med = medirTentativa(pos, ident.tamanhoBase64, duracao, codigo, tentativa)
      med.nLinhas = docs.length === 1 ? docs[0].linhas.length : null
      if (prep.completude.estado === 'incompleto') med.truncada = true
      medicoes.push(med)
      const base: Partial<ResultadoFicheiro> = {
        idFicheiro: ident.id, medicao: med, modo: decisao.modo, completude: prep.completude.estado, nLinhas: med.nLinhas,
        idDocumento: docs.length === 1 ? docs[0].idDocumento : null,
      }

      if (tentativa.tipo === 'erro' || codigoChamada !== null) { resultados[pos] = vazioFicheiro(pos, 'falhou', codigo, base); continue }
      if (docs.length > 1) { resultados[pos] = vazioFicheiro(pos, 'nao_guardado', 'varios_documentos_numa_resposta', { ...base, idDocumento: null }); continue }
      if (docs.length === 0) { resultados[pos] = vazioFicheiro(pos, 'nao_guardado', 'sem_documentos', base); continue }
      if (decisao.acao !== 'usar_detalhada' || decisao.modo !== 'detalhada_estrutura_verificada') {
        // incompleta / não verificável: NÃO se guarda (para não ocupar o lugar de uma extração completa futura do mesmo ficheiro)
        resultados[pos] = vazioFicheiro(pos, 'nao_guardado', decisao.codigo, base)
        continue
      }
      const resultado = vazioFicheiro(pos, 'nao_guardado', 'pendente', base)
      resultados[pos] = resultado
      pendentes.push({ pos, resultado, doc: docs[0] })
    }

    // ── fase 2: associar ao legado (nunca pela ordem) e gravar ──
    const assoc = associarFicheirosAoLegado(pendentes.map(p => ({ mes: p.doc.periodoDocumento.mes, ano: p.doc.periodoDocumento.ano })), n, entrada.legado)
    for (let k = 0; k < pendentes.length; k++) {
      const { pos, resultado, doc } = pendentes[k]
      const a = assoc[k]
      resultado.associacao = a
      resultado.verificacao = verificarCruzada(doc, a, entrada.legado)
      if (cancelado()) { resultado.estado = 'cancelado'; resultado.codigo = 'cancelado_antes_de_gravar'; continue }
      if (a.estado !== 'indeterminada' && a.tipoLegado === 'frais') { resultado.estado = 'ignorado'; resultado.codigo = 'ignorado_frais'; continue }
      const pareceFiche = doc.totaisImpressos.brut !== null || doc.totaisImpressos.netPaye !== null
      if (a.estado === 'indeterminada' && !pareceFiche) { resultado.estado = 'ignorado'; resultado.codigo = 'ignorado_tipo_incerto'; continue }
      if (a.estado !== 'indeterminada' && a.tipoLegado !== 'fiche' && !pareceFiche) { resultado.estado = 'ignorado'; resultado.codigo = 'ignorado_tipo_incerto'; continue }

      let r
      try { r = await acrescentarDocumentos(deps.armazem, [doc], { agora: iso(), origem: 'importacao', registo: deps.registo }) }
      catch { resultado.estado = 'falhou'; resultado.codigo = 'excecao_armazem'; continue }
      if (r.estado === 'erro') { resultado.estado = 'falhou'; resultado.codigo = `armazem_${r.codigo}`; continue }
      const s = r.valor
      if (s.invalidos > 0) { resultado.estado = 'nao_guardado'; resultado.codigo = 'documento_invalido' }
      else if (s.conflitos > 0) { resultado.estado = 'conflito'; resultado.codigo = 'conflito_conteudo_diferente' }
      else if (s.adicionados > 0) { resultado.estado = 'guardado'; resultado.codigo = 'guardado' }
      else { resultado.estado = 'identico'; resultado.codigo = 'identico' }
      if (resultado.medicao) resultado.medicao.resultado = resultado.codigo
    }

    for (const r of resultados) {
      registar(deps, r.estado === 'falhou' ? 'warn' : 'info', 'rubricasV2: ficheiro processado', {
        indice: r.indice, estado: r.estado, codigo: r.codigo, duracaoMs: r.medicao?.duracaoMs ?? undefined, nLinhas: r.nLinhas ?? undefined,
        associacao: r.associacao?.estado, verificacao: r.verificacao ?? undefined,
      })
    }
    const codigos = Array.from(new Set(resultados.filter(r => r.estado === 'falhou' || r.estado === 'nao_guardado').map(r => r.codigo)))
    const algumGuardado = resultados.some(r => r.estado === 'guardado' || r.estado === 'identico' || r.estado === 'conflito')
    const todosOk = resultados.every(r => r.estado === 'guardado' || r.estado === 'identico' || r.estado === 'conflito' || r.estado === 'ignorado')
    const estado: EstadoImportacao = cancelado() ? 'cancelado' : todosOk ? 'concluido' : algumGuardado ? 'parcial' : 'falhou'
    return { estado, ficheiros: resultados, medicoes, codigos }
  } catch {
    registar(deps, 'error', 'rubricasV2: erro inesperado', { codigo: 'erro_inesperado' })
    return { estado: 'falhou', ficheiros: [], medicoes: [], codigos: ['erro_inesperado'] }
  }
}
