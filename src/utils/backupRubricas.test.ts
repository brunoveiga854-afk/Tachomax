// src/utils/backupRubricas.test.ts — Etapa 2D: backup/restauro das rubricas e escrita com rollback (só documentos FICTÍCIOS)
import * as fs from 'fs'
import * as path from 'path'
import {
  CHAVE_RUBRICAS, acrescentarDocumentos, confirmarClassificacao, definirEstadoDocumento, lerRubricas, comFilaRubricas,
  prepararRestauroRubricas, validarRubricasDoBackup, LIMITE_MAXIMO_BYTES, type RegistoRubricas,
} from './rubricasStore'
import { escreverComRollback, type ArmazenamentoMulti } from './escritaComRollback'
import { comFilaHistorico } from './filaHistorico'
import { normalizarRespostaExtracao } from './rubricas'
import { PERFIL_A, PERFIL_B, PERFIL_C, montarFicheDetalhada, type Obj, type PerfilFicticio } from './rubricasFixtures'
import type { DocumentoRubricas } from '../types/rubricas'

const AGORA = '2026-10-13T10:00:00.000Z'
const opc = { agora: AGORA }
const RAIZ = path.resolve(__dirname, '..', '..')
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')

// ───────── armazenamento falso com multiGet/multiSet, atrasos e falhas injetáveis ─────────
type Falhas = { multiSetFalhaAposN?: number; multiSetFalha?: boolean; multiGetFalha?: boolean; rollbackFalhaEm?: string }
function mock(inicial: Record<string, string> = {}, f: Falhas = {}) {
  const dados: Record<string, string> = { ...inicial }
  const esp = () => new Promise(r => setTimeout(r, 1))
  const erro = (nome: string) => Object.assign(new Error('falha simulada'), { name: nome })
  const arm: ArmazenamentoMulti & { getItem(k: string): Promise<string | null> } = {
    getItem: async k => { await esp(); if (f.multiGetFalha) throw erro('LeituraFalhou'); return k in dados ? dados[k] : null },
    multiGet: async chaves => { await esp(); if (f.multiGetFalha) throw erro('LeituraFalhou'); return chaves.map(k => [k, k in dados ? dados[k] : null] as const) },
    multiSet: async pares => {
      await esp()
      if (f.multiSetFalha) throw erro('EscritaFalhou')
      if (f.multiSetFalhaAposN !== undefined) {   // gravação PARCIAL: escreve as primeiras N e depois falha
        for (const [k, v] of pares.slice(0, f.multiSetFalhaAposN)) dados[k] = v
        throw erro('EscritaParcialFalhou')
      }
      for (const [k, v] of pares) dados[k] = v
    },
    setItem: async (k, v) => { await esp(); if (f.rollbackFalhaEm === k) throw erro('RollbackFalhou'); dados[k] = v },
    removeItem: async k => { await esp(); if (f.rollbackFalhaEm === k) throw erro('RollbackFalhou'); delete dados[k] },
  }
  return { arm, dados, f }
}

const mk = (p: PerfilFicticio, extra: Obj = {}): DocumentoRubricas => normalizarRespostaExtracao({ ...montarFicheDetalhada(p), ...extra }, opc)
const variante = (p: PerfilFicticio, extra: Obj = {}): DocumentoRubricas =>
  mk({ ...p, linhas: p.linhas.map((l, i) => (i === 0 ? { ...l, montant: 1729.5 } : l)) }, extra)
const rejeita = async (p: Promise<unknown>): Promise<unknown> => { try { await p } catch (e) { return e } return undefined }
const armazem = (docs: DocumentoRubricas[]) => ({ versao: 1, documentos: docs })
const lerDocs = (dados: Record<string, string>): DocumentoRubricas[] => JSON.parse(dados[CHAVE_RUBRICAS]).documentos

const HIST_ANTIGO = JSON.stringify([{ id: 'h-antigo', dia: '2026-09-01' }])
const SALAIRE_ANTIGO = JSON.stringify([{ id: 'f-antiga', mes: 8, ano: 2026 }])
const HIST_BACKUP = [{ id: 'h-novo', dia: '2026-10-01' }]
const SALAIRE_BACKUP = [{ id: 'f-nova', mes: 9, ano: 2026 }]

