import {
  avaliarRegras, avaliarServicoDiario, avaliarPausas, avaliarServicoSemanal, classificarDescansoDiario,
  contarReducoes, instanteMs, intervaloServico, janelaDescansoDiario, minutosNoturnos, parseData, parseHoraMin,
  type ContextoRegulamentar, type EntradaMotor,
} from './index'

const DIA = parseData('13/10/2026')!
const H = (hhmm: string, diaOffset = 0): number => instanteMs(DIA, parseHoraMin(hhmm)!) + diaOffset * 86_400_000
const hh = (h: number) => h * 3600

const CTX: ContextoRegulamentar = { regulamento561: 'sim', enquadramentoFrances: 'sim', categoria: 'grand_routier' }
const base = (o: Partial<EntradaMotor> = {}): EntradaMotor => ({
  contexto: CTX,
  inicioServicoMs: H('06h00'),
  fimDescansoAnterior: { ms: H('06h00'), confirmado: true },
  descansoSeguinte: 'normal',
  confirmacoes: { tempoServicoEquivaleServicoRegulamentar: true },
  ...o,
})

describe('1. serviço às 06h00 com três horas de pausa pretendidas', () => {
  const r = avaliarRegras(base({ pausaPrevistaSeg: hh(3) }))
  it('o serviço sozinho daria 21h00, mas a janela de descanso limita às 19h00', () => {
    const serv = r.restricoes.find(x => x.id === 'servico_diario')!
    expect(serv.fimMaximoMs).toBe(H('21h00'))
    expect(r.restricaoMaisLimitativa!.id).toBe('amplitude_janela_descanso')
    expect(r.resultadoMatematico.fimTeoricoMs).toBe(H('19h00'))
    expect(r.resultadoMatematico.servicoUtilizavelSeg).toBe(hh(10))
  })
  it('é simulação condicionada: cálculo matemático ≠ autorização', () => {
    expect(r.estado).toBe('simulacao_condicionada')
    expect(r.autorizacao).toBe('nao_concedida')
    expect(r.resultadoMatematico.natureza).toBe('calculo_matematico')
    expect(/podes/i.test(r.resumo)).toBe(false)
    expect(r.resumo.includes('não constitui autorização regulamentar')).toBe(true)
  })
  it('a pausa pretendida não é pausa regulamentar confirmada', () => {
    expect(r.pausas!.cumprimento).toBe('depende_de_confirmacao')
    expect(r.pausas!.validasSeg).toBe(0)
  })
})

describe('2. descanso normal de 11h e reduzido de 9h', () => {
  it('classificação', () => {
    expect(classificarDescansoDiario(hh(11))).toBe('normal')
    expect(classificarDescansoDiario(hh(11) - 1)).toBe('reduzido')
    expect(classificarDescansoDiario(hh(9))).toBe('reduzido')
    expect(classificarDescansoDiario(hh(9) - 1)).toBe('insuficiente')
  })
  it('o descanso tem de ser GOZADO nas 24h: início máximo + duração = fim anterior + 24h', () => {
    const n = janelaDescansoDiario({ fimDescansoAnteriorMs: H('06h00'), descansoSeguinte: 'normal', reducoesRestantes: 3 })
    expect(n.fimMaximoServicoMs).toBe(H('19h00'))
    expect(n.fimMaximoServicoMs + hh(11) * 1000).toBe(H('06h00', 1))
    expect(n.amplitudeMaximaSeg).toBe(hh(13))
    const r = janelaDescansoDiario({ fimDescansoAnteriorMs: H('06h00'), descansoSeguinte: 'reduzido', reducoesRestantes: 2 })
    expect(r.fimMaximoServicoMs).toBe(H('21h00'))
    expect(r.fimMaximoServicoMs + hh(9) * 1000).toBe(H('06h00', 1))
    expect(r.amplitudeMaximaSeg).toBe(hh(15))
  })
  it('13h ou 15h dependem do descanso pretendido, não do descanso anterior', () => {
    const e = base({ reducoes: contarReducoes({ descansos: [], fimUltimoDescansoSemanalMs: H('06h00', -3), historicoCompleto: true }) })
    expect(avaliarRegras({ ...e, descansoSeguinte: 'normal' }).janelasDescanso.normalMs).toBe(H('19h00'))
    expect(avaliarRegras({ ...e, descansoSeguinte: 'reduzido' }).janelasDescanso.reduzidoMs).toBe(H('21h00'))
  })
})

