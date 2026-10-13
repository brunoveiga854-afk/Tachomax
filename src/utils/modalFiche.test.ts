// src/utils/modalFiche.test.ts — cenários do modal «Fiche de paie» + ajuste final (hipótese vs confirmado, reimportação)
import {
  resolverMesesSalario, resolverMesesFrais, avaliarLag, deveGravarLag, compararValores, origemValor,
  verificar, camposExplicitosSalario, camposExplicitosFraisTrabalho, fundirFicheExistente,
  type EntradaSalario, type EntradaFrais,
} from './modalFiche'
import { rotuloMes } from './mesesRecebimentoFrais'
import { aplicarConfirmacoesFrais, type ConfirmacaoFrais } from './confirmacaoFrais'
import type { MoisData } from '../types/moisdata'

const linha = (o: Partial<MoisData> & { periode: string }): MoisData => ({
  moisIndex: 9, annee: 2026, fichePages: 0, netPaye: 0, salairebrut: 0, totalCotisations: 0,
  remboursementFrais: 0, fraisBoletim: 0, montantTotalRecu: 0, jourPaiement1: 5, jourPaiement2: 10,
  analysedAt: '', entreprise: '', conducteur: '', ...o,
})
const OUT = { ano: 2026, mes: 9 }   // Octobre 2026
const sal = (o: Partial<EntradaSalario> = {}): EntradaSalario => ({
  fiche: OUT, lag: 2, lagConfirmado: true, bancoOffset: 0, bancoConfirmado: false, trabalhoLag: null, trabalhoConfirmado: false,
  docOffset: 0, docConfirmado: false, ...o,
})
const fr = (o: Partial<EntradaFrais> = {}): EntradaFrais => ({
  fiche: OUT, periodosExistentes: [], resposta: 'recebido', bancoOffset: 0, bancoConfirmado: true, docOffset: 0, docConfirmado: false,
  docDesconhecido: false, flag: 1, flagConfirmado: true, trabalhoLag: null, trabalhoConfirmado: false, ...o,
})
const verif = (s: EntradaSalario, f: EntradaFrais, extra: Record<string, unknown> = {}) => verificar({
  salario: resolverMesesSalario(s), frais: resolverMesesFrais(f),
  salExtraido: 2100, salRecebido: 2100, salTocado: false, fraisExtraido: 0, fraisRecebido: 615, fraisResposta: f.resposta,
  interessement: 0, primeNonAcc: 0, moisAtipico: false, ...extra,
} as any)

describe('1. salário recebido 2 meses depois do trabalho', () => {
  it('banco Out → trabalho Ago; os três meses são independentes e continuam hipótese', () => {
    const m = resolverMesesSalario(sal())
    expect(rotuloMes(m.banco.mes!)).toBe('Octobre 2026')
    expect(rotuloMes(m.trabalho.mes!)).toBe('Août 2026')
    expect(rotuloMes(m.documento.mes!)).toBe('Octobre 2026')
    expect(m.trabalho.estado).toBe('inféré')      // deduzido do décalage confirmado, ainda não confirmado PARA ESTA fiche
    expect(m.banco.estado).toBe('inféré')
    expect(m.documento.estado).toBe('inféré')
  })
  it('banco ≠ documento: o mês do documento não é presumido igual ao bancário', () => {
    const m = resolverMesesSalario(sal({ bancoOffset: 1, bancoConfirmado: true, docOffset: 0 }))
    expect(rotuloMes(m.banco.mes!)).toBe('Septembre 2026')
    expect(rotuloMes(m.documento.mes!)).toBe('Octobre 2026')
    expect(rotuloMes(m.trabalho.mes!)).toBe('Juillet 2026')
    expect(m.banco.estado).toBe('confirmé')
    expect(m.trabalho.estado).toBe('inféré')      // confirmar o banco não confirma o trabalho
    expect(m.documento.estado).toBe('inféré')
  })
})