/** Reproduz, passo a passo e com os helpers REAIS, o bloco de confirmarImport (reglages.tsx): filas → leitura → preparar → multiSet atómico com rollback. */
async function restaurar(m: ReturnType<typeof mock>, backupData: Record<string, unknown>, registo?: RegistoRubricas) {
  const pares: [string, string][] = []
  if (backupData.historique !== undefined) pares.push(['historique', JSON.stringify(backupData.historique)])
  if (backupData.monSalaire_v2 !== undefined) pares.push(['monSalaire_v2', JSON.stringify(backupData.monSalaire_v2)])
  return comFilaHistorico(() => comFilaRubricas(async () => {
    const raw = await m.arm.getItem(CHAVE_RUBRICAS)
    const rr = prepararRestauroRubricas(raw, backupData[CHAVE_RUBRICAS], { ...opc, registo })
    const todos = [...pares]
    if (rr.acao === 'gravar') todos.push([CHAVE_RUBRICAS, rr.serializado])
    await escreverComRollback(m.arm, todos)
    return rr
  }))
}
/** Reproduz a exportação (reglages.tsx ~l.253): JSON.parse de cada chave. */
function exportar(dados: Record<string, string>) {
  const data: Record<string, unknown> = {}
  for (const k of ['historique', 'monSalaire_v2', CHAVE_RUBRICAS]) if (dados[k]) data[k] = JSON.parse(dados[k])
  return JSON.parse(JSON.stringify({ app: 'TachoOffice', data }))   // ida e volta por ficheiro
}

describe('11. backup COM rubricas', () => {
  it('o backup exporta documentos com estados, ids e classificações', async () => {
    const m = mock({ historique: HIST_ANTIGO, monSalaire_v2: SALAIRE_ANTIGO })
    const a = mk(PERFIL_A, { idDocumento: 'DOC-A' })
    await acrescentarDocumentos(m.arm, [a, mk(PERFIL_B, { idDocumento: 'DOC-B' })], opc)
    await confirmarClassificacao(m.arm, 'DOC-A', a.linhas[0].id, { categoria: 'salaire_base' }, opc)
    await definirEstadoDocumento(m.arm, 'DOC-A', 'editado', opc)
    const b = exportar(m.dados)
    const docs = b.data[CHAVE_RUBRICAS].documentos as DocumentoRubricas[]
    expect(docs.map(d => d.idDocumento)).toEqual(['DOC-A', 'DOC-B'])
    expect(docs[0].estado).toBe('editado')
    expect(docs[0].linhas[0].classificacao.estado).toBe('confirmada')
    expect(docs[0].linhas.map(l => l.id)).toEqual(a.linhas.map(l => l.id))
    expect(validarRubricasDoBackup(b.data[CHAVE_RUBRICAS]).estado).toBe('ok')
  })
  it('restaurar num telemóvel vazio recria tudo igual (ids, estados, classificações)', async () => {
    const origem = mock()
    const a = mk(PERFIL_A, { idDocumento: 'DOC-A' })
    await acrescentarDocumentos(origem.arm, [a, mk(PERFIL_C, { idDocumento: 'DOC-C' })], opc)
    await confirmarClassificacao(origem.arm, 'DOC-A', a.linhas[1].id, { categoria: 'salaire_base' }, opc)
    const b = exportar({ ...origem.dados, historique: JSON.stringify(HIST_BACKUP), monSalaire_v2: JSON.stringify(SALAIRE_BACKUP) })
    const destino = mock()
    const rr = await restaurar(destino, b.data)
    expect(rr.acao).toBe('gravar')
    expect(JSON.stringify(lerDocs(destino.dados))).toBe(JSON.stringify(lerDocs(origem.dados)))
    expect(JSON.parse(destino.dados.historique)).toEqual(HIST_BACKUP)
  })
})

