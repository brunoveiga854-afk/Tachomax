// src/utils/autotesteRubricas.ts — Autoteste SEGURO da persistência e do restauro das rubricas (Etapa 2D), para correr no telemóvel.
//
// Usa o código REAL (rubricasStore + escritaComRollback) contra um espaço de chaves ISOLADO, com documentos FICTÍCIOS.
//
// ISOLAMENTO — quatro camadas independentes (basta uma para proteger as chaves reais):
//  1. NOMES LÓGICOS FECHADOS: o autoteste só consegue pedir CHAVES_LOGICAS_PERMITIDAS (a chave das rubricas, exigida pelo armazém,
//     e quatro nomes neutros «autoteste_*»). Qualquer outro nome (monSalaire_v2, historique, frais_regles, aprendizagem_padrao…) lança.
//     Estes nomes reais NÃO aparecem neste ficheiro.
//  2. PREFIXO OBRIGATÓRIO: o nome lógico é sempre traduzido para `__teste2d__:<execução>:<nome>`.
//  3. GUARDA DE BAIXO NÍVEL: o backend real só é alcançado através de `criarGuarda`, que verifica o prefixo e os caracteres da chave
//     FÍSICA antes de cada operação. Perante um erro de implementação nas camadas 1-2, lança `ViolacaoIsolamento` ANTES de tocar no backend,
//     conta a violação e o autoteste aborta.
//  4. SEM LEITURA DE VALORES ALHEIOS: a única operação que vê chaves de fora é `getAllKeys()` (só NOMES), filtrada pela guarda;
//     os valores de outras chaves nunca são lidos, escritos nem apagados.
// Limpeza: no início remove só as chaves `__teste2d__:` deixadas por execuções interrompidas; no fim (mesmo com falhas) remove as desta execução.
// Não há leitura, escrita nem remoção de chaves reais; os registos só levam códigos e contagens.
import {
  CHAVE_RUBRICAS, acrescentarDocumentos, confirmarClassificacao, lerRubricas, prepararRestauroRubricas, LIMITE_AVISO_BYTES,
  type ArmazenamentoRubricas,
} from './rubricasStore'
import type { DocumentoRubricas } from '../types/rubricas'
import { escreverComRollback, type ArmazenamentoMulti } from './escritaComRollback'
import { normalizarRespostaExtracao } from './rubricas'

// ───────────────────────── tipos ─────────────────────────
export type BackendAutoteste = {
  getItem(chave: string): Promise<string | null>
  setItem(chave: string, valor: string): Promise<void>
  removeItem(chave: string): Promise<void>
  multiGet(chaves: readonly string[]): Promise<readonly (readonly [string, string | null])[]>
  multiSet(pares: [string, string][]): Promise<void>
  getAllKeys(): Promise<readonly string[]>
}
export type RegistoAutoteste = { info: (m: string, d?: Record<string, unknown>) => void; error: (m: string, d?: Record<string, unknown>) => void }

export type EstadoPasso = 'ok' | 'falhou' | 'ignorado'
export type ResultadoPasso = { id: string; rotulo: string; estado: EstadoPasso; codigo: string | null; ms: number }
export type EstadoAutoteste = 'ok' | 'falhou' | 'violacao_isolamento' | 'ocupado'
export type RelatorioAutoteste = {
  estado: EstadoAutoteste
  passos: ResultadoPasso[]
  chavesTocadas: number
  violacoes: number
  limpeza: { residuosAnteriores: number; removidasNoFim: number; residuosFinais: number | null; falhou: boolean }
}

// ───────────────────────── camada 3: guarda de baixo nível ─────────────────────────
export const PREFIXO_TESTE = '__teste2d__:'
const RESTO_CHAVE = /^[A-Za-z0-9_.:~-]{1,160}$/

/** Uma chave física é do espaço de teste se e só se começa pelo prefixo e o resto só tem caracteres seguros. */
export function chaveFisicaValida(chave: unknown, prefixo: string = PREFIXO_TESTE): boolean {
  return typeof chave === 'string' && chave.startsWith(prefixo) && chave.length > prefixo.length && RESTO_CHAVE.test(chave.slice(prefixo.length))
}

