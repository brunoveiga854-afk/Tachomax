// src/utils/completudeRubricas.test.ts — Etapa 2C: completude ESTRUTURAL (não prova leitura completa)
import { avaliarCompletudeExtracao, lerRespostaAPI, AVISO_GARANTIA, type ResultadoCompletude } from './completudeRubricas'
import { PERFIL_A, PERFIL_B, PERFIL_C, PERFIS, montarFicheDetalhada, textoResposta, type Obj, type PerfilFicticio } from './rubricasFixtures'

const cod = (r: ResultadoCompletude | { motivos: { codigo: string }[] }) => r.motivos.map(m => m.codigo)
const completo = (p: PerfilFicticio, o = {}) => textoResposta([montarFicheDetalhada(p, o)])
const aval = (texto: string, stop: string | null = 'end_turn') => avaliarCompletudeExtracao({ texto, stopReason: stop })

describe('1. extrações estruturalmente completas', () => {
  it('os 3 perfis (com e sem equivalência) dão «completo_estrutural», nunca «completo»', () => {
    for (const p of PERFIS) {
      const r = aval(completo(p))
      expect(r.estado).toBe('completo_estrutural')
      expect(r.jsonValido).toBe(true)
      expect(r.documentos.length).toBe(1)
      expect(r.documentos[0].completude.estado).toBe('completo_estrutural')
      expect(r.documentos[0].completude.parcial).toBe(false)
      expect(r.documentos[0].completude.nLinhas).toBe(p.linhas.length)
      expect(r.documentos[0].completude.nbLinhasDeclarado).toBe(p.linhas.length)
    }
  })
  it('NUNCA garante leitura completa: garantiaLeituraCompleta é sempre false e o aviso acompanha o resultado', () => {
    for (const p of PERFIS) {
      const r = aval(completo(p))
      expect(r.garantiaLeituraCompleta).toBe(false)
      expect(r.documentos[0].completude.garantiaLeituraCompleta).toBe(false)
      expect(r.aviso).toBe(AVISO_GARANTIA)
      expect(r.aviso.includes('NÃO garante')).toBe(true)
    }
  })
  it('LIMITE ASSUMIDO: uma resposta coerente mas a que faltam rubricas impressas continua «completo_estrutural»', () => {
    // a IA «esqueceu» 4 das 9 linhas do perfil A mas declarou nbLignes certo para as 5 que devolveu e fechou com fin:true
    const curto: PerfilFicticio = { ...PERFIL_A, linhas: PERFIL_A.linhas.slice(0, 5) }
    const r = aval(completo(curto))
    expect(r.estado).toBe('completo_estrutural')
    expect(r.garantiaLeituraCompleta).toBe(false)
    expect(r.documentos[0].completude.nLinhas).toBe(5)
  })
  it('texto à volta e cercas ```json não são truncagem (só informação)', () => {
    const r = aval('Voici:\n```json\n' + completo(PERFIL_B) + '\n```\nVoilà.')
    expect(r.estado).toBe('completo_estrutural')
    expect(cod(r)).toContain('texto_fora_do_json')
  })
  it('uma resposta de objeto único (sem array) também é avaliada', () => {
    const r = aval(JSON.stringify(montarFicheDetalhada(PERFIL_C)))
    expect(r.estado).toBe('completo_estrutural')
    expect(r.documentos.length).toBe(1)
  })
})

describe('2. stop_reason', () => {
  it('max_tokens ⇒ incompleto, mesmo com JSON válido e fin:true', () => {
    const r = aval(completo(PERFIL_A), 'max_tokens')
    expect(r.estado).toBe('incompleto')
    expect(cod(r)).toContain('stop_reason_max_tokens')
    expect(r.documentos[0].completude.estado).toBe('incompleto')
    expect(r.documentos[0].completude.stopReason).toBe('max_tokens')
  })
  it('stop_reason inesperado (ex.: refusal) ⇒ incompleto', () => {
    expect(aval(completo(PERFIL_A), 'refusal').estado).toBe('incompleto')
  })
  it('stop_reason ausente: continua estrutural, com nota informativa', () => {
    const r = avaliarCompletudeExtracao({ texto: completo(PERFIL_A) })
    expect(r.estado).toBe('completo_estrutural')
    expect(cod(r.documentos[0].completude)).toContain('stop_reason_nao_fornecido')
  })
  it('max_tokens sem JSON nenhum ⇒ incompleto (não «desconhecido»)', () => {
    expect(aval('Voici les rubriques que j', 'max_tokens').estado).toBe('incompleto')
  })
})

