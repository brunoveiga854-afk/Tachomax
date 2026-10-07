// src/utils/kmUltimoFim.troca.test.ts
import { kmUltimoFimAposApagar } from './kmUltimoFim'

const parte = (kmI: number, kmF: number) => ({ camiao: { type: 'immat' as const, value: 'AB-123-CD' }, kmInicio: kmI, kmFim: kmF })
const diaTroca = (id: string, date: string, kmFimA: number, kmFimB: number) => ({
  id, date, kmFim: kmFimA, troca: { a: parte(30000, kmFimA), b: parte(50000, kmFimB), segParaPausa: 0 },
})
const dia = (id: string, date: string, kmFim?: number) => ({ id, date, kmFim })

describe('kmUltimoFimAposApagar com troca de camião', () => {
  it('apagar o dia mais recente com troca (guardado = fim de B) → km do dia anterior', () => {
    const lista = [diaTroca('3', '03/10/2026', 30400, 50400), dia('2', '02/10/2026', 30200)]
    expect(kmUltimoFimAposApagar(lista, ['3'], '50400')).toBe(30200)
  })
  it('guardado igual ao fim de A (não ao de B) → null', () => {
    const lista = [diaTroca('3', '03/10/2026', 30400, 50400), dia('2', '02/10/2026', 30200)]
    expect(kmUltimoFimAposApagar(lista, ['3'], '30400')).toBeNull()
  })
  it('dia troca com fim de B a 0 no topo: apagá-lo → null (o mais recente com km é o anterior)', () => {
    const lista = [diaTroca('3', '03/10/2026', 30400, 0), dia('2', '02/10/2026', 30200)]
    expect(kmUltimoFimAposApagar(lista, ['3'], '30200')).toBeNull()
  })
  it('dia anterior com troca → devolve o fim de B dele', () => {
    const lista = [dia('3', '03/10/2026', 50900), diaTroca('2', '02/10/2026', 30400, 50400)]
    expect(kmUltimoFimAposApagar(lista, ['3'], '50900')).toBe(50400)
  })
})
