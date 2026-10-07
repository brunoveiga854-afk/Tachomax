import {
  normalizarMatricula, mesmoCamiao, ultimoKmDoCamiao, registarKm, kmDoCamiao,
  kmTotalDoDia, textoTroca, juntarComentario, reclassificar, kmFimDoDia,
  parseUltimoCamiao, decidirTrocaNoDemarrer, campoKmIntocado, segServicoDe, TrocaCamiao,
} from './camioes'

const troca = (kmIA: number, kmFA: number, kmIB: number, kmFB: number): TrocaCamiao => ({
  a: { camiao: { type: 'immat', value: 'AB-123-CD' }, kmInicio: kmIA, kmFim: kmFA },
  b: { camiao: { type: 'immat', value: 'EF-456-GH' }, kmInicio: kmIB, kmFim: kmFB },
  segParaPausa: 0,
})

describe('normalizarMatricula', () => {
  it('ignora maiúsculas, espaços e hífens', () => {
    expect(normalizarMatricula('AB-123-CD')).toBe('AB123CD')
    expect(normalizarMatricula('ab123cd')).toBe('AB123CD')
    expect(normalizarMatricula(' ab 123 cd ')).toBe('AB123CD')
  })
  it('números de parque ficam como estão', () => {
    expect(normalizarMatricula('T042')).toBe('T042')
    expect(normalizarMatricula('t-042')).toBe('T042')
  })
  it('vazio, null e undefined dão string vazia', () => {
    expect(normalizarMatricula('')).toBe('')
    expect(normalizarMatricula(null)).toBe('')
    expect(normalizarMatricula(undefined)).toBe('')
  })
})

describe('mesmoCamiao', () => {
  it('formatos diferentes do mesmo camião coincidem', () => {
    expect(mesmoCamiao('AB-123-CD', 'ab 123 cd')).toBe(true)
  })
  it('camiões diferentes não coincidem', () => {
    expect(mesmoCamiao('AB-123-CD', 'EF-456-GH')).toBe(false)
  })
  it('vazio nunca coincide com nada, nem com outro vazio', () => {
    expect(mesmoCamiao('', '')).toBe(false)
    expect(mesmoCamiao('', 'AB-123-CD')).toBe(false)
    expect(mesmoCamiao(null, undefined)).toBe(false)
  })
})

describe('ultimoKmDoCamiao e registarKm', () => {
  it('devolve null quando o camião nunca foi registado', () => {
    expect(ultimoKmDoCamiao({}, 'AB-123-CD')).toBeNull()
    expect(ultimoKmDoCamiao(undefined, 'AB-123-CD')).toBeNull()
    expect(ultimoKmDoCamiao({ AB123CD: 100 }, '')).toBeNull()
  })
  it('regista e lê pela matrícula normalizada', () => {
    const m = registarKm({}, 'ab-123-cd', 1100)
    expect(m).toEqual({ AB123CD: 1100 })
    expect(ultimoKmDoCamiao(m, 'AB 123 CD')).toBe(1100)
  })
  it('actualiza o mesmo camião escrito de outra maneira', () => {
    const m = registarKm({ AB123CD: 1100 }, 'AB-123-CD', 1250)
    expect(m).toEqual({ AB123CD: 1250 })
  })
  it('ignora km vazio, NaN, 0 e negativo', () => {
    const base = { AB123CD: 1100 }
    expect(registarKm(base, 'AB-123-CD', 0)).toEqual(base)
    expect(registarKm(base, 'AB-123-CD', NaN)).toEqual(base)
    expect(registarKm(base, 'AB-123-CD', -5)).toEqual(base)
    expect(registarKm(base, '', 900)).toEqual(base)
  })
  it('não altera o mapa original', () => {
    const base = { AB123CD: 1100 }
    registarKm(base, 'EF-456-GH', 5080)
    expect(base).toEqual({ AB123CD: 1100 })
  })
  it('um valor guardado inválido é tratado como desconhecido', () => {
    expect(ultimoKmDoCamiao({ AB123CD: 0 }, 'AB-123-CD')).toBeNull()
  })
})

