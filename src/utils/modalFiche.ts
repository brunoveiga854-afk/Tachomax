// src/utils/modalFiche.ts
// Lógica PURA do modal «Fiche de paie» (3 secções: Salaire · Frais · Vérification).
// Não lê nem escreve dados, não toca em hlag/flag: só calcula o que o modal mostra e o que PODE ser gravado.
//   • Salaire e Frais têm, cada um, três meses independentes: TRAVAIL · PAIEMENT (banque) · DOCUMENT (fiche).
//   • Cada mês tem um estado: 'confirmé' (declarado/confirmado EXPLICITAMENTE pelo motorista nesta fiche),
//     'inféré' (hipótese: sugerido pela fiche ou pelo décalage — mesmo que o seletor o mostre),
//     'prévu' (documento ainda inexistente), 'inconnu' (resposta «Pas encore connu»).
//   • Carregar em «Enregistrer» NUNCA confirma um mês: só um toque no seletor ou em «Confirmer ce mois» o faz.
//   • Mudar um desfasamento (hlag/flag) confirmado exige consentimento explícito (avaliarLag).
//   • fundirFicheExistente: reimportar uma fiche existente preserva meses/pagamentos confirmados e nunca cria 2.º pagamento.
import { deslocarMes, limitarOffsetBanco, rotuloMes, resolverMesesModal, type MesAno, type EstadoDocumento } from './mesesRecebimentoFrais'
import { lagValido, LAG_MAX } from './lagsConfirmados'
import type { MoisData } from '../types/moisdata'

// mesmo critério de confirmacaoFrais.estaLigada (não se importa: só a interface pode usar esse módulo)
const estaLigada = (d: Pick<MoisData, 'fraisContabilizadoId' | 'fraisContabilizadoEm'>): boolean => !!(d.fraisContabilizadoId || d.fraisContabilizadoEm)

export type EstadoMes = 'confirmé' | 'inféré' | 'prévu' | 'inconnu'
export type MesComEstado = { mes: MesAno | null; rotulo: string; estado: EstadoMes; nota?: string }

export const ROTULO_INCONNU = 'Pas encore connu'
const comEstado = (mes: MesAno | null, estado: EstadoMes, nota?: string): MesComEstado =>
  ({ mes, rotulo: mes ? rotuloMes(mes) : ROTULO_INCONNU, estado, ...(nota ? { nota } : {}) })

/** Limites do mês do documento de salário: -2 (fiche anterior) … +3 (fiche futura). null = «Pas encore connu». */
export const SAL_DOC_MIN = -2
export const SAL_DOC_MAX = 3
export const limitarDocSalario = (n: number): number =>
  Math.min(SAL_DOC_MAX, Math.max(SAL_DOC_MIN, Math.trunc(Number.isFinite(n) ? n : 0)))

// ───────────────────────────── Salaire ─────────────────────────────
export type EntradaSalario = {
  fiche: MesAno                      // mês que o documento mostra (sugestão identificada na fiche)
  lag: number                        // hlag em vigor (confirmado ou hipótese)
  lagConfirmado: boolean
  bancoOffset: number                // meses ANTES do mês da fiche em que o dinheiro entrou (0 = mês da fiche; negativo = depois)
  bancoConfirmado: boolean           // o motorista confirmou/escolheu o mês bancário nesta fiche?
  trabalhoLag: number | null         // desfasamento banco−trabalho escolhido agora (null = usar `lag`)
  trabalhoConfirmado: boolean        // o motorista confirmou/escolheu o mês de trabalho nesta fiche?
  docOffset: number | null           // mês do documento = fiche + n; null = «Pas encore connu»
  docConfirmado: boolean             // confirmou o mês lido na fiche (offset 0) sem o alterar?
}
export type MesesSalario = {
  trabalho: MesComEstado
  banco: MesComEstado
  documento: MesComEstado
  lagUsado: number
  /** Confirmações EXPLÍCITAS desta fiche (só estas geram campos gravados). */
  bancoConf: boolean
  trabConf: boolean
  docConf: boolean
  docModo: 'confirmado' | 'corrigido' | 'desconhecido' | null
}

