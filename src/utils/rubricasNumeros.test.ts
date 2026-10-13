// src/utils/rubricasNumeros.test.ts — Etapa 2C: formatos monetários franceses em lerNumero
import { lerNumero, normalizarRespostaExtracao } from './rubricas'
import type { ProblemaDados } from '../types/rubricas'

const NBSP = ' '
const NNBSP = ' '
const ler = (v: unknown) => { const ps: ProblemaDados[] = []; const valor = lerNumero(v, 'x', ps); return { valor, codigos: ps.map(p => p.codigo) } }

describe('1. formatos inequívocos aceites', () => {
  const aceites: [string, unknown, number][] = [
    ['milhares com espaço normal', '1 234,56', 1234.56],
    ['milhares com espaço inseparável (U+00A0)', `1${NBSP}234,56`, 1234.56],
    ['milhares com espaço inseparável estreito (U+202F)', `1${NNBSP}234,56`, 1234.56],
    ['pontos de milhar + vírgula decimal', '1.234,56', 1234.56],
    ['negativo com sufixo', '12,50-', -12.5],
    ['negativo entre parênteses', '(12,50)', -12.5],
    ['negativo com prefixo', '-12,50', -12.5],
    ['menos tipográfico (U+2212)', '−12,50', -12.5],
    ['euro e espaço', '12,5 €', 12.5],
    ['percentagem', '100 %', 100],
    ['inteiro com milhares', '1 234', 1234],
    ['milhares + ponto decimal', '1 234.56', 1234.56],
    ['ponto decimal simples', '12.50', 12.5],
    ['zero impresso', '0,00', 0],
    ['0,123 (parte inteira 0 ⇒ decimal)', '0,123', 0.123],
    ['sinal + explícito', '+2,5', 2.5],
    ['milhões com espaços', '12 345 678,9', 12345678.9],
    ['dois decimais com milhar e sufixo negativo', '1 234,56-', -1234.56],
    ['parênteses com milhar', '(1.234,56)', -1234.56],
  ]
  for (const [nome, entrada, esperado] of aceites) {
    it(`${nome}: «${String(entrada)}» → ${esperado}`, () => {
      const r = ler(entrada)
      expect(r.valor).toBe(esperado)
      expect(r.codigos.includes('numero_invalido')).toBe(false)
      expect(r.codigos.includes('texto_convertido')).toBe(true)
    })
  }
  it('negativos por sufixo/parênteses são assinalados (negativo_por_formato); prefixo não', () => {
    expect(ler('12,50-').codigos.includes('negativo_por_formato')).toBe(true)
    expect(ler('(12,50)').codigos.includes('negativo_por_formato')).toBe(true)
    expect(ler('-12,50').codigos.includes('negativo_por_formato')).toBe(false)
  })
  it('«(0,00)» dá 0 e não -0', () => {
    expect(Object.is(ler('(0,00)').valor, 0)).toBe(true)
    expect(Object.is(ler('0,00-').valor, 0)).toBe(true)
  })
})

describe('2. formatos ambíguos ou malformados continuam recusados (null + erro, nunca adivinhar)', () => {
  const recusados: [string, string][] = [
    ['«1.234» isolado (1,234 ou 1234?)', '1.234'],
    ['«1,234» isolado', '1,234'],
    ['«12,345»', '12,345'],
    ['«123.456»', '123.456'],
    ['inglês «1,234.56»', '1,234.56'],
    ['vários pontos «1.234.567»', '1.234.567'],
    ['espaços mal agrupados «12 34»', '12 34'],
    ['grupo de 4 dígitos «1 2345,6»', '1 2345,6'],
    ['sinais duplos «--5»', '--5'],
    ['parênteses + sufixo «(12,50)-»', '(12,50)-'],
    ['prefixo + sufixo «-12,50-»', '-12,50-'],
    ['sem parte inteira «,5»', ',5'],
    ['vírgula final «1.234,»', '1.234,'],
    ['texto', 'abc'],
    ['misturado «12,5abc»', '12,5abc'],
    ['só sinal «-»', '-'],
  ]
  for (const [nome, entrada] of recusados) {
    it(`${nome}: «${entrada}» → null com numero_invalido`, () => {
      const r = ler(entrada)
      expect(r.valor).toBeNull()
      expect(r.codigos.includes('numero_invalido')).toBe(true)
    })
  }
  it('vazio e ausente são null SEM erro (ausente ≠ inválido ≠ zero)', () => {
    for (const v of ['', '   ', null, undefined]) { const r = ler(v); expect(r.valor).toBeNull(); expect(r.codigos).toEqual([]) }
  })
  it('valores já suportados não mudam: números JSON, 0 e negativos', () => {
    expect(ler(12.5).valor).toBe(12.5)
    expect(ler(0).valor).toBe(0)
    expect(ler(-3).valor).toBe(-3)
    expect(ler(NaN).valor).toBeNull()
    expect(ler(Infinity).codigos).toEqual(['numero_invalido'])
    expect(ler({}).codigos).toEqual(['numero_invalido'])
  })
})

describe('3. nas linhas: sinal impresso preservado e dados originais intactos', () => {
  const doc = normalizarRespostaExtracao({
    lignes: [
      { libelle: 'A', montant: '12,50-', colonne: 'retenue' },
      { libelle: 'B', montant: '(75,40)' },
      { libelle: 'C', montant: '1 234,56' },
      { libelle: 'D', montant: '1.234' },
      { libelle: 'E', montant: '0,00' },
    ],
  }, { agora: '2026-10-13T10:00:00.000Z' })
  it('«12,50-» e «(75,40)» ficam negativos; a coluna não inverte o sinal', () => {
    expect(doc.linhas[0].montante).toBe(-12.5)
    expect(doc.linhas[0].sinal).toBe('negativo')
    expect(doc.linhas[0].coluna).toBe('retenue')
    expect(doc.linhas[1].montante).toBe(-75.4)
  })
  it('«1.234» ambíguo ⇒ montante null (e erro assinalado), nunca 1,234 nem 1234', () => {
    expect(doc.linhas[3].montante).toBeNull()
    expect(doc.linhas[3].sinal).toBe('desconhecido')
    expect(doc.linhas[3].problemas.map(p => p.codigo)).toContain('numero_invalido')
  })
  it('«0,00» ⇒ 0 impresso (sinal zero), distinto de ausente', () => {
    expect(doc.linhas[4].montante).toBe(0)
    expect(doc.linhas[4].sinal).toBe('zero')
  })
  it('o valor original em texto não se perde: fica no documento de entrada (não alterado)', () => {
    const entrada = Object.freeze({ lignes: Object.freeze([Object.freeze({ libelle: 'A', montant: '12,50-' })]) })
    normalizarRespostaExtracao(entrada, { agora: '2026-10-13T10:00:00.000Z' })
    expect(entrada.lignes[0].montant).toBe('12,50-')
  })
})
