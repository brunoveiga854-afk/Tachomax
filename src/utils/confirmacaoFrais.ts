// src/utils/confirmacaoFrais.ts
// Confirmação EXPLÍCITA do motorista sobre os frais de uma fiche + leitores que distinguem
//   • valor DOCUMENTAL (remboursementFrais / fraisBoletim),
//   • pagamento EFETIVO (fraisRecuConfirme na linha com fraisPagamentoId, mês bancário `declarado`),
//   • estimativa do motor (não passa por aqui).
// Funções puras: devolvem novos objetos; linhas inalteradas mantêm a referência.
// Só é chamada com uma resposta tocada pelo motorista no modal (fiche.tsx guardarTudo, resp.fraisConfirmacao).
// Nunca altera montantTotalRecu, cálculos, aprendizagem, hlag/flag nem o valor documental.
import type { MoisData } from '../types/moisdata'
import type { MesAno } from './mesesDeFrais'
import { resolverRecebimentoFrais } from './resolverRecebimentoFrais'

const TOLERANCIA_EUROS = 0.5 // igual a moneyMatches em fiche.tsx

export type ConfirmacaoFrais = {
  /** Literal obrigatório: só a interface (escolha do motorista) pode produzir esta confirmação. */
  confirmadoPeloMotorista: true
  fichePeriode: string
} & (
  | { estado: 'por_receber' | 'desconhecido' }
  | {
      estado: 'recebido'
      mesBanco: MesAno          // mês indicado pelo motorista
      valor: number             // valor realmente recebido
      pagamentoPeriode?: string // linha que já guarda o dinheiro (escolha explícita); ausente = o pagamento é desta linha
      /** Mês PREVISTO da fiche onde os frais vão aparecer (ainda inexistente). null = limpar previsão; ausente = não tocar. Só informativo. */
      docPrevisto?: MesAno | null
    }
)

export type OpcoesConfirmacao = { novoId: () => string }

export type MotivoRecusa =
  | 'sem_confirmacao_explicita' | 'fiche_inexistente' | 'valor_invalido'
  | 'conflito_com_pagamento_confirmado' | 'sem_pagamento_na_linha'
  | 'pagamento_inexistente' | 'pagamento_ja_reclamado' | 'pagamento_e_a_propria_fiche'
  | 'valor_diferente' | 'mes_diferente'

export type ResultadoConfirmacao =
  | { aplicado: true; historico: MoisData[] }
  | { aplicado: false; motivo: MotivoRecusa; historico: readonly MoisData[] }

const recusa = (historico: readonly MoisData[], motivo: MotivoRecusa): ResultadoConfirmacao =>
  ({ aplicado: false, motivo, historico })

const mesmoMes = (a: MesAno, b: MesAno) => a.ano === b.ano && a.mes === b.mes

/** Campos da previsão do mês documental. undefined = não toca; null = limpa; MesAno válido = grava (se a fiche prevista ainda não existe
 *  e não é esta própria fiche). Nunca altera valores, mês bancário nem o pagamento confirmado. */
function camposDocPrevisto(
  historico: readonly MoisData[], fiche: MoisData, docPrevisto: MesAno | null | undefined,
): Partial<MoisData> {
  if (docPrevisto === undefined) return {}
  if (docPrevisto === null) return { fraisDocPrevistoMes: undefined, fraisDocPrevistoAno: undefined }
  if (!mesValido(docPrevisto)) return {}
  const propria = { ano: fiche.anoFiche ?? fiche.annee, mes: fiche.mesFicheIndex ?? fiche.moisIndex }
  if (mesmoMes(docPrevisto, propria)) return { fraisDocPrevistoMes: undefined, fraisDocPrevistoAno: undefined }
  const label = `${MESES[docPrevisto.mes]} ${docPrevisto.ano}`
  if (historico.some(h => h.periode === label)) return {}   // a fiche já existe: não é «prevista»
  return { fraisDocPrevistoMes: docPrevisto.mes, fraisDocPrevistoAno: docPrevisto.ano }
}
const MESES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const mesValido = (m: MesAno | undefined): m is MesAno =>
  !!m && Number.isInteger(m.ano) && m.ano >= 2000 && m.ano <= 2100 && Number.isInteger(m.mes) && m.mes >= 0 && m.mes <= 11