export type GuardaIsolamento = BackendAutoteste & {
  violacoes(): number
  chavesTocadas(): string[]
  /** Nomes (nunca valores) das chaves de teste existentes. */
  listarChavesDeTeste(): Promise<string[]>
  /** Remove SÓ chaves de teste (prefixo validado). */
  removerChavesDeTeste(): Promise<{ removidas: number; falhas: number }>
}

export function criarGuarda(backend: BackendAutoteste, prefixo: string = PREFIXO_TESTE): GuardaIsolamento {
  let violacoes = 0
  const tocadas = new Set<string>()
  const viola = (): never => { violacoes++; throw Object.assign(new Error('chave_fora_do_espaco_de_teste'), { name: 'ViolacaoIsolamento' }) }
  const ok = (k: unknown): string => { if (!chaveFisicaValida(k, prefixo)) return viola(); tocadas.add(k as string); return k as string }
  const g: GuardaIsolamento = {
    getItem: k => backend.getItem(ok(k)),
    setItem: (k, v) => backend.setItem(ok(k), v),
    removeItem: k => backend.removeItem(ok(k)),
    multiGet: ks => backend.multiGet(ks.map(ok)),
    multiSet: ps => { const validos = ps.map(p => [ok(p[0]), p[1]] as [string, string]); return backend.multiSet(validos) },
    getAllKeys: async () => (await backend.getAllKeys()).filter(k => chaveFisicaValida(k, prefixo)),
    violacoes: () => violacoes,
    chavesTocadas: () => Array.from(tocadas),
    listarChavesDeTeste: async () => (await backend.getAllKeys()).filter(k => chaveFisicaValida(k, prefixo)),
    removerChavesDeTeste: async () => {
      let removidas = 0, falhas = 0
      const chaves = (await backend.getAllKeys()).filter(k => chaveFisicaValida(k, prefixo))
      for (const k of chaves) { try { await backend.removeItem(ok(k)); removidas++ } catch { falhas++ } }
      return { removidas, falhas }
    },
  }
  return g
}

// ───────────────────────── camadas 1 e 2: nomes lógicos fechados + prefixo ─────────────────────────
export const CHAVE_A = 'autoteste_a'
export const CHAVE_B = 'autoteste_b'
export const CHAVE_BRUTA = 'autoteste_bruta'
export const CHAVE_TAMANHO = 'autoteste_tamanho'
export const CHAVES_LOGICAS_PERMITIDAS: readonly string[] = [CHAVE_RUBRICAS, CHAVE_A, CHAVE_B, CHAVE_BRUTA, CHAVE_TAMANHO]

export type ArmazenamentoLogico = ArmazenamentoRubricas & ArmazenamentoMulti
export function criarArmazenamentoLogico(guarda: BackendAutoteste, prefixoExecucao: string, permitidas: readonly string[] = CHAVES_LOGICAS_PERMITIDAS): ArmazenamentoLogico {
  const fis = (logica: string): string => {
    if (!permitidas.includes(logica)) throw Object.assign(new Error('nome_logico_nao_permitido'), { name: 'ViolacaoIsolamento' })
    return prefixoExecucao + logica
  }
  const logica = (fisica: string): string => fisica.startsWith(prefixoExecucao) ? fisica.slice(prefixoExecucao.length) : fisica
  return {
    getItem: k => guarda.getItem(fis(k)),
    setItem: (k, v) => guarda.setItem(fis(k), v),
    removeItem: k => guarda.removeItem(fis(k)),
    multiGet: async ks => (await guarda.multiGet(ks.map(fis))).map(([k, v]) => [logica(k), v] as const),
    multiSet: ps => guarda.multiSet(ps.map(p => [fis(p[0]), p[1]] as [string, string])),
  }
}

// ───────────────────────── injeção de falhas (por cima do armazenamento lógico) ─────────────────────────
export type Falhas = { getFalha?: boolean; setFalha?: boolean; setPerde?: boolean; multiSetFalha?: boolean; multiSetFalhaAposN?: number; removeFalhaEm?: string }
const erroSim = (nome: string) => Object.assign(new Error('falha simulada'), { name: nome })

