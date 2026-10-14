// src/utils/rubricasStore.ts
// Etapa 2D — armazenamento PROTEGIDO das rubricas documentais na chave `monSalaire_rubricas_v1` (separada de `monSalaire_v2`).
// AINDA NÃO está ligado ao fluxo de importação das fiches (isso é a Etapa 2E): só o backup/restauro o usa.
//
// Princípios:
//  • NUNCA apaga, substitui nem altera silenciosamente uma rubrica documental original. Documentos diferentes (mesmo do mesmo mês) coexistem.
//  • Identidade: `idDocumento` igual OU `hashDocumento` igual (hash dos bytes do ficheiro, definido pela app). Mesmo documento + mesmo conteúdo ⇒ nada a fazer.
//    Mesmo documento + conteúdo DIFERENTE ⇒ conserva-se o existente e a nova versão entra como documento à parte, assinalada com `conflito`.
//  • Só as decisões EXPLÍCITAS do utilizador (classificação confirmada/rejeitada, estado confirmado/editado) são preservadas e podem enriquecer um
//    documento idêntico (restauro); uma extração automática nunca as sobrepõe.
//  • Gravações: fila PRÓPRIA (independente da do histórico), validação antes de gravar, verificação por releitura, erros explícitos.
//    Dados corrompidos NUNCA viram uma coleção vazia gravada por cima: a operação recusa-se e o valor guardado fica intacto.
//  • Tamanho: no Android uma linha do AsyncStorage acima de ~2 MB deixa de ler-se. Avisa-se aos LIMITE_AVISO_BYTES e recusa-se acima de LIMITE_MAXIMO_BYTES.
//    Proposta de fragmentação (NÃO implementada nem migrada): `monSalaire_rubricas_v1` passa a índice {versao, formato:'indice', ids[]} e cada documento
//    vai para `monSalaire_rubricas_v1:doc:<idDocumento>`; o backup enumera o índice; a escrita usa multiSet atómico.
//  • Privacidade: os registos (logs) só levam contagens e códigos — nunca libellés, montantes, períodos nem documentos.
import { CATEGORIAS_RUBRICA, type CategoriaRubrica, type DocumentoRubricas, type EstadoDocumentoRubricas } from '../types/rubricas'
import { clonar, hash16, validarDocumentoRubricas } from './rubricas'

export const CHAVE_RUBRICAS = 'monSalaire_rubricas_v1'
export const VERSAO_ARMAZEM = 1
/** A partir daqui sinaliza-se que o armazenamento se aproxima do limite seguro. */
export const LIMITE_AVISO_BYTES = 1_200_000
/** Acima daqui recusa-se gravar (deixa uma margem sob os ~2 MB de leitura por linha do Android). */
export const LIMITE_MAXIMO_BYTES = 1_800_000

export type ArmazemRubricas = { versao: typeof VERSAO_ARMAZEM; documentos: DocumentoRubricas[] }

export interface ArmazenamentoRubricas {
  getItem(chave: string): Promise<string | null>
  setItem(chave: string, valor: string): Promise<void>
}

/** Registo de diagnóstico. Só recebe contagens/códigos (o store filtra qualquer outro valor). */
export type RegistoRubricas = {
  info: (mensagem: string, dados?: Record<string, unknown>) => void
  warn: (mensagem: string, dados?: Record<string, unknown>) => void
  error: (mensagem: string, dados?: Record<string, unknown>) => void
}

export type NivelTamanho = 'ok' | 'aviso' | 'excedido'

export type CodigoErroRubricas =
  | 'erro_leitura' | 'erro_escrita' | 'verificacao_falhou' | 'armazem_corrompido' | 'versao_futura' | 'limite_tamanho'
  | 'documento_nao_encontrado' | 'linha_nao_encontrada' | 'categoria_invalida' | 'estado_invalido' | 'erro_inesperado'

export type ResultadoOperacao<T> =
  | { ok: true; estado: 'ok'; valor: T; gravou: boolean; bytes: number; nivel: NivelTamanho }
  | { ok: false; estado: 'erro'; codigo: CodigoErroRubricas; mensagem: string; detalhe?: string }

export type OpcoesStore = {
  /** ISO usado em `conflito.detetadoEm` (testes determinísticos). */
  agora?: string
  origem?: 'importacao' | 'restauro'
  registo?: RegistoRubricas
  /** Relê o valor depois de gravar e compara (por omissão: sim). */
  verificarGravacao?: boolean
}

