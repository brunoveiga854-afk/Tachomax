// src/engine/regras/emCurso.test.ts
import { lerEstadoPersistido, type LeituraEstado, type ServicoEmCurso } from './emCurso'
import { entradaMotorDeJour } from './deJour'

// Instante em hora LOCAL do dispositivo (como a Home grava dateInicio/Date.now()).
const L = (y: number, m: number, d: number, h: number, mi: number, s = 0) => new Date(y, m - 1, d, h, mi, s).getTime()
const T0 = L(2026, 10, 13, 6, 30)

const snap = (o: Record<string, unknown> = {}) => JSON.stringify({
  enService: true, emPausa: false, decouche: false,
  dateInicio: new Date(T0).toISOString(), horaInicio: '06h30', ...o,
})
const emCurso = (l: LeituraEstado): ServicoEmCurso => {
  if (l.tipo !== 'em_curso') throw new Error(`esperado em_curso, veio ${l.tipo}${'motivo' in l ? ' (' + l.motivo + ')' : ''}`)
  return l.servico
}

describe('serviço iniciado (snapshot literal da Home: sem âncoras, só lastBgTick)', () => {
  it('estima pela hora de escrita, marca «aproximada» e avisa', () => {
    const s = emCurso(lerEstadoPersistido(snap({ segServico: 0, segPausaTotal: 0, lastBgTick: T0 }), T0 + 90_000))
    expect(s.jour.segServico).toBe(90)
    expect(s.precisao).toBe('aproximada')
    expect(s.avisos.length).toBeGreaterThan(0)
    expect(s.jour.date).toBe('13/10/2026')
    expect(s.jour.debut).toBe('06h30')
    expect(s.jour.fin).toBeUndefined()
    expect(s.jour.id).toBeUndefined()
  })
})

describe('serviço em curso (autosave com âncoras)', () => {
  it('serviço = base + tempo desde tsInicioServico; precisão ancorada', () => {
    const s = emCurso(lerEstadoPersistido(snap({ segServico: 3600, segServicoBase: 3600, tsInicioServico: T0 + 3600_000, segPausaTotal: 0 }), T0 + 3600_000 + 600_000))
    expect(s.jour.segServico).toBe(4200)
    expect(s.precisao).toBe('ancorada')
    expect(s.emPausa).toBe(false)
    expect(s.jour.segPausa).toBe(0)
  })
  it('decouche → tipo DEC', () => {
    const s = emCurso(lerEstadoPersistido(snap({ decouche: true, segServicoBase: 0, tsInicioServico: T0 }), T0 + 1000))
    expect(s.jour.type).toBe('DEC')
  })
  it('base negativa (desconto da troca) nunca dá serviço negativo', () => {
    const s = emCurso(lerEstadoPersistido(snap({ segServicoBase: -600, tsInicioServico: T0 }), T0 + 100_000))
    expect(s.jour.segServico).toBe(0)
  })
})

