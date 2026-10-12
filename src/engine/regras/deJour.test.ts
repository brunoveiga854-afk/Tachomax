import { entradaMotorDeJour, type JourEntrada } from './deJour'
import { avaliarRegras, instanteMs, parseData, parseHoraMin } from './index'

// Fuso injetado: relógio de parede = epoch + 2h (determinístico, independente da máquina).
const OFF = 2 * 3600_000
const relogioParede = (ms: number) => ms + OFF
const D = (dia: string) => parseData(dia)!
// instante de parede
const W = (dia: string, hhmm: string) => instanteMs(D(dia), parseHoraMin(hhmm)!)
// epoch real que corresponde a um instante de parede
const E = (dia: string, hhmm: string) => W(dia, hhmm) - OFF
const hh = (h: number) => h * 3600

const jour = (date: string, debut: string, fim: string, extra: Partial<JourEntrada> = {}, diaFim = date): JourEntrada => ({
  id: String(E(`${diaFim}/2026`, fim)), date, type: 'TRAB', debut, fin: fim, segServico: 0, segPausa: 0, ...extra,
})
const DECL = {
  categoria: 'grand_routier' as const, regulamento561: 'sim' as const, enquadramentoFrances: 'sim' as const,
  tempoServicoEquivale: true, descansoSeguinte: 'normal' as const,
}

describe('1. dia completo com todos os dados', () => {
  const anterior = jour('12/10', '06h00', '18h00', { segServico: hh(10) })
  const dia = jour('13/10', '06h00', '18h00', {
    segServico: 38700, segPausa: 4500, // 10h45 + 1h15 = amplitude 12h
    pausasDetalhe: [
      { inicio: E('13/10/2026', '10h00'), dur: 900 },
      { inicio: E('13/10/2026', '13h00'), dur: 3600, origem: 'troca' },
    ],
  })
  const r = entradaMotorDeJour(dia, [anterior, dia], 'LD', { relogioParede, declarados: DECL })
  it('início, referência, serviço acumulado e pausas', () => {
    expect(r.entrada.inicioServicoMs).toBe(W('13/10/2026', '06h00'))
    expect(r.entrada.referenciaMs).toBe(W('13/10/2026', '18h00'))
    expect(r.entrada.servicoAcumuladoSeg).toBe(38700)
    expect(r.entrada.pausas!.length).toBe(2)
    expect(r.entrada.pausas![0]).toEqual({ inicioMs: W('13/10/2026', '10h00'), durSeg: 900 })
    expect(r.entrada.pausas![1].origem).toBe('troca')
    expect(r.entrada.pausas!.every(p => p.natureza === undefined)).toBe(true)
    expect(r.diagnostico.segPausaSemDetalheSeg).toBe(0)
    expect(r.diagnostico.amplitudeSeg).toBe(hh(12))
    expect(r.diagnostico.atravessaMeiaNoite).toBe(false)
  })
  it('descanso anterior deduzido (12h → normal), mas NÃO confirmado; o próprio dia no histórico é ignorado', () => {
    expect(r.diagnostico.servicoAnteriorEncontrado).toBe(true)
    expect(r.diagnostico.gapDescansoAnteriorSeg).toBe(hh(12))
    expect(r.diagnostico.tipoDescansoDiarioAnterior).toBe('normal')
    expect(r.entrada.fimDescansoAnterior).toEqual({ ms: W('13/10/2026', '06h00'), confirmado: false })
  })
  it('semana completa (segunda 12/10 registada): soma = anterior + dia', () => {
    expect(r.entrada.semana).toEqual({ servicoSemanaSeg: hh(10) + 38700, completa: true })
  })
  it('sem referência de descanso semanal: reduções desconhecidas (null), não inventadas', () => {
    expect(r.entrada.reducoes).toBeNull()
    expect(r.avisos.some(a => a.includes('reduções já utilizadas desconhecidas'))).toBe(true)
  })
  it('declarados entram no contexto; o motor nunca fica «confirmado» com o descanso só deduzido', () => {
    expect(r.entrada.contexto.categoria).toBe('grand_routier')
    expect(r.entrada.confirmacoes!.tempoServicoEquivaleServicoRegulamentar).toBe(true)
    const m = avaliarRegras(r.entrada)
    expect(m.estado === 'confirmado').toBe(false)
    expect(m.autorizacao).toBe('nao_concedida')
  })
})