export function comFalhas(arm: ArmazenamentoLogico, f: Falhas): ArmazenamentoLogico {
  return {
    getItem: async k => { if (f.getFalha) throw erroSim('LeituraSimulada'); return arm.getItem(k) },
    setItem: async (k, v) => { if (f.setFalha) throw erroSim('EscritaSimulada'); if (f.setPerde) return; return arm.setItem(k, v) },
    removeItem: async k => { if (f.removeFalhaEm === k) throw erroSim('RemocaoSimulada'); return arm.removeItem(k) },
    multiGet: async ks => { if (f.getFalha) throw erroSim('LeituraSimulada'); return arm.multiGet(ks) },
    multiSet: async ps => {
      if (f.multiSetFalha) throw erroSim('EscritaSimulada')
      if (f.multiSetFalhaAposN !== undefined) {   // gravação PARCIAL: as primeiras N chegam ao armazenamento (isolado) e depois falha
        for (const [k, v] of ps.slice(0, f.multiSetFalhaAposN)) await arm.setItem(k, v)
        throw erroSim('EscritaParcialSimulada')
      }
      return arm.multiSet(ps)
    },
  }
}

// ───────────────────────── documentos fictícios ─────────────────────────
const AGORA_FIXO = '2000-01-01T00:00:00.000Z'
function docFicticio(n: number, variante = false): DocumentoRubricas {
  return normalizarRespostaExtracao({
    hash: `autoteste-${n}`, periode: 'Janvier 2000', moisIndex: 0, annee: 2000,
    totaux: { brut: 100 + n, netPaye: 80 + n },
    lignes: [
      { libelle: `AUTOTESTE ligne ${n}.1`, quantite: 1, unite: 'h', taux: 1, montant: 10 + n + (variante ? 0.5 : 0), colonne: 'gain', categorie: 'salaire_base' },
      { libelle: `AUTOTESTE ligne ${n}.2`, montant: 5, colonne: 'retenue' },
    ],
  }, { agora: AGORA_FIXO })
}
const opc = { agora: AGORA_FIXO }

// ───────────────────────── passos ─────────────────────────
export type Ctx = { arm: ArmazenamentoLogico }
export type Passo = { id: string; rotulo: string; fn: (c: Ctx) => Promise<void> }
const falha = (codigo: string): never => { throw { falhaPasso: codigo } }
const exigir = (cond: boolean, codigo: string) => { if (!cond) falha(codigo) }

async function reiniciar(arm: ArmazenamentoLogico) { for (const k of CHAVES_LOGICAS_PERMITIDAS) await arm.removeItem(k) }
async function docs(arm: ArmazenamentoLogico): Promise<DocumentoRubricas[]> {
  const l = await lerRubricas(arm)
  if (l.estado === 'vazio') return []
  if (l.estado !== 'ok') return falha(`leitura_${l.estado}`)
  return l.armazem.documentos
}

