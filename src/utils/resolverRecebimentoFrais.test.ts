import { resolverRecebimentoFrais } from './resolverRecebimentoFrais'
import type { MoisData } from '../types/moisdata'

// mes: 0–11 (Set = 8, Out = 9, Nov = 10)
const linha = (o: Partial<MoisData> & { periode: string }): MoisData => ({
  moisIndex: 9, annee: 2026, fichePages: 0, netPaye: 0, salairebrut: 0, totalCotisations: 0,
  remboursementFrais: 0, fraisBoletim: 0, montantTotalRecu: 0, jourPaiement1: 5, jourPaiement2: 10,
  analysedAt: '', entreprise: '', conducteur: '', ...o,
})

// Pagamento de frais já recebido: dinheiro confirmado, banco em Out/2026, trabalho em Set/2026.
const pagamento = (periode: string, extra: Partial<MoisData> = {}): MoisData => linha({
  periode, fraisConfirmado: true, fraisRecuConfirme: 250,
  pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado',
  mesFraisTrabalhoIndex: 8, anoFraisTrabalho: 2026, ...extra,
})

const fiche = (trabalho: { ano: number; mes: number } | null = { ano: 2026, mes: 8 }) =>
  ({ periode: 'Novembre 2026', valorDocumental: 250, trabalho })
const recebiEmOut = { estado: 'recebido' as const, mesBanco: { ano: 2026, mes: 9 } }

const congelar = <T,>(x: T): T => {
  const f = (o: any) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(f) } }
  f(x); return x
}

describe('resolverRecebimentoFrais', () => {
  it('frais de Set, pagos em Out, documentados em Nov → possível, e o histórico não é alterado', () => {
    const historico = congelar([pagamento('Octobre 2026')])
    const r = resolverRecebimentoFrais({ historico, fiche: fiche(), resposta: recebiEmOut })
    expect(r.estado).toBe('possivel')
    expect(r.proposta).toEqual({ fraisContabilizadoEm: 'Octobre 2026' })
    expect(r.candidatos[0].forte).toBe(true)
    expect(historico[0].fraisContabilizadoEm).toBeUndefined()
  })

  it('dois pagamentos com o mesmo montante e mês (trabalho desconhecido na fiche) → vários, sem proposta', () => {
    const historico = [
      pagamento('Octobre 2026'),
      pagamento('Octobre 2026 (2)', { mesFraisTrabalhoIndex: 7 }),
    ]
    const r = resolverRecebimentoFrais({ historico, fiche: fiche(null), resposta: recebiEmOut })
    expect(r.estado).toBe('varios')
    expect(r.candidatos).toHaveLength(2)
    expect(r.proposta).toBeNull()
  })

  it('mesmo montante mas períodos de trabalho diferentes → só o do trabalho certo é candidato', () => {
    const historico = [
      pagamento('Octobre 2026'),                                  // trabalho Set
      pagamento('Octobre 2026 (2)', { mesFraisTrabalhoIndex: 7 }), // trabalho Ago
    ]
    const r = resolverRecebimentoFrais({ historico, fiche: fiche({ ano: 2026, mes: 8 }), resposta: recebiEmOut })
    expect(r.estado).toBe('possivel')
    expect(r.proposta).toEqual({ fraisContabilizadoEm: 'Octobre 2026' })
    // se o trabalho da fiche for Ago, é o outro
    const r2 = resolverRecebimentoFrais({ historico, fiche: fiche({ ano: 2026, mes: 7 }), resposta: recebiEmOut })
    expect(r2.proposta).toEqual({ fraisContabilizadoEm: 'Octobre 2026 (2)' })
  })

  it('dados antigos (origem desconhecida) ou inferida: mesmo valor e mês não bastam → requer confirmação', () => {
    for (const origem of [undefined, 'inferido' as const]) {
      const historico = [pagamento('Octobre 2026', { pagamentoFraisOrigem: origem })]
      const r = resolverRecebimentoFrais({ historico, fiche: fiche(), resposta: recebiEmOut })
      expect(r.estado).toBe('requer_confirmacao')
      expect(r.proposta).toBeNull()
      expect(r.candidatos[0].evidenciaBanco).toBe('nao_comprovado')
    }
    // banco declarado mas trabalho da fiche desconhecido também não basta
    const r = resolverRecebimentoFrais({ historico: [pagamento('Octobre 2026')], fiche: fiche(null), resposta: recebiEmOut })
    expect(r.estado).toBe('requer_confirmacao')
  })

  it('«por receber» e «não sei» → nenhuma associação, nem zero nem candidatos', () => {
    const historico = [pagamento('Octobre 2026')]
    const a = resolverRecebimentoFrais({ historico, fiche: fiche(), resposta: { estado: 'por_receber' } })
    const b = resolverRecebimentoFrais({ historico, fiche: fiche(), resposta: { estado: 'desconhecido' } })
    expect(a).toEqual({ estado: 'nenhum', motivo: 'por_receber', candidatos: [], proposta: null })
    expect(b).toEqual({ estado: 'nenhum', motivo: 'desconhecido', candidatos: [], proposta: null })
  })

  it('confirmação explícita de uma correspondência (mesmo com origem desconhecida); inexistente → nenhum', () => {
    const historico = [
      pagamento('Octobre 2026', { pagamentoFraisOrigem: undefined }),
      pagamento('Octobre 2026 (2)', { pagamentoFraisOrigem: undefined, mesFraisTrabalhoIndex: 7 }),
    ]
    const r = resolverRecebimentoFrais({
      historico, fiche: fiche(null),
      resposta: { estado: 'recebido', mesBanco: { ano: 2026, mes: 9 }, pagamentoPeriode: 'Octobre 2026 (2)' },
    })
    expect(r.estado).toBe('confirmado')
    expect(r.proposta).toEqual({ fraisContabilizadoEm: 'Octobre 2026 (2)' })
    const x = resolverRecebimentoFrais({
      historico, fiche: fiche(null), resposta: { estado: 'recebido', pagamentoPeriode: 'Mars 2026' },
    })
    expect(x).toEqual({ estado: 'nenhum', motivo: 'pagamento_inexistente', candidatos: [], proposta: null })
  })

  it('pagamento já reclamado por outra fiche, ou sem dinheiro, não volta a ser candidato', () => {
    const historico = [
      pagamento('Octobre 2026'),
      linha({ periode: 'Septembre 2026', fraisContabilizadoEm: 'Octobre 2026', remboursementFrais: 250 }),
    ]
    const r = resolverRecebimentoFrais({ historico, fiche: fiche(), resposta: recebiEmOut })
    expect(r.estado).toBe('nenhum')
    expect(r.estado === 'nenhum' ? r.motivo : null).toBe('sem_candidatos')
    const sem = resolverRecebimentoFrais({
      historico: [linha({ periode: 'Octobre 2026', remboursementFrais: 250 })], fiche: fiche(), resposta: recebiEmOut,
    })
    expect(sem.estado).toBe('nenhum')
  })
})
