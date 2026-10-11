// Preservação de referências entre recargas do AppContext.
// Se o conteúdo bruto (string lida do storage) de uma chave não mudou, devolve o MESMO objecto
// parseado da vez anterior; se mudou (ou é a primeira vez), faz parse novo e guarda-o.

export type CacheReferencias = Map<string, { raw: string | null; valor: unknown }>

export function reutilizarSeIgual<T>(
  cache: CacheReferencias,
  chave: string,
  raw: string | null | undefined,
  parse: (raw: string) => T | null,
  reutilizadas?: string[],
): T | null {
  const rawNorm = raw ?? null
  const anterior = cache.get(chave)
  if (anterior && anterior.raw === rawNorm) {
    reutilizadas?.push(chave)
    return anterior.valor as T | null
  }
  const valor = rawNorm === null || rawNorm === '' ? null : parse(rawNorm)
  cache.set(chave, { raw: rawNorm, valor })
  return valor
}

// Igualdade superficial (Object.is por campo): true se nada mudou, para o setState poder devolver `prev`.
export function mesmoEstado<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => Object.is(a[k], b[k]))
}