const temPagamento = (d: MoisData) => !!d.fraisConfirmado && (d.fraisRecuConfirme || 0) > 0

/** A linha só documenta frais: o dinheiro está noutra linha. */
export const estaLigada = (d: Pick<MoisData, 'fraisContabilizadoId' | 'fraisContabilizadoEm'>): boolean =>
  !!(d.fraisContabilizadoId || d.fraisContabilizadoEm)

/** Linha que guarda o dinheiro de uma fiche ligada. Por id (estável); `periode` só como pista se a fiche não tiver id. */
export function pagamentoLigado(historico: readonly MoisData[], fiche: MoisData): MoisData | null {
  if (fiche.fraisContabilizadoId) {
    return historico.find(h => h !== fiche && h.fraisPagamentoId === fiche.fraisContabilizadoId) ?? null
  }
  if (fiche.fraisContabilizadoEm) {
    const c = historico.filter(h => h !== fiche && h.periode === fiche.fraisContabilizadoEm)
    return c.length === 1 ? c[0] : null
  }
  return null
}

/** Fiches ligadas a um pagamento que já não existe deixam de afirmar «recebido»; o documental fica. */
export function desligarOrfas(historico: readonly MoisData[]): readonly MoisData[] {
  let mudou = false
  const r = historico.map(h => {
    if (!estaLigada(h) || pagamentoLigado(historico, h)) return h
    mudou = true
    const { fraisContabilizadoId: _i, fraisContabilizadoEm: _e, ...resto } = h
    return { ...resto, fraisRecebimento: 'desconhecido' as const }
  })
  return mudou ? r : historico
}

/** Frais do mês de trabalho para os ecrãs (Home/Stats). Igual ao critério antigo, mas ignora linhas só-documentais ligadas. */
export function valorFraisDoMes(histSal: readonly MoisData[], ano: number, mes: number): number {
  const linha = histSal.find(m => !estaLigada(m)
    && (m.mesFraisTrabalhoIndex ?? m.moisIndex) === mes
    && (m.anoFraisTrabalho ?? m.annee) === ano)
  return linha ? (linha.fraisRecuConfirme || linha.fraisBoletim || linha.remboursementFrais || 0) : 0
}

/** Campos de frais a gravar na edição de uma fiche. Sem ligação = exatamente o comportamento antigo.
 *  Com ligação, só o documental muda: não recria o pagamento nem toca na associação. */
export function camposFraisDaEdicao(
  linha: MoisData, fraisEdit: number, mesIdx: number, ano: number,
): Partial<MoisData> {
  const documental = {
    fraisBoletim: fraisEdit,
    remboursementFrais: fraisEdit > 0 ? fraisEdit : linha.remboursementFrais,
  }
  if (estaLigada(linha)) return documental
  return {
    ...documental,
    fraisRecuConfirme: fraisEdit > 0 ? fraisEdit : linha.fraisRecuConfirme,
    fraisConfirmado: fraisEdit > 0,
    pagamentoFraisMesIndex: linha.pagamentoFraisMesIndex ?? mesIdx,
    pagamentoFraisAno: linha.pagamentoFraisAno ?? ano,
  }
}

/** Mensagem (francês) para o motorista quando uma confirmação de frais é recusada. */
export function mensagemRecusaFrais(motivo: MotivoRecusa | undefined): string {
  switch (motivo) {
    case 'valor_diferente':
      return 'Le montant ne correspond pas au paiement choisi. Vérifie le montant reçu ou choisis « Aucun ».'
    case 'mes_diferente':
      return 'Le mois de réception ne correspond pas à celui du paiement choisi. Corrige le mois ou choisis « Aucun ».'
    case 'pagamento_inexistente':
    case 'pagamento_ja_reclamado':
    case 'pagamento_e_a_propria_fiche':
      return "Le paiement choisi n'est pas disponible (introuvable ou déjà associé à une autre fiche). Choisis « Aucun » ou un autre paiement."
    case 'sem_pagamento_na_linha':
      return "Aucun paiement à confirmer pour ces frais. Saisis le montant reçu ou choisis un paiement déjà enregistré."
    case 'conflito_com_pagamento_confirmado':
      return 'Ces frais sont déjà confirmés comme reçus. Retire cette réponse ou corrige la fiche.'
    default:
      return "La confirmation des frais n'a pas pu être enregistrée. Vérifie tes réponses."
  }
}