describe('2/3. frais 1 mês depois do trabalho e documentados 1 mês depois de recebidos (Set/Out/Nov)', () => {
  const m = resolverMesesFrais(fr({ docOffset: 1 }))
  it('trabalho Set · banco Out · documento Nov (prevista)', () => {
    expect(rotuloMes(m.trabalho.mes!)).toBe('Septembre 2026')
    expect(rotuloMes(m.banco.mes!)).toBe('Octobre 2026')
    expect(rotuloMes(m.documento.mes!)).toBe('Novembre 2026')
    expect(m.documento.estado).toBe('prévu')
    expect(m.documentoEstado).toBe('prevista')
    expect(m.docPrevistoParaGravar).toEqual({ ano: 2026, mes: 10 })
    expect(m.trabalho.estado).toBe('inféré')
  })
  it('se a fiche de Novembro já existe, é «confirmé» e não é previsão', () => {
    const j = resolverMesesFrais(fr({ docOffset: 1, periodosExistentes: ['Novembre 2026'] }))
    expect(j.documento.estado).toBe('confirmé')
    expect(j.docPrevistoParaGravar).toBeUndefined()
  })
})

describe('4. diferenças documental vs banco', () => {
  it('mostra diferença e conserva ambos', () => {
    expect(compararValores(2100, 2087.5)).toEqual({ estado: 'diferente', diferenca: -12.5 })
    expect(compararValores(2100, 2100)).toEqual({ estado: 'igual', diferenca: 0 })
    expect(compararValores(0, 615).estado).toBe('so_banco')
    expect(compararValores(615, 0).estado).toBe('so_documento')
  })
  it('origem do valor: extrait / confirmé / vide', () => {
    expect(origemValor(2100, 2100, false)).toBe('extrait')
    expect(origemValor(2100, 2087.5, true)).toBe('confirmé')
    expect(origemValor(2100, 0, false)).toBe('vide')
  })
  it('a Vérification avisa a divergência mas não bloqueia', () => {
    const v = verif(sal(), fr(), { salRecebido: 2087.5, fraisExtraido: 600, fraisRecebido: 615, salTocado: true })
    expect(v.podeGuardar).toBe(true)
    expect(v.avisos.filter(a => a.startsWith('Salaire : la fiche indique')).length).toBe(1)
    expect(v.avisos.filter(a => a.startsWith('Frais : la fiche indique')).length).toBe(1)
    expect(v.valores.salEstado.diferenca).toBe(-12.5)
  })
})

describe('5. documento futuro ainda não confirmado', () => {
  it('«Pas encore connu» não bloqueia e não grava previsão', () => {
    const f = resolverMesesFrais(fr({ docDesconhecido: true }))
    expect(f.documento.estado).toBe('inconnu')
    expect(f.docPrevistoParaGravar).toBeUndefined()
    const s = resolverMesesSalario(sal({ docOffset: null }))
    expect(s.documento.estado).toBe('inconnu')
    const v = verif(sal({ docOffset: null }), fr({ docDesconhecido: true }))
    expect(v.podeGuardar).toBe(true)
    expect(v.avisos.some(a => a.includes('pas encore connu'))).toBe(true)
  })
  it('Enregistrer fica bloqueado só quando falta mesmo o valor real', () => {
    const v = verif(sal(), fr({ resposta: null }), { salRecebido: 0, fraisRecebido: 0 })
    expect(v.podeGuardar).toBe(false)
    const v2 = verif(sal(), fr({ resposta: 'recebido' }), { salRecebido: 2100, fraisRecebido: 0 })
    expect(v2.podeGuardar).toBe(false)
  })
})

