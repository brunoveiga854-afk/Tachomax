// src/utils/rubricasStore.test.ts — Etapa 2D: armazenamento protegido das rubricas (só documentos FICTÍCIOS)
import {
  CHAVE_RUBRICAS, LIMITE_AVISO_BYTES, LIMITE_MAXIMO_BYTES, acrescentarDocumentos, confirmarClassificacao, definirEstadoDocumento, lerRubricas,
  comFilaRubricas, bytesUtf8, nivelTamanho, impressaoConteudo, limparDados, validarArmazem, type ResultadoOperacao, type RegistoRubricas,
} from './rubricasStore'
import { comFilaHistorico } from './filaHistorico'
import { normalizarRespostaExtracao, validarDocumentoRubricas } from './rubricas'
import { prepararExtracaoRubricas } from './extracaoRubricas'
import { PERFIL_A, PERFIL_B, PERFIL_C, montarFicheDetalhada, textoResposta, respostaAPI, type Obj, type PerfilFicticio } from './rubricasFixtures'
import { VERSAO_ESQUEMA_RUBRICAS, type DocumentoRubricas } from '../types/rubricas'

const AGORA = '2026-10-13T10:00:00.000Z'
const opc = { agora: AGORA }

// ───────── armazenamento falso (com atrasos para provocar cruzamentos reais e falhas injetáveis) ─────────
type Falhas = { getFalha?: boolean; setFalha?: boolean; setPerde?: boolean; atraso?: number }
function mock(inicial: Record<string, string> = {}, f: Falhas = {}) {
  const dados: Record<string, string> = { ...inicial }
  const cont = { get: 0, set: 0 }
  const esp = () => new Promise(r => setTimeout(r, f.atraso ?? 2))
  const erro = (nome: string) => Object.assign(new Error('falha simulada'), { name: nome })
  const s = {
    getItem: async (k: string) => { cont.get++; await esp(); if (f.getFalha) throw erro('LeituraFalhou'); return k in dados ? dados[k] : null },
    setItem: async (k: string, v: string) => { cont.set++; await esp(); if (f.setFalha) throw erro('EscritaFalhou'); if (!f.setPerde) dados[k] = v },
  }
  return { s, dados, cont, f, lido: () => (dados[CHAVE_RUBRICAS] ? JSON.parse(dados[CHAVE_RUBRICAS]) as { versao: number; documentos: DocumentoRubricas[] } : null) }
}

// ───────── documentos fictícios (a partir dos perfis da 2C, normalizados pelo módulo da 2A) ─────────
const mk = (p: PerfilFicticio, extra: Obj = {}): DocumentoRubricas => normalizarRespostaExtracao({ ...montarFicheDetalhada(p), ...extra }, opc)
const variante = (p: PerfilFicticio, extra: Obj = {}): DocumentoRubricas =>
  mk({ ...p, linhas: p.linhas.map((l, i) => (i === 0 ? { ...l, montant: 1729.5 } : l)) }, extra)
const sucesso = <T>(r: ResultadoOperacao<T>) => { if (r.estado !== 'ok') throw new Error(`esperava ok, veio ${r.codigo}`); return r }
const erroDe = <T>(r: ResultadoOperacao<T>) => { if (r.estado !== 'erro') throw new Error('esperava erro'); return r }
const espiao = () => { const logs: string[] = []; const reg: RegistoRubricas = { info: (m, d) => { logs.push(JSON.stringify([m, d])) }, warn: (m, d) => { logs.push(JSON.stringify([m, d])) }, error: (m, d) => { logs.push(JSON.stringify([m, d])) } }; return { logs, reg } }

describe('1. guardar e ler documentos', () => {
  it('guarda 3 documentos e lê-os de volta, iguais, na mesma ordem', async () => {
    const m = mock()
    const docs = [mk(PERFIL_A), mk(PERFIL_B), mk(PERFIL_C)]
    const r = sucesso(await acrescentarDocumentos(m.s, docs, opc))
    expect(r.gravou).toBe(true)
    expect(r.valor.adicionados).toBe(3)
    const l = await lerRubricas(m.s)
    if (l.estado !== 'ok') throw new Error('esperava ok')
    expect(l.armazem.versao).toBe(1)
    expect(JSON.stringify(l.armazem.documentos)).toBe(JSON.stringify(docs))
    expect(m.lido()!.documentos.map(d => d.idDocumento)).toEqual(docs.map(d => d.idDocumento))
  })
  it('chave vazia ⇒ estado «vazio» (e é diferente de «corrompido»)', async () => {
    expect((await lerRubricas(mock().s)).estado).toBe('vazio')
  })
  it('a chave é monSalaire_rubricas_v1, separada de monSalaire_v2', async () => {
    const m = mock({ monSalaire_v2: '[]', historique: '[]' })
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A)], opc))
    expect(CHAVE_RUBRICAS).toBe('monSalaire_rubricas_v1')
    expect(m.dados.monSalaire_v2).toBe('[]')
    expect(m.dados.historique).toBe('[]')
  })
  it('entradas inválidas são contadas e NÃO entram (nem se corrigem)', async () => {
    const m = mock()
    const r = sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A), { lixo: true }, null], opc))
    expect(r.valor.adicionados).toBe(1)
    expect(r.valor.invalidos).toBe(2)
    expect(m.lido()!.documentos.length).toBe(1)
  })
})

