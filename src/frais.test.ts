// src/frais.test.ts
// Testes unitários para src/frais.ts (TachoOffice)

import {
  sanitizeFraisRegles,
  sanitizeFraisValeurs,
  isJourSansFrais,
  isJourTravailFrais,
  parseHeureToMinutes,
  calcularFraisJour,
  DEFAULT_FRAIS_REGLES,
  DEFAULT_FRAIS_VALEURS,
} from './frais'

// ─── 1. sanitizeFraisRegles ───────────────────────────────────────────────────

describe('sanitizeFraisRegles', () => {
  it('valores dentro dos bounds passam sem alteração', () => {
    const result = sanitizeFraisRegles({
      ptDejAte: 6.5,   // ∈ [5, 8]
      dejMinAmp: 6.5,  // ∈ [4, 8]
      dinerDe: 21.0,   // ∈ [18, 23]
    })
    expect(result.ptDejAte).toBe(6.5)
    expect(result.dejMinAmp).toBe(6.5)
    expect(result.dinerDe).toBe(21.0)
  })

  it('valor abaixo do bound mínimo é corrigido para o fallback', () => {
    const result = sanitizeFraisRegles({ ptDejAte: 3 }) // < 5
    expect(result.ptDejAte).toBe(DEFAULT_FRAIS_REGLES.ptDejAte)
  })

  it('valor acima do bound máximo é corrigido para o fallback', () => {
    const result = sanitizeFraisRegles({ ptDejAte: 9 }) // > 8
    expect(result.ptDejAte).toBe(DEFAULT_FRAIS_REGLES.ptDejAte)
  })

  it('NaN é corrigido para o fallback', () => {
    const result = sanitizeFraisRegles({ dejMinAmp: NaN })
    expect(result.dejMinAmp).toBe(DEFAULT_FRAIS_REGLES.dejMinAmp)
  })

  it('null usa DEFAULT_FRAIS_REGLES completo', () => {
    const result = sanitizeFraisRegles(null)
    expect(result).toEqual(DEFAULT_FRAIS_REGLES)
  })
})

// ─── 2. sanitizeFraisValeurs ──────────────────────────────────────────────────

describe('sanitizeFraisValeurs', () => {
  it('valores positivos passam sem alteração', () => {
    const result = sanitizeFraisValeurs({ ptDej: 5.0, dej: 17.0, diner: 24.0, nuit: 24.0 })
    expect(result.ptDej).toBe(5.0)
    expect(result.dej).toBe(17.0)
    expect(result.diner).toBe(24.0)
    expect(result.nuit).toBe(24.0)
  })

  it('zero é válido (limite inferior ≥ 0)', () => {
    const result = sanitizeFraisValeurs({ ptDej: 0 })
    expect(result.ptDej).toBe(0)
  })

  it('valores negativos são corrigidos para o fallback', () => {
    const result = sanitizeFraisValeurs({ ptDej: -1, dej: -5 })
    expect(result.ptDej).toBe(DEFAULT_FRAIS_VALEURS.ptDej)
    expect(result.dej).toBe(DEFAULT_FRAIS_VALEURS.dej)
  })

  it('NaN é corrigido para o fallback', () => {
    const result = sanitizeFraisValeurs({ nuit: NaN })
    expect(result.nuit).toBe(DEFAULT_FRAIS_VALEURS.nuit)
  })

  it('null usa DEFAULT_FRAIS_VALEURS completo', () => {
    const result = sanitizeFraisValeurs(null)
    expect(result).toEqual(DEFAULT_FRAIS_VALEURS)
  })
})

// ─── 3. isJourSansFrais ───────────────────────────────────────────────────────

describe('isJourSansFrais', () => {
  it.each(['OFF', 'RC', 'FERIE', 'FER', 'vac', 'CONGE', 'FERIADO', 'hol'])(
    'retorna true para tipo "%s"',
    (type) => { expect(isJourSansFrais(type)).toBe(true) }
  )

  it.each(['TRAB', 'DEC', 'work', 'dec'])(
    'retorna false para tipo "%s"',
    (type) => { expect(isJourSansFrais(type)).toBe(false) }
  )

  it('retorna false para undefined', () => {
    expect(isJourSansFrais(undefined)).toBe(false)
  })
})

// ─── 4. isJourTravailFrais ────────────────────────────────────────────────────

describe('isJourTravailFrais', () => {
  it.each(['TRAB', 'DEC', 'work', 'dec'])(
    'retorna true para tipo "%s"',
    (type) => { expect(isJourTravailFrais(type)).toBe(true) }
  )

  it.each(['OFF', 'RC', 'FERIE', 'FER'])(
    'retorna false para tipo "%s"',
    (type) => { expect(isJourTravailFrais(type)).toBe(false) }
  )

  it('retorna false para undefined', () => {
    expect(isJourTravailFrais(undefined)).toBe(false)
  })
})

