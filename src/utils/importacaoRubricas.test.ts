// src/utils/importacaoRubricas.test.ts — Etapa 2E/E1: adaptador puro da extração detalhada (só ficheiros e respostas FICTÍCIOS; sem rede)
import * as fs from 'fs'
import * as path from 'path'
import {
  importarRubricasDeFicheiros, associarFicheirosAoLegado, resumirMedicoes, acrescentarMedicao, LIMITE_BASE64_FICHEIRO,
  type DependenciasImportacao, type EntradaImportacao, type FicheiroParaRubricas, type MedicaoExtracao, type ResultadoImportacao,
} from './importacaoRubricas'
import { CHAVE_RUBRICAS, lerRubricas, confirmarClassificacao, definirEstadoDocumento, type RegistoRubricas } from './rubricasStore'
import type { TentativaDetalhada } from './extracaoRubricas'
import type { PedidoProxy } from './promptRubricas'
import { MAX_TOKENS_DETALHADO } from './promptRubricas'
import { identidadeFicheiro } from './identidadeFicheiro'
import { montarFicheDetalhada, textoResposta, respostaAPI, PERFIL_A, PERFIL_B, PERFIL_C, type Obj, type PerfilFicticio } from './rubricasFixtures'
import type { DocumentoRubricas } from '../types/rubricas'

const RAIZ = path.resolve(__dirname, '..', '..')
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')
const AGORA = '2026-10-14T10:00:00.000Z'

// ───────── armazenamento falso (atrasos + falhas injetáveis) ─────────
type Falhas = { getFalha?: boolean; setFalha?: boolean }
function mock(inicial: Record<string, string> = {}, f: Falhas = {}) {
  const dados: Record<string, string> = { ...inicial }
  const cont = { get: 0, set: 0 }
  const esp = () => new Promise(r => setTimeout(r, 2))
  const s = {
    getItem: async (k: string) => { cont.get++; await esp(); if (f.getFalha) throw Object.assign(new Error('x'), { name: 'LeituraFalhou' }); return k in dados ? dados[k] : null },
    setItem: async (k: string, v: string) => { cont.set++; await esp(); if (f.setFalha) throw Object.assign(new Error('x'), { name: 'EscritaFalhou' }); dados[k] = v },
  }
  return { s, dados, cont, f, docs: () => (dados[CHAVE_RUBRICAS] ? (JSON.parse(dados[CHAVE_RUBRICAS]).documentos as DocumentoRubricas[]) : []) }
}

// ───────── ficheiros e respostas fictícios ─────────
const ficheiro = (tag: string, mime = 'application/pdf'): FicheiroParaRubricas => ({ base64: `FICT-${tag}-` + 'QUJD'.repeat(64), mimeType: mime })
const resposta = (p: PerfilFicticio, o: { stop?: string | null; extra?: Obj; tokens?: number } = {}): TentativaDetalhada => {
  const d = respostaAPI(textoResposta([{ ...montarFicheDetalhada(p), ...(o.extra ?? {}) }]), o.stop === undefined ? 'end_turn' : o.stop) as Obj
  if (o.tokens !== undefined) d.usage = { input_tokens: 900, output_tokens: o.tokens }
  return { tipo: 'api', data: d }
}
const variante = (p: PerfilFicticio): PerfilFicticio => ({ ...p, linhas: p.linhas.map((l, i) => (i === 0 ? { ...l, montant: 1729.5 } : l)) })
const legadoDe = (p: PerfilFicticio, extra: Obj = {}): Obj => ({ ...p.legado, ...extra })

type Chamada = { pedido: PedidoProxy; indice: number }
type Preparo = {
  /** resposta por conteúdo do ficheiro (tag) */
  respostas?: Record<string, TentativaDetalhada | (() => Promise<TentativaDetalhada>)>
  ms?: Record<string, number>
}
function montar(m: ReturnType<typeof mock>, preparo: Preparo = {}, registo?: RegistoRubricas) {
  const chamadas: Chamada[] = []
  let relogio = 0
  const deps: DependenciasImportacao = {
    armazem: m.s,
    agora: () => relogio,
    agoraISO: () => AGORA,
    registo,
    chamar: async (pedido, ctx) => {
      chamadas.push({ pedido, indice: ctx.indice })
      const bloco = pedido.messages[0].content[0] as { source: { data: string } }
      const tag = /^FICT-([^-]+)-/.exec(bloco.source.data)![1]
      relogio += preparo.ms?.[tag] ?? 1500
      const r = preparo.respostas?.[tag]
      if (r === undefined) return { tipo: 'erro', categoria: 'outro' }
      return typeof r === 'function' ? r() : r
    },
  }
  return { deps, chamadas, relogio: () => relogio }
}
const entrada = (ficheiros: FicheiroParaRubricas[], extra: Partial<EntradaImportacao> = {}): EntradaImportacao =>
  ({ ativo: true, consentimentoIA: true, ficheiros, legado: null, ...extra })