describe('3. fin, nbLignes e numeração', () => {
  it('sem «fin» ⇒ incompleto', () => {
    const r = aval(completo(PERFIL_A, { omitirFin: true }))
    expect(r.estado).toBe('incompleto')
    expect(cod(r.documentos[0].completude)).toContain('fin_ausente')
  })
  it('fin diferente de true ⇒ incompleto', () => {
    const d = montarFicheDetalhada(PERFIL_A); d.fin = false
    const r = aval(textoResposta([d]))
    expect(r.estado).toBe('incompleto')
    expect(cod(r.documentos[0].completude)).toContain('fin_invalido')
  })
  it('nbLignes ≠ nº de linhas ⇒ incompleto', () => {
    const r = aval(completo(PERFIL_A, { nbLignes: PERFIL_A.linhas.length + 3 }))
    expect(r.estado).toBe('incompleto')
    expect(cod(r.documentos[0].completude)).toContain('contagem_diferente')
  })
  it('nbLignes ausente ⇒ «desconhecido» (a contagem não se pode verificar)', () => {
    const r = aval(completo(PERFIL_A, { omitirNbLignes: true }))
    expect(r.estado).toBe('desconhecido')
    expect(cod(r.documentos[0].completude)).toContain('nbLignes_ausente')
  })
  const comLinhas = (alterar: (ls: Obj[]) => void) => {
    const d = montarFicheDetalhada(PERFIL_A)
    alterar(d.lignes as Obj[])
    return aval(textoResposta([d]))
  }
  it('numeração duplicada ⇒ incompleto', () => {
    const r = comLinhas(ls => { ls[3].n = 3 })
    expect(r.estado).toBe('incompleto')
    expect(cod(r.documentos[0].completude)).toContain('numeracao_duplicada')
  })
  it('numeração com buraco (1,2,4…) ⇒ incompleto', () => {
    const r = comLinhas(ls => { ls.forEach((l, i) => { if (i >= 2) l.n = i + 2 }) })
    expect(r.estado).toBe('incompleto')
    expect(cod(r.documentos[0].completude)).toContain('numeracao_descontinua')
  })
  it('numeração fora de ordem ⇒ incompleto', () => {
    const r = comLinhas(ls => { ls[1].n = 3; ls[2].n = 2 })
    expect(r.estado).toBe('incompleto')
    expect(cod(r.documentos[0].completude)).toContain('numeracao_descontinua')
  })
  it('«n» em falta ⇒ «desconhecido»; «n» inválido ⇒ incompleto', () => {
    const a = comLinhas(ls => { delete ls[0].n })
    expect(a.estado).toBe('desconhecido')
    expect(cod(a.documentos[0].completude)).toContain('numeracao_ausente')
    const b = comLinhas(ls => { ls[0].n = 'um' })
    expect(b.estado).toBe('incompleto')
    expect(cod(b.documentos[0].completude)).toContain('numeracao_invalida')
  })
  it('linha que não é objeto ⇒ incompleto', () => {
    const r = comLinhas(ls => { (ls as unknown[])[2] = 'texto' })
    expect(r.estado).toBe('incompleto')
    expect(cod(r.documentos[0].completude)).toContain('linha_invalida')
  })
})

describe('4. lignes[] ausente, vazia e respostas sem JSON', () => {
  it('resposta no formato legado (sem lignes) ⇒ incompleto', () => {
    const r = aval(completo(PERFIL_A, { semDetalhe: true }))
    expect(r.estado).toBe('incompleto')
    expect(cod(r.documentos[0].completude)).toContain('lignes_ausentes')
  })
  it('lignes vazia com nbLignes 0 e fin:true ⇒ «desconhecido» (zero linhas não é prova de nada)', () => {
    const vazio: PerfilFicticio = { ...PERFIL_A, linhas: [] }
    const r = aval(completo(vazio))
    expect(r.estado).toBe('desconhecido')
    expect(cod(r.documentos[0].completude)).toContain('zero_linhas')
  })
  it('texto vazio, null ou sem JSON ⇒ «desconhecido»', () => {
    expect(avaliarCompletudeExtracao({ texto: null }).estado).toBe('desconhecido')
    expect(avaliarCompletudeExtracao({ texto: '   ' }).estado).toBe('desconhecido')
    expect(aval('Désolé, je ne peux pas lire ce document.').estado).toBe('desconhecido')
    expect(aval('[]').estado).toBe('desconhecido')
  })
  it('JSON inválido (vírgula a mais) ⇒ incompleto, linhas completas conservadas', () => {
    const t = completo(PERFIL_B).replace('"fin":true', '"fin":true,')
    const r = aval(t)
    expect(r.jsonValido).toBe(false)
    expect(r.estado).toBe('incompleto')
    expect(cod(r)).toContain('json_invalido')
  })
  it('elemento do array que não é objeto é registado, nunca descartado em silêncio', () => {
    const r = aval(JSON.stringify([montarFicheDetalhada(PERFIL_A), 'lixo', 7]))
    expect(r.ignorados.length).toBe(2)
    expect(r.estado).toBe('incompleto')
    expect(r.documentos.length).toBe(1)
  })
})