describe('2. documentos diferentes do mesmo mês coexistem', () => {
  it('mesmo período, conteúdos e ids diferentes ⇒ ambos guardados, sem conflito', async () => {
    const m = mock()
    const curto: PerfilFicticio = { ...PERFIL_A, linhas: PERFIL_A.linhas.slice(0, 6) }
    const a = mk(PERFIL_A), b = mk(curto)
    expect(a.periodoDocumento.texto).toBe(b.periodoDocumento.texto)
    const r = sucesso(await acrescentarDocumentos(m.s, [a, b], opc))
    expect(r.valor.adicionados).toBe(2)
    expect(r.valor.conflitos).toBe(0)
    expect(m.lido()!.documentos.length).toBe(2)
    expect(m.lido()!.documentos.every(d => d.conflito === undefined)).toBe(true)
  })
  it('mesmo mês e hashes diferentes ⇒ documentos diferentes (o mês nunca é identidade)', async () => {
    const m = mock()
    const r = sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'D1', hash: 'H1' }), variante(PERFIL_A, { idDocumento: 'D2', hash: 'H2' })], opc))
    expect(r.valor.adicionados).toBe(2)
    expect(r.valor.conflitos).toBe(0)
  })
})

describe('3. reimportação do mesmo documento', () => {
  it('mesmo documento e conteúdo ⇒ idêntico, NADA é gravado', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A)], opc))
    const antes = m.dados[CHAVE_RUBRICAS], sets = m.cont.set
    const r = sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A)], opc))
    expect(r.valor.identicos).toBe(1)
    expect(r.valor.adicionados).toBe(0)
    expect(r.gravou).toBe(false)
    expect(m.cont.set).toBe(sets)
    expect(m.dados[CHAVE_RUBRICAS]).toBe(antes)
  })
  it('mesmo hash com id diferente e conteúdo igual ⇒ é o mesmo documento (idêntico)', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'X1', hash: 'HASH-1' })], opc))
    const r = sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'X2', hash: 'HASH-1' })], opc))
    expect(r.valor.identicos).toBe(1)
    expect(m.lido()!.documentos.length).toBe(1)
  })
  it('mesmo documento com conteúdo DIFERENTE ⇒ conserva o existente e assinala o conflito (não sobrescreve)', async () => {
    const m = mock()
    const original = mk(PERFIL_A, { idDocumento: 'DOC-A', hash: 'HA' })
    sucesso(await acrescentarDocumentos(m.s, [original], opc))
    const r = sucesso(await acrescentarDocumentos(m.s, [variante(PERFIL_A, { idDocumento: 'DOC-A', hash: 'HA' })], opc))
    expect(r.valor.conflitos).toBe(1)
    const docs = m.lido()!.documentos
    expect(docs.length).toBe(2)
    expect(JSON.stringify(docs[0])).toBe(JSON.stringify(original)) // o existente ficou byte-a-byte igual
    expect(docs[1].idDocumento === 'DOC-A').toBe(false)
    expect(docs[1].conflito!.comIdDocumento).toBe('DOC-A')
    expect(docs[1].conflito!.motivo).toBe('conteudo_diferente')
    expect(docs[1].conflito!.origem).toBe('importacao')
    expect(docs[1].conflito!.detetadoEm).toBe(AGORA)
    expect(docs[1].linhas[0].montante).toBe(1729.5)   // a versão nova ficou guardada, não se perdeu
    expect(docs[0].linhas[0].montante).toBe(1729)
  })
  it('importar OUTRA VEZ a versão em conflito não cria mais variantes', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'DOC-A', hash: 'HA' })], opc))
    sucesso(await acrescentarDocumentos(m.s, [variante(PERFIL_A, { idDocumento: 'DOC-A', hash: 'HA' })], opc))
    const r = sucesso(await acrescentarDocumentos(m.s, [variante(PERFIL_A, { idDocumento: 'DOC-A', hash: 'HA' })], opc))
    expect(r.valor.identicos).toBe(1)
    expect(r.gravou).toBe(false)
    expect(m.lido()!.documentos.length).toBe(2)
  })
  it('nunca se confunde reimportação com «mesmo mês»: duas variantes diferentes geram duas entradas', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'DOC-A' })], opc))
    sucesso(await acrescentarDocumentos(m.s, [variante(PERFIL_A, { idDocumento: 'DOC-A' })], opc))
    const outra = mk({ ...PERFIL_A, linhas: PERFIL_A.linhas.map((l, i) => (i === 1 ? { ...l, quantite: 23 } : l)) }, { idDocumento: 'DOC-A' })
    sucesso(await acrescentarDocumentos(m.s, [outra], opc))
    expect(m.lido()!.documentos.length).toBe(3)
    expect(new Set(m.lido()!.documentos.map(d => d.idDocumento)).size).toBe(3)
  })
})