describe('6. importação posterior da fiche documental sem duplicar', () => {
  it('Out guarda 615 € e a fiche de Nov só documenta (ligação, sem 2.º pagamento)', () => {
    const ficheOut = linha({ periode: 'Octobre 2026', fichePages: 1, netPaye: 2100, fraisConfirmado: true, fraisRecuConfirme: 615 })
    const r1 = aplicarConfirmacoesFrais([ficheOut], [{ fichePeriode: 'Octobre 2026', confirmacao: { estado: 'recebido', mesBanco: OUT, valor: 615, docPrevisto: { ano: 2026, mes: 10 } } as any }], { novoId: () => 'id1' })
    expect(JSON.stringify(r1.recusas)).toBe('[]')
    const h1 = r1.historico as MoisData[]
    expect(h1.find(h => h.periode === 'Octobre 2026')!.fraisRecuConfirme).toBe(615)
    expect(h1.find(h => h.periode === 'Octobre 2026')!.fraisDocPrevistoMes).toBe(10)
    const ficheNov = linha({ periode: 'Novembre 2026', moisIndex: 10, fichePages: 1, netPaye: 2000, remboursementFrais: 615 })
    const r2 = aplicarConfirmacoesFrais([...h1, ficheNov], [{ fichePeriode: 'Novembre 2026', confirmacao: { estado: 'recebido', mesBanco: OUT, valor: 615, pagamentoPeriode: 'Octobre 2026' } as any }], { novoId: () => 'id2' })
    expect(JSON.stringify(r2.recusas)).toBe('[]')
    const h2 = r2.historico as MoisData[]
    const somaPagos = h2.filter(h => (h.fraisConfirmado && (h.fraisRecuConfirme || 0) > 0 && !(h.fraisContabilizadoId || h.fraisContabilizadoEm))).reduce((a, h) => a + (h.fraisRecuConfirme || 0), 0)
    expect(somaPagos).toBe(615)
  })
})

describe('7. compatibilidade com dados antigos', () => {
  it('sem toque do motorista nenhum mês é gravado como confirmado (só a origem «inferido»)', () => {
    const s = resolverMesesSalario(sal())
    expect(camposExplicitosSalario(s)).toEqual({ pagamentoSalOrigem: 'inferido' })
    expect(camposExplicitosFraisTrabalho(resolverMesesFrais(fr()))).toEqual({})
  })
  it('só o documento corrigido grava salDoc*, sem fixar mês de trabalho nem de pagamento', () => {
    const s = resolverMesesSalario(sal({ docOffset: 1, lagConfirmado: false }))
    const c = camposExplicitosSalario(s)
    expect(c.salDocMesIndex).toBe(10)
    expect(c.salDocEstado).toBe('corrigido')
    expect(c.mesTrabalhoIndex).toBeUndefined()
    expect(c.pagamentoSalMesIndex).toBeUndefined()
    expect(c.pagamentoSalOrigem).toBe('inferido')
  })
  it('lag inválido/ausente cai no predefinido sem rebentar', () => {
    const s = resolverMesesSalario(sal({ lag: 7 as any, lagConfirmado: false }))
    expect(s.lagUsado).toBe(2)
    expect(s.trabalho.estado).toBe('inféré')
  })
})

describe('8. cancelar sem alterações persistidas', () => {
  it('as funções são puras: nada é gravado sem a UI chamar guardar', () => {
    const antes = JSON.stringify(sal())
    resolverMesesSalario(sal({ bancoOffset: 1, bancoConfirmado: true }))
    resolverMesesFrais(fr({ docOffset: 3 }))
    verif(sal(), fr())
    expect(JSON.stringify(sal())).toBe(antes)
  })
})