describe('5. truncagem em cinco pontos diferentes (+ todos os prefixos)', () => {
  const t = completo(PERFIL_A)
  const todas = (PERFIL_A.linhas).map((l, i) => ({ n: i + 1, ...l }))
  const cortar = (idx: number) => aval(t.slice(0, idx), 'max_tokens')
  const semStop = (idx: number) => aval(t.slice(0, idx), 'end_turn')

  it('ponto 1 — a meio dos campos legados: nada recuperável, incompleto', () => {
    const r = cortar(t.indexOf('"netPaye"') + 6)
    expect(r.estado).toBe('incompleto')
    expect(r.documentos.length).toBe(0)
    expect(cod(r)).toContain('nada_recuperavel')
  })
  it('ponto 2 — logo depois de «"lignes":[»: documento parcial sem linhas', () => {
    const r = semStop(t.indexOf('"lignes":[') + '"lignes":['.length)
    expect(r.estado).toBe('incompleto')
    expect(r.documentos.length).toBe(1)
    expect(r.documentos[0].completude.parcial).toBe(true)
    expect(r.documentos[0].resposta.lignes).toEqual([])
    expect(r.documentos[0].resposta.periode).toBe('Mars 2026') // campos legados antes de lignes recuperados
  })
  it('ponto 3 — a meio da 4.ª linha: só as 3 completas, a linha cortada NÃO aparece', () => {
    const r = semStop(t.indexOf('"libelle":"Heures supplémentaires 50%"') + 12)
    expect(r.estado).toBe('incompleto')
    expect(r.documentos[0].resposta.lignes).toEqual(todas.slice(0, 3))
    expect(r.documentos[0].completude.nLinhas).toBe(3)
    expect(r.documentos[0].completude.nbLinhasDeclarado).toBe(PERFIL_A.linhas.length)
  })
  it('ponto 4 — entre duas linhas completas (após «},»): conserva as 5 primeiras', () => {
    const marca = JSON.stringify(todas[4])
    const r = semStop(t.indexOf(marca) + marca.length + 1)
    expect(r.estado).toBe('incompleto')
    expect(r.documentos[0].resposta.lignes).toEqual(todas.slice(0, 5))
    expect(cod(r.documentos[0].completude)).toContain('contagem_diferente')
  })
  it('ponto 5 — depois de «]» mas antes de «fin»: TODAS as linhas recuperadas e mesmo assim incompleto', () => {
    const r = semStop(t.indexOf('],"fin":true') + 1)
    expect(r.estado).toBe('incompleto')
    expect(r.documentos[0].resposta.lignes).toEqual(todas)
    expect(cod(r.documentos[0].completude)).toContain('fin_ausente')
  })
  it('ponto 6 — «fin» lido mas sem o «]» final do array de topo: ainda incompleto (JSON inválido)', () => {
    const r = semStop(t.length - 1)
    expect(r.jsonValido).toBe(false)
    expect(r.estado).toBe('incompleto')
    expect(r.documentos[0].resposta.fin).toBe(true)
  })
  it('QUALQUER prefixo do texto (do 0 ao último caractere) NUNCA é «completo_estrutural»', () => {
    for (let k = 0; k < t.length; k++) {
      for (const stop of ['end_turn', 'max_tokens'] as const) {
        const r = aval(t.slice(0, k), stop)
        if (r.estado === 'completo_estrutural') throw new Error(`prefixo ${k}/${t.length} declarado completo`)
        if (r.garantiaLeituraCompleta !== false) throw new Error('garantia deve ser false')
      }
    }
    expect(aval(t).estado).toBe('completo_estrutural')
  })
  it('linhas recuperadas são SEMPRE um prefixo exato das originais (nada inventado) em todos os cortes', () => {
    for (let k = 0; k < t.length; k += 7) {
      const r = aval(t.slice(0, k))
      for (const d of r.documentos) {
        const ls = (d.resposta.lignes ?? []) as unknown[]
        if (JSON.stringify(ls) !== JSON.stringify(todas.slice(0, ls.length))) throw new Error(`corte ${k}: linhas recuperadas não são prefixo`)
        if (d.completude.estado === 'completo_estrutural') throw new Error(`corte ${k}: documento parcial declarado completo`)
      }
    }
  })
})

describe('6. vários documentos', () => {
  it('1.º completo e 2.º truncado: o global é incompleto, o 1.º continua estruturalmente completo', () => {
    const a = textoResposta([montarFicheDetalhada(PERFIL_A), montarFicheDetalhada(PERFIL_B)])
    const r = aval(a.slice(0, a.length - 40))
    expect(r.estado).toBe('incompleto')
    expect(r.documentos.length).toBe(2)
    expect(r.documentos[0].completude.estado).toBe('completo_estrutural')
    expect(r.documentos[1].completude.estado).toBe('incompleto')
    expect(r.documentos[1].completude.parcial).toBe(true)
  })
})

describe('7. lerRespostaAPI', () => {
  it('junta todos os blocos de texto e lê stop_reason', () => {
    const r = lerRespostaAPI({ content: [{ type: 'text', text: 'ab' }, { type: 'tool_use' }, { type: 'text', text: 'cd' }], stop_reason: 'max_tokens' })
    expect(r.texto).toBe('abcd')
    expect(r.stopReason).toBe('max_tokens')
    expect(r.erroApi).toBeNull()
  })
  it('erro da API e entradas inválidas', () => {
    expect(lerRespostaAPI({ error: { message: 'overloaded' } }).erroApi).toBe('overloaded')
    expect(lerRespostaAPI(null).texto).toBeNull()
    expect(lerRespostaAPI({ content: [] }).texto).toBeNull()
  })
})
