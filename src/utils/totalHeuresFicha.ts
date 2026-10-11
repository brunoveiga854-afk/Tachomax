// Valor inicial do campo «Heures travaillées» para uma ficha do túnel de confirmação.
// Vem sempre da própria ficha (nunca do campo da ficha anterior): string vazia se a ficha não tem horas.
export function totalHeuresInicial(ficha: { dados?: { totalHeures?: number } | null; totalHeures?: number } | null | undefined): string {
  const h = ficha?.dados?.totalHeures || ficha?.totalHeures || 0
  return h > 0 ? String(h) : ''
}