describe('pausa iniciada', () => {
  const P = T0 + 7200_000
  const base = { emPausa: true, segServico: 7200, segServicoBase: 7200, tsInicioServico: null, tsPauseInicio: P, segPausa: 0, segPausaTotal: 0 }
  it('serviço congelado e pausa aberta no detalhe até «agora»', () => {
    const s = emCurso(lerEstadoPersistido(snap(base), P + 300_000))
    expect(s.emPausa).toBe(true)
    expect(s.jour.segServico).toBe(7200)
    expect(s.jour.segPausa).toBe(300)
    expect(s.jour.pausasDetalhe).toEqual([{ inicio: P, dur: 300 }])
    expect(s.pausaAbertaInicioMs).toBe(P)
  })
  it('pausas anteriores já fechadas somam-se (segPausaTotal da Home inclui a aberta)', () => {
    const s = emCurso(lerEstadoPersistido(snap({ ...base, segPausa: 120, segPausaTotal: 1020, pausasDia: [{ inicio: T0 + 1000, dur: 900 }] }), P + 120_000))
    // fechadas = 1020 − 120 = 900; aberta = 120 s
    expect(s.jour.segPausa).toBe(900 + 120)
    expect(s.jour.pausasDetalhe).toHaveLength(2)
  })
  it('sem tsPauseInicio usa lastBgTick (aproximado)', () => {
    const s = emCurso(lerEstadoPersistido(snap({ ...base, tsPauseInicio: undefined, lastBgTick: P }), P + 60_000))
    expect(s.precisao).toBe('aproximada')
    expect(s.jour.segPausa).toBe(60)
  })
  it('pausa sem qualquer âncora → inválido (não reconstrói)', () => {
    expect(lerEstadoPersistido(snap({ ...base, tsPauseInicio: undefined }), P + 60_000).tipo).toBe('invalido')
  })
  it('pausa programada já expirada: fecha no fim programado e o serviço retoma aí', () => {
    const fim = P + 600_000
    const s = emCurso(lerEstadoPersistido(snap(base), P + 1200_000, { pausaFimTimestampRaw: String(fim) }))
    expect(s.pausaProgramadaExpirada).toBe(true)
    expect(s.emPausa).toBe(false)
    expect(s.jour.segPausa).toBe(600)
    expect(s.jour.segServico).toBe(7200 + 600)
    expect(s.jour.pausasDetalhe).toEqual([{ inicio: P, dur: 600 }])
  })
  it('pausa programada ainda no futuro: continua aberta', () => {
    const s = emCurso(lerEstadoPersistido(snap(base), P + 100_000, { pausaFimTimestampRaw: String(P + 900_000) }))
    expect(s.emPausa).toBe(true)
  })
})

describe('pausa terminada', () => {
  it('vem de pausasDia; segPausa = segPausaTotal; origem «troca» é preservada', () => {
    const s = emCurso(lerEstadoPersistido(snap({
      segServicoBase: 5000, tsInicioServico: T0 + 5000_000, segPausaTotal: 1500,
      pausasDia: [{ inicio: T0 + 1000_000, dur: 900 }, { inicio: T0 + 2000_000, dur: 600, origem: 'troca' }],
    }), T0 + 5000_000))
    expect(s.jour.segPausa).toBe(1500)
    expect(s.jour.pausasDetalhe).toEqual([{ inicio: T0 + 1000_000, dur: 900 }, { inicio: T0 + 2000_000, dur: 600, origem: 'troca' }])
    expect(s.emPausa).toBe(false)
  })
  it('entradas inválidas em pausasDia são ignoradas com aviso', () => {
    const s = emCurso(lerEstadoPersistido(snap({ segServicoBase: 100, tsInicioServico: T0, pausasDia: [{ inicio: 'x', dur: 5 }, null, { inicio: T0, dur: -1 }, { inicio: T0 + 1000, dur: 60 }] }), T0 + 1000))
    expect(s.jour.pausasDetalhe).toEqual([{ inicio: T0 + 1000, dur: 60 }])
    expect(s.avisos.some(a => a.includes('ignorada'))).toBe(true)
  })
})

describe('snapshots antigos / incompletos', () => {
  it('sem dateInicio → inválido (início real desconhecido)', () => {
    const l = lerEstadoPersistido(JSON.stringify({ enService: true, horaInicio: '06h30', segServico: 100, lastBgTick: T0 }), T0 + 1000)
    expect(l.tipo).toBe('invalido')
  })
  it('sem âncora nenhuma (nem tsInicioServico nem lastBgTick) → inválido', () => {
    expect(lerEstadoPersistido(snap({ segServico: 100 }), T0 + 1000).tipo).toBe('invalido')
  })
  it('sem tempo de serviço → inválido', () => {
    expect(lerEstadoPersistido(snap({ tsInicioServico: T0 }), T0 + 1000).tipo).toBe('invalido')
  })
  it('horaInicio diferente do instante real: usa o instante real e avisa', () => {
    const s = emCurso(lerEstadoPersistido(snap({ horaInicio: '07h00', segServicoBase: 0, tsInicioServico: T0 }), T0 + 1000))
    expect(s.jour.debut).toBe('06h30')
    expect(s.avisos.some(a => a.includes('horaInicio'))).toBe(true)
  })
})

