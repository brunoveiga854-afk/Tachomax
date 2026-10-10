// Normaliza a data de um dia de serviço para DD/MM/YYYY. Nunca lança erro.
const CURTA = /^\d{2}\/\d{2}$/
const LONGA = /^\d{2}\/\d{2}\/\d{4}$/

export function normalizarDataDia(date: unknown, ano: number): string {
  if (typeof date !== 'string') return ''
  if (LONGA.test(date)) return date
  if (CURTA.test(date) && Number.isInteger(ano) && ano >= 1000 && ano <= 9999) return `${date}/${ano}`
  return date
}

// Ano de um dia de serviço. `date` sem ano ('dd/mm') vem do INÍCIO do serviço e o `id` é o FIM:
// um serviço 31/12 → 01/01 tem o `id` no ano seguinte. Nesse caso (início em Dezembro, fim em Janeiro)
// o ano é o do `id` menos 1. Fora disso devolve o ano do `id` (comportamento anterior). Nunca lança; NaN se o `id` for inválido.
export function anoDoDia(j: { date?: unknown; id?: unknown } | null | undefined): number {
  if (!j) return NaN
  const fim = new Date(parseInt(String(j.id), 10))
  const anoId = fim.getFullYear()
  if (typeof j.date === 'string') {
    if (LONGA.test(j.date)) return parseInt(j.date.slice(6), 10)
    if (CURTA.test(j.date) && Number.isFinite(anoId) && j.date.slice(3, 5) === '12' && fim.getMonth() === 0) return anoId - 1
  }
  return anoId
}

// Chave do dia de uma entrada: ano do dia (início do serviço) ou o fallback.
export function chaveDia(j: { date?: unknown; id?: unknown } | null | undefined, anoFallback: number): string {
  if (!j) return ''
  const idAno = anoDoDia(j)
  return normalizarDataDia(j.date, Number.isFinite(idAno) ? idAno : anoFallback)
}
