// src/utils/fraisManualMes.test.ts — frais manual no cálculo mensal por horários (projeções/Fiche)
import { calcFraisMesPorHorarios } from './calculos'

const H = 3600
const p = { ptd: 4.42, dej: 16.36, din: 23.94, nui: 23.94, regles: { ptDejAte: 6, dejMinAmp: 6.017, dinerDe: 21.25 } }
const r = (id: string, debut: string, fin: string, seg: number, extra: Record<string, unknown> = {}) =>
  ({ id, date: '12/10/2026', jour: 'Lun', type: 'TRAB', debut, fin, segServico: seg, segPausa: 0, decouche: false, frais: 0, ...extra })

describe('calcFraisMesPorHorarios — frais manual', () => {
  it('dia com 2 serviços sem marca: UMA indemnização (não duas)', () => {
    const a = calcFraisMesPorHorarios([r('1', '05h00', '11h00', 6 * H), r('2', '14h00', '19h00', 5 * H)], 2026, 9, p)
    const um = calcFraisMesPorHorarios([r('9', '05h00', '19h00', 11 * H)], 2026, 9, p)
    expect(a.total > 0).toBe(true)
    expect(a.total <= um.total + 0.001).toBe(true)
  })
  it('dia com 2 serviços e frais manual no 1.º: o total do dia é o do motorista', () => {
    const a = calcFraisMesPorHorarios([r('1', '05h00', '11h00', 6 * H, { frais: 33.33, fraisManual: true }), r('2', '14h00', '19h00', 5 * H, { frais: 16.36 })], 2026, 9, p)
    expect(a.total).toBe(33.33)
  })
  it('dia único sem marca: continua a ser o cálculo por horários (como sempre)', () => {
    const a = calcFraisMesPorHorarios([r('1', '05h00', '11h00', 6 * H, { frais: 99 })], 2026, 9, p)
    expect(a.total === 99).toBe(false)
  })
  it('dia único com marca manual: respeita o valor', () => {
    expect(calcFraisMesPorHorarios([r('1', '05h00', '11h00', 6 * H, { frais: 12.5, fraisManual: true })], 2026, 9, p).total).toBe(12.5)
  })
})
