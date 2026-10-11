// src/utils/mesesDeFrais.ts
// Etapa 1 (preparatória): separa os três acontecimentos de um pagamento de frais.
//   • TRABALHO – mês em que o trabalho que gerou os frais foi feito;
//   • BANCO    – mês em que o dinheiro entrou na conta;
//   • FICHE    – mês do rótulo do documento (fiche de paie).
// Função pura, só lê campos já existentes de MoisData. NÃO está ligada aos cálculos,
// à aprendizagem nem aos modais. Nunca inventa datas: campo ausente → null.
import type { MoisData } from '../types/moisdata'

export type MesAno = { ano: number; mes: number } // mes: 0–11

// 'conhecida'  → data bancária gravada e DIFERENTE do rótulo da fiche (não pode ser o fallback).
// 'inferida'   → data bancária gravada mas IGUAL ao rótulo: a gravação normal usa o rótulo como
//                fallback (fiche.tsx responderPergunta), por isso não prova que o banco foi esse mês.
// 'ausente'    → sem data bancária dos frais gravada (não se recorre a mesPagamento* de salário).
export type OrigemBanco = 'conhecida' | 'inferida' | 'ausente'

export type MesesDeFrais = {
  trabalho: MesAno | null
  banco: MesAno | null
  fiche: MesAno | null
  origemBanco: OrigemBanco
  // Diferenças em meses (destino − origem). null quando falta um dos extremos
  // ou, no caso do banco, quando a data bancária não é 'conhecida'.
  trabalhoParaBanco: number | null
  bancoParaFiche: number | null
  trabalhoParaFiche: number | null
}

export type EntradaMesesDeFrais = Pick<MoisData, 'moisIndex' | 'annee'> &
  Partial<Pick<MoisData,
    | 'mesFicheIndex' | 'anoFiche'
    | 'mesFraisTrabalhoIndex' | 'anoFraisTrabalho'
    | 'pagamentoFraisMesIndex' | 'pagamentoFraisAno'>>

const mesValido = (m: unknown): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= 11
const anoValido = (a: unknown): a is number => typeof a === 'number' && Number.isInteger(a) && a >= 2000 && a <= 2100

const par = (ano: unknown, mes: unknown): MesAno | null =>
  anoValido(ano) && mesValido(mes) ? { ano, mes } : null

const indice = (x: MesAno): number => x.ano * 12 + x.mes

const diff = (de: MesAno | null, para: MesAno | null): number | null =>
  de && para ? indice(para) - indice(de) : null

export function mesesDeFrais(d: EntradaMesesDeFrais): MesesDeFrais {
  const fiche = par(d.anoFiche, d.mesFicheIndex) ?? par(d.annee, d.moisIndex)
  const rotulo = par(d.annee, d.moisIndex)
  const trabalho = par(d.anoFraisTrabalho, d.mesFraisTrabalhoIndex)
  const banco = par(d.pagamentoFraisAno, d.pagamentoFraisMesIndex)

  let origemBanco: OrigemBanco = 'ausente'
  if (banco) {
    const igualRotulo = (rotulo && indice(banco) === indice(rotulo)) || (fiche && indice(banco) === indice(fiche))
    origemBanco = igualRotulo ? 'inferida' : 'conhecida'
  }
  const bancoFiavel = origemBanco === 'conhecida' ? banco : null

  return {
    trabalho,
    banco,
    fiche,
    origemBanco,
    trabalhoParaBanco: diff(trabalho, bancoFiavel),
    bancoParaFiche: diff(bancoFiavel, fiche),
    trabalhoParaFiche: diff(trabalho, fiche),
  }
}

// Chave textual dos três meses, para distinguir pagamentos com o mesmo valor
// mas períodos de trabalho diferentes. '?' = ausente.
export function chaveMesesFrais(d: EntradaMesesDeFrais): string {
  const m = mesesDeFrais(d)
  const f = (x: MesAno | null) => (x ? `${x.ano}-${String(x.mes + 1).padStart(2, '0')}` : '?')
  return `T${f(m.trabalho)}|B${f(m.banco)}|F${f(m.fiche)}`
}