describe('12. backup ANTIGO sem a chave das rubricas', () => {
  it('prepararRestauroRubricas(raw, undefined) ⇒ nada; os documentos existentes ficam exatamente iguais', async () => {
    const m = mock()
    await acrescentarDocumentos(m.arm, [mk(PERFIL_A, { idDocumento: 'X' })], opc)
    const antes = m.dados[CHAVE_RUBRICAS]
    expect(prepararRestauroRubricas(antes, undefined, opc).acao).toBe('nada')
    expect(prepararRestauroRubricas(antes, null, opc).acao).toBe('nada')
    const rr = await restaurar(m, { historique: HIST_BACKUP, monSalaire_v2: SALAIRE_BACKUP })
    expect(rr.acao).toBe('nada')
    expect(m.dados[CHAVE_RUBRICAS]).toBe(antes)
    expect(JSON.parse(m.dados.historique)).toEqual(HIST_BACKUP)   // o resto do restauro segue como sempre
  })
  it('telemóvel sem rubricas + backup antigo: a chave NÃO é criada', async () => {
    const m = mock()
    await restaurar(m, { historique: HIST_BACKUP })
    expect(CHAVE_RUBRICAS in m.dados).toBe(false)
  })
})

describe('13. restauro com documentos já existentes (fusão, nunca substituição)', () => {
  it('conserva os existentes (e a classificação confirmada), acrescenta os novos, existentes primeiro', async () => {
    const m = mock({ historique: HIST_ANTIGO })
    const a = mk(PERFIL_A, { idDocumento: 'DOC-A' })
    await acrescentarDocumentos(m.arm, [a], opc)
    await confirmarClassificacao(m.arm, 'DOC-A', a.linhas[0].id, { categoria: 'salaire_base' }, opc)
    const backup = armazem([mk(PERFIL_A, { idDocumento: 'DOC-A' }), mk(PERFIL_B, { idDocumento: 'DOC-B' })])
    const rr = await restaurar(m, { [CHAVE_RUBRICAS]: backup })
    expect(rr.acao).toBe('gravar')
    const docs = lerDocs(m.dados)
    expect(docs.map(d => d.idDocumento)).toEqual(['DOC-A', 'DOC-B'])
    expect(docs[0].linhas[0].classificacao.estado).toBe('confirmada')
    expect(docs[0].linhas[0].classificacao.origem).toBe('utilizador')
  })
  it('o backup traz uma classificação confirmada e o telemóvel só tem sugerida ⇒ adota a confirmada', async () => {
    const m = mock()
    const a = mk(PERFIL_A, { idDocumento: 'DOC-A' })
    await acrescentarDocumentos(m.arm, [a], opc)
    const o = mock()
    await acrescentarDocumentos(o.arm, [a], opc)
    await confirmarClassificacao(o.arm, 'DOC-A', a.linhas[0].id, { categoria: 'salaire_base' }, opc)
    await restaurar(m, { [CHAVE_RUBRICAS]: JSON.parse(o.dados[CHAVE_RUBRICAS]) })
    expect(lerDocs(m.dados)[0].linhas[0].classificacao.estado).toBe('confirmada')
  })
  it('backup com versão DIFERENTE do mesmo documento ⇒ o existente fica, a variante entra como conflito', async () => {
    const m = mock()
    await acrescentarDocumentos(m.arm, [mk(PERFIL_A, { idDocumento: 'DOC-A' })], opc)
    await restaurar(m, { [CHAVE_RUBRICAS]: armazem([variante(PERFIL_A, { idDocumento: 'DOC-A' })]) })
    const docs = lerDocs(m.dados)
    expect(docs.length).toBe(2)
    expect(docs[0].idDocumento).toBe('DOC-A')
    expect(docs[0].conflito).toBeUndefined()
    expect(docs[1].conflito?.comIdDocumento).toBe('DOC-A')
    expect(docs[1].conflito?.origem).toBe('restauro')
  })
  it('restaurar o mesmo backup duas vezes é idempotente (a segunda não grava nada)', async () => {
    const m = mock()
    const bk = { [CHAVE_RUBRICAS]: armazem([mk(PERFIL_A, { idDocumento: 'DOC-A' })]) }
    expect((await restaurar(m, bk)).acao).toBe('gravar')
    const depois = m.dados[CHAVE_RUBRICAS]
    expect((await restaurar(m, bk)).acao).toBe('nada')
    expect(m.dados[CHAVE_RUBRICAS]).toBe(depois)
  })
  it('a fusão das rubricas nunca altera monSalaire_v2/histórico além do que o restauro já fazia', async () => {
    const m = mock({ historique: HIST_ANTIGO, monSalaire_v2: SALAIRE_ANTIGO })
    await restaurar(m, { [CHAVE_RUBRICAS]: armazem([mk(PERFIL_A, { idDocumento: 'DOC-A' })]) })   // backup sem historique/monSalaire_v2
    expect(m.dados.historique).toBe(HIST_ANTIGO)
    expect(m.dados.monSalaire_v2).toBe(SALAIRE_ANTIGO)
  })
  it('secção do backup inválida ⇒ rubricas intactas; o resto do restauro segue', async () => {
    const m = mock({ historique: HIST_ANTIGO })
    await acrescentarDocumentos(m.arm, [mk(PERFIL_A, { idDocumento: 'DOC-A' })], opc)
    const antes = m.dados[CHAVE_RUBRICAS]
    for (const mau of [{ versao: 1, documentos: 'x' }, 'texto', 42, { versao: 'a' }, { versao: 99, documentos: [] }]) {
      const rr = await restaurar(m, { historique: HIST_BACKUP, [CHAVE_RUBRICAS]: mau })
      expect(rr.acao).toBe('ignorar')
      expect(m.dados[CHAVE_RUBRICAS]).toBe(antes)
    }
    expect(JSON.parse(m.dados.historique)).toEqual(HIST_BACKUP)
  })
  it('valor ATUAL corrompido ⇒ NÃO é convertido em vazio nem sobrescrito', async () => {
    const m = mock({ [CHAVE_RUBRICAS]: '{corrompido' })
    const rr = await restaurar(m, { [CHAVE_RUBRICAS]: armazem([mk(PERFIL_A)]) })
    expect(rr.acao).toBe('ignorar')
    expect(m.dados[CHAVE_RUBRICAS]).toBe('{corrompido')
  })
  it('erro de LEITURA do valor atual ⇒ o restauro FALHA e não escreve nada', async () => {
    const m = mock({ historique: HIST_ANTIGO }, { multiGetFalha: true })
    expect((await rejeita(restaurar(m, { historique: HIST_BACKUP, [CHAVE_RUBRICAS]: armazem([mk(PERFIL_A)]) })) instanceof Error)).toBe(true)
    expect(m.dados.historique).toBe(HIST_ANTIGO)
    expect(CHAVE_RUBRICAS in m.dados).toBe(false)
  })
  it('restauro que ultrapassaria o limite de tamanho ⇒ ignorado, valor atual intacto', async () => {
    const m = mock()
    await acrescentarDocumentos(m.arm, [mk(PERFIL_A, { idDocumento: 'DOC-A' })], opc)
    const antes = m.dados[CHAVE_RUBRICAS]
    const enorme = mk(PERFIL_B, { idDocumento: 'DOC-ENORME' })
    ;(enorme as unknown as { desconhecidos: Obj }).desconhecidos = { pad: 'x'.repeat(LIMITE_MAXIMO_BYTES + 10) }
    const rr = prepararRestauroRubricas(antes, armazem([enorme]), opc)
    expect(rr.acao === 'ignorar' || rr.acao === 'nada').toBe(true)
    expect(m.dados[CHAVE_RUBRICAS]).toBe(antes)
  })
})