export function resolverMesesSalario(e: EntradaSalario): MesesSalario {
  const bOff = limitarOffsetBanco(e.bancoOffset)
  const banco = deslocarMes(e.fiche, -bOff)
  const lagBase = lagValido(e.lag) ? e.lag : 2
  const trabDeclarado = e.trabalhoConfirmado || (e.trabalhoLag !== null && lagValido(e.trabalhoLag))
  const lagUsado = e.trabalhoLag !== null && lagValido(e.trabalhoLag) ? e.trabalhoLag : lagBase
  const trabalho = deslocarMes(banco, -lagUsado)
  let documento: MesComEstado
  let docModo: MesesSalario['docModo'] = null
  if (e.docOffset === null) { documento = comEstado(null, 'inconnu'); docModo = 'desconhecido' }
  else {
    const dOff = limitarDocSalario(e.docOffset)
    if (dOff !== 0) { documento = comEstado(deslocarMes(e.fiche, dOff), 'confirmé', 'Corrigé par toi'); docModo = 'corrigido' }
    else if (e.docConfirmado) { documento = comEstado(e.fiche, 'confirmé', 'Confirmé par toi'); docModo = 'confirmado' }
    else documento = comEstado(e.fiche, 'inféré', 'Mois identifié sur le document (à confirmer)')
  }
  return {
    trabalho: comEstado(trabalho, trabDeclarado ? 'confirmé' : 'inféré',
      trabDeclarado ? 'Confirmé par toi pour cette fiche'
        : e.lagConfirmado ? `Déduit de ton décalage confirmé (${lagUsado} mois) — à confirmer pour cette fiche`
        : `Hypothèse : décalage de ${lagUsado} mois`),
    banco: comEstado(banco, e.bancoConfirmado ? 'confirmé' : 'inféré',
      e.bancoConfirmado ? 'Confirmé par toi' : 'Hypothèse : mois de la fiche (à confirmer)'),
    documento,
    lagUsado,
    bancoConf: e.bancoConfirmado,
    trabConf: trabDeclarado,
    docConf: docModo !== null,
    docModo,
  }
}

// ───────────────────────────── Consentimento do desfasamento ─────────────────────────────
export type AvaliacaoLag = {
  tipo: 'igual_confirmado' | 'igual_nao_confirmado' | 'novo' | 'conflito'
  /** true: só se grava no padrão se o motorista aceitar explicitamente. Nunca é automático. */
  precisaConsentimento: boolean
  mensagem: string
}
export function avaliarLag(e: { escolhido: number; guardado: number | null | undefined; confirmado: boolean }): AvaliacaoLag {
  const g = lagValido(e.guardado) ? e.guardado : null
  if (!lagValido(e.escolhido)) return { tipo: 'conflito', precisaConsentimento: false, mensagem: `Décalage invalide (0 à ${LAG_MAX} mois).` }
  if (g !== null && g === e.escolhido) {
    return e.confirmado
      ? { tipo: 'igual_confirmado', precisaConsentimento: false, mensagem: `Identique à ton décalage confirmé (${g} mois).` }
      : { tipo: 'igual_nao_confirmado', precisaConsentimento: true, mensagem: `Confirmer ce décalage de ${g} mois pour les prochains mois ?` }
  }
  if (e.confirmado && g !== null) {
    return { tipo: 'conflito', precisaConsentimento: true,
      mensagem: `Ton décalage confirmé est ${g} mois ; ici tu indiques ${e.escolhido}. Il ne change que si tu l'acceptes.` }
  }
  return { tipo: 'novo', precisaConsentimento: true, mensagem: `Utiliser ${e.escolhido} mois comme décalage pour les prochains mois ?` }
}
/** Só grava o desfasamento no padrão com consentimento explícito e quando há algo a mudar. */
export const deveGravarLag = (a: AvaliacaoLag, consentimento: boolean): boolean =>
  consentimento && a.precisaConsentimento

