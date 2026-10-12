// src/utils/diasServicos.test.ts
import {
  agruparPorDia, resumoDia, intervaloServico, kmDoServico, kmPorCamiaoDoDia, camioesDoDia, fraisDoDia, somaFraisPorDia,
  diasDeTrabalho, repousosEntreDias, fraisDetalheDoGrupo, fraisTotalDoGrupo, planearGravacao, aplicarResolucao, removerServico, alterarServico, minutosDe, type ServicoReg,
} from './diasServicos'

const srv = (id: string, date: string, debut: string, fin: string, seg: number, extra: Partial<ServicoReg> = {}): ServicoReg =>
  ({ id, date, jour: 'Lun', type: 'TRAB', debut, fin, segServico: seg, segPausa: 0, decouche: false, frais: 0, ...extra })
const H = 3600

describe('1–3. um, dois e três serviços na mesma data', () => {
  it('um serviço: dia com 1 registo, tudo como antes', () => {
    const g = agruparPorDia([srv('1', '12/10/2026', '06h00', '14h00', 7 * H, { segPausa: H, frais: 21.8, kmDiarios: 420 })])
    expect(g).toHaveLength(1)
    const r = resumoDia(g[0])
    expect(r.nServicos).toBe(1)
    expect(r.servicoSeg).toBe(7 * H)
    expect(r.amplitudeSeg).toBe(8 * H)
    expect(r.frais).toBe(21.8)
    expect(r.km).toBe(420)
    expect(r.intervaloEntreServicosSeg).toBe(0)
  })
  it('dois serviços: um cartão, horas somadas, ordem cronológica', () => {
    const lista = [srv('2', '12/10/2026', '15h00', '19h00', 4 * H), srv('1', '12/10/2026', '06h00', '11h00', 5 * H)]
    const g = agruparPorDia(lista)
    expect(g).toHaveLength(1)
    expect(g[0].trabalho.map(s => s.id)).toEqual(['1', '2'])
    const r = resumoDia(g[0])
    expect(r.nServicos).toBe(2)
    expect(r.servicoSeg).toBe(9 * H)
    expect(r.debut).toBe('06h00')
    expect(r.fin).toBe('19h00')
  })
  it('três serviços preservados e somados', () => {
    const lista = [srv('3', '12/10/2026', '20h00', '22h00', 2 * H), srv('2', '12/10/2026', '14h00', '17h00', 3 * H), srv('1', '12/10/2026', '05h00', '10h00', 5 * H)]
    const r = resumoDia(agruparPorDia(lista)[0])
    expect(r.nServicos).toBe(3)
    expect(r.servicoSeg).toBe(10 * H)
    expect(r.amplitudeSeg).toBe(17 * H)
    expect(r.intervaloEntreServicosSeg).toBe(7 * H) // 10→14 (4h) + 17→20 (3h)
  })
  it('datas diferentes continuam em cartões diferentes e a ordem de entrada é mantida', () => {
    const g = agruparPorDia([srv('b', '13/10/2026', '06h00', '10h00', 4 * H), srv('a', '12/10/2026', '06h00', '10h00', 4 * H)])
    expect(g.map(x => x.chave)).toEqual(['13/10/2026', '12/10/2026'])
  })
})

describe('11. horas, pausas e amplitude (linha temporal real)', () => {
  it('amplitude = 1.º início → último fim; o intervalo entre serviços NÃO é pausa', () => {
    const lista = [
      srv('1', '12/10/2026', '06h00', '10h00', 3.5 * H, { segPausa: 0.5 * H }),
      srv('2', '12/10/2026', '14h00', '18h00', 3.75 * H, { segPausa: 0.25 * H }),
    ]
    const r = resumoDia(agruparPorDia(lista)[0])
    expect(r.amplitudeSeg).toBe(12 * H)
    expect(r.pausaSeg).toBe(0.75 * H)           // só pausas dentro dos serviços
    expect(r.intervaloEntreServicosSeg).toBe(4 * H)
    expect(r.servicoSeg).toBe(7.25 * H)
  })
  it('serviços sobrepostos (dado suspeito) são sinalizados e o intervalo conta 0', () => {
    const r = resumoDia(agruparPorDia([srv('1', '12/10/2026', '06h00', '12h00', 6 * H), srv('2', '12/10/2026', '11h00', '15h00', 4 * H)])[0])
    expect(r.temSobreposicao).toBe(true)
    expect(r.intervaloEntreServicosSeg).toBe(0)
  })
  it('sem horas válidas: amplitude desconhecida, nunca inventada', () => {
    const r = resumoDia(agruparPorDia([srv('1', '12/10/2026', '', '', 3600)])[0])
    expect(r.amplitudeSeg).toBeNull()
  })
  it('minutosDe aceita 06h30 e 06:30 e rejeita lixo', () => {
    expect(minutosDe('06h30')).toBe(390); expect(minutosDe('6:05')).toBe(365)
    expect(minutosDe('25h00')).toBeNull(); expect(minutosDe('')).toBeNull(); expect(minutosDe('abc')).toBeNull()
  })
})

