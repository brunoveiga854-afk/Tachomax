// src/utils/fichePdfDia.test.ts — 14. PDF com vários serviços
import { agruparPorDia, type ServicoReg } from './diasServicos'
import { montarDiaPdfMulti, minutosServicoPdf, fmtMinPdf } from './fichePdfDia'

const H = 3600
const srv = (id: string, date: string, debut: string, fin: string, seg: number, extra: Partial<ServicoReg> = {}): ServicoReg =>
  ({ id, date, jour: 'Lun', type: 'TRAB', debut, fin, segServico: seg, segPausa: 0, decouche: false, frais: 0, ...extra })
const dia = (l: ServicoReg[]) => agruparPorDia(l)[0]
const A = { type: 'immat' as const, value: 'AB-123-CD' }
const B = { type: 'immat' as const, value: 'EF-456-GH' }

describe('14. PDF — dia com vários serviços', () => {
  it('dois serviços: 1 linha, amplitude real, pausa só interna, trabalho somado, intervalo no comentário', () => {
    const g = dia([
      srv('2', '12/10/2026', '14h00', '18h00', 4 * H, { camiao: B, kmInicio: 5000, kmFim: 5200 }),
      srv('1', '12/10/2026', '06h00', '10h00', 3.5 * H, { segPausa: 0.5 * H, camiao: A, kmInicio: 1000, kmFim: 1120 }),
    ])
    const p = montarDiaPdfMulti(g)
    expect(p.debut).toBe('06h00')
    expect(p.fin).toBe('18h00')
    expect(p.amplitude).toBe('12h00')
    expect(p.pauseTotal).toBe('0h30')            // só a pausa dentro do serviço 1; as 4h entre serviços NÃO são pausa
    expect(p.travailTotal).toBe('7h30')          // 3h30 + 4h00
    expect(p.travMin).toBe(450)
    expect(p.kmTotal).toBe('320')                // 120 + 200, cada camião com os seus km
    expect(p.kmDepart).toBe('')                  // dois camiões → sem km início/fim misturados
    expect(p.kmArrivee).toBe('')
    expect(p.vehicule).toBe('AB-123-CD / EF-456-GH')
    expect(p.commentaire).toContain('2 services')
    expect(p.commentaire).toContain('1) 06h00→10h00')
    expect(p.commentaire).toContain('AB-123-CD · 120 km')
    expect(p.commentaire).toContain('2) 14h00→18h00')
    expect(p.commentaire).toContain('EF-456-GH · 200 km')
    // intervalo entre serviços: à parte, sem classificação, e fora da pausa
    expect(p.multi.intervalles).toBe('4h00')
    expect(p.multi.intervallesDetail).toEqual(['1→2 : 4h00 — non classé (ni pause ni repos confirmé)'])
    expect(p.commentaire).not.toContain('pause)')
  })
  it('mesmo camião e km contínuos: mostra início/fim coerentes com o total', () => {
    const g = dia([
      srv('1', '12/10/2026', '06h00', '09h00', 3 * H, { camiao: A, kmInicio: 1000, kmFim: 1100 }),
      srv('2', '12/10/2026', '10h00', '12h00', 2 * H, { camiao: A, kmInicio: 1100, kmFim: 1150 }),
    ])
    const p = montarDiaPdfMulti(g)
    expect(p.kmDepart).toBe('1000')
    expect(p.kmArrivee).toBe('1150')
    expect(p.kmTotal).toBe('150')
  })
  it('mesmo camião mas com km usados por outros pelo meio: total = soma dos serviços, sem início/fim', () => {
    const g = dia([
      srv('1', '12/10/2026', '06h00', '09h00', 3 * H, { camiao: A, kmInicio: 1000, kmFim: 1100 }),
      srv('2', '12/10/2026', '10h00', '12h00', 2 * H, { camiao: A, kmInicio: 1300, kmFim: 1350 }),
    ])
    const p = montarDiaPdfMulti(g)
    expect(p.kmTotal).toBe('150')
    expect(p.kmDepart).toBe('')
  })
  it('troca de camião DENTRO de um serviço + segundo serviço: sem duplicar km, troca no comentário', () => {
    const troca = { a: { camiao: A, kmInicio: 1000, kmFim: 1060 }, b: { camiao: B, kmInicio: 2000, kmFim: 2040 }, segParaPausa: 0 }
    const g = dia([
      srv('1', '12/10/2026', '06h00', '12h00', 6 * H, { troca, kmDiarios: 100 }),
      srv('2', '12/10/2026', '15h00', '17h00', 2 * H, { camiao: B, kmInicio: 2040, kmFim: 2070 }),
    ])
    const p = montarDiaPdfMulti(g)
    expect(p.kmTotal).toBe('130')                // 60 + 40 + 30
    expect(p.vehicule).toBe('AB-123-CD / EF-456-GH')
    expect(p.commentaire).toContain('Changement de camion')
    expect(p.commentaire).toContain('2) 15h00→17h00')
  })
  it('serviço que atravessa a meia-noite + outro no mesmo dia', () => {
    const g = dia([
      srv('1', '12/10/2026', '04h00', '08h00', 4 * H),
      srv('2', '12/10/2026', '22h00', '02h00', 4 * H),
    ])
    const p = montarDiaPdfMulti(g)
    expect(p.debut).toBe('04h00')
    expect(p.fin).toBe('02h00')
    expect(p.amplitude).toBe('22h00')            // 12/10 04:00 → 13/10 02:00
    expect(p.travailTotal).toBe('8h00')
  })
  it('découché de qualquer serviço marca a noite do dia; nota do utilizador preservada', () => {
    const g = dia([
      srv('1', '12/10/2026', '06h00', '09h00', 3 * H, { nota: { categoria: 'x', emoji: '📌', texto: 'Cliente X' } }),
      srv('2', '12/10/2026', '20h00', '23h00', 3 * H, { type: 'DEC', decouche: true }),
    ])
    const p = montarDiaPdfMulti(g)
    expect(p.nuit).toBe(true)
    expect(p.commentaire.startsWith('Cliente X')).toBe(true)
    expect(p.commentaire).toContain('2 services')
  })
  it('serviços sobrepostos: avisa e não inventa intervalo', () => {
    const g = dia([srv('1', '12/10/2026', '06h00', '10h00', 4 * H), srv('2', '12/10/2026', '09h00', '12h00', 3 * H)])
    const p = montarDiaPdfMulti(g)
    expect(p.temSobreposicao).toBe(true)
    expect(p.commentaire).toContain('chevauchent')
    expect(p.commentaire).not.toContain('Intervalle')
  })
  it('minutos por serviço = regra antiga (amplitude − pausa) e fmt', () => {
    expect(minutosServicoPdf(srv('1', '12/10/2026', '06h00', '10h00', 3 * H, { segPausa: H }))).toEqual({ ampMin: 240, pausaMin: 60, travMin: 180 })
    expect(fmtMinPdf(0)).toBe('')
    expect(fmtMinPdf(75)).toBe('1h15')
  })
})

