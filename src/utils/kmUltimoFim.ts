// src/utils/kmUltimoFim.ts
// Novo valor de km_ultimo_fim depois de apagar dias do historique.
// Devolve null = não mexer. Devolve o km do dia anterior com kmFim, ou 0 se não houver.
// Só devolve número se o dia apagado era o mais recente (por data) com kmFim>0
// E o km_ultimo_fim guardado for igual ao kmFim desse dia, arredondado.
// Mesmo critério de data do guardarEdicao (historique.tsx).

type DiaKm = { id: string; date: string; kmFim?: number | null }

const tsDia = (j: DiaKm): number => {
  const p = j.date.split('/')
  const ano = p[2] ? parseInt(p[2]) : new Date(parseInt(j.id)).getFullYear()
  return new Date(ano, parseInt(p[1]) - 1, parseInt(p[0])).getTime()
}

const maisRecenteComKm = <T extends DiaKm>(lista: T[]): T | null =>
  lista
    .filter(j => (j.kmFim || 0) > 0)
    .reduce<T | null>((m, j) => (!m || tsDia(j) > tsDia(m) ? j : m), null)

export function kmUltimoFimAposApagar<T extends DiaKm>(
  lista: T[],
  ids: string[],
  kmGuardado: string | null,
): number | null {
  const antes = maisRecenteComKm(lista)
  if (!antes || !ids.includes(antes.id)) return null
  if (kmGuardado === null || kmGuardado.trim() === '') return null
  const guardado = Number(kmGuardado)
  if (!Number.isFinite(guardado) || guardado !== Math.round(antes.kmFim as number)) return null
  const depois = maisRecenteComKm(lista.filter(j => !ids.includes(j.id)))
  return depois ? Math.round(depois.kmFim as number) : 0
}