describe('9. serviço que atravessa a meia-noite', () => {
  it('fim no dia seguinte; o segundo serviço no dia seguinte é OUTRO dia', () => {
    const noite = srv('1', '12/10/2026', '22h00', '03h00', 5 * H)
    const iv = intervaloServico(noite)!
    expect((iv.fim - iv.inicio) / 3_600_000).toBe(5)
    const manha = srv('2', '13/10/2026', '06h00', '10h00', 4 * H)
    expect(agruparPorDia([manha, noite])).toHaveLength(2)
  })
  it('dois serviços no mesmo dia, o último a atravessar a meia-noite: amplitude correta', () => {
    const r = resumoDia(agruparPorDia([srv('2', '12/10/2026', '20h00', '02h00', 6 * H), srv('1', '12/10/2026', '06h00', '10h00', 4 * H)])[0])
    expect(r.amplitudeSeg).toBe(20 * H)
    expect(r.intervaloEntreServicosSeg).toBe(10 * H)
  })
})

describe('10. passagem de ano', () => {
  it('31/12 (sem ano, id em Janeiro) agrupa com 31/12/AAAA do mesmo ano de início', () => {
    const idJan = String(new Date(2027, 0, 1, 2, 0).getTime())
    const a = srv(idJan, '31/12', '22h00', '02h00', 4 * H)
    const b = srv('x', '31/12/2026', '08h00', '12h00', 4 * H)
    const g = agruparPorDia([a, b])
    expect(g).toHaveLength(1)
    expect(g[0].chave).toBe('31/12/2026')
    const iv = intervaloServico(a)!
    expect(new Date(iv.fim).getFullYear()).toBe(2027)
  })
  it('repouso entre 31/12 e 01/01 usa fim do último serviço de 31/12', () => {
    const lista = [
      srv('3', '01/01/2027', '06h00', '10h00', 4 * H),
      srv('2', '31/12/2026', '20h00', '23h00', 3 * H),
      srv('1', '31/12/2026', '06h00', '10h00', 4 * H),
    ]
    const rep = repousosEntreDias(lista)
    expect(rep).toHaveLength(1)
    expect(rep[0].gapH).toBe(7)
  })
})

