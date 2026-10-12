import * as fs from 'fs'
import * as path from 'path'
import {
  aplicarConfirmacaoRecebimentoFrais, aplicarConfirmacoesFrais, camposFraisDaEdicao, desligarOrfas, listarPagamentosCandidatos,
  mensagemRecusaFrais, pagamentoLigado, validarEdicaoPagamentoLigado, valorFraisDoMes, type ConfirmacaoFrais,
} from './confirmacaoFrais'
import { fraisRealConfirme } from './projecoes'
import { mesesDeFrais } from './mesesDeFrais'
import type { MoisData } from '../types/moisdata'

// mes: 0–11 (Ago = 7, Set = 8, Out = 9, Nov = 10)
const linha = (o: Partial<MoisData> & { periode: string }): MoisData => ({
  moisIndex: 9, annee: 2026, fichePages: 0, netPaye: 0, salairebrut: 0, totalCotisations: 0,
  remboursementFrais: 0, fraisBoletim: 0, montantTotalRecu: 0, jourPaiement1: 5, jourPaiement2: 10,
  analysedAt: '', entreprise: '', conducteur: '', ...o,
})
// Pagamento manual de Out (frais de Set), como o cria aplicarConfirmacaoFraisPorValor.
const pagOut = (extra: Partial<MoisData> = {}) => linha({
  periode: 'Octobre 2026', fraisConfirmado: true, fraisRecuConfirme: 250,
  pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, mesFraisTrabalhoIndex: 8, anoFraisTrabalho: 2026, ...extra,
})
// Fiche de Nov importada como hoje: rubrica 250 e o mesmo dinheiro copiado para fraisRecuConfirme.
const ficheNov = (extra: Partial<MoisData> = {}) => linha({
  periode: 'Novembre 2026', moisIndex: 10, fichePages: 1, netPaye: 2000, remboursementFrais: 250,
  fraisConfirmado: true, fraisRecuConfirme: 250, montantTotalRecu: 2250,
  pagamentoFraisMesIndex: 10, pagamentoFraisAno: 2026, mesFraisTrabalhoIndex: 9, anoFraisTrabalho: 2026, ...extra,
})
const somaFrais = (h: readonly MoisData[]) => h.reduce((s, d) => s + fraisRealConfirme(d), 0)
// Critério do cartão de frais do Salaire (fiche.tsx calcularSalario): fraisConfirmado + valor > 0, pelo mês de trabalho.
const cartaoSalaire = (h: readonly MoisData[], ano: number, mes: number) => {
  const f = h.filter(d => (d.mesFraisTrabalhoIndex ?? d.moisIndex) === mes && (d.anoFraisTrabalho ?? d.annee) === ano
    && !!d.fraisConfirmado && ((d.fraisRecuConfirme || 0) > 0 || (d.fraisBoletim || 0) > 0))
  return f.length ? (f[0].fraisRecuConfirme || f[0].fraisBoletim) : 0
}
const congelar = <T,>(x: T): T => {
  const f = (o: any) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(f) } }
  f(x); return x
}
const novoId = () => 'id-1'
const recebiLigado: ConfirmacaoFrais = {
  confirmadoPeloMotorista: true, fichePeriode: 'Novembre 2026',
  estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, valor: 250, pagamentoPeriode: 'Octobre 2026',
}
const aplicar = (h: readonly MoisData[], c: ConfirmacaoFrais) => aplicarConfirmacaoRecebimentoFrais(h, c, { novoId })

