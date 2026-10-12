// src/engine/regras/amplitude.ts
// Amplitude e janela de descanso diário.
//
// Base: Reg. (CE) 561/2006, art. 8.º n.º 2. O novo descanso diário tem de ser GOZADO (completado) dentro
// das 24h seguintes ao fim do descanso anterior – não basta iniciá-lo nessa janela. Logo:
//     início máximo do descanso  =  fim do descanso anterior + 24h − duração do descanso a gozar
// e o fim máximo do serviço coincide com esse instante. A «amplitude» de 13h ou 15h NÃO é uma constante
// escolhida pelo descanso anterior: resulta do descanso que o motorista PRETENDE gozar a seguir
// (11h → 13h; 9h reduzido → 15h) e da janela real que sobra.
//
// NÃO aplicável (devolve avaliada=false no orquestrador): condução em equipagem e descanso fracionado 3h+9h.
export const JANELA_DESCANSO_SEG = 24 * 3600
export const DESCANSO_NORMAL_SEG = 11 * 3600
export const DESCANSO_REDUZIDO_SEG = 9 * 3600
export const MAX_REDUCOES_ENTRE_SEMANAIS = 3

export type DescansoSeguinte = 'normal' | 'reduzido'

export type JanelaDescanso = {
  /** descanso efetivamente usado na conta */
  descansoUsado: DescansoSeguinte
  descansoUsadoSeg: number
  /** instante máximo em que o descanso tem de COMEÇAR para ser gozado dentro das 24h */
  inicioMaximoDescansoMs: number
  /** = inicioMaximoDescansoMs: instante teórico limite para terminar o serviço */
  fimMaximoServicoMs: number
  /** comprimento máximo entre o fim do descanso anterior e o início do seguinte (13h ou 15h) */
  amplitudeMaximaSeg: number
  /** o motorista pediu descanso reduzido mas já não há reduções disponíveis */
  reducaoPedidaIndisponivel: boolean
  avisos: string[]
}

/**
 * @param reducoesRestantes  número de reduções ainda disponíveis entre semanais; null = desconhecido
 *                           (o reduzido é então calculado como SIMULAÇÃO, com aviso).
 */
export function janelaDescansoDiario(p: {
  fimDescansoAnteriorMs: number
  descansoSeguinte: DescansoSeguinte
  reducoesRestantes: number | null
}): JanelaDescanso {
  const avisos: string[] = []
  let usado: DescansoSeguinte = p.descansoSeguinte
  let indisponivel = false
  if (usado === 'reduzido') {
    if (p.reducoesRestantes === 0) {
      usado = 'normal'
      indisponivel = true
      avisos.push('Já foram usadas as 3 reduções entre descansos semanais: a janela foi calculada com descanso normal de 11h.')
    } else if (p.reducoesRestantes === null) {
      avisos.push('Número de reduções já utilizadas desconhecido: o descanso reduzido de 9h é uma simulação.')
    }
  }
  const descansoUsadoSeg = usado === 'normal' ? DESCANSO_NORMAL_SEG : DESCANSO_REDUZIDO_SEG
  const amplitudeMaximaSeg = JANELA_DESCANSO_SEG - descansoUsadoSeg
  const inicioMaximoDescansoMs = p.fimDescansoAnteriorMs + amplitudeMaximaSeg * 1000
  return {
    descansoUsado: usado,
    descansoUsadoSeg,
    inicioMaximoDescansoMs,
    fimMaximoServicoMs: inicioMaximoDescansoMs,
    amplitudeMaximaSeg,
    reducaoPedidaIndisponivel: indisponivel,
    avisos,
  }
}
