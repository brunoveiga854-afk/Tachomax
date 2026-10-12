// 16. Assistente regulamentar com VÁRIOS serviços no mesmo dia.
// O intervalo entre serviços do mesmo dia nunca é pausa nem descanso, e o 2.º serviço não reinicia amplitude nem tempo de serviço.
import { entradaMotorDeJour, type JourEntrada } from './deJour'
import { avaliarRegras, instanteMs, parseData, parseHoraMin } from './index'

const OFF = 2 * 3600_000
const relogioParede = (ms: number) => ms + OFF
const D = (dia: string) => parseData(dia)!
const W = (dia: string, hhmm: string) => instanteMs(D(dia), parseHoraMin(hhmm)!)
const E = (dia: string, hhmm: string) => W(dia, hhmm) - OFF
const hh = (h: number) => h * 3600

const jour = (date: string, debut: string, fim: string, extra: Partial<JourEntrada> = {}, diaFim = date): JourEntrada => ({
  id: String(E(`${diaFim}/2026`, fim)), date, type: 'TRAB', debut, fin: fim, segServico: 0, segPausa: 0, ...extra,
})
const emCurso = (date: string, debut: string, extra: Partial<JourEntrada> = {}): JourEntrada => ({
  id: String(E(`${date}/2026`, debut)), date, type: 'TRAB', debut, fin: '', segServico: 0, segPausa: 0, ...extra,
})
const DECL = {
  categoria: 'grand_routier' as const, regulamento561: 'sim' as const, enquadramentoFrances: 'sim' as const,
  tempoServicoEquivale: true, descansoSeguinte: 'normal' as const,
}