// ───────────────────────── fila de escrita PRÓPRIA ─────────────────────────
// Não reutiliza a do histórico: é uma cadeia de promessas independente (a chave é independente de `historique`/`monSalaire_v2`).
// Quem precisar das duas (restauro) pede SEMPRE primeiro a do histórico e depois esta; nenhuma operação do store pede a do histórico ⇒ sem impasses.
let cauda: Promise<unknown> = Promise.resolve()
export function comFilaRubricas<T>(fn: () => Promise<T>): Promise<T> {
  const p = cauda.then(fn)
  cauda = p.then(() => undefined, () => undefined)
  return p
}

// ───────────────────────── utilitários ─────────────────────────
const ehObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

export function bytesUtf8(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}
export const nivelTamanho = (bytes: number): NivelTamanho => (bytes > LIMITE_MAXIMO_BYTES ? 'excedido' : bytes >= LIMITE_AVISO_BYTES ? 'aviso' : 'ok')

const SEGURO = /^[A-Za-z0-9_.:\-~]{1,64}$/
/** Só deixa passar números, booleanos e códigos curtos sem espaços (defesa em profundidade contra fugas de dados para os logs). */
export function limparDados(d?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!d) return undefined
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'number' || typeof v === 'boolean') o[k] = v
    else if (typeof v === 'string' && SEGURO.test(v)) o[k] = v
    else if (Array.isArray(v) && v.every(x => typeof x === 'string' && SEGURO.test(x))) o[k] = v
  }
  return o
}
function registar(opc: OpcoesStore | undefined, nivel: 'info' | 'warn' | 'error', mensagem: string, dados?: Record<string, unknown>) {
  try { opc?.registo?.[nivel](mensagem, limparDados(dados)) } catch { /* o registo nunca pode rebentar uma operação */ }
}
const nomeErro = (e: unknown): string => (e !== null && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string' ? (e as { name: string }).name : 'Erro')

const falha = (codigo: CodigoErroRubricas, mensagem: string, detalhe?: string): { ok: false; estado: 'erro'; codigo: CodigoErroRubricas; mensagem: string; detalhe?: string } =>
  ({ ok: false, estado: 'erro', codigo, mensagem, ...(detalhe ? { detalhe } : {}) })

// ───────────────────────── validação do armazém ─────────────────────────
export type ValidacaoArmazem =
  | { estado: 'ok'; armazem: ArmazemRubricas }
  | { estado: 'corrompido' | 'versao_futura'; codigos: string[] }

function problemasDocumento(doc: unknown): string[] {
  const erros = validarDocumentoRubricas(doc).filter(p => p.gravidade === 'erro').map(p => p.codigo)
  if (ehObj(doc) && doc.conflito !== undefined) {
    const c = doc.conflito
    if (!ehObj(c) || typeof c.comIdDocumento !== 'string' || !c.comIdDocumento) erros.push('conflito_invalido')
  }
  return Array.from(new Set(erros))
}

/** Valida a estrutura guardada. Não altera nada. Qualquer documento inválido torna o armazém «corrompido» (nunca se descarta em silêncio). */
export function validarArmazem(valor: unknown): ValidacaoArmazem {
  if (!ehObj(valor)) return { estado: 'corrompido', codigos: ['armazem_nao_objeto'] }
  if (typeof valor.versao === 'number' && valor.versao > VERSAO_ARMAZEM) return { estado: 'versao_futura', codigos: ['versao_futura'] }
  if (valor.versao !== VERSAO_ARMAZEM) return { estado: 'corrompido', codigos: ['versao_invalida'] }
  if (!Array.isArray(valor.documentos)) return { estado: 'corrompido', codigos: ['documentos_nao_lista'] }
  const codigos = new Set<string>()
  const ids = new Set<string>()
  valor.documentos.forEach(d => {
    problemasDocumento(d).forEach(c => codigos.add(c))
    if (ehObj(d) && typeof d.idDocumento === 'string') {
      if (ids.has(d.idDocumento)) codigos.add('idDocumento_duplicado')
      ids.add(d.idDocumento)
    }
  })
  if (codigos.size > 0) return { estado: 'corrompido', codigos: Array.from(codigos) }
  return { estado: 'ok', armazem: valor as unknown as ArmazemRubricas }
}

export type LeituraArmazem =
  | { estado: 'vazio' }
  | { estado: 'ok'; armazem: ArmazemRubricas; bytes: number }
  | { estado: 'corrompido'; codigos: string[] }
  | { estado: 'versao_futura' }
  | { estado: 'erro_leitura'; tipo: string }

/** Lê e valida. Nunca devolve «vazio» para dados que existem mas estão estragados. */
export async function lerRubricas(arm: ArmazenamentoRubricas, opc?: OpcoesStore): Promise<LeituraArmazem> {
  let raw: string | null
  try { raw = await arm.getItem(CHAVE_RUBRICAS) } catch (e) {
    registar(opc, 'error', 'rubricas: leitura falhou', { tipo: nomeErro(e) })
    return { estado: 'erro_leitura', tipo: nomeErro(e) }
  }
  if (raw === null) return { estado: 'vazio' }
  let valor: unknown
  try { valor = JSON.parse(raw) } catch {
    registar(opc, 'error', 'rubricas: JSON guardado ilegível', { codigo: 'json_ilegivel' })
    return { estado: 'corrompido', codigos: ['json_ilegivel'] }
  }
  const v = validarArmazem(valor)
  if (v.estado !== 'ok') {
    registar(opc, v.estado === 'versao_futura' ? 'warn' : 'error', 'rubricas: armazém inválido', { estado: v.estado, codigos: v.codigos })
    return v.estado === 'versao_futura' ? { estado: 'versao_futura' } : { estado: 'corrompido', codigos: v.codigos }
  }
  return { estado: 'ok', armazem: v.armazem, bytes: bytesUtf8(raw) }
}

// ───────────────────────── identidade e fusão ─────────────────────────
/** Impressão digital do CONTEÚDO DOCUMENTAL (períodos, totais impressos e linhas originais, por ordem). Ignora classificações, problemas, ids e datas. */
export function impressaoConteudo(doc: DocumentoRubricas): string {
  const t = doc.totaisImpressos
  return hash16(JSON.stringify([
    doc.periodoDocumento?.texto ?? null, doc.periodoDocumento?.mes ?? null, doc.periodoDocumento?.ano ?? null,
    [t?.brut, t?.cotisationsSalariales, t?.cotisationsPatronales, t?.netImposable, t?.netSocial, t?.netAvantImpot, t?.pas, t?.netPaye].map(x => x ?? null),
    doc.linhas.map(l => [l.libelleOriginal, l.quantidade, l.unidade, l.taxa, l.base, l.montante, l.coluna, l.periodoTexto]),
  ]))
}

/** Mesmo documento = mesmo `idDocumento` OU mesmo `hashDocumento` (nunca «mesmo mês»). */
export const mesmoDocumento = (a: DocumentoRubricas, b: DocumentoRubricas): boolean =>
  a.idDocumento === b.idDocumento || (typeof a.hashDocumento === 'string' && a.hashDocumento !== '' && a.hashDocumento === b.hashDocumento)

const RANK_ESTADO: Record<EstadoDocumentoRubricas, number> = { extraido: 0, confirmado: 1, editado: 2 }
const decididaPeloUtilizador = (c: { origem: string; estado: string }) => c.origem === 'utilizador' && (c.estado === 'confirmada' || c.estado === 'rejeitada')

export type ResumoFusao = {
  adicionados: number
  identicos: number
  conflitos: number
  invalidos: number
  classificacoesAdotadas: number
  conflitosClassificacao: number
  estadosAtualizados: number
  codigosInvalidos: string[]
}
const resumoVazio = (): ResumoFusao => ({ adicionados: 0, identicos: 0, conflitos: 0, invalidos: 0, classificacoesAdotadas: 0, conflitosClassificacao: 0, estadosAtualizados: 0, codigosInvalidos: [] })
export const houveAlteracao = (r: ResumoFusao): boolean => r.adicionados + r.conflitos + r.classificacoesAdotadas + r.estadosAtualizados > 0

/** Documento idêntico em conteúdo: só pode ganhar DECISÕES DO UTILIZADOR que o existente ainda não tem. Devolve o documento novo ou null se nada mudou. */
function enriquecer(existente: DocumentoRubricas, novo: DocumentoRubricas, r: ResumoFusao): DocumentoRubricas | null {
  let copia: DocumentoRubricas | null = null
  const obter = () => (copia ??= clonar(existente))
  for (const ln of novo.linhas) {
    const i = existente.linhas.findIndex(l => l.id === ln.id)
    if (i < 0) continue
    const ex = existente.linhas[i].classificacao
    const nv = ln.classificacao
    if (decididaPeloUtilizador(ex)) {
      if (decididaPeloUtilizador(nv) && (nv.categoria !== ex.categoria || nv.estado !== ex.estado)) r.conflitosClassificacao++
      continue
    }
    if (decididaPeloUtilizador(nv)) { obter().linhas[i].classificacao = clonar(nv); r.classificacoesAdotadas++ }
  }
  if (RANK_ESTADO[novo.estado] > RANK_ESTADO[existente.estado]) { obter().estado = novo.estado; r.estadosAtualizados++ }
  return copia
}

/**
 * Junta `novos` a `atual` SEM destruir nada:
 *  • os documentos existentes ficam intactos (só podem ganhar decisões do utilizador, ver `enriquecer`);
 *  • documento novo e sem correspondência ⇒ acrescenta; correspondência com o mesmo conteúdo ⇒ idêntico;
 *    correspondência com conteúdo diferente (ou identificadores ambíguos) ⇒ entra à parte com `conflito`.
 * Entradas inválidas são contadas (códigos) e não entram — nunca se corrigem. Não altera as entradas.
 */
export function fundirDocumentos(atual: readonly DocumentoRubricas[], novos: readonly unknown[], ctx: { agora: string; origem: 'importacao' | 'restauro' }): { documentos: DocumentoRubricas[]; resumo: ResumoFusao } {
  const res: DocumentoRubricas[] = atual.slice()
  const r = resumoVazio()
  for (const n of novos) {
    const cod = problemasDocumento(n)
    if (cod.length > 0) { r.invalidos++; cod.forEach(c => { if (!r.codigosInvalidos.includes(c)) r.codigosInvalidos.push(c) }); continue }
    const nd = clonar(n as DocumentoRubricas)
    const fp = impressaoConteudo(nd)
    const base: number[] = []
    res.forEach((d, i) => { if (mesmoDocumento(d, nd)) base.push(i) })
    const candidatos = new Set<number>(base)
    res.forEach((d, j) => { if (d.conflito && base.some(b => res[b].idDocumento === d.conflito!.comIdDocumento)) candidatos.add(j) })
    const igual = Array.from(candidatos).find(i => impressaoConteudo(res[i]) === fp)
    if (igual !== undefined) {
      r.identicos++
      const e = enriquecer(res[igual], nd, r)
      if (e) res[igual] = e
      continue
    }
    if (base.length === 0) { res.push(nd); r.adicionados++; continue }
    const ids = new Set(res.map(d => d.idDocumento))
    let id = nd.idDocumento
    if (ids.has(id)) {
      id = `${nd.idDocumento}~alt-${fp.slice(0, 8)}`
      for (let k = 2; ids.has(id); k++) id = `${nd.idDocumento}~alt-${fp.slice(0, 8)}-${k}`
    }
    nd.idDocumento = id
    nd.conflito = { comIdDocumento: res[base[0]].idDocumento, motivo: base.length > 1 ? 'identificadores_ambiguos' : 'conteudo_diferente', detetadoEm: ctx.agora, origem: ctx.origem }
    res.push(nd)
    r.conflitos++
  }
  return { documentos: res, resumo: r }
}

// ───────────────────────── gravação segura ─────────────────────────
function serializar(documentos: DocumentoRubricas[]): string { return JSON.stringify({ versao: VERSAO_ARMAZEM, documentos } satisfies ArmazemRubricas) }

async function gravar(arm: ArmazenamentoRubricas, documentos: DocumentoRubricas[], opc: OpcoesStore | undefined): Promise<{ estado: 'ok'; bytes: number; nivel: NivelTamanho } | ReturnType<typeof falha>> {
  const novo: ArmazemRubricas = { versao: VERSAO_ARMAZEM, documentos }
  const v = validarArmazem(novo) // valida ANTES de persistir
  if (v.estado !== 'ok') { registar(opc, 'error', 'rubricas: conteúdo recusado antes de gravar', { codigos: v.codigos }); return falha('armazem_corrompido', 'Conteúdo inválido: nada foi gravado.', v.codigos.join(',')) }
  const texto = serializar(documentos)
  const bytes = bytesUtf8(texto)
  const nivel = nivelTamanho(bytes)
  if (nivel === 'excedido') {
    registar(opc, 'error', 'rubricas: limite de tamanho excedido', { bytes, limite: LIMITE_MAXIMO_BYTES })
    return falha('limite_tamanho', 'O armazenamento das rubricas excederia o limite seguro: nada foi gravado.')
  }
  try { await arm.setItem(CHAVE_RUBRICAS, texto) } catch (e) {
    registar(opc, 'error', 'rubricas: gravação falhou', { tipo: nomeErro(e) })
    return falha('erro_escrita', 'A gravação das rubricas falhou.', nomeErro(e))
  }
  if (opc?.verificarGravacao !== false) {
    let lido: string | null
    try { lido = await arm.getItem(CHAVE_RUBRICAS) } catch (e) {
      registar(opc, 'error', 'rubricas: verificação da gravação falhou (leitura)', { tipo: nomeErro(e) })
      return falha('verificacao_falhou', 'Não foi possível confirmar a gravação das rubricas.', nomeErro(e))
    }
    if (lido !== texto) {
      registar(opc, 'error', 'rubricas: o valor lido não coincide com o gravado', { codigo: 'divergencia' })
      return falha('verificacao_falhou', 'A gravação das rubricas não foi confirmada (o valor lido difere do gravado).')
    }
  }
  if (nivel === 'aviso') registar(opc, 'warn', 'rubricas: armazenamento perto do limite', { bytes, aviso: LIMITE_AVISO_BYTES })
  return { estado: 'ok', bytes, nivel }
}

type EstadoLido = { documentos: DocumentoRubricas[]; bytes: number }
async function lerParaEscrever(arm: ArmazenamentoRubricas, opc: OpcoesStore | undefined): Promise<EstadoLido | ReturnType<typeof falha>> {
  const l = await lerRubricas(arm, opc)
  if (l.estado === 'ok') return { documentos: l.armazem.documentos, bytes: l.bytes }
  if (l.estado === 'vazio') return { documentos: [], bytes: 0 }
  if (l.estado === 'erro_leitura') return falha('erro_leitura', 'Não foi possível ler as rubricas guardadas: nada foi gravado.', l.tipo)
  if (l.estado === 'versao_futura') return falha('versao_futura', 'As rubricas guardadas são de uma versão mais recente da app: nada foi gravado.')
  return falha('armazem_corrompido', 'As rubricas guardadas estão corrompidas: nada foi gravado nem substituído.', l.codigos.join(','))
}
const ehFalha = (x: unknown): x is ReturnType<typeof falha> => ehObj(x) && x.estado === 'erro'

/** Executa uma operação de leitura-modificação-escrita dentro da fila, sem nunca lançar. */
async function transacao<T>(arm: ArmazenamentoRubricas, opc: OpcoesStore | undefined, corpo: (documentos: DocumentoRubricas[]) => { documentos: DocumentoRubricas[]; valor: T; alterou: boolean } | ReturnType<typeof falha>): Promise<ResultadoOperacao<T>> {
  return comFilaRubricas(async (): Promise<ResultadoOperacao<T>> => {
    try {
      const lido = await lerParaEscrever(arm, opc)
      if (ehFalha(lido)) return lido
      const r = corpo(lido.documentos)
      if (ehFalha(r)) return r
      if (!r.alterou) return { ok: true, estado: 'ok', valor: r.valor, gravou: false, bytes: lido.bytes, nivel: nivelTamanho(lido.bytes) }
      const g = await gravar(arm, r.documentos, opc)
      if (ehFalha(g)) return g
      return { ok: true, estado: 'ok', valor: r.valor, gravou: true, bytes: g.bytes, nivel: g.nivel }
    } catch (e) {
      registar(opc, 'error', 'rubricas: erro inesperado', { tipo: nomeErro(e) })
      return falha('erro_inesperado', 'Erro inesperado nas rubricas: nada foi confirmado.', nomeErro(e))
    }
  })
}

// ───────────────────────── operações públicas ─────────────────────────
/** Acrescenta documentos extraídos (fusão não destrutiva). Reimportar o mesmo documento não grava nada. */
export function acrescentarDocumentos(arm: ArmazenamentoRubricas, docs: readonly unknown[], opc: OpcoesStore = {}): Promise<ResultadoOperacao<ResumoFusao>> {
  const agora = opc.agora ?? new Date().toISOString()
  return transacao(arm, opc, atual => {
    const f = fundirDocumentos(atual, docs, { agora, origem: opc.origem ?? 'importacao' })
    registar(opc, 'info', 'rubricas: documentos processados', { adicionados: f.resumo.adicionados, identicos: f.resumo.identicos, conflitos: f.resumo.conflitos, invalidos: f.resumo.invalidos })
    return { documentos: f.documentos, valor: f.resumo, alterou: houveAlteracao(f.resumo) }
  })
}

/** Decisão EXPLÍCITA do utilizador: confirma a categoria de uma linha (origem «utilizador»). Não toca em nenhum dado documental. */
export function confirmarClassificacao(arm: ArmazenamentoRubricas, idDocumento: string, idLinha: string, escolha: { categoria: CategoriaRubrica; subcategoria?: string | null }, opc: OpcoesStore = {}): Promise<ResultadoOperacao<{ idDocumento: string; idLinha: string }>> {
  return transacao(arm, opc, atual => {
    if (!CATEGORIAS_RUBRICA.includes(escolha.categoria)) return falha('categoria_invalida', 'Categoria desconhecida.')
    const i = atual.findIndex(d => d.idDocumento === idDocumento)
    if (i < 0) return falha('documento_nao_encontrado', 'Documento não encontrado.')
    const j = atual[i].linhas.findIndex(l => l.id === idLinha)
    if (j < 0) return falha('linha_nao_encontrada', 'Linha não encontrada.')
    const doc = clonar(atual[i])
    const antiga = doc.linhas[j].classificacao
    doc.linhas[j].classificacao = { categoria: escolha.categoria, subcategoria: escolha.subcategoria ?? null, origem: 'utilizador', estado: 'confirmada', confianca: null, categoriaBruta: antiga.categoriaBruta }
    const documentos = atual.slice(); documentos[i] = doc
    registar(opc, 'info', 'rubricas: classificação confirmada pelo utilizador', { categoria: escolha.categoria })
    return { documentos, valor: { idDocumento, idLinha }, alterou: true }
  })
}

/** Marca um documento como «confirmado» ou «editado» (só sobe: nunca regride). Estes documentos nunca são sobrescritos por extrações automáticas. */
export function definirEstadoDocumento(arm: ArmazenamentoRubricas, idDocumento: string, estado: 'confirmado' | 'editado', opc: OpcoesStore = {}): Promise<ResultadoOperacao<{ estado: EstadoDocumentoRubricas }>> {
  return transacao(arm, opc, atual => {
    if (estado !== 'confirmado' && estado !== 'editado') return falha('estado_invalido', 'Estado inválido.')
    const i = atual.findIndex(d => d.idDocumento === idDocumento)
    if (i < 0) return falha('documento_nao_encontrado', 'Documento não encontrado.')
    if (RANK_ESTADO[estado] <= RANK_ESTADO[atual[i].estado]) return { documentos: atual, valor: { estado: atual[i].estado }, alterou: false }
    const doc = clonar(atual[i]); doc.estado = estado
    const documentos = atual.slice(); documentos[i] = doc
    registar(opc, 'info', 'rubricas: estado do documento atualizado', { estado })
    return { documentos, valor: { estado }, alterou: true }
  })
}

// ───────────────────────── restauro de backup ─────────────────────────
export type ResultadoRestauroRubricas =
  | { acao: 'nada'; motivo: 'ausente_no_backup' | 'sem_alteracoes'; resumo: ResumoFusao }
  | { acao: 'ignorar'; motivo: 'estrutura_invalida' | 'versao_futura' | 'armazem_atual_corrompido' | 'armazem_atual_versao_futura' | 'limite_tamanho'; codigos: string[]; resumo: ResumoFusao }
  | { acao: 'gravar'; serializado: string; resumo: ResumoFusao; bytes: number; nivel: NivelTamanho }

/** Estrutura mínima do que vem num backup (o resto valida-se documento a documento). */
export function validarRubricasDoBackup(importado: unknown): { estado: 'ausente' } | { estado: 'invalido'; codigos: string[] } | { estado: 'versao_futura' } | { estado: 'ok'; documentos: unknown[] } {
  if (importado === undefined || importado === null) return { estado: 'ausente' }
  if (!ehObj(importado)) return { estado: 'invalido', codigos: ['nao_objeto'] }
  if (typeof importado.versao === 'number' && importado.versao > VERSAO_ARMAZEM) return { estado: 'versao_futura' }
  if (importado.versao !== VERSAO_ARMAZEM) return { estado: 'invalido', codigos: ['versao_invalida'] }
  if (!Array.isArray(importado.documentos)) return { estado: 'invalido', codigos: ['documentos_nao_lista'] }
  return { estado: 'ok', documentos: importado.documentos }
}

/**
 * Parte PURA do restauro: dado o valor atual (texto) e o que vem no backup, decide o que gravar. Nunca lança.
 *  • backup sem a chave ⇒ nada (as rubricas existentes ficam como estão);
 *  • estrutura inválida / valor atual corrompido ou ilegível ⇒ ignora (não toca no valor atual) — nunca converte dados estragados numa coleção vazia;
 *  • caso contrário funde por identidade documental (ver fundirDocumentos) e devolve o texto a gravar, que o chamador inclui no MESMO multiSet atómico do restauro.
 */
export function prepararRestauroRubricas(rawAtual: string | null, importado: unknown, opc: OpcoesStore = {}): ResultadoRestauroRubricas {
  const vazio = resumoVazio()
  const v = validarRubricasDoBackup(importado)
  if (v.estado === 'ausente') return { acao: 'nada', motivo: 'ausente_no_backup', resumo: vazio }
  if (v.estado === 'invalido') { registar(opc, 'warn', 'rubricas: secção do backup inválida — ignorada', { codigos: v.codigos }); return { acao: 'ignorar', motivo: 'estrutura_invalida', codigos: v.codigos, resumo: vazio } }
  if (v.estado === 'versao_futura') return { acao: 'ignorar', motivo: 'versao_futura', codigos: ['versao_futura'], resumo: vazio }
  let atual: DocumentoRubricas[] = []
  if (rawAtual !== null) {
    let valor: unknown
    try { valor = JSON.parse(rawAtual) } catch { registar(opc, 'error', 'rubricas: valor atual ilegível — não foi tocado', { codigo: 'json_ilegivel' }); return { acao: 'ignorar', motivo: 'armazem_atual_corrompido', codigos: ['json_ilegivel'], resumo: vazio } }
    const va = validarArmazem(valor)
    if (va.estado !== 'ok') {
      registar(opc, 'error', 'rubricas: valor atual inválido — não foi tocado', { estado: va.estado, codigos: va.codigos })
      return va.estado === 'versao_futura'
        ? { acao: 'ignorar', motivo: 'armazem_atual_versao_futura', codigos: va.codigos, resumo: vazio }
        : { acao: 'ignorar', motivo: 'armazem_atual_corrompido', codigos: va.codigos, resumo: vazio }
    }
    atual = va.armazem.documentos
  }
  const f = fundirDocumentos(atual, v.documentos, { agora: opc.agora ?? new Date().toISOString(), origem: 'restauro' })
  if (!houveAlteracao(f.resumo)) return { acao: 'nada', motivo: 'sem_alteracoes', resumo: f.resumo }
  const serializado = serializar(f.documentos)
  const bytes = bytesUtf8(serializado)
  const nivel = nivelTamanho(bytes)
  if (nivel === 'excedido') { registar(opc, 'error', 'rubricas: restauro recusado por tamanho', { bytes, limite: LIMITE_MAXIMO_BYTES }); return { acao: 'ignorar', motivo: 'limite_tamanho', codigos: ['limite_tamanho'], resumo: f.resumo } }
  if (nivel === 'aviso') registar(opc, 'warn', 'rubricas: armazenamento perto do limite após restauro', { bytes })
  registar(opc, 'info', 'rubricas: restauro preparado', { adicionados: f.resumo.adicionados, identicos: f.resumo.identicos, conflitos: f.resumo.conflitos, invalidos: f.resumo.invalidos })
  return { acao: 'gravar', serializado, resumo: f.resumo, bytes, nivel }
}
