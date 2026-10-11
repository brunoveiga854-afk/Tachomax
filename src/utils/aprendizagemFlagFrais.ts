// src/utils/aprendizagemFlagFrais.ts
// Funções puras para (1) aprender o flag sem usar a fiche como prova de si própria nem
// datas bancárias inferidas, e (2) alertas de frais que comparam períodos equivalentes.
// NÃO altera dados gravados; só decide o que conta como prova.
import type { MoisData } from '../types/moisdata'
import { mesesDeFrais } from './mesesDeFrais'
import { resolverMesTrabalho } from './projecoes'
import type { TimingAprendido } from './projecoes'

export type MesAnoBanco = { ano: number; mes: number }

/** Data bancária dos frais SÓ se foi declarada pelo motorista; inferida/desconhecida/ausente → null. */
export function bancoFraisFiavel(d: MoisData): MesAnoBanco | null {
  const m = mesesDeFrais(d)
  if (m.origemBanco !== 'declarado' || !m.banco) return null
  return { ano: m.banco.ano, mes: m.banco.mes }
}

const chaveFiche = (d: MoisData) => `${d.anoFiche ?? d.annee}-${d.mesFicheIndex ?? d.moisIndex}`

/** Outras fiches que podem servir de fonte independente (nunca a própria, nem outra do mesmo mês). */
export function fontesIndependentes(dados: MoisData[], fiche: MoisData): MoisData[] {
  const k = chaveFiche(fiche)
  return dados.filter(f => f !== fiche && chaveFiche(f) !== k)
}

/**
 * Melhor flag por correspondência de valor com OUTRAS fiches.
 * Exige data bancária declarada; a fiche nunca é fonte de si própria.
 * Aceita flag 0 quando uma fonte independente realmente o confirma.
 */
export function melhorFlagPorFontes(
  dados: MoisData[], fiche: MoisData, valor: number,
): { flag: number; diff: number } | null {
  const banco = bancoFraisFiavel(fiche)
  if (!banco || !(valor > 0)) return null
  let melhor: { flag: number; diff: number } | null = null
  for (const fonte of fontesIndependentes(dados, fiche)) {
    const anoF = fonte.anoFiche ?? fonte.annee
    const mesF = fonte.mesFicheIndex ?? fonte.moisIndex
    const lag = (banco.ano - anoF) * 12 + (banco.mes - mesF)
    if (lag < 0 || lag > 3) continue
    for (const v of [fonte.remboursementFrais || 0, fonte.fraisBoletim || 0]) {
      if (!(v > 0)) continue
      const diff = Math.abs(v - valor)
      if (diff <= Math.max(5, valor * 0.02) && (melhor === null || diff < melhor.diff)) melhor = { flag: lag, diff }
    }
  }
  return melhor
}

/** O mês de trabalho dos frais é fiável (gravado/derivado de data bancária declarada)? */
export function mesFraisTrabalhoFiavel(
  d: MoisData, p: Parameters<typeof resolverMesTrabalho>[1], ap?: TimingAprendido,
): { ano: number; mes: number } | null {
  if (mesesDeFrais(d).origemBanco !== 'declarado') return null
  const r = resolverMesTrabalho(d, p, ap, 'frais')
  if (r.fiabilidade !== 'gravada' && r.fiabilidade !== 'declarada') return null
  return { ano: r.ano, mes: r.mes }
}

/**
 * Alertas "frais pagos a menos": compara o boletim com o esperado do MÊS DE TRABALHO efetivo.
 * Sem correspondência fiável → sem alerta categórico.
 */
export function alertasFraisIncoerentes(
  dados: MoisData[],
  calcularEsperado: (ano: number, mes: number) => number,
  p: Parameters<typeof resolverMesTrabalho>[1],
  ap?: TimingAprendido,
): string[] {
  const confirmados = dados.filter(d => d.salarioConfirmado || d.fraisConfirmado || d.montantTotalRecu > 0).length
  if (confirmados < 3) return []
  const out: string[] = []
  for (const d of dados) {
    const pago = d.fraisBoletim || 0
    if (pago <= 0) continue
    const mes = mesFraisTrabalhoFiavel(d, p, ap)
    if (!mes) continue
    const esperado = calcularEsperado(mes.ano, mes.mes)
    const diff = Math.round((esperado - pago) * 100) / 100
    const tolerancia = Math.max(5, esperado * 0.02)
    if (esperado <= 0 || diff <= tolerancia) continue
    out.push(`Ce mois, j'attendais ${esperado.toFixed(2)}€ de frais mais le bulletin indique ${pago.toFixed(2)}€ — écart de ${diff.toFixed(2)}€. Vérifie que tous les jours ont bien été payés.`)
  }
  return out
}
