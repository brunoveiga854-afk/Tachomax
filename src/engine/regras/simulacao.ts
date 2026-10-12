// src/engine/regras/simulacao.ts
// «Simuler ma journée»: reavalia o MESMO motor com parâmetros hipotéticos. Função PURA: não lê storage, não escreve
// nada, não altera o contexto recebido (devolve objetos novos). A simulação nunca toca no serviço real, no histórico
// ou em dados persistidos — é uma cópia em memória, local à página.
//
// O QUE O MOTOR JÁ SUPORTA (e é usado aqui sem acrescentar regras jurídicas):
//  • `pausaPrevistaSeg` na EntradaMotor: a pausa desloca o fim do tempo de serviço, não a janela de 24h do descanso;
//    conta como hipótese (resultado sempre «simulation conditionnée»), nunca como pausa regulamentar confirmada.
//  • `avaliarPausas` (L3312-2) já recebe o fim previsto e o serviço total.
// O QUE É NOVO: apenas a COMPARAÇÃO de uma hora de fim pretendida com os fins máximos que o motor calculou
// (aritmética; não é uma regra nova) e o texto. Tudo o resto → «Simulation non disponible».
import { avaliarRegras, type ResultadoMotor } from './orquestrador'
import { avaliarPausas } from './pausas'
import { MS_DIA, formatarInstante } from './tempo'
import { prepararRespostas, fmtDuracao, type ContextoAssistente, type PerguntaId, type Resposta } from './lerContexto'

export const PAUSA_SIM_MAX_MIN = 180
export const PAUSA_SIM_PASSO_MIN = 5

export type ParametrosSimulacao = {
  /** pausa que o motorista pretende fazer a partir de «agora» (minutos) */
  pausaMin: number
  /** hora de fim pretendida (relógio local). Resolvida para a PRÓXIMA ocorrência a partir de «agora». */
  fimDesejado: { h: number; m: number } | null
}
export const parametrosOriginais = (): ParametrosSimulacao => ({ pausaMin: 0, fimDesejado: null })
export const saoParametrosOriginais = (p: ParametrosSimulacao): boolean => p.pausaMin === 0 && p.fimDesejado === null

export type LinhaComparacao = { restricao: string; fimMaximoMs: number; dentro: boolean; margemSeg: number }
export type ComparacaoFim = {
  fimDesejadoMs: number
  /** serviço acumulado até ao fim pretendido (descontada a pausa simulada) */
  servicoTotalSeg: number
  linhas: LinhaComparacao[]
  tudoDentro: boolean
  /** pausa de trabalho exigida (L3312-2) para esse serviço total, ou null se não aplicável */
  pausaExigidaSeg: number | null
  cumprimentoPausa: string | null
  resumo: string
}

export type ResultadoSimulacao =
  | { disponivel: false; motivo: string }
  | {
    disponivel: true
    contexto: ContextoAssistente
    motor: ResultadoMotor
    respostas: Resposta[]
    comparacao: ComparacaoFim | null
    /** true se algum parâmetro difere do real */
    alterada: boolean
    /** nota por pergunta quando o parâmetro simulado não tem efeito nela */
    nota: Record<PerguntaId, string | null>
  }

const naoDisponivel = (motivo: string): ResultadoSimulacao => ({ disponivel: false, motivo })

/** Próxima ocorrência (a partir de `refMs`, hora de parede) da hora indicada; null se a hora for inválida. */
export function resolverFimDesejado(refMs: number, h: number, m: number): number | null {
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) return null
  if (!Number.isFinite(refMs)) return null
  let e = Math.floor(refMs / MS_DIA) * MS_DIA + (h * 60 + m) * 60_000
  if (e < refMs) e += MS_DIA
  return e
}

const CUMPRIMENTO_FR: Record<string, string> = {
  nao_exigida: 'aucune pause exigée à cette heure',
  cumprida: 'pause exigée déjà prise (vérifiée)',
  depende_de_confirmacao: 'dépend de la nature des pauses (non confirmée)',
  nao_cumprida: 'pause exigée non atteinte avec les pauses connues',
}