describe('16. assistente — 2.º serviço no mesmo dia', () => {
  const ontem = jour('12/10', '06h00', '18h00', { segServico: hh(10) })
  const s1 = jour('13/10', '06h00', '10h00', { segServico: hh(4) })
  // 2.º serviço em curso desde as 14h00; «agora» = 16h00 (parede) → 2h de serviço
  const s2 = emCurso('13/10', '14h00', { segServico: hh(2) })
  const agoraMs = E('13/10/2026', '16h00')
  const r = entradaMotorDeJour(s2, [ontem, s1], 'LD', { relogioParede, agoraMs, declarados: DECL })

  it('amplitude conta desde o início do 1.º serviço (não reinicia às 14h00)', () => {
    expect(r.entrada.inicioServicoMs).toBe(W('13/10/2026', '06h00'))
    expect(r.entrada.referenciaMs).toBe(W('13/10/2026', '16h00'))
  })
  it('tempo de serviço acumulado = 1.º + 2.º serviço; o intervalo de 4h NÃO entra', () => {
    expect(r.entrada.servicoAcumuladoSeg).toBe(hh(4) + hh(2))
  })
  it('fim do descanso anterior = descanso antes do 1.º serviço (12h de ontem), nunca o fim do 1.º serviço', () => {
    expect(r.entrada.fimDescansoAnterior).toEqual({ ms: W('13/10/2026', '06h00'), confirmado: false })
    expect(r.diagnostico.gapDescansoAnteriorSeg).toBe(hh(12))
  })
  it('o intervalo entre serviços não cria pausa registada nem descanso insuficiente nas reduções', () => {
    expect(r.entrada.pausas!.length).toBe(0)
    expect(r.avisos.some(a => a.includes('1 serviço(s) anterior(es) no mesmo dia'))).toBe(true)
    expect(r.avisos.some(a => a.includes('Intervalo <9h'))).toBe(false)
  })
  it('semana soma os dois serviços uma só vez', () => {
    expect(r.entrada.semana!.servicoSemanaSeg).toBe(hh(10) + hh(4) + hh(2))
  })
  it('pausas do 1.º serviço continuam a contar (posição real preservada)', () => {
    const s1p = jour('13/10', '06h00', '10h00', { segServico: hh(3.5), segPausa: 1800, pausasDetalhe: [{ inicio: E('13/10/2026', '08h00'), dur: 1800 }] })
    const rr = entradaMotorDeJour(s2, [ontem, s1p], 'LD', { relogioParede, agoraMs, declarados: DECL })
    expect(rr.entrada.pausas).toEqual([{ inicioMs: W('13/10/2026', '08h00'), durSeg: 1800 }])
    expect(rr.entrada.servicoAcumuladoSeg).toBe(hh(3.5) + hh(2))
  })
  it('o motor corre e não dá mais folga do que com um serviço contínuo equivalente', () => {
    const contínuo = emCurso('13/10', '06h00', { segServico: hh(6) })
    const rc = entradaMotorDeJour(contínuo, [ontem], 'LD', { relogioParede, agoraMs, declarados: DECL })
    const m2 = avaliarRegras(r.entrada), mc = avaliarRegras(rc.entrada)
    expect(m2.estado).toBe(mc.estado)
    expect(JSON.stringify(m2)).toBe(JSON.stringify(mc)) // mesmo início e mesmo serviço acumulado → mesmo resultado
  })
  it('intervalo ≥9h no mesmo dia (ex.: 05h–08h e 19h–…): já é um descanso, não se encadeia', () => {
    const manha = jour('13/10', '05h00', '08h00', { segServico: hh(3) })
    const noite = emCurso('13/10', '19h00', { segServico: hh(1) })
    const rn = entradaMotorDeJour(noite, [ontem, manha], 'LD', { relogioParede, agoraMs: E('13/10/2026', '20h00'), declarados: DECL })
    expect(rn.entrada.inicioServicoMs).toBe(W('13/10/2026', '19h00'))
    expect(rn.entrada.servicoAcumuladoSeg).toBe(hh(1))
    expect(rn.diagnostico.gapDescansoAnteriorSeg).toBe(hh(11))
  })
  it('dias diferentes com <9h: comportamento de sempre (não encadeia, descanso desconhecido)', () => {
    const tarde = jour('12/10', '14h00', '23h00', { segServico: hh(9) })
    const manha = emCurso('13/10', '04h00', { segServico: hh(1) })
    const rd = entradaMotorDeJour(manha, [tarde], 'LD', { relogioParede, agoraMs: E('13/10/2026', '05h00'), declarados: DECL })
    expect(rd.entrada.inicioServicoMs).toBe(W('13/10/2026', '04h00'))
    expect(rd.entrada.servicoAcumuladoSeg).toBe(hh(1))
    expect(rd.entrada.fimDescansoAnterior).toBeNull()
  })
  it('três serviços no mesmo dia encadeiam os três', () => {
    const a = jour('13/10', '05h00', '07h00', { segServico: hh(2) })
    const b = jour('13/10', '09h00', '11h00', { segServico: hh(2) })
    const c = emCurso('13/10', '13h00', { segServico: hh(1) })
    const rt = entradaMotorDeJour(c, [ontem, a, b], 'LD', { relogioParede, agoraMs: E('13/10/2026', '14h00'), declarados: DECL })
    expect(rt.entrada.inicioServicoMs).toBe(W('13/10/2026', '05h00'))
    expect(rt.entrada.servicoAcumuladoSeg).toBe(hh(5))
  })
  it('serviço único do dia: exatamente como antes', () => {
    const unico = emCurso('13/10', '06h00', { segServico: hh(2) })
    const ru = entradaMotorDeJour(unico, [ontem], 'LD', { relogioParede, agoraMs: E('13/10/2026', '08h00'), declarados: DECL })
    expect(ru.entrada.inicioServicoMs).toBe(W('13/10/2026', '06h00'))
    expect(ru.entrada.servicoAcumuladoSeg).toBe(hh(2))
    expect(ru.avisos.some(a => a.includes('no mesmo dia'))).toBe(false)
  })
})
