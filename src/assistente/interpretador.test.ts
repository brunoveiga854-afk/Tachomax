// src/assistente/interpretador.test.ts
import {
  normalizarTexto, detetarIdioma, extrairQuantidades, interpretar, interpretadorInterno, interpretacaoDireta,
  type Interpretacao, type IntencaoId,
} from './interpretador'

const intencao = (t: string): IntencaoId | string => {
  const r = interpretar(t)
  return r.tipo === 'intencao' ? r.intencao : r.tipo
}
const comoIntencao = (t: string) => {
  const r = interpretar(t)
  if (r.tipo !== 'intencao') throw new Error(`esperava intenção para «${t}», veio ${r.tipo}`)
  return r
}

describe('normalização', () => {
  it('minúsculas, sem acentos e sem pontuação', () => {
    expect(normalizarTexto("  Jusqu'à QUAND puis-je rouler ?! ")).toBe('jusqu a quand puis je rouler')
    expect(normalizarTexto('Até às 18h30, posso terminar?')).toBe('ate as 18h30 posso terminar')
    expect(normalizarTexto('Condução … descanso–diário')).toBe('conducao descanso diario')
  })
  it('mantém «18:30» e não deixa «:» solto', () => {
    expect(normalizarTexto('Si je finis à 18:30 :')).toBe('si je finis a 18:30')
  })
  it('entradas estranhas não rebentam', () => {
    expect(normalizarTexto(undefined as any)).toBe('')
    expect(normalizarTexto(null as any)).toBe('')
    expect(normalizarTexto('😀😀')).toBe('')
  })
})

describe('idioma', () => {
  it('francês, português e indefinido', () => {
    expect(detetarIdioma(normalizarTexto('Combien de temps de service me reste-t-il ?'))).toBe('fr')
    expect(detetarIdioma(normalizarTexto('Quanto tempo de serviço me resta?'))).toBe('pt')
    expect(detetarIdioma(normalizarTexto('amplitude'))).toBe('indefinido')
  })
})

describe('extração de horas e durações', () => {
  const q = (t: string) => extrairQuantidades(normalizarTexto(t))
  it('horas com pista de hora', () => {
    expect(q('si je finis à 18h30')).toEqual([{ tipo: 'hora', h: 18, m: 30, texto: '18h30' }])
    expect(q('até às 20h')).toEqual([{ tipo: 'hora', h: 20, m: 0, texto: '20h' }])
    expect(q('si je finis à 17:45')).toEqual([{ tipo: 'hora', h: 17, m: 45, texto: '17:45' }])
    expect(q('vers 6h')).toEqual([{ tipo: 'hora', h: 6, m: 0, texto: '6h' }])
    expect(q('jusqu à minuit')).toEqual([{ tipo: 'hora', h: 0, m: 0, texto: 'minuit' }])
    expect(q('até meio dia')).toEqual([{ tipo: 'hora', h: 12, m: 0, texto: 'meio dia' }])
  })
  it('durações inequívocas', () => {
    expect(q('une pause de 30 minutes')).toEqual([{ tipo: 'duracao', min: 30, texto: '30 minutes' }])
    expect(q('pausa de 45 min')).toEqual([{ tipo: 'duracao', min: 45, texto: '45 min' }])
    expect(q('pause de 1h30')).toEqual([{ tipo: 'duracao', min: 90, texto: '1h30' }])
    expect(q('meia hora de pausa')).toEqual([{ tipo: 'duracao', min: 30, texto: 'meia hora' }])
  })
  it('hora e duração na mesma frase', () => {
    const r = q('si je finis à 18h avec 30 min de pause')
    expect(r).toEqual([{ tipo: 'hora', h: 18, m: 0, texto: '18h' }, { tipo: 'duracao', min: 30, texto: '30 min' }])
  })
  it('«18h, 30 min de pause» NÃO junta a hora com a duração', () => {
    expect(q('si je finis à 18h, 30 min de pause')).toEqual([{ tipo: 'hora', h: 18, m: 0, texto: '18h' }, { tipo: 'duracao', min: 30, texto: '30 min' }])
  })
  it('«1h 30 min» conta uma só vez', () => {
    expect(q('pause de 1h 30 min')).toHaveLength(1)
  })
  it('sem contexto, «6h» é ambígua (nunca adivinhada)', () => {
    expect(q('6h')).toEqual([{ tipo: 'ambigua', h: 6, m: 0, texto: '6h' }])
    expect(q('2 heures')).toEqual([{ tipo: 'ambigua', h: 2, m: 0, texto: '2 heures' }])
  })
  it('horas inválidas são ignoradas, nunca corrigidas', () => {
    expect(q('si je finis à 25h')).toEqual([])
    expect(q('às 18h75')).toEqual([]) // «75» minutos é inválido: não se «corrige» para 18h00
  })
})