const espiao = () => { const logs: string[] = []; const reg: RegistoRubricas = { info: (m, d) => { logs.push(JSON.stringify([m, d])) }, warn: (m, d) => { logs.push(JSON.stringify([m, d])) }, error: (m, d) => { logs.push(JSON.stringify([m, d])) } }; return { logs, reg } }
const deepFreeze = <T>(o: T): T => { if (o && typeof o === 'object') { Object.freeze(o); for (const k of Object.keys(o as object)) deepFreeze((o as Record<string, unknown>)[k]) } return o }
const estados = (r: ResultadoImportacao) => r.ficheiros.map(f => f.estado)
const codigos = (r: ResultadoImportacao) => r.ficheiros.map(f => f.codigo)

describe('1. condições: desativado, sem consentimento, entrada inválida (nenhuma chamada, nenhuma gravação)', () => {
  it('ativo=false ⇒ «desativado»', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')], { ativo: false }), c.deps)
    expect(r.estado).toBe('desativado'); expect(c.chamadas.length).toBe(0); expect(m.cont.set + m.cont.get).toBe(0)
  })
  it('sem consentimento IA ⇒ «sem_consentimento», nada é enviado', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')], { consentimentoIA: false }), c.deps)
    expect(r.estado).toBe('sem_consentimento'); expect(c.chamadas.length).toBe(0); expect(m.cont.set + m.cont.get).toBe(0)
  })
  it('ativo/consentimento têm de ser EXATAMENTE true (truthy não chega)', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r1 = await importarRubricasDeFicheiros({ ...entrada([ficheiro('A')]), ativo: 1 as unknown as boolean }, c.deps)
    const r2 = await importarRubricasDeFicheiros({ ...entrada([ficheiro('A')]), consentimentoIA: 'sim' as unknown as boolean }, c.deps)
    expect(r1.estado).toBe('desativado'); expect(r2.estado).toBe('sem_consentimento'); expect(c.chamadas.length).toBe(0)
  })
  it('entrada inválida nunca lança', async () => {
    const m = mock(); const c = montar(m)
    expect((await importarRubricasDeFicheiros(null as unknown as EntradaImportacao, c.deps)).estado).toBe('entrada_invalida')
    expect((await importarRubricasDeFicheiros({ ativo: true, consentimentoIA: true } as unknown as EntradaImportacao, c.deps)).estado).toBe('entrada_invalida')
  })
  it('lista vazia ⇒ concluído sem fazer nada', async () => {
    const m = mock(); const c = montar(m)
    const r = await importarRubricasDeFicheiros(entrada([]), c.deps)
    expect(r.estado).toBe('concluido'); expect(c.chamadas.length).toBe(0)
  })
})

describe('2. caminho feliz: um ficheiro', () => {
  it('guarda UM documento «extraido», com a identidade do ficheiro como hash, sem nada confirmado', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A, { tokens: 2100 }) } })
    const f = ficheiro('A')
    const r = await importarRubricasDeFicheiros(entrada([f], { legado: [legadoDe(PERFIL_A)] }), c.deps)
    expect(r.estado).toBe('concluido'); expect(estados(r)).toEqual(['guardado'])
    const docs = m.docs()
    expect(docs.length).toBe(1)
    expect(docs[0].estado).toBe('extraido')
    expect(docs[0].hashDocumento).toBe(identidadeFicheiro(f.base64)!.id)
    expect(docs[0].origemId).toBe('hash_documento')
    expect(docs[0].linhas.length).toBeGreaterThan(5)
    for (const l of docs[0].linhas) {
      expect(l.classificacao.estado === 'confirmada' || l.classificacao.estado === 'rejeitada').toBe(false)
      expect(l.classificacao.origem).not.toBe('utilizador')
    }
    expect(r.ficheiros[0].associacao!.estado).toBe('certa')
    expect(r.ficheiros[0].verificacao).toBe('coincide')
    expect(r.ficheiros[0].idDocumento).toBe(docs[0].idDocumento)
  })
  it('o id do documento depende do FICHEIRO (não do mês nem da ordem) e é estável entre importações', async () => {
    const m1 = mock(), m2 = mock()
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m1, { respostas: { A: resposta(PERFIL_A) } }).deps)
    await importarRubricasDeFicheiros(entrada([ficheiro('Z'), ficheiro('A')]), montar(m2, { respostas: { A: resposta(PERFIL_A), Z: resposta(PERFIL_B) } }).deps)
    const idA1 = m1.docs()[0].idDocumento
    const idA2 = m2.docs().find(d => d.periodoDocumento.mes === 2)!.idDocumento
    expect(idA1).toBe(idA2)
  })
  it('«net payé» diferente do legado ⇒ verificação «diverge» (só o código, sem valores)', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')], { legado: [legadoDe(PERFIL_A, { netPaye: 1000 })] }), c.deps)
    expect(r.ficheiros[0].verificacao).toBe('diverge')
    expect(estados(r)).toEqual(['guardado'])   // a divergência é só diagnóstico: nada é corrigido nem bloqueado
  })
  it('sem legado: associação «indeterminada» (motivo sem_legado), guarda na mesma por parecer uma fiche', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')], { legado: null }), c.deps)
    expect(r.ficheiros[0].associacao).toEqual({ estado: 'indeterminada', motivo: 'sem_legado', indiceLegado: null, tipoLegado: null })
    expect(r.ficheiros[0].verificacao).toBe('nao_comparavel')
    expect(estados(r)).toEqual(['guardado'])
  })
})