export const PASSOS: readonly Passo[] = [
  { id: 'gravar_ler', rotulo: 'Écriture et lecture', fn: async ({ arm }) => {
    await reiniciar(arm)
    const d = [docFicticio(1), docFicticio(2)]
    const r = await acrescentarDocumentos(arm, d, opc)
    exigir(r.estado === 'ok' && r.valor.adicionados === 2, 'gravacao_falhou')
    const lidos = await docs(arm)
    exigir(lidos.length === 2 && JSON.stringify(lidos) === JSON.stringify(d), 'leitura_diferente')
  } },
  { id: 'reimportacao_identica', rotulo: 'Réimport identique', fn: async ({ arm }) => {
    const antes = await arm.getItem(CHAVE_RUBRICAS)
    const r = await acrescentarDocumentos(arm, [docFicticio(1), docFicticio(2)], opc)
    exigir(r.estado === 'ok' && r.valor.identicos === 2 && r.valor.adicionados === 0 && !r.gravou, 'reimportacao_nao_idempotente')
    exigir((await arm.getItem(CHAVE_RUBRICAS)) === antes, 'valor_mudou')
  } },
  { id: 'conflito', rotulo: 'Conflit (même document, contenu différent)', fn: async ({ arm }) => {
    const original = JSON.stringify((await docs(arm))[0])
    const r = await acrescentarDocumentos(arm, [docFicticio(1, true)], opc)
    exigir(r.estado === 'ok' && r.valor.conflitos === 1 && r.valor.adicionados === 0, 'conflito_nao_detetado')
    const lidos = await docs(arm)
    exigir(lidos.length === 3 && JSON.stringify(lidos[0]) === original, 'existente_alterado')
    exigir(!!lidos[2].conflito && lidos[2].conflito.comIdDocumento === lidos[0].idDocumento, 'conflito_sem_marca')
    const r2 = await acrescentarDocumentos(arm, [docFicticio(1, true)], opc)
    exigir(r2.estado === 'ok' && r2.valor.identicos === 1 && (await docs(arm)).length === 3, 'conflito_duplicado')
  } },
  { id: 'confirmada_preservada', rotulo: 'Classification confirmée préservée', fn: async ({ arm }) => {
    const lidos = await docs(arm)
    const c = await confirmarClassificacao(arm, lidos[0].idDocumento, lidos[0].linhas[0].id, { categoria: 'salaire_base' }, opc)
    exigir(c.estado === 'ok', 'confirmacao_falhou')
    await acrescentarDocumentos(arm, [docFicticio(1), docFicticio(1, true)], opc)
    const depois = await docs(arm)
    exigir(depois[0].linhas[0].classificacao.estado === 'confirmada' && depois[0].linhas[0].classificacao.origem === 'utilizador', 'confirmada_perdida')
  } },
  { id: 'concorrencia', rotulo: 'Écritures simultanées', fn: async ({ arm }) => {
    await reiniciar(arm)
    const lote = [1, 2, 3, 4, 5, 6].map(n => docFicticio(n))
    const rs = await Promise.all(lote.map(d => acrescentarDocumentos(arm, [d], opc)))
    exigir(rs.every(r => r.estado === 'ok'), 'escrita_simultanea_falhou')
    const lidos = await docs(arm)
    exigir(lidos.length === 6, 'documento_perdido')
    exigir(new Set(lidos.map(d => d.idDocumento)).size === 6, 'ids_repetidos')
  } },
  { id: 'dados_corrompidos', rotulo: 'Données corrompues refusées', fn: async ({ arm }) => {
    await arm.setItem(CHAVE_RUBRICAS, '{corrompido')
    const l = await lerRubricas(arm)
    exigir(l.estado === 'corrompido', 'corrupcao_nao_detetada')
    const r = await acrescentarDocumentos(arm, [docFicticio(1)], opc)
    exigir(r.estado === 'erro' && r.codigo === 'armazem_corrompido', 'escrita_sobre_corrompido')
    exigir((await arm.getItem(CHAVE_RUBRICAS)) === '{corrompido', 'corrompido_alterado')
    await arm.setItem(CHAVE_RUBRICAS, JSON.stringify({ versao: 99, documentos: [] }))
    exigir((await lerRubricas(arm)).estado === 'versao_futura', 'versao_futura_nao_detetada')
    await arm.removeItem(CHAVE_RUBRICAS)
  } },
  { id: 'fusao_restauro', rotulo: 'Fusion de la restauration', fn: async ({ arm }) => {
    await reiniciar(arm)
    await acrescentarDocumentos(arm, [docFicticio(1), docFicticio(2)], opc)
    const l0 = await docs(arm)
    await confirmarClassificacao(arm, l0[0].idDocumento, l0[0].linhas[0].id, { categoria: 'salaire_base' }, opc)
    await arm.setItem(CHAVE_A, 'A0')
    const atual = await arm.getItem(CHAVE_RUBRICAS)
    const backup = { versao: 1, documentos: [docFicticio(1), docFicticio(2, true), docFicticio(3)] }
    const rr = prepararRestauroRubricas(atual, backup, opc)
    exigir(rr.acao === 'gravar' && rr.resumo.adicionados === 1 && rr.resumo.conflitos === 1 && rr.resumo.identicos === 1, 'fusao_resumo_errado')
    if (rr.acao !== 'gravar') return
    await escreverComRollback(arm, [[CHAVE_RUBRICAS, rr.serializado], [CHAVE_A, 'A1']])
    const lidos = await docs(arm)
    exigir(lidos.length === 4, 'fusao_contagem_errada')
    exigir(lidos[0].linhas[0].classificacao.estado === 'confirmada', 'fusao_perdeu_confirmada')
    exigir((await arm.getItem(CHAVE_A)) === 'A1', 'fusao_chave_a')
    exigir(prepararRestauroRubricas(await arm.getItem(CHAVE_RUBRICAS), undefined, opc).acao === 'nada', 'backup_antigo_alterou')
    exigir(prepararRestauroRubricas('{corrompido', backup, opc).acao === 'ignorar', 'corrompido_nao_ignorado')
    exigir(prepararRestauroRubricas(await arm.getItem(CHAVE_RUBRICAS), { versao: 1, documentos: 'x' }, opc).acao === 'ignorar', 'backup_invalido_aceite')
  } },
  { id: 'escrita_falha', rotulo: 'Échec d’écriture simulé', fn: async ({ arm }) => {
    await reiniciar(arm)
    await acrescentarDocumentos(arm, [docFicticio(1)], opc)
    const antes = await arm.getItem(CHAVE_RUBRICAS)
    const r = await acrescentarDocumentos(comFalhas(arm, { setFalha: true }), [docFicticio(2)], opc)
    exigir(r.estado === 'erro' && r.codigo === 'erro_escrita', 'erro_escrita_nao_assinalado')
    exigir((await arm.getItem(CHAVE_RUBRICAS)) === antes, 'valor_anterior_alterado')
    const p = await acrescentarDocumentos(comFalhas(arm, { setPerde: true }), [docFicticio(2)], opc)
    exigir(p.estado === 'erro' && p.codigo === 'verificacao_falhou', 'escrita_perdida_nao_detetada')
    const l = await acrescentarDocumentos(comFalhas(arm, { getFalha: true }), [docFicticio(2)], opc)
    exigir(l.estado === 'erro' && l.codigo === 'erro_leitura', 'erro_leitura_nao_assinalado')
    exigir((await arm.getItem(CHAVE_RUBRICAS)) === antes, 'valor_alterado_apos_falhas')
  } },
  { id: 'rollback_total', rotulo: 'Rollback (échec total)', fn: async ({ arm }) => {
    await reiniciar(arm)
    await arm.setItem(CHAVE_A, 'A0'); await arm.setItem(CHAVE_RUBRICAS, '{"x":0}')
    let erro: { name?: string; rollbackFalhou?: string[] } | null = null
    try { await escreverComRollback(comFalhas(arm, { multiSetFalha: true }), [[CHAVE_A, 'A1'], [CHAVE_B, 'B1'], [CHAVE_RUBRICAS, '{"x":1}']]) } catch (e) { erro = e as typeof erro }
    exigir(erro !== null && erro.name === 'EscritaSimulada', 'erro_original_perdido')
    exigir(Array.isArray(erro!.rollbackFalhou) && erro!.rollbackFalhou!.length === 0, 'rollback_reportou_falha')
    exigir((await arm.getItem(CHAVE_A)) === 'A0' && (await arm.getItem(CHAVE_B)) === null && (await arm.getItem(CHAVE_RUBRICAS)) === '{"x":0}', 'rollback_nao_repos')
  } },
  { id: 'rollback_parcial', rotulo: 'Rollback (écriture partielle)', fn: async ({ arm }) => {
    for (const n of [1, 2]) {
      await reiniciar(arm)
      await arm.setItem(CHAVE_A, 'A0')
      let falhou = false
      try { await escreverComRollback(comFalhas(arm, { multiSetFalhaAposN: n }), [[CHAVE_A, 'A1'], [CHAVE_B, 'B1'], [CHAVE_RUBRICAS, '{"x":1}']]) } catch { falhou = true }
      exigir(falhou, 'falha_nao_propagada')
      exigir((await arm.getItem(CHAVE_A)) === 'A0', 'parcial_a_nao_reposto')
      exigir((await arm.getItem(CHAVE_B)) === null && (await arm.getItem(CHAVE_RUBRICAS)) === null, 'parcial_chave_nova_ficou')
    }
  } },
  { id: 'rollback_falhado', rotulo: 'Échec du rollback signalé', fn: async ({ arm }) => {
    await reiniciar(arm)
    let erro: { name?: string; rollbackFalhou?: string[] } | null = null
    try { await escreverComRollback(comFalhas(arm, { multiSetFalhaAposN: 2, removeFalhaEm: CHAVE_B }), [[CHAVE_A, 'A1'], [CHAVE_B, 'B1']]) } catch (e) { erro = e as typeof erro }
    exigir(erro !== null && erro.name === 'EscritaParcialSimulada', 'erro_original_perdido')
    exigir(JSON.stringify(erro!.rollbackFalhou) === JSON.stringify([CHAVE_B]), 'rollback_falhado_nao_listado')
  } },
  { id: 'tamanho_conservador', rotulo: 'Taille prudente (256 Ko)', fn: async ({ arm }) => {
    const v = 'x'.repeat(256 * 1024)
    await arm.setItem(CHAVE_TAMANHO, v)
    exigir((await arm.getItem(CHAVE_TAMANHO)) === v, 'tamanho_nao_persistido')
    await arm.removeItem(CHAVE_TAMANHO)
    exigir((await arm.getItem(CHAVE_TAMANHO)) === null, 'tamanho_nao_removido')
  } },
]

