// src/utils/gravarServico.test.ts
import { gravarServico, eliminarServicoGravado, alterarServicoGravado, atualizarHistorico, type ArmazenamentoHistorico } from './gravarServico'
import { comFilaHistorico } from './filaHistorico'
import type { ServicoReg } from './diasServicos'

const srv = (id: string, debut: string, fin: string, seg: number, extra: Partial<ServicoReg> = {}): ServicoReg =>
  ({ id, date: '12/10/2026', jour: 'Lun', type: 'TRAB', debut, fin, segServico: seg, segPausa: 0, decouche: false, frais: 0, ...extra })
const H = 3600

function armazem(inicial?: unknown, atrasoMs = 0) {
  const dados: Record<string, string> = {}
  if (inicial !== undefined) dados.historique = typeof inicial === 'string' ? inicial : JSON.stringify(inicial)
  const escritas: string[] = []
  const s: ArmazenamentoHistorico = {
    getItem: async k => { if (atrasoMs) await new Promise(r => setTimeout(r, atrasoMs)); return k in dados ? dados[k] : null },
    setItem: async (k, v) => { if (atrasoMs) await new Promise(r => setTimeout(r, atrasoMs)); escritas.push(k); dados[k] = v },
  }
  return { s, dados, escritas, lido: () => JSON.parse(dados.historique) as ServicoReg[] }
}

describe('gravarServico — nunca substitui', () => {
  it('2.º serviço do dia: os dois ficam no histórico e o 1.º está byte a byte igual', async () => {
    const primeiro = srv('1', '05h00', '11h00', 6 * H, { frais: 20.78, kmDiarios: 300, nota: { texto: 'x' } })
    const a = armazem([primeiro])
    const r = await gravarServico(a.s, srv('2', '14h00', '18h00', 4 * H))
    expect(r.estado).toBe('ok')
    const lido = a.lido()
    expect(lido.map(x => x.id)).toEqual(['2', '1'])
    expect(JSON.stringify(lido[1])).toBe(JSON.stringify(primeiro))
  })
  it('3 serviços sequenciais no mesmo dia', async () => {
    const a = armazem([])
    await gravarServico(a.s, srv('1', '05h00', '09h00', 4 * H))
    await gravarServico(a.s, srv('2', '11h00', '15h00', 4 * H))
    await gravarServico(a.s, srv('3', '18h00', '21h00', 3 * H))
    expect(a.lido().map(x => x.id)).toEqual(['3', '2', '1'])
  })
  it('regravar o mesmo serviço não duplica nem reescreve se nada mudou', async () => {
    const s1 = srv('1', '05h00', '11h00', 6 * H)
    const a = armazem([s1])
    const r = await gravarServico(a.s, { ...s1 })
    expect(r.estado === 'ok' && r.acao).toBe('mesmo_servico')
    expect(a.lido()).toHaveLength(1)
    expect(a.escritas).toEqual([])
  })
  it('ambíguo sem resolução: NADA é escrito', async () => {
    const a = armazem([srv('1', '05h00', '11h00', 6 * H)])
    const r = await gravarServico(a.s, srv('9', '05h00', '12h00', 7 * H))
    expect(r.estado).toBe('ambiguo')
    expect(a.escritas).toEqual([])
    expect(a.lido()).toHaveLength(1)
  })
  it('resolução «manter_ambos» e «substituir» (com arquivo antes de remover)', async () => {
    const original = srv('1', '05h00', '11h00', 6 * H)
    const a1 = armazem([original])
    const r1 = await gravarServico(a1.s, srv('9', '05h00', '12h00', 7 * H), { resolucao: 'manter_ambos' })
    expect(r1.estado).toBe('ok'); expect(a1.lido()).toHaveLength(2)

    const a2 = armazem([original])
    const arquivados: ServicoReg[] = []
    const ordem: string[] = []
    const r2 = await gravarServico(a2.s, srv('9', '05h00', '12h00', 7 * H), {
      resolucao: 'substituir',
      arquivar: async rem => { ordem.push('arquivar'); arquivados.push(...rem) },
    })
    expect(r2.estado).toBe('ok')
    expect(a2.lido().map(x => x.id)).toEqual(['9'])
    expect(arquivados).toEqual([original])
    expect(ordem).toEqual(['arquivar'])
  })
  it('dia só com «repos»: arquivado antes de ser substituído pelo serviço', async () => {
    const repos = { ...srv('0', '', '', 0), type: 'RC' } as ServicoReg
    const a = armazem([repos])
    const arquivados: ServicoReg[] = []
    const r = await gravarServico(a.s, srv('1', '06h00', '10h00', 4 * H), { arquivar: async rem => { arquivados.push(...rem) } })
    expect(r.estado).toBe('ok')
    expect(arquivados).toEqual([repos])
    expect(a.lido().map(x => x.id)).toEqual(['1'])
  })
  it('«repos» num dia com serviços nunca é resolvido por substituição', async () => {
    const a = armazem([srv('1', '05h00', '11h00', 6 * H)])
    const rep = { ...srv('7', '', '', 0), type: 'OFF' } as ServicoReg
    expect((await gravarServico(a.s, rep)).estado).toBe('ambiguo')
    expect((await gravarServico(a.s, rep, { resolucao: 'substituir' })).estado).toBe('ambiguo')
    expect(a.escritas).toEqual([])
  })
  it('histórico ilegível: não escreve nada', async () => {
    const a = armazem('{mau')
    expect((await gravarServico(a.s, srv('1', '05h00', '11h00', 6 * H))).estado).toBe('ilegivel')
    const b = armazem('{"nao":"array"}')
    expect((await gravarServico(b.s, srv('1', '05h00', '11h00', 6 * H))).estado).toBe('ilegivel')
    expect(a.escritas).toEqual([]); expect(b.escritas).toEqual([])
  })
  it('falha ao gravar: devolve erro e o valor guardado não muda', async () => {
    const dados = { historique: JSON.stringify([srv('1', '05h00', '11h00', 6 * H)]) }
    const s: ArmazenamentoHistorico = { getItem: async () => dados.historique, setItem: async () => { throw new Error('disco') } }
    expect((await gravarServico(s, srv('2', '14h00', '18h00', 4 * H))).estado).toBe('erro')
    expect(JSON.parse(dados.historique)).toHaveLength(1)
  })
  it('registos antigos de outros dias passam intactos', async () => {
    const antigos = [srv('5', '05h00', '15h00', 9 * H, { date: '05/10/2026' }), srv('4', '05h00', '15h00', 9 * H, { date: '04/10/2026' })]
    const a = armazem(antigos)
    await gravarServico(a.s, srv('6', '05h00', '15h00', 9 * H, { date: '06/10/2026' }))
    const lido = a.lido()
    expect(lido.slice(1)).toEqual(antigos)
  })
})