describe('4–5 e 13. camiões e quilómetros', () => {
  const troca = {
    a: { camiao: { type: 'immat' as const, value: 'AA-111-AA' }, kmInicio: 1000, kmFim: 1100 },
    b: { camiao: { type: 'immat' as const, value: 'BB-222-BB' }, kmInicio: 5000, kmFim: 5060 },
    segParaPausa: 0,
  }
  it('troca DENTRO de um serviço: 100 km no A + 60 km no B, sem duplicar nem misturar', () => {
    const s = srv('1', '12/10/2026', '06h00', '16h00', 9 * H, { troca, kmInicio: 1000, kmFim: 1100, kmDiarios: 160 })
    expect(kmDoServico(s)).toBe(160)
    const porCamiao = kmPorCamiaoDoDia([s])
    expect(porCamiao.find(x => x.chave === 'AA111AA')!.km).toBe(100)
    expect(porCamiao.find(x => x.chave === 'BB222BB')!.km).toBe(60)
    expect(camioesDoDia([s])).toEqual(['AA-111-AA', 'BB-222-BB'])
    expect(agruparPorDia([s])).toHaveLength(1)
    expect(resumoDia(agruparPorDia([s])[0]).nServicos).toBe(1) // troca ≠ novo serviço
  })
  it('dois camiões em serviços diferentes do mesmo dia', () => {
    const a = srv('1', '12/10/2026', '05h00', '10h00', 5 * H, { camiao: { type: 'immat', value: 'AA-111-AA' }, kmInicio: 1000, kmFim: 1200, kmDiarios: 200 })
    const b = srv('2', '12/10/2026', '14h00', '18h00', 4 * H, { camiao: { type: 'immat', value: 'BB-222-BB' }, kmInicio: 5000, kmFim: 5150, kmDiarios: 150 })
    const r = resumoDia(agruparPorDia([b, a])[0])
    expect(r.km).toBe(350)
    expect(r.camioes).toEqual(['AA-111-AA', 'BB-222-BB'])
    expect(r.kmPorCamiao.map(x => [x.chave, x.km])).toEqual([['AA111AA', 200], ['BB222BB', 150]])
  })
  it('mesmo camião nos dois serviços: km somados numa só linha; matrícula com formato diferente é o mesmo camião', () => {
    const a = srv('1', '12/10/2026', '05h00', '10h00', 5 * H, { camiao: { type: 'immat', value: 'AA-111-AA' }, kmDiarios: 200 })
    const b = srv('2', '12/10/2026', '14h00', '18h00', 4 * H, { camiao: { type: 'immat', value: 'aa111aa' }, kmDiarios: 100 })
    const r = resumoDia(agruparPorDia([a, b])[0])
    expect(r.kmPorCamiao).toHaveLength(1)
    expect(r.kmPorCamiao[0].km).toBe(300)
    expect(r.camioes).toHaveLength(1)
  })
  it('registos antigos sem matrícula: km ficam em «sem matrícula», nunca atribuídos a um camião', () => {
    const r = resumoDia(agruparPorDia([srv('1', '12/10/2026', '06h00', '10h00', 4 * H, { kmDiarios: 120 })])[0])
    expect(r.kmPorCamiao).toEqual([{ matricula: '', chave: '', km: 120 }])
    expect(r.camioes).toEqual([])
  })
  it('km: sem troca usa |fim−início|, depois kmDiarios; dias sem trabalho dão 0', () => {
    expect(kmDoServico(srv('1', '12/10/2026', '06h00', '10h00', H, { kmInicio: 100, kmFim: 160 }))).toBe(60)
    expect(kmDoServico(srv('1', '12/10/2026', '06h00', '10h00', H, { kmDiarios: 33 }))).toBe(33)
    expect(kmDoServico({ ...srv('1', '12/10/2026', '', '', 0), type: 'OFF', kmDiarios: 99 })).toBe(0)
  })
})

