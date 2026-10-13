// src/utils/promptRubricas.test.ts — Etapa 2C: prompt detalhado, legado preservado, limites do proxy
import * as fs from 'fs'
import * as path from 'path'
import {
  PROMPT_FICHES_LEGADO, SYSTEM_EXTRACAO_LEGADO, BLOCO_RUBRICAS, VERSAO_PROMPT_RUBRICAS, CHAVES_DETALHADAS,
  MODELO_PROXY, MAX_TOKENS_PROXY, LIMITE_TEXTO_PROXY, LIMITE_SYSTEM_PROXY, MAX_TOKENS_LEGADO, MAX_TOKENS_DETALHADO,
  construirPromptRubricas, construirPedidoRubricas, construirPedidoLegado, chavesLegadasDoPrompt, verificarLimitesPrompt,
  type BlocoFicheiro,
} from './promptRubricas'
import { CATEGORIAS_RUBRICA } from '../types/rubricas'

const RAIZ = path.join(__dirname, '../..')
const lerFonte = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n')
const vp = require(path.join(RAIZ, 'netlify/lib/validarPedido.js'))

const img: BlocoFicheiro = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } }
const pdf: BlocoFicheiro = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } }

describe('1. o prompt legado é a cópia exata da fonte real (fiche.tsx)', () => {
  const fonte = lerFonte('app/(tabs)/fiche.tsx')
  it('PROMPT_FICHES_LEGADO é idêntico ao texto de importerImagens', () => {
    const a = fonte.indexOf('text: `Tu es un expert en bulletins de salaire') + 'text: `'.length
    const b = fonte.indexOf('dans netPaye.` })', a) + 'dans netPaye.'.length
    expect(a).toBeGreaterThan('text: `'.length)
    expect(fonte.slice(a, b)).toBe(PROMPT_FICHES_LEGADO)
  })
  it('SYSTEM_EXTRACAO_LEGADO é idêntico ao system usado hoje', () => {
    expect(fonte.includes(`system: '${SYSTEM_EXTRACAO_LEGADO}'`)).toBe(true)
  })
  it('max_tokens legado = o do pedido atual', () => {
    expect(fonte.includes(`max_tokens: ${MAX_TOKENS_LEGADO}, system: '${SYSTEM_EXTRACAO_LEGADO}'`)).toBe(true)
  })
  it('o ficheiro gerado avisa que não se edita à mão', () => {
    expect(lerFonte('src/utils/promptRubricasLegado.ts').includes('NÃO EDITAR À MÃO')).toBe(true)
  })
})

describe('2. o prompt novo preserva integralmente o legado', () => {
  const p = construirPromptRubricas()
  it('o legado é um PREFIXO exato do prompt novo', () => {
    expect(p.startsWith(PROMPT_FICHES_LEGADO)).toBe(true)
    expect(p).toBe(`${PROMPT_FICHES_LEGADO}\n\n${BLOCO_RUBRICAS}`)
  })
  it('todas as chaves legadas do exemplo continuam lá (e são várias)', () => {
    const ks = chavesLegadasDoPrompt()
    expect(ks.length).toBeGreaterThan(20)
    for (const k of ['tipo', 'periode', 'moisIndex', 'annee', 'netPaye', 'salairebrut', 'totalCotisations', 'interessement', 'primeExceptionnelle',
      'participationSalariale', 'autresPrimes', 'remboursementFrais', 'entreprise', 'conducteur', 'joursConges', 'montantConges', 'joursFeries',
      'montantFeries', 'joursRC', 'montantRC', 'totalHeures', 'hbase', 'hval', 'h25', 'lim25', 'h50']) {
      expect(ks.includes(k)).toBe(true)
      expect(p.includes(`"${k}"`)).toBe(true)
    }
  })
  it('as regras legadas (net payé após PAS, não fundir primes, «mets 0») continuam no texto', () => {
    expect(p.includes('NE PAS soustraire le PAS')).toBe(true)
    expect(p.includes('Ne fusionne jamais intéressement/participation/primes exceptionnelles dans netPaye.')).toBe(true)
    expect(p.includes('mets 0')).toBe(true)
  })
})