// ───────────────────────────── Valores: documental vs banco ─────────────────────────────
export type OrigemValor = 'extrait' | 'confirmé' | 'estimé' | 'vide'
const EPS = 0.005
export function compararValores(extraido: number, recebido: number): {
  estado: 'sem_valor' | 'so_documento' | 'so_banco' | 'igual' | 'diferente'
  diferenca: number
} {
  const e = extraido > 0, r = recebido > 0
  if (!e && !r) return { estado: 'sem_valor', diferenca: 0 }
  if (e && !r) return { estado: 'so_documento', diferenca: 0 }
  if (!e && r) return { estado: 'so_banco', diferenca: 0 }
  const d = Math.round((recebido - extraido) * 100) / 100
  return Math.abs(d) < EPS ? { estado: 'igual', diferenca: 0 } : { estado: 'diferente', diferenca: d }
}
/** Origem do valor mostrado: igual ao extraído → «extrait» (IA); editado → «confirmé»; vazio → «vide». */
export function origemValor(extraido: number, atual: number, tocadoPeloMotorista: boolean): OrigemValor {
  if (!(atual > 0)) return 'vide'
  if (tocadoPeloMotorista && Math.abs(atual - extraido) >= EPS) return 'confirmé'
  if (extraido > 0 && Math.abs(atual - extraido) < EPS) return 'extrait'
  return tocadoPeloMotorista ? 'confirmé' : 'estimé'
}

// ───────────────────────────── Frais (reutiliza resolverMesesModal) ─────────────────────────────
export type EntradaFrais = {
  fiche: MesAno
  periodosExistentes: readonly string[]
  resposta: 'recebido' | 'por_receber' | 'desconhecido' | null
  bancoOffset: number
  bancoConfirmado: boolean           // o motorista confirmou/escolheu o mês bancário dos frais?
  docOffset: number
  docConfirmado: boolean             // confirmou o mês lido na fiche (offset 0)?
  docDesconhecido: boolean           // «Pas encore connu / Document prévu»
  flag: number
  flagConfirmado: boolean
  trabalhoLag: number | null         // desfasamento banco−trabalho dos frais escolhido agora
  trabalhoConfirmado: boolean
}
export type MesesFrais = {
  trabalho: MesComEstado
  banco: MesComEstado
  documento: MesComEstado
  documentoEstado: EstadoDocumento | 'desconhecido'
  lagUsado: number
  /** Para fraisConfirmacao.docPrevisto: undefined = não tocar; null = limpar; MesAno = gravar previsão. */
  docPrevistoParaGravar: MesAno | null | undefined
  bancoConf: boolean
  trabConf: boolean
}
export function resolverMesesFrais(e: EntradaFrais): MesesFrais {
  const mm = resolverMesesModal({
    fiche: e.fiche, bancoOffset: e.bancoOffset, docOffset: e.docOffset, periodosExistentes: e.periodosExistentes,
  })
  const recebido = e.resposta === 'recebido'
  const flagBase = lagValido(e.flag) ? e.flag : 1
  const declarado = e.trabalhoConfirmado || (e.trabalhoLag !== null && lagValido(e.trabalhoLag))
  const lagUsado = e.trabalhoLag !== null && lagValido(e.trabalhoLag) ? e.trabalhoLag : flagBase
  const baseTrab = recebido ? mm.banco : e.fiche
  const trabalho = deslocarMes(baseTrab, -lagUsado)
  let documento: MesComEstado
  let documentoEstado: MesesFrais['documentoEstado']
  let docPrevistoParaGravar: MesesFrais['docPrevistoParaGravar']
  if (!recebido) {
    documento = comEstado(null, 'inconnu'); documentoEstado = 'desconhecido'; docPrevistoParaGravar = undefined
  } else if (e.docDesconhecido) {
    documento = comEstado(null, 'inconnu', 'Document prévu — rien enregistré'); documentoEstado = 'desconhecido'; docPrevistoParaGravar = undefined
  } else {
    documentoEstado = mm.documentoEstado
    if (mm.documentoEstado === 'esta_fiche') {
      // «esta fiche» só limpa uma previsão antiga se o motorista o confirmou; senão não se toca em nada
      docPrevistoParaGravar = e.docConfirmado ? null : undefined
      documento = comEstado(mm.documento, e.docConfirmado ? 'confirmé' : 'inféré',
        e.docConfirmado ? 'Confirmé : fiche en cours' : 'Mois identifié sur la fiche en cours (à confirmer)')
    } else if (mm.documentoEstado === 'prevista') {
      docPrevistoParaGravar = mm.docPrevistoParaGravar
      documento = comEstado(mm.documento, 'prévu', 'Fiche pas encore importée (non confirmé)')
    } else {
      docPrevistoParaGravar = undefined
      documento = comEstado(mm.documento, 'confirmé', 'Fiche déjà importée')
    }
  }
  return {
    trabalho: comEstado(trabalho, declarado ? 'confirmé' : 'inféré',
      declarado ? 'Confirmé par toi pour cette fiche'
        : e.flagConfirmado ? `Déduit de ton décalage confirmé (${lagUsado} mois) — à confirmer pour cette fiche`
        : `Hypothèse : décalage de ${lagUsado} mois`),
    banco: recebido
      ? comEstado(mm.banco, e.bancoConfirmado ? 'confirmé' : 'inféré', e.bancoConfirmado ? 'Confirmé par toi' : 'Hypothèse : mois de la fiche (à confirmer)')
      : comEstado(null, 'inconnu', e.resposta === null ? 'Pas encore répondu' : undefined),
    documento, documentoEstado, lagUsado, docPrevistoParaGravar,
    bancoConf: recebido && e.bancoConfirmado,
    trabConf: declarado,
  }
}

