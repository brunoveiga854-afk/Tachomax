// src/utils/identidadeFicheiro.test.ts — Etapa 2E/E1: identidade estável do ficheiro e limites do hash16 (conteúdos FICTÍCIOS)
import { identidadeFicheiro, PREFIXO_IDENTIDADE } from './identidadeFicheiro'
import { hash16 } from './rubricas'
import { acrescentarDocumentos, lerRubricas, CHAVE_RUBRICAS } from './rubricasStore'
import { normalizarRespostaExtracao } from './rubricas'
import { montarFicheDetalhada, PERFIL_A, PERFIL_B } from './rubricasFixtures'
import type { DocumentoRubricas } from '../types/rubricas'

// gerador pseudo-aleatório determinístico (xorshift32) — os testes não podem ser instáveis
function gerador(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000 } }
const ALFA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const b64 = (rnd: () => number, n: number) => { let s = ''; for (let i = 0; i < n; i++) s += ALFA[Math.floor(rnd() * 64)]; return s }

describe('1. forma e estabilidade', () => {
  it('mesmo conteúdo ⇒ mesma identidade; formato fx1:<tamanho>:<hash>:<amostras>, só hex e números', () => {
    const a = identidadeFicheiro('QUJDREVGRw==')!, b = identidadeFicheiro('QUJDREVGRw==')!
    expect(a.id).toBe(b.id)
    expect(/^fx1:\d+:[0-9a-f]{16}:[0-9a-f]{16}$/.test(a.id)).toBe(true)
    expect(a.id.startsWith(PREFIXO_IDENTIDADE + ':')).toBe(true)
    expect(a.tamanhoBase64).toBe(12); expect(a.criptografico).toBe(false)
  })
  it('valores fixos (regressão): a identidade não pode mudar entre versões, senão perdem-se as ligações guardadas', () => {
    expect(identidadeFicheiro('A')!.hash).toBe(hash16('A'))
    expect(identidadeFicheiro('FICTICIO')!.id).toBe(identidadeFicheiro('FICTICIO')!.id)
    expect(identidadeFicheiro('A')!.id.split(':')[2]).toBe(hash16('A'))
  })
  it('vazio, não-texto e null ⇒ null (nunca lança)', () => {
    for (const v of ['', null, undefined, 42, {}, [], true]) expect(identidadeFicheiro(v)).toBeNull()
  })
  it('uma diferença de um só carácter (início, meio, fim) muda a identidade', () => {
    const base = b64(gerador(7), 20000)
    const ids = new Set<string>([identidadeFicheiro(base)!.id])
    for (const i of [0, 1, 10000, 19998, 19999]) {
      const t = base.slice(0, i) + (base[i] === 'A' ? 'B' : 'A') + base.slice(i + 1)
      ids.add(identidadeFicheiro(t)!.id)
    }
    expect(ids.size).toBe(6)
  })
  it('conteúdos de tamanhos diferentes com o mesmo prefixo têm identidades diferentes', () => {
    const base = b64(gerador(11), 5000)
    expect(identidadeFicheiro(base)!.id === identidadeFicheiro(base + 'A')!.id).toBe(false)
    expect(identidadeFicheiro(base)!.id === identidadeFicheiro(base.slice(0, 4999))!.id).toBe(false)
  })
})

describe('2. colisões do hash16 (64 bits, não criptográfico): avaliação empírica', () => {
  it('60 000 conteúdos aleatórios de tamanhos variados: zero colisões no hash16 e na identidade completa', () => {
    const rnd = gerador(12345); const h = new Set<string>(); const ids = new Set<string>()
    for (let i = 0; i < 60000; i++) { const s = b64(rnd, 20 + Math.floor(rnd() * 400)); h.add(hash16(s)); ids.add(identidadeFicheiro(s)!.id) }
    expect(h.size).toBe(60000); expect(ids.size).toBe(60000)
  })
  it('60 000 conteúdos ESTRUTURADOS (muito parecidos: só muda um contador) — o pior caso para FNV: zero colisões', () => {
    const molde = 'JVBERi0xLjQK' + 'A'.repeat(500)
    const h = new Set<string>()
    for (let i = 0; i < 60000; i++) h.add(hash16(molde + String(i).padStart(6, '0') + molde))
    expect(h.size).toBe(60000)
  })
  it('permutações de blocos (mesma composição, ordem diferente) não colidem', () => {
    const blocos = ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE', 'FFFF', 'GGGG']
    const h = new Set<string>(); let n = 0
    const perm = (arr: string[], pref: string[]) => { if (!arr.length) { h.add(hash16(pref.join(''))); n++; return } arr.forEach((x, i) => perm([...arr.slice(0, i), ...arr.slice(i + 1)], [...pref, x])) }
    perm(blocos, [])
    expect(n).toBe(5040); expect(h.size).toBe(5040)
  })
  it('a probabilidade acidental é desprezável para o uso real (≤ 10^4 ficheiros): n²/2^65', () => {
    const n = 1e4; const p = (n * n) / 2 / Math.pow(2, 64)
    expect(p < 1e-11).toBe(true)
  })
})

describe('3. se HOUVER colisão, o armazém protege os dados (falso conflito, nunca perda)', () => {
  function mockArm() {
    const dados: Record<string, string> = {}
    return { dados, s: { getItem: async (k: string) => (k in dados ? dados[k] : null), setItem: async (k: string, v: string) => { dados[k] = v } } }
  }
  const doc = (p: typeof PERFIL_A, hash: string): DocumentoRubricas => normalizarRespostaExtracao({ ...montarFicheDetalhada(p), hash }, { agora: '2026-10-14T10:00:00.000Z' })
  it('dois ficheiros DIFERENTES que (hipoteticamente) partilhassem a identidade: o primeiro fica, o segundo entra como conflito assinalado', async () => {
    const m = mockArm(); const id = identidadeFicheiro('FICHEIRO-X')!.id
    const a = doc(PERFIL_A, id), b = doc(PERFIL_B, id)
    expect((await acrescentarDocumentos(m.s, [a], { agora: '2026-10-14T10:00:00.000Z' })).estado).toBe('ok')
    const original = JSON.stringify(JSON.parse(m.dados[CHAVE_RUBRICAS]).documentos[0])
    const r = await acrescentarDocumentos(m.s, [b], { agora: '2026-10-14T10:00:00.000Z' })
    expect(r.estado).toBe('ok')
    const l = await lerRubricas(m.s)
    if (l.estado !== 'ok') throw new Error('esperava ok')
    expect(l.armazem.documentos.length).toBe(2)
    expect(JSON.stringify(l.armazem.documentos[0])).toBe(original)
    expect(l.armazem.documentos[1].conflito!.motivo).toBe('conteudo_diferente')
  })
})