describe('3. o pedido: um ficheiro por pedido, formato do fluxo atual', () => {
  it('N ficheiros ⇒ N pedidos, cada um com UM ficheiro, 4000 tokens, tipos PDF/imagem como no legado', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A), B: resposta(PERFIL_B), C: resposta(PERFIL_C) } })
    await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B', 'image/png'), ficheiro('C', 'image/jpeg')]), c.deps)
    expect(c.chamadas.length).toBe(3)
    for (const ch of c.chamadas) {
      const blocos = ch.pedido.messages[0].content.filter(b => b.type === 'document' || b.type === 'image')
      expect(blocos.length).toBe(1)
      expect(ch.pedido.max_tokens).toBe(MAX_TOKENS_DETALHADO)
      expect(ch.pedido.model).toBe('claude-sonnet-4-6')
    }
    expect(c.chamadas.map(x => x.pedido.messages[0].content[0].type)).toEqual(['document', 'image', 'image'])
    expect((c.chamadas[1].pedido.messages[0].content[0] as { source: { media_type: string } }).source.media_type).toBe('image/jpeg')
  })
  it('ficheiro acima do limite do fluxo atual não é enviado', async () => {
    const m = mock(); const c = montar(m)
    const grande: FicheiroParaRubricas = { base64: 'FICT-G-' + 'x'.repeat(LIMITE_BASE64_FICHEIRO), mimeType: 'application/pdf' }
    const r = await importarRubricasDeFicheiros(entrada([grande]), c.deps)
    expect(codigos(r)).toEqual(['demasiado_grande']); expect(c.chamadas.length).toBe(0)
  })
  it('ficheiros inválidos (vazio, sem base64) são ignorados sem chamar', async () => {
    const m = mock(); const c = montar(m)
    const r = await importarRubricasDeFicheiros(entrada([{ base64: '' }, {} as FicheiroParaRubricas, null as unknown as FicheiroParaRubricas]), c.deps)
    expect(codigos(r)).toEqual(['ficheiro_invalido', 'ficheiro_invalido', 'ficheiro_invalido']); expect(c.chamadas.length).toBe(0)
  })
  it('o MESMO ficheiro duas vezes no lote ⇒ uma só chamada (poupa custo) e a segunda fica «duplicado_no_lote»', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('A')]), c.deps)
    expect(c.chamadas.length).toBe(1); expect(codigos(r)).toEqual(['guardado', 'duplicado_no_lote']); expect(m.docs().length).toBe(1)
  })
})

