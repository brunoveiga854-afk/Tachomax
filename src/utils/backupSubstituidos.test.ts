// src/utils/backupSubstituidos.test.ts — backup/importação de historique_substituidos
import { mesclarArquivoSubstituidos, validarSubstituidosImportados, CHAVE_SUBSTITUIDOS } from './backupSubstituidos'

const ent = (id: string, em: string, extra: Record<string, unknown> = {}) => ({ id, date: '12/10/2026', debut: '06h00', fin: '10h00', substituidoEm: em, substituidoPor: 'x', origem: 'manual', ...extra })

describe('backup — historique_substituidos', () => {
  it('chave certa', () => { expect(CHAVE_SUBSTITUIDOS).toBe('historique_substituidos') })
  it('backup antigo sem a chave: ausente (importação como antes)', () => {
    expect(validarSubstituidosImportados(undefined)).toEqual({ estado: 'ausente' })
    expect(validarSubstituidosImportados(null)).toEqual({ estado: 'ausente' })
  })
  it('valor que não é array: inválido (ignorado, não aborta)', () => {
    expect(validarSubstituidosImportados({ a: 1 })).toEqual({ estado: 'invalido' })
    expect(validarSubstituidosImportados('x')).toEqual({ estado: 'invalido' })
  })
  it('array válido', () => { expect(validarSubstituidosImportados([]).estado).toBe('ok') })
  it('mescla: acrescenta só o que não existe; entradas actuais intactas e na mesma ordem', () => {
    const atual = [ent('1', 'T1'), ent('2', 'T2', { nota: 'x' })]
    const imp = [ent('2', 'T2'), ent('3', 'T3'), ent('1', 'T9')]   // '2|T2' repetido; '1|T9' é outro evento
    const r = mesclarArquivoSubstituidos(atual, imp)
    expect(r.adicionados).toBe(2)
    expect(r.repetidos).toBe(1)
    expect(r.lista.length).toBe(4)
    expect(JSON.stringify(r.lista.slice(0, 2))).toBe(JSON.stringify(atual))
    expect(r.lista.map((e: any) => `${e.id}|${e.substituidoEm}`)).toEqual(['1|T1', '2|T2', '3|T3', '1|T9'])
  })
  it('importar duas vezes o mesmo backup não duplica', () => {
    const imp = [ent('5', 'T5'), ent('6', 'T6')]
    const a = mesclarArquivoSubstituidos([], imp)
    const b = mesclarArquivoSubstituidos(a.lista, imp)
    expect(b.adicionados).toBe(0)
    expect(b.lista.length).toBe(2)
  })
  it('entradas sem id / não objecto são ignoradas e contadas', () => {
    const r = mesclarArquivoSubstituidos([], [null, 7, 'x', { date: 'y' }, ent('8', 'T8')])
    expect(r.adicionados).toBe(1)
    expect(r.ignorados).toBe(4)
  })
  it('arquivo do telemóvel vazio + backup com entradas: copia todas', () => {
    expect(mesclarArquivoSubstituidos([], [ent('1', 'a'), ent('2', 'b')]).lista.length).toBe(2)
  })
  it('a mescla nunca devolve nada a um «historique»: só devolve a lista do arquivo', () => {
    const r = mesclarArquivoSubstituidos([ent('1', 'a')], [ent('2', 'b')])
    expect(Object.keys(r).sort()).toEqual(['adicionados', 'ignorados', 'lista', 'repetidos'])
  })
})