describe('9. proteção dos desfasamentos confirmados', () => {
  it('lag escolhido diferente do confirmado → conflito: exige consentimento e não grava sem ele', () => {
    const a = avaliarLag({ escolhido: 3, guardado: 2, confirmado: true })
    expect(a.tipo).toBe('conflito')
    expect(a.precisaConsentimento).toBe(true)
    expect(deveGravarLag(a, false)).toBe(false)
    expect(deveGravarLag(a, true)).toBe(true)
  })
  it('igual ao confirmado → nada a gravar', () => {
    const a = avaliarLag({ escolhido: 2, guardado: 2, confirmado: true })
    expect(a.tipo).toBe('igual_confirmado')
    expect(deveGravarLag(a, true)).toBe(false)
  })
  it('não confirmado: só grava com consentimento explícito', () => {
    const a = avaliarLag({ escolhido: 2, guardado: 2, confirmado: false })
    expect(deveGravarLag(a, false)).toBe(false)
    expect(deveGravarLag(a, true)).toBe(true)
    expect(avaliarLag({ escolhido: 1, guardado: 2, confirmado: false }).tipo).toBe('novo')
  })
  it('escolher um mês de trabalho diferente só fixa ESTE mês (explícito), nunca altera o padrão', () => {
    const s = resolverMesesSalario(sal({ trabalhoLag: 3 }))
    expect(s.trabConf).toBe(true)
    const c = camposExplicitosSalario(s)
    expect(c.mesTrabalhoIndex).toBe(6)     // Jul
    expect(c.mesTrabalhoOrigem).toBe('declarado')
    expect(Object.keys(c).some(k => /hlag|flag/i.test(k))).toBe(false)
  })
})

// ───────────────────────── Ajuste final ─────────────────────────
describe('A. guardar SEM tocar nos seletores', () => {
  const s = resolverMesesSalario(sal())
  const f = resolverMesesFrais(fr({ resposta: 'por_receber', bancoConfirmado: false }))
  it('nenhum mês é confirmado: Enregistrer não confirma nada', () => {
    expect(s.bancoConf).toBe(false)
    expect(s.trabConf).toBe(false)
    expect(s.docConf).toBe(false)
    const c = camposExplicitosSalario(s)
    expect(c.pagamentoSalOrigem).toBe('inferido')
    expect(c.mesTrabalhoIndex).toBeUndefined()
    expect(c.mesTrabalhoOrigem).toBeUndefined()
    expect(c.salDocEstado).toBeUndefined()
    expect(camposExplicitosFraisTrabalho(f)).toEqual({})
  })
  it('a Vérification lista os meses não confirmados mas deixa registar', () => {
    const v = verif(sal(), fr({ resposta: 'por_receber', bancoConfirmado: false }), { fraisRecebido: 0 })
    expect(v.podeGuardar).toBe(true)
    expect(v.naoConfirmados.length >= 4).toBe(true)
    expect(v.naoConfirmados.some(x => x.startsWith('Salaire — mois de paiement'))).toBe(true)
    expect(v.naoConfirmados.some(x => x.startsWith('Salaire — mois du document'))).toBe(true)
    expect(v.naoConfirmados.some(x => x.startsWith('Frais — mois travaillé'))).toBe(true)
  })
  it('sem consentimento nenhum décalage é gravado', () => {
    expect(deveGravarLag(avaliarLag({ escolhido: 2, guardado: 2, confirmado: true }), false)).toBe(false)
    expect(deveGravarLag(avaliarLag({ escolhido: 3, guardado: 2, confirmado: true }), false)).toBe(false)
  })
  it('frais «recebido» sem confirmar o mês bancário não é gravado como declarado (bloqueia só esse caso)', () => {
    const v = verif(sal(), fr({ resposta: 'recebido', bancoConfirmado: false }))
    expect(v.podeGuardar).toBe(false)
    expect(v.erros.some(e => e.includes('Confirmer ce mois'))).toBe(true)
  })
  it('frais «esta fiche» sem confirmar não limpa uma previsão existente', () => {
    expect(resolverMesesFrais(fr({ docOffset: 0, docConfirmado: false })).docPrevistoParaGravar).toBeUndefined()
    expect(resolverMesesFrais(fr({ docOffset: 0, docConfirmado: true })).docPrevistoParaGravar).toBeNull()
  })
})