// ───────────────────────── execução ─────────────────────────
let emExecucao = false

export type DependenciasAutoteste = {
  backend: BackendAutoteste
  agora?: () => number
  /** Identificador da execução (só [a-z0-9]); por omissão derivado do relógio. */
  idExecucao?: string
  registo?: RegistoAutoteste
  /** Só para testes unitários: substitui a lista de passos. Os passos só recebem o armazenamento LÓGICO isolado, nunca o backend. */
  passos?: readonly Passo[]
}

function reg(d: DependenciasAutoteste, nivel: 'info' | 'error', m: string, dados?: Record<string, unknown>) { try { d.registo?.[nivel](m, dados) } catch { /* nunca quebra */ } }

export async function executarAutoteste(deps: DependenciasAutoteste): Promise<RelatorioAutoteste> {
  const relatorio: RelatorioAutoteste = { estado: 'ok', passos: [], chavesTocadas: 0, violacoes: 0, limpeza: { residuosAnteriores: 0, removidasNoFim: 0, residuosFinais: null, falhou: false } }
  if (emExecucao) return { ...relatorio, estado: 'ocupado' }
  emExecucao = true
  const agora = deps.agora ?? (() => Date.now())
  const id = (deps.idExecucao && /^[a-z0-9]{4,16}$/.test(deps.idExecucao)) ? deps.idExecucao : agora().toString(36)
  const guarda = criarGuarda(deps.backend)
  let violouCamada2 = false
  try {
    try { relatorio.limpeza.residuosAnteriores = (await guarda.removerChavesDeTeste()).removidas } catch { relatorio.limpeza.falhou = true }
    const arm = criarArmazenamentoLogico(guarda, `${PREFIXO_TESTE}${id}:`)
    for (const p of (deps.passos ?? PASSOS)) {
      const t0 = agora()
      let estado: EstadoPasso = 'ok', codigo: string | null = null
      try { await p.fn({ arm }) }
      catch (e) {
        estado = 'falhou'
        const c = e && typeof e === 'object' ? (e as { falhaPasso?: unknown }).falhaPasso : undefined
        codigo = typeof c === 'string' ? c : ((e as { name?: string })?.name === 'ViolacaoIsolamento' ? 'violacao_isolamento' : 'excecao')
      }
      relatorio.passos.push({ id: p.id, rotulo: p.rotulo, estado, codigo, ms: Math.max(0, agora() - t0) })
      if (codigo === 'violacao_isolamento') violouCamada2 = true
      if (guarda.violacoes() > 0 || violouCamada2) { relatorio.estado = 'violacao_isolamento'; reg(deps, 'error', 'autoteste rubricas: violação de isolamento — abortado', { passo: p.id }); break }
      if (estado === 'falhou') relatorio.estado = 'falhou'
    }
  } finally {
    try {
      const r = await guarda.removerChavesDeTeste()
      relatorio.limpeza.removidasNoFim = r.removidas
      if (r.falhas > 0) relatorio.limpeza.falhou = true
      relatorio.limpeza.residuosFinais = (await guarda.listarChavesDeTeste()).length
      if (relatorio.limpeza.residuosFinais > 0) relatorio.limpeza.falhou = true
    } catch { relatorio.limpeza.falhou = true }
    relatorio.chavesTocadas = guarda.chavesTocadas().length
    relatorio.violacoes = guarda.violacoes() + (violouCamada2 && guarda.violacoes() === 0 ? 1 : 0)
    if (relatorio.violacoes > 0) relatorio.estado = 'violacao_isolamento'
    emExecucao = false
  }
  const ko = relatorio.passos.filter(p => p.estado === 'falhou').map(p => p.id)
  reg(deps, relatorio.estado === 'ok' ? 'info' : 'error', 'autoteste rubricas: concluído', { estado: relatorio.estado, passos: relatorio.passos.length, falhados: ko, chavesTocadas: relatorio.chavesTocadas, limpezaFalhou: relatorio.limpeza.falhou })
  return relatorio
}

