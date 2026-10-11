import { reutilizarSeIgual, mesmoEstado, CacheReferencias } from './referencias'

const parse = (raw: string) => JSON.parse(raw)

describe('reutilizarSeIgual', () => {
  it('mesma string bruta → mesma referência (recarga sem alterações)', () => {
    const cache: CacheReferencias = new Map()
    const hits: string[] = []
    const a = reutilizarSeIgual(cache, 'padrao', '{"hval":1,"x":[1,2]}', parse, hits)
    const b = reutilizarSeIgual(cache, 'padrao', '{"hval":1,"x":[1,2]}', parse, hits)
    expect(b).toBe(a)
    expect(hits).toEqual(['padrao'])
  })

  it('string bruta diferente → novo objecto com os dados novos (gravação respeitada)', () => {
    const cache: CacheReferencias = new Map()
    const a = reutilizarSeIgual<any>(cache, 'histSal', '[{"a":1}]', parse)
    const b = reutilizarSeIgual<any>(cache, 'histSal', '[{"a":2}]', parse)
    expect(b).not.toBe(a)
    expect(b[0].a).toBe(2)
    // e a partir daí a nova referência é a que se reutiliza
    expect(reutilizarSeIgual<any>(cache, 'histSal', '[{"a":2}]', parse)).toBe(b)
  })

  it('chaves independentes: mudar uma não invalida as outras', () => {
    const cache: CacheReferencias = new Map()
    const p1 = reutilizarSeIgual(cache, 'padrao', '{"k":1}', parse)
    reutilizarSeIgual(cache, 'histCal', '[1]', parse)
    reutilizarSeIgual(cache, 'histCal', '[1,2]', parse)
    expect(reutilizarSeIgual(cache, 'padrao', '{"k":1}', parse)).toBe(p1)
  })

  it('chave removida (null) → null e depois volta a ler o valor novo', () => {
    const cache: CacheReferencias = new Map()
    reutilizarSeIgual(cache, 'fraisRegles', '{"a":1}', parse)
    expect(reutilizarSeIgual(cache, 'fraisRegles', null, parse)).toBeNull()
    const c = reutilizarSeIgual<any>(cache, 'fraisRegles', '{"a":1}', parse)
    expect(c.a).toBe(1)
  })

  it('parse que falha (null) é memorizado sem re-parse enquanto o bruto não mudar', () => {
    const cache: CacheReferencias = new Map()
    let chamadas = 0
    const parseMau = (_: string) => { chamadas++; return null }
    expect(reutilizarSeIgual(cache, 'x', 'lixo', parseMau)).toBeNull()
    expect(reutilizarSeIgual(cache, 'x', 'lixo', parseMau)).toBeNull()
    expect(chamadas).toBe(1)
    reutilizarSeIgual(cache, 'x', 'lixo2', parseMau)
    expect(chamadas).toBe(2)
  })
})

describe('mesmoEstado', () => {
  it('true quando todos os campos têm a mesma referência/valor', () => {
    const o = { a: 1 }
    expect(mesmoEstado({ p: o, n: 2 }, { p: o, n: 2 })).toBe(true)
  })
  it('false quando uma referência mudou, mesmo com conteúdo igual', () => {
    expect(mesmoEstado({ p: { a: 1 } }, { p: { a: 1 } })).toBe(false)
  })
  it('false quando um valor primitivo mudou', () => {
    const o = {}
    expect(mesmoEstado({ p: o, n: 2 }, { p: o, n: 3 })).toBe(false)
  })
})