describe('3. três reduções já utilizadas entre dois descansos semanais', () => {
  const sem = H('06h00', -5)
  const red = (i: number) => ({ inicioMs: H('20h00', -4 + i), fimMs: H('20h00', -4 + i) + hh(9.5) * 1000 })
  const cont = contarReducoes({ descansos: [red(0), red(1), red(2)], fimUltimoDescansoSemanalMs: sem, historicoCompleto: true })
  it('conta 3 e já não restam reduções', () => {
    expect(cont.utilizadas).toBe(3)
    expect(cont.restantes).toBe(0)
    expect(cont.estado).toBe('confirmado')
  })
  it('reduções anteriores ao último descanso semanal não contam', () => {
    const antes = { inicioMs: sem - hh(30) * 1000, fimMs: sem - hh(20.5) * 1000 }
    expect(contarReducoes({ descansos: [antes, red(0)], fimUltimoDescansoSemanalMs: sem, historicoCompleto: true }).utilizadas).toBe(1)
  })
  it('pedir descanso reduzido volta a janela de 13h e avisa', () => {
    const j = janelaDescansoDiario({ fimDescansoAnteriorMs: H('06h00'), descansoSeguinte: 'reduzido', reducoesRestantes: 0 })
    expect(j.reducaoPedidaIndisponivel).toBe(true)
    expect(j.descansoUsado).toBe('normal')
    expect(j.fimMaximoServicoMs).toBe(H('19h00'))
    const r = avaliarRegras(base({ descansoSeguinte: 'reduzido', reducoes: cont }))
    expect(r.janelasDescanso.reduzidoMs).toBeNull()
    expect(r.restricoes.find(x => x.id === 'amplitude_janela_descanso')!.fimMaximoMs).toBe(H('19h00'))
    expect(r.pressupostos.some(p => p.includes('3 reduções'))).toBe(true)
  })
})

describe('4. serviço noturno entre 00h00 e 05h00', () => {
  it('serviço que começa às 00h00: limite de 10h (não 12h)', () => {
    const a = avaliarServicoDiario({ inicioServicoMs: H('00h00'), referenciaMs: H('00h00'), servicoAcumuladoSeg: 0, pausaPrevistaSeg: 0 })
    expect(a.trabalhoNoturno).toBe(true)
    expect(a.limiteAplicadoSeg).toBe(hh(10))
    expect(a.fimMaximoMs).toBe(H('10h00'))
  })
  it('começar às 22h00 toca a noite: 10h → 08h00', () => {
    const a = avaliarServicoDiario({ inicioServicoMs: H('22h00'), referenciaMs: H('22h00'), servicoAcumuladoSeg: 0, pausaPrevistaSeg: 0 })
    expect(a.fimMaximoMs).toBe(H('08h00', 1))
    expect(a.trabalhoNoturno).toBe(true)
  })
  it('começar às 16h00: 10h → 02h00 (toca a noite)', () => {
    const a = avaliarServicoDiario({ inicioServicoMs: H('16h00'), referenciaMs: H('16h00'), servicoAcumuladoSeg: 0, pausaPrevistaSeg: 0 })
    expect(a.fimMaximoMs).toBe(H('02h00', 1))
  })
  it('começar às 14h00: o máximo sem trabalho noturno termina às 00h00', () => {
    const a = avaliarServicoDiario({ inicioServicoMs: H('14h00'), referenciaMs: H('14h00'), servicoAcumuladoSeg: 0, pausaPrevistaSeg: 0 })
    expect(a.fimMaximoMs).toBe(H('00h00', 1))
    expect(a.trabalhoNoturno).toBe(false)
    expect(a.restanteServicoSeg).toBe(hh(10))
  })
  it('serviço diurno 06h00: 12h e sem noite', () => {
    const a = avaliarServicoDiario({ inicioServicoMs: H('06h00'), referenciaMs: H('06h00'), servicoAcumuladoSeg: 0, pausaPrevistaSeg: 0 })
    expect(a.limiteAplicadoSeg).toBe(hh(12))
    expect(a.trabalhoNoturno).toBe(false)
  })
  it('o limite noturno é aproximação do tempo de trabalho: fica registado como pressuposto', () => {
    const r = avaliarRegras(base({ inicioServicoMs: H('00h00'), fimDescansoAnterior: { ms: H('00h00'), confirmado: true } }))
    expect(r.pressupostos.some(p => p.includes('aproximação por excesso'))).toBe(true)
  })
})

