// src/utils/servicoCurto.ts
// Deteção de serviços de duração muito curta ao TERMINAR (iniciados por engano ou para testar a app).
// Módulo PURO e isolado: não lê nem escreve armazenamento. Nunca classifica um serviço como inválido pela duração —
// só decide se é preciso pedir confirmação ao motorista, e o que fazer com a resposta.
//
//  • < 5 min            → «Service très court — à confirmer» (aviso)
//  • 5 min a 10 min     → confirmação discreta («Service court»)
//  • > 10 min           → sem pergunta
// A duração avaliada é a do SERVIÇO TOTAL (tempo de serviço contado), nunca a de um segmento de troca de camião:
// uma troca de camião dentro do serviço não é um serviço curto.
export const LIMITE_MUITO_CURTO_SEG = 5 * 60
export const LIMITE_CURTO_SEG = 10 * 60

export type NivelServicoCurto = 'normal' | 'curto' | 'muito_curto'

export type ClassificacaoCurto = {
  nivel: NivelServicoCurto
  /** minutos inteiros (arredondado para baixo) para mostrar na pergunta */
  minutos: number
  titulo: string
  mensagem: string
}

export function classificarServicoCurto(segServico: number): ClassificacaoCurto {
  // valor inválido/ilegível → pede confirmação (nunca assume que é normal nem que é inválido)
  const valido = typeof segServico === 'number' && Number.isFinite(segServico)
  const seg = valido ? Math.max(0, segServico) : 0
  const minutos = Math.floor(seg / 60)
  if (!valido || seg < LIMITE_MUITO_CURTO_SEG) {
    return {
      nivel: 'muito_curto', minutos,
      titulo: 'Service très court — à confirmer',
      mensagem: `Durée du service : ${minutos} min. Veux-tu l'enregistrer dans l'historique ?`,
    }
  }
  if (seg <= LIMITE_CURTO_SEG) {
    return {
      nivel: 'curto', minutos,
      titulo: 'Service court',
      mensagem: `Durée du service : ${minutos} min. Enregistrer ?`,
    }
  }
  return { nivel: 'normal', minutos, titulo: '', mensagem: '' }
}

export type EscolhaServicoCurto = 'guardar' | 'nao_guardar' | 'cancelar'

export type DecisaoFimServico =
  /** serviço normal ou curto confirmado: gravar como serviço válido */
  | { accao: 'guardar'; curtoConfirmado: boolean }
  /** o motorista não quer guardar: encerra o serviço em curso SEM tocar no histórico, totais, frais ou km */
  | { accao: 'descartar' }
  /** o motorista desistiu de terminar: o serviço continua em curso, nada muda */
  | { accao: 'manter_em_curso' }
  /** é preciso perguntar (ainda sem resposta) */
  | { accao: 'perguntar'; classificacao: ClassificacaoCurto }

/** `escolha === null` = ainda não houve pergunta. */
export function decidirFimServico(segServico: number, escolha: EscolhaServicoCurto | null): DecisaoFimServico {
  const c = classificarServicoCurto(segServico)
  if (c.nivel === 'normal') return { accao: 'guardar', curtoConfirmado: false }
  if (escolha === null) return { accao: 'perguntar', classificacao: c }
  if (escolha === 'guardar') return { accao: 'guardar', curtoConfirmado: true }
  if (escolha === 'nao_guardar') return { accao: 'descartar' }
  return { accao: 'manter_em_curso' }
}
