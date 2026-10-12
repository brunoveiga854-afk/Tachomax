// src/utils/mesesRecebimentoFrais.ts
// Três acontecimentos independentes dos frais, para o modal «Frais reçus» da Fiche:
//   1. TRABALHO  – mês do trabalho que gerou os frais (derivado, só informativo);
//   2. BANCO     – mês em que o dinheiro entrou na conta (escolha do motorista, intervalo largo);
//   3. DOCUMENTO – mês da fiche onde os frais aparecem (a fiche aberta, outra já importada, ou uma futura PREVISTA).
// A fiche documental NÃO é um segundo pagamento. Funções puras; não tocam em dados.
import type { MesAno } from './mesesDeFrais'

export type { MesAno }
export const MOIS_NOMS_FRAIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

/** Meses ANTES do rótulo da fiche em que o dinheiro pode ter entrado (e DEPOIS, para pagamentos mais tardios). */
export const BANCO_MAX_ANTES = 12
export const BANCO_MAX_DEPOIS = 2
/** Meses DEPOIS do rótulo da fiche aberta em que os frais podem aparecer documentados (0 = esta fiche). */
export const DOC_MAX_DEPOIS = 3

export const deslocarMes = (m: MesAno, delta: number): MesAno => {
  const i = m.ano * 12 + m.mes + delta
  return { ano: Math.floor(i / 12), mes: ((i % 12) + 12) % 12 }
}
export const rotuloMes = (m: MesAno): string => `${MOIS_NOMS_FRAIS[m.mes]} ${m.ano}`
export const periodoDe = rotuloMes   // mesma forma que `periode` das linhas de monSalaire_v2

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(Number.isFinite(n) ? n : 0)))
/** Deslocamento do mês bancário em relação à fiche (positivo = antes da fiche; negativo = depois). */
export const limitarOffsetBanco = (n: number): number => clamp(n, -BANCO_MAX_DEPOIS, BANCO_MAX_ANTES)
export const limitarOffsetDoc = (n: number): number => clamp(n, 0, DOC_MAX_DEPOIS)

export type EstadoDocumento = 'esta_fiche' | 'ja_importada' | 'prevista'

export type MesesModal = {
  trabalho: MesAno | null
  banco: MesAno
  documento: MesAno
  documentoEstado: EstadoDocumento
  /** Só para 'prevista': informação NÃO confirmada (a fiche ainda não existe). */
  docPrevisto: MesAno | null
  /** Valor a enviar na confirmação: null = limpar previsão; undefined = não tocar; MesAno = gravar previsão. */
  docPrevistoParaGravar: MesAno | null | undefined
}

export function resolverMesesModal(e: {
  fiche: MesAno
  trabalho?: MesAno | null
  bancoOffset: number
  docOffset: number
  periodosExistentes: readonly string[]
}): MesesModal {
  const banco = deslocarMes(e.fiche, -limitarOffsetBanco(e.bancoOffset))
  const dOff = limitarOffsetDoc(e.docOffset)
  const documento = deslocarMes(e.fiche, dOff)
  let documentoEstado: EstadoDocumento = 'esta_fiche'
  if (dOff > 0) documentoEstado = e.periodosExistentes.includes(periodoDe(documento)) ? 'ja_importada' : 'prevista'
  return {
    trabalho: e.trabalho ?? null,
    banco,
    documento,
    documentoEstado,
    docPrevisto: documentoEstado === 'prevista' ? documento : null,
    docPrevistoParaGravar: documentoEstado === 'prevista' ? documento : documentoEstado === 'esta_fiche' ? null : undefined,
  }
}

/** Previsão de documento de uma linha de pagamento, só enquanto a fiche prevista ainda NÃO existe. */
export function documentoPrevistoPendente(
  linha: { fraisDocPrevistoMes?: number; fraisDocPrevistoAno?: number },
  periodosExistentes: readonly string[],
): MesAno | null {
  const { fraisDocPrevistoMes: mes, fraisDocPrevistoAno: ano } = linha
  if (typeof mes !== 'number' || typeof ano !== 'number' || mes < 0 || mes > 11) return null
  const m = { ano, mes }
  return periodosExistentes.includes(periodoDe(m)) ? null : m
}
