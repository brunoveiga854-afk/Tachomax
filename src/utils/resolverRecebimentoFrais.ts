// src/utils/resolverRecebimentoFrais.ts
// Etapa 2B-1 (preparatória): dado o histórico e a resposta do motorista sobre os frais de uma fiche,
// propõe (ou não) a ligação a um pagamento bancário anterior. Função PURA: nunca altera o histórico
// e não está ligada a guardarTudo, aplicarConfirmacaoFraisPorValor, cálculos, aprendizagem ou interface.
//
// Limitação: MoisData não tem identificador de pagamento. A identidade é avaliada por evidências
// (valor, mês bancário declarado, mês de trabalho). Montante + mês bancário NÃO bastam; datas
// inferidas ou de origem desconhecida nunca contam como prova. Sem evidência suficiente → «requer_confirmacao».
import type { MoisData } from '../types/moisdata'
import { mesesDeFrais, type MesAno, type OrigemBanco } from './mesesDeFrais'

const TOLERANCIA_EUROS = 0.5 // igual a moneyMatches em fiche.tsx

export type RespostaRecebimento =
  | { estado: 'por_receber' }
  | { estado: 'desconhecido' }
  | {
      estado: 'recebido'
      mesBanco?: MesAno            // mês em que o motorista diz ter recebido
      valor?: number               // valor realmente recebido (por omissão, o documental)
      pagamentoPeriode?: string    // escolha EXPLÍCITA do pagamento (periode da linha)
    }

export type FicheFrais = {
  periode: string
  valorDocumental: number          // rubrica da fiche (remboursementFrais); documental, não é dinheiro
  trabalho?: MesAno | null         // só se conhecido/declarado — nunca o derivado do flag
}

export type EntradaResolver = {
  historico: readonly MoisData[]
  fiche: FicheFrais
  resposta: RespostaRecebimento
}

export type Candidato = {
  periode: string
  valor: number
  banco: MesAno | null
  origemBanco: OrigemBanco
  trabalho: MesAno | null
  evidenciaBanco: 'declarado' | 'nao_comprovado'
  evidenciaTrabalho: 'igual' | 'indeterminado'
  forte: boolean                   // banco declarado E trabalho igual
}

export type MotivoNenhum =
  | 'por_receber' | 'desconhecido' | 'sem_candidatos' | 'pagamento_inexistente'

export type ResultadoRecebimento =
  | { estado: 'nenhum'; motivo: MotivoNenhum; candidatos: [] ; proposta: null }
  | { estado: 'possivel'; candidatos: [Candidato]; proposta: { fraisContabilizadoEm: string } }
  | { estado: 'varios'; candidatos: Candidato[]; proposta: null }
  | { estado: 'requer_confirmacao'; candidatos: Candidato[]; proposta: null }
  | { estado: 'confirmado'; candidatos: Candidato[]; proposta: { fraisContabilizadoEm: string } }

const mesmoMes = (a: MesAno, b: MesAno) => a.ano === b.ano && a.mes === b.mes

const temPagamento = (d: MoisData) => !!d.fraisConfirmado && (d.fraisRecuConfirme || 0) > 0

// Linha disponível como portadora de dinheiro: tem pagamento, não é só documento ligado a outro,
// e não respondeu «por_receber/desconhecido».
const podeSerPagamento = (d: MoisData) =>
  temPagamento(d) && !d.fraisContabilizadoEm && (d.fraisRecebimento === undefined || d.fraisRecebimento === 'recebido')

export function resolverRecebimentoFrais(e: EntradaResolver): ResultadoRecebimento {
  const { historico, fiche, resposta } = e

  if (resposta.estado === 'por_receber' || resposta.estado === 'desconhecido') {
    return { estado: 'nenhum', motivo: resposta.estado, candidatos: [], proposta: null }
  }

  const reclamados = new Set(historico.map(h => h.fraisContabilizadoEm).filter(Boolean) as string[])
  const outras = historico.filter(h => h.periode !== fiche.periode)

  // Confirmação explícita: o motorista escolheu o pagamento. Só se a linha existir e tiver dinheiro.
  if (resposta.pagamentoPeriode) {
    const alvo = outras.find(h => h.periode === resposta.pagamentoPeriode)
    if (!alvo || !podeSerPagamento(alvo)) {
      return { estado: 'nenhum', motivo: 'pagamento_inexistente', candidatos: [], proposta: null }
    }
    return {
      estado: 'confirmado',
      candidatos: [descrever(alvo, fiche, resposta)],
      proposta: { fraisContabilizadoEm: alvo.periode },
    }
  }

  const valorAlvo = resposta.valor && resposta.valor > 0 ? resposta.valor : fiche.valorDocumental
  const candidatos: Candidato[] = []
  for (const h of outras) {
    if (!podeSerPagamento(h) || reclamados.has(h.periode)) continue
    if (!(valorAlvo > 0) || Math.abs((h.fraisRecuConfirme || 0) - valorAlvo) > TOLERANCIA_EUROS) continue
    const c = descrever(h, fiche, resposta)
    // Mês bancário indicado: pagamento sem data bancária ou com outro mês não corresponde.
    if (resposta.mesBanco && (!c.banco || !mesmoMes(c.banco, resposta.mesBanco))) continue
    // Períodos de trabalho ambos conhecidos e diferentes → pagamentos distintos.
    if (fiche.trabalho && c.trabalho && !mesmoMes(fiche.trabalho, c.trabalho)) continue
    candidatos.push(c)
  }

  if (candidatos.length === 0) return { estado: 'nenhum', motivo: 'sem_candidatos', candidatos: [], proposta: null }
  if (candidatos.length > 1) return { estado: 'varios', candidatos, proposta: null }
  const [unico] = candidatos
  if (!unico.forte) return { estado: 'requer_confirmacao', candidatos, proposta: null }
  return { estado: 'possivel', candidatos: [unico], proposta: { fraisContabilizadoEm: unico.periode } }
}

function descrever(h: MoisData, fiche: FicheFrais, r: Extract<RespostaRecebimento, { estado: 'recebido' }>): Candidato {
  const m = mesesDeFrais(h)
  const evidenciaBanco: Candidato['evidenciaBanco'] =
    m.origemBanco === 'declarado' && m.banco && (!r.mesBanco || mesmoMes(m.banco, r.mesBanco)) ? 'declarado' : 'nao_comprovado'
  const evidenciaTrabalho: Candidato['evidenciaTrabalho'] =
    fiche.trabalho && m.trabalho && mesmoMes(fiche.trabalho, m.trabalho) ? 'igual' : 'indeterminado'
  return {
    periode: h.periode,
    valor: h.fraisRecuConfirme || 0,
    banco: m.banco,
    origemBanco: m.origemBanco,
    trabalho: m.trabalho,
    evidenciaBanco,
    evidenciaTrabalho,
    forte: evidenciaBanco === 'declarado' && evidenciaTrabalho === 'igual',
  }
}
