// src/utils/calculos.test.ts
// Testes unitários para src/utils/calculos.ts (TachoOffice)

import { shiftMois, calcFraisMesPorHorarios, PadraoFrais } from './calculos'
import { DEFAULT_FRAIS_REGLES, DEFAULT_FRAIS_VALEURS } from '../frais'

// ─── Mock reutilizável ────────────────────────────────────────────────────────

const padraoMock: PadraoFrais = {
  ptd: DEFAULT_FRAIS_VALEURS.ptDej,   // 4.42
  dej: DEFAULT_FRAIS_VALEURS.dej,     // 16.36
  din: DEFAULT_FRAIS_VALEURS.diner,   // 23.94
  nui: DEFAULT_FRAIS_VALEURS.nuit,    // 23.94
  regles: {
    ptDejAte:  DEFAULT_FRAIS_REGLES.ptDejAte,   // 6.0 h
    dejMinAmp: DEFAULT_FRAIS_REGLES.dejMinAmp,  // 6.017 h
    dinerDe:   DEFAULT_FRAIS_REGLES.dinerDe,    // 21.25 h
  },
}

// ─── 1. shiftMois ─────────────────────────────────────────────────────────────

describe('shiftMois', () => {
  it('delta 0 não muda ano nem mês', () => {
    const [a, m] = shiftMois(2026, 3, 0)
    expect(a).toBe(2026)
    expect(m).toBe(3)
  })

  it('delta positivo avança o mês correctamente', () => {
    const [a, m] = shiftMois(2026, 3, 2) // Abril + 2 = Junho
    expect(a).toBe(2026)
    expect(m).toBe(5)
  })

  it('delta negativo recua o mês correctamente', () => {
    const [a, m] = shiftMois(2026, 5, -2) // Junho - 2 = Abril
    expect(a).toBe(2026)
    expect(m).toBe(3)
  })

  it('overflow: mês 11 + 1 → mês 0 do ano seguinte', () => {
    const [a, m] = shiftMois(2026, 11, 1) // Dezembro + 1 = Janeiro 2027
    expect(a).toBe(2027)
    expect(m).toBe(0)
  })

  it('underflow: mês 0 - 1 → mês 11 do ano anterior', () => {
    const [a, m] = shiftMois(2026, 0, -1) // Janeiro - 1 = Dezembro 2025
    expect(a).toBe(2025)
    expect(m).toBe(11)
  })

  it('delta +14 meses atravessa dois anos (Janeiro 2025 → Março 2026)', () => {
    const [a, m] = shiftMois(2025, 0, 14)
    expect(a).toBe(2026)
    expect(m).toBe(2)
  })

  it('delta -13 meses atravessa dois anos (Janeiro 2026 → Dezembro 2024)', () => {
    const [a, m] = shiftMois(2026, 0, -13)
    expect(a).toBe(2024)
    expect(m).toBe(11)
  })

  it('resultado mês está sempre no range [0, 11] para qualquer delta', () => {
    for (let delta = -24; delta <= 24; delta++) {
      const [, m] = shiftMois(2026, 6, delta)
      expect(m).toBeGreaterThanOrEqual(0)
      expect(m).toBeLessThanOrEqual(11)
    }
  })
})

// ─── 2. calcFraisMesPorHorarios ───────────────────────────────────────────────

describe('calcFraisMesPorHorarios', () => {
  it('array vazio retorna zeros', () => {
    const result = calcFraisMesPorHorarios([], 2026, 3, padraoMock)
    expect(result.total).toBe(0)
    expect(result.ptd).toBe(0)
    expect(result.dej).toBe(0)
    expect(result.din).toBe(0)
    expect(result.nui).toBe(0)
  })

  it('dia TRAB com início cedo e serviço longo gera ptd=1, dej=1, din=0, nui=0', () => {
    const hist = [{
      date: '15/04',    // Abril → mes=3
      type: 'TRAB',
      debut: '05:00',   // 300min ≤ 360 (ptDejAte 6h) → ptd
      fin: '14:00',
      segServico: 32400, // 540min ≥ 361 (dejMinAmp 6h01) → dej
    }]
    const result = calcFraisMesPorHorarios(hist, 2026, 3, padraoMock)
    expect(result.total).toBeGreaterThan(0)
    expect(result.ptd).toBe(1)
    expect(result.dej).toBe(1)
    expect(result.din).toBe(0)
    expect(result.nui).toBe(0)
  })

  it('dia OFF não gera frais (total=0)', () => {
    const hist = [{
      date: '15/04',
      type: 'OFF',
      debut: '05:00',
      fin: '14:00',
      segServico: 32400,
    }]
    const result = calcFraisMesPorHorarios(hist, 2026, 3, padraoMock)
    expect(result.total).toBe(0)
  })

  it('filtra dias de outros meses — só conta o mês/ano correcto', () => {
    const hist = [
      { date: '15/04', type: 'TRAB', debut: '05:00', fin: '14:00', segServico: 32400 }, // Abril ✅
      { date: '15/05', type: 'TRAB', debut: '05:00', fin: '14:00', segServico: 32400 }, // Maio  ❌
      { date: '01/04', type: 'TRAB', debut: '05:00', fin: '14:00', segServico: 32400 }, // Abril ✅
    ]
    const abril = calcFraisMesPorHorarios(hist, 2026, 3, padraoMock)
    const maio  = calcFraisMesPorHorarios(hist, 2026, 4, padraoMock)

    expect(abril.dej).toBe(2) // 2 dias Abril
    expect(maio.dej).toBe(1)  // 1 dia Maio
  })

  it('dia DEC (découchée) gera ptd+dej+din+nui todos a 1', () => {
    const hist = [{
      date: '10/04',
      type: 'DEC',
      debut: '05:00',
      fin: '23:00',
      segServico: 54000,
      decouche: true,
    }]
    const result = calcFraisMesPorHorarios(hist, 2026, 3, padraoMock)
    expect(result.ptd).toBe(1)
    expect(result.dej).toBe(1)
    expect(result.din).toBe(1)
    expect(result.nui).toBe(1)
    expect(result.total).toBeGreaterThan(0)
  })

  it('dia sem horários mas com j.frais > 0 usa frais directo como fallback', () => {
    const hist = [{
      date: '10/04',
      type: 'TRAB',
      debut: '',   // sem horários — cai no fallback
      fin: '',
      frais: 20.78,
    }]
    const result = calcFraisMesPorHorarios(hist, 2026, 3, padraoMock)
    expect(result.total).toBe(20.78)
    expect(result.ptd).toBe(1) // fallback incrementa ptd
  })

  it('acumula correctamente múltiplos dias: ptd só nos de início cedo', () => {
    const hist = [
      { date: '10/04', type: 'TRAB', debut: '05:00', fin: '14:00', segServico: 32400 }, // ptd+dej
      { date: '11/04', type: 'TRAB', debut: '07:00', fin: '16:00', segServico: 32400 }, // só dej
    ]
    const result = calcFraisMesPorHorarios(hist, 2026, 3, padraoMock)
    expect(result.ptd).toBe(1) // só o dia 10 tem início cedo
    expect(result.dej).toBe(2) // ambos os dias têm serviço ≥ 6h01
    expect(result.total).toBeCloseTo(
      DEFAULT_FRAIS_VALEURS.ptDej + DEFAULT_FRAIS_VALEURS.dej * 2,
      2
    )
  })
})