describe('gravações concorrentes não perdem registos', () => {
  it('duas gravações simultâneas ficam ambas', async () => {
    const a = armazem([], 5)
    const [r1, r2] = await Promise.all([
      gravarServico(a.s, srv('1', '05h00', '09h00', 4 * H)),
      gravarServico(a.s, srv('2', '11h00', '15h00', 4 * H)),
    ])
    expect(r1.estado).toBe('ok'); expect(r2.estado).toBe('ok')
    expect(a.lido().map(x => x.id).sort()).toEqual(['1', '2'])
  })
  it('gravar + editar + eliminar em simultâneo mantêm-se consistentes', async () => {
    const a = armazem([srv('1', '05h00', '09h00', 4 * H), srv('0', '05h00', '09h00', 4 * H, { date: '11/10/2026' })], 3)
    await Promise.all([
      gravarServico(a.s, srv('2', '11h00', '15h00', 4 * H)),
      alterarServicoGravado(a.s, '1', r => ({ ...r, fin: '10h00' })),
      eliminarServicoGravado(a.s, '0'),
    ])
    const lido = a.lido()
    expect(lido.map(x => x.id).sort()).toEqual(['1', '2'])
    expect(lido.find(x => x.id === '1')!.fin).toBe('10h00')
  })
  it('a fila continua depois de uma falha', async () => {
    await comFilaHistorico(async () => { throw new Error('x') }).catch(() => {})
    expect(await comFilaHistorico(async () => 42)).toBe(42)
  })
})

describe('7–8. editar e eliminar um só serviço', () => {
  it('eliminar o 2.º serviço mantém o 1.º; eliminar id inexistente não altera', async () => {
    const a = armazem([srv('2', '14h00', '18h00', 4 * H), srv('1', '05h00', '11h00', 6 * H)])
    const r = await eliminarServicoGravado(a.s, '2')
    expect(r.estado).toBe('ok')
    expect(a.lido().map(x => x.id)).toEqual(['1'])
    await eliminarServicoGravado(a.s, 'nao-existe')
    expect(a.lido().map(x => x.id)).toEqual(['1'])
  })
  it('editar só altera o registo escolhido; inexistente não grava', async () => {
    const a = armazem([srv('2', '14h00', '18h00', 4 * H), srv('1', '05h00', '11h00', 6 * H)])
    await alterarServicoGravado(a.s, '2', r => ({ ...r, fin: '19h00', segServico: 5 * H }))
    const l = a.lido()
    expect(l[0].fin).toBe('19h00'); expect(l[1].fin).toBe('11h00')
    const antes = a.escritas.length
    expect((await alterarServicoGravado(a.s, 'x', r => r)).estado).toBe('inexistente')
    expect(a.escritas.length).toBe(antes)
  })
})

describe('atualizarHistorico', () => {
  it('recebe o histórico mais recente e grava o que a função devolver', async () => {
    const a = armazem([srv('1', '05h00', '11h00', 6 * H)])
    const r = await atualizarHistorico(a.s, async lista => ({ gravar: lista.map(x => ({ ...x, fin: '12h00' })), extra: lista.length }))
    expect(r.estado === 'ok' && r.extra).toBe(1)
    expect(a.lido()[0].fin).toBe('12h00')
  })
  it('null = não grava; ilegível = não grava; exceção = erro sem escrever', async () => {
    const a = armazem([srv('1', '05h00', '11h00', 6 * H)])
    expect((await atualizarHistorico(a.s, async () => null)).estado).toBe('sem_alteracao')
    expect((await atualizarHistorico(a.s, async () => { throw new Error('x') })).estado).toBe('erro')
    expect(a.escritas).toEqual([])
    const b = armazem('{mau')
    expect((await atualizarHistorico(b.s, async () => ({ gravar: [], extra: 0 }))).estado).toBe('ilegivel')
    expect(b.escritas).toEqual([])
  })
})