// ───────────────────────────── Vérification + validação ─────────────────────────────
export type EntradaVerificacao = {
  salario: MesesSalario
  frais: MesesFrais
  salExtraido: number; salRecebido: number; salTocado: boolean
  fraisExtraido: number; fraisRecebido: number
  fraisResposta: EntradaFrais['resposta']
  interessement: number; primeNonAcc: number
  moisAtipico: boolean
  lagSalario?: AvaliacaoLag | null; lagSalarioAceite?: boolean
}
export type Verificacao = {
  salaire: { trabalho: MesComEstado; banco: MesComEstado; documento: MesComEstado }
  frais: { trabalho: MesComEstado; banco: MesComEstado; documento: MesComEstado }
  valores: { salExtraido: number; salRecebido: number; salOrigem: OrigemValor; salEstado: ReturnType<typeof compararValores>
             fraisExtraido: number; fraisRecebido: number; fraisEstado: ReturnType<typeof compararValores> }
  primes: { interessement: number; primeNonAcc: number }
  tipoMes: 'normal' | 'exceptionnel'
  /** Meses ainda NÃO confirmados (hipóteses). Informativo: nunca bloqueia, pode ser legitimamente desconhecido. */
  naoConfirmados: string[]
  avisos: string[]       // divergências / dados a confirmar (informativo, não bloqueia)
  erros: string[]        // impedem «Enregistrer»
  podeGuardar: boolean
}