describe('15. rollback quando a escrita falha', () => {
  it('falha total do multiSet: tudo volta ao estado anterior e o ERRO ORIGINAL é relançado (restauro = falhou)', async () => {
    const m = mock({ historique: HIST_ANTIGO, monSalaire_v2: SALAIRE_ANTIGO }, { multiSetFalha: true })
    let erro: unknown
    try { await restaurar(m, { historique: HIST_BACKUP, monSalaire_v2: SALAIRE_BACKUP, [CHAVE_RUBRICAS]: armazem([mk(PERFIL_A)]) }) } catch (e) { erro = e }
    expect((erro as Error).name).toBe('EscritaFalhou')
    expect((erro as { rollbackFalhou?: string[] }).rollbackFalhou).toEqual([])
    expect(m.dados.historique).toBe(HIST_ANTIGO)
    expect(m.dados.monSalaire_v2).toBe(SALAIRE_ANTIGO)
    expect(CHAVE_RUBRICAS in m.dados).toBe(false)
  })
  it('gravação PARCIAL (as primeiras chaves já escritas): rollback repõe os valores e remove as chaves que não existiam', async () => {
    for (const n of [1, 2]) {
      const m = mock({ historique: HIST_ANTIGO, monSalaire_v2: SALAIRE_ANTIGO }, { multiSetFalhaAposN: n })
      expect((await rejeita(restaurar(m, { historique: HIST_BACKUP, monSalaire_v2: SALAIRE_BACKUP, [CHAVE_RUBRICAS]: armazem([mk(PERFIL_A)]) })) instanceof Error)).toBe(true)
      expect(m.dados.historique).toBe(HIST_ANTIGO)
      expect(m.dados.monSalaire_v2).toBe(SALAIRE_ANTIGO)
      expect(CHAVE_RUBRICAS in m.dados).toBe(false)
    }
  })
  it('rubricas existentes também são repostas (valor anterior byte a byte)', async () => {
    const m = mock({ historique: HIST_ANTIGO })
    await acrescentarDocumentos(m.arm, [mk(PERFIL_A, { idDocumento: 'DOC-A' })], opc)
    const antes = m.dados[CHAVE_RUBRICAS]
    m.f.multiSetFalhaAposN = 2
    expect((await rejeita(restaurar(m, { historique: HIST_BACKUP, monSalaire_v2: SALAIRE_BACKUP, [CHAVE_RUBRICAS]: armazem([mk(PERFIL_B, { idDocumento: 'DOC-B' })]) })) instanceof Error)).toBe(true)
    expect(m.dados[CHAVE_RUBRICAS]).toBe(antes)
    expect(m.dados.historique).toBe(HIST_ANTIGO)
  })
  it('se o próprio rollback falha numa chave, fica registado em rollbackFalhou (o erro continua a ser o original)', async () => {
    const m = mock({ historique: HIST_ANTIGO }, { multiSetFalhaAposN: 1, rollbackFalhaEm: 'historique' })
    let erro: unknown
    const logs: string[] = []
    try { await escreverComRollback(m.arm, [['historique', '[]'], ['outra', '1']], { error: (msg, d) => { logs.push(JSON.stringify([msg, d])) } }) } catch (e) { erro = e }
    expect((erro as Error).name).toBe('EscritaParcialFalhou')
    expect((erro as { rollbackFalhou: string[] }).rollbackFalhou).toEqual(['historique'])
    expect(logs.some(l => l.includes('rollback falhou'))).toBe(true)
    expect(logs.join('')).not.toContain('"[]"')   // os valores nunca vão para os logs
  })
  it('sucesso: escreve tudo e não relança nada', async () => {
    const m = mock({ a: '1' })
    await escreverComRollback(m.arm, [['a', '2'], ['b', '3']])
    expect(m.dados).toEqual({ a: '2', b: '3' })
  })
  it('chave que não existia é REMOVIDA no rollback (não fica «null» nem vazia)', async () => {
    const m = mock({}, { multiSetFalhaAposN: 1 })
    expect((await rejeita(escreverComRollback(m.arm, [['nova', 'x'], ['nova2', 'y']])) instanceof Error)).toBe(true)
    expect(Object.keys(m.dados)).toEqual([])
  })
  it('falha de leitura prévia (multiGet) ⇒ nada é escrito e o erro sobe', async () => {
    const m = mock({ a: '1' }, { multiGetFalha: true })
    expect((await rejeita(escreverComRollback(m.arm, [['a', '2']])) instanceof Error)).toBe(true)
    expect(m.dados.a).toBe('1')
  })
})