describe('2. dia sem pausasDetalhe', () => {
  const dia = jour('13/10', '06h00', '16h00', { segServico: hh(9), segPausa: 3600 })
  const r = entradaMotorDeJour(dia, [dia], 'CD', { relogioParede })
  it('não inventa posições: pausas vazias e o total em falta fica no diagnóstico', () => {
    expect(r.entrada.pausas!.length).toBe(0)
    expect(r.diagnostico.nPausasDetalhe).toBe(0)
    expect(r.diagnostico.segPausaSemDetalheSeg).toBe(3600)
    expect(r.avisos.some(a => a.includes('Pausas sem detalhe'))).toBe(true)
  })
  it('sem serviço anterior: descanso anterior desconhecido → dados insuficientes no motor', () => {
    expect(r.entrada.fimDescansoAnterior).toBeNull()
    expect(r.diagnostico.tipoDescansoDiarioAnterior).toBe('desconhecido')
    expect(avaliarRegras(r.entrada).estado).toBe('dados_insuficientes')
  })
})

describe('3. serviço que atravessa a meia-noite', () => {
  it('22h00 → 04h00 do dia seguinte; pausa às 01h00 convertida e aceite', () => {
    const dia = jour('13/10', '22h00', '04h00', {
      segServico: hh(5), segPausa: 3600,
      pausasDetalhe: [{ inicio: E('14/10/2026', '01h00'), dur: 3600 }],
    }, '14/10')
    const r = entradaMotorDeJour(dia, [], null, { relogioParede })
    expect(r.entrada.inicioServicoMs).toBe(W('13/10/2026', '22h00'))
    expect(r.entrada.referenciaMs).toBe(W('14/10/2026', '04h00'))
    expect(r.diagnostico.atravessaMeiaNoite).toBe(true)
    expect(r.diagnostico.amplitudeSeg).toBe(hh(6))
    expect(r.entrada.pausas![0].inicioMs).toBe(W('14/10/2026', '01h00'))
  })
  it('31/12 → 01/01: o ano vem do id (anoDoDia) e o serviço fica em 2026–2027', () => {
    const dia: JourEntrada = {
      id: String(E('01/01/2027', '04h00')), date: '31/12', type: 'TRAB', debut: '22h00', fin: '04h00', segServico: hh(6), segPausa: 0,
    }
    const r = entradaMotorDeJour(dia, [], null, { relogioParede })
    expect(r.entrada.inicioServicoMs).toBe(W('31/12/2026', '22h00'))
    expect(r.entrada.referenciaMs).toBe(W('01/01/2027', '04h00'))
  })
  it('limitação documentada: fin = debut é ambíguo (0h ou 24h) → início desconhecido, nunca adivinhado', () => {
    const dia = jour('13/10', '06h00', '06h00', { segServico: hh(10) })
    const r = entradaMotorDeJour(dia, [], null, { relogioParede })
    expect(r.entrada.inicioServicoMs).toBeNull()
    expect(r.avisos.some(a => a.includes('ambígua'))).toBe(true)
    expect(avaliarRegras(r.entrada).estado).toBe('dados_insuficientes')
  })
  it('limitação documentada: serviço+pausas maiores do que a amplitude geram aviso (possível ≥24h)', () => {
    const dia = jour('13/10', '06h00', '07h00', { segServico: hh(3) })
    const r = entradaMotorDeJour(dia, [], null, { relogioParede })
    expect(r.avisos.some(a => a.includes('possível serviço ≥24h'))).toBe(true)
  })
  it('pausa fora do serviço (fuso/dado errado) é descartada com aviso', () => {
    const dia = jour('13/10', '06h00', '16h00', {
      segServico: hh(9), segPausa: 3600,
      pausasDetalhe: [{ inicio: E('13/10/2026', '20h00'), dur: 3600 }],
    })
    const r = entradaMotorDeJour(dia, [], null, { relogioParede })
    expect(r.entrada.pausas!.length).toBe(0)
    expect(r.diagnostico.nPausasDescartadas).toBe(1)
  })
})

