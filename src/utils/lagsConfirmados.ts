// src/utils/lagsConfirmados.ts
// Prioridade dos desfasamentos hlag/flag: valor VÁLIDO confirmado pelo motorista (aprendizagem_padrao com
// hlagConfirmado/flagConfirmado) > valor do padrão existente (monSalaire_padrao) > predefinido.
// A aprendizagem automática pode propor outro valor, mas não substitui um confirmado.
// Funções puras sobre o PADRÃO apenas: não recebem nem alteram fiches/histórico — um valor confirmado
// nunca serve de autorização para reescrever meses já guardados.

export const LAG_MIN = 0
export const LAG_MAX = 3

export const lagValido = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= LAG_MIN && v <= LAG_MAX

type ApLike = {
  hlag?: number | null; flag?: number | null
  hlagConfirmado?: boolean; flagConfirmado?: boolean
} | null | undefined

type PadraoLike = { hlag?: number; flag?: number } | null | undefined

export type LagsBase = {
  hlag: number
  flag: number
  /** hlag confirmado e válido: nenhuma aprendizagem o substitui */
  hlagTravado: boolean
  /** flag confirmado e válido: nenhuma aprendizagem o substitui */
  flagTravado: boolean
}

export function lagsParaBase(
  padrao: PadraoLike, ap: ApLike, predefinidos: { hlag: number; flag: number } = { hlag: 2, flag: 1 },
): LagsBase {
  const hlagTravado = ap?.hlagConfirmado === true && lagValido(ap.hlag)
  const flagTravado = ap?.flagConfirmado === true && lagValido(ap.flag)
  return {
    hlag: hlagTravado ? (ap!.hlag as number) : lagValido(padrao?.hlag) ? padrao!.hlag! : predefinidos.hlag,
    flag: flagTravado ? (ap!.flag as number) : lagValido(padrao?.flag) ? padrao!.flag! : predefinidos.flag,
    hlagTravado,
    flagTravado,
  }
}

/** Repõe os valores confirmados num padrão resultante da aprendizagem. Devolve a MESMA referência se nada mudar. */
export function fixarLagsConfirmados<T extends { hlag: number; flag: number }>(p: T, lags: LagsBase): T {
  const hlag = lags.hlagTravado ? lags.hlag : p.hlag
  const flag = lags.flagTravado ? lags.flag : p.flag
  return hlag === p.hlag && flag === p.flag ? p : { ...p, hlag, flag }
}
