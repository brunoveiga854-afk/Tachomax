// src/engine/regras/pausas.ts
// Pausas de TRABALHO (L3312-2): ≥30 min se o trabalho diário passa 6h, ≥45 min se passa 9h; fracionável em
// períodos de ≥15 min; nunca mais de 6h consecutivas sem pausa.
//
// NÃO trata a pausa de CONDUÇÃO do art. 7.º do Reg. 561/2006 (45 min após 4h30 de condução): a app não mede
// condução. Uma pausa registada pela app só vale como regulamentar quando a sua NATUREZA está confirmada
// ('livre_confirmada': tempo livre de qualquer atividade) e dura ≥15 min. Pausas sem natureza, ou geradas
// automaticamente (origem 'troca', reclassificação serviço→pausa), contam apenas como «não verificadas».
import { piorEstado, type EstadoResultado } from './tipos'
import { REF } from './referencias'

export type NaturezaPausa = 'livre_confirmada' | 'nao_confirmada'
export type PausaRegistada = {
  inicioMs: number
  durSeg: number
  /** 'troca' = reclassificação automática serviço→pausa; outros valores/undefined = manual da app */
  origem?: string
  natureza?: NaturezaPausa
}

export const PAUSA_MIN_FRACAO_SEG = 15 * 60
export const MAX_SEM_PAUSA_SEG = 6 * 3600

export type CumprimentoPausas = 'nao_exigida' | 'cumprida' | 'depende_de_confirmacao' | 'nao_cumprida'

export type AvaliacaoPausas = {
  exigidoSeg: number
  validasSeg: number
  naoVerificadasSeg: number
  previstasSeg: number
  cumprimento: CumprimentoPausas
  /** maior período de trabalho sem pausa, contando só pausas verificadas */
  maiorPeriodoSemPausaVerificadaSeg: number
  /** idem, contando também as não verificadas (melhor caso) */
  maiorPeriodoSemPausaPossivelSeg: number
  periodoSemPausaExcedido: boolean | 'depende_de_confirmacao'
  estado: EstadoResultado
  pressupostos: string[]
  emFalta: string[]
  referencias: typeof REF.L3312_2[]
}

export const exigidoPausaSeg = (trabalhoSeg: number): number => (trabalhoSeg > 9 * 3600 ? 45 * 60 : trabalhoSeg > 6 * 3600 ? 30 * 60 : 0)

const qualifica = (p: PausaRegistada) => p.durSeg >= PAUSA_MIN_FRACAO_SEG
const verificada = (p: PausaRegistada) => qualifica(p) && p.natureza === 'livre_confirmada' && p.origem !== 'troca'

function maiorPeriodoSem(inicioMs: number, fimMs: number, pausas: PausaRegistada[]): number {
  const ord = [...pausas].sort((a, b) => a.inicioMs - b.inicioMs)
  let cursor = inicioMs
  let maior = 0
  for (const p of ord) {
    maior = Math.max(maior, (p.inicioMs - cursor) / 1000)
    cursor = Math.max(cursor, p.inicioMs + p.durSeg * 1000)
  }
  maior = Math.max(maior, (fimMs - cursor) / 1000)
  return Math.max(0, Math.round(maior))
}

/**
 * @param trabalhoSeg      serviço total do dia (feito ou previsto) – define 30 vs 45 min
 * @param fimReferenciaMs  fim (real ou previsto) até onde se mede o período sem pausa
 * @param pausaPrevistaSeg pausa que o motorista PRETENDE fazer (sem natureza confirmada: nunca conta como válida)
 */
export function avaliarPausas(p: {
  inicioMs: number
  fimReferenciaMs: number
  trabalhoSeg: number
  pausas: PausaRegistada[]
  pausaPrevistaSeg?: number
}): AvaliacaoPausas {
  const previstas = Math.max(0, p.pausaPrevistaSeg ?? 0)
  const exigidoSeg = exigidoPausaSeg(p.trabalhoSeg)
  const validas = p.pausas.filter(verificada)
  const naoVerif = p.pausas.filter(x => qualifica(x) && !verificada(x))
  const validasSeg = validas.reduce((a, x) => a + x.durSeg, 0)
  const naoVerificadasSeg = naoVerif.reduce((a, x) => a + x.durSeg, 0)

  const pressupostos: string[] = []
  const emFalta: string[] = []
  if (p.pausas.some(x => x.origem === 'troca')) pressupostos.push('Pausas geradas automaticamente na troca de camião não contam como pausas regulamentares.')
  if (naoVerificadasSeg > 0) emFalta.push('natureza das pausas registadas (tempo livre de qualquer atividade?)')
  if (previstas > 0) emFalta.push('natureza e distribuição da pausa prevista')
  if (p.pausas.some(x => !qualifica(x))) pressupostos.push('Pausas com menos de 15 min não contam para L3312-2.')

  const verifOk = maiorPeriodoSem(p.inicioMs, p.fimReferenciaMs, validas)
  const possivel = maiorPeriodoSem(p.inicioMs, p.fimReferenciaMs, [...validas, ...naoVerif])

  let cumprimento: CumprimentoPausas
  if (exigidoSeg === 0) cumprimento = 'nao_exigida'
  else if (validasSeg >= exigidoSeg) cumprimento = 'cumprida'
  else if (validasSeg + naoVerificadasSeg + previstas >= exigidoSeg) cumprimento = 'depende_de_confirmacao'
  else cumprimento = 'nao_cumprida'

  const excedidoVerif = verifOk > MAX_SEM_PAUSA_SEG
  const excedidoPossivel = possivel > MAX_SEM_PAUSA_SEG
  const periodoSemPausaExcedido: AvaliacaoPausas['periodoSemPausaExcedido'] =
    !excedidoVerif ? false : excedidoPossivel ? true : 'depende_de_confirmacao'

  let estado: EstadoResultado
  if (cumprimento === 'nao_exigida' || cumprimento === 'cumprida') estado = 'confirmado'
  else estado = 'simulacao_condicionada'
  if (periodoSemPausaExcedido !== false) estado = piorEstado(estado, 'simulacao_condicionada')

  return {
    exigidoSeg,
    validasSeg,
    naoVerificadasSeg,
    previstasSeg: previstas,
    cumprimento,
    maiorPeriodoSemPausaVerificadaSeg: verifOk,
    maiorPeriodoSemPausaPossivelSeg: possivel,
    periodoSemPausaExcedido,
    estado,
    pressupostos,
    emFalta,
    referencias: [REF.L3312_2],
  }
}