describe('kmDoCamiao', () => {
  it('fim menos início', () => { expect(kmDoCamiao(1000, 1100)).toBe(100) })
  it('sem km válidos dá 0', () => {
    expect(kmDoCamiao(0, 1100)).toBe(0)
    expect(kmDoCamiao(1000, 0)).toBe(0)
    expect(kmDoCamiao(1100, 1000)).toBe(0)
    expect(kmDoCamiao(undefined, 1000)).toBe(0)
  })
})

describe('kmTotalDoDia', () => {
  it('sem troca mantém a regra de hoje', () => {
    expect(kmTotalDoDia({ kmInicio: 1000, kmFim: 1100 })).toBe('100')
    expect(kmTotalDoDia({ kmInicio: 1100, kmFim: 1000 })).toBe('100')
    expect(kmTotalDoDia({ kmInicio: 0, kmFim: 0, kmDiarios: 80 })).toBe('80')
    expect(kmTotalDoDia({})).toBe('')
    expect(kmTotalDoDia(null)).toBe('')
  })
  it('com troca soma os dois camiões', () => {
    expect(kmTotalDoDia({ troca: troca(1000, 1100, 5000, 5080) })).toBe('180')
  })
  it('com troca e um dos camiões sem km, conta só o outro', () => {
    expect(kmTotalDoDia({ troca: troca(1000, 1100, 5000, 0) })).toBe('100')
  })
  it('com troca e sem km nenhum, cai para kmDiarios ou vazio', () => {
    expect(kmTotalDoDia({ troca: troca(0, 0, 0, 0), kmDiarios: 150 })).toBe('150')
    expect(kmTotalDoDia({ troca: troca(0, 0, 0, 0) })).toBe('')
  })
  it('um dia sem o campo troca (dia antigo) não é afectado', () => {
    expect(kmTotalDoDia({ kmInicio: 10, kmFim: 25, troca: undefined })).toBe('15')
  })
})

describe('textoTroca', () => {
  it('descreve os dois camiões e o total', () => {
    expect(textoTroca(troca(1000, 1100, 5000, 5080)))
      .toBe('Changement de camion : AB-123-CD 1000→1100 = 100 km + EF-456-GH 5000→5080 = 80 km = 180 km')
  })
  it('sem troca devolve vazio', () => {
    expect(textoTroca(null)).toBe('')
    expect(textoTroca(undefined)).toBe('')
  })
  it('um camião sem km mostra só a matrícula e não escreve o total', () => {
    expect(textoTroca(troca(1000, 1100, 5000, 0)))
      .toBe('Changement de camion : AB-123-CD 1000→1100 = 100 km + EF-456-GH')
  })
  it('matrícula em falta aparece como ?', () => {
    const t = troca(1000, 1100, 5000, 5080)
    t.b.camiao.value = '  '
    expect(textoTroca(t)).toContain('+ ? 5000→5080 = 80 km')
  })
})

describe('juntarComentario', () => {
  it('nota mais texto automático', () => {
    expect(juntarComentario('Panne batterie', 'Changement de camion : X')).toBe('Panne batterie · Changement de camion : X')
  })
  it('só a nota, ou só o texto automático', () => {
    expect(juntarComentario('Panne batterie', '')).toBe('Panne batterie')
    expect(juntarComentario('', 'Changement de camion : X')).toBe('Changement de camion : X')
    expect(juntarComentario(undefined, undefined)).toBe('')
  })
  it('a nota nunca é apagada', () => {
    expect(juntarComentario('Minha nota', 'auto')).toContain('Minha nota')
  })
  it('não repete o texto automático se já está na nota', () => {
    const nota = 'Panne · Changement de camion : X'
    expect(juntarComentario(nota, 'Changement de camion : X')).toBe(nota)
  })
})

