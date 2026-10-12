// km_ultimo_fim com vários serviços no mesmo dia: o «último» é o que começa mais tarde.
import { kmUltimoFimAposApagar } from './kmUltimoFim'

const s1 = { id: '1', date: '13/10/2026', debut: '06h00', kmFim: 1100 }
const s2 = { id: '2', date: '13/10/2026', debut: '14h00', kmFim: 1250 }

describe('kmUltimoFimAposApagar — vários serviços no mesmo dia', () => {
  it('apagar o 2.º serviço (o último do dia): km volta ao fim do 1.º', () => {
    expect(kmUltimoFimAposApagar([s1, s2], ['2'], '1250')).toBe(1100)
    expect(kmUltimoFimAposApagar([s2, s1], ['2'], '1250')).toBe(1100)   // independente da ordem na lista
  })
  it('apagar o 1.º serviço: km_ultimo_fim não muda (o último continua a ser o 2.º)', () => {
    expect(kmUltimoFimAposApagar([s1, s2], ['1'], '1250')).toBeNull()
    expect(kmUltimoFimAposApagar([s2, s1], ['1'], '1250')).toBeNull()
  })
  it('registos antigos sem hora: comportamento de sempre', () => {
    const a = { id: 'a', date: '12/10/2026', kmFim: 900 }
    const b = { id: 'b', date: '13/10/2026', kmFim: 1000 }
    expect(kmUltimoFimAposApagar([a, b], ['b'], '1000')).toBe(900)
  })
})
