// src/utils/mesesRecebimentoFrais.test.ts — trabalho (Set) · pagamento bancário (Out) · documento (Nov)
import * as fs from 'fs'
import * as path from 'path'
import { resolverMesesModal, limitarOffsetBanco, limitarOffsetDoc, deslocarMes, rotuloMes, documentoPrevistoPendente } from './mesesRecebimentoFrais'
import { aplicarConfirmacaoRecebimentoFrais, aplicarConfirmacoesFrais, listarPagamentosCandidatos, valorFraisDoMes, type ConfirmacaoFrais } from './confirmacaoFrais'
import { fraisRealConfirme } from './projecoes'
import type { MoisData } from '../types/moisdata'

const linha = (o: Partial<MoisData> & { periode: string }): MoisData => ({
  moisIndex: 9, annee: 2026, fichePages: 0, netPaye: 0, salairebrut: 0, totalCotisations: 0,
  remboursementFrais: 0, fraisBoletim: 0, montantTotalRecu: 0, jourPaiement1: 5, jourPaiement2: 10,
  analysedAt: '', entreprise: '', conducteur: '', ...o,
})
// Fiche de Outubro: o motorista escreveu 615 € «Frais reçus» (frais de Setembro recebidos em Outubro)
const ficheOut = (extra: Partial<MoisData> = {}) => linha({
  periode: 'Octobre 2026', fichePages: 1, netPaye: 2100, remboursementFrais: 0, fraisConfirmado: true, fraisRecuConfirme: 615,
  mesFraisTrabalhoIndex: 8, anoFraisTrabalho: 2026, ...extra,
})
// Fiche de Novembro importada depois: documenta os MESMOS 615 €
const ficheNov = (extra: Partial<MoisData> = {}) => linha({
  periode: 'Novembre 2026', moisIndex: 10, fichePages: 1, netPaye: 2000, remboursementFrais: 615,
  fraisConfirmado: true, fraisRecuConfirme: 615, mesFraisTrabalhoIndex: 9, anoFraisTrabalho: 2026, ...extra,
})
const recebidoOut = (extra: Record<string, unknown> = {}): ConfirmacaoFrais => ({
  confirmadoPeloMotorista: true, fichePeriode: 'Octobre 2026', estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, valor: 615, ...extra,
} as ConfirmacaoFrais)
const novoId = () => 'pg-1'
const somaDinheiro = (h: readonly MoisData[]) => h.reduce((s, d) => s + fraisRealConfirme(d), 0)

describe('seletores: meses do modal', () => {
  const fiche = { ano: 2026, mes: 9 }   // Outubro
  it('Set trabalho · Out pagamento · Nov documento (previsto, fiche ainda não existe)', () => {
    const m = resolverMesesModal({ fiche, trabalho: { ano: 2026, mes: 8 }, bancoOffset: 0, docOffset: 1, periodosExistentes: ['Septembre 2026', 'Octobre 2026'] })
    expect(rotuloMes(m.trabalho!)).toBe('Septembre 2026')
    expect(rotuloMes(m.banco)).toBe('Octobre 2026')
    expect(rotuloMes(m.documento)).toBe('Novembre 2026')
    expect(m.documentoEstado).toBe('prevista')
    expect(m.docPrevisto).toEqual({ ano: 2026, mes: 10 })
    expect(m.docPrevistoParaGravar).toEqual({ ano: 2026, mes: 10 })
  })
  it('sem fiche futura e documento = esta fiche: nada previsto (limpa qualquer previsão antiga)', () => {
    const m = resolverMesesModal({ fiche, bancoOffset: 0, docOffset: 0, periodosExistentes: [] })
    expect(m.documentoEstado).toBe('esta_fiche')
    expect(m.docPrevisto).toBeNull()
    expect(m.docPrevistoParaGravar).toBeNull()
  })
  it('fiche de Novembro já importada: é «já importada», não se grava previsão', () => {
    const m = resolverMesesModal({ fiche, bancoOffset: 0, docOffset: 1, periodosExistentes: ['Novembre 2026'] })
    expect(m.documentoEstado).toBe('ja_importada')
    expect(m.docPrevistoParaGravar).toBeUndefined()
  })
  it('o banco não está limitado a 3 meses: até 12 antes e 2 depois da fiche, com viragem de ano', () => {
    expect(rotuloMes(resolverMesesModal({ fiche: { ano: 2026, mes: 1 }, bancoOffset: 12, docOffset: 0, periodosExistentes: [] }).banco)).toBe('Février 2025')
    expect(rotuloMes(resolverMesesModal({ fiche: { ano: 2026, mes: 11 }, bancoOffset: -1, docOffset: 0, periodosExistentes: [] }).banco)).toBe('Janvier 2027')
    expect(limitarOffsetBanco(99)).toBe(12)
    expect(limitarOffsetBanco(-99)).toBe(-2)
    expect(limitarOffsetDoc(-5)).toBe(0)
    expect(limitarOffsetDoc(9)).toBe(3)
    expect(limitarOffsetBanco(NaN)).toBe(0)
  })
  it('a lista antiga de 3 meses (0..2) continua representável', () => {
    for (const off of [0, 1, 2]) expect(rotuloMes(resolverMesesModal({ fiche, bancoOffset: off, docOffset: 0, periodosExistentes: [] }).banco)).toBe(rotuloMes(deslocarMes(fiche, -off)))
  })
})