/** Texto para o diagnóstico: só rótulos fixos, códigos e tempos (nunca dados). */
export function formatarRelatorio(r: RelatorioAutoteste): string[] {
  if (r.estado === 'ocupado') return ['⏳ Un test est déjà en cours.']
  const linhas = r.passos.map(p => `${p.estado === 'ok' ? '✅' : p.estado === 'falhou' ? '❌' : '➖'} ${p.rotulo} (${p.ms} ms)${p.codigo ? ' — ' + p.codigo : ''}`)
  linhas.push(`${r.limpeza.falhou ? '⚠️' : '✅'} Nettoyage des clés temporaires${r.limpeza.residuosAnteriores > 0 ? ` (${r.limpeza.residuosAnteriores} restes d’un test interrompu supprimés)` : ''}${r.limpeza.falhou ? ' — échec partiel' : ''}`)
  linhas.push(`🔒 Clés touchées : ${r.chavesTocadas} (toutes temporaires) · violations d’isolement : ${r.violacoes}`)
  linhas.push(r.estado === 'ok' ? '✅ Résultat : tout est OK' : r.estado === 'violacao_isolamento' ? '❌ Résultat : VIOLATION D’ISOLEMENT — test arrêté' : '❌ Résultat : échec — voir ci-dessus')
  return linhas
}