describe('5. serviço que atravessa a meia-noite', () => {
  it('22h00 → 03h30 do dia seguinte', () => {
    const iv = intervaloServico('13/10/2026', '22h00', '03h30')
    expect('motivo' in iv).toBe(false)
    if ('motivo' in iv) return
    expect(iv.atravessaMeiaNoite).toBe(true)
    expect(iv.fimMs).toBe(H('03h30', 1))
    expect((iv.fimMs - iv.inicioMs) / 3_600_000).toBe(5.5)
    expect(minutosNoturnos(iv.inicioMs, iv.fimMs)).toBe(210)
  })
  it('início e fim iguais, ou horas inválidas, não são adivinhados', () => {
    expect('motivo' in intervaloServico('13/10/2026', '06h00', '06h00')).toBe(true)
    expect('motivo' in intervaloServico('13/10/2026', '25h00', '06h00')).toBe(true)
    expect('motivo' in intervaloServico('31/02/2026', '06h00', '07h00')).toBe(true)
  })
  it('minutos noturnos: 00h00–05h00 completos = 300', () => {
    expect(minutosNoturnos(H('00h00'), H('05h00'))).toBe(300)
    expect(minutosNoturnos(H('05h00'), H('12h00'))).toBe(0)
  })
})

describe('6. hora de início ausente', () => {
  it('dados insuficientes, sem hora limite e sem autorização', () => {
    for (const inicio of [null, undefined, NaN]) {
      const r = avaliarRegras(base({ inicioServicoMs: inicio as number | null | undefined }))
      expect(r.estado).toBe('dados_insuficientes')
      expect(r.resultadoMatematico.fimTeoricoMs).toBeNull()
      expect(r.autorizacao).toBe('nao_concedida')
      expect(r.emFalta.includes('hora de início do serviço')).toBe(true)
      expect(/podes/i.test(r.resumo)).toBe(false)
    }
  })
  it('sem o fim do descanso anterior não há hora limite (apenas limite parcial de diagnóstico)', () => {
    const r = avaliarRegras(base({ fimDescansoAnterior: null }))
    expect(r.estado).toBe('dados_insuficientes')
    expect(r.resultadoMatematico.fimTeoricoMs).toBeNull()
    expect(r.limiteParcial!.fimMs).toBe(H('18h00'))
    expect(r.emFalta.includes('fim do descanso anterior')).toBe(true)
  })
  it('descanso anterior a terminar depois do início do serviço: dados incoerentes', () => {
    const r = avaliarRegras(base({ fimDescansoAnterior: { ms: H('07h00'), confirmado: true } }))
    expect(r.estado).toBe('dados_insuficientes')
  })
})

describe('7. categoria regulamentar desconhecida', () => {
  it('semanal não avaliado (a categoria nunca vem de CD/MIXTE/LD); resultado nunca «confirmado»', () => {
    const w = avaliarServicoSemanal({ categoria: 'desconhecida', servicoSemanaSeg: hh(40), semanaCompleta: true })
    expect(w.avaliada).toBe(false)
    expect(w.limiteSeg).toBeNull()
    const r = avaliarRegras(base({ contexto: { ...CTX, categoria: 'desconhecida' }, semana: { servicoSemanaSeg: hh(40), completa: true } }))
    const sem = r.restricoes.find(x => x.id === 'servico_semanal_isolado')!
    expect(sem.avaliada).toBe(false)
    expect(r.estado).toBe('simulacao_condicionada')
    expect(r.autorizacao).toBe('nao_concedida')
    expect(r.emFalta.some(x => x.includes('categoria regulamentar'))).toBe(true)
    expect(r.resultadoMatematico.fimTeoricoMs).toBe(H('18h00'))
  })
  it('categoria conhecida e semana completa: limites distintos de R3312-50 (56h/52h/48h)', () => {
    expect(avaliarServicoSemanal({ categoria: 'grand_routier', servicoSemanaSeg: hh(40), semanaCompleta: true }).restanteSeg).toBe(hh(16))
    expect(avaliarServicoSemanal({ categoria: 'outro_marchandises', servicoSemanaSeg: hh(40), semanaCompleta: true }).restanteSeg).toBe(hh(12))
    expect(avaliarServicoSemanal({ categoria: 'messagerie_fonds', servicoSemanaSeg: hh(40), semanaCompleta: true }).restanteSeg).toBe(hh(8))
  })
  it('as regras de condução e da Diretiva 2002/15 ficam listadas como não avaliadas (53h/48h não se misturam)', () => {
    const r = avaliarRegras(base())
    const ids = r.naoAvaliadas.map(x => x.id)
    expect(ids.includes('conducao_diaria_semanal')).toBe(true)
    expect(ids.includes('diretiva_2002_15_trabalho')).toBe(true)
    expect(ids.includes('servico_medias_r3312_50')).toBe(true)
  })
})

