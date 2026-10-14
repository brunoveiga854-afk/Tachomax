// src/utils/autotesteRubricas.test.ts — autoteste seguro da persistência/restauro 2D (backend FALSO; nenhuma chave real; só dados fictícios)
import * as fs from 'fs'
import * as path from 'path'
import {
  executarAutoteste, executarTesteCapacidade, passosDeCapacidade, formatarRelatorio, criarGuarda, criarArmazenamentoLogico, comFalhas, chaveFisicaValida,
  PASSOS, PREFIXO_TESTE, CHAVES_LOGICAS_PERMITIDAS, CAPACIDADE_AUTORIZADA, LIMITE_CAPACIDADE_BYTES, CHAVE_A, CHAVE_B, CHAVE_TAMANHO,
  type BackendAutoteste, type Passo,
} from './autotesteRubricas'
import { CHAVE_RUBRICAS, LIMITE_AVISO_BYTES } from './rubricasStore'

const RAIZ = path.resolve(__dirname, '..', '..')
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')

// chaves REAIS (fictícias, só para provar que ficam intactas e nunca são acedidas)
const REAIS: Record<string, string> = {
  monSalaire_v2: '[{"sentinela":"v2"}]', historique: '[{"sentinela":"h"}]', frais_regles: '{"sentinela":"fr"}', aprendizagem_padrao: '{"sentinela":"ap"}',
  [CHAVE_RUBRICAS]: JSON.stringify({ versao: 1, documentos: [] }), monSalaire_padrao: 'segredo', consentement_ia_v1: '1',
}
type Op = { op: string; chaves: string[] }
type FalhasBackend = { setFalhaDepoisDe?: number; removeFalha?: boolean; getAllKeysFalha?: boolean; perdeEscritas?: boolean }
function backendFalso(inicial: Record<string, string> = REAIS, f: FalhasBackend = {}) {
  const dados: Record<string, string> = { ...inicial }
  const ops: Op[] = []
  let nSets = 0
  const esp = () => new Promise(r => setTimeout(r, 1))
  const b: BackendAutoteste = {
    getItem: async k => { ops.push({ op: 'getItem', chaves: [k] }); await esp(); return k in dados ? dados[k] : null },
    setItem: async (k, v) => {
      ops.push({ op: 'setItem', chaves: [k] }); await esp(); nSets++
      if (f.setFalhaDepoisDe !== undefined && nSets > f.setFalhaDepoisDe) throw Object.assign(new Error('x'), { name: 'DiscoCheio' })
      if (!f.perdeEscritas) dados[k] = v
    },
    removeItem: async k => { ops.push({ op: 'removeItem', chaves: [k] }); await esp(); if (f.removeFalha) throw Object.assign(new Error('x'), { name: 'RemocaoFalhou' }); delete dados[k] },
    multiGet: async ks => { ops.push({ op: 'multiGet', chaves: [...ks] }); await esp(); return ks.map(k => [k, k in dados ? dados[k] : null] as const) },
    multiSet: async ps => { ops.push({ op: 'multiSet', chaves: ps.map(p => p[0]) }); await esp(); for (const [k, v] of ps) dados[k] = v },
    getAllKeys: async () => { ops.push({ op: 'getAllKeys', chaves: [] }); await esp(); if (f.getAllKeysFalha) throw new Error('x'); return Object.keys(dados) },
  }
  const acessosForaDoEspacoDeTeste = () => ops.filter(o => o.op !== 'getAllKeys' && o.chaves.some(k => !k.startsWith(PREFIXO_TESTE)))
  const teste = () => Object.keys(dados).filter(k => k.startsWith(PREFIXO_TESTE))
  return { b, dados, ops, acessosForaDoEspacoDeTeste, teste, mudarFalhas: (n: FalhasBackend) => Object.assign(f, n) }
}
const reaisIntactas = (dados: Record<string, string>) => Object.keys(REAIS).every(k => dados[k] === REAIS[k])
const espiao = () => { const logs: string[] = []; return { logs, reg: { info: (m: string, d?: Record<string, unknown>) => { logs.push(JSON.stringify([m, d])) }, error: (m: string, d?: Record<string, unknown>) => { logs.push(JSON.stringify([m, d])) } } } }