// ───────────────────────── teste de capacidade: DESATIVADO (precisa de aprovação posterior) ─────────────────────────
/** Só uma aprovação explícita posterior altera esta constante. Nenhum botão a expõe. */
export const CAPACIDADE_AUTORIZADA = false
export const LIMITE_CAPACIDADE_BYTES = LIMITE_AVISO_BYTES   // teto conservador: nunca acima do limite de aviso do armazém

export type RelatorioCapacidade = { estado: 'desativado' | 'ok' | 'falhou'; codigo: string | null; maiorTamanhoOk: number | null }

/** Escreve valores crescentes numa chave de TESTE isolada e para à primeira falha. Recebe um armazenamento lógico já isolado. */
export async function passosDeCapacidade(arm: ArmazenamentoLogico, tamanhos: readonly number[]): Promise<RelatorioCapacidade> {
  let maior: number | null = null
  try {
    for (const t of tamanhos) {
      if (!(t > 0) || t > LIMITE_CAPACIDADE_BYTES) return { estado: 'falhou', codigo: 'tamanho_acima_do_limite_conservador', maiorTamanhoOk: maior }
      const v = 'x'.repeat(t)
      await arm.setItem(CHAVE_TAMANHO, v)
      if ((await arm.getItem(CHAVE_TAMANHO)) !== v) return { estado: 'falhou', codigo: 'releitura_diferente', maiorTamanhoOk: maior }
      maior = t
    }
    return { estado: 'ok', codigo: null, maiorTamanhoOk: maior }
  } catch { return { estado: 'falhou', codigo: 'excecao', maiorTamanhoOk: maior } }
  finally { try { await arm.removeItem(CHAVE_TAMANHO) } catch { /* limpeza final tratada pelo chamador */ } }
}

export async function executarTesteCapacidade(_deps: DependenciasAutoteste): Promise<RelatorioCapacidade> {
  if (!CAPACIDADE_AUTORIZADA) return { estado: 'desativado', codigo: 'capacidade_nao_autorizada', maiorTamanhoOk: null }
  return { estado: 'desativado', codigo: 'capacidade_nao_implementada_no_diagnostico', maiorTamanhoOk: null }
}
