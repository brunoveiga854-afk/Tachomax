import {
  normalizarMatricula, mesmoCamiao, ultimoKmDoCamiao, registarKm, kmDoCamiao,
  kmTotalDoDia, textoTroca, juntarComentario, reclassificar, TrocaCamiao,
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