describe('8. histórico incompleto', () => {
  it('sem fim do último descanso semanal: reduções desconhecidas, não confirmadas', () => {
    const c = contarReducoes({ descansos: [{ inicioMs: H('20h00', -2), fimMs: H('20h00', -2) + hh(9.5) * 1000 }], fimUltimoDescansoSemanalMs: null, historicoCompleto: false })
    expect(c.utilizadas).toBe(1)
    expect(c.restantes).toBeNull()
    expect(c.restantesNoMaximo).toBe(2)
    expect(c.estado).toBe('simulacao_condicionada')
    expect(c.emFalta.includes('fim do último descanso semanal')).toBe(true)
  })
  it('já com 3 reduções contadas, o histórico incompleto não pode ter mais disponíveis', () => {
    const red = (i: number) => ({ inicioMs: H('20h00', -4 + i), fimMs: H('20h00', -4 + i) + hh(9.5) * 1000 })
    const c = contarReducoes({ descansos: [red(0), red(1), red(2)], fimUltimoDescansoSemanalMs: null, historicoCompleto: false })
    expect(c.restantes).toBe(0)
  })
  it('pedir reduzido com histórico incompleto é simulação condicionada', () => {
    const c = contarReducoes({ descansos: [], fimUltimoDescansoSemanalMs: null, historicoCompleto: false })
    const r = avaliarRegras(base({ descansoSeguinte: 'reduzido', reducoes: c }))
    expect(r.restricoes.find(x => x.id === 'amplitude_janela_descanso')!.estado).toBe('simulacao_condicionada')
    expect(r.estado).toBe('simulacao_condicionada')
    expect(r.autorizacao).toBe('nao_concedida')
  })
  it('fim do descanso anterior deduzido do histórico (não confirmado) → condicionada', () => {
    const r = avaliarRegras(base({ fimDescansoAnterior: { ms: H('06h00'), confirmado: false } }))
    expect(r.estado).toBe('simulacao_condicionada')
    expect(r.emFalta.includes('confirmação do fim do descanso anterior')).toBe(true)
  })
})

describe('9. pausas cuja natureza não permite confirmar cumprimento', () => {
  const inicio = H('06h00')
  const fim = H('16h00') // 10h de trabalho → exige 45 min
  it('pausa manual sem natureza: não é pausa regulamentar validada', () => {
    const a = avaliarPausas({ inicioMs: inicio, fimReferenciaMs: fim, trabalhoSeg: hh(10), pausas: [{ inicioMs: H('11h00'), durSeg: 45 * 60 }] })
    expect(a.exigidoSeg).toBe(45 * 60)
    expect(a.validasSeg).toBe(0)
    expect(a.naoVerificadasSeg).toBe(45 * 60)
    expect(a.cumprimento).toBe('depende_de_confirmacao')
    expect(a.estado).toBe('simulacao_condicionada')
  })
  it('pausa gerada automaticamente (troca de camião) nunca conta, mesmo com natureza indicada', () => {
    const a = avaliarPausas({ inicioMs: inicio, fimReferenciaMs: fim, trabalhoSeg: hh(10), pausas: [{ inicioMs: H('11h00'), durSeg: 45 * 60, origem: 'troca', natureza: 'livre_confirmada' }] })
    expect(a.validasSeg).toBe(0)
    expect(a.pressupostos.some(p => p.includes('troca de camião'))).toBe(true)
  })
  it('pausas <15 min não contam; pausa livre confirmada de 45 min cumpre', () => {
    const curta = avaliarPausas({ inicioMs: inicio, fimReferenciaMs: fim, trabalhoSeg: hh(10), pausas: [{ inicioMs: H('11h00'), durSeg: 10 * 60, natureza: 'livre_confirmada' }] })
    expect(curta.validasSeg).toBe(0)
    expect(curta.cumprimento).toBe('nao_cumprida')
    const ok = avaliarPausas({ inicioMs: inicio, fimReferenciaMs: fim, trabalhoSeg: hh(10), pausas: [
      { inicioMs: H('10h00'), durSeg: 15 * 60, natureza: 'livre_confirmada' },
      { inicioMs: H('13h00'), durSeg: 30 * 60, natureza: 'livre_confirmada' },
    ] })
    expect(ok.cumprimento).toBe('cumprida')
    expect(ok.periodoSemPausaExcedido).toBe(false)
  })
  it('mais de 6h seguidas sem pausa verificada', () => {
    const a = avaliarPausas({ inicioMs: inicio, fimReferenciaMs: H('14h00'), trabalhoSeg: hh(8), pausas: [] })
    expect(a.maiorPeriodoSemPausaVerificadaSeg).toBe(hh(8))
    expect(a.periodoSemPausaExcedido).toBe(true)
    const b = avaliarPausas({ inicioMs: inicio, fimReferenciaMs: H('14h00'), trabalhoSeg: hh(8), pausas: [{ inicioMs: H('10h00'), durSeg: 30 * 60 }] })
    expect(b.periodoSemPausaExcedido).toBe('depende_de_confirmacao')
  })
  it('trabalho ≤6h: pausa não exigida; 6–9h: 30 min; >9h: 45 min', () => {
    const e = (s: number) => avaliarPausas({ inicioMs: inicio, fimReferenciaMs: inicio + s * 1000, trabalhoSeg: s, pausas: [] }).exigidoSeg
    expect(e(hh(6))).toBe(0)
    expect(e(hh(6) + 1)).toBe(30 * 60)
    expect(e(hh(9))).toBe(30 * 60)
    expect(e(hh(9) + 1)).toBe(45 * 60)
  })
})