describe('12. frais sem duplicação', () => {
  const regles = { ptDejAte: 6, dejMinAmp: 6.017, dinerDe: 21.25 }
  const valeurs = { ptDej: 4.42, dej: 16.36, diner: 23.94, nuit: 23.94 }
  it('dia de serviço único: usa o valor guardado, exatamente como antes', () => {
    const g = agruparPorDia([srv('1', '12/10/2026', '05h00', '15h00', 9 * H, { frais: 20.78 })])[0]
    expect(fraisDoDia(g, { regles, valeurs })).toBe(20.78)
  })
  it('dois serviços: frais calculados UMA vez sobre o dia (não a soma dos dois registos)', () => {
    const lista = [
      srv('2', '12/10/2026', '14h00', '19h00', 5 * H, { frais: 16.36 }),
      srv('1', '12/10/2026', '05h00', '11h00', 6 * H, { frais: 20.78 }),
    ]
    const g = agruparPorDia(lista)[0]
    const dia = fraisDoDia(g, { regles, valeurs })
    expect(dia).toBe(20.78)               // ptDej (4.42) + dej (16.36): o direito é do dia
    expect(dia).toBeLessThan(20.78 + 16.36)
    expect(somaFraisPorDia(lista, { regles, valeurs })).toBe(20.78)
  })
  it('découché em qualquer serviço do dia conta uma só vez (jantar + noite)', () => {
    const lista = [srv('2', '12/10/2026', '14h00', '22h00', 7 * H, { decouche: true, type: 'DEC' }), srv('1', '12/10/2026', '05h00', '09h00', 4 * H)]
    const dia = fraisDoDia(agruparPorDia(lista)[0], { regles, valeurs })
    expect(dia).toBe(4.42 + 16.36 + 23.94 + 23.94)
  })
  it('soma por vários dias: dias distintos somam, serviços do mesmo dia não duplicam', () => {
    const lista = [
      srv('3', '13/10/2026', '05h00', '15h00', 9 * H, { frais: 20.78 }),
      srv('2', '12/10/2026', '14h00', '19h00', 5 * H, { frais: 16.36 }),
      srv('1', '12/10/2026', '05h00', '11h00', 6 * H, { frais: 20.78 }),
    ]
    expect(somaFraisPorDia(lista, { regles, valeurs })).toBe(41.56)
  })
  it('dias sem trabalho não geram frais; número de dias de trabalho conta dias, não serviços', () => {
    const lista = [srv('2', '12/10/2026', '14h00', '19h00', 5 * H), srv('1', '12/10/2026', '05h00', '11h00', 6 * H), { ...srv('0', '11/10/2026', '', '', 0), type: 'RC' }]
    expect(diasDeTrabalho(lista)).toBe(1)
    expect(somaFraisPorDia([{ ...srv('0', '11/10/2026', '', '', 0), type: 'RC', frais: 50 }])).toBe(0)
  })
})

describe('repouso entre dias nunca avalia o intervalo entre serviços do mesmo dia', () => {
  it('3 h entre dois serviços do mesmo dia não gera aviso de repouso; o repouso real sim', () => {
    const lista = [
      srv('3', '13/10/2026', '06h00', '10h00', 4 * H),
      srv('2', '12/10/2026', '14h00', '20h00', 6 * H),
      srv('1', '12/10/2026', '05h00', '11h00', 6 * H),
    ]
    const rep = repousosEntreDias(lista)
    expect(rep).toHaveLength(1)
    expect([rep[0].de, rep[0].para]).toEqual(['12/10/2026', '13/10/2026'])
    expect(rep[0].gapH).toBe(10)
  })
})