export function verificar(e: EntradaVerificacao): Verificacao {
  const sal = compararValores(e.salExtraido, e.salRecebido)
  const fr = compararValores(e.fraisExtraido, e.fraisResposta === 'por_receber' || e.fraisResposta === 'desconhecido' ? 0 : e.fraisRecebido)
  const avisos: string[] = []
  const erros: string[] = []
  const salValor = e.salRecebido > 0
  // «Pas encore reçus» / «Je ne sais pas»: o montante é só documental. Sem resposta = comportamento antigo (conta).
  const fraisValor = e.fraisResposta !== 'por_receber' && e.fraisResposta !== 'desconhecido' && e.fraisRecebido > 0
  if (!salValor && !fraisValor) erros.push('Indique le salaire reçu ou les frais reçus.')
  if (e.fraisResposta === 'recebido' && !(e.fraisRecebido > 0)) erros.push('Frais « déjà reçus » : saisis le montant reçu.')
  // frais «reçus»: o mês bancário é conhecido pelo motorista — tem de o confirmar (não se grava uma hipótese como declarada)
  if (e.fraisResposta === 'recebido' && e.fraisRecebido > 0 && !e.frais.bancoConf)
    erros.push('Frais : confirme le mois de paiement (banque) — touche « Confirmer ce mois ».')
  if (sal.estado === 'diferente') avisos.push(`Salaire : la fiche indique ${e.salExtraido}€, tu as reçu ${e.salRecebido}€ (écart ${sal.diferenca > 0 ? '+' : ''}${sal.diferenca}€). Les deux valeurs sont conservées.`)
  if (fr.estado === 'diferente') avisos.push(`Frais : la fiche indique ${e.fraisExtraido}€, tu as reçu ${e.fraisRecebido}€ (écart ${fr.diferenca > 0 ? '+' : ''}${fr.diferenca}€). Les deux valeurs sont conservées.`)
  if (e.salario.documento.estado === 'inconnu') avisos.push('Salaire : mois du document pas encore connu.')
  if (e.frais.documento.estado === 'prévu') avisos.push('Frais : fiche documentaire prévue, pas encore importée (non confirmé).')
  if (e.frais.documento.estado === 'inconnu' && e.fraisResposta === 'recebido') avisos.push('Frais : mois du document pas encore connu.')
  if (e.fraisResposta === null && (e.fraisExtraido > 0)) avisos.push('Frais : tu n\'as pas encore dit si ces frais ont été reçus.')
  if (e.lagSalario?.precisaConsentimento && !e.lagSalarioAceite && e.lagSalario.tipo === 'conflito')
    avisos.push(e.lagSalario.mensagem)
  const naoConfirmados: string[] = []
  const nota = (sec: string, rot: string, m: MesComEstado) => {
    if (m.estado === 'inféré') naoConfirmados.push(`${sec} — ${rot} : ${m.rotulo} (hypothèse, non confirmé)`)
  }
  nota('Salaire', 'mois travaillé', e.salario.trabalho)
  nota('Salaire', 'mois de paiement', e.salario.banco)
  nota('Salaire', 'mois du document', e.salario.documento)
  nota('Frais', 'mois travaillé', e.frais.trabalho)
  nota('Frais', 'mois de paiement', e.frais.banco)
  nota('Frais', 'mois du document', e.frais.documento)
  return {
    salaire: { trabalho: e.salario.trabalho, banco: e.salario.banco, documento: e.salario.documento },
    frais: { trabalho: e.frais.trabalho, banco: e.frais.banco, documento: e.frais.documento },
    valores: { salExtraido: e.salExtraido, salRecebido: e.salRecebido, salOrigem: origemValor(e.salExtraido, e.salRecebido, e.salTocado), salEstado: sal,
               fraisExtraido: e.fraisExtraido, fraisRecebido: e.fraisRecebido, fraisEstado: fr },
    primes: { interessement: e.interessement, primeNonAcc: e.primeNonAcc },
    tipoMes: e.moisAtipico ? 'exceptionnel' : 'normal',
    naoConfirmados, avisos, erros, podeGuardar: erros.length === 0,
  }
}