describe('JSON inválido e estados sem serviço', () => {
  it('texto não-JSON', () => { expect(lerEstadoPersistido('{mau', T0).tipo).toBe('invalido') })
  it('array, número, null serializado', () => {
    expect(lerEstadoPersistido('[]', T0).tipo).toBe('invalido')
    expect(lerEstadoPersistido('42', T0).tipo).toBe('invalido')
    expect(lerEstadoPersistido('null', T0).tipo).toBe('invalido')
  })
  it('ausente / vazio → sem_servico', () => {
    expect(lerEstadoPersistido(null, T0)).toEqual({ tipo: 'sem_servico', motivo: 'chave_ausente' })
    expect(lerEstadoPersistido('', T0)).toEqual({ tipo: 'sem_servico', motivo: 'chave_ausente' })
    expect(lerEstadoPersistido(undefined, T0)).toEqual({ tipo: 'sem_servico', motivo: 'chave_ausente' })
  })
  it('enService false → sem_servico', () => {
    expect(lerEstadoPersistido(JSON.stringify({ enService: false }), T0)).toEqual({ tipo: 'sem_servico', motivo: 'servico_nao_ativo' })
  })
  it('início no futuro e serviço ≥24h → inválido', () => {
    expect(lerEstadoPersistido(snap({ segServicoBase: 0, tsInicioServico: T0 }), T0 - 3600_000).tipo).toBe('invalido')
    expect(lerEstadoPersistido(snap({ segServicoBase: 0, tsInicioServico: T0 }), T0 + 25 * 3600_000).tipo).toBe('invalido')
  })
  it('agora inválido → inválido', () => { expect(lerEstadoPersistido(snap(), NaN).tipo).toBe('invalido') })
})

describe('serviço a atravessar a meia-noite', () => {
  it('iniciado às 23h30, consultado às 02h00 do dia seguinte: data = dia de INÍCIO, tempo corrente', () => {
    const ini = L(2026, 10, 12, 23, 30)
    const agora = L(2026, 10, 13, 2, 0)
    const s = emCurso(lerEstadoPersistido(JSON.stringify({ enService: true, dateInicio: new Date(ini).toISOString(), horaInicio: '23h30', segServicoBase: 0, tsInicioServico: ini, segPausaTotal: 0 }), agora))
    expect(s.jour.date).toBe('12/10/2026')
    expect(s.jour.debut).toBe('23h30')
    expect(s.jour.segServico).toBe(150 * 60)
  })
  it('iniciado a 31/12 e consultado a 01/01: o ano é o do início (não o de «agora»)', () => {
    const ini = L(2026, 12, 31, 22, 0)
    const agora = L(2027, 1, 1, 1, 0)
    const s = emCurso(lerEstadoPersistido(JSON.stringify({ enService: true, dateInicio: new Date(ini).toISOString(), segServicoBase: 0, tsInicioServico: ini }), agora))
    expect(s.jour.date).toBe('31/12/2026')
    // e o adaptador resolve o início correto (sem erro de ano) com «agora» já em 2027
    const r = entradaMotorDeJour(s.jour, [], null, { agoraMs: agora })
    expect(r.entrada.inicioServicoMs).toBe(Date.UTC(2026, 11, 31, 22, 0))
    expect(r.entrada.referenciaMs).toBe(Date.UTC(2027, 0, 1, 1, 0))
  })
})

describe('compatibilidade com o adaptador deJour', () => {
  it('o Jour produzido é aceite e gera entrada em curso coerente (início, referência, serviço, pausa aberta)', () => {
    const P = T0 + 7200_000
    const agora = P + 300_000
    const s = emCurso(lerEstadoPersistido(snap({ emPausa: true, segServicoBase: 7200, segServico: 7200, tsInicioServico: null, tsPauseInicio: P, segPausa: 0, segPausaTotal: 0 }), agora))
    const r = entradaMotorDeJour(s.jour, [], 'MIXTE', { agoraMs: agora })
    expect(r.entrada.inicioServicoMs).toBe(Date.UTC(2026, 9, 13, 6, 30))
    expect(r.entrada.referenciaMs).toBe(Date.UTC(2026, 9, 13, 6, 30) + (7200 + 300) * 1000)
    expect(r.entrada.servicoAcumuladoSeg).toBe(7200)
    expect(r.entrada.pausas).toHaveLength(1)
    expect(r.diagnostico.segPausaSemDetalheSeg).toBe(0)
  })
})
