// src/assistente/preferencia.test.ts
import {
  CHAVE_ASSISTENTE_ATIVO, ASSISTENTE_ATIVO_POR_DEFEITO, interpretarAtivo, lerAssistenteAtivo, gravarAssistenteAtivo,
  subscreverAssistente, botaoFlutuanteVisivel, type ArmazenamentoSimples,
} from './preferencia'

function armazenamento(inicial: Record<string, string> = {}) {
  const dados = { ...inicial }
  const escritas: string[] = []
  const s: ArmazenamentoSimples = {
    getItem: async k => (k in dados ? dados[k] : null),
    setItem: async (k, v) => { escritas.push(k); dados[k] = v },
  }
  return { s, dados, escritas }
}

describe('valor por defeito e interpretação', () => {
  it('instalações existentes (chave ausente) → ativado, para o botão já apresentado não desaparecer', async () => {
    expect(ASSISTENTE_ATIVO_POR_DEFEITO).toBe(true)
    expect(await lerAssistenteAtivo(armazenamento().s)).toBe(true)
  })
  it('só o valor explícito "false" desativa (mesmo padrão do rappel de saisie)', () => {
    expect(interpretarAtivo(null)).toBe(true)
    expect(interpretarAtivo(undefined)).toBe(true)
    expect(interpretarAtivo('true')).toBe(true)
    expect(interpretarAtivo('')).toBe(true)
    expect(interpretarAtivo('lixo')).toBe(true)
    expect(interpretarAtivo('false')).toBe(false)
  })
  it('falha ao ler o armazenamento → ativado (nunca esconde o botão por erro)', async () => {
    const s = { getItem: async () => { throw new Error('x') } }
    expect(await lerAssistenteAtivo(s)).toBe(true)
  })
})

describe('persistência', () => {
  it('desativar e ativar gravam "false"/"true" na ÚNICA chave assistente_ativo', async () => {
    const a = armazenamento()
    expect(await gravarAssistenteAtivo(a.s, false)).toBe(true)
    expect(a.dados[CHAVE_ASSISTENTE_ATIVO]).toBe('false')
    expect(await lerAssistenteAtivo(a.s)).toBe(false)
    expect(await gravarAssistenteAtivo(a.s, true)).toBe(true)
    expect(a.dados[CHAVE_ASSISTENTE_ATIVO]).toBe('true')
    expect(await lerAssistenteAtivo(a.s)).toBe(true)
    expect(Array.from(new Set(a.escritas))).toEqual([CHAVE_ASSISTENTE_ATIVO])
  })
  it('preferência guardada sobrevive a uma nova leitura (reabrir a app)', async () => {
    const a = armazenamento()
    await gravarAssistenteAtivo(a.s, false)
    const reaberta = armazenamento(a.dados) // novo «arranque» com os mesmos dados
    expect(await lerAssistenteAtivo(reaberta.s)).toBe(false)
  })
  it('um reset total (chave apagada) volta ao valor por defeito', async () => {
    const a = armazenamento({ [CHAVE_ASSISTENTE_ATIVO]: 'false' })
    delete a.dados[CHAVE_ASSISTENTE_ATIVO]
    expect(await lerAssistenteAtivo(a.s)).toBe(true)
  })
  it('falha ao gravar: devolve false e NÃO notifica ninguém', async () => {
    const recebidos: boolean[] = []
    const parar = subscreverAssistente(v => recebidos.push(v))
    const mau = { setItem: async () => { throw new Error('disco cheio') } }
    expect(await gravarAssistenteAtivo(mau, false)).toBe(false)
    expect(recebidos).toEqual([])
    parar()
  })
})

describe('sincronização Réglages ↔ Home sem reiniciar', () => {
  it('quem grava notifica todos os ouvintes (Home e página) com o novo valor', async () => {
    const a = armazenamento()
    const home: boolean[] = []
    const pagina: boolean[] = []
    const p1 = subscreverAssistente(v => home.push(v))
    const p2 = subscreverAssistente(v => pagina.push(v))
    await gravarAssistenteAtivo(a.s, false)
    await gravarAssistenteAtivo(a.s, true)
    expect(home).toEqual([false, true])
    expect(pagina).toEqual([false, true])
    p1(); p2()
  })
  it('depois de cancelar a subscrição já não recebe; um ouvinte com erro não impede os outros', async () => {
    const a = armazenamento()
    const recebidos: boolean[] = []
    const parar = subscreverAssistente(v => recebidos.push(v))
    const pararMau = subscreverAssistente(() => { throw new Error('boom') })
    await gravarAssistenteAtivo(a.s, false)
    parar()
    await gravarAssistenteAtivo(a.s, true)
    expect(recebidos).toEqual([false])
    pararMau()
  })
})

describe('visibilidade do botão flutuante na Home', () => {
  it('ativado e sem teclado → visível', () => { expect(botaoFlutuanteVisivel({ ativo: true, tecladoAberto: false })).toBe(true) })
  it('desativado → escondido', () => { expect(botaoFlutuanteVisivel({ ativo: false, tecladoAberto: false })).toBe(false) })
  it('ainda não lido (null) → escondido, sem «piscar»', () => { expect(botaoFlutuanteVisivel({ ativo: null, tecladoAberto: false })).toBe(false) })
  it('com teclado aberto → escondido', () => { expect(botaoFlutuanteVisivel({ ativo: true, tecladoAberto: true })).toBe(false) })
  it('ativar nas Réglages mostra o botão; desativar esconde-o (fluxo completo)', async () => {
    const a = armazenamento({ [CHAVE_ASSISTENTE_ATIVO]: 'false' })
    let ativo: boolean | null = await lerAssistenteAtivo(a.s)
    const parar = subscreverAssistente(v => { ativo = v })
    expect(botaoFlutuanteVisivel({ ativo, tecladoAberto: false })).toBe(false)
    await gravarAssistenteAtivo(a.s, true)
    expect(botaoFlutuanteVisivel({ ativo, tecladoAberto: false })).toBe(true)
    await gravarAssistenteAtivo(a.s, false)
    expect(botaoFlutuanteVisivel({ ativo, tecladoAberto: false })).toBe(false)
    parar()
  })
})