describe('1. execução completa num backend limpo', () => {
  it('todos os passos passam; estado ok; sem violações; sem resíduos', async () => {
    const m = backendFalso()
    const r = await executarAutoteste({ backend: m.b, idExecucao: 'abc123' })
    expect(r.passos.map(p => p.estado)).toEqual(PASSOS.map(() => 'ok'))
    expect(r.passos.length).toBe(PASSOS.length)
    expect(r.estado).toBe('ok'); expect(r.violacoes).toBe(0); expect(r.chavesTocadas).toBeGreaterThan(0)
    expect(r.limpeza.falhou).toBe(false); expect(r.limpeza.residuosFinais).toBe(0); expect(m.teste()).toEqual([])
  })
  it('cobre os cenários pedidos', () => {
    const ids = PASSOS.map(p => p.id)
    for (const esperado of ['gravar_ler', 'reimportacao_identica', 'conflito', 'concorrencia', 'dados_corrompidos', 'fusao_restauro', 'escrita_falha', 'rollback_total', 'rollback_parcial', 'rollback_falhado'])
      expect(ids.includes(esperado)).toBe(true)
  })
  it('duas execuções seguidas dão o mesmo resultado (idempotente)', async () => {
    const m = backendFalso()
    const r1 = await executarAutoteste({ backend: m.b, idExecucao: 'run1a' })
    const r2 = await executarAutoteste({ backend: m.b, idExecucao: 'run2b' })
    expect(r1.estado).toBe('ok'); expect(r2.estado).toBe('ok'); expect(m.teste()).toEqual([])
  })
})

describe('2. ISOLAMENTO: chaves reais nunca lidas, escritas nem apagadas', () => {
  it('as chaves reais ficam byte a byte iguais e NENHUMA operação de valor lhes toca', async () => {
    const m = backendFalso()
    await executarAutoteste({ backend: m.b, idExecucao: 'iso001' })
    expect(reaisIntactas(m.dados)).toBe(true)
    expect(m.acessosForaDoEspacoDeTeste()).toEqual([])
    expect(m.ops.filter(o => o.op !== 'getAllKeys').every(o => o.chaves.every(k => k.startsWith(PREFIXO_TESTE + 'iso001:')))).toBe(true)
  })
  it('a chave REAL das rubricas nunca é usada: o armazém trabalha numa chave física com prefixo', async () => {
    const m = backendFalso()
    await executarAutoteste({ backend: m.b, idExecucao: 'iso002' })
    expect(m.ops.some(o => o.chaves.includes(CHAVE_RUBRICAS))).toBe(false)
    expect(m.ops.some(o => o.chaves.includes(PREFIXO_TESTE + 'iso002:' + CHAVE_RUBRICAS))).toBe(true)
  })
  it('as únicas leituras de «fora» são getAllKeys (só nomes)', async () => {
    const m = backendFalso()
    await executarAutoteste({ backend: m.b, idExecucao: 'iso003' })
    expect(m.ops.some(o => o.op === 'getAllKeys')).toBe(true)
    expect(m.ops.filter(o => o.op === 'getItem' || o.op === 'multiGet').every(o => o.chaves.every(k => k.startsWith(PREFIXO_TESTE)))).toBe(true)
  })
  it('mesmo com TODAS as falhas simuladas, as chaves reais ficam intactas', async () => {
    const m = backendFalso(REAIS, { setFalhaDepoisDe: 7 })
    const r = await executarAutoteste({ backend: m.b, idExecucao: 'iso004' })
    expect(r.passos.some(p => p.estado === 'falhou')).toBe(true)
    expect(reaisIntactas(m.dados)).toBe(true); expect(m.acessosForaDoEspacoDeTeste()).toEqual([])
  })
  it('o prefixo vem sempre de __teste2d__: e nunca coincide com as chaves reais', () => {
    for (const k of Object.keys(REAIS)) expect(chaveFisicaValida(k)).toBe(false)
    expect(PREFIXO_TESTE).toBe('__teste2d__:')
  })
})