describe('intenções — francês', () => {
  const casos: Array<[string, IntencaoId]> = [
    ['Quelle amplitude me reste-t-il ?', 'amplitude'],
    ["Jusqu'à quand puis-je travailler ?", 'amplitude'],
    ['Quelle est mon amplitude maximale', 'amplitude'],
    ['Combien de temps de service me reste-t-il ?', 'servico'],
    ['Il me reste combien d’heures de service ?', 'servico'],
    ['mon temps de travail restant', 'servico'],
    ['Quel repos dois-je prendre ?', 'repouso'],
    ['Quand dois-je m’arrêter pour mon repos quotidien ?', 'repouso'],
    ['repos réduit possible ?', 'repouso'],
    ['Combien de pause dois-je faire ?', 'pausas'],
    ['Quelle pause obligatoire ?', 'pausas'],
    ['Ai-je fait assez de pause ?', 'pausas'],
    ["À quelle heure dois-je prendre ma pause ?", 'pausa_limite'],
    ['Avant quelle heure commencer ma pause ?', 'pausa_limite'],
    ['Si je finis à 18h ?', 'simulacao_fim'],
    ['Puis-je rouler jusqu’à 20h ?', 'simulacao_fim'],
    ['et si je termine à 17h30', 'simulacao_fim'],
    ['Quelles sont les règles ?', 'regras'],
    ['Que dit la loi ?', 'regras'],
    ['Quelles sanctions je risque ?', 'sancoes'],
    ['Quelle amende pour un dépassement ?', 'sancoes'],
    ['Quel est mon temps de conduite restant ?', 'conducao'],
    ['Combien de temps puis-je conduire ?', 'conducao'],
    ['Et le chronotachygraphe ?', 'conducao'],
    ['Mon repos hebdomadaire', 'repouso_semanal'],
  ]
  for (const [t, esperado] of casos) it(`«${t}» → ${esperado}`, () => expect(intencao(t)).toBe(esperado))
})

describe('intenções — português', () => {
  const casos: Array<[string, IntencaoId]> = [
    ['Qual é a minha amplitude?', 'amplitude'],
    ['Até quando posso trabalhar?', 'amplitude'],
    ['Quanto tempo de serviço me resta?', 'servico'],
    ['quantas horas de trabalho tenho ainda', 'servico'],
    ['Que descanso devo tirar?', 'repouso'],
    ['Quando tenho de parar para o descanso diário?', 'repouso'],
    ['Quantas pausas devo fazer?', 'pausas'],
    ['Qual a pausa obrigatória?', 'pausas'],
    ['A que horas devo fazer a pausa?', 'pausa_limite'],
    ['Se eu terminar às 18h?', 'simulacao_fim'],
    ['Posso trabalhar até às 20h30?', 'simulacao_fim'],
    ['E se eu parar às 17:30', 'simulacao_fim'],
    ['Quais são as regras?', 'regras'],
    ['O que diz a lei?', 'regras'],
    ['Qual a multa se ultrapassar?', 'sancoes'],
    ['Quais as coimas?', 'sancoes'],
    ['Quanto tempo de condução me resta?', 'conducao'],
    ['E o tacógrafo?', 'conducao'],
    ['descanso semanal', 'repouso_semanal'],
  ]
  for (const [t, esperado] of casos) it(`«${t}» → ${esperado}`, () => expect(intencao(t)).toBe(esperado))
})

