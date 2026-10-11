import { totalHeuresInicial } from './totalHeuresFicha'

describe('totalHeuresInicial', () => {
  it('usa as horas de dados.totalHeures da própria ficha', () => {
    expect(totalHeuresInicial({ dados: { totalHeures: 171.5 } })).toBe('171.5')
  })
  it('usa totalHeures no topo se não houver dados', () => {
    expect(totalHeuresInicial({ totalHeures: 160 })).toBe('160')
  })
  it('ficha sem horas → vazio (não herda a ficha anterior)', () => {
    expect(totalHeuresInicial({ dados: { totalHeures: 0 } })).toBe('')
    expect(totalHeuresInicial({ dados: {} })).toBe('')
    expect(totalHeuresInicial(null)).toBe('')
    expect(totalHeuresInicial(undefined)).toBe('')
  })
  it('duas fichas seguidas: cada uma dá o seu valor, independente da ordem', () => {
    const f1 = { dados: { totalHeures: 190 } }
    const f2 = { dados: { totalHeures: 0 } }
    const f3 = { dados: { totalHeures: 150.25 } }
    expect([f1, f2, f3].map(totalHeuresInicial)).toEqual(['190', '', '150.25'])
    expect([f3, f2, f1].map(totalHeuresInicial)).toEqual(['150.25', '', '190'])
  })
})
