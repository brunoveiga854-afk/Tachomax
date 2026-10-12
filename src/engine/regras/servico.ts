// src/engine/regras/servico.ts
// Tempo de serviço diário e trabalho noturno.
//
// R3312-51: tempo de serviço diário máximo 12h.
// L3312-1: se parte do trabalho é feita entre 0h e 5h, a duração diária não pode exceder 10h.
// ATENÇÃO à semântica: o limite noturno de L3312-1/Diretiva 2002/15 refere-se a TEMPO DE TRABALHO
// (exclui disponibilidade); o motor só mede «serviço». Usa-se o serviço como aproximação por excesso
// e o orquestrador regista o pressuposto — o resultado é condicionado, nunca autorização.
// Os limites 12h/10h NÃO foram copiados da Home (que os liga a «modeNuit»): aqui o limite de 10h depende
// de o serviço realmente tocar a janela 00h00–05h00.
import { primeiraJanelaNoturna } from './tempo'

export const LIMITE_SERVICO_DIARIO_SEG = 12 * 3600
export const LIMITE_SERVICO_NOTURNO_SEG = 10 * 3600

export type AvaliacaoServicoDiario = {
  fimMaximoMs: number
  limiteAplicadoSeg: number
  trabalhoNoturno: boolean
  /** serviço que ainda pode ser feito a partir da referência (antes de somar pausas previstas) */
  restanteServicoSeg: number
  avisos: string[]
}

/**
 * @param inicioServicoMs     início do serviço (para saber se toca a noite)
 * @param referenciaMs        instante a partir do qual se simula (= início, ou «agora»)
 * @param servicoAcumuladoSeg serviço já feito até à referência
 * @param pausaPrevistaSeg    tempo de pausa que se pretende fazer a partir da referência (não conta como serviço)
 */
export function avaliarServicoDiario(p: {
  inicioServicoMs: number
  referenciaMs: number
  servicoAcumuladoSeg: number
  pausaPrevistaSeg: number
}): AvaliacaoServicoDiario {
  const avisos: string[] = []
  const acum = Math.max(0, p.servicoAcumuladoSeg)
  const pausa = Math.max(0, p.pausaPrevistaSeg)
  const fimPara = (limiteSeg: number): { fim: number; restante: number } => {
    const restante = Math.max(0, limiteSeg - acum)
    return { fim: p.referenciaMs + (restante + pausa) * 1000, restante }
  }

  const a12 = fimPara(LIMITE_SERVICO_DIARIO_SEG)
  const janela = primeiraJanelaNoturna(p.inicioServicoMs, a12.fim)
  if (!janela) {
    return { fimMaximoMs: a12.fim, limiteAplicadoSeg: LIMITE_SERVICO_DIARIO_SEG, trabalhoNoturno: false, restanteServicoSeg: a12.restante, avisos }
  }

  const a10 = fimPara(LIMITE_SERVICO_NOTURNO_SEG)
  const jaDentroOuAntes = p.inicioServicoMs >= janela.n0 // o serviço começou já dentro da janela noturna
  if (jaDentroOuAntes || a10.fim > janela.n0) {
    avisos.push('O serviço toca a janela 00h00–05h00: aplica-se o limite de 10h (L3312-1).')
    return { fimMaximoMs: a10.fim, limiteAplicadoSeg: LIMITE_SERVICO_NOTURNO_SEG, trabalhoNoturno: true, restanteServicoSeg: a10.restante, avisos }
  }
  // Com 10h o serviço terminaria antes da noite; para além das 00h00 aplicar-se-ia o limite de 10h.
  // O máximo que não toca a noite é, portanto, o início da janela.
  avisos.push('Ultrapassar as 00h00 passaria o limite para 10h: o máximo sem trabalho noturno termina às 00h00.')
  const restante = Math.max(0, (janela.n0 - p.referenciaMs) / 1000 - pausa)
  return { fimMaximoMs: janela.n0, limiteAplicadoSeg: LIMITE_SERVICO_DIARIO_SEG, trabalhoNoturno: false, restanteServicoSeg: Math.min(a12.restante, restante), avisos }
}