describe('4. o que a app não sabe fica desconhecido', () => {
  const dia = jour('13/10', '06h00', '18h00', { segServico: hh(10), segPausa: 3600 })
  const r = entradaMotorDeJour(dia, [dia], 'LD', { relogioParede })
  it('categoria, 561, enquadramento e descanso seguinte: desconhecidos; profil não decide nada', () => {
    expect(r.entrada.contexto).toEqual({ regulamento561: 'desconhecido', enquadramentoFrances: 'desconhecido', categoria: 'desconhecida' })
    expect(r.entrada.descansoSeguinte).toBeNull()
    expect(r.entrada.confirmacoes!.tempoServicoEquivaleServicoRegulamentar).toBe(false)
    expect(r.diagnostico.perfilApp).toBe('LD')
    expect(r.diagnostico.categoriaDeducidaDoPerfil).toBe(false)
    const outro = entradaMotorDeJour(dia, [dia], 'CD', { relogioParede })
    expect(outro.entrada.contexto).toEqual(r.entrada.contexto)
  })
  it('não altera os argumentos recebidos', () => {
    const copia = JSON.stringify([dia])
    entradaMotorDeJour(dia, [dia], 'MIXTE', { relogioParede })
    expect(JSON.stringify([dia])).toBe(copia)
  })
})

describe('5. serviço em curso', () => {
  it('sem fin: referência = «agora» convertido; serviço acumulado do estado atual', () => {
    const dia: JourEntrada = { date: '13/10', type: 'TRAB', debut: '06h00', fin: '', segServico: hh(4), segPausa: 1800 }
    const r = entradaMotorDeJour(dia, [], null, { relogioParede, agoraMs: E('13/10/2026', '10h30') })
    expect(r.diagnostico.emCurso).toBe(true)
    expect(r.entrada.inicioServicoMs).toBe(W('13/10/2026', '06h00'))
    expect(r.entrada.referenciaMs).toBe(W('13/10/2026', '10h30'))
    expect(r.entrada.servicoAcumuladoSeg).toBe(hh(4))
  })
  it('sem «agora» estima a referência e avisa', () => {
    const dia: JourEntrada = { date: '13/10', type: 'TRAB', debut: '06h00', segServico: hh(4), segPausa: 1800 }
    const r = entradaMotorDeJour(dia, [], null, { relogioParede })
    // sem id nem agora o ano não é conhecido: início null, aviso
    expect(r.entrada.inicioServicoMs).toBeNull()
    expect(r.avisos.length > 0).toBe(true)
  })
})

describe('6. reduções entre semanais deduzidas do histórico (não confirmadas)', () => {
  const s1 = jour('05/10', '06h00', '16h00', { segServico: hh(9) })
  const s2 = jour('07/10', '06h00', '16h00', { segServico: hh(9) })
  const s3 = jour('08/10', '01h30', '12h00', { segServico: hh(9) })
  const s4 = jour('08/10', '22h00', '06h00', { segServico: hh(7) }, '09/10')
  const s5 = jour('09/10', '15h30', '23h30', { segServico: hh(7) })
  const atual = jour('10/10', '11h00', '17h00', { segServico: hh(6) })
  const r = entradaMotorDeJour(atual, [s1, s2, s3, s4, s5, atual], null, { relogioParede })
  it('o intervalo ≥24h antes de s2 é o descanso semanal candidato; contam as 3 reduções seguintes', () => {
    expect(r.diagnostico.referenciaDescansoSemanalMs).toBe(W('07/10/2026', '06h00'))
    expect(r.entrada.reducoes!.utilizadas).toBe(3)
    expect(r.entrada.reducoes!.restantes).toBe(0)
    expect(r.avisos.some(a => a.includes('Descanso semanal deduzido'))).toBe(true)
  })
  it('semana incompleta (domingo/outros dias sem registo): avisa e não dá a semana como completa', () => {
    expect(r.entrada.semana!.completa).toBe(false)
  })
  it('declarar o fim do último semanal prevalece sobre a dedução', () => {
    const d = entradaMotorDeJour(atual, [s1, s2, s3, s4, s5, atual], null, {
      relogioParede, declarados: { fimUltimoDescansoSemanalMs: W('08/10/2026', '01h30'), historicoCompleto: true },
    })
    expect(d.diagnostico.referenciaDescansoSemanalMs).toBe(W('08/10/2026', '01h30'))
    expect(d.entrada.reducoes!.utilizadas).toBe(2)
    expect(d.entrada.reducoes!.restantes).toBe(1)
  })
})
