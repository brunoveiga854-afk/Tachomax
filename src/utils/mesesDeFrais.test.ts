import { mesesDeFrais, chaveMesesFrais } from './mesesDeFrais'

// mes: 0–11 (Set = 8, Out = 9, Nov = 10, Dez = 11, Jan = 0)
describe('mesesDeFrais', () => {
  it('trabalho Set/2026, banco Out/2026 declarado, fiche Nov/2026 → três meses separados', () => {
    const r = mesesDeFrais({
      moisIndex: 10, annee: 2026,
      mesFicheIndex: 10, anoFiche: 2026,
      mesFraisTrabalhoIndex: 8, anoFraisTrabalho: 2026,
      pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026,
      pagamentoFraisOrigem: 'declarado',
    })
    expect(r.trabalho).toEqual({ ano: 2026, mes: 8 })
    expect(r.banco).toEqual({ ano: 2026, mes: 9 })
    expect(r.fiche).toEqual({ ano: 2026, mes: 10 })
    expect(r.origemBanco).toBe('declarado')
    expect(r.trabalhoParaBanco).toBe(1)
    expect(r.bancoParaFiche).toBe(1)
    expect(r.trabalhoParaFiche).toBe(2)
  })

  describe('origem da data bancária', () => {
    const base = { moisIndex: 10, annee: 2026, mesFraisTrabalhoIndex: 8, anoFraisTrabalho: 2026 }

    it('declarado: vale com data diferente do rótulo e também com data coincidente', () => {
      const dif = mesesDeFrais({ ...base, pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado' })
      expect(dif.origemBanco).toBe('declarado')
      expect(dif.trabalhoParaBanco).toBe(1)
      const igual = mesesDeFrais({ ...base, pagamentoFraisMesIndex: 10, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'declarado' })
      expect(igual.origemBanco).toBe('declarado')
      expect(igual.trabalhoParaBanco).toBe(2)
      expect(igual.bancoParaFiche).toBe(0)
    })

    it('inferido: nunca produz diferenças bancárias, seja a data diferente ou coincidente do rótulo', () => {
      for (const mes of [9, 10]) {
        const r = mesesDeFrais({ ...base, pagamentoFraisMesIndex: mes, pagamentoFraisAno: 2026, pagamentoFraisOrigem: 'inferido' })
        expect(r.origemBanco).toBe('inferido')
        expect(r.banco).toEqual({ ano: 2026, mes })
        expect(r.trabalhoParaBanco).toBeNull()
        expect(r.bancoParaFiche).toBeNull()
        expect(r.trabalhoParaFiche).toBe(2)
      }
    })

    it('campo ausente: origem desconhecida mesmo que a data difira do rótulo; valores antigos preservados', () => {
      for (const mes of [9, 10]) {
        const r = mesesDeFrais({ ...base, pagamentoFraisMesIndex: mes, pagamentoFraisAno: 2026 })
        expect(r.origemBanco).toBe('desconhecida')
        expect(r.banco).toEqual({ ano: 2026, mes })
        expect(r.trabalhoParaBanco).toBeNull()
        expect(r.bancoParaFiche).toBeNull()
      }
    })

    it('origem sem data bancária → ausente (a origem sozinha não inventa data)', () => {
      const r = mesesDeFrais({ ...base, pagamentoFraisOrigem: 'declarado' })
      expect(r.origemBanco).toBe('ausente')
      expect(r.banco).toBeNull()
    })
  })

  it('sem datas → null (nada inventado); fiche cai no rótulo; Dez→Jan atravessa o ano', () => {
    const vazio = mesesDeFrais({ moisIndex: 1, annee: 2026 })
    expect(vazio.trabalho).toBeNull()
    expect(vazio.banco).toBeNull()
    expect(vazio.origemBanco).toBe('ausente')
    expect(vazio.fiche).toEqual({ ano: 2026, mes: 1 })
    expect(vazio.trabalhoParaFiche).toBeNull()

    // par incompleto (ano sem mês) também é ausente
    expect(mesesDeFrais({ moisIndex: 1, annee: 2026, anoFraisTrabalho: 2025 }).trabalho).toBeNull()

    const r = mesesDeFrais({
      moisIndex: 1, annee: 2026,
      mesFraisTrabalhoIndex: 11, anoFraisTrabalho: 2025,
      pagamentoFraisMesIndex: 0, pagamentoFraisAno: 2026,
      pagamentoFraisOrigem: 'declarado',
    })
    expect(r.trabalhoParaBanco).toBe(1)
    expect(r.bancoParaFiche).toBe(1)
    expect(r.trabalhoParaFiche).toBe(2)
  })

  it('dois pagamentos com o mesmo valor mas períodos de trabalho distintos → chaves distintas', () => {
    const a = { moisIndex: 10, annee: 2026, fraisRecuConfirme: 250,
      mesFraisTrabalhoIndex: 8, anoFraisTrabalho: 2026, pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026 }
    const b = { moisIndex: 10, annee: 2026, fraisRecuConfirme: 250,
      mesFraisTrabalhoIndex: 9, anoFraisTrabalho: 2026, pagamentoFraisMesIndex: 9, pagamentoFraisAno: 2026 }
    expect(mesesDeFrais(a).trabalho).not.toEqual(mesesDeFrais(b).trabalho)
    expect(chaveMesesFrais(a)).toBe('T2026-09|B2026-10|F2026-11')
    expect(chaveMesesFrais(b)).toBe('T2026-10|B2026-10|F2026-11')
    expect(chaveMesesFrais(a)).not.toBe(chaveMesesFrais(b))
  })
})