describe('4. rubricas repetidas dentro da mesma fiche', () => {
  it('as duas linhas «Prime panier» sobrevivem à gravação, com ids distintos e ordem', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_C)], opc))
    const d = m.lido()!.documentos[0]
    const ps = d.linhas.filter(l => l.libelleOriginal === 'Prime panier')
    expect(ps.length).toBe(2)
    expect(ps[0].id === ps[1].id).toBe(false)
    expect(d.linhas.length).toBe(PERFIL_C.linhas.length)
    expect(d.linhas.map(l => l.ordem)).toEqual(PERFIL_C.linhas.map((_, i) => i + 1))
  })
})

describe('5. classificações confirmadas são preservadas', () => {
  const idLinha = (d: DocumentoRubricas, libelle: string) => d.linhas.find(l => l.libelleOriginal === libelle)!.id
  it('o utilizador confirma; uma nova extração automática (sugerida) NÃO a desfaz', async () => {
    const m = mock()
    const doc = mk(PERFIL_A, { idDocumento: 'DOC-A' })
    sucesso(await acrescentarDocumentos(m.s, [doc], opc))
    const lid = idLinha(doc, 'Indemnité de repas')
    expect(doc.linhas.find(l => l.id === lid)!.classificacao.estado).toBe('nao_classificada')
    sucesso(await confirmarClassificacao(m.s, 'DOC-A', lid, { categoria: 'prime' }, opc))
    const c = m.lido()!.documentos[0].linhas.find(l => l.id === lid)!.classificacao
    expect(c.estado).toBe('confirmada'); expect(c.origem).toBe('utilizador'); expect(c.categoria).toBe('prime')
    const r = sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'DOC-A' })], opc))
    expect(r.valor.identicos).toBe(1)
    expect(r.gravou).toBe(false)
    expect(m.lido()!.documentos[0].linhas.find(l => l.id === lid)!.classificacao.estado).toBe('confirmada')
  })
  it('confirmar não toca em nenhum dado documental (libellé, valores, ordem)', async () => {
    const m = mock()
    const doc = mk(PERFIL_B, { idDocumento: 'DOC-B' })
    sucesso(await acrescentarDocumentos(m.s, [doc], opc))
    const antes = m.lido()!.documentos[0]
    sucesso(await confirmarClassificacao(m.s, 'DOC-B', idLinha(doc, 'Subrogation IJSS'), { categoria: 'arret_maladie', subcategoria: 'ijss' }, opc))
    const dep = m.lido()!.documentos[0]
    expect(impressaoConteudo(dep)).toBe(impressaoConteudo(antes))
    expect(dep.linhas.map(l => [l.libelleOriginal, l.montante, l.ordem, l.id])).toEqual(antes.linhas.map(l => [l.libelleOriginal, l.montante, l.ordem, l.id]))
  })
  it('erros explícitos: categoria, documento e linha inexistentes — nada é gravado', async () => {
    const m = mock()
    const doc = mk(PERFIL_A, { idDocumento: 'DOC-A' })
    sucesso(await acrescentarDocumentos(m.s, [doc], opc))
    const sets = m.cont.set
    expect(erroDe(await confirmarClassificacao(m.s, 'DOC-A', doc.linhas[0].id, { categoria: 'xpto' as never }, opc)).codigo).toBe('categoria_invalida')
    expect(erroDe(await confirmarClassificacao(m.s, 'NAO-EXISTE', doc.linhas[0].id, { categoria: 'prime' }, opc)).codigo).toBe('documento_nao_encontrado')
    expect(erroDe(await confirmarClassificacao(m.s, 'DOC-A', 'nao-existe', { categoria: 'prime' }, opc)).codigo).toBe('linha_nao_encontrada')
    expect(m.cont.set).toBe(sets)
  })
})

