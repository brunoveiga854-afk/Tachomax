// src/engine/regras/descansos.ts
// Descansos diários e contagem de reduções entre descansos semanais (Reg. 561/2006, art. 8.º n.º 2 e 4).
//
// Só trata descansos diários normais (≥11h) e reduzidos (≥9h e <11h). Descansos ≥24h são «possíveis
// descansos semanais»: não são contados como diários e o motor não verifica a sua regularidade
// (45h / 24h com compensação – NÃO suportado). O descanso diário fracionado (3h+9h) também não é suportado.
import { DESCANSO_NORMAL_SEG, DESCANSO_REDUZIDO_SEG, MAX_REDUCOES_ENTRE_SEMANAIS } from './amplitude'
import type { EstadoResultado } from './tipos'
import { REF } from './referencias'

export type TipoDescanso = 'normal' | 'reduzido' | 'insuficiente' | 'possivel_semanal'

export function classificarDescansoDiario(durSeg: number): TipoDescanso {
  if (!Number.isFinite(durSeg) || durSeg < 0) return 'insuficiente'
  if (durSeg >= 24 * 3600) return 'possivel_semanal'
  if (durSeg >= DESCANSO_NORMAL_SEG) return 'normal'
  if (durSeg >= DESCANSO_REDUZIDO_SEG) return 'reduzido'
  return 'insuficiente'
}

export type DescansoRegistado = { inicioMs: number; fimMs: number }

export type ContagemReducoes = {
  utilizadas: number
  /** null = desconhecido (início do período entre semanais ou histórico incompleto) */
  restantes: number | null
  /** máximo possível de reduções ainda disponíveis (limite − utilizadas) */
  restantesNoMaximo: number
  descansosInsuficientes: number
  possiveisSemanaisIgnorados: number
  estado: EstadoResultado
  pressupostos: string[]
  emFalta: string[]
  referencias: typeof REF.CE561_ART8_4[]
}

/**
 * @param fimUltimoDescansoSemanalMs  fim do último descanso semanal confirmado; null = desconhecido
 * @param historicoCompleto           true só se TODOS os descansos desde esse instante estão em `descansos`
 */
export function contarReducoes(p: {
  descansos: DescansoRegistado[]
  fimUltimoDescansoSemanalMs: number | null
  historicoCompleto: boolean
}): ContagemReducoes {
  const pressupostos: string[] = []
  const emFalta: string[] = []
  const desde = p.fimUltimoDescansoSemanalMs
  const doPeriodo = desde === null ? p.descansos : p.descansos.filter(d => d.inicioMs >= desde)

  let utilizadas = 0
  let insuf = 0
  let semanais = 0
  for (const d of doPeriodo) {
    const t = classificarDescansoDiario((d.fimMs - d.inicioMs) / 1000)
    if (t === 'reduzido') utilizadas++
    else if (t === 'insuficiente') insuf++
    else if (t === 'possivel_semanal') semanais++
  }
  if (semanais > 0) pressupostos.push('Descansos ≥24h foram ignorados na contagem (possíveis descansos semanais, não verificados).')
  if (insuf > 0) pressupostos.push('Existem intervalos <9h entre serviços: não são descansos diários válidos e não entram na contagem.')

  const conhecido = desde !== null && p.historicoCompleto
  if (desde === null) emFalta.push('fim do último descanso semanal')
  if (!p.historicoCompleto) emFalta.push('histórico completo de descansos desde o último descanso semanal')

  const restantesNoMaximo = Math.max(0, MAX_REDUCOES_ENTRE_SEMANAIS - utilizadas)
  const restantes = conhecido ? restantesNoMaximo : (restantesNoMaximo === 0 ? 0 : null)
  // Se já há 3 reduções contadas, mesmo com histórico incompleto não pode haver mais disponíveis.
  const estado: EstadoResultado = conhecido || restantesNoMaximo === 0 ? 'confirmado' : 'simulacao_condicionada'
  return {
    utilizadas,
    restantes,
    restantesNoMaximo,
    descansosInsuficientes: insuf,
    possiveisSemanaisIgnorados: semanais,
    estado,
    pressupostos,
    emFalta: restantesNoMaximo === 0 ? [] : emFalta,
    referencias: [REF.CE561_ART8_4],
  }
}