describe('6–8 e 17. gravação sem substituição', () => {
  const base = [srv('1', '12/10/2026', '05h00', '11h00', 6 * H, { frais: 20.78, kmDiarios: 300 })]
  it('2.º serviço no mesmo dia é INSERIDO; o 1.º fica intacto', () => {
    const novo = srv('2', '12/10/2026', '14h00', '18h00', 4 * H)
    const p = planearGravacao(base, novo)
    expect(p.acao).toBe('inserir')
    if (p.acao !== 'inserir') return
    expect(p.lista.map(x => x.id)).toEqual(['2', '1'])
    expect(p.lista[1]).toBe(base[0])            // mesmo objeto: não foi tocado
    expect(p.arquivar).toEqual([])
  })
  it('6. regravar o MESMO serviço (mesmo id) não duplica', () => {
    const p = planearGravacao(base, { ...base[0], frais: 25 })
    expect(p.acao).toBe('mesmo_servico')
    if (p.acao === 'mesmo_servico') { expect(p.lista).toHaveLength(1); expect(p.lista[0].frais).toBe(25) }
  })
  it('6. regravar o mesmo serviço com id novo (mesmo dia, início, fim e duração) também não duplica', () => {
    const p = planearGravacao(base, { ...base[0], id: '999' })
    expect(p.acao).toBe('mesmo_servico')
    if (p.acao === 'mesmo_servico') expect(p.lista).toHaveLength(1)
  })
  it('mesmo início com fim diferente → AMBÍGUO: nada é decidido nem substituído', () => {
    const antes = JSON.stringify(base)
    const p = planearGravacao(base, srv('9', '12/10/2026', '05h00', '12h00', 7 * H))
    expect(p.acao).toBe('ambiguo')
    if (p.acao === 'ambiguo') { expect(p.motivo).toBe('mesmo_inicio'); expect(p.conflitos).toEqual([base[0]]) }
    expect(JSON.stringify(base)).toBe(antes)
  })
  it('horários sobrepostos → ambíguo', () => {
    const p = planearGravacao(base, srv('9', '12/10/2026', '10h00', '15h00', 5 * H))
    expect(p.acao).toBe('ambiguo')
    if (p.acao === 'ambiguo') expect(p.motivo).toBe('sobreposicao')
  })
  it('resolução explícita: manter ambos, ou substituir (o substituído vai para arquivo)', () => {
    const novo = srv('9', '12/10/2026', '05h00', '12h00', 7 * H)
    const ambos = aplicarResolucao(base, novo, [base[0]], 'manter_ambos')
    expect(ambos.lista).toHaveLength(2); expect(ambos.arquivar).toEqual([])
    const subst = aplicarResolucao(base, novo, [base[0]], 'substituir')
    expect(subst.lista.map(x => x.id)).toEqual(['9']); expect(subst.arquivar).toEqual([base[0]])
  })
  it('17. serviço novo num dia só com «repos»: o repos é arquivado, nunca apagado em silêncio', () => {
    const lista = [{ ...srv('0', '12/10/2026', '', '', 0), type: 'RC' } as ServicoReg]
    const p = planearGravacao(lista, srv('1', '12/10/2026', '06h00', '10h00', 4 * H))
    expect(p.acao).toBe('inserir')
    if (p.acao === 'inserir') { expect(p.arquivar).toHaveLength(1); expect(p.lista.map(x => x.id)).toEqual(['1']) }
  })
  it('registar «repos» num dia com serviços → ambíguo (não apaga serviços)', () => {
    const p = planearGravacao(base, { ...srv('7', '12/10/2026', '', '', 0), type: 'OFF' })
    expect(p.acao).toBe('ambiguo')
    if (p.acao === 'ambiguo') expect(p.motivo).toBe('dia_com_servicos')
  })
  it('7. editar UM serviço altera só esse registo', () => {
    const lista = [srv('2', '12/10/2026', '14h00', '18h00', 4 * H), base[0]]
    const nova = alterarServico(lista, '2', { fin: '19h00', segServico: 5 * H })
    expect(nova[0].fin).toBe('19h00'); expect(nova[1]).toBe(base[0])
    expect(lista[0].fin).toBe('18h00')           // entrada não é mutada
  })
  it('8. eliminar UM serviço mantém os restantes do dia', () => {
    const lista = [srv('2', '12/10/2026', '14h00', '18h00', 4 * H), base[0]]
    const nova = removerServico(lista, '2')
    expect(nova).toEqual([base[0]])
    expect(agruparPorDia(nova)[0].trabalho).toHaveLength(1)
  })
  it('dados antigos (sem camiao, sem curtoConfirmado) continuam a agrupar e resumir', () => {
    const antigo = { id: '1790000000000', date: '05/10', jour: 'Lun', type: 'TRAB', debut: '05h00', fin: '15h00', segServico: 9 * H, segPausa: 0, decouche: false, frais: 20 } as ServicoReg
    const r = resumoDia(agruparPorDia([antigo], 2026)[0])
    expect(r.nServicos).toBe(1)
    expect(r.frais).toBe(20)
  })
})

describe('totais de frais por grupo (Historique/semana/mês)', () => {
  const regles = { ptDejAte: 6, dejMinAmp: 6.017, dinerDe: 21.25 }
  const valeurs = { ptDej: 4.42, dej: 16.36, diner: 23.94, nuit: 23.94 }
  it('dia único: soma dos frais guardados, exatamente como antes', () => {
    const g = agruparPorDia([srv('1', '12/10/2026', '05h00', '15h00', 9 * H, { frais: 13.37 })])[0]
    expect(fraisTotalDoGrupo(g, { regles, valeurs })).toBe(13.37)
  })
  it('vários serviços: frais do dia (uma vez), não a soma dos registos', () => {
    const g = agruparPorDia([srv('2', '12/10/2026', '14h00', '19h00', 5 * H, { frais: 16.36 }), srv('1', '12/10/2026', '05h00', '11h00', 6 * H, { frais: 20.78 })])[0]
    expect(fraisTotalDoGrupo(g, { regles, valeurs })).toBe(20.78)
    const d = fraisDetalheDoGrupo(g, { regles, valeurs })
    expect([d.ptd, d.dej, d.din, d.nui]).toEqual([1, 1, 0, 0])
  })
  it('detalhe de um dia único não muda (pt-déj só se começou cedo)', () => {
    const g = agruparPorDia([srv('1', '12/10/2026', '08h00', '16h00', 7 * H)])[0]
    const d = fraisDetalheDoGrupo(g, { regles, valeurs })
    expect([d.ptd, d.dej]).toEqual([0, 1])
  })
})

