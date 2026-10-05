import { chaveDia, mesmoDia } from './chaveDia'

const idEm = (a: number, m: number, d: number, h = 12, min = 0) => String(new Date(a, m - 1, d, h, min).getTime())

describe('chaveDia', () => {
  it('DD/MM/AAAA passa igual', () => {
    expect(chaveDia('04/10/2026', idEm(2026, 10, 4))).toBe('04/10/2026')
  })
  it('acrescenta zeros e tira espaços', () => {
    expect(chaveDia(' 1/2/2026 ')).toBe('01/02/2026')
  })
  it('DD/MM usa o ano do id', () => {
    expect(chaveDia('04/10', idEm(2026, 10, 4, 15))).toBe('04/10/2026')
  })
  it('aceita o id como número', () => {
    expect(chaveDia('04/10', new Date(2026, 9, 4, 15).getTime())).toBe('04/10/2026')
  })
  it('serviço que passa a meia-noite no mesmo ano mantém o dia do início', () => {
    expect(chaveDia('04/10', idEm(2026, 10, 5, 2))).toBe('04/10/2026')
  })
  it('serviço iniciado a 31/12 e terminado em Janeiro fica no ano anterior', () => {
    expect(chaveDia('31/12', idEm(2027, 1, 1, 3))).toBe('31/12/2026')
  })
  it('data com ano ignora o ano do id (dia de Dezembro acrescentado em Janeiro)', () => {
    expect(chaveDia('20/12/2026', idEm(2027, 1, 8))).toBe('20/12/2026')
  })
  it('as duas formas do mesmo dia dão a mesma chave (o bug dos duplicados)', () => {
    const terminado = chaveDia('04/10', idEm(2026, 10, 4, 14))
    const migrado = chaveDia('04/10/2026', idEm(2026, 10, 4, 9))
    expect(terminado).toBe(migrado)
  })
  it('é idempotente', () => {
    const uma = chaveDia('04/10', idEm(2026, 10, 4))!
    expect(chaveDia(uma, idEm(2030, 1, 1))).toBe(uma)
  })
  it('anos bissextos', () => {
    expect(chaveDia('29/02/2028')).toBe('29/02/2028')
    expect(chaveDia('29/02/2027')).toBeNull()
    expect(chaveDia('29/02', idEm(2028, 2, 29))).toBe('29/02/2028')
  })
  it('datas inválidas devolvem null', () => {
    for (const d of ['31/02/2026', '32/01/2026', '10/13/2026', '00/05/2026', 'abc', '', '04', '04//2026', '04/10/26', '04/10/2026/1']) {
      expect(chaveDia(d, idEm(2026, 10, 4))).toBeNull()
    }
    expect(chaveDia(undefined)).toBeNull()
    expect(chaveDia(null)).toBeNull()
  })
  it('sem ano e sem id utilizável devolve null', () => {
    expect(chaveDia('04/10')).toBeNull()
    expect(chaveDia('04/10', '')).toBeNull()
    expect(chaveDia('04/10', 'xyz')).toBeNull()
  })
  it('simula o filtro de guardarDia: o serviço já migrado é encontrado', () => {
    const lista = [{ date: '04/10/2026', id: idEm(2026, 10, 4, 9) }]
    const novo = { date: '04/10', id: idEm(2026, 10, 4, 18) }
    const existe = lista.some(j => chaveDia(j.date, j.id) === chaveDia(novo.date, novo.id))
    expect(existe).toBe(true)
  })
})

describe('mesmoDia', () => {
  it('reconhece o mesmo dia nos dois formatos', () => {
    expect(mesmoDia({ date: '04/10/2026', id: idEm(2026, 10, 4, 9) }, { date: '04/10', id: idEm(2026, 10, 4, 18) })).toBe(true)
  })
  it('dias diferentes não coincidem', () => {
    expect(mesmoDia({ date: '04/10/2026', id: idEm(2026, 10, 4) }, { date: '05/10', id: idEm(2026, 10, 5) })).toBe(false)
  })
  it('o mesmo dia de anos diferentes não coincide', () => {
    expect(mesmoDia({ date: '04/10/2025' }, { date: '04/10/2026' })).toBe(false)
  })
  it('se uma data não for utilizável, volta à comparação de texto', () => {
    expect(mesmoDia({ date: '04/10' }, { date: '04/10' })).toBe(true)
    expect(mesmoDia({ date: '04/10' }, { date: '04/10/2026', id: idEm(2026, 10, 4) })).toBe(false)
    expect(mesmoDia({ date: undefined }, { date: undefined })).toBe(true)
  })
})