describe('3. camada 3 — guarda de baixo nível (protege mesmo com erro de implementação nas outras)', () => {
  it('chave sem prefixo é recusada em TODAS as operações e o backend nem é chamado', async () => {
    const m = backendFalso(); const g = criarGuarda(m.b)
    for (const k of ['monSalaire_v2', 'historique', 'frais_regles', 'aprendizagem_padrao', CHAVE_RUBRICAS, '', 'teste2d', '__teste2d__', '__teste2d_:x', 'x__teste2d__:y']) {
      for (const f of [() => g.getItem(k), () => g.setItem(k, 'v'), () => g.removeItem(k), () => g.multiGet([k]), () => g.multiSet([[k, 'v']])]) {
        let nome = ''; try { await f() } catch (e) { nome = (e as Error).name }
        expect(nome).toBe('ViolacaoIsolamento')
      }
    }
    expect(m.ops.length).toBe(0); expect(reaisIntactas(m.dados)).toBe(true)
    expect(g.violacoes()).toBe(10 * 5)
  })
  it('lote com UMA chave inválida: nada é enviado ao backend (nem as válidas)', async () => {
    const m = backendFalso(); const g = criarGuarda(m.b)
    let nome = ''; try { await g.multiSet([[PREFIXO_TESTE + 'ok:a', '1'], ['monSalaire_v2', 'X']]) } catch (e) { nome = (e as Error).name }
    expect(nome).toBe('ViolacaoIsolamento'); expect(m.ops.length).toBe(0)
    nome = ''; try { await g.multiGet([PREFIXO_TESTE + 'ok:a', 'historique']) } catch (e) { nome = (e as Error).name }
    expect(nome).toBe('ViolacaoIsolamento'); expect(m.ops.length).toBe(0)
  })
  it('caracteres perigosos / vazios depois do prefixo são recusados', () => {
    for (const k of [PREFIXO_TESTE, PREFIXO_TESTE + '../x', PREFIXO_TESTE + 'a/b', PREFIXO_TESTE + 'a b', PREFIXO_TESTE + '\n', PREFIXO_TESTE + 'x'.repeat(200), null, undefined, 5, {}])
      expect(chaveFisicaValida(k)).toBe(false)
    expect(chaveFisicaValida(PREFIXO_TESTE + 'abc123:autoteste_a')).toBe(true)
  })
  it('getAllKeys devolve só chaves de teste; removerChavesDeTeste remove só essas', async () => {
    const m = backendFalso({ ...REAIS, [PREFIXO_TESTE + 'velha:autoteste_a']: '1', [PREFIXO_TESTE + 'velha:' + CHAVE_RUBRICAS]: '2' })
    const g = criarGuarda(m.b)
    expect([...(await g.getAllKeys())].sort()).toEqual([PREFIXO_TESTE + 'velha:' + CHAVE_RUBRICAS, PREFIXO_TESTE + 'velha:autoteste_a'].sort())
    const r = await g.removerChavesDeTeste()
    expect(r).toEqual({ removidas: 2, falhas: 0 }); expect(reaisIntactas(m.dados)).toBe(true); expect(m.teste()).toEqual([])
  })
})