import { colapsarServicosDoDia } from './diasServicos'
describe('11–13. vista por dia para estatísticas (horas, frais sem duplicar, km)', () => {
  const regras = { ptDejAte: 6.5, dejMinAmp: 6, dinerDe: 19 } as any
  it('dia de serviço único: mesma referência, nada muda', () => {
    const a = srv('1', '12/10/2026', '06h00', '14h00', 7 * H, { frais: 21.8 })
    const r = colapsarServicosDoDia([a])
    expect(r).toHaveLength(1)
    expect(r[0]).toBe(a)
  })
  it('dois serviços: UM registo do dia; horas somadas; amplitude real; frais calculados uma vez (não somados)', () => {
    const a = srv('1', '12/10/2026', '06h00', '10h00', 4 * H, { frais: 21.8 })
    const b = srv('2', '12/10/2026', '14h00', '18h00', 4 * H, { frais: 21.8 })
    const r = colapsarServicosDoDia([b, a])
    expect(r).toHaveLength(1)
    expect(r[0].segServico).toBe(8 * H)
    expect(r[0].debut).toBe('06h00')
    expect(r[0].fin).toBe('18h00')
    expect(r[0].servicosNoDia).toBe(2)
    expect(r[0].frais).toBeLessThan(43.6)          // nunca 21.8 + 21.8
    expect(r[0].frais).toBe(fraisDoDia(agruparPorDia([a, b])[0]))
  })
  it('km por serviço somados sem duplicar; troca de camião não conta duas vezes', () => {
    const troca = { a: { camiao: { type: 'immat', value: 'AA' }, kmInicio: 100, kmFim: 150 }, b: { camiao: { type: 'immat', value: 'BB' }, kmInicio: 900, kmFim: 930 }, segParaPausa: 0 } as any
    const r = colapsarServicosDoDia([
      srv('1', '12/10/2026', '06h00', '10h00', 4 * H, { troca, kmDiarios: 80 }),
      srv('2', '12/10/2026', '14h00', '16h00', 2 * H, { kmInicio: 930, kmFim: 960 }),
    ])
    expect(r[0].kmDiarios).toBe(110)               // 50 + 30 + 30
  })
  it('cópia idêntica do mesmo serviço conta uma só vez (histórico antigo)', () => {
    const a = srv('1', '12/10/2026', '06h00', '14h00', 7 * H, { frais: 21.8 })
    const b = { ...a, id: '2' }
    const r = colapsarServicosDoDia([b, a])
    expect(r).toHaveLength(1)
    expect(r[0].segServico).toBe(7 * H)
    expect(r[0].frais).toBe(21.8)
  })
  it('découché de qualquer serviço marca o dia; dias sem trabalho passam intactos; ordem dos outros dias mantida', () => {
    const off = { id: '9', date: '11/10/2026', type: 'OFF', frais: 0 } as any
    const r = colapsarServicosDoDia([
      srv('3', '12/10/2026', '20h00', '23h00', 3 * H, { type: 'DEC', decouche: true }),
      srv('2', '12/10/2026', '06h00', '09h00', 3 * H),
      off,
    ])
    expect(r).toHaveLength(2)
    expect(r[0].type).toBe('DEC')
    expect(r[0].decouche).toBe(true)
    expect(r[1]).toBe(off)
  })
  it('ano novo: 31/12 + 01/01 são dias diferentes (não se juntam)', () => {
    const r = colapsarServicosDoDia([
      srv('2', '01/01/2027', '06h00', '10h00', 4 * H),
      srv('1', '31/12/2026', '06h00', '10h00', 4 * H),
    ])
    expect(r).toHaveLength(2)
  })
  it('não altera a lista de entrada', () => {
    const a = srv('1', '12/10/2026', '06h00', '10h00', 4 * H), b = srv('2', '12/10/2026', '14h00', '18h00', 4 * H)
    const lista = [a, b], copia = JSON.stringify(lista)
    colapsarServicosDoDia(lista)
    expect(JSON.stringify(lista)).toBe(copia)
  })
})