describe('6. documento editado/confirmado não pode ser sobrescrito', () => {
  it('«editado» + extração automática diferente ⇒ o editado fica intacto; a nova entra como conflito', async () => {
    const m = mock()
    const doc = mk(PERFIL_A, { idDocumento: 'DOC-A', hash: 'HA' })
    sucesso(await acrescentarDocumentos(m.s, [doc], opc))
    const e = sucesso(await definirEstadoDocumento(m.s, 'DOC-A', 'editado', opc))
    expect(e.valor.estado).toBe('editado')
    const guardado = JSON.stringify(m.lido()!.documentos[0])
    const r = sucesso(await acrescentarDocumentos(m.s, [variante(PERFIL_A, { idDocumento: 'DOC-A', hash: 'HA' })], opc))
    expect(r.valor.conflitos).toBe(1)
    expect(JSON.stringify(m.lido()!.documentos[0])).toBe(guardado)
    expect(m.lido()!.documentos[0].estado).toBe('editado')
  })
  it('o estado só sobe: «editado» nunca regride para «confirmado» nem «extraido»', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'DOC-A' })], opc))
    sucesso(await definirEstadoDocumento(m.s, 'DOC-A', 'editado', opc))
    const sets = m.cont.set
    const r = sucesso(await definirEstadoDocumento(m.s, 'DOC-A', 'confirmado', opc))
    expect(r.gravou).toBe(false)
    expect(m.lido()!.documentos[0].estado).toBe('editado')
    expect(m.cont.set).toBe(sets)
    expect(erroDe(await definirEstadoDocumento(m.s, 'NAO-EXISTE', 'confirmado', opc)).codigo).toBe('documento_nao_encontrado')
  })
  it('reimportar o mesmo documento (idêntico) não rebaixa o estado «confirmado»', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_B, { idDocumento: 'DOC-B' })], opc))
    sucesso(await definirEstadoDocumento(m.s, 'DOC-B', 'confirmado', opc))
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_B, { idDocumento: 'DOC-B' })], opc))
    expect(m.lido()!.documentos[0].estado).toBe('confirmado')
  })
})