describe('14b. PDF — reconciliação explícita dos tempos (sem assumir intervalo = pausa)', () => {
  const doisServicos = () => dia([
    srv('2', '12/10/2026', '14h00', '18h00', 4 * H, { camiao: B, kmInicio: 5000, kmFim: 5200 }),
    srv('1', '12/10/2026', '06h00', '10h00', 3.5 * H, { segPausa: 0.5 * H, camiao: A, kmInicio: 1000, kmFim: 1120 }),
  ])
  it('Amplitude = Serviço + Pausas + Intervalos, fecha sem resíduo', () => {
    const m = montarDiaPdfMulti(doisServicos()).multi
    expect(m.premierDebut).toBe('06h00')
    expect(m.dernierFin).toBe('18h00')
    expect(m.amplitude).toBe('12h00')
    expect(m.service).toBe('7h30')
    expect(m.pauses).toBe('0h30')
    expect(m.intervalles).toBe('4h00')
    expect(m.minutos.amplitude).toBe(m.minutos.service + m.minutos.pauses + m.minutos.intervalles)
    expect(m.residu).toBe('')
  })
  it('NÃO vale Amplitude − Pausa = Serviço: a diferença é o intervalo, mostrado à parte', () => {
    const m = montarDiaPdfMulti(doisServicos()).multi
    expect(m.minutos.amplitude - m.minutos.pauses === m.minutos.service).toBe(false)
    expect(m.minutos.amplitude - m.minutos.pauses - m.minutos.service).toBe(m.minutos.intervalles)
  })
  it('km por camião, km total e frais do dia', () => {
    const m = montarDiaPdfMulti(doisServicos()).multi
    expect(m.kmParCamion).toEqual(['AB-123-CD : 120 km', 'EF-456-GH : 200 km'])
    expect(m.kmTotal).toBe('320')
    expect(m.frais).toMatch(/^\d+,\d{2} €$/)
    expect(m.fraisManuel).toBe(false)
  })
  it('frais manual do motorista aparece como valor do dia e marcado', () => {
    const g = dia([
      srv('1', '12/10/2026', '06h00', '10h00', 4 * H, { frais: 30, fraisManual: true }),
      srv('2', '12/10/2026', '14h00', '18h00', 4 * H, { frais: 16.36 }),
    ])
    const m = montarDiaPdfMulti(g).multi
    expect(m.frais).toBe('30,00 €')
    expect(m.fraisManuel).toBe(true)
  })
  it('três serviços: dois intervalos listados separadamente, ambos «non classé»', () => {
    const g = dia([
      srv('1', '12/10/2026', '05h00', '08h00', 3 * H),
      srv('2', '12/10/2026', '09h30', '12h00', 2.5 * H),
      srv('3', '12/10/2026', '13h00', '16h00', 3 * H),
    ])
    const m = montarDiaPdfMulti(g).multi
    expect(m.intervallesDetail.length).toBe(2)
    expect(m.intervallesDetail[0]).toContain('1→2 : 1h30')
    expect(m.intervallesDetail[1]).toContain('2→3 : 1h00')
    expect(m.intervalles).toBe('2h30')
    expect(m.residu).toBe('')
  })
  it('serviços sobrepostos: sem intervalo inventado e o resíduo aparece (não esconde a incoerência)', () => {
    const m = montarDiaPdfMulti(dia([srv('1', '12/10/2026', '06h00', '10h00', 4 * H), srv('2', '12/10/2026', '09h00', '12h00', 3 * H)])).multi
    expect(m.intervallesDetail).toEqual([])
    expect(m.intervalles).toBe('0h00')
    expect(m.residu).toBe('−1h00')
  })
  it('serviço atravessa a meia-noite: reconciliação continua a fechar', () => {
    const m = montarDiaPdfMulti(dia([srv('1', '12/10/2026', '04h00', '08h00', 4 * H), srv('2', '12/10/2026', '22h00', '02h00', 4 * H)])).multi
    expect(m.amplitude).toBe('22h00')
    expect(m.intervalles).toBe('14h00')
    expect(m.residu).toBe('')
  })
})