describe('4. camadas 1-2 — nomes lógicos fechados + prefixo', () => {
  it('nomes reais lançam ViolacaoIsolamento e o backend nunca é tocado', async () => {
    const m = backendFalso(); const arm = criarArmazenamentoLogico(criarGuarda(m.b), PREFIXO_TESTE + 'x1:')
    for (const k of ['monSalaire_v2', 'historique', 'frais_regles', 'aprendizagem_padrao', 'monSalaire_padrao']) {
      for (const f of [() => arm.getItem(k), () => arm.setItem(k, 'v'), () => arm.removeItem(k), () => arm.multiGet([k]), () => arm.multiSet([[k, 'v']])]) {
        let nome = ''; try { await f() } catch (e) { nome = (e as Error).name }
        expect(nome).toBe('ViolacaoIsolamento')
      }
    }
    expect(m.ops.length).toBe(0)
  })
  it('os nomes permitidos são os 5 esperados e mapeiam sempre para o prefixo da execução', async () => {
    expect([...CHAVES_LOGICAS_PERMITIDAS].sort()).toEqual([CHAVE_RUBRICAS, 'autoteste_a', 'autoteste_b', 'autoteste_bruta', 'autoteste_tamanho'].sort())
    const m = backendFalso({}); const arm = criarArmazenamentoLogico(criarGuarda(m.b), PREFIXO_TESTE + 'x2:')
    await arm.setItem(CHAVE_A, '1'); await arm.multiSet([[CHAVE_B, '2']])
    expect(Object.keys(m.dados).sort()).toEqual([PREFIXO_TESTE + 'x2:' + CHAVE_A, PREFIXO_TESTE + 'x2:' + CHAVE_B].sort())
    const mg = await arm.multiGet([CHAVE_A, CHAVE_B, CHAVE_TAMANHO])
    expect(mg.map(x => x[0])).toEqual([CHAVE_A, CHAVE_B, CHAVE_TAMANHO]); expect(mg[2][1]).toBeNull()
  })
  it('MUTAÇÃO: se alguém «esquecer» o prefixo e abrir um nome real, a GUARDA trava (camada 3) — nada real é tocado', async () => {
    const m = backendFalso(); const g = criarGuarda(m.b)
    const defeituoso = criarArmazenamentoLogico(g, '', [...CHAVES_LOGICAS_PERMITIDAS, 'monSalaire_v2', 'historique'])
    let nome = ''; try { await defeituoso.setItem('monSalaire_v2', 'LIXO') } catch (e) { nome = (e as Error).name }
    expect(nome).toBe('ViolacaoIsolamento'); expect(g.violacoes()).toBe(1)
    nome = ''; try { await defeituoso.getItem('historique') } catch (e) { nome = (e as Error).name }
    expect(nome).toBe('ViolacaoIsolamento')
    expect(m.ops.length).toBe(0); expect(reaisIntactas(m.dados)).toBe(true)
  })
  it('um passo malicioso/defeituoso que tente uma chave real aborta a execução com «violacao_isolamento» e não toca em nada', async () => {
    const m = backendFalso()
    const ruim: Passo = { id: 'ruim', rotulo: 'Mauvais', fn: async ({ arm }) => { await arm.setItem('monSalaire_v2', 'LIXO') } }
    const seguinte: Passo = { id: 'nao_devia_correr', rotulo: 'Suivant', fn: async () => { throw { falhaPasso: 'correu' } } }
    const r = await executarAutoteste({ backend: m.b, idExecucao: 'viol01', passos: [ruim, seguinte] })
    expect(r.estado).toBe('violacao_isolamento'); expect(r.passos.length).toBe(1); expect(r.passos[0].codigo).toBe('violacao_isolamento'); expect(r.violacoes).toBeGreaterThan(0)
    expect(reaisIntactas(m.dados)).toBe(true); expect(m.acessosForaDoEspacoDeTeste()).toEqual([])
  })
})

