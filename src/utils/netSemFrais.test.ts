import { netSemFrais, provaDeFiche } from './netSemFrais'

// Dados de TESTE (Pasta Segura), não da app real. cotisations = brut − netSocial (derivado).
const PROVA = { netSocial: 2571.71, pas: 71.89, brut: 3296.49, cotisations: 724.78, primesNoNet: 0 }
const NET = 3402.43, FRAIS = 902.61

describe('netSemFrais', () => {
  it('frais zero', () => expect(netSemFrais(NET, 0, PROVA)).toEqual({ valor: NET, estado: 'excluido' }))
  it('inclusão provada (junho de teste)', () =>
    expect(netSemFrais(NET, FRAIS, PROVA)).toEqual({ valor: 2499.82, estado: 'incluido' }))
  it('o mesmo caso SEM prova: inalterado', () => {
    expect(netSemFrais(NET, FRAIS)).toEqual({ valor: NET, estado: 'desconhecido' })
    expect(netSemFrais(NET, FRAIS, {})).toEqual({ valor: NET, estado: 'desconhecido' })
  })
  it('exclusão confirmada', () =>
    expect(netSemFrais(2499.82, FRAIS, PROVA)).toEqual({ valor: 2499.82, estado: 'excluido' }))
  it('frais iguais ou superiores ao net: não devolve zero', () => {
    expect(netSemFrais(500, 500, PROVA)).toEqual({ valor: 500, estado: 'frais_excedem_net' })
    expect(netSemFrais(500, 900, PROVA)).toEqual({ valor: 500, estado: 'frais_excedem_net' })
  })
  it('valores ausentes / undefined / NaN / Infinity / string / negativos', () => {
    expect(netSemFrais(undefined, 100, PROVA)).toEqual({ valor: 0, estado: 'desconhecido' })
    expect(netSemFrais(NaN, 100, PROVA)).toEqual({ valor: 0, estado: 'desconhecido' })
    expect(netSemFrais(Infinity, 50, PROVA)).toEqual({ valor: 0, estado: 'desconhecido' })
    expect(netSemFrais('3402.43', FRAIS, PROVA)).toEqual({ valor: 0, estado: 'desconhecido' })
    expect(netSemFrais(1000, undefined, PROVA)).toEqual({ valor: 1000, estado: 'desconhecido' })
    expect(netSemFrais(1000, NaN, PROVA)).toEqual({ valor: 1000, estado: 'desconhecido' })
    expect(netSemFrais(1000, -50, PROVA)).toEqual({ valor: 1000, estado: 'desconhecido' })
    expect(netSemFrais(-1000, 50, PROVA)).toEqual({ valor: -1000, estado: 'desconhecido' })
  })
  it('prova inválida ou que não fecha', () => {
    expect(netSemFrais(NET, FRAIS, { ...PROVA, netSocial: NaN }).estado).toBe('desconhecido')
    expect(netSemFrais(NET, FRAIS, { ...PROVA, netSocial: 2000, cotisations: 1296.49 })).toEqual({ valor: NET, estado: 'desconhecido' })
  })
  it('frais minúsculos que fecham nos dois lados: desconhecido', () =>
    expect(netSemFrais(2499.82, 0.01, PROVA)).toEqual({ valor: 2499.82, estado: 'desconhecido' }))

  // uma por salvaguarda (cada caso passa as anteriores e falha só aquela; a conta fecharia)
  it('S1: pas = 0 (ausente por defeito) → desconhecido', () =>
    expect(netSemFrais(NET, FRAIS, { ...PROVA, pas: 0 })).toEqual({ valor: NET, estado: 'desconhecido' }))
  it('S1: netSocial = 0 → desconhecido', () =>
    expect(netSemFrais(NET, FRAIS, { ...PROVA, netSocial: 0 })).toEqual({ valor: NET, estado: 'desconhecido' }))
  it('S2: frais acima de 60 % do net social → desconhecido', () => {
    const ns = 1000, pas = 50, fr = 650, net = ns + fr - pas
    expect(netSemFrais(net, fr, { netSocial: ns, pas, brut: 1250, cotisations: 250, primesNoNet: 0 }).estado).toBe('desconhecido')
  })
  it('S3: net social incoerente com brut − cotisações → desconhecido', () =>
    expect(netSemFrais(NET, FRAIS, { ...PROVA, cotisations: 100 })).toEqual({ valor: NET, estado: 'desconhecido' }))
  it('S4: primes maiores que o net sem frais → desconhecido (e controlo sem primes → incluido)', () => {
    const base = { netSocial: 1000, pas: 50, brut: 1250, cotisations: 250 }
    expect(netSemFrais(1250, 300, { ...base, primesNoNet: 1000 })).toEqual({ valor: 1250, estado: 'desconhecido' })
    expect(netSemFrais(1250, 300, { ...base, primesNoNet: 0 })).toEqual({ valor: 950, estado: 'incluido' })
  })
  it('S5: net sem frais acima do bruto → desconhecido (e controlo com bruto maior → incluido)', () => {
    expect(netSemFrais(1260, 200, { netSocial: 1080, pas: 20, brut: 1000, cotisations: 10, primesNoNet: 0 }))
      .toEqual({ valor: 1260, estado: 'desconhecido' })
    expect(netSemFrais(1260, 200, { netSocial: 1080, pas: 20, brut: 1100, cotisations: 10, primesNoNet: 0 }))
      .toEqual({ valor: 1060, estado: 'incluido' })
  })
  it('S6: tolerância 0,02 aceita; 0,03 rejeita', () => {
    expect(netSemFrais(NET + 0.02, FRAIS, PROVA).estado).toBe('incluido')
    expect(netSemFrais(NET + 0.03, FRAIS, PROVA).estado).toBe('desconhecido')
  })
  it('S7: brut ou cotisations em falta → desconhecido', () => {
    expect(netSemFrais(NET, FRAIS, { ...PROVA, brut: undefined }).estado).toBe('desconhecido')
    expect(netSemFrais(NET, FRAIS, { ...PROVA, cotisations: undefined }).estado).toBe('desconhecido')
  })

  it('com estado diferente de incluido, valor devolvido = net recebido', () => {
    const casos: Array<[number, number, any]> = [
      [NET, FRAIS, undefined], [NET, 0, PROVA], [500, 500, PROVA], [NET, FRAIS, { ...PROVA, pas: 0 }],
      [2499.82, FRAIS, PROVA], [NET, FRAIS, { ...PROVA, brut: undefined }],
    ]
    for (const [n, f, p] of casos) {
      const r = netSemFrais(n, f, p)
      expect(r.estado).not.toBe('incluido')
      expect(r.valor).toBe(n)
    }
  })

  it('provaDeFiche lê dados || fiche e soma só as primes dentro do net', () => {
    const p = provaDeFiche({ netSocial: 1, interessement: 5, participationSalariale: 'x', primeExceptionnelle: 7 }, { pas: 2, salairebrut: 9 })
    expect(p).toEqual({ netSocial: 1, pas: 2, brut: 9, cotisations: undefined, primesNoNet: 12 })
  })
})