describe('4. associação ficheiro ↔ legado: nunca pela ordem', () => {
  it('legado em ORDEM INVERSA: cada documento liga-se ao legado do MESMO período (não ao mesmo índice)', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A), B: resposta(PERFIL_B), C: resposta(PERFIL_C) } })
    const legado = [legadoDe(PERFIL_C), legadoDe(PERFIL_B), legadoDe(PERFIL_A)]
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B'), ficheiro('C')], { legado }), c.deps)
    expect(r.ficheiros.map(f => f.associacao!.indiceLegado)).toEqual([2, 1, 0])
    expect(r.ficheiros.map(f => f.associacao!.estado)).toEqual(['provavel', 'provavel', 'provavel'])
    expect(r.ficheiros.map(f => f.verificacao)).toEqual(['coincide', 'coincide', 'coincide'])
  })
  it('legado com menos documentos (um colapsado) ⇒ só associa onde o período é único', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A), B: resposta(PERFIL_B) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B')], { legado: [legadoDe(PERFIL_B)] }), c.deps)
    expect(r.ficheiros[0].associacao).toEqual({ estado: 'indeterminada', motivo: 'sem_correspondencia', indiceLegado: null, tipoLegado: null })
    expect(r.ficheiros[1].associacao!.estado).toBe('provavel')
  })
  it('duas fiches do MESMO mês ⇒ associação «indeterminada» (periodo_ambiguo); ambas são guardadas, sem se confundirem', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A), V: resposta(variante(PERFIL_A)) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('V')], { legado: [legadoDe(PERFIL_A)] }), c.deps)
    expect(r.ficheiros.map(f => f.associacao!.motivo)).toEqual(['periodo_ambiguo', 'periodo_ambiguo'])
    expect(r.ficheiros.map(f => f.associacao!.estado)).toEqual(['indeterminada', 'indeterminada'])
    expect(estados(r)).toEqual(['guardado', 'guardado'])
    expect(m.docs().length).toBe(2)
    expect(m.docs()[0].idDocumento === m.docs()[1].idDocumento).toBe(false)
  })
  it('associarFicheirosAoLegado: função pura; 1 ficheiro + 1 legado ⇒ «certa»; mais ficheiros ⇒ nunca «certa»', () => {
    expect(associarFicheirosAoLegado([{ mes: 2, ano: 2026 }], 1, [legadoDe(PERFIL_A)])[0].estado).toBe('certa')
    const dois = associarFicheirosAoLegado([{ mes: 2, ano: 2026 }, { mes: 5, ano: 2026 }], 2, [legadoDe(PERFIL_A), legadoDe(PERFIL_B)])
    expect(dois.map(a => a.estado)).toEqual(['provavel', 'provavel'])
    expect(associarFicheirosAoLegado([{ mes: null, ano: null }], 2, [legadoDe(PERFIL_A), legadoDe(PERFIL_B)])[0].motivo).toBe('periodo_ilegivel')
  })
  it('a ordem do legado nunca influencia: permutar o legado dá as mesmas associações por período', () => {
    const v2 = [{ mes: 2, ano: 2026 }, { mes: 5, ano: 2026 }, { mes: 8, ano: 2026 }]
    const L = [legadoDe(PERFIL_A), legadoDe(PERFIL_B), legadoDe(PERFIL_C)]
    const perms = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [1, 0, 2]]
    for (const p of perms) {
      const leg = p.map(i => L[i])
      const a = associarFicheirosAoLegado(v2, 3, leg)
      a.forEach((x, k) => expect(leg[x.indiceLegado!]).toBe(L[k]))
    }
  })
  it('legado aceita a forma {tipo, moisIndex, annee, dados:{netPaye}} (DocumentoAnalysado)', () => {
    const doc = { tipo: 'fiche', periode: 'Mars 2026', moisIndex: 2, annee: 2026, dados: { netPaye: 2310.45 } }
    expect(associarFicheirosAoLegado([{ mes: 2, ano: 2026 }], 2, [doc, { tipo: 'fiche', moisIndex: 4, annee: 2026 }])[0].estado).toBe('provavel')
  })
})