describe('B. confirmar EXPLICITAMENTE um mês sem alterar os outros', () => {
  it('confirmar só o mês bancário', () => {
    const c = camposExplicitosSalario(resolverMesesSalario(sal({ bancoConfirmado: true })))
    expect(c.pagamentoSalMesIndex).toBe(9)
    expect(c.pagamentoSalOrigem).toBe('declarado')
    expect(c.mesTrabalhoIndex).toBeUndefined()
    expect(c.salDocEstado).toBeUndefined()
  })
  it('confirmar só o mês de trabalho', () => {
    const c = camposExplicitosSalario(resolverMesesSalario(sal({ trabalhoConfirmado: true })))
    expect(c.mesTrabalhoIndex).toBe(7)
    expect(c.mesTrabalhoOrigem).toBe('declarado')
    expect(c.pagamentoSalMesIndex).toBeUndefined()
    expect(c.pagamentoSalOrigem).toBe('inferido')
  })
  it('confirmar só o mês do documento lido na fiche', () => {
    const c = camposExplicitosSalario(resolverMesesSalario(sal({ docConfirmado: true })))
    expect(c.salDocEstado).toBe('confirmado')
    expect(c.salDocMesIndex).toBe(9)
    expect(c.mesTrabalhoIndex).toBeUndefined()
    expect(c.pagamentoSalMesIndex).toBeUndefined()
  })
  it('mover o mês bancário confirmado não confirma nem grava o de trabalho', () => {
    const m = resolverMesesSalario(sal({ bancoOffset: 1, bancoConfirmado: true }))
    expect(m.trabalho.estado).toBe('inféré')
    expect(camposExplicitosSalario(m).mesTrabalhoIndex).toBeUndefined()
  })
  it('frais: confirmar o mês de trabalho grava só esse', () => {
    const c = camposExplicitosFraisTrabalho(resolverMesesFrais(fr({ trabalhoConfirmado: true })))
    expect(c.mesFraisTrabalhoIndex).toBe(8)
    expect(c.mesFraisTrabalhoOrigem).toBe('declarado')
  })
})

