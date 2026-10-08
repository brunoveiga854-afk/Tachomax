import { normalizarDataDia, chaveDia } from './dataDia'

const idDe = (ano: number) => String(new Date(ano, 5, 15, 12).getTime())

describe('normalizarDataDia', () => {
  it('curto → longo com o ano indicado', () => expect(normalizarDataDia('07/10', 2026)).toBe('07/10/2026'))
  it('longo → longo igual', () => expect(normalizarDataDia('07/10/2026', 2030)).toBe('07/10/2026'))
  it('virada de ano: 31/12 e 01/01 com o seu ano', () => {
    expect(normalizarDataDia('31/12', 2026)).toBe('31/12/2026')
    expect(normalizarDataDia('01/01', 2027)).toBe('01/01/2027')
  })
  it('entradas inválidas não lançam erro', () => {
    expect(() => normalizarDataDia(undefined, 2026)).not.toThrow()
    expect(normalizarDataDia(undefined, 2026)).toBe('')
    expect(normalizarDataDia(null, 2026)).toBe('')
    expect(normalizarDataDia(42, 2026)).toBe('')
    expect(normalizarDataDia('', 2026)).toBe('')
    expect(normalizarDataDia('abc', 2026)).toBe('abc')
    expect(normalizarDataDia('31/12/26', 2026)).toBe('31/12/26')
  })
  it('curto com ano inválido fica como veio', () => {
    expect(normalizarDataDia('07/10', NaN)).toBe('07/10')
    expect(normalizarDataDia('07/10', 12)).toBe('07/10')
  })
})

describe('chaveDia', () => {
  it('curta e longa do mesmo dia dão a mesma chave', () => {
    expect(chaveDia({ date: '07/10', id: idDe(2026) }, 1999)).toBe('07/10/2026')
    expect(chaveDia({ date: '07/10/2026', id: idDe(2026) }, 1999)).toBe('07/10/2026')
  })
  it('curta com id de outro ano é outro dia', () => {
    expect(chaveDia({ date: '07/10', id: idDe(2025) }, 2026)).not.toBe(chaveDia({ date: '07/10/2026', id: idDe(2026) }, 2026))
  })
  it('id inválido usa o fallback', () => expect(chaveDia({ date: '07/10', id: 'x' }, 2026)).toBe('07/10/2026'))
  it('entrada nula ou sem data não lança erro', () => {
    expect(chaveDia(null, 2026)).toBe('')
    expect(chaveDia(undefined, 2026)).toBe('')
    expect(chaveDia({}, 2026)).toBe('')
  })
})