// ─── 5. parseHeureToMinutes ───────────────────────────────────────────────────

describe('parseHeureToMinutes', () => {
  it('"08:30" → 510', () => {
    expect(parseHeureToMinutes('08:30')).toBe(510)
  })

  it('"8h30" → 510 (formato alternativo com h)', () => {
    expect(parseHeureToMinutes('8h30')).toBe(510)
  })

  it('"00:00" → 0 (meia-noite)', () => {
    expect(parseHeureToMinutes('00:00')).toBe(0)
  })

  it('"23:59" → 1439 (fim do dia)', () => {
    expect(parseHeureToMinutes('23:59')).toBe(1439)
  })

  it('string vazia → null', () => {
    expect(parseHeureToMinutes('')).toBeNull()
  })

  it('null → null', () => {
    expect(parseHeureToMinutes(null)).toBeNull()
  })

  it('undefined → null', () => {
    expect(parseHeureToMinutes(undefined)).toBeNull()
  })

  it('"25:00" (hora inválida) → null', () => {
    expect(parseHeureToMinutes('25:00')).toBeNull()
  })

  it('"08:60" (minutos inválidos) → null', () => {
    expect(parseHeureToMinutes('08:60')).toBeNull()
  })

  it('string não-numérica → null', () => {
    expect(parseHeureToMinutes('abc')).toBeNull()
  })
})

// ─── 6. calcularFraisJour ─────────────────────────────────────────────────────

describe('calcularFraisJour', () => {
  it('TRAB com início cedo + serviço longo → ptd=1, dej=1, din=0, nui=0', () => {
    const result = calcularFraisJour({
      type: 'TRAB',
      debut: '05:00',    // 300min ≤ 360 (ptDejAte 6h) → ptd
      segServico: 22000, // 366min ≥ 361 (dejMinAmp 6h01) → dej
      decouche: false,
    })
    expect(result.ptd).toBe(1)
    expect(result.dej).toBe(1)
    expect(result.din).toBe(0)
    expect(result.nui).toBe(0)
    expect(result.total).toBeGreaterThan(0)
  })

  it('TRAB com início após 06h00 → ptd=0', () => {
    const result = calcularFraisJour({
      type: 'TRAB',
      debut: '07:00',    // 420min > 360 → sem ptd
      segServico: 22000,
    })
    expect(result.ptd).toBe(0)
    expect(result.dej).toBe(1)
  })

  it('DEC (découchée) → ptd+dej+din+nui todos presentes', () => {
    const result = calcularFraisJour({
      type: 'DEC',
      debut: '05:00',
      decouche: true,
    })
    expect(result.ptd).toBe(1)
    expect(result.dej).toBe(1)
    expect(result.din).toBe(1)
    expect(result.nui).toBe(1)
    expect(result.details).toHaveLength(4)
    expect(result.total).toBeGreaterThan(0)
  })

  it('prevDecouche=true → ptd=1 mesmo com início tardio', () => {
    const result = calcularFraisJour({
      type: 'TRAB',
      debut: '09:00',       // 540min > 360 — normalmente sem ptd
      prevDecouche: true,   // decouche do dia anterior força ptd
      segServico: 22000,
    })
    expect(result.ptd).toBe(1)
  })

  it('OFF → total=0 e todos os componentes a zero', () => {
    const result = calcularFraisJour({ type: 'OFF' })
    expect(result.ptd).toBe(0)
    expect(result.dej).toBe(0)
    expect(result.din).toBe(0)
    expect(result.nui).toBe(0)
    expect(result.total).toBe(0)
    expect(result.details).toHaveLength(0)
  })

  it.each(['RC', 'FERIE', 'FER', 'CONGE'])(
    'tipo %s → total=0 (sem frais)',
    (type) => {
      expect(calcularFraisJour({ type }).total).toBe(0)
    }
  )

  it('total é consistente com a soma dos componentes × DEFAULT_FRAIS_VALEURS', () => {
    const v = DEFAULT_FRAIS_VALEURS
    const result = calcularFraisJour({ type: 'DEC', debut: '05:00', decouche: true })
    const esperado =
      result.ptd * v.ptDej +
      result.dej * v.dej +
      result.din * v.diner +
      result.nui * v.nuit
    expect(result.total).toBeCloseTo(esperado, 2)
  })

  it('serviço <6h01 sem decouche → dej=0, din=0, nui=0', () => {
    const result = calcularFraisJour({
      type: 'TRAB',
      debut: '08:00',
      segServico: 18000, // 300min < 361 → sem dej
      decouche: false,
    })
    expect(result.dej).toBe(0)
    expect(result.din).toBe(0)
    expect(result.nui).toBe(0)
  })
})
