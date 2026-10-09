// Precisão real da estimativa: compara a estimativa ("hors primes") com o recebido SEM prémios ocasionais.
// Fórmula única, partilhada por: card "PRÉCISION DE L'APP", linhas do histórico e calcResult.precisao.

// Lista ÚNICA de prémios ocasionais (a mesma que fiche.tsx usava em totalPrimesExceptionnelles).
export const somaPremios = (d: any): number =>
  (d?.interessement || 0) +
  (d?.primeExceptionnelle || 0) +
  (d?.participationSalariale || 0) +
  (d?.primeNonAccident || 0) +
  (d?.autresPrimes || 0)

// Prémios que o montantTotalRecu REALMENTE contém.
// O total tem duas composições: manual/edição = net + frais (sem prémios); auto/extras = com prémios.
// Por isso só se desconta o excesso do total sobre (net + frais), limitado aos prémios registados.
// Usa o maior dos campos de frais: na dúvida desconta menos (nunca inventa erro).
export const premiosNoTotal = (m: any): number => {
  const premios = somaPremios(m)
  const total = m?.montantTotalRecu || 0
  if (premios <= 0 || total <= 0) return 0
  const frais = Math.max(m?.fraisRecuConfirme || 0, m?.remboursementFrais || 0, m?.fraisBoletim || 0)
  const excesso = total - (m?.netPaye || 0) - frais
  return Math.min(premios, Math.max(0, excesso))
}

export const recebidoSemPremios = (m: any): number =>
  Math.max(0, (m?.montantTotalRecu || 0) - premiosNoTotal(m))

// Tolerância realista: ≤30€=100%, ≤70€=98%, ≤120€=95%, ≤200€=88%, senão 100−diff/real (mínimo 60).
export const pontuarAcerto = (estimativa: number, recebido: number): number | null => {
  if (!(estimativa > 0) || !(recebido > 0)) return null
  const diff = Math.abs(estimativa - recebido)
  return diff <= 30 ? 100 : diff <= 70 ? 98 : diff <= 120 ? 95 : diff <= 200 ? 88
    : Math.max(60, Math.round(100 - Math.min(38, diff / recebido * 100)))
}