describe('5. salário e frais separados', () => {
  it('documento que o legado classificou como «frais» ⇒ não é guardado como rubricas', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A), B: resposta(PERFIL_B) } })
    const legado = [legadoDe(PERFIL_A), { ...legadoDe(PERFIL_B), tipo: 'frais' }]
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B')], { legado }), c.deps)
    expect(codigos(r)).toEqual(['guardado', 'ignorado_frais']); expect(m.docs().length).toBe(1)
  })
  it('associação indeterminada e documento SEM totais de fiche ⇒ «ignorado_tipo_incerto»', async () => {
    const semTotais = { ...PERFIL_A, totaux: {} }
    const m = mock(); const c = montar(m, { respostas: { A: resposta(semTotais) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')], { legado: null }), c.deps)
    expect(codigos(r)).toEqual(['ignorado_tipo_incerto']); expect(m.docs().length).toBe(0)
  })
  it('nunca escreve fora do armazém das rubricas', async () => {
    const m = mock({ monSalaire_v2: '[1]', historique: '[2]', frais_regles: '{}' }); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(Object.keys(m.dados).sort()).toEqual(['frais_regles', 'historique', 'monSalaire_rubricas_v1', 'monSalaire_v2'])
    expect(m.dados.monSalaire_v2).toBe('[1]'); expect(m.dados.historique).toBe('[2]'); expect(m.dados.frais_regles).toBe('{}')
  })
})

describe('6. falhas da extração detalhada: visíveis por código, nunca bloqueiam nem lançam', () => {
  const casos: [string, TentativaDetalhada | (() => Promise<TentativaDetalhada>), string][] = [
    ['rede', { tipo: 'erro', categoria: 'rede' }, 'erro_rede'],
    ['timeout do cliente', { tipo: 'erro', categoria: 'timeout' }, 'erro_timeout'],
    ['HTTP 500', { tipo: 'erro', categoria: 'http', status: 500 }, 'erro_http'],
    ['HTTP 401', { tipo: 'erro', categoria: 'http', status: 401 }, 'erro_http_sem_alternativa'],
    ['HTTP 413', { tipo: 'erro', categoria: 'http', status: 413 }, 'erro_http_sem_alternativa'],
    ['sem conteúdo', { tipo: 'erro', categoria: 'sem_conteudo' }, 'erro_sem_conteudo'],
    ['exceção na chamada', () => Promise.reject(new Error('LIBELLE_SECRETO')), 'excecao_chamada'],
  ]
  for (const [nome, resp, codigo] of casos) {
    it(`${nome} ⇒ «falhou» (${codigo}); nada é guardado; o ficheiro seguinte continua`, async () => {
      const m = mock(); const c = montar(m, { respostas: { A: resp, B: resposta(PERFIL_B) } })
      const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B')]), c.deps)
      expect(r.ficheiros[0].estado).toBe('falhou'); expect(r.ficheiros[0].codigo).toBe(codigo)
      expect(r.ficheiros[1].estado).toBe('guardado')
      expect(r.estado).toBe('parcial'); expect(r.codigos).toContain(codigo)
      expect(m.docs().length).toBe(1)
    })
  }
  it('todos falham ⇒ «falhou», lista de códigos para o diagnóstico', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: { tipo: 'erro', categoria: 'rede' }, B: { tipo: 'erro', categoria: 'timeout' } } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B')]), c.deps)
    expect(r.estado).toBe('falhou'); expect(r.codigos).toEqual(['erro_rede', 'erro_timeout'])
  })
  it('timeout do ADAPTADOR (chamada que nunca responde) ⇒ «timeout_adaptador» e a resposta tardia é ignorada', async () => {
    const m = mock(); let tarde: (t: TentativaDetalhada) => void = () => {}
    const c = montar(m, { respostas: { A: () => new Promise<TentativaDetalhada>(res => { tarde = res }) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')], { limiteMsPorFicheiro: 30 }), c.deps)
    expect(codigos(r)).toEqual(['timeout_adaptador'])
    tarde(resposta(PERFIL_A)); await new Promise(res => setTimeout(res, 30))
    expect(m.docs().length).toBe(0); expect(m.cont.set).toBe(0)
  })
  it('resposta truncada (JSON cortado + max_tokens) ⇒ NÃO guardada; fica registada como truncada e incompleta', async () => {
    const texto = textoResposta([montarFicheDetalhada(PERFIL_A)]); const cortado = texto.slice(0, Math.floor(texto.length * 0.6))
    const m = mock(); const c = montar(m, { respostas: { A: { tipo: 'api', data: respostaAPI(cortado, 'max_tokens') } } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(r.ficheiros[0].estado).toBe('nao_guardado'); expect(r.ficheiros[0].medicao!.truncada).toBe(true)
    expect(r.ficheiros[0].completude).toBe('incompleto'); expect(m.docs().length).toBe(0); expect(m.cont.set).toBe(0)
  })
  it('JSON perfeito mas stop_reason=max_tokens ⇒ não guardada', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A, { stop: 'max_tokens' }) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(r.ficheiros[0].estado).toBe('nao_guardado'); expect(m.docs().length).toBe(0)
  })
  it('resposta no formato ANTIGO (sem lignes) ⇒ não guardada', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: { tipo: 'api', data: respostaAPI(textoResposta([montarFicheDetalhada(PERFIL_A, { semDetalhe: true })])) } } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(r.ficheiros[0].estado).toBe('nao_guardado'); expect(m.docs().length).toBe(0)
  })
  it('resposta com DOIS documentos para um só ficheiro ⇒ nada guardado (não se sabe a quem pertence cada um)', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: { tipo: 'api', data: respostaAPI(textoResposta([montarFicheDetalhada(PERFIL_A), montarFicheDetalhada(PERFIL_B)])) } } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(codigos(r)).toEqual(['varios_documentos_numa_resposta']); expect(m.docs().length).toBe(0)
  })
  it('lixo que não é JSON ⇒ não guardado, sem lançar', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: { tipo: 'api', data: respostaAPI('isto não é json') } } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(r.ficheiros[0].estado === 'nao_guardado' || r.ficheiros[0].estado === 'falhou').toBe(true); expect(m.docs().length).toBe(0)
  })
})

describe('7. falhas do ARMAZÉM: assinaladas, sem lançar', () => {
  it('leitura a falhar ⇒ armazem_erro_leitura', async () => {
    const m = mock({}, { getFalha: true }); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(r.ficheiros[0].estado).toBe('falhou'); expect(r.ficheiros[0].codigo).toBe('armazem_erro_leitura'); expect(m.cont.set).toBe(0)
  })
  it('escrita a falhar ⇒ armazem_erro_escrita; nada fica a meio', async () => {
    const m = mock({}, { setFalha: true }); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(r.ficheiros[0].codigo).toBe('armazem_erro_escrita'); expect(m.docs().length).toBe(0); expect(r.estado).toBe('falhou')
  })
  it('armazém corrompido ⇒ não é tocado nem convertido em vazio', async () => {
    const m = mock({ [CHAVE_RUBRICAS]: '{corrompido' }); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(r.ficheiros[0].estado).toBe('falhou'); expect(m.dados[CHAVE_RUBRICAS]).toBe('{corrompido')
  })
  it('exceção do armazém ⇒ «excecao_armazem»', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    c.deps.armazem = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } } as never
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(r.ficheiros[0].estado).toBe('falhou')
  })
})