describe('C. reimportar uma fiche existente', () => {
  // linha existente: salário confirmado em Setembro (declarado), trabalho Julho declarado
  const exSal = linha({
    periode: 'Octobre 2026', fichePages: 1, netPaye: 2100, salarioConfirmado: true,
    pagamentoSalMesIndex: 8, pagamentoSalAno: 2026, mesPagamentoIndex: 8, anoPagamento: 2026, pagamentoSalOrigem: 'declarado',
    mesTrabalhoIndex: 6, anoTrabalho: 2026, mesTrabalhoOrigem: 'declarado', netPayeFiche: 2100,
    fraisDocPrevistoMes: 10, fraisDocPrevistoAno: 2026,
  })
  const novoInferido = linha({
    periode: 'Octobre 2026', fichePages: 1, netPaye: 2100, salarioConfirmado: true,
    pagamentoSalMesIndex: 9, pagamentoSalAno: 2026, mesPagamentoIndex: 9, anoPagamento: 2026, pagamentoSalOrigem: 'inferido',
  })
  it('mês de pagamento/trabalho confirmados antes são preservados quando a nova resposta é só hipótese', () => {
    const m = fundirFicheExistente(exSal, novoInferido)
    expect(m.pagamentoSalMesIndex).toBe(8)
    expect(m.mesPagamentoIndex).toBe(8)
    expect(m.pagamentoSalOrigem).toBe('declarado')
    expect(m.mesTrabalhoIndex).toBe(6)
    expect(m.mesTrabalhoOrigem).toBe('declarado')
    expect(m.fraisDocPrevistoMes).toBe(10)     // campo só da linha antiga não se perde
    expect(m.netPayeFiche).toBe(2100)
  })
  it('só um mês declarado de novo (explícito) substitui o antigo', () => {
    const m = fundirFicheExistente(exSal, { ...novoInferido, pagamentoSalMesIndex: 10, mesPagamentoIndex: 10, pagamentoSalOrigem: 'declarado' })
    expect(m.pagamentoSalMesIndex).toBe(10)
    expect(m.mesTrabalhoIndex).toBe(6)         // o mês de trabalho não muda sozinho
  })
  it('pagamento de frais já confirmado: valor, id e mês bancário mantêm-se; linha documental ligada nunca recebe dinheiro', () => {
    const pagamento = linha({
      periode: 'Octobre 2026', fichePages: 1, fraisConfirmado: true, fraisRecuConfirme: 615, fraisPagamentoId: 'id1',
      pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado', fraisRecebimento: 'recebido',
    })
    const novoP = linha({ periode: 'Octobre 2026', fichePages: 1, fraisConfirmado: true, fraisRecuConfirme: 615, pagamentoFraisMesIndex: 8, pagamentoFraisAno: 2026 })
    const mp = fundirFicheExistente(pagamento, novoP)
    expect(mp.fraisRecuConfirme).toBe(615)
    expect(mp.fraisPagamentoId).toBe('id1')
    expect(mp.pagamentoFraisMesIndex).toBe(9)
    expect(mp.pagamentoFraisOrigem).toBe('declarado')
    // fiche de Novembro só documenta (ligada ao id1); reimportar com 615 € não pode criar 2.º pagamento
    const doc = linha({
      periode: 'Novembre 2026', moisIndex: 10, fichePages: 1, remboursementFrais: 615, fraisContabilizadoId: 'id1', fraisContabilizadoEm: 'Octobre 2026',
      fraisRecebimento: 'recebido', pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado',
    })
    const novoDoc = linha({ periode: 'Novembre 2026', moisIndex: 10, fichePages: 1, remboursementFrais: 615, fraisConfirmado: true, fraisRecuConfirme: 615, pagamentoFraisMesIndex: 10, pagamentoFraisAno: 2026 })
    const md = fundirFicheExistente(doc, novoDoc)
    expect(md.fraisRecuConfirme).toBeUndefined()
    expect(md.fraisConfirmado).toBeUndefined()
    expect(md.fraisContabilizadoId).toBe('id1')
    expect(md.pagamentoFraisMesIndex).toBe(9)
    const pagos = [mp, md].filter(h => h.fraisConfirmado && (h.fraisRecuConfirme || 0) > 0 && !(h.fraisContabilizadoId || h.fraisContabilizadoEm))
    expect(pagos.reduce((a, h) => a + (h.fraisRecuConfirme || 0), 0)).toBe(615)
  })
  it('registo antigo sem campos novos: comportamento antigo (não confirmado → usa o novo)', () => {
    const antigo = linha({ periode: 'Octobre 2026', fichePages: 1, netPaye: 1900, pagamentoSalMesIndex: 9, pagamentoSalAno: 2026 })
    const novo = linha({ periode: 'Octobre 2026', fichePages: 1, netPaye: 2100, pagamentoSalMesIndex: 10, pagamentoSalAno: 2026, pagamentoSalOrigem: 'inferido' })
    const m = fundirFicheExistente(antigo, novo)
    expect(m.netPaye).toBe(2100)
    expect(m.pagamentoSalMesIndex).toBe(10)
  })
  it('registo antigo com salário confirmado (sem origem) também é protegido', () => {
    const antigo = linha({ periode: 'Octobre 2026', fichePages: 1, netPaye: 1900, salarioConfirmado: true, pagamentoSalMesIndex: 8, pagamentoSalAno: 2026 })
    const novo = linha({ periode: 'Octobre 2026', fichePages: 1, netPaye: 2100, salarioConfirmado: true, pagamentoSalMesIndex: 9, pagamentoSalAno: 2026, pagamentoSalOrigem: 'inferido' })
    const m = fundirFicheExistente(antigo, novo)
    expect(m.netPaye).toBe(1900)
    expect(m.pagamentoSalMesIndex).toBe(8)
  })
})
