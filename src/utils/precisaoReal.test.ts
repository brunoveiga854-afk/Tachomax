import { somaPremios, premiosNoTotal, recebidoSemPremios, pontuarAcerto } from './precisaoReal'

describe('pontuarAcerto', () => {
  it('escalões', () => {
    expect(pontuarAcerto(2000, 2030)).toBe(100)
    expect(pontuarAcerto(2000, 2031)).toBe(98)
    expect(pontuarAcerto(2000, 2070)).toBe(98)
    expect(pontuarAcerto(2000, 2071)).toBe(95)
    expect(pontuarAcerto(2000, 2120)).toBe(95)
    expect(pontuarAcerto(2000, 2121)).toBe(88)
    expect(pontuarAcerto(2000, 2200)).toBe(88)
  })
  it('acima de 200€: 100 − diff/real', () => expect(pontuarAcerto(2000, 2300)).toBe(87))
  it('sem estimativa ou sem recebido → null', () => {
    expect(pontuarAcerto(0, 2000)).toBeNull()
    expect(pontuarAcerto(2000, 0)).toBeNull()
  })
})

describe('somaPremios', () => {
  it('soma os 5 campos', () =>
    expect(somaPremios({ interessement: 1, primeExceptionnelle: 2, participationSalariale: 4, primeNonAccident: 8, autresPrimes: 16 })).toBe(31))
  it('campos em falta valem 0', () => expect(somaPremios({})).toBe(0))
})

describe('recebidoSemPremios', () => {
  it('(a) mês sem prémios: igual ao total', () =>
    expect(recebidoSemPremios({ netPaye: 2000, remboursementFrais: 310, montantTotalRecu: 2310 })).toBe(2310))
  it('manual: prémio registado mas total = net + frais → não desconta', () =>
    expect(recebidoSemPremios({ netPaye: 2000, fraisRecuConfirme: 310, primeNonAccident: 549, montantTotalRecu: 2310 })).toBe(2310))
  it('(b) auto/extras: total inclui o prémio de 549 € → desconta', () =>
    expect(recebidoSemPremios({ netPaye: 2000, remboursementFrais: 310, primeNonAccident: 549, montantTotalRecu: 2859 })).toBe(2310))
  it('desconto parcial: nunca mais do que o excesso', () =>
    expect(recebidoSemPremios({ netPaye: 2000, remboursementFrais: 310, primeNonAccident: 549, montantTotalRecu: 2500 })).toBe(2310))
  it('desconto limitado aos prémios registados', () =>
    expect(recebidoSemPremios({ netPaye: 2000, remboursementFrais: 0, primeNonAccident: 100, montantTotalRecu: 2900 })).toBe(2800))
  it('na dúvida nos frais usa o maior (desconta menos)', () =>
    expect(premiosNoTotal({ netPaye: 2000, fraisRecuConfirme: 100, remboursementFrais: 400, primeNonAccident: 549, montantTotalRecu: 2859 })).toBe(459))
  it('sem total → 0', () => expect(recebidoSemPremios({ primeNonAccident: 549 })).toBe(0))
})

describe('exemplo 549 €: estimativa 2300', () => {
  const mes = { netPaye: 2000, remboursementFrais: 310, primeNonAccident: 549, montantTotalRecu: 2859 }
  it('antes (com prémio) 80%', () => expect(pontuarAcerto(2300, mes.montantTotalRecu)).toBe(80))
  it('depois (sem prémio) 100%', () => expect(pontuarAcerto(2300, recebidoSemPremios(mes))).toBe(100))
})