describe('8. reimportações e conflitos', () => {
  it('reimportar o mesmo ficheiro com a mesma leitura ⇒ «identico»; o armazém não muda (nem um byte, nem uma escrita)', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    const antes = m.dados[CHAVE_RUBRICAS]; const sets = m.cont.set
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(estados(r)).toEqual(['identico']); expect(m.dados[CHAVE_RUBRICAS]).toBe(antes); expect(m.cont.set).toBe(sets)
  })
  it('mesmo ficheiro, leitura DIFERENTE da IA ⇒ «conflito»: o existente fica, a nova entra como alternativa assinalada', async () => {
    const m = mock(); const c1 = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c1.deps)
    const original = JSON.stringify(m.docs()[0])
    const c2 = montar(m, { respostas: { A: resposta(variante(PERFIL_A)) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c2.deps)
    expect(estados(r)).toEqual(['conflito']); expect(m.docs().length).toBe(2)
    expect(JSON.stringify(m.docs()[0])).toBe(original)
    expect(m.docs()[1].conflito!.comIdDocumento).toBe(m.docs()[0].idDocumento)
    expect(r.estado).toBe('concluido')
  })
  it('reimportar uma 3.ª vez a mesma leitura em conflito não cria mais variantes', async () => {
    const m = mock()
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(PERFIL_A) } }).deps)
    for (let i = 0; i < 3; i++) await importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(variante(PERFIL_A)) } }).deps)
    expect(m.docs().length).toBe(2)
  })
  it('classificação CONFIRMADA e estado «editado» sobrevivem a reimportações (idênticas ou diferentes)', async () => {
    const m = mock()
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(PERFIL_A) } }).deps)
    const d = m.docs()[0]
    expect((await confirmarClassificacao(m.s, d.idDocumento, d.linhas[0].id, { categoria: 'salaire_base' }, { agora: AGORA })).estado).toBe('ok')
    expect((await definirEstadoDocumento(m.s, d.idDocumento, 'editado', { agora: AGORA })).estado).toBe('ok')
    const congelado = JSON.stringify(m.docs()[0])
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(PERFIL_A) } }).deps)
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(variante(PERFIL_A)) } }).deps)
    expect(JSON.stringify(m.docs()[0])).toBe(congelado)
    expect(m.docs()[0].estado).toBe('editado'); expect(m.docs()[0].linhas[0].classificacao.estado).toBe('confirmada')
  })
  it('mesma fiche fotografada duas vezes (bytes diferentes) ⇒ dois documentos distintos, nunca fundidos pelo mês', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A), B: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B')]), c.deps)
    expect(m.docs().length).toBe(2); expect(estados(r)).toEqual(['guardado', 'guardado'])
  })
  it('importação de outro mês não toca no que já existe', async () => {
    const m = mock()
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(PERFIL_A) } }).deps)
    const a = JSON.stringify(m.docs()[0])
    await importarRubricasDeFicheiros(entrada([ficheiro('B')]), montar(m, { respostas: { B: resposta(PERFIL_B) } }).deps)
    expect(m.docs().length).toBe(2); expect(JSON.stringify(m.docs()[0])).toBe(a)
  })
})

describe('9. cancelamento', () => {
  it('cancelado ANTES de começar ⇒ nenhuma chamada, nenhuma gravação', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')], { sinal: { aborted: true } }), c.deps)
    expect(r.estado).toBe('cancelado'); expect(c.chamadas.length).toBe(0); expect(m.cont.set + m.cont.get).toBe(0)
  })
  it('cancelado DURANTE a chamada ⇒ resposta descartada e nada gravado; os ficheiros seguintes nem são pedidos', async () => {
    const sinal = { aborted: false }; const m = mock()
    const c = montar(m, { respostas: { A: async () => { sinal.aborted = true; return resposta(PERFIL_A) }, B: resposta(PERFIL_B) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B')], { sinal }), c.deps)
    expect(r.estado).toBe('cancelado'); expect(c.chamadas.length).toBe(1)
    expect(codigos(r)).toEqual(['cancelado_apos_chamada', 'cancelado_antes_da_chamada']); expect(m.docs().length).toBe(0); expect(m.cont.set).toBe(0)
  })
  it('cancelado ENTRE a extração e a gravação ⇒ nada é gravado', async () => {
    const sinal = { aborted: false }; const m = mock()
    const c = montar(m, { respostas: { A: resposta(PERFIL_A), B: async () => { sinal.aborted = true; return resposta(PERFIL_B) } } })
    // B cancela durante a sua chamada ⇒ a fase de gravação já não começa
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B')], { sinal }), c.deps)
    expect(r.estado).toBe('cancelado'); expect(m.docs().length).toBe(0)
    expect(r.ficheiros[0].estado).toBe('cancelado'); expect(r.ficheiros[0].codigo).toBe('cancelado_antes_de_gravar')
  })
})

describe('10. concorrência', () => {
  it('duas importações simultâneas de ficheiros diferentes: ambos os documentos ficam', async () => {
    const m = mock()
    const [r1, r2] = await Promise.all([
      importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(PERFIL_A) } }).deps),
      importarRubricasDeFicheiros(entrada([ficheiro('B')]), montar(m, { respostas: { B: resposta(PERFIL_B) } }).deps),
    ])
    expect(estados(r1)).toEqual(['guardado']); expect(estados(r2)).toEqual(['guardado']); expect(m.docs().length).toBe(2)
  })
  it('duas importações simultâneas do MESMO ficheiro: um só documento (a outra fica «identico»)', async () => {
    const m = mock()
    const [r1, r2] = await Promise.all([
      importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(PERFIL_A) } }).deps),
      importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(PERFIL_A) } }).deps),
    ])
    expect(m.docs().length).toBe(1); expect([...estados(r1), ...estados(r2)].sort()).toEqual(['guardado', 'identico'])
  })
  it('importações em simultâneo com o armazém ocupado não se bloqueiam entre si (cinco em paralelo)', async () => {
    const m = mock(); const tags = ['A', 'B', 'C', 'D', 'E']
    const perfis = [PERFIL_A, PERFIL_B, PERFIL_C, variante(PERFIL_A), variante(PERFIL_B)]
    await Promise.all(tags.map((t, i) => importarRubricasDeFicheiros(entrada([ficheiro(t)]), montar(m, { respostas: { [t]: resposta(perfis[i]) } }).deps)))
    expect(m.docs().length).toBe(5)
  })
})

