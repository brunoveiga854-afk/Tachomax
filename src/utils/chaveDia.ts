const p2 = (n: number) => String(n).padStart(2, '0')

/** Margem para o caso de um serviço iniciado em 31/12 e terminado já em Janeiro (o id é do fim). */
const MARGEM_MS = 36 * 3600 * 1000

/**
 * Devolve sempre a chave do dia no formato 'DD/MM/AAAA', ou null se a data não for utilizável.
 * - 'DD/MM/AAAA': o ano vem da própria data (o id é ignorado).
 * - 'DD/MM': o ano vem do id (instante em que o registo foi gravado), corrigido quando o serviço
 *   começou no fim do ano e acabou no seguinte (31/12 com id em Janeiro dá o ano anterior).
 */
export function chaveDia(date: string | undefined | null, id?: string | number | null): string | null {
  const parts = String(date ?? '').trim().split('/')
  if (parts.length < 2 || parts.length > 3) return null
  if (parts.some(p => p.trim() === '')) return null
  const d = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isInteger(d) || !Number.isInteger(m)) return null

  let ano: number
  if (parts.length === 3) {
    if (!/^\d{4}$/.test(parts[2].trim())) return null
    ano = Number(parts[2])
  } else {
    if (id === undefined || id === null || String(id).trim() === '') return null
    const ts = Number(id)
    if (!Number.isFinite(ts)) return null
    ano = new Date(ts).getFullYear()
    if (new Date(ano, m - 1, d).getTime() - ts > MARGEM_MS) ano -= 1
  }

  const verificacao = new Date(ano, m - 1, d)
  if (verificacao.getFullYear() !== ano || verificacao.getMonth() !== m - 1 || verificacao.getDate() !== d) return null
  return `${p2(d)}/${p2(m)}/${ano}`
}

type EntradaDia = { date?: string | null; id?: string | number | null }

/**
 * Diz se duas entradas são do mesmo dia. Se alguma das datas não for utilizável,
 * volta à comparação de texto de antes, para nunca apagar uma entrada por causa de um null.
 */
export function mesmoDia(a: EntradaDia, b: EntradaDia): boolean {
  const ka = chaveDia(a.date, a.id)
  const kb = chaveDia(b.date, b.id)
  if (ka && kb) return ka === kb
  return (a.date ?? '') === (b.date ?? '')
}