describe('7. gravações concorrentes', () => {
  it('seis acrescentos simultâneos de documentos diferentes: NENHUM se perde', async () => {
    const m = mock({}, { atraso: 4 })
    const docs = [0, 1, 2, 3, 4, 5].map(i => mk({ ...PERFIL_A, linhas: PERFIL_A.linhas.map((l, k) => (k === 0 ? { ...l, montant: 1000 + i } : l)) }, { idDocumento: `D${i}` }))
    const rs = await Promise.all(docs.map(d => acrescentarDocumentos(m.s, [d], opc)))
    rs.forEach(r => sucesso(r))
    expect(m.lido()!.documentos.map(d => d.idDocumento).sort()).toEqual(['D0', 'D1', 'D2', 'D3', 'D4', 'D5'])
  })
  it('SENSIBILIDADE do teste: sem a fila, o mesmo cenário perderia documentos', async () => {
    const m = mock({}, { atraso: 4 })
    const ingenuo = async (d: DocumentoRubricas) => {
      const l = await lerRubricas(m.s)
      const atual = l.estado === 'ok' ? l.armazem.documentos : []
      await m.s.setItem(CHAVE_RUBRICAS, JSON.stringify({ versao: 1, documentos: [...atual, d] }))
    }
    await Promise.all([0, 1, 2].map(i => ingenuo(mk(PERFIL_A, { idDocumento: `N${i}` }))))
    expect(m.lido()!.documentos.length).toBeLessThan(3)
  })
  it('confirmar uma classificação enquanto outro documento entra: as duas alterações ficam', async () => {
    const m = mock({}, { atraso: 4 })
    const a = mk(PERFIL_A, { idDocumento: 'DOC-A' })
    sucesso(await acrescentarDocumentos(m.s, [a], opc))
    const lid = a.linhas[5].id
    await Promise.all([
      acrescentarDocumentos(m.s, [mk(PERFIL_B, { idDocumento: 'DOC-B' })], opc),
      confirmarClassificacao(m.s, 'DOC-A', lid, { categoria: 'prime' }, opc),
      acrescentarDocumentos(m.s, [mk(PERFIL_C, { idDocumento: 'DOC-C' })], opc),
    ])
    const docs = m.lido()!.documentos
    expect(docs.map(d => d.idDocumento).sort()).toEqual(['DOC-A', 'DOC-B', 'DOC-C'])
    expect(docs.find(d => d.idDocumento === 'DOC-A')!.linhas.find(l => l.id === lid)!.classificacao.estado).toBe('confirmada')
  })
  it('uma operação que falha NÃO bloqueia a fila', async () => {
    const m = mock({}, { atraso: 2 })
    m.f.setFalha = true
    const [r1] = await Promise.all([acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'F1' })], opc)])
    expect(erroDe(r1).codigo).toBe('erro_escrita')
    m.f.setFalha = false
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_B, { idDocumento: 'F2' })], opc))
    expect(m.lido()!.documentos.map(d => d.idDocumento)).toEqual(['F2'])
  })
  it('fila PRÓPRIA: uma tarefa presa na fila do histórico não bloqueia as rubricas (e vice-versa)', async () => {
    const m = mock()
    let libertar: () => void = () => {}
    const presa = comFilaHistorico(() => new Promise<void>(r => { libertar = r }))
    const r = await Promise.race([
      acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'IND' })], opc).then(x => x.estado),
      new Promise<string>(res => setTimeout(() => res('bloqueado'), 300)),
    ])
    expect(r).toBe('ok')
    libertar(); await presa
    let libertar2: () => void = () => {}
    const presa2 = comFilaRubricas(() => new Promise<void>(rr => { libertar2 = rr }))
    const h = await Promise.race([comFilaHistorico(async () => 'livre'), new Promise<string>(res => setTimeout(() => res('bloqueado'), 300))])
    expect(h).toBe('livre')
    libertar2(); await presa2
  })
  it('ordem de aquisição do restauro (histórico → rubricas) não dá impasse', async () => {
    const m = mock()
    const rs = await Promise.all([
      // como em confirmarImport: histórico → rubricas, sem chamar operações do armazém lá dentro (também usam a fila das rubricas)
      comFilaHistorico(() => comFilaRubricas(async () => { await new Promise(r => setTimeout(r, 20)); return 'a' })),
      acrescentarDocumentos(m.s, [mk(PERFIL_B, { idDocumento: 'R2' })], opc).then(() => 'b'),
      comFilaHistorico(async () => 'c'),
    ])
    expect(rs).toEqual(['a', 'b', 'c'])
  })
})

describe('8. erro de leitura', () => {
  it('lerRubricas devolve «erro_leitura» (não «vazio»)', async () => {
    const m = mock({}, { getFalha: true })
    const l = await lerRubricas(m.s)
    expect(l.estado).toBe('erro_leitura')
  })
  it('acrescentar com leitura a falhar ⇒ erro explícito, NADA é gravado', async () => {
    const m = mock({ [CHAVE_RUBRICAS]: JSON.stringify({ versao: 1, documentos: [] }) }, { getFalha: true })
    const r = erroDe(await acrescentarDocumentos(m.s, [mk(PERFIL_A)], opc))
    expect(r.codigo).toBe('erro_leitura')
    expect(m.cont.set).toBe(0)
  })
})

describe('9. erro de escrita', () => {
  it('setItem a falhar ⇒ erro explícito e o valor anterior fica intacto', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'A' })], opc))
    const antes = m.dados[CHAVE_RUBRICAS]
    m.f.setFalha = true
    const r = erroDe(await acrescentarDocumentos(m.s, [mk(PERFIL_B, { idDocumento: 'B' })], opc))
    expect(r.codigo).toBe('erro_escrita')
    expect(m.dados[CHAVE_RUBRICAS]).toBe(antes)
  })
  it('gravação que «resolve» mas não persiste é detetada por releitura (verificacao_falhou), nunca dada como concluída', async () => {
    const m = mock({}, { setPerde: true })
    const r = erroDe(await acrescentarDocumentos(m.s, [mk(PERFIL_A)], opc))
    expect(r.codigo).toBe('verificacao_falhou')
  })
  it('confirmarClassificacao e definirEstadoDocumento também devolvem erro de escrita', async () => {
    const m = mock()
    const d = mk(PERFIL_A, { idDocumento: 'A' })
    sucesso(await acrescentarDocumentos(m.s, [d], opc))
    m.f.setFalha = true
    expect(erroDe(await confirmarClassificacao(m.s, 'A', d.linhas[0].id, { categoria: 'salaire_base' }, opc)).codigo).toBe('erro_escrita')
    expect(erroDe(await definirEstadoDocumento(m.s, 'A', 'editado', opc)).codigo).toBe('erro_escrita')
    expect(m.lido()!.documentos[0].estado).toBe('extraido')
  })
})