describe('reclassificar', () => {
  it('Service não muda nada', () => {
    expect(reclassificar(7200, 6600, 900, 'service')).toEqual({ segServico: 7200, segPausaTotal: 900, movido: 0 })
  })
  it('Pause move para a pausa o serviço contado desde Continuer', () => {
    expect(reclassificar(7200, 6600, 900, 'pause')).toEqual({ segServico: 6600, segPausaTotal: 1500, movido: 600 })
  })
  it('se esteve em pausa o tempo todo (nada contou como serviço), não move nada', () => {
    expect(reclassificar(6600, 6600, 900, 'pause')).toEqual({ segServico: 6600, segPausaTotal: 900, movido: 0 })
  })
  it('nunca deixa o serviço negativo nem move mais do que existe', () => {
    expect(reclassificar(300, 0, 0, 'pause')).toEqual({ segServico: 0, segPausaTotal: 300, movido: 300 })
    expect(reclassificar(300, 900, 0, 'pause')).toEqual({ segServico: 300, segPausaTotal: 0, movido: 0 })
  })
  it('valores inválidos não rebentam', () => {
    expect(reclassificar(NaN, 0, 0, 'pause').movido).toBe(0)
  })
})

describe('kmFimDoDia', () => {
  it('sem troca devolve o kmFim do dia', () => {
    expect(kmFimDoDia({ kmFim: 30500 })).toBe(30500)
  })
  it('sem troca e kmFim indefinido, 0 ou null devolve 0', () => {
    expect(kmFimDoDia({})).toBe(0)
    expect(kmFimDoDia({ kmFim: 0 })).toBe(0)
    expect(kmFimDoDia({ kmFim: null })).toBe(0)
  })
  it('com troca devolve o fim de B e ignora o kmFim do dia (que é o de A)', () => {
    expect(kmFimDoDia({ kmFim: 30400, troca: troca(30000, 30400, 50000, 50400) })).toBe(50400)
  })
  it('com troca e fim de B a 0 ("Passer") devolve 0', () => {
    expect(kmFimDoDia({ kmFim: 30400, troca: troca(30000, 30400, 50000, 0) })).toBe(0)
  })
  it('null ou undefined devolve 0', () => {
    expect(kmFimDoDia(null)).toBe(0)
    expect(kmFimDoDia(undefined)).toBe(0)
  })
})

describe('parseUltimoCamiao', () => {
  it('JSON válido', () => {
    expect(parseUltimoCamiao('{"type":"parc","value":"123"}')).toEqual({ type: 'parc', value: '123' })
    expect(parseUltimoCamiao('{"type":"immat","value":"AB-123-CD"}')).toEqual({ type: 'immat', value: 'AB-123-CD' })
  })
  it('null, undefined ou string vazia dão null', () => {
    expect(parseUltimoCamiao(null)).toBeNull()
    expect(parseUltimoCamiao(undefined)).toBeNull()
    expect(parseUltimoCamiao('')).toBeNull()
  })
  it('JSON partido ou não-objecto dá null', () => {
    expect(parseUltimoCamiao('{mau')).toBeNull()
    expect(parseUltimoCamiao('[1]')).toBeNull()
    expect(parseUltimoCamiao('"x"')).toBeNull()
  })
  it('value em falta, vazio ou sem alfanuméricos dá null', () => {
    expect(parseUltimoCamiao('{"type":"immat"}')).toBeNull()
    expect(parseUltimoCamiao('{"type":"immat","value":""}')).toBeNull()
    expect(parseUltimoCamiao('{"type":"immat","value":" - "}')).toBeNull()
  })
})