describe('5. limpeza das chaves temporárias', () => {
  it('no início remove SÓ as chaves __teste2d__: de execuções interrompidas, e nenhuma outra parecida', async () => {
    const parecidas = { '__teste2d__': 'a', 'teste2d:x': 'b', '__teste2d_:x': 'c', 'x__teste2d__:y': 'd' }
    const m = backendFalso({ ...REAIS, ...parecidas, [PREFIXO_TESTE + 'morta:autoteste_a']: '1', [PREFIXO_TESTE + 'morta:autoteste_tamanho']: 'x'.repeat(1000), [PREFIXO_TESTE + 'morta:' + CHAVE_RUBRICAS]: '{}' })
    const r = await executarAutoteste({ backend: m.b, idExecucao: 'limp01' })
    expect(r.limpeza.residuosAnteriores).toBe(3); expect(r.estado).toBe('ok')
    expect(m.teste()).toEqual([])
    for (const [k, v] of Object.entries(parecidas)) expect(m.dados[k]).toBe(v)
    expect(reaisIntactas(m.dados)).toBe(true)
  })
  it('um passo que lança no meio NÃO deixa resíduos (limpeza no finally) e as chaves reais ficam intactas', async () => {
    const m = backendFalso()
    const lixo: Passo = { id: 'lixo', rotulo: 'Déchets', fn: async ({ arm }) => { await arm.setItem(CHAVE_A, 'x'); await arm.setItem(CHAVE_TAMANHO, 'y'.repeat(5000)); throw new Error('rebentou') } }
    const r = await executarAutoteste({ backend: m.b, idExecucao: 'limp02', passos: [lixo] })
    expect(r.estado).toBe('falhou'); expect(r.passos[0].codigo).toBe('excecao'); expect(r.limpeza.removidasNoFim).toBe(2)
    expect(m.teste()).toEqual([]); expect(reaisIntactas(m.dados)).toBe(true)
  })
  it('limpeza que falha é assinalada (não escondida); a execução seguinte limpa o que ficou', async () => {
    const m = backendFalso(REAIS, { removeFalha: true })
    const r1 = await executarAutoteste({ backend: m.b, idExecucao: 'limp03' })
    expect(r1.limpeza.falhou).toBe(true); expect(r1.limpeza.residuosFinais).toBeGreaterThan(0)
    expect(formatarRelatorio(r1).some(l => l.startsWith('⚠️'))).toBe(true)
    m.mudarFalhas({ removeFalha: false })
    const r2 = await executarAutoteste({ backend: m.b, idExecucao: 'limp04' })
    expect(r2.limpeza.residuosAnteriores).toBeGreaterThan(0); expect(r2.limpeza.falhou).toBe(false); expect(m.teste()).toEqual([])
    expect(reaisIntactas(m.dados)).toBe(true)
  })
  it('getAllKeys a falhar: não lança; limpeza assinalada como falhada; chaves reais intactas', async () => {
    const m = backendFalso(REAIS, { getAllKeysFalha: true })
    const r = await executarAutoteste({ backend: m.b, idExecucao: 'limp05' })
    expect(r.limpeza.falhou).toBe(true); expect(reaisIntactas(m.dados)).toBe(true)
  })
})

describe('6. deteção de problemas reais (o autoteste não pode dizer «tudo OK» quando não está)', () => {
  it('armazenamento que perde escritas ⇒ passos falham', async () => {
    const m = backendFalso(REAIS, { perdeEscritas: true })
    const r = await executarAutoteste({ backend: m.b, idExecucao: 'det001' })
    expect(r.estado).toBe('falhou'); expect(r.passos.filter(p => p.estado === 'falhou').length).toBeGreaterThan(3)
  })
  it('disco cheio a meio ⇒ falha assinalada com código, sem lançar', async () => {
    const m = backendFalso(REAIS, { setFalhaDepoisDe: 3 })
    const r = await executarAutoteste({ backend: m.b, idExecucao: 'det002' })
    expect(r.estado).toBe('falhou'); expect(r.passos.some(p => p.estado === 'falhou' && typeof p.codigo === 'string')).toBe(true)
  })
  it('comFalhas: cada tipo de falha comporta-se como descrito', async () => {
    const m = backendFalso({}); const base = criarArmazenamentoLogico(criarGuarda(m.b), PREFIXO_TESTE + 'f1:')
    let n = ''
    try { await comFalhas(base, { setFalha: true }).setItem(CHAVE_A, '1') } catch (e) { n = (e as Error).name }
    expect(n).toBe('EscritaSimulada'); expect(await base.getItem(CHAVE_A)).toBeNull()
    await comFalhas(base, { setPerde: true }).setItem(CHAVE_A, '1'); expect(await base.getItem(CHAVE_A)).toBeNull()
    n = ''; try { await comFalhas(base, { getFalha: true }).getItem(CHAVE_A) } catch (e) { n = (e as Error).name }
    expect(n).toBe('LeituraSimulada')
    n = ''; try { await comFalhas(base, { multiSetFalhaAposN: 1 }).multiSet([[CHAVE_A, '1'], [CHAVE_B, '2']]) } catch (e) { n = (e as Error).name }
    expect(n).toBe('EscritaParcialSimulada'); expect(await base.getItem(CHAVE_A)).toBe('1'); expect(await base.getItem(CHAVE_B)).toBeNull()
    n = ''; try { await comFalhas(base, { removeFalhaEm: CHAVE_A }).removeItem(CHAVE_A) } catch (e) { n = (e as Error).name }
    expect(n).toBe('RemocaoSimulada')
  })
})

