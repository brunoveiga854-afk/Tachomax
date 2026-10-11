import { fixarLagsConfirmados, lagsParaBase, lagValido } from './lagsConfirmados'

type P = { hlag: number; flag: number; hval: number }
const apConfirmado = { hlag: 2, flag: 1, hlagConfirmado: true, flagConfirmado: true }
// Resultado da aprendizagem automática com 10 fiches: propõe 3/0.
const aprendido = (base: P): P => ({ ...base, hlag: 3, flag: 0 })

describe('prioridade de hlag/flag', () => {
  it('confirmado 2/1 com 10 fiches: a aprendizagem propõe 3/0 e não substitui 2/1', () => {
    const padraoExistente: P = { hlag: 3, flag: 0, hval: 14 } // já contaminado por uma importação anterior
    const lags = lagsParaBase(padraoExistente, apConfirmado)
    expect(lags).toEqual({ hlag: 2, flag: 1, hlagTravado: true, flagTravado: true })
    const base: P = { ...padraoExistente, hlag: lags.hlag, flag: lags.flag }
    const resultado = fixarLagsConfirmados(aprendido(base), lags)
    expect(resultado.hlag).toBe(2)
    expect(resultado.flag).toBe(1)
    expect(resultado.hval).toBe(14) // o resto do padrão aprendido mantém-se
    // o que se persiste e o que o resumo mostra são o mesmo objeto
    expect({ hlag: resultado.hlag, flag: resultado.flag }).toEqual({ hlag: 2, flag: 1 })
  })

  it('sem confirmação: parte do padrão existente (depois do predefinido) e a aprendizagem continua livre', () => {
    const semConf = { hlag: 2, flag: 1, hlagConfirmado: false, flagConfirmado: false }
    const lags = lagsParaBase({ hlag: 3, flag: 0 }, semConf)
    expect(lags).toEqual({ hlag: 3, flag: 0, hlagTravado: false, flagTravado: false })
    const proposta = aprendido({ hlag: 3, flag: 0, hval: 1 })
    expect(fixarLagsConfirmados(proposta, lags)).toBe(proposta) // aprendizagem mantida
    const outra = { hlag: 1, flag: 2, hval: 1 }
    expect(fixarLagsConfirmados(outra, lags)).toBe(outra)
    // sem padrão nem aprendizagem: predefinidos
    expect(lagsParaBase(null, null)).toEqual({ hlag: 2, flag: 1, hlagTravado: false, flagTravado: false })
    expect(lagsParaBase({}, undefined, { hlag: 2, flag: 1 }).hlag).toBe(2)
  })

  it('zero confirmado é um valor válido e também fica protegido', () => {
    expect(lagValido(0)).toBe(true)
    const ap = { hlag: 0, flag: 0, hlagConfirmado: true, flagConfirmado: true }
    const lags = lagsParaBase({ hlag: 2, flag: 1 }, ap)
    expect(lags).toEqual({ hlag: 0, flag: 0, hlagTravado: true, flagTravado: true })
    const r = fixarLagsConfirmados({ hlag: 3, flag: 1, hval: 1 }, lags)
    expect(r.hlag).toBe(0)
    expect(r.flag).toBe(0)
  })

  it('confirmados inválidos (null, fora de 0–3, não inteiros) não bloqueiam nada', () => {
    for (const v of [null, undefined, -1, 4, 1.5, NaN, '2' as any]) {
      const lags = lagsParaBase({ hlag: 3, flag: 0 }, { hlag: v as any, flag: v as any, hlagConfirmado: true, flagConfirmado: true })
      expect(lags.hlagTravado).toBe(false)
      expect(lags.flagTravado).toBe(false)
      expect(lags.hlag).toBe(3)
      expect(lags.flag).toBe(0)
    }
    // só um dos dois confirmado: o outro continua livre
    const so = lagsParaBase({ hlag: 3, flag: 0 }, { hlag: 2, flag: 1, hlagConfirmado: true, flagConfirmado: false })
    expect(so).toEqual({ hlag: 2, flag: 0, hlagTravado: true, flagTravado: false })
    expect(fixarLagsConfirmados({ hlag: 3, flag: 2 }, so)).toEqual({ hlag: 2, flag: 2 })
  })

  it('carregamento repetido do ecrã: estável e idempotente, sem tocar em dados históricos', () => {
    const lags = lagsParaBase({ hlag: 2, flag: 1 }, apConfirmado)
    let p: P = { hlag: 2, flag: 1, hval: 10 }
    const primeira = fixarLagsConfirmados(aprendido(p), lags)
    expect(primeira).toEqual({ hlag: 2, flag: 1, hval: 10 })
    // já conforme: devolve a mesma referência (nada a gravar)
    expect(fixarLagsConfirmados(p, lags)).toBe(p)
    for (let i = 0; i < 5; i++) {
      p = fixarLagsConfirmados(aprendido(p), lagsParaBase(p, apConfirmado))
      expect(p.hlag).toBe(2)
      expect(p.flag).toBe(1)
    }
    // histórico simulado: a API não o recebe, por isso não o pode alterar
    const historico = Object.freeze([Object.freeze({ periode: 'Février 2026', mesFraisTrabalhoIndex: 1 })])
    fixarLagsConfirmados(aprendido(p), lags)
    expect(historico[0].mesFraisTrabalhoIndex).toBe(1)
  })
})