describe('11. o fluxo legado não é tocado', () => {
  it('entrada profundamente congelada (ficheiros + legado): nada é alterado e nada lança', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const legado = deepFreeze([legadoDe(PERFIL_A)]); const fs_ = deepFreeze([ficheiro('A')]); const e = deepFreeze(entrada(fs_ as FicheiroParaRubricas[], { legado }))
    const antes = JSON.stringify([legado, fs_])
    const r = await importarRubricasDeFicheiros(e, c.deps)
    expect(estados(r)).toEqual(['guardado']); expect(JSON.stringify([legado, fs_])).toBe(antes)
  })
  it('o resultado não devolve campos legados nem valores financeiros para o fluxo salarial', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')], { legado: [legadoDe(PERFIL_A)] }), c.deps)
    const txt = JSON.stringify(r)
    for (const proibido of ['netPaye', 'salairebrut', 'hbase', 'remboursementFrais', '2310.45', '3010.2', 'Salaire de base']) expect(txt.includes(proibido)).toBe(false)
  })
})

describe('12. medições de latência, tamanho e fiabilidade', () => {
  it('regista duração (relógio injetado), tokens, tamanho, linhas e stop_reason por ficheiro', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A, { tokens: 2100 }), B: resposta(PERFIL_B, { tokens: 3300 }) }, ms: { A: 12000, B: 31000 } })
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B')]), c.deps)
    expect(r.medicoes.map(x => x.duracaoMs)).toEqual([12000, 31000])
    expect(r.medicoes.map(x => x.tokensSaida)).toEqual([2100, 3300]); expect(r.medicoes[0].tokensEntrada).toBe(900)
    expect(r.medicoes[0].stopReason).toBe('end_turn'); expect(r.medicoes[0].nLinhas).toBe(PERFIL_A.linhas.length)
    expect(r.medicoes[0].tamanhoBase64).toBe(ficheiro('A').base64.length)
  })
  const med = (ms: number, resultado = 'estrutura_verificada', extra: Partial<MedicaoExtracao> = {}): MedicaoExtracao =>
    ({ indice: 0, duracaoMs: ms, resultado, categoriaErro: null, status: null, tokensEntrada: 1, tokensSaida: 1000, stopReason: 'end_turn', tamanhoBase64: 1000, nLinhas: 10, truncada: false, ...extra })
  it('resumirMedicoes: percentis, faixas SEM assumir o limite real, taxa de falhas e truncagem', () => {
    const lista = [4000, 9000, 20000, 28000, 45000, 70000].map(ms => med(ms))
    lista.push(med(500, 'erro_timeout', { duracaoMs: 30000, tokensSaida: null, stopReason: null }), med(15000, 'extracao_incompleta', { truncada: true, stopReason: 'max_tokens' }))
    const s = resumirMedicoes(lista)
    expect(s.n).toBe(8); expect(s.truncadas).toBe(1); expect(s.falhas).toEqual({ erro_timeout: 1, extracao_incompleta: 1 })
    expect(s.faixas).toEqual({ ate5s: 1, ate10s: 1, ate26s: 2, ate30s: 2, ate60s: 1, acima60s: 1 })
    expect(s.duracaoMs.min).toBe(4000); expect(s.duracaoMs.max).toBe(70000); expect(s.duracaoMs.p50).toBe(20000); expect(s.duracaoMs.p95).toBe(70000)
    expect(s.comResposta).toBe(7)
  })
  it('resumirMedicoes([]) não rebenta', () => {
    const s = resumirMedicoes([])
    expect(s.n).toBe(0); expect(s.duracaoMs.p50).toBeNull(); expect(s.tokensSaidaMedia).toBeNull()
  })
  it('acrescentarMedicao: pura e limitada (as mais antigas saem)', () => {
    let l: MedicaoExtracao[] = []; const orig = l
    for (let i = 0; i < 7; i++) l = acrescentarMedicao(l, med(i), 5)
    expect(orig.length).toBe(0); expect(l.length).toBe(5); expect(l.map(x => x.duracaoMs)).toEqual([2, 3, 4, 5, 6])
  })
})