describe('parâmetros extraídos', () => {
  it('simulação com hora e pausa', () => {
    const r = comoIntencao('Si je finis à 18h30 avec 30 min de pause ?')
    expect(r.intencao).toBe('simulacao_fim')
    expect(r.horaFim).toEqual({ h: 18, m: 30 })
    expect(r.duracaoMin).toBe(30)
    expect(r.falta).toBeNull()
  })
  it('PT: «Se eu terminar às 17:30»', () => {
    const r = comoIntencao('Se eu terminar às 17:30?')
    expect(r.horaFim).toEqual({ h: 17, m: 30 })
    expect(r.idioma).toBe('pt')
  })
  it('simulação sem hora → reconhecida mas incompleta', () => {
    const r = comoIntencao('Si je finis bientôt ?')
    expect(r.intencao).toBe('simulacao_fim')
    expect(r.horaFim).toBeNull()
    expect(r.falta).toBe('hora_fim')
  })
  it('duas horas → pede uma só', () => {
    const r = comoIntencao('Si je finis à 17h ou à 18h ?')
    expect(r.intencao).toBe('simulacao_fim')
    expect(r.horaFim).toBeNull()
    expect(r.falta).toBe('hora_unica')
  })
  it('hora ambígua → pede esclarecimento', () => {
    const r = comoIntencao('et si 6h')
    expect(r.intencao).toBe('simulacao_fim')
    expect(r.falta).toBe('hora_ou_duracao')
  })
  it('pausa com duração (serviço)', () => {
    const r = comoIntencao('Combien de temps de service si je fais une pause de 45 minutes ?')
    expect(r.duracaoMin).toBe(45)
  })
  it('hora numa pergunta que não a usa fica em «ignoradas» (o ecrã avisa)', () => {
    const r = comoIntencao('Quelle amplitude me reste-t-il à 18h ?')
    expect(r.intencao).toBe('amplitude')
    expect(r.horaFim).toBeNull()
    expect(r.ignoradas).toHaveLength(1)
  })
})

describe('ambiguidade e fora de âmbito — nunca adivinhar', () => {
  it('«Combien de temps me reste-t-il ?» → ambígua (amplitude ou serviço)', () => {
    const r = interpretar('Combien de temps me reste-t-il ?')
    expect(r.tipo).toBe('ambigua')
    if (r.tipo === 'ambigua') { expect(r.candidatas).toContain('amplitude'); expect(r.candidatas).toContain('servico') }
  })
  it('uma palavra solta não escolhe intenção', () => {
    for (const t of ['repos', 'pause', 'service', 'descanso']) {
      const r = interpretar(t)
      expect(r.tipo === 'intencao').toBe(false)
    }
  })
  it('conversa fora do tema → fora de âmbito', () => {
    for (const t of ['Quelle est la météo demain à Cholet ?', 'Qual é a capital de Portugal?', 'Raconte-moi une blague sur les camions', 'asdfgh qwerty']) {
      expect(interpretar(t).tipo).toBe('fora_ambito')
    }
  })
  it('vazio ou só espaços → vazia', () => {
    expect(interpretar('').tipo).toBe('vazia')
    expect(interpretar('   ').tipo).toBe('vazia')
    expect(interpretar('???').tipo).toBe('vazia')
  })
  it('frases muito longas não rebentam e são limitadas', () => {
    const r = interpretar('x '.repeat(5000))
    expect(['fora_ambito', 'ambigua', 'intencao']).toContain(r.tipo)
  })
  it('regras + sanções na mesma pergunta → sanções (a resposta remete para as regras)', () => {
    expect(intencao('Règles et sanctions')).toBe('sancoes')
  })
})

describe('condução e pausa-limite são reconhecidas (para responder «não avaliado»)', () => {
  it('condução FR/PT', () => {
    expect(intencao('Pause de 45 min après 4h30 de conduite ?')).toBe('conducao')
    expect(intencao('Quanto tempo posso conduzir hoje?')).toBe('conducao')
  })
  it('hora-limite de pausa é distinta de «pausas»', () => {
    expect(intencao('Jusqu’à quelle heure puis-je commencer ma pause ?')).toBe('pausa_limite')
    expect(intencao('Combien de pause dois-je faire ?')).toBe('pausas')
  })
})

describe('contrato e interpretação direta', () => {
  it('interpretadorInterno devolve o mesmo que interpretar', async () => {
    const t = 'Si je finis à 18h ?'
    expect(await interpretadorInterno.interpretar(t)).toEqual(interpretar(t))
  })
  it('interpretação direta (cartões rápidos) não tem texto nem faltas', () => {
    const r = interpretacaoDireta('pausas') as Extract<Interpretacao, { tipo: 'intencao' }>
    expect(r.tipo).toBe('intencao')
    expect(r.intencao).toBe('pausas')
    expect(r.falta).toBeNull()
    expect(r.horaFim).toBeNull()
  })
  it('é determinístico', () => {
    const t = 'Posso trabalhar até às 20h30 com 30 min de pausa?'
    expect(JSON.stringify(interpretar(t))).toBe(JSON.stringify(interpretar(t)))
  })
})
