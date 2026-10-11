import { alertasFraisIncoerentes, bancoFraisFiavel, melhorFlagPorFontes, mesFraisTrabalhoFiavel } from './aprendizagemFlagFrais'
import { fixarLagsConfirmados, lagsParaBase } from './lagsConfirmados'

// mes: 0–11 (Set = 8, Out = 9, Nov = 10)
const P: any = { hlag: 2, flag: 1 }
const AP_FLAG1 = { hlag: 2, flag: 1, hlagConfirmado: true, flagConfirmado: true }
const fiche = (o: any): any => ({ periode: 'x', fichePages: 1, salarioConfirmado: true, montantTotalRecu: 1000, ...o })
const enchimento = [0, 1, 2].map(i => fiche({ moisIndex: i, annee: 2026 }))
const calc = (tabela: Record<number, number>) => (_a: number, m: number) => tabela[m] ?? 0

describe('flag sem auto-confirmação', () => {
  it('a fiche não é fonte de si própria (banco declarado ≠ rótulo, mesmo valor)', () => {
    const f = fiche({ moisIndex: 8, annee: 2026, fraisBoletim: 300, pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado' })
    expect(melhorFlagPorFontes([f], f, 300)).toBeNull()
  })
  it('outra fiche do mesmo mês também não conta', () => {
    const f = fiche({ moisIndex: 8, annee: 2026, fraisBoletim: 300, pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado' })
    const copia = fiche({ moisIndex: 8, annee: 2026, fraisBoletim: 300 })
    expect(melhorFlagPorFontes([f, copia], f, 300)).toBeNull()
  })
  it('flag=0 confirmado por fonte independente continua válido', () => {
    const fonte = fiche({ moisIndex: 9, annee: 2026, fraisBoletim: 300 })
    const conf = fiche({ moisIndex: 10, annee: 2026, fraisBoletim: 0, fraisConfirmado: true, fraisRecuConfirme: 300,
      pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado' })
    const r = melhorFlagPorFontes([fonte, conf], conf, 300)
    expect(r !== null && r.flag).toBe(0)
    const lags = lagsParaBase({ hlag: 2, flag: 1 }, { hlag: 2, flag: 0, hlagConfirmado: true, flagConfirmado: true })
    expect(lags.flag).toBe(0)
    expect(lags.flagTravado).toBe(true)
    expect(fixarLagsConfirmados({ hlag: 2, flag: 1 }, lags).flag).toBe(0)
  })
  it('data bancária inferida, desconhecida ou ausente não é prova', () => {
    const fonte = fiche({ moisIndex: 8, annee: 2026, fraisBoletim: 300 })
    for (const extra of [
      { pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'inferido' },
      { pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026 },
      {},
    ]) {
      const conf = fiche({ moisIndex: 10, annee: 2026, fraisConfirmado: true, fraisRecuConfirme: 300, ...extra })
      expect(bancoFraisFiavel(conf)).toBeNull()
      expect(melhorFlagPorFontes([fonte, conf], conf, 300)).toBeNull()
    }
  })
  it('trabalho Set / pagamento Out / fiche Nov: fonte independente Set → lag válido só com banco declarado', () => {
    const fonteSet = fiche({ moisIndex: 8, annee: 2026, fraisBoletim: 300 })
    const nov = fiche({ moisIndex: 10, annee: 2026, fraisBoletim: 300, fraisConfirmado: true, fraisRecuConfirme: 300,
      mesFraisTrabalhoIndex: 8, anoFraisTrabalho: 2026,
      pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado' })
    const r = melhorFlagPorFontes([fonteSet, nov], nov, 300)
    expect(r !== null && r.flag).toBe(1)
  })
})

describe('alertas de frais por período equivalente', () => {
  const nov = (o: any = {}) => fiche({ moisIndex: 10, annee: 2026, fraisBoletim: 300,
    mesFraisTrabalhoIndex: 8, anoFraisTrabalho: 2026,
    pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado', ...o })

  it('Set trabalho / Out pagamento / Nov fiche: compara com Set, não com Nov', () => {
    // Nov teria 500 esperado (alertaria se comparasse o rótulo); Set tem 300 (igual ao pago)
    expect(alertasFraisIncoerentes([...enchimento, nov()], calc({ 8: 300, 9: 100, 10: 500 }), P, AP_FLAG1)).toEqual([])
  })
  it('períodos equivalentes: avisa quando Set esperava mais do que o pago', () => {
    const r = alertasFraisIncoerentes([...enchimento, nov({ fraisBoletim: 250 })], calc({ 8: 300, 10: 100 }), P, AP_FLAG1)
    expect(r.length).toBe(1)
    expect(r[0].includes('300.00€')).toBe(true)
  })
  it('mês de trabalho derivado de banco declarado + flag confirmado', () => {
    const d = nov({ mesFraisTrabalhoIndex: undefined, anoFraisTrabalho: undefined, fraisBoletim: 250 })
    const m = mesFraisTrabalhoFiavel(d, P, AP_FLAG1)
    expect(m).toEqual({ ano: 2026, mes: 8 })
  })
  it('sem banco confirmado ou mês só inferido: nenhum alerta categórico', () => {
    const tab = calc({ 8: 300, 9: 300, 10: 300 })
    const semBanco = fiche({ moisIndex: 10, annee: 2026, fraisBoletim: 100 })
    const inferido = nov({ fraisBoletim: 100, pagamentoFraisOrigem: 'inferido' })
    const desconhecido = nov({ fraisBoletim: 100, pagamentoFraisOrigem: undefined })
    const semGravado = nov({ fraisBoletim: 100, mesFraisTrabalhoIndex: undefined, anoFraisTrabalho: undefined })
    expect(alertasFraisIncoerentes([...enchimento, semBanco], tab, P, AP_FLAG1)).toEqual([])
    expect(alertasFraisIncoerentes([...enchimento, inferido], tab, P, AP_FLAG1)).toEqual([])
    expect(alertasFraisIncoerentes([...enchimento, desconhecido], tab, P, AP_FLAG1)).toEqual([])
    // declarado mas flag NÃO confirmado e mês de trabalho não gravado → inferido
    expect(alertasFraisIncoerentes([...enchimento, semGravado], tab, P, { flag: 1, flagConfirmado: false })).toEqual([])
  })
  it('histórico antigo intacto: nada é alterado nem reescrito', () => {
    const dados = [...enchimento, nov({ fraisBoletim: 250 }), fiche({ moisIndex: 5, annee: 2026, fraisBoletim: 100, mesFraisTrabalhoIndex: 5, anoFraisTrabalho: 2026 })]
    const antes = JSON.stringify(dados)
    alertasFraisIncoerentes(dados, calc({ 8: 300, 5: 400 }), P, AP_FLAG1)
    melhorFlagPorFontes(dados, dados[3], 250)
    expect(JSON.stringify(dados)).toBe(antes)
  })
})