// ───────────────────────────── O que gravar (campos explícitos) ─────────────────────────────
export type CamposSalario = {
  pagamentoSalMesIndex?: number; pagamentoSalAno?: number; mesPagamentoIndex?: number; anoPagamento?: number
  pagamentoSalOrigem?: 'declarado' | 'inferido'
  mesTrabalhoIndex?: number; anoTrabalho?: number; mesTrabalhoOrigem?: 'declarado'
  salDocMesIndex?: number; salDocAno?: number; salDocEstado?: 'confirmado' | 'corrigido' | 'desconhecido'
}
/** Campos a juntar à resposta. Cada mês é gravado SÓ se o motorista o confirmou; confirmar um não altera os outros.
 *  Sem confirmação: o pagamento do salário continua a levar o mês da fiche (comportamento antigo) mas marcado 'inferido'. */
export function camposExplicitosSalario(m: MesesSalario): CamposSalario {
  const out: CamposSalario = { pagamentoSalOrigem: m.bancoConf ? 'declarado' : 'inferido' }
  if (m.bancoConf && m.banco.mes) {
    out.pagamentoSalMesIndex = m.banco.mes.mes; out.pagamentoSalAno = m.banco.mes.ano
    out.mesPagamentoIndex = m.banco.mes.mes; out.anoPagamento = m.banco.mes.ano
  }
  if (m.trabConf && m.trabalho.mes) {
    out.mesTrabalhoIndex = m.trabalho.mes.mes; out.anoTrabalho = m.trabalho.mes.ano; out.mesTrabalhoOrigem = 'declarado'
  }
  if (m.docModo === 'desconhecido') out.salDocEstado = 'desconhecido'
  else if (m.docModo && m.documento.mes) {
    out.salDocMesIndex = m.documento.mes.mes; out.salDocAno = m.documento.mes.ano; out.salDocEstado = m.docModo
  }
  return out
}

/** Mês de trabalho dos frais: só se o motorista o confirmou. */
export function camposExplicitosFraisTrabalho(m: MesesFrais): { mesFraisTrabalhoIndex?: number; anoFraisTrabalho?: number; mesFraisTrabalhoOrigem?: 'declarado' } {
  if (!m.trabConf || !m.trabalho.mes) return {}
  return { mesFraisTrabalhoIndex: m.trabalho.mes.mes, anoFraisTrabalho: m.trabalho.mes.ano, mesFraisTrabalhoOrigem: 'declarado' }
}

// ───────────────────────────── Reimportação de uma fiche existente ─────────────────────────────
/** Junta a linha NOVA (do modal) à linha EXISTENTE do mesmo `periode`.
 *  Regras: (1) campos só da linha antiga (ligações de frais, previsões, origens…) nunca se perdem;
 *  (2) mês/pagamento confirmado antes só muda se o motorista declarou outro agora;
 *  (3) uma linha só-documental ligada a um pagamento nunca recebe dinheiro (sem 2.º pagamento);
 *  (4) mantém exactamente as regras antigas de salário, primes, frais e montante total. */