export type ItemConfirmacao = { fichePeriode: string; confirmacao: Record<string, unknown> | undefined }
export type RecusaConfirmacao = { fichePeriode: string; motivo: MotivoRecusa | undefined; mensagem: string }

/** Aplica, por ordem, as confirmações explícitas. Se alguma for recusada, devolve o histórico ORIGINAL (nada é gravado)
 *  e a lista de recusas — o chamador deve avisar o motorista e não dar a operação por concluída. */
export function aplicarConfirmacoesFrais(
  historico: readonly MoisData[], itens: readonly ItemConfirmacao[], opcoes: OpcoesConfirmacao,
): { historico: readonly MoisData[]; recusas: RecusaConfirmacao[] } {
  let atual: readonly MoisData[] = historico
  const recusas: RecusaConfirmacao[] = []
  for (const it of itens) {
    if (!it.confirmacao) continue
    const rc = aplicarConfirmacaoRecebimentoFrais(
      atual, { ...it.confirmacao, confirmadoPeloMotorista: true, fichePeriode: it.fichePeriode } as ConfirmacaoFrais, opcoes)
    if (rc.aplicado) atual = rc.historico
    else {
      const motivo = 'motivo' in rc ? rc.motivo : undefined
      recusas.push({ fichePeriode: it.fichePeriode, motivo, mensagem: mensagemRecusaFrais(motivo) })
    }
  }
  return recusas.length ? { historico, recusas } : { historico: atual, recusas }
}

/** Editar um pagamento já associado a uma fiche não pode deixá-lo a zero (a ligação ficaria sem dinheiro). */
export function validarEdicaoPagamentoLigado(
  historico: readonly MoisData[], linha: MoisData, fraisEdit: number,
): { ok: true } | { ok: false; motivo: 'pagamento_ligado_a_zero'; fiches: string[]; mensagem: string } {
  if (!linha.fraisPagamentoId || fraisEdit > 0) return { ok: true }
  const fiches = historico
    .filter(h => h !== linha && h.fraisContabilizadoId === linha.fraisPagamentoId)
    .map(h => h.periode)
  if (fiches.length === 0) return { ok: true }
  return {
    ok: false,
    motivo: 'pagamento_ligado_a_zero',
    fiches,
    mensagem: `Ce paiement est associé à la fiche ${fiches.join(', ')}. Saisis un montant supérieur à 0, ou annule la modification (rien n'a été changé).`,
  }
}

/** Pagamentos já registados que o motorista pode escolher (nunca escolhe sozinha). */
export function listarPagamentosCandidatos(
  historico: readonly MoisData[], fichePeriode: string, valor: number,
): { periode: string; valor: number }[] {
  if (!(valor > 0)) return []
  const reclamados = new Set(historico.map(h => h.fraisContabilizadoId).filter(Boolean) as string[])
  return historico
    .filter(h => h.periode !== fichePeriode && temPagamento(h) && !estaLigada(h)
      && !(h.fraisPagamentoId && reclamados.has(h.fraisPagamentoId))
      && (h.fraisRecebimento === undefined || h.fraisRecebimento === 'recebido')
      && Math.abs((h.fraisRecuConfirme || 0) - valor) <= TOLERANCIA_EUROS)
    .map(h => ({ periode: h.periode, valor: h.fraisRecuConfirme || 0 }))
}