describe('7. execução simultânea e privacidade', () => {
  it('uma segunda execução ao mesmo tempo devolve «ocupado» sem tocar em nada; depois volta a funcionar', async () => {
    const m = backendFalso()
    const p1 = executarAutoteste({ backend: m.b, idExecucao: 'conc01' })
    const r2 = await executarAutoteste({ backend: m.b, idExecucao: 'conc02' })
    expect(r2.estado).toBe('ocupado'); expect(r2.passos).toEqual([])
    expect((await p1).estado).toBe('ok')
    expect((await executarAutoteste({ backend: m.b, idExecucao: 'conc03' })).estado).toBe('ok')
  })
  it('relatório, registos e texto do diagnóstico não contêm dados (nem documentos fictícios, nem chaves)', async () => {
    const { logs, reg } = espiao(); const m = backendFalso()
    const r = await executarAutoteste({ backend: m.b, idExecucao: 'priv01', registo: reg })
    const falho = await executarAutoteste({ backend: backendFalso(REAIS, { setFalhaDepoisDe: 5 }).b, idExecucao: 'priv02', registo: reg })
    const tudo = JSON.stringify(r) + JSON.stringify(falho) + logs.join('\n') + formatarRelatorio(r).join('\n') + formatarRelatorio(falho).join('\n')
    expect(logs.length).toBeGreaterThan(0)
    for (const s of ['AUTOTESTE', 'ligne', 'Janvier', '__teste2d__', 'monSalaire', 'historique', 'segredo', 'sentinela', 'x'.repeat(50)]) expect(tudo.includes(s)).toBe(false)
  })
  it('formatarRelatorio: uma linha por passo + limpeza + isolamento + resultado', async () => {
    const r = await executarAutoteste({ backend: backendFalso().b, idExecucao: 'fmt001' })
    const l = formatarRelatorio(r)
    expect(l.length).toBe(PASSOS.length + 3); expect(l[l.length - 1].startsWith('✅')).toBe(true)
    expect(l.slice(0, PASSOS.length).every(x => x.startsWith('✅'))).toBe(true)
  })
  it('um registo que lança nunca quebra o autoteste', async () => {
    const reg = { info: () => { throw new Error('x') }, error: () => { throw new Error('x') } }
    expect((await executarAutoteste({ backend: backendFalso().b, idExecucao: 'reg001', registo: reg })).estado).toBe('ok')
  })
})

describe('8. teste de capacidade: DESATIVADO por omissão (precisa de aprovação posterior)', () => {
  it('a constante de autorização é false e a função pública não faz NENHUMA operação no backend', async () => {
    expect(CAPACIDADE_AUTORIZADA).toBe(false)
    const m = backendFalso()
    const r = await executarTesteCapacidade({ backend: m.b })
    expect(r.estado).toBe('desativado'); expect(r.codigo).toBe('capacidade_nao_autorizada'); expect(m.ops.length).toBe(0)
  })
  it('o teto conservador é o limite de aviso do armazém (nunca o máximo)', () => { expect(LIMITE_CAPACIDADE_BYTES).toBe(LIMITE_AVISO_BYTES) })
  it('passosDeCapacidade (interno) recusa tamanhos acima do teto e limpa a chave de teste', async () => {
    const m = backendFalso({}); const arm = criarArmazenamentoLogico(criarGuarda(m.b), PREFIXO_TESTE + 'cap1:')
    const ok = await passosDeCapacidade(arm, [1000, 5000]); expect(ok).toEqual({ estado: 'ok', codigo: null, maiorTamanhoOk: 5000 })
    const acima = await passosDeCapacidade(arm, [1000, LIMITE_CAPACIDADE_BYTES + 1]); expect(acima.estado).toBe('falhou'); expect(acima.maiorTamanhoOk).toBe(1000)
    expect(m.teste()).toEqual([])
  })
  it('o teste de 256 Ko corre automaticamente no autoteste normal e está muito abaixo de qualquer limite', () => {
    expect(256 * 1024 < LIMITE_AVISO_BYTES / 4).toBe(true)
  })
})

