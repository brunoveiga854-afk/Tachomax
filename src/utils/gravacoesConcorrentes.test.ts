// src/utils/gravacoesConcorrentes.test.ts — guardar, editar, apagar e migrar não se anulam (Home e Historique usam a MESMA fila)
import { gravarServico, eliminarServicoGravado, alterarServicoGravado, atualizarHistorico, type ArmazenamentoHistorico } from './gravarServico'
import { comFilaHistorico } from './filaHistorico'
import type { ServicoReg } from './diasServicos'

const H = 3600
const srv = (id: string, date: string, debut: string, fin: string, seg: number, extra: Partial<ServicoReg> = {}): ServicoReg =>
  ({ id, date, jour: 'Lun', type: 'TRAB', debut, fin, segServico: seg, segPausa: 0, decouche: false, frais: 0, ...extra })

function armazem(inicial: ServicoReg[], atrasoMs = 3) {
  const dados: Record<string, string> = { historique: JSON.stringify(inicial) }
  const s: ArmazenamentoHistorico = {
    getItem: async k => { await new Promise(r => setTimeout(r, atrasoMs)); return k in dados ? dados[k] : null },
    setItem: async (k, v) => { await new Promise(r => setTimeout(r, atrasoMs)); dados[k] = v },
  }
  return { s, dados, lido: () => JSON.parse(dados.historique) as ServicoReg[] }
}

describe('2. gravações e edições concorrentes', () => {
  it('apagar o serviço A (Home, por id) enquanto o serviço B termina (gravar): A some, B entra, nada se anula', async () => {
    const a = armazem([srv('A', '12/10/2026', '06h00', '10h00', 4 * H), srv('X', '11/10/2026', '06h00', '14h00', 8 * H)])
    const [del, gr] = await Promise.all([
      eliminarServicoGravado(a.s, 'A'),
      gravarServico(a.s, srv('B', '12/10/2026', '14h00', '18h00', 4 * H)),
    ])
    expect(del.estado).toBe('ok')
    expect(gr.estado).toBe('ok')
    expect(a.lido().map(x => x.id).sort()).toEqual(['B', 'X'])
  })
  it('apagar um serviço de um dia com dois NÃO apaga o outro do mesmo dia (identidade por id, nunca só pela data)', async () => {
    const a = armazem([srv('2', '12/10/2026', '14h00', '18h00', 4 * H), srv('1', '12/10/2026', '06h00', '10h00', 4 * H)])
    await eliminarServicoGravado(a.s, '2')
    expect(a.lido().map(x => x.id)).toEqual(['1'])
  })
  it('editar o serviço 1 no Historique enquanto o serviço 2 é guardado na Home: as duas alterações ficam', async () => {
    const a = armazem([srv('1', '12/10/2026', '06h00', '10h00', 4 * H)])
    await Promise.all([
      alterarServicoGravado(a.s, '1', s => ({ ...s, fin: '11h00', segServico: 5 * H })),
      gravarServico(a.s, srv('2', '12/10/2026', '14h00', '18h00', 4 * H)),
    ])
    const l = a.lido()
    expect(l.length).toBe(2)
    expect(l.find(x => x.id === '1')!.fin).toBe('11h00')
    expect(l.find(x => x.id === '2')).toBeDefined()
  })
  it('migração de datas na fila (chargerHistorique) não repõe uma lista antiga por cima de uma gravação concorrente', async () => {
    const velho = srv('M', '10/10', '06h00', '10h00', 4 * H)            // data sem ano → será migrada
    const a = armazem([velho])
    const migrar = (l: ServicoReg[]) => l.map(j => (j.date.split('/').length === 2 ? { ...j, date: `${j.date}/2026` } : j))
    const [mig, gr] = await Promise.all([
      atualizarHistorico<ServicoReg[]>(a.s, async atual => {
        const m = migrar(atual)
        return m.some((j, i) => j.date !== atual[i].date) ? { gravar: m, extra: m } : null
      }),
      gravarServico(a.s, srv('N', '12/10/2026', '06h00', '10h00', 4 * H)),
    ])
    expect(mig.estado).toBe('ok')
    expect(gr.estado).toBe('ok')
    const l = a.lido()
    expect(l.map(x => x.id).sort()).toEqual(['M', 'N'])
    expect(l.find(x => x.id === 'M')!.date).toBe('10/10/2026')
  })
  it('migração sem nada a migrar não escreve (sem_alteracao)', async () => {
    const a = armazem([srv('Z', '10/10/2026', '06h00', '10h00', 4 * H)])
    const antes = a.dados.historique
    const r = await atualizarHistorico<ServicoReg[]>(a.s, async atual => {
      const m = atual
      return m.some((j, i) => j.date !== atual[i].date) ? { gravar: m, extra: m } : null
    })
    expect(r.estado).toBe('sem_alteracao')
    expect(a.dados.historique).toBe(antes)
  })
  it('apagar um id que já não existe não escreve nada (devolve sem_alteracao no padrão da Home)', async () => {
    const a = armazem([srv('1', '12/10/2026', '06h00', '10h00', 4 * H)])
    const antes = a.dados.historique
    const r = await atualizarHistorico<unknown>(a.s, async lista => (lista.some(j => j.id === 'NAO') ? { gravar: lista, extra: 1 } : null))
    expect(r.estado).toBe('sem_alteracao')
    expect(a.dados.historique).toBe(antes)
  })
  it('importação / apagar histórico (comFilaHistorico) esperam por uma gravação em curso e não se cruzam com ela', async () => {
    const a = armazem([srv('1', '12/10/2026', '06h00', '10h00', 4 * H)])
    const ordem: string[] = []
    const p1 = gravarServico(a.s, srv('2', '12/10/2026', '14h00', '18h00', 4 * H)).then(() => ordem.push('gravar'))
    const p2 = comFilaHistorico(async () => { ordem.push('import-inicio'); await a.s.setItem('historique', JSON.stringify([srv('I', '01/10/2026', '06h00', '10h00', 4 * H)])); ordem.push('import-fim') })
    await Promise.all([p1, p2])
    expect(ordem).toEqual(['gravar', 'import-inicio', 'import-fim'])
    expect(a.lido().map(x => x.id)).toEqual(['I'])
  })
  it('uma gravação que falha não bloqueia a fila', async () => {
    const a = armazem([])
    await comFilaHistorico(async () => { throw new Error('x') }).catch(() => {})
    const r = await gravarServico(a.s, srv('1', '12/10/2026', '06h00', '10h00', 4 * H))
    expect(r.estado).toBe('ok')
  })
  it('20 operações concorrentes (gravar/editar/apagar misturadas): resultado determinístico e sem perdas', async () => {
    const a = armazem([], 1)
    const ops: Promise<unknown>[] = []
    for (let i = 1; i <= 10; i++) ops.push(gravarServico(a.s, srv(`S${i}`, `${String(i).padStart(2, '0')}/10/2026`, '06h00', '10h00', 4 * H)))
    await Promise.all(ops)
    const ops2: Promise<unknown>[] = []
    for (let i = 1; i <= 5; i++) ops2.push(eliminarServicoGravado(a.s, `S${i}`))
    for (let i = 6; i <= 10; i++) ops2.push(alterarServicoGravado(a.s, `S${i}`, s => ({ ...s, frais: 9 })))
    await Promise.all(ops2)
    const l = a.lido()
    expect(l.map(x => x.id).sort()).toEqual(['S10', 'S6', 'S7', 'S8', 'S9'])
    expect(l.every(x => x.frais === 9)).toBe(true)
  })
})
