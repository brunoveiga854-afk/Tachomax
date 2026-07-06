// src/engine/aprendizagem.test.ts
// Testes unitários para aprendizagem.ts (TachoOffice)
// Dados mock baseados em Williamson: hval≈14.82, liquidRate≈0.89, hbase=169

import {
  calcularLiquidRate,
  detectarAnomalias,
  aplicarRespostaConduteur,
  actualizarPadraoComBoletim,
  PADRAO_INICIAL,
  PadraoAprendido,
  BoletimExtraido,
  PerguntaPendente,
} from './aprendizagem'

// ─── Mocks reutilizáveis ──────────────────────────────────────────────────────

const padraoWilliamson: PadraoAprendido = {
  ...PADRAO_INICIAL,
  hval: 14.82,
  liquidRate: 0.89,
  liquidRateHistorico: [0.89, 0.88, 0.90, 0.89, 0.88, 0.89],
  hlagConfirmado: true,
  flagConfirmado: true,
}

const boletimWilliamson: BoletimExtraido = {
  periodo: 'Avril 2026',
  moisIndex: 3,
  annee: 2026,
  netPaye: 2670,
  salairebrut: 2999,
  hval: 14.82,
  heuresSuppl25: 8,
  heuresSuppl50: null,
  heuresNuit: null,
  joursCongesN: null,
  joursCongesN1: null,
  joursRC: null,
  fraisBoletim: 1240,
  rubriquesDesconhecidas: [],
  dataPagamento: null,
  mesTrabalho: null,
}

// ─── 1. calcularLiquidRate ────────────────────────────────────────────────────
// (equivalente ao analisarPadraoV2 pedido — lógica central de liquidRate)

describe('calcularLiquidRate', () => {
  it('retorna 0.791 para array vazio (default Williamson)', () => {
    expect(calcularLiquidRate([])).toBeCloseTo(0.791)
  })

  it('retorna ≈0.89 com histórico Williamson uniforme', () => {
    const historico = [0.89, 0.88, 0.90, 0.89, 0.88, 0.89]
    const result = calcularLiquidRate(historico)
    expect(result).toBeCloseTo(0.888, 2)
  })

  it('resultado está sempre no range 0.60–0.95 para valores realistas', () => {
    const casos = [
      [0.87, 0.88, 0.89, 0.90, 0.88, 0.89],
      [0.791, 0.791, 0.791],
      [0.82, 0.83, 0.81],
    ]
    for (const h of casos) {
      const r = calcularLiquidRate(h)
      expect(r).toBeGreaterThanOrEqual(0.60)
      expect(r).toBeLessThanOrEqual(0.95)
    }
  })

  it('filtra outliers >5% da mediana (equivalente a moisAtipico=true)', () => {
    // 0.50 é outlier claro — deve ser excluído do cálculo
    const comOutlier = [0.89, 0.88, 0.90, 0.50, 0.89, 0.89]
    const semOutlier = [0.89, 0.88, 0.90, 0.89, 0.89]
    const rCom = calcularLiquidRate(comOutlier)
    const rSem = calcularLiquidRate(semOutlier)
    // Resultado com outlier ≈ resultado sem outlier (outlier filtrado)
    expect(Math.abs(rCom - rSem)).toBeLessThan(0.02)
  })

  it('hval calculado é positivo', () => {
    // actualizarPadraoComBoletim deriva hval do boletim — testa via essa função
    const padraoSemHval = { ...padraoWilliamson, hval: null, tauxEquiv: null }
    const result = actualizarPadraoComBoletim(boletimWilliamson, padraoSemHval)
    expect(result.hval).not.toBeNull()
    expect(result.hval!).toBeGreaterThan(0)
  })
})

// ─── 2. detectarAnomalias — taxa_mudou ───────────────────────────────────────

