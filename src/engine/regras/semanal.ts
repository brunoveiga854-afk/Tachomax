// src/engine/regras/semanal.ts
// Regras semanais — SÓ onde os dados, a categoria e as definições legais o permitem.
//
// IMPLEMENTADO: tempo de SERVIÇO numa semana isolada (R3312-50): 56h grands routiers, 52h outros condutores
// de mercadorias, 48h messagerie/transporte de fundos. Exige categoria regulamentar CONHECIDA (nunca deduzida
// de CD/MIXTE/LD) e semana completa nos dados.
//
// NÃO IMPLEMENTADO (indicadores distintos, não se misturam):
//  • médias de tempo de serviço (53h/50h/44h) – período de referência definido por acordo;
//  • TEMPO DE TRABALHO da Diretiva 2002/15/CE (média 48h em 4 meses, máx. 60h numa semana) – exige separar
//    trabalho de disponibilidade, que a app não regista;
//  • tempo de CONDUÇÃO (56h semanais, 90h em duas semanas, 9h/10h diárias) – a app não mede condução;
//  • descanso semanal (45h / 24h com compensação).
import type { CategoriaServico, EstadoResultado, NaoAvaliada, Referencia } from './tipos'
import { REF } from './referencias'

export const LIMITE_SERVICO_SEMANA_ISOLADA_H: Record<Exclude<CategoriaServico, 'desconhecida'>, number> = {
  grand_routier: 56,
  outro_marchandises: 52,
  messagerie_fonds: 48,
}

export type AvaliacaoServicoSemanal = {
  avaliada: boolean
  estado: EstadoResultado
  limiteSeg: number | null
  restanteSeg: number | null
  pressupostos: string[]
  emFalta: string[]
  motivoNaoAvaliada?: string
  referencias: Referencia[]
}

export function avaliarServicoSemanal(p: {
  categoria: CategoriaServico
  /** serviço total acumulado na semana (segunda a domingo), incluindo o dia em curso até à referência */
  servicoSemanaSeg: number | null
  /** true só se todos os dias da semana têm dados */
  semanaCompleta: boolean
}): AvaliacaoServicoSemanal {
  const referencias = [REF.R3312_50]
  if (p.categoria === 'desconhecida') {
    return {
      avaliada: false, estado: 'dados_insuficientes', limiteSeg: null, restanteSeg: null,
      pressupostos: [], emFalta: ['categoria regulamentar (grand routier / outro marchandises / messagerie-fonds)'],
      motivoNaoAvaliada: 'categoria regulamentar desconhecida: não se deduz de CD/MIXTE/LD', referencias,
    }
  }
  const limiteSeg = LIMITE_SERVICO_SEMANA_ISOLADA_H[p.categoria] * 3600
  if (p.servicoSemanaSeg === null) {
    return {
      avaliada: false, estado: 'dados_insuficientes', limiteSeg, restanteSeg: null,
      pressupostos: [], emFalta: ['serviço acumulado da semana'],
      motivoNaoAvaliada: 'sem serviço semanal acumulado', referencias,
    }
  }
  const pressupostos = ['Semana tratada como segunda-feira a domingo (relógio de parede).']
  const emFalta: string[] = []
  if (!p.semanaCompleta) emFalta.push('dias em falta na semana')
  // limite de uma semana ISOLADA (R3312-50): não substitui as médias, que não são avaliadas.
  const estado: EstadoResultado = p.semanaCompleta ? 'confirmado' : 'simulacao_condicionada'
  return {
    avaliada: true, estado, limiteSeg,
    restanteSeg: Math.max(0, limiteSeg - p.servicoSemanaSeg),
    pressupostos, emFalta, referencias,
  }
}

export const REGRAS_NAO_SUPORTADAS: NaoAvaliada[] = [
  { id: 'conducao_diaria_semanal', texto: REF.CE561_ART6_7.texto, motivo: 'a app não mede o tempo de condução separadamente do serviço' },
  { id: 'pausa_conducao_4h30', texto: 'Pausa de 45 min após 4h30 de condução (art. 7.º do Reg. 561/2006)', motivo: 'sem tempo de condução; as pausas de trabalho (L3312-2) são avaliadas à parte' },
  { id: 'diretiva_2002_15_trabalho', texto: REF.DIR_2002_15.texto, motivo: 'tempo de trabalho ≠ tempo de serviço; a app não separa trabalho de disponibilidade' },
  { id: 'servico_medias_r3312_50', texto: 'Médias de tempo de serviço (53h/50h/44h) em período de referência', motivo: 'período de referência definido por acordo; não registado' },
  { id: 'descanso_semanal', texto: 'Descanso semanal 45h / 24h com compensação (art. 8.º n.º 6–9)', motivo: 'sem registo fiável de descansos semanais nem de compensações' },
  { id: 'descanso_fracionado', texto: REF.CE561_ART8_2_FRACIONADO.texto, motivo: 'regime não suportado' },
  { id: 'equipagem', texto: REF.CE561_ART8_5.texto, motivo: 'regime de equipagem não suportado' },
  { id: 'derrogacoes_r3312_52', texto: 'Prolongamentos temporários por trabalhos urgentes (R3312-52) e outras derrogações', motivo: 'não suportado; não se assume que se aplicam' },
]