import { itensPorDia } from './diasServicos'
describe('2–3 e 8. lista do Historique: UM cartão por dia', () => {
  const off = { id: '9', date: '10/10/2026', jour: 'Sam', type: 'OFF', frais: 0 } as ServicoReg
  it('dias de serviço único ficam como itens simples, pela mesma ordem', () => {
    const l = [srv('2', '12/10/2026', '06h00', '10h00', 4 * H), srv('1', '11/10/2026', '06h00', '10h00', 4 * H), off]
    const it = itensPorDia(l)
    expect(it.map(x => x.tipo)).toEqual(['um', 'um', 'um'])
    expect(it.map(x => (x as any).jour.id)).toEqual(['2', '1', '9'])
  })
  it('dois serviços na mesma data → UM cartão do dia com os dois ids; o resto não muda de posição', () => {
    const l = [srv('3', '12/10/2026', '14h00', '18h00', 4 * H), srv('2', '12/10/2026', '06h00', '10h00', 4 * H), srv('1', '11/10/2026', '06h00', '10h00', 4 * H), off]
    const it = itensPorDia(l)
    expect(it).toHaveLength(3)
    expect(it[0].tipo).toBe('dia')
    const d = it[0] as Extract<typeof it[number], { tipo: 'dia' }>
    expect(d.ids).toEqual(['2', '3'])                     // ordem cronológica dentro do dia
    expect(d.resumo.nServicos).toBe(2)
    expect(d.resumo.servicoSeg).toBe(8 * H)
    expect(it[1].tipo).toBe('um')
    expect(it[2].tipo).toBe('um')
  })
  it('três serviços → um cartão; apagar um deles deixa dois (e apagar mais um volta a «simples»)', () => {
    const l = [srv('3', '12/10/2026', '20h00', '22h00', 2 * H), srv('2', '12/10/2026', '14h00', '17h00', 3 * H), srv('1', '12/10/2026', '05h00', '10h00', 5 * H)]
    expect(itensPorDia(l)).toHaveLength(1)
    const sem2 = removerServico(l, '2')
    const it2 = itensPorDia(sem2)
    expect(it2).toHaveLength(1)
    expect((it2[0] as any).ids).toEqual(['1', '3'])
    const sem23 = removerServico(sem2, '3')
    expect(itensPorDia(sem23).map(x => x.tipo)).toEqual(['um'])
  })
  it('registo «repos» do mesmo dia continua item próprio e não conta como serviço', () => {
    const l = [srv('2', '12/10/2026', '14h00', '18h00', 4 * H), srv('1', '12/10/2026', '06h00', '10h00', 4 * H), { id: '8', date: '12/10/2026', type: 'OFF' } as ServicoReg]
    const it = itensPorDia(l)
    expect(it.map(x => x.tipo)).toEqual(['dia', 'um'])
  })
  it('camiões e km por serviço aparecem no resumo do cartão; km do dia sem duplicar', () => {
    const l = [
      srv('2', '12/10/2026', '14h00', '18h00', 4 * H, { camiao: { type: 'immat', value: 'EF-456-GH' }, kmInicio: 500, kmFim: 560 }),
      srv('1', '12/10/2026', '06h00', '10h00', 4 * H, { camiao: { type: 'immat', value: 'AB-123-CD' }, kmInicio: 100, kmFim: 180 }),
    ]
    const d = itensPorDia(l)[0] as any
    expect(d.resumo.km).toBe(140)
    expect(d.resumo.kmPorCamiao.map((k: any) => [k.chave, k.km])).toEqual([['AB123CD', 80], ['EF456GH', 60]])
  })
})