describe('10. dados guardados corrompidos', () => {
  const casos: [string, string, string][] = [
    ['JSON ilegível', '{isto não é json', 'armazem_corrompido'],
    ['não é objeto', '[1,2,3]', 'armazem_corrompido'],
    ['documentos não é lista', JSON.stringify({ versao: 1, documentos: 'x' }), 'armazem_corrompido'],
    ['versão inválida', JSON.stringify({ versao: 'um', documentos: [] }), 'armazem_corrompido'],
    ['documento inválido dentro da lista', JSON.stringify({ versao: 1, documentos: [{ idDocumento: 'a' }] }), 'armazem_corrompido'],
    ['versão futura', JSON.stringify({ versao: 2, documentos: [] }), 'versao_futura'],
  ]
  for (const [nome, raw, codigo] of casos) {
    it(`${nome}: recusa gravar, não converte em coleção vazia, valor original intacto`, async () => {
      const m = mock({ [CHAVE_RUBRICAS]: raw })
      const r = erroDe(await acrescentarDocumentos(m.s, [mk(PERFIL_A)], opc))
      expect(r.codigo).toBe(codigo)
      expect(m.dados[CHAVE_RUBRICAS]).toBe(raw)
      expect(m.cont.set).toBe(0)
      expect(erroDe(await confirmarClassificacao(m.s, 'x', 'y', { categoria: 'prime' }, opc)).codigo).toBe(codigo)
      expect(erroDe(await definirEstadoDocumento(m.s, 'x', 'editado', opc)).codigo).toBe(codigo)
      const l = await lerRubricas(m.s)
      expect(l.estado).toBe(codigo === 'versao_futura' ? 'versao_futura' : 'corrompido')
    })
  }
  it('ids de documento duplicados no armazém ⇒ corrompido', () => {
    const d = mk(PERFIL_A, { idDocumento: 'DUP' })
    const v = validarArmazem({ versao: 1, documentos: [d, d] })
    expect(v.estado).toBe('corrompido')
  })
  it('conflito mal formado ⇒ corrompido', () => {
    const d: Obj = JSON.parse(JSON.stringify(mk(PERFIL_A, { idDocumento: 'C1' }))); d.conflito = { semId: true }
    expect(validarArmazem({ versao: 1, documentos: [d] }).estado).toBe('corrompido')
  })
})

describe('14. conflitos de identificadores e documentos', () => {
  it('mesmo hash, id diferente e conteúdo DIFERENTE ⇒ entra como conflito (id novo preservado)', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'X1', hash: 'H' })], opc))
    const r = sucesso(await acrescentarDocumentos(m.s, [variante(PERFIL_A, { idDocumento: 'X2', hash: 'H' })], opc))
    expect(r.valor.conflitos).toBe(1)
    const d = m.lido()!.documentos
    expect(d[1].idDocumento).toBe('X2')
    expect(d[1].conflito!.comIdDocumento).toBe('X1')
  })
  it('id de um documento + hash de OUTRO ⇒ «identificadores_ambiguos», nunca fundido às cegas', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'ID-X', hash: 'H-X' }), mk(PERFIL_B, { idDocumento: 'ID-Y', hash: 'H-Y' })], opc))
    const intruso = variante(PERFIL_C, { idDocumento: 'ID-X', hash: 'H-Y' })
    const r = sucesso(await acrescentarDocumentos(m.s, [intruso], opc))
    expect(r.valor.conflitos).toBe(1)
    const d = m.lido()!.documentos
    expect(d.length).toBe(3)
    expect(d[2].conflito!.motivo).toBe('identificadores_ambiguos')
    expect(d[0].idDocumento).toBe('ID-X'); expect(d[1].idDocumento).toBe('ID-Y')
  })
  it('colisão de ids: a variante recebe um id derivado único (~alt-…), nunca repete um id existente', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'DOC' })], opc))
    sucesso(await acrescentarDocumentos(m.s, [variante(PERFIL_A, { idDocumento: 'DOC' })], opc))
    const outra = mk({ ...PERFIL_A, linhas: PERFIL_A.linhas.map((l, i) => (i === 2 ? { ...l, montant: 1 } : l)) }, { idDocumento: 'DOC' })
    sucesso(await acrescentarDocumentos(m.s, [outra], opc))
    const ids = m.lido()!.documentos.map(d => d.idDocumento)
    expect(new Set(ids).size).toBe(3)
    expect(ids[1].startsWith('DOC~alt-')).toBe(true)
    expect(validarArmazem(m.lido()).estado).toBe('ok')
  })
  it('lote com o mesmo id repetido: o segundo é comparado com o primeiro (idêntico ou conflito)', async () => {
    const m = mock()
    const r = sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'Z' }), mk(PERFIL_A, { idDocumento: 'Z' }), variante(PERFIL_A, { idDocumento: 'Z' })], opc))
    expect(r.valor.adicionados).toBe(1); expect(r.valor.identicos).toBe(1); expect(r.valor.conflitos).toBe(1)
  })
})