describe('9. isolamento do código: o módulo e a app', () => {
  const src = ler('src/utils/autotesteRubricas.ts')
  const codigo = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  it('o módulo não menciona as chaves reais, nem AsyncStorage, nem rede', () => {
    for (const proibido of ['monSalaire_v2', 'historique', 'frais_regles', 'aprendizagem_padrao', 'monSalaire_padrao', 'AsyncStorage', 'fetch(', 'expo-', 'react', 'SecureStore']) expect(codigo.includes(proibido)).toBe(false)
  })
  it('importa apenas armazém, rollback e normalizador', () => {
    const imports = Array.from(src.matchAll(/from '([^']+)'/g)).map(x => x[1]).sort()
    expect(imports).toEqual(['../types/rubricas', './escritaComRollback', './rubricas', './rubricasStore'])
  })
  it('só o reglages.tsx importa o autoteste; fiche.tsx, proxy, aprendizagem, frais e motor não', () => {
    const listar = (dir: string, out: string[] = []): string[] => {
      for (const nome of fs.readdirSync(path.join(RAIZ, dir))) {
        if (nome === 'node_modules' || nome.startsWith('.')) continue
        const rel = `${dir}/${nome}`
        if (fs.statSync(path.join(RAIZ, rel)).isDirectory()) listar(rel, out); else if (/\.(ts|tsx)$/.test(nome)) out.push(rel)
      }
      return out
    }
    const quem = [...listar('app'), ...listar('src')].filter(f => !/autotesteRubricas/.test(f)).filter(f => /autotesteRubricas['"]/.test(ler(f)))
    expect(quem).toEqual(['app/(tabs)/reglages.tsx'])
    for (const f of ['app/(tabs)/fiche.tsx', 'netlify/functions/anthropic-proxy.js', 'src/engine/aprendizagem.ts']) expect(/autotesteRubricas|executarAutoteste/.test(ler(f))).toBe(false)
  })
  const r = ler('app/(tabs)/reglages.tsx')
  const bloco = (() => { const i = r.indexOf('const executarAutotesteRubricas'); if (i < 0) return ''; const fim = r.indexOf('\n  const ', i + 10); return r.slice(i, fim > 0 ? fim : i + 3000) })()
  it('reglages.tsx: botão discreto com o texto pedido, que chama executarAutoteste com o AsyncStorage', () => {
    expect(r.includes('Tester le stockage des rubriques')).toBe(true)
    expect(bloco.length).toBeGreaterThan(0)
    expect(bloco.includes('executarAutoteste(')).toBe(true); expect(bloco.includes('backend: AsyncStorage')).toBe(true)
  })
  it('o handler do botão não faz restauro, backup, apagar nem toca em chaves: só chama o autoteste', () => {
    for (const proibido of ['confirmarImport', 'criarBackup', 'multiSet', 'multiRemove', 'removeItem', 'setItem', 'getItem', 'clear(', 'executarTesteCapacidade', 'passosDeCapacidade']) expect(bloco.includes(proibido)).toBe(false)
  })
  it('backup/restauro inalterados: BACKUP_KEYS, importação direta e bloco de restauro iguais ao da 2D', () => {
    expect(/const BACKUP_KEYS = \[[^\]]*CHAVE_RUBRICAS/.test(r)).toBe(true)
    expect(/const IMPORT_DIRETO_KEYS = [^\n]*CHAVE_RUBRICAS/.test(r)).toBe(true)
    expect(r.includes('comFilaHistorico(() => comFilaRubricas(')).toBe(true)
    expect(r.includes('escreverComRollback(AsyncStorage, todos')).toBe(true)
  })
})