describe('gravação: pagamento em Outubro, documento em Novembro', () => {
  it('Out guarda o pagamento (banco declarado) e a previsão de Nov; valor e trabalho intactos', () => {
    const h = [ficheOut()]
    const r = aplicarConfirmacaoRecebimentoFrais(h, recebidoOut({ docPrevisto: { ano: 2026, mes: 10 } }), { novoId })
    expect(r.aplicado).toBe(true)
    if (!r.aplicado) return
    const o = r.historico[0]
    expect(o.pagamentoFraisMesIndex).toBe(9)
    expect(o.pagamentoFraisAno).toBe(2026)
    expect(o.pagamentoFraisOrigem).toBe('declarado')
    expect(o.fraisDocPrevistoMes).toBe(10)
    expect(o.fraisDocPrevistoAno).toBe(2026)
    expect(o.fraisRecuConfirme).toBe(615)
    expect(o.mesFraisTrabalhoIndex).toBe(8)
    expect(o.remboursementFrais).toBe(0)
  })
  it('sem fiche futura: a previsão é só informação — Novembro NÃO passa a existir nem conta dinheiro', () => {
    const r = aplicarConfirmacaoRecebimentoFrais([ficheOut()], recebidoOut({ docPrevisto: { ano: 2026, mes: 10 } }), { novoId })
    if (!r.aplicado) throw new Error('recusado')
    expect(r.historico.length).toBe(1)
    expect(r.historico.some(h => h.periode === 'Novembre 2026')).toBe(false)
    expect(somaDinheiro(r.historico)).toBe(615)
    expect(valorFraisDoMes(r.historico, 2026, 8)).toBe(615)
    expect(documentoPrevistoPendente(r.historico[0], r.historico.map(x => x.periode))).toEqual({ ano: 2026, mes: 10 })
  })
  it('alteração manual da data documental: Nov → Dez → «esta fiche» (limpa) — sem mexer no dinheiro', () => {
    let h: readonly MoisData[] = [ficheOut()]
    const passo = (docPrevisto: any) => {
      const r = aplicarConfirmacaoRecebimentoFrais(h, recebidoOut({ docPrevisto }), { novoId })
      if (!r.aplicado) throw new Error('recusado')
      h = r.historico
    }
    passo({ ano: 2026, mes: 10 }); expect(h[0].fraisDocPrevistoMes).toBe(10)
    passo({ ano: 2026, mes: 11 }); expect(h[0].fraisDocPrevistoMes).toBe(11)
    passo(null); expect(h[0].fraisDocPrevistoMes).toBeUndefined(); expect(h[0].fraisDocPrevistoAno).toBeUndefined()
    expect(h[0].fraisRecuConfirme).toBe(615)
    expect(h[0].pagamentoFraisMesIndex).toBe(9)
  })
  it('previsão para um mês cuja fiche já existe não é gravada; previsão = a própria fiche também não', () => {
    const h = [ficheOut(), ficheNov({ fraisConfirmado: false, fraisRecuConfirme: undefined })]
    const r1 = aplicarConfirmacaoRecebimentoFrais(h, recebidoOut({ docPrevisto: { ano: 2026, mes: 10 } }), { novoId })
    if (!r1.aplicado) throw new Error('x')
    expect(r1.historico[0].fraisDocPrevistoMes).toBeUndefined()
    const r2 = aplicarConfirmacaoRecebimentoFrais([ficheOut()], recebidoOut({ docPrevisto: { ano: 2026, mes: 9 } }), { novoId })
    if (!r2.aplicado) throw new Error('x')
    expect(r2.historico[0].fraisDocPrevistoMes).toBeUndefined()
  })
  it('sem docPrevisto na confirmação (fluxo antigo): comportamento de sempre, previsão existente intacta', () => {
    const r = aplicarConfirmacaoRecebimentoFrais([ficheOut({ fraisDocPrevistoMes: 10, fraisDocPrevistoAno: 2026 })], recebidoOut(), { novoId })
    if (!r.aplicado) throw new Error('x')
    expect(r.historico[0].fraisDocPrevistoMes).toBe(10)
  })
  it('previsão com mês inválido é ignorada', () => {
    const r = aplicarConfirmacaoRecebimentoFrais([ficheOut()], recebidoOut({ docPrevisto: { ano: 2026, mes: 14 } }), { novoId })
    if (!r.aplicado) throw new Error('x')
    expect(r.historico[0].fraisDocPrevistoMes).toBeUndefined()
  })
})