export function aplicarConfirmacaoRecebimentoFrais(
  historico: readonly MoisData[],
  confirmacao: ConfirmacaoFrais,
  opcoes: OpcoesConfirmacao,
): ResultadoConfirmacao {
  if ((confirmacao as { confirmadoPeloMotorista?: unknown })?.confirmadoPeloMotorista !== true) {
    return recusa(historico, 'sem_confirmacao_explicita')
  }
  const idx = historico.findIndex(h => h.periode === confirmacao.fichePeriode)
  if (idx < 0) return recusa(historico, 'fiche_inexistente')
  const fiche = historico[idx]

  // «Por receber» / «não sei»: só regista a resposta. Nunca zera nem apaga dinheiro já confirmado.
  if (confirmacao.estado === 'por_receber' || confirmacao.estado === 'desconhecido') {
    if (temPagamento(fiche)) return recusa(historico, 'conflito_com_pagamento_confirmado')
    const copia = [...historico]
    copia[idx] = { ...fiche, fraisRecebimento: confirmacao.estado }
    return { aplicado: true, historico: copia }
  }

  // «Recebido»
  const rec = confirmacao as Extract<ConfirmacaoFrais, { estado: 'recebido' }>
  if (!mesValido(rec.mesBanco) || !(rec.valor > 0)) return recusa(historico, 'valor_invalido')
  const { mesBanco, valor, pagamentoPeriode } = rec
  const banco = { pagamentoFraisMesIndex: mesBanco.mes, pagamentoFraisAno: mesBanco.ano, pagamentoFraisOrigem: 'declarado' as const }

  // (a) O pagamento é desta própria linha: só confirma mês/origem de um pagamento já existente.
  if (!pagamentoPeriode || pagamentoPeriode === fiche.periode) {
    if (pagamentoPeriode === fiche.periode) return recusa(historico, 'pagamento_e_a_propria_fiche')
    if (!temPagamento(fiche) || estaLigada(fiche)) return recusa(historico, 'sem_pagamento_na_linha')
    if (Math.abs((fiche.fraisRecuConfirme || 0) - valor) > TOLERANCIA_EUROS) return recusa(historico, 'valor_diferente')
    const copia = [...historico]
    copia[idx] = { ...fiche, ...banco, ...camposDocPrevisto(historico, fiche, rec.docPrevisto), fraisRecebimento: 'recebido' }
    return { aplicado: true, historico: copia }
  }

  // (b) O dinheiro já está noutra linha: a fiche passa a só documentar. Escolha explícita obrigatória.
  const r = resolverRecebimentoFrais({
    historico,
    fiche: { periode: fiche.periode, valorDocumental: fiche.remboursementFrais || 0 },
    resposta: { estado: 'recebido', mesBanco, valor, pagamentoPeriode },
  })
  if (r.estado !== 'confirmado') return recusa(historico, 'pagamento_inexistente')
  const pIdx = historico.findIndex(h => h.periode === pagamentoPeriode)
  const pagamento = historico[pIdx]
  if (pagamento.fraisPagamentoId
      && historico.some(h => h !== fiche && h.fraisContabilizadoId === pagamento.fraisPagamentoId)) {
    return recusa(historico, 'pagamento_ja_reclamado')
  }
  if (Math.abs((pagamento.fraisRecuConfirme || 0) - valor) > TOLERANCIA_EUROS) return recusa(historico, 'valor_diferente')
  if (temPagamento(fiche) && Math.abs((fiche.fraisRecuConfirme || 0) - valor) > TOLERANCIA_EUROS) {
    return recusa(historico, 'valor_diferente') // não descarta em silêncio um montante diferente
  }
  if (pagamento.pagamentoFraisOrigem === 'declarado'
      && pagamento.pagamentoFraisAno != null && pagamento.pagamentoFraisMesIndex != null
      && !mesmoMes({ ano: pagamento.pagamentoFraisAno, mes: pagamento.pagamentoFraisMesIndex }, mesBanco)) {
    return recusa(historico, 'mes_diferente')
  }
  const copia = [...historico]
  const idPagamento = pagamento.fraisPagamentoId ?? opcoes.novoId()
  // esta fiche É o documento previsto do pagamento: a previsão deixa de ser «prevista» (passa a documento real)
  const eraPrevista = pagamento.fraisDocPrevistoMes === (fiche.mesFicheIndex ?? fiche.moisIndex)
    && pagamento.fraisDocPrevistoAno === (fiche.anoFiche ?? fiche.annee)
  if (!pagamento.fraisPagamentoId || eraPrevista) {
    const { fraisDocPrevistoMes: _m, fraisDocPrevistoAno: _a, ...semPrev } = pagamento
    copia[pIdx] = { ...(eraPrevista ? semPrev : pagamento), fraisPagamentoId: idPagamento }
  }
  // Documental preservado (remboursementFrais). O dinheiro fica só na linha do pagamento.
  copia[idx] = {
    ...fiche,
    ...banco,
    fraisRecebimento: 'recebido',
    fraisContabilizadoId: idPagamento,
    fraisContabilizadoEm: pagamento.periode, // pista legível; a identidade é o id
    fraisRecuConfirme: undefined,
    fraisConfirmado: false,
  }
  return { aplicado: true, historico: copia }
}