describe('10b. privacidade no restauro', () => {
  it('os registos do restauro não contêm libellés, montantes nem nomes', async () => {
    const logs: string[] = []
    const reg: RegistoRubricas = { info: (m, d) => { logs.push(JSON.stringify([m, d])) }, warn: (m, d) => { logs.push(JSON.stringify([m, d])) }, error: (m, d) => { logs.push(JSON.stringify([m, d])) } }
    const m = mock({ [CHAVE_RUBRICAS]: '{corrompido' })
    await restaurar(m, { [CHAVE_RUBRICAS]: armazem([mk(PERFIL_A)]) }, reg)
    await restaurar(mock(), { [CHAVE_RUBRICAS]: armazem([mk(PERFIL_A), mk(PERFIL_B)]) }, reg)
    await restaurar(mock(), { [CHAVE_RUBRICAS]: { versao: 1, documentos: [{ x: 'LIBELLE_SECRETO' }] } }, reg)
    const todo = logs.join('\n')
    expect(logs.length).toBeGreaterThan(0)
    for (const segredo of ['LIBELLE_SECRETO', '98765.43', '12345.67', 'Conducteur Fictif A', 'Transports Exemple', '1729']) expect(todo).not.toContain(segredo)
  })
})

describe('guardas ao código real de reglages.tsx (comportamento de reset/clear e integração)', () => {
  const r = ler('app/(tabs)/reglages.tsx')
  const corpo = (nome: string) => {
    const i = r.indexOf(`const ${nome}`)
    if (i < 0) throw new Error(`${nome} não encontrado`)
    const fim = r.indexOf('\n  const ', i + 10)
    return r.slice(i, fim > 0 ? fim : i + 6000)
  }
  it('BACKUP_KEYS inclui CHAVE_RUBRICAS e a importação direta (substituição total) a exclui', () => {
    expect(/const BACKUP_KEYS = \[[^\]]*CHAVE_RUBRICAS/.test(r)).toBe(true)
    expect(/const IMPORT_DIRETO_KEYS = [^\n]*CHAVE_RUBRICAS/.test(r)).toBe(true)
  })
  it('confirmarImport: duas filas pela ordem certa, fusão, escrita atómica com rollback partilhado, sem multiSet em linha', () => {
    const c = corpo('confirmarImport')
    expect(c.includes('comFilaHistorico(() => comFilaRubricas(')).toBe(true)
    expect(c.includes('prepararRestauroRubricas(')).toBe(true)
    expect(c.includes('escreverComRollback(AsyncStorage, todos')).toBe(true)
    expect(c.includes('AsyncStorage.multiSet')).toBe(false)
    expect(c.includes('[key, JSON.stringify(backup.data[key])]')).toBe(true)
  })
  it('«apagar histórico» não toca nas rubricas; «apagar tudo» faz backup silencioso (que lista todas as chaves) antes do clear()', () => {
    const h = corpo('apagaHistorique')
    expect(/rubricas/i.test(h)).toBe(false)
    const t = corpo('apagaTudo')
    const iBackup = t.indexOf('criarBackupSilencioso'), iClear = t.indexOf('AsyncStorage.clear()')
    expect(iBackup).toBeGreaterThan(-1)
    expect(iClear).toBeGreaterThan(iBackup)
    expect(/AsyncStorage\.getAllKeys/.test(r.slice(r.indexOf('criarBackupSilencioso')))).toBe(true)
  })
  it('as linhas de log ligadas às rubricas em reglages.tsx não transportam libellé/montante', () => {
    const linhas = r.split('\n').filter(l => /rubric/i.test(l) && /log\.(info|warn|error)/.test(l))
    expect(linhas.length).toBeGreaterThan(0)
    for (const l of linhas) expect(/libelle|libellé|montant|montante|salaire|nom/i.test(l.replace(/rubricas?:\s*(estadoRub|vRub)[^,}]*/gi, ''))).toBe(false)
  })
  it('o diagnóstico só mostra tamanho/nível da chave, nunca o conteúdo', () => {
    const i = r.indexOf('const rawRub = await AsyncStorage.getItem(CHAVE_RUBRICAS)')
    const bloco = i >= 0 ? r.slice(i, i + 700) : ''
    expect(bloco.length).toBeGreaterThan(0)
    expect(/JSON\.parse|\.documentos|libelle/i.test(bloco)).toBe(false)
  })
  it('o ficheiro escritaComRollback não importa AsyncStorage (injeção) e rubricasStore também não', () => {
    expect(/AsyncStorage/.test(ler('src/utils/escritaComRollback.ts'))).toBe(false)
    expect(/from '@react-native-async-storage/.test(ler('src/utils/rubricasStore.ts'))).toBe(false)
  })
})