describe('pagamento já recebido que aparece numa fiche posterior (sem duplicar)', () => {
  const comPagamentoEPrevisao = () => {
    const r = aplicarConfirmacaoRecebimentoFrais([ficheOut()], recebidoOut({ docPrevisto: { ano: 2026, mes: 10 } }), { novoId })
    if (!r.aplicado) throw new Error('x')
    return r.historico
  }
  it('importada a fiche de Nov com 615: o motorista liga ao pagamento de Out — o dinheiro conta UMA vez', () => {
    const h = [...comPagamentoEPrevisao(), ficheNov()]
    expect(somaDinheiro(h)).toBe(1230)   // antes de ligar, a importação automática duplica (é o que a ligação resolve)
    const nov: ConfirmacaoFrais = { confirmadoPeloMotorista: true, fichePeriode: 'Novembre 2026', estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, valor: 615, pagamentoPeriode: 'Octobre 2026' }
    const r = aplicarConfirmacaoRecebimentoFrais(h, nov, { novoId })
    expect(r.aplicado).toBe(true)
    if (!r.aplicado) return
    expect(somaDinheiro(r.historico)).toBe(615)
    const out = r.historico.find(x => x.periode === 'Octobre 2026')!
    const nv = r.historico.find(x => x.periode === 'Novembre 2026')!
    expect(nv.remboursementFrais).toBe(615)                 // valor DOCUMENTAL preservado
    expect(out.fraisRecuConfirme).toBe(615)                 // valor BANCÁRIO confirmado preservado
    expect(nv.fraisContabilizadoId).toBe(out.fraisPagamentoId)
    expect(out.fraisDocPrevistoMes).toBeUndefined()         // a previsão passou a documento real
    expect(valorFraisDoMes(r.historico, 2026, 8)).toBe(615) // Set: 615 uma vez (Home/Stats/Salaire)
    expect(valorFraisDoMes(r.historico, 2026, 9)).toBe(0)   // Nov (documento ligado) não gera um segundo valor para Out
  })
  it('o candidato aparece na fiche de Nov e deixa de aparecer depois de ligado', () => {
    const h = [...comPagamentoEPrevisao(), ficheNov()]
    expect(listarPagamentosCandidatos(h, 'Novembre 2026', 615).map(c => c.periode)).toEqual(['Octobre 2026'])
    const nov: ConfirmacaoFrais = { confirmadoPeloMotorista: true, fichePeriode: 'Novembre 2026', estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, valor: 615, pagamentoPeriode: 'Octobre 2026' }
    const r = aplicarConfirmacaoRecebimentoFrais(h, nov, { novoId })
    if (!r.aplicado) throw new Error('x')
    expect(listarPagamentosCandidatos(r.historico, 'Decembre 2026', 615)).toEqual([])
  })
  it('ligar duas vezes (ou a outra fiche) é recusado: sem pagamento duplicado', () => {
    const h = [...comPagamentoEPrevisao(), ficheNov(), ficheNov({ periode: 'Decembre 2026', moisIndex: 11 })]
    const nov: ConfirmacaoFrais = { confirmadoPeloMotorista: true, fichePeriode: 'Novembre 2026', estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, valor: 615, pagamentoPeriode: 'Octobre 2026' }
    const r1 = aplicarConfirmacaoRecebimentoFrais(h, nov, { novoId })
    if (!r1.aplicado) throw new Error('x')
    const dez = { ...nov, fichePeriode: 'Decembre 2026' }
    const r2 = aplicarConfirmacaoRecebimentoFrais(r1.historico, dez, { novoId })
    expect(r2.aplicado).toBe(false)
  })
})