export function fundirFicheExistente(ex: MoisData, novo: MoisData): MoisData {
  const ligada = estaLigada(ex)
  // — salário: mês de pagamento
  const exSalFirme = ex.pagamentoSalOrigem === 'declarado' || ex.salarioConfirmado === true
  const manterPagSal = exSalFirme && novo.pagamentoSalOrigem !== 'declarado' && ex.pagamentoSalMesIndex != null
  // — frais: mês do trabalho e mês bancário
  const exFraisFirme = ex.fraisConfirmado === true
  const manterFraisTrab = (ex.mesFraisTrabalhoOrigem === 'declarado' || exFraisFirme)
    && novo.mesFraisTrabalhoOrigem !== 'declarado' && ex.mesFraisTrabalhoIndex != null
  const manterPagFrais = (ex.pagamentoFraisOrigem === 'declarado' || exFraisFirme) && ex.pagamentoFraisMesIndex != null
  return {
    ...ex,
    ...novo,
    // salário — só substituir se NÃO confirmado antes
    netPaye: ex.salarioConfirmado ? ex.netPaye : novo.netPaye,
    salairebrut: ex.salarioConfirmado ? ex.salairebrut : novo.salairebrut,
    salarioConfirmado: ex.salarioConfirmado || novo.salarioConfirmado,
    interessement: (ex.salarioConfirmado && (ex.interessement || 0) > 0) ? ex.interessement : novo.interessement,
    primeNonAccident: (ex.salarioConfirmado && (ex.primeNonAccident || 0) > 0) ? ex.primeNonAccident : novo.primeNonAccident,
    primeExceptionnelle: (ex.salarioConfirmado && (ex.primeExceptionnelle || 0) > 0) ? ex.primeExceptionnelle : novo.primeExceptionnelle,
    // frais — só substituir se NÃO confirmado antes; linha só-documental ligada nunca guarda dinheiro
    fraisRecuConfirme: ligada ? ex.fraisRecuConfirme : ex.fraisConfirmado ? (ex.fraisRecuConfirme ?? novo.fraisRecuConfirme) : novo.fraisRecuConfirme,
    fraisBoletim: ligada ? ex.fraisBoletim : ex.fraisConfirmado ? (ex.fraisBoletim || novo.fraisBoletim) : novo.fraisBoletim,
    fraisConfirmado: ligada ? ex.fraisConfirmado : ex.fraisConfirmado || novo.fraisConfirmado,
    montantTotalRecu: ex.montantTotalRecu > 0 ? ex.montantTotalRecu : novo.montantTotalRecu,
    fonte: (ex.salarioConfirmado || ex.fraisConfirmado) ? 'confirmado' : novo.fonte,
    confiancaAprendizagem: (ex.salarioConfirmado || ex.fraisConfirmado) ? 1 : novo.confiancaAprendizagem,
    // valor documental e mês do documento: preservar o que já existia se esta resposta não trouxe nada
    netPayeFiche: novo.netPayeFiche ?? ex.netPayeFiche,
    salDocMesIndex: novo.salDocEstado ? novo.salDocMesIndex : ex.salDocMesIndex,
    salDocAno: novo.salDocEstado ? novo.salDocAno : ex.salDocAno,
    salDocEstado: novo.salDocEstado ?? ex.salDocEstado,
    // meses: o confirmado antes só muda se o motorista declarou outro agora
    ...(manterPagSal ? {
      pagamentoSalMesIndex: ex.pagamentoSalMesIndex, pagamentoSalAno: ex.pagamentoSalAno,
      mesPagamentoIndex: ex.mesPagamentoIndex, anoPagamento: ex.anoPagamento, pagamentoSalOrigem: ex.pagamentoSalOrigem,
    } : {}),
    mesTrabalhoIndex: novo.mesTrabalhoIndex ?? ex.mesTrabalhoIndex,
    anoTrabalho: novo.anoTrabalho ?? ex.anoTrabalho,
    mesTrabalhoOrigem: novo.mesTrabalhoOrigem ?? ex.mesTrabalhoOrigem,
    ...(manterFraisTrab ? {
      mesFraisTrabalhoIndex: ex.mesFraisTrabalhoIndex, anoFraisTrabalho: ex.anoFraisTrabalho, mesFraisTrabalhoOrigem: ex.mesFraisTrabalhoOrigem,
    } : {}),
    ...(manterPagFrais || ligada ? {
      pagamentoFraisMesIndex: ex.pagamentoFraisMesIndex, pagamentoFraisAno: ex.pagamentoFraisAno, pagamentoFraisOrigem: ex.pagamentoFraisOrigem,
    } : {}),
    moisAtipico: novo.moisAtipico !== undefined ? novo.moisAtipico : ex.moisAtipico,
  }
}
