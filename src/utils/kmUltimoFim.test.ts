// src/utils/kmUltimoFim.test.ts
import { kmUltimoFimAposApagar } from './kmUltimoFim'

const dia = (id: string, date: string, kmFim?: number) => ({ id, date, kmFim })

const lista = [
  dia('3', '03/10/2026', 30500),
  dia('2', '02/10/2026', 30200),
  dia('1', '01/10/2026', 29900),
]

describe('kmUltimoFimAposApagar', () => {
  it('apaga o dia mais recente com km → km do dia anterior com km', () => {
    expect(kmUltimoFimAposApagar(lista, ['3'], '30500')).toBe(30200)
  })

  it('apaga um dia que não é o mais recente → null', () => {
    expect(kmUltimoFimAposApagar(lista, ['2'], '30500')).toBeNull()
  })

  it('não há dia anterior com km → 0', () => {
    const so = [dia('3', '03/10/2026', 30500), dia('2', '02/10/2026', 0), dia('1', '01/10/2026')]
    expect(kmUltimoFimAposApagar(so, ['3'], '30500')).toBe(0)
  })

  it('valor guardado diferente do kmFim do dia apagado → null', () => {
    expect(kmUltimoFimAposApagar(lista, ['3'], '31000')).toBeNull()
    expect(kmUltimoFimAposApagar(lista, ['3'], null)).toBeNull()
    expect(kmUltimoFimAposApagar(lista, ['3'], '')).toBeNull()
  })

  it('compara com o kmFim arredondado', () => {
    const l = [dia('3', '03/10/2026', 30500.4), dia('2', '02/10/2026', 30200.6)]
    expect(kmUltimoFimAposApagar(l, ['3'], '30500')).toBe(30201)
  })

  it('vários dias apagados de uma vez → km do mais recente que fica', () => {
    expect(kmUltimoFimAposApagar(lista, ['3', '2'], '30500')).toBe(29900)
    expect(kmUltimoFimAposApagar(lista, ['3', '2', '1'], '30500')).toBe(0)
  })

  it('vários apagados sem o mais recente → null', () => {
    expect(kmUltimoFimAposApagar(lista, ['2', '1'], '30500')).toBeNull()
  })

  it('ordena por data, não pela posição na lista', () => {
    const desordenada = [dia('1', '01/10/2026', 29900), dia('3', '03/10/2026', 30500), dia('2', '02/10/2026', 30200)]
    expect(kmUltimoFimAposApagar(desordenada, ['3'], '30500')).toBe(30200)
  })
})