describe('pagamento confirmado é preservado', () => {
  it('valor diferente é recusado e o histórico fica exactamente igual', () => {
    const h = Object.freeze([ficheOut()]) as readonly MoisData[]
    const r = aplicarConfirmacaoRecebimentoFrais(h, recebidoOut({ valor: 500, docPrevisto: { ano: 2026, mes: 10 } }), { novoId })
    expect(r.aplicado).toBe(false)
    expect(r.historico).toBe(h)
  })
  it('«por receber» não apaga um pagamento já confirmado', () => {
    const r = aplicarConfirmacaoRecebimentoFrais([ficheOut()], { confirmadoPeloMotorista: true, fichePeriode: 'Octobre 2026', estado: 'por_receber' }, { novoId })
    expect(r.aplicado).toBe(false)
  })
  it('recusa em lote não grava nada (nem a previsão)', () => {
    const h = [ficheOut()]
    const r = aplicarConfirmacoesFrais(h, [{ fichePeriode: 'Octobre 2026', confirmacao: { estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, valor: 1, docPrevisto: { ano: 2026, mes: 10 } } }], { novoId })
    expect(r.recusas.length).toBe(1)
    expect(r.historico).toBe(h)
  })
})

describe('modal: abrir/fechar sem perder dados (código-fonte)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/fiche.tsx'), 'utf8')
  const modal = src.slice(src.indexOf('<Modal visible={showPerguntas'), src.indexOf('<Modal visible={showPerguntas') + 60000)
  it('o deslocamento do documento guarda-se no snapshot e restaura-se ao recuar', () => {
    expect(src.includes('docOffset: fraisDocOffset')).toBe(true)
    expect(src.includes('setFraisDocOffset(snap.frais?.docOffset ?? 0)')).toBe(true)
    expect(src.includes('setFraisDocOffset(0); setFraisPagamentoEscolhido(null) }')).toBe(true)
  })
  it('o modal não rouba o foco ao abrir (sem autoFocus) e usa KeyboardAvoidingView em «padding»', () => {
    const corpo = modal.slice(0, modal.indexOf('</Modal>'))
    expect(corpo.includes('autoFocus')).toBe(false)
    expect(corpo.includes('behavior="padding"')).toBe(true)
    expect(corpo.includes('keyboardShouldPersistTaps="handled"')).toBe(true)
  })
  it('a lista de meses já não está limitada a [0, 1, 2]', () => {
    expect(src.includes('{[0, 1, 2].map(off => {')).toBe(false)
  })
  it('os três blocos aparecem separados: travail · paiement · document', () => {
    expect(src.includes("{n} · {titulo}")).toBe(true)
    expect(src.includes("bloco('1', 'MOIS TRAVAILLÉ'")).toBe(true)
    expect(src.includes("bloco('2', 'MOIS DE PAIEMENT (banque)'")).toBe(true)
    expect(src.includes("bloco('3', 'MOIS DU DOCUMENT (fiche de paie)'")).toBe(true)
  })
})