describe('16. compatibilidade com as estruturas da Etapa 2A (e 2C)', () => {
  it('o documento guardado é EXATAMENTE o da 2A: nenhum campo acrescentado ao primeiro registo', async () => {
    const m = mock()
    const d = mk(PERFIL_B)
    sucesso(await acrescentarDocumentos(m.s, [d], opc))
    expect(JSON.stringify(m.lido()!.documentos[0])).toBe(JSON.stringify(d))
    expect(m.lido()!.documentos[0].versaoEsquema).toBe(VERSAO_ESQUEMA_RUBRICAS)
    expect(m.lido()!.documentos[0].conflito).toBeUndefined()
    expect(validarDocumentoRubricas(m.lido()!.documentos[0]).filter(p => p.gravidade === 'erro')).toEqual([])
  })
  it('documentos da 2C (com `completude`, linhas parciais e campos desconhecidos) guardam-se e leem-se intactos', async () => {
    const m = mock()
    const t = textoResposta([montarFicheDetalhada(PERFIL_A)])
    const parcial = prepararExtracaoRubricas({ tipo: 'texto', texto: t.slice(0, t.indexOf('"libelle":"Heures supplémentaires 50%"') + 12), stopReason: 'max_tokens' }, opc)
    const completo = prepararExtracaoRubricas({ tipo: 'api', data: respostaAPI(textoResposta([montarFicheDetalhada(PERFIL_C)])) }, opc)
    sucesso(await acrescentarDocumentos(m.s, [...parcial.documentos, ...completo.documentos], opc))
    const l = m.lido()!.documentos
    expect(l[0].completude!.estado).toBe('incompleto')
    expect(l[0].completude!.parcial).toBe(true)
    expect(l[0].linhas.length).toBe(3)
    expect(l[1].completude!.estado).toBe('completo_estrutural')
    expect(l[1].completude!.garantiaLeituraCompleta).toBe(false)
    expect(l[1].desconhecidos.entreprise).toBe(PERFIL_C.legado.entreprise)
    expect(l.every(d => d.linhas.every(x => x.classificacao.estado !== 'confirmada'))).toBe(true)
  })
  it('a fusão não altera os documentos de entrada (congelados)', async () => {
    const m = mock()
    const d = mk(PERFIL_A, { idDocumento: 'CONG' })
    const congelar = (o: unknown): void => { if (o && typeof o === 'object') { Object.values(o as object).forEach(congelar); Object.freeze(o) } }
    congelar(d)
    const antes = JSON.stringify(d)
    sucesso(await acrescentarDocumentos(m.s, [d, variante(PERFIL_A, { idDocumento: 'CONG' })], opc))
    expect(JSON.stringify(d)).toBe(antes)
  })
})