describe('10. restrição de serviço mais limitativa do que a amplitude', () => {
  it('descanso reduzido (amplitude até 21h00) mas o serviço de 12h termina às 18h00', () => {
    const reducoes = contarReducoes({ descansos: [], fimUltimoDescansoSemanalMs: H('06h00', -3), historicoCompleto: true })
    const r = avaliarRegras(base({ descansoSeguinte: 'reduzido', reducoes }))
    expect(r.restricoes.find(x => x.id === 'amplitude_janela_descanso')!.fimMaximoMs).toBe(H('21h00'))
    expect(r.restricaoMaisLimitativa!.id).toBe('servico_diario')
    expect(r.resultadoMatematico.fimTeoricoMs).toBe(H('18h00'))
  })
  it('cenário totalmente confirmado: autorização limitada às restrições avaliadas, nunca ao que não foi avaliado', () => {
    // 15h00, 8h15 de serviço feito (9h decorridas − 45 min de pausas verificadas), restam 3h45 de serviço.
    const r = avaliarRegras(base({
      referenciaMs: H('15h00'),
      servicoAcumuladoSeg: hh(8.25),
      pausas: [
        { inicioMs: H('10h00'), durSeg: 15 * 60, natureza: 'livre_confirmada' },
        { inicioMs: H('14h00'), durSeg: 30 * 60, natureza: 'livre_confirmada' },
      ],
      semana: { servicoSemanaSeg: hh(30), completa: true },
    }))
    expect(r.restricaoMaisLimitativa!.id).toBe('servico_diario')
    expect(r.resultadoMatematico.fimTeoricoMs).toBe(H('18h45'))
    expect(r.pausas!.cumprimento).toBe('cumprida')
    expect(r.estado).toBe('confirmado')
    expect(r.autorizacao).toBe('limitada_as_restricoes_avaliadas')
    expect(r.naoAvaliadas.length > 0).toBe(true)
    expect(r.referencias.every(x => x.id.length > 0 && !!x.verificacao)).toBe(true)
  })
  it('regulamento 561 desconhecido ou equipagem: a amplitude não é afirmada', () => {
    const r1 = avaliarRegras(base({ contexto: { ...CTX, regulamento561: 'desconhecido' } }))
    expect(r1.estado).toBe('simulacao_condicionada')
    const r2 = avaliarRegras(base({ contexto: { ...CTX, equipagem: true } }))
    expect(r2.restricoes.find(x => x.id === 'amplitude_janela_descanso')!.avaliada).toBe(false)
    expect(r2.naoAvaliadas.some(x => x.id === 'amplitude_descanso_diario')).toBe(true)
  })
})
