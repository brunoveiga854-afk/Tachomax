// Integração: vários serviços no mesmo dia nas estatísticas, nos frais mensais, nas médias e nos backups antigos.
import { calcFraisMesPorHorarios, calcFraisHorario } from './calculos'
import { colapsarServicosDoDia, agruparPorDia, itensPorDia, resumoDia, type ServicoReg } from './diasServicos'

const H = 3600
const P = { ptd: 4.42, dej: 16.36, din: 23.94, nui: 23.94, regles: { ptDejAte: 6, dejMinAmp: 6.01, dinerDe: 19 } }
const svc = (id: string, date: string, debut: string, fin: string, seg: number, extra: Record<string, unknown> = {}): ServicoReg =>
  ({ id, date, jour: 'Mar', type: 'TRAB', debut, fin, segServico: seg, segPausa: 0, decouche: false, frais: 0, ...extra })

describe('frais do mês: um dia com vários serviços conta UMA vez', () => {
  it('dois serviços no mesmo dia = um único cálculo do dia (1.º início, serviço total) e não a soma dos dois', () => {
    const a = svc('1', '15/04/2026', '05:00', '09:00', 4 * H)
    const b = svc('2', '15/04/2026', '14:00', '18:00', 4 * H)
    const r = calcFraisMesPorHorarios([a, b], 2026, 3, P)
    const dia = calcFraisHorario('TRAB', '05:00', '18:00', false, P, 8 * H, false)
    expect(r.total).toBe(dia.total)
    expect(r.ptd).toBe(1)
    expect(r.dej).toBe(1)                        // não 2
    // o direito é o do DIA (5h–18h, 8h de serviço): pode ser MAIOR que o de cada serviço isolado, mas nunca é a soma dos dois dias-completos
    expect(r.total < dia.total * 2).toBe(true)
  })
  it('dois serviços curtos que, somados, dão direito a refeição: o direito depende do DIA', () => {
    const a = svc('1', '15/04/2026', '07:00', '10:00', 3 * H)
    const b = svc('2', '15/04/2026', '12:00', '16:00', 4 * H)
    const r = calcFraisMesPorHorarios([a, b], 2026, 3, P)
    expect(r.dej).toBe(1)                        // 7 h de serviço no dia ≥ limiar
  })
  it('um serviço por dia: resultado idêntico ao cálculo por registo de sempre', () => {
    const l = [svc('1', '14/04/2026', '05:00', '14:00', 9 * H), svc('2', '15/04/2026', '08:00', '17:00', 8 * H)]
    const r = calcFraisMesPorHorarios(l, 2026, 3, P)
    const esperado = calcFraisHorario('TRAB', '05:00', '14:00', false, P, 9 * H, false).total + calcFraisHorario('TRAB', '08:00', '17:00', false, P, 8 * H, false).total
    expect(r.total).toBe(esperado)
  })
  it('découché num dos serviços do dia: uma noite, um jantar', () => {
    const a = svc('1', '15/04/2026', '06:00', '10:00', 4 * H)
    const b = svc('2', '15/04/2026', '16:00', '22:00', 6 * H, { type: 'DEC', decouche: true })
    const r = calcFraisMesPorHorarios([a, b], 2026, 3, P)
    expect(r.nui).toBe(1)
    expect(r.din).toBe(1)
  })
})

describe('15. backups antigos', () => {
  // Formato exportado por versões anteriores: datas DD/MM sem ano, sem camiao/curtoConfirmado, um registo por dia.
  const backupAntigo = JSON.parse(JSON.stringify({
    version: 'tachooffice-v1', exportedAt: '2026-10-01T10:00:00.000Z',
    data: { historique: [
      { id: String(Date.UTC(2026, 9, 2, 16)), date: '02/10', jour: 'Vendredi', type: 'TRAB', debut: '06h00', fin: '16h00', segServico: 33000, segPausa: 3000, decouche: false, frais: 20.78, kmDiarios: 420 },
      { id: String(Date.UTC(2026, 9, 1, 15)), date: '01/10/2026', jour: 'Jeudi', type: 'DEC', debut: '07h00', fin: '19h00', segServico: 40000, segPausa: 3200, decouche: true, frais: 44.72, kmInicio: 1000, kmFim: 1380 },
      { id: String(Date.UTC(2026, 8, 30, 12)), date: '30/09/2026', jour: 'Mercredi', type: 'OFF', debut: '', fin: '', segServico: 0, segPausa: 0, decouche: false, frais: 0 },
    ] },
  }))
  const hist: ServicoReg[] = backupAntigo.data.historique

  it('cada registo antigo é um dia de serviço único: nenhum cartão agrupado, nada muda', () => {
    expect(agruparPorDia(hist, 2026).every(g => g.registos.length === 1)).toBe(true)
    expect(itensPorDia(hist, { anoFallback: 2026 }).every(i => i.tipo === 'um')).toBe(true)
  })
  it('vista de estatísticas devolve os MESMOS objetos (sem cópias nem alterações)', () => {
    const v = colapsarServicosDoDia(hist, { anoFallback: 2026 })
    expect(v).toHaveLength(3)
    v.forEach((x, i) => expect(x).toBe(hist[i]))
  })
  it('totais do dia = valores guardados (frais, km, horas), como antes', () => {
    const g = agruparPorDia(hist, 2026)
    const r = g.map(x => resumoDia(x, { anoFallback: 2026 }))
    expect(r[0].frais).toBe(20.78)
    expect(r[0].km).toBe(420)
    expect(r[1].km).toBe(380)
    expect(r[1].servicoSeg).toBe(40000)
    expect(r[1].kmPorCamiao).toEqual([{ matricula: '', chave: '', km: 380 }]) // sem matrícula: nunca atribuído a um camião
  })
  it('exportar → importar (JSON) devolve exatamente a mesma lista, com serviços múltiplos incluídos', () => {
    const novo = [svc('7', '03/10/2026', '06h00', '09h00', 3 * H, { camiao: { type: 'immat', value: 'AB-123-CD' } }), svc('8', '03/10/2026', '13h00', '16h00', 3 * H, { curtoConfirmado: true }), ...hist]
    const volta = JSON.parse(JSON.stringify({ version: 'tachooffice-v1', data: { historique: novo } })).data.historique
    expect(volta).toEqual(novo)
    expect(itensPorDia(volta, { anoFallback: 2026 }).filter(i => i.tipo === 'dia')).toHaveLength(1)
  })
})