describe('3. o bloco novo pede o que a 2C exige', () => {
  it('chaves novas: versionPrompt, nbLignes, totaux, lignes, fin (fin por último)', () => {
    expect(CHAVES_DETALHADAS[CHAVES_DETALHADAS.length - 1]).toBe('fin')
    for (const k of CHAVES_DETALHADAS) expect(BLOCO_RUBRICAS.includes(`"${k}"`) || BLOCO_RUBRICAS.includes(k)).toBe(true)
    expect(BLOCO_RUBRICAS.includes(`"versionPrompt":"${VERSAO_PROMPT_RUBRICAS}"`)).toBe(true)
    expect(BLOCO_RUBRICAS.includes('"fin":true')).toBe(true)
  })
  it('campos de cada linha: libelle, quantite, taux, base, montant, colonne, periode, categorie', () => {
    for (const k of ['"n"', '"libelle"', '"quantite"', '"unite"', '"taux"', '"base"', '"montant"', '"colonne"', '"periode"', '"categorie"', '"sousCategorie"', '"confiance"'])
      expect(BLOCO_RUBRICAS.includes(k)).toBe(true)
  })
  it('uma linha por rubrica, ordem original, sem fundir iguais', () => {
    expect(BLOCO_RUBRICAS.includes('UNE entrée par rubrique imprimée')).toBe(true)
    expect(BLOCO_RUBRICAS.includes('dans l\'ordre d\'impression')).toBe(true)
    expect(BLOCO_RUBRICAS.includes('deux lignes au libellé identique sont deux entrées')).toBe(true)
    expect(BLOCO_RUBRICAS.includes('JAMAIS')).toBe(true)
  })
  it('libellé exato, números JSON, negativos pelo sinal impresso, sem inventar', () => {
    expect(BLOCO_RUBRICAS.includes('copie exacte')).toBe(true)
    expect(BLOCO_RUBRICAS.includes('NOMBRES JSON')).toBe(true)
    expect(BLOCO_RUBRICAS.includes('1234.56')).toBe(true)
    expect(BLOCO_RUBRICAS.includes('-12.5')).toBe(true)
    expect(BLOCO_RUBRICAS.includes('Jamais 0')).toBe(true)
    expect(BLOCO_RUBRICAS.includes('Ne calcule rien')).toBe(true)
  })
  it('as categorias são SUGESTÕES (nunca confirmações) e cobrem as 13 categorias da 2A', () => {
    expect(BLOCO_RUBRICAS.includes('SUGGESTION non vérifiée')).toBe(true)
    expect(BLOCO_RUBRICAS.toLowerCase().includes('confirm')).toBe(false)
    for (const c of CATEGORIAS_RUBRICA) expect(BLOCO_RUBRICAS.includes(c)).toBe(true)
  })
  it('adapta-se ao documento e não presume nenhuma configuração de contrato', () => {
    expect(BLOCO_RUBRICAS.includes("Adapte-toi à CE document")).toBe(true)
    expect(BLOCO_RUBRICAS.includes("N'assume aucune configuration de contrat")).toBe(true)
  })
  it('sem valores de contrato fixos no bloco novo nem nos módulos novos', () => {
    const proibido = /\b(152|169|151[.,]67|17\s?h)\b/
    expect(proibido.test(BLOCO_RUBRICAS)).toBe(false)
    for (const f of ['promptRubricas.ts', 'completudeRubricas.ts', 'extracaoRubricas.ts', 'rubricas.ts'])
      expect(proibido.test(lerFonte(`src/utils/${f}`))).toBe(false)
  })
})

describe('4. limites do proxy Netlify', () => {
  it('as constantes espelham o validarPedido.js e o anthropic-proxy.js reais', () => {
    expect(LIMITE_TEXTO_PROXY).toBe(vp.MAX_TEXTO)
    expect(LIMITE_SYSTEM_PROXY).toBe(vp.MAX_SYSTEM)
    const proxy = lerFonte('netlify/functions/anthropic-proxy.js')
    expect(proxy.includes(`body.model !== '${MODELO_PROXY}'`)).toBe(true)
    expect(proxy.includes(`body.max_tokens > ${MAX_TOKENS_PROXY}`)).toBe(true)
  })
  it('o prompt detalhado cabe no bloco de texto (≤ 8000) e o system (≤ 500)', () => {
    const p = construirPromptRubricas()
    expect(p.length).toBeLessThanOrEqual(LIMITE_TEXTO_PROXY)
    expect(SYSTEM_EXTRACAO_LEGADO.length).toBeLessThanOrEqual(LIMITE_SYSTEM_PROXY)
    expect(verificarLimitesPrompt()).toEqual([])
    expect(LIMITE_TEXTO_PROXY - p.length).toBeGreaterThan(500) // folga para evoluir o prompt
  })
  it('verificarLimitesPrompt deteta excessos', () => {
    expect(verificarLimitesPrompt('x'.repeat(LIMITE_TEXTO_PROXY + 1)).length).toBe(1)
    expect(verificarLimitesPrompt('ok', 'y'.repeat(LIMITE_SYSTEM_PROXY + 1)).length).toBe(1)
  })
  it('o pedido detalhado (imagem ou PDF) passa no validarPedido real', () => {
    for (const b of [img, pdf]) {
      const body = construirPedidoRubricas(b)
      expect(vp.validarPedido(body)).toBeNull()
      expect(body.max_tokens).toBe(MAX_TOKENS_DETALHADO)
      expect(body.max_tokens).toBeLessThanOrEqual(MAX_TOKENS_PROXY)
      expect(body.model).toBe(MODELO_PROXY)
    }
  })
  it('o pedido legado (fallback futuro) também passa e mantém 3500 tokens', () => {
    const body = construirPedidoLegado([img])
    expect(vp.validarPedido(body)).toBeNull()
    expect(body.max_tokens).toBe(3500)
    expect(body.messages[0].content[body.messages[0].content.length - 1]).toEqual({ type: 'text', text: PROMPT_FICHES_LEGADO })
  })
  it('uma fiche por pedido: 1 ficheiro + «Document 1 de 1.» + prompt', () => {
    const c = construirPedidoRubricas(img).messages[0].content
    expect(c.length).toBe(3)
    expect(c[0]).toEqual(img)
    expect(c[1]).toEqual({ type: 'text', text: 'Document 1 de 1.' })
    expect((c[2] as { text: string }).text).toBe(construirPromptRubricas())
    expect(construirPedidoRubricas(img).messages.length).toBe(1)
  })
  it('chaves do corpo aceites pelo proxy (sem prefill nem chaves extra)', () => {
    expect(Object.keys(construirPedidoRubricas(img)).sort()).toEqual(['max_tokens', 'messages', 'model', 'system'])
  })
})

describe('5. módulo puro e isolado', () => {
  it('sem rede, sem armazenamento, sem aprendizagem', () => {
    for (const f of ['promptRubricas.ts', 'completudeRubricas.ts', 'extracaoRubricas.ts']) {
      const src = lerFonte(`src/utils/${f}`)
      expect(/\bfetch\(|AsyncStorage|SecureStore|XMLHttpRequest|aprendizagem|actualizarPadrao|fiche\.tsx['"]/.test(src.replace(/\/\/.*$/gm, ''))).toBe(false)
    }
  })
})