describe('13. privacidade: nem o resultado nem os logs expõem dados', () => {
  it('logs e resultado sem libellés, nomes, empresa nem valores (inclui um erro com texto sensível)', async () => {
    const { logs, reg } = espiao(); const m = mock()
    const c = montar(m, { respostas: { A: resposta(PERFIL_A), B: () => Promise.reject(new Error('LIBELLE_SECRETO 98765.43')), C: resposta(variante(PERFIL_C)) } }, reg)
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A'), ficheiro('B'), ficheiro('C')], { legado: [legadoDe(PERFIL_A), legadoDe(PERFIL_C)] }), c.deps)
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), montar(m, { respostas: { A: resposta(variante(PERFIL_A)) } }, reg).deps)
    expect(logs.length).toBeGreaterThan(0)
    const tudo = logs.join('\n') + JSON.stringify(r)
    for (const s of ['LIBELLE_SECRETO', '98765.43', 'Conducteur Fictif A', 'Transports Exemple', 'Salaire de base', '2310.45', '3010.2', '1729.5', '271.7', "Heures d'équivalence"]) expect(tudo.includes(s)).toBe(false)
  })
  it('um registo que lança nunca quebra a importação', async () => {
    const reg: RegistoRubricas = { info: () => { throw new Error('x') }, warn: () => { throw new Error('x') }, error: () => { throw new Error('x') } }
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } }, reg)
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(estados(r)).toEqual(['guardado'])
  })
  it('chamar() a lançar de forma síncrona ou assíncrona nunca propaga', async () => {
    const m = mock(); const c = montar(m)
    c.deps.chamar = (() => { throw new Error('sync') }) as never
    const r = await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    expect(codigos(r)).toEqual(['excecao_chamada'])
  })
})

describe('14. isolamento (E1): módulo puro, não ligado à app', () => {
  const src = ler('src/utils/importacaoRubricas.ts')
  const importa = (s: string) => Array.from(s.matchAll(/from '([^']+)'/g)).map(x => x[1])
  it('importa apenas módulos puros de rubricas', () => {
    expect(importa(src).sort()).toEqual(['../types/rubricas', './completudeRubricas', './extracaoRubricas', './identidadeFicheiro', './promptRubricas', './rubricasStore'])
  })
  it('sem rede, sem AsyncStorage, sem React, sem referências à app', () => {
    const codigo = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    for (const proibido of ['AsyncStorage', 'fetch(', 'react', 'expo-', 'fiche.tsx', 'reglages', 'monSalaire_v2', 'historique', 'aprendizagem', 'XMLHttpRequest', 'frais_regles']) expect(codigo.includes(proibido)).toBe(false)
  })
  it('nenhum ficheiro da app ou do motor importa o adaptador nem a identidade de ficheiro', () => {
    const listar = (dir: string, out: string[] = []): string[] => {
      for (const nome of fs.readdirSync(path.join(RAIZ, dir))) {
        if (nome === 'node_modules' || nome.startsWith('.')) continue
        const rel = `${dir}/${nome}`
        if (fs.statSync(path.join(RAIZ, rel)).isDirectory()) listar(rel, out); else if (/\.(ts|tsx)$/.test(nome)) out.push(rel)
      }
      return out
    }
    const quem = [...listar('app'), ...listar('src')].filter(f => !/importacaoRubricas|identidadeFicheiro/.test(f)).filter(f => /(importacaoRubricas|identidadeFicheiro)['"]/.test(ler(f)))
    expect(quem).toEqual([])
  })
  it('fiche.tsx, reglages.tsx e o proxy não conhecem o adaptador', () => {
    for (const f of ['app/(tabs)/fiche.tsx', 'app/(tabs)/reglages.tsx', 'netlify/functions/anthropic-proxy.js', 'netlify/lib/validarPedido.js']) {
      const s = ler(f); expect(/importacaoRubricas|identidadeFicheiro|importarRubricasDeFicheiros/.test(s)).toBe(false)
    }
  })
  it('o armazém lido de volta é válido (estado «ok») depois de uma importação', async () => {
    const m = mock(); const c = montar(m, { respostas: { A: resposta(PERFIL_A) } })
    await importarRubricasDeFicheiros(entrada([ficheiro('A')]), c.deps)
    const l = await lerRubricas(m.s); expect(l.estado).toBe('ok')
  })
})