export function simular(base: ContextoAssistente, p: ParametrosSimulacao): ResultadoSimulacao {
  if (base.situacao !== 'em_curso' || !base.motor || !base.adaptador) return naoDisponivel('Aucun service en cours à simuler.')
  if (base.estado === 'dados_insuficientes') return naoDisponivel("Données insuffisantes : le moteur ne peut pas calculer le service réel, donc pas de simulation.")
  if (!Number.isInteger(p.pausaMin) || p.pausaMin < 0 || p.pausaMin > PAUSA_SIM_MAX_MIN) {
    return naoDisponivel(`Pause simulée hors limites (0 à ${PAUSA_SIM_MAX_MIN} min).`)
  }
  const ent = base.adaptador.entrada
  const inicio = ent.inicioServicoMs
  const ref = ent.referenciaMs
  if (typeof inicio !== 'number' || typeof ref !== 'number') return naoDisponivel('Début ou instant actuel du service inconnu.')
  const acum = Math.max(0, ent.servicoAcumuladoSeg ?? 0)
  const pausaSeg = p.pausaMin * 60

  let fimMs: number | null = null
  if (p.fimDesejado) {
    fimMs = resolverFimDesejado(ref, p.fimDesejado.h, p.fimDesejado.m)
    if (fimMs === null) return naoDisponivel("Heure de fin souhaitée invalide.")
    if (pausaSeg > (fimMs - ref) / 1000) return naoDisponivel("La pause simulée dépasse le temps qui reste jusqu'à l'heure de fin souhaitée.")
  }

  const entradaSim = { ...ent, pausaPrevistaSeg: pausaSeg }
  const motor = avaliarRegras(entradaSim)
  const contexto: ContextoAssistente = { ...base, estado: motor.estado, motor, adaptador: { ...base.adaptador, entrada: entradaSim } }
  const respostas = prepararRespostas(contexto).respostas

  let comparacao: ComparacaoFim | null = null
  if (fimMs !== null) {
    const servicoTotalSeg = Math.max(0, Math.round(acum + (fimMs - ref) / 1000 - pausaSeg))
    const linhas: LinhaComparacao[] = motor.restricoes
      .filter(r => r.avaliada && r.fimMaximoMs !== null)
      .map(r => ({
        restricao: r.nome,
        fimMaximoMs: r.fimMaximoMs as number,
        dentro: (fimMs as number) <= (r.fimMaximoMs as number),
        margemSeg: Math.round(((r.fimMaximoMs as number) - (fimMs as number)) / 1000),
      }))
    const tudoDentro = linhas.length > 0 && linhas.every(l => l.dentro)
    let pausaExigidaSeg: number | null = null
    let cumprimentoPausa: string | null = null
    if (ent.contexto.enquadramentoFrances !== 'nao') {
      const pa = avaliarPausas({ inicioMs: inicio, fimReferenciaMs: fimMs, trabalhoSeg: servicoTotalSeg, pausas: ent.pausas ?? [], pausaPrevistaSeg: pausaSeg })
      pausaExigidaSeg = pa.exigidoSeg
      cumprimentoPausa = CUMPRIMENTO_FR[pa.cumprimento] ?? null
    }
    comparacao = { fimDesejadoMs: fimMs, servicoTotalSeg, linhas, tudoDentro, pausaExigidaSeg, cumprimentoPausa, resumo: '' }
    comparacao.resumo = textoComparacao(comparacao)
  }

  const alterada = p.pausaMin > 0 || p.fimDesejado !== null
  const nota: Record<PerguntaId, string | null> = {
    amplitude: p.pausaMin > 0 ? "La pause ne modifie pas la limite d'amplitude : la fenêtre de 24 h part de la fin du repos précédent." : null,
    servico: null,
    repos: p.pausaMin > 0 ? "La pause ne modifie pas la fenêtre du repos quotidien." : null,
  }
  return { disponivel: true, contexto, motor, respostas, comparacao, alterada, nota }
}

/** Texto francês da comparação. Nunca diz que o motorista está «autorisé»: compara com o CALCUL. */
export function textoComparacao(c: ComparacaoFim): string {
  const hora = formatarInstante(c.fimDesejadoMs, true)
  if (c.linhas.length === 0) return `Fin souhaitée ${hora} : aucune limite calculable à comparer.`
  const fora = c.linhas.filter(l => !l.dentro)
  if (fora.length === 0) {
    const menor = c.linhas.reduce((a, b) => (b.margemSeg < a.margemSeg ? b : a))
    return `Fin souhaitée ${hora} : les limites calculées ne sont pas dépassées (marge la plus faible : ${fmtDuracao(menor.margemSeg)} — ${menor.restricao}). Ce n'est pas une autorisation.`
  }
  const pior = fora.reduce((a, b) => (b.margemSeg < a.margemSeg ? b : a))
  return `Fin souhaitée ${hora} : dépasse le calcul de ${fmtDuracao(-pior.margemSeg)} — ${pior.restricao}.`
}