describe('17. dados financeiros não expostos nos logs', () => {
  const SEGREDOS = ['LIBELLE_SECRETO', '98765.43', '12345.67', 'Conducteur Fictif A', 'Transports Exemple', '1729']
  const perfilSecreto: PerfilFicticio = {
    ...PERFIL_A,
    legado: { ...PERFIL_A.legado, netPaye: 12345.67 },
    linhas: [{ libelle: 'LIBELLE_SECRETO_UM', quantite: 3, taux: 2, montant: 98765.43, colonne: 'gain' }, ...PERFIL_A.linhas],
  }
  it('nenhuma operação (sucesso, conflito, erros, corrompido) regista libellés, montantes, nomes ou empresas', async () => {
    const { logs, reg } = espiao()
    const o = { ...opc, registo: reg }
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(perfilSecreto, { idDocumento: 'S1' })], o))
    sucesso(await acrescentarDocumentos(m.s, [mk({ ...perfilSecreto, linhas: perfilSecreto.linhas.slice(1) }, { idDocumento: 'S1' })], o))
    sucesso(await confirmarClassificacao(m.s, 'S1', m.lido()!.documentos[0].linhas[0].id, { categoria: 'prime' }, o))
    m.f.setFalha = true
    await acrescentarDocumentos(m.s, [mk(PERFIL_B, { idDocumento: 'S9' })], o)
    m.f.setFalha = false; m.f.getFalha = true
    await acrescentarDocumentos(m.s, [mk(PERFIL_B, { idDocumento: 'S9' })], o)
    m.f.getFalha = false
    await acrescentarDocumentos(mock({ [CHAVE_RUBRICAS]: 'lixo LIBELLE_SECRETO 98765.43' }).s, [mk(PERFIL_A)], o)
    expect(logs.length).toBeGreaterThan(3)
    const tudo = logs.join('\n')
    for (const s of SEGREDOS) expect(tudo.includes(s)).toBe(false)
  })
  it('o filtro dos logs só deixa passar números, booleanos e códigos curtos sem espaços', () => {
    const d = limparDados({ n: 3, ok: true, codigo: 'conteudo_diferente', texto: 'Salaire de base', montant: '1 234,56', lista: ['a_b', 'x y'], ids: ['a', 'b'], obj: { x: 1 } })!
    expect(d).toEqual({ n: 3, ok: true, codigo: 'conteudo_diferente', ids: ['a', 'b'] })
    expect(limparDados(undefined)).toBeUndefined()
  })
  it('um registo que lança nunca rebenta a operação', async () => {
    const reg: RegistoRubricas = { info: () => { throw new Error('x') }, warn: () => { throw new Error('x') }, error: () => { throw new Error('x') } }
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A)], { ...opc, registo: reg }))
  })
})

describe('18. limites de tamanho do armazenamento', () => {
  const grande = (bytes: number, id: string) => { const d = mk(PERFIL_A, { idDocumento: id }); d.desconhecidos = { enchimento: 'x'.repeat(bytes) }; return d }
  it('bytesUtf8: ASCII, acentos, € e emoji', () => {
    expect(bytesUtf8('abc')).toBe(3)
    expect(bytesUtf8('é')).toBe(2)
    expect(bytesUtf8('€')).toBe(3)
    expect(bytesUtf8('😀')).toBe(4)
    expect(bytesUtf8('Congés payés')).toBe(14)
  })
  it('níveis: ok < aviso < excedido, nos limites exatos', () => {
    expect(nivelTamanho(0)).toBe('ok')
    expect(nivelTamanho(LIMITE_AVISO_BYTES - 1)).toBe('ok')
    expect(nivelTamanho(LIMITE_AVISO_BYTES)).toBe('aviso')
    expect(nivelTamanho(LIMITE_MAXIMO_BYTES)).toBe('aviso')
    expect(nivelTamanho(LIMITE_MAXIMO_BYTES + 1)).toBe('excedido')
    expect(LIMITE_MAXIMO_BYTES).toBeLessThan(2 * 1024 * 1024) // sob o limite de leitura por linha do Android
    expect(LIMITE_AVISO_BYTES).toBeLessThan(LIMITE_MAXIMO_BYTES)
  })
  it('abaixo do aviso: nível «ok»', async () => {
    const m = mock()
    const r = sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A)], opc))
    expect(r.nivel).toBe('ok')
    expect(r.bytes).toBe(bytesUtf8(m.dados[CHAVE_RUBRICAS]))
  })
  it('perto do limite: grava mas sinaliza «aviso» (e regista um aviso)', async () => {
    const { logs, reg } = espiao()
    const m = mock()
    const r = sucesso(await acrescentarDocumentos(m.s, [grande(LIMITE_AVISO_BYTES + 1000, 'G1')], { ...opc, registo: reg }))
    expect(r.nivel).toBe('aviso')
    expect(r.gravou).toBe(true)
    expect(logs.some(l => l.includes('perto do limite'))).toBe(true)
  })
  it('acima do limite seguro: RECUSA, nada é gravado e o conteúdo anterior fica intacto', async () => {
    const m = mock()
    sucesso(await acrescentarDocumentos(m.s, [mk(PERFIL_A, { idDocumento: 'PEQ' })], opc))
    const antes = m.dados[CHAVE_RUBRICAS]
    const r = erroDe(await acrescentarDocumentos(m.s, [grande(LIMITE_MAXIMO_BYTES + 10, 'G2')], opc))
    expect(r.codigo).toBe('limite_tamanho')
    expect(m.dados[CHAVE_RUBRICAS]).toBe(antes)
  })
})