describe('confirmação explícita dos frais', () => {
  it('só a interface o usa: sem confirmação explícita nada muda; importadores limitados a fiche e index', () => {
    const h = congelar([pagOut(), ficheNov()])
    const sem = { fichePeriode: 'Novembre 2026', estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, valor: 250, pagamentoPeriode: 'Octobre 2026' } as any
    for (const c of [sem, { ...sem, confirmadoPeloMotorista: false }, { ...sem, confirmadoPeloMotorista: 'true' }, null, undefined]) {
      const r = aplicar(h, c as any)
      expect(r.aplicado).toBe(false)
      expect(r.historico).toBe(h)
    }
    const raiz = path.join(__dirname, '..', '..')
    const percorrer = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
      if (['node_modules', '.git', 'android', 'ios'].includes(e.name)) return []
      const p = path.join(d, e.name)
      return e.isDirectory() ? percorrer(p) : /\.(tsx?|jsx?)$/.test(e.name) ? [p] : []
    })
    const importadores = ['app', 'context', 'src'].flatMap(d => percorrer(path.join(raiz, d)))
      .filter(f => !/confirmacaoFrais\.(test\.)?ts$/.test(f))
      .filter(f => !/\.(test|spec)\.tsx?$/.test(f))   // ficheiros de teste não são consumidores funcionais
      .filter(f => /from ['"][./]*(src\/utils\/)?confirmacaoFrais['"]/.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.basename(f)).sort()
    expect(importadores).toEqual(['fiche.tsx', 'index.tsx'])
  })

  it('frais de Set recebidos em Out e documentados em Nov: o dinheiro conta uma só vez, o documental fica', () => {
    const h = congelar([pagOut(), ficheNov()])
    expect(somaFrais(h)).toBe(500) // situação atual: duplicado
    const r = aplicar(h, recebiLigado)
    expect(r.aplicado).toBe(true)
    if (!r.aplicado) return
    const [pag, nov] = r.historico
    expect(somaFrais(r.historico)).toBe(250)
    expect(nov.fraisRecebimento).toBe('recebido')
    expect(nov.fraisContabilizadoId).toBe('id-1')
    expect(pag.fraisPagamentoId).toBe('id-1')
    expect(nov.remboursementFrais).toBe(250)       // documental
    expect(nov.fraisRecuConfirme).toBeUndefined()   // não é dinheiro
    expect(nov.fraisConfirmado).toBe(false)
    expect(nov.pagamentoFraisOrigem).toBe('declarado')
    expect(nov.montantTotalRecu).toBe(2250)         // semântica histórica intacta
    expect(pag.fraisRecuConfirme).toBe(250)
    expect(pag.pagamentoFraisOrigem).toBeUndefined() // a data do pagamento antigo não é inventada
    expect(h[1].fraisRecuConfirme).toBe(250)         // original não mutado
  })

  it('importação antes e depois do registo bancário: nunca duplica', () => {
    // Depois: pagamento de Out já registado, importa-se a fiche de Nov → ligação explícita.
    const depois = aplicar([pagOut(), ficheNov()], recebiLigado)
    expect(depois.aplicado && somaFrais(depois.historico)).toBe(250)
    // Antes: a fiche de Nov foi importada primeiro (já com o dinheiro); o motorista confirma depois o mês real (Out):
    // o pagamento é a própria linha — fica uma só linha com dinheiro, sem criar outra.
    const antes = aplicar([ficheNov()], {
      confirmadoPeloMotorista: true, fichePeriode: 'Novembre 2026', estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, valor: 250,
    })
    expect(antes.aplicado).toBe(true)
    if (!antes.aplicado) return
    expect(antes.historico).toHaveLength(1)
    expect(somaFrais(antes.historico)).toBe(250)
    expect(antes.historico[0].pagamentoFraisMesIndex).toBe(9)
    expect(antes.historico[0].pagamentoFraisOrigem).toBe('declarado')
    expect(mesesDeFrais(antes.historico[0]).origemBanco).toBe('declarado')
  })

  it('dois pagamentos iguais em períodos diferentes: só o escolhido é ligado; sem escolha nada é ligado', () => {
    const outro = pagOut({ periode: 'Octobre 2026 (2)', mesFraisTrabalhoIndex: 7 })
    const h = congelar([pagOut(), outro, ficheNov()])
    expect(listarPagamentosCandidatos(h, 'Novembre 2026', 250).map(c => c.periode)).toEqual(['Octobre 2026', 'Octobre 2026 (2)'])
    const r = aplicar(h, { ...recebiLigado, pagamentoPeriode: 'Octobre 2026 (2)' })
    expect(r.aplicado).toBe(true)
    if (!r.aplicado) return
    expect(r.historico[2].fraisContabilizadoId).toBe('id-1')
    expect(r.historico[1].fraisPagamentoId).toBe('id-1')
    expect(r.historico[0]).toBe(h[0]) // o outro pagamento nem é copiado
    expect(somaFrais(r.historico)).toBe(500) // 2 pagamentos reais, cada um uma vez
    // depois da ligação, o pagamento ligado deixa de ser candidato; o outro continua
    expect(listarPagamentosCandidatos(r.historico, 'Septembre 2026', 250).map(c => c.periode)).toEqual(['Octobre 2026'])
    // sem pagamentoPeriode: não vai buscar nenhum pagamento sozinha
    const sem = aplicar([pagOut(), ficheNov({ fraisConfirmado: false, fraisRecuConfirme: undefined })], { ...recebiLigado, pagamentoPeriode: undefined })
    expect(sem.aplicado === false && sem.motivo).toBe('sem_pagamento_na_linha')
  })

  it('recusas de segurança: inexistente, já reclamado, valor ou mês diferentes, a própria fiche', () => {
    const h = [pagOut(), ficheNov()]
    const m = (c: Partial<ConfirmacaoFrais> & Record<string, unknown>) => {
      const r = aplicar(h, { ...recebiLigado, ...c } as ConfirmacaoFrais); return 'motivo' in r ? r.motivo : 'ok'
    }
    expect(m({ pagamentoPeriode: 'Mars 2026' })).toBe('pagamento_inexistente')
    expect(m({ valor: 180 })).toBe('valor_diferente')
    expect(m({ pagamentoPeriode: 'Novembre 2026' })).toBe('pagamento_e_a_propria_fiche')
    const reclamado = aplicar([pagOut({ fraisPagamentoId: 'x' }), linha({ periode: 'Septembre 2026', fraisContabilizadoId: 'x' }), ficheNov()], recebiLigado)
    expect(reclamado.aplicado === false && reclamado.motivo).toBe('pagamento_ja_reclamado')
    const mesDif = aplicar([pagOut({ pagamentoFraisOrigem: 'declarado' }), ficheNov()], { ...recebiLigado, mesBanco: { ano: 2026, mes: 8 } } as ConfirmacaoFrais)
    expect(mesDif.aplicado === false && mesDif.motivo).toBe('mes_diferente')
  })

  it('edição de fiche associada: não recria o pagamento nem destrói a associação', () => {
    const lig = aplicar([pagOut(), ficheNov()], recebiLigado)
    if (!lig.aplicado) throw new Error('ligação falhou')
    const nov = lig.historico[1]
    const editada = { ...nov, ...camposFraisDaEdicao(nov, 255, 10, 2026), netPaye: 2100, montantTotalRecu: 2100 + 255 }
    const h = [lig.historico[0], editada]
    expect(editada.fraisContabilizadoId).toBe('id-1')
    expect(editada.fraisRecebimento).toBe('recebido')
    expect(editada.fraisConfirmado).toBe(false)
    expect(editada.fraisRecuConfirme).toBeUndefined()
    expect(editada.remboursementFrais).toBe(255) // só o documental muda
    expect(somaFrais(h)).toBe(250)
    expect(pagamentoLigado(h, editada)).toBe(h[0])
    // sem ligação o comportamento é exatamente o antigo
    const antiga = ficheNov()
    expect(camposFraisDaEdicao(antiga, 255, 10, 2026)).toEqual({
      fraisBoletim: 255, remboursementFrais: 255, fraisRecuConfirme: 255, fraisConfirmado: true,
      pagamentoFraisMesIndex: 10, pagamentoFraisAno: 2026,
    })
    expect(camposFraisDaEdicao(antiga, 0, 10, 2026)).toEqual({
      fraisBoletim: 0, remboursementFrais: 250, fraisRecuConfirme: 250, fraisConfirmado: false,
      pagamentoFraisMesIndex: 10, pagamentoFraisAno: 2026,
    })
  })

  it('mudança de `periode`: a associação segue o identificador; apagar o pagamento desliga sem inventar', () => {
    const lig = aplicar([pagOut(), ficheNov()], recebiLigado)
    if (!lig.aplicado) throw new Error('ligação falhou')
    const renomeado = [{ ...lig.historico[0], periode: 'Octobre 2026 (corrigido)' }, { ...lig.historico[1], periode: 'Novembre 2026 b' }]
    expect(pagamentoLigado(renomeado, renomeado[1])).toBe(renomeado[0])
    expect(desligarOrfas(renomeado)).toBe(renomeado) // nada a corrigir
    expect(somaFrais(renomeado)).toBe(250)
    // dois renomeados com a mesma pista antiga não se confundem: manda o id
    const intruso = linha({ periode: 'Octobre 2026', fraisConfirmado: true, fraisRecuConfirme: 99 })
    expect(pagamentoLigado([intruso, ...renomeado], renomeado[1])).toBe(renomeado[0])
    // apagar o pagamento: a fiche deixa de afirmar «recebido»; o documental e o resto ficam
    const semPag = desligarOrfas([renomeado[1]])
    expect(semPag[0].fraisContabilizadoId).toBeUndefined()
    expect(semPag[0].fraisRecebimento).toBe('desconhecido')
    expect(semPag[0].remboursementFrais).toBe(250)
    expect(somaFrais(semPag)).toBe(0)
  })

  it('confirmação recusada (valor, mês, pagamento): avisa em francês, não grava nada e devolve o histórico original', () => {
    const h = congelar([pagOut({ pagamentoFraisOrigem: 'declarado' }), ficheNov()])
    const item = (c: Record<string, unknown>) => [{ fichePeriode: 'Novembre 2026', confirmacao: c }]
    const base = { estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, valor: 250, pagamentoPeriode: 'Octobre 2026' }
    const casos: [Record<string, unknown>, string][] = [
      [{ ...base, valor: 180 }, 'valor_diferente'],
      [{ ...base, mesBanco: { ano: 2026, mes: 8 } }, 'mes_diferente'],
      [{ ...base, pagamentoPeriode: 'Mars 2026' }, 'pagamento_inexistente'],
    ]
    for (const [c, motivo] of casos) {
      const r = aplicarConfirmacoesFrais(h, item(c), { novoId })
      expect(r.recusas).toHaveLength(1)
      expect(r.recusas[0].motivo).toBe(motivo)
      expect(r.historico).toBe(h)                               // nada gravado
      expect(/[a-zé]/i.test(r.recusas[0].mensagem)).toBe(true)
      expect(r.recusas[0].mensagem).toBe(mensagemRecusaFrais(motivo as any))
      expect(r.recusas[0].mensagem.includes('Vérifie') || r.recusas[0].mensagem.includes('Corrige') || r.recusas[0].mensagem.includes('Choisis') || r.recusas[0].mensagem.includes('choisis')).toBe(true)
    }
    // uma recusa entre várias fiches também impede gravar as restantes confirmações
    const duas = [
      { fichePeriode: 'Novembre 2026', confirmacao: base },
      { fichePeriode: 'Inconnue', confirmacao: base },
    ]
    const mista = aplicarConfirmacoesFrais(h, duas, { novoId })
    expect(mista.recusas).toHaveLength(1)
    expect(mista.historico).toBe(h)
    // sem recusas: aplica normalmente; sem confirmação: não faz nada (mesma referência)
    const ok = aplicarConfirmacoesFrais(h, item(base), { novoId })
    expect(ok.recusas).toHaveLength(0)
    expect(somaFrais(ok.historico)).toBe(250)
    const nada = aplicarConfirmacoesFrais(h, [{ fichePeriode: 'Novembre 2026', confirmacao: undefined }], { novoId })
    expect(nada.historico).toBe(h)
    expect(nada.recusas).toHaveLength(0)
  })

  it('editar um pagamento associado para zero é recusado e avisa; valor > 0, pagamento sem ligação e fiches não são afetados', () => {
    const lig = aplicar([pagOut(), ficheNov()], recebiLigado)
    if (!lig.aplicado) throw new Error('ligação falhou')
    const [pag, nov] = lig.historico
    const v0 = validarEdicaoPagamentoLigado(lig.historico, pag, 0)
    expect(v0.ok).toBe(false)
    expect('fiches' in v0 ? v0.fiches : []).toEqual(['Novembre 2026'])
    expect('mensagem' in v0 && v0.mensagem.includes('Ce paiement est associé')).toBe(true)
    expect('mensagem' in v0 && v0.mensagem.includes('rien n')).toBe(true)
    // o histórico fica exatamente como estava (a validação é só leitura)
    expect(lig.historico[0]).toBe(pag)
    expect(pag.fraisRecuConfirme).toBe(250)
    // valor positivo, outro montante: permitido
    expect(validarEdicaoPagamentoLigado(lig.historico, pag, 240).ok).toBe(true)
    // pagamento antigo sem ligação (sem id): comportamento anterior, pode ir a zero
    expect(validarEdicaoPagamentoLigado([pagOut(), ficheNov()], pagOut(), 0).ok).toBe(true)
    // a fiche associada (não é o pagamento) continua editável, mesmo a zero (só documental)
    expect(validarEdicaoPagamentoLigado(lig.historico, nov, 0).ok).toBe(true)
  })

  it('«por receber» / «não sei»: só regista a resposta; recusa se houver dinheiro confirmado', () => {
    const base = { confirmadoPeloMotorista: true, fichePeriode: 'Novembre 2026' } as const
    const semDinheiro = ficheNov({ fraisConfirmado: false, fraisRecuConfirme: undefined })
    for (const estado of ['por_receber', 'desconhecido'] as const) {
      const r = aplicar([semDinheiro], { ...base, estado })
      expect(r.aplicado).toBe(true)
      if (!r.aplicado) return
      expect(r.historico[0].fraisRecebimento).toBe(estado)
      expect(r.historico[0].remboursementFrais).toBe(250)
      expect(r.historico[0].pagamentoFraisOrigem).toBeUndefined()
      expect(fraisRealConfirme(r.historico[0])).toBe(0)
    }
    const conflito = aplicar([ficheNov()], { ...base, estado: 'por_receber' })
    expect(conflito.aplicado === false && conflito.motivo).toBe('conflito_com_pagamento_confirmado')
  })

  it('dados históricos sem origem confirmada: tudo igual a hoje, a data bancária não é «declarada»', () => {
    const antigo = congelar([pagOut(), ficheNov()])
    expect(antigo.map(d => mesesDeFrais(d).origemBanco)).toEqual(['desconhecida', 'desconhecida'])
    expect(antigo.map(d => d.fraisRecebimento)).toEqual([undefined, undefined])
    // leitores: critério antigo preservado (primeiro registo do mês de trabalho, com os fallbacks de sempre)
    expect(valorFraisDoMes(antigo, 2026, 8)).toBe(250)  // Set → linha de Out
    expect(valorFraisDoMes(antigo, 2026, 9)).toBe(250)  // Out → linha de Nov (comportamento atual sem ligação)
    expect(valorFraisDoMes([linha({ periode: 'x', moisIndex: 3, remboursementFrais: 80 })], 2026, 4)).toBe(0) // outro mês → 0
    expect(valorFraisDoMes([linha({ periode: 'x', moisIndex: 3, remboursementFrais: 80 })].map(d => ({ ...d, annee: 2026 })), 2026, 3)).toBe(80)
  })

  it('Home, Stats e Salaire leem o mesmo dinheiro e não duplicam', () => {
    const lig = aplicar([pagOut(), ficheNov()], recebiLigado)
    if (!lig.aplicado) throw new Error('ligação falhou')
    const h = lig.historico
    // mês de trabalho de Set (do pagamento): Home/Stats e Salaire coincidem
    expect(valorFraisDoMes(h, 2026, 8)).toBe(250)
    expect(cartaoSalaire(h, 2026, 8)).toBe(250)
    // mês de trabalho derivado da fiche de Nov (Out): a linha só-documental não conta em lado nenhum
    expect(valorFraisDoMes(h, 2026, 9)).toBe(0)
    expect(cartaoSalaire(h, 2026, 9)).toBe(0)
    // total efetivo = 250 uma só vez; recebido da fiche (comparação com a estimativa) inalterado
    expect(somaFrais(h)).toBe(250)
    expect(h[1].montantTotalRecu).toBe(2250)
  })
})
