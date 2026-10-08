// Normaliza a data de um dia de serviço para DD/MM/YYYY. Nunca lança erro.
const CURTA = /^\d{2}\/\d{2}$/
const LONGA = /^\d{2}\/\d{2}\/\d{4}$/

export function normalizarDataDia(date: unknown, ano: number): string {
  if (typeof date !== 'string') return ''
  if (LONGA.test(date)) return date
  if (CURTA.test(date) && Number.isInteger(ano) && ano >= 1000 && ano <= 9999) return `${date}/${ano}`
  return date
}

// Chave do dia de uma entrada: ano do `id` (como o resto da app) ou o fallback.
export function chaveDia(j: { date?: unknown; id?: unknown } | null | undefined, anoFallback: number): string {
  if (!j) return ''
  const idAno = new Date(parseInt(String(j.id), 10)).getFullYear()
  return normalizarDataDia(j.date, Number.isFinite(idAno) ? idAno : anoFallback)
}