describe('decidirTrocaNoDemarrer', () => {
  const mapa = { AB123CD: 1000, EF456GH: 2000 }
  it('mesmo camião dá nada', () => {
    expect(decidirTrocaNoDemarrer({ value: 'AB-123-CD' }, { value: 'AB-123-CD' }, mapa)).toEqual({ accao: 'nada' })
  })
  it('mesmo camião com hífen e minúsculas dá nada', () => {
    expect(decidirTrocaNoDemarrer({ value: 'AB-123-CD' }, { value: 'ab123cd' }, mapa)).toEqual({ accao: 'nada' })
  })
  it('camiões diferentes perguntam, com o km dos dois no mapa', () => {
    expect(decidirTrocaNoDemarrer({ value: 'AB-123-CD' }, { value: 'EF-456-GH' }, mapa)).toEqual({
      accao: 'perguntar', ultimo: 'AB-123-CD', actual: 'EF-456-GH', kmUltimo: 1000, kmActual: 2000,
    })
  })
  it('camião actual sem km no mapa dá kmActual null', () => {
    const d = decidirTrocaNoDemarrer({ value: 'AB-123-CD' }, { value: 'XX-999-YY' }, mapa)
    expect(d).toMatchObject({ accao: 'perguntar', kmActual: null, kmUltimo: 1000 })
  })
  it('sem ultimo dá nada', () => {
    expect(decidirTrocaNoDemarrer(null, { value: 'AB-123-CD' }, mapa)).toEqual({ accao: 'nada' })
    expect(decidirTrocaNoDemarrer(undefined, { value: 'AB-123-CD' }, mapa)).toEqual({ accao: 'nada' })
  })
  it('ultimo vazio dá nada', () => {
    expect(decidirTrocaNoDemarrer({ value: '' }, { value: 'AB-123-CD' }, mapa)).toEqual({ accao: 'nada' })
  })
  it('actual vazio ou null dá nada', () => {
    expect(decidirTrocaNoDemarrer({ value: 'AB-123-CD' }, { value: '' }, mapa)).toEqual({ accao: 'nada' })
    expect(decidirTrocaNoDemarrer({ value: 'AB-123-CD' }, null, mapa)).toEqual({ accao: 'nada' })
  })
  it('mapa null ou undefined não rebenta', () => {
    expect(decidirTrocaNoDemarrer({ value: 'AB-123-CD' }, { value: 'EF-456-GH' }, null))
      .toMatchObject({ accao: 'perguntar', kmUltimo: null, kmActual: null })
    expect(decidirTrocaNoDemarrer({ value: 'AB-123-CD' }, { value: 'EF-456-GH' }, undefined))
      .toMatchObject({ accao: 'perguntar' })
  })
})

describe('campoKmIntocado', () => {
  it('vazio ou 0 é intocado', () => {
    expect(campoKmIntocado(0, 30500)).toBe(true)
    expect(campoKmIntocado(0, 0)).toBe(true)
  })
  it('igual ao pré-preenchido é intocado', () => {
    expect(campoKmIntocado(30500, 30500)).toBe(true)
  })
  it('diferente do pré-preenchido é tocado (inclui pré-preenchido 0)', () => {
    expect(campoKmIntocado(31000, 30500)).toBe(false)
    expect(campoKmIntocado(31000, 0)).toBe(false)
  })
})

describe('segServicoDe', () => {
  const agora = 1_000_000_000_000
  it('base 0 e âncora há 159 s dá 159', () => {
    expect(segServicoDe(0, agora - 159_000, agora)).toBe(159)
  })
  it('base negativa (desconto da troca) e âncora há 456 s dá 297', () => {
    expect(segServicoDe(-159, agora - 456_000, agora)).toBe(297)
  })
  it('base 0 e âncora null dá 0', () => {
    expect(segServicoDe(0, null, agora)).toBe(0)
  })
  it('base 1000 e âncora null dá 1000', () => {
    expect(segServicoDe(1000, null, agora)).toBe(1000)
    expect(segServicoDe(1000, undefined, agora)).toBe(1000)
  })
  it('igual à fórmula antiga para bases positivas', () => {
    const antiga = (b: number, ts: number | null) => (ts == null ? b : b + Math.floor((agora - ts) / 1000))
    for (const b of [0, 1, 600, 4500, 36000]) {
      for (const ts of [null, agora, agora - 1_500, agora - 90_000, agora - 3_600_000]) {
        expect(segServicoDe(b, ts, agora)).toBe(antiga(b, ts))
      }
    }
  })
})
