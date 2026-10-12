// src/utils/fraisManual.test.ts — frais: um dia com 2 serviços não gera 2 indemnizações; ajustes manuais não se perdem
import { decidirFraisManualForm, decidirFraisEdicao } from './fraisManual'
import { agruparPorDia, resumoDia, fraisDoDia, fraisTotalDoGrupo, colapsarServicosDoDia, type ServicoReg } from './diasServicos'

const H = 3600
const srv = (id: string, debut: string, fin: string, seg: number, extra: Partial<ServicoReg> = {}): ServicoReg =>
  ({ id, date: '12/10/2026', jour: 'Lun', type: 'TRAB', debut, fin, segServico: seg, segPausa: 0, decouche: false, frais: 0, ...extra })
const regles = { ptDejAte: 6, dejMinAmp: 6.017, dinerDe: 21.25 }
const valeurs = { ptDej: 4.42, dej: 16.36, diner: 23.94, nuit: 23.94 }
const o = { regles, valeurs }
const dia = (l: ServicoReg[]) => agruparPorDia(l)[0]

describe('frais — dia com 2 serviços = UMA indemnização do dia', () => {
  it('sem marca manual: calculado uma vez sobre o dia (não a soma dos dois serviços)', () => {
    const g = dia([srv('1', '05h00', '11h00', 6 * H, { frais: 20.78 }), srv('2', '14h00', '19h00', 5 * H, { frais: 16.36 })])
    const f = fraisDoDia(g, o)
    expect(f).toBe(20.78)                         // pt-déj + déj, uma vez
    expect(f < 20.78 + 16.36).toBe(true)
    expect(fraisTotalDoGrupo(g, o)).toBe(f)
    expect(resumoDia(g, o).fraisManual).toBe(false)
  })
})

describe('frais — ajuste manual confirmado não é substituído', () => {
  it('2 serviços, o 1.º com frais manual: o dia mantém o valor do motorista', () => {
    const g = dia([srv('1', '05h00', '11h00', 6 * H, { frais: 30, fraisManual: true }), srv('2', '14h00', '19h00', 5 * H, { frais: 16.36 })])
    expect(fraisDoDia(g, o)).toBe(30)
    expect(fraisTotalDoGrupo(g, o)).toBe(30)
    expect(resumoDia(g, o).frais).toBe(30)
    expect(resumoDia(g, o).fraisManual).toBe(true)
  })
  it('vários marcados como manuais: usa o maior do DIA, nunca soma (sem contar duas vezes)', () => {
    const g = dia([srv('1', '05h00', '11h00', 6 * H, { frais: 20, fraisManual: true }), srv('2', '14h00', '19h00', 5 * H, { frais: 25, fraisManual: true })])
    expect(fraisDoDia(g, o)).toBe(25)
  })
  it('manual a ZERO é respeitado (o motorista pode ter confirmado 0)', () => {
    const g = dia([srv('1', '05h00', '11h00', 6 * H, { frais: 0, fraisManual: true }), srv('2', '14h00', '19h00', 5 * H, { frais: 16.36 })])
    expect(fraisDoDia(g, o)).toBe(0)
  })
  it('estatísticas (colapsar): o registo do dia leva o frais manual, uma só vez', () => {
    const lista = [srv('2', '14h00', '19h00', 5 * H, { frais: 16.36 }), srv('1', '05h00', '11h00', 6 * H, { frais: 30, fraisManual: true })]
    const c = colapsarServicosDoDia(lista, o)
    expect(c).toHaveLength(1)
    expect(c[0].frais).toBe(30)
    expect(c[0].fraisManual).toBe(true)
  })
  it('dia de serviço único: continua a ser o valor guardado (com ou sem marca)', () => {
    expect(fraisDoDia(dia([srv('1', '05h00', '11h00', 6 * H, { frais: 7.5 })]), o)).toBe(7.5)
    expect(fraisDoDia(dia([srv('1', '05h00', '11h00', 6 * H, { frais: 7.5, fraisManual: true })]), o)).toBe(7.5)
  })
  it('dados antigos (sem marca) comportam-se como antes', () => {
    const g = dia([srv('1', '05h00', '11h00', 6 * H, { frais: 99 }), srv('2', '14h00', '19h00', 5 * H, { frais: 99 })])
    expect(fraisDoDia(g, o)).toBe(20.78)
    expect(resumoDia(g, o).fraisManual).toBe(false)
  })
  it('apagar o serviço manual: o dia volta ao cálculo automático', () => {
    const g = dia([srv('2', '14h00', '19h00', 5 * H, { frais: 16.36 })])
    expect(fraisDoDia(g, o)).toBe(16.36)
  })
})

describe('frais — decidirFraisManualForm (formulário da Home)', () => {
  it('valor igual ao automático = não manual', () => { expect(decidirFraisManualForm(20.78, null, 20.78)).toBe(false) })
  it('valor escrito à mão diferente do automático = manual', () => { expect(decidirFraisManualForm(30, null, 20.78)).toBe(true) })
  it('editar sem tocar no valor mantém o estado anterior (manual continua manual)', () => {
    expect(decidirFraisManualForm(30, { frais: 30, manual: true }, null)).toBe(true)
    expect(decidirFraisManualForm(30, { frais: 30, manual: true }, 20.78)).toBe(true)
    expect(decidirFraisManualForm(20.78, { frais: 20.78, manual: false }, null)).toBe(false)
  })
  it('motorista volta ao valor automático: deixa de ser manual', () => { expect(decidirFraisManualForm(20.78, { frais: 30, manual: true }, 20.78)).toBe(false) })
  it('sem referência automática: escrever um valor num registo existente = manual; novo a 0 = não', () => {
    expect(decidirFraisManualForm(12, { frais: 5, manual: false }, null)).toBe(true)
    expect(decidirFraisManualForm(0, null, null)).toBe(false)
    expect(decidirFraisManualForm(8, null, null)).toBe(true)
  })
})

describe('frais — decidirFraisEdicao (Historique)', () => {
  const antes = { type: 'TRAB', debut: '05h00', fin: '11h00', segServico: 6 * H, decouche: false, frais: 30, fraisManual: true }
  it('editar só nota/km (nada que determine os frais mudou): mantém o manual', () => {
    const d = decidirFraisEdicao(antes, { type: 'TRAB', debut: '05h00', fin: '11h00', segServico: 6 * H, decouche: false }, 20.78)
    expect(d).toEqual({ frais: 30, fraisManual: true, motivo: 'manual_preservado' })
  })
  it('horas alteradas: recalcula e perde a marca (alteração explícita do motorista)', () => {
    const d = decidirFraisEdicao(antes, { type: 'TRAB', debut: '04h00', fin: '11h00', segServico: 7 * H, decouche: false }, 25)
    expect(d).toEqual({ frais: 25, fraisManual: false, motivo: 'recalculado_por_alteracao' })
  })
  it('tipo alterado (TRAB→DEC): recalcula', () => {
    expect(decidirFraisEdicao(antes, { type: 'DEC', debut: '05h00', fin: '11h00', segServico: 6 * H, decouche: true }, 40).fraisManual).toBe(false)
  })
  it('registo sem marca (dados antigos): recalcula como sempre', () => {
    const d = decidirFraisEdicao({ ...antes, fraisManual: undefined }, { type: 'TRAB', debut: '05h00', fin: '11h00', segServico: 6 * H }, 20.78)
    expect(d).toEqual({ frais: 20.78, fraisManual: false, motivo: 'sem_manual' })
  })
})