describe('detectarAnomalias — taxa_mudou', () => {
  it('NÃO gera taxa_mudou se _hvalErroConfirmado === boletim.hval', () => {
    const padraoComErro: PadraoAprendido = {
      ...padraoWilliamson,
      _hvalErroConfirmado: 15.50,
    }
    const boletimErrado: BoletimExtraido = { ...boletimWilliamson, hval: 15.50 }

    const perguntas = detectarAnomalias(boletimErrado, padraoComErro)
    expect(perguntas.filter(p => p.tipo === 'taxa_mudou')).toHaveLength(0)
  })

  it('gera taxa_mudou se hval difere >0.01 e não está confirmado como erro', () => {
    const boletimNovaTaxa: BoletimExtraido = { ...boletimWilliamson, hval: 15.50 }

    const perguntas = detectarAnomalias(boletimNovaTaxa, padraoWilliamson)
    const taxa = perguntas.filter(p => p.tipo === 'taxa_mudou')
    expect(taxa).toHaveLength(1)
    expect(taxa[0].valorContexto).toEqual({ ancien: 14.82, nouveau: 15.50 })
  })

  it('NÃO gera taxa_mudou se diferença <0.01 (ruído de arredondamento)', () => {
    const boletimQuaseIgual: BoletimExtraido = { ...boletimWilliamson, hval: 14.825 }

    const perguntas = detectarAnomalias(boletimQuaseIgual, padraoWilliamson)
    expect(perguntas.filter(p => p.tipo === 'taxa_mudou')).toHaveLength(0)
  })

  it('NÃO gera taxa_mudou se padrao.hval é null (primeira fiche)', () => {
    const padraoSemHval: PadraoAprendido = { ...padraoWilliamson, hval: null }

    const perguntas = detectarAnomalias(boletimWilliamson, padraoSemHval)
    expect(perguntas.filter(p => p.tipo === 'taxa_mudou')).toHaveLength(0)
  })
})

// ─── 3. aplicarRespostaConduteur — taxa_mudou ────────────────────────────────

describe('aplicarRespostaConduteur — taxa_mudou', () => {
  const pergunta: PerguntaPendente = {
    id: 'taxa_mudou_Avril 2026_123',
    tipo: 'taxa_mudou',
    pergunta: 'Le taux horaire sur ta fiche est 15.50€/h...',
    opcoes: ["Oui, c'est mon nouveau taux", "Non, c'est une erreur"],
    valorContexto: { ancien: 14.82, nouveau: 15.50 },
    boletimRef: 'Avril 2026',
  }

  const boletimNovaTaxa: BoletimExtraido = { ...boletimWilliamson, hval: 15.50 }

  it('resposta "Oui" actualiza hval no padrao', () => {
    const result = aplicarRespostaConduteur(
      pergunta, "Oui, c'est mon nouveau taux", padraoWilliamson, boletimNovaTaxa
    )
    expect(result.hval).toBe(15.50)
  })

  it('resposta "Non" guarda _hvalErroConfirmado e preserva hval original', () => {
    const result = aplicarRespostaConduteur(
      pergunta, "Non, c'est une erreur", padraoWilliamson, boletimNovaTaxa
    )
    expect(result._hvalErroConfirmado).toBe(15.50)
    expect(result.hval).toBe(14.82)
  })

  it('é imutável — não modifica o padrao original', () => {
    const hvalOriginal = padraoWilliamson.hval
    aplicarRespostaConduteur(
      pergunta, "Oui, c'est mon nouveau taux", padraoWilliamson, boletimNovaTaxa
    )
    expect(padraoWilliamson.hval).toBe(hvalOriginal)
  })
})

// ─── 4. actualizarPadraoComBoletim ───────────────────────────────────────────

describe('actualizarPadraoComBoletim', () => {
  it('mantém liquidRateHistorico com máx 6 entradas (FIFO)', () => {
    const padrao6: PadraoAprendido = {
      ...padraoWilliamson,
      liquidRateHistorico: [0.87, 0.88, 0.89, 0.90, 0.88, 0.89],
    }
    const result = actualizarPadraoComBoletim(boletimWilliamson, padrao6)
    expect(result.liquidRateHistorico).toHaveLength(6)
    expect(result.liquidRateHistorico[0]).not.toBe(0.87) // oldest saiu
  })

  it('liquidRate resultante está no range 0.60–0.95', () => {
    const result = actualizarPadraoComBoletim(boletimWilliamson, padraoWilliamson)
    expect(result.liquidRate!).toBeGreaterThanOrEqual(0.60)
    expect(result.liquidRate!).toBeLessThanOrEqual(0.95)
  })

  it('adopta hval do boletim quando padrao.hval era null', () => {
    const padraoSemHval = { ...padraoWilliamson, hval: null, tauxEquiv: null }
    const result = actualizarPadraoComBoletim(boletimWilliamson, padraoSemHval)
    expect(result.hval).toBe(14.82)
    expect(result.tauxEquiv).toBeCloseTo(14.82 * 1.25, 2)
  })

  it('NÃO actualiza hval se boletim.hval difere >0.01 (fica para detectarAnomalias)', () => {
    const boletimDiferente: BoletimExtraido = { ...boletimWilliamson, hval: 15.50 }
    const result = actualizarPadraoComBoletim(boletimDiferente, padraoWilliamson)
    expect(result.hval).toBe(14.82)
  })
})
