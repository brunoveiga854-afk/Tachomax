// src/ficheHebdo.multi.test.ts — o PDF de um dia com vários serviços mostra a reconciliação, os intervalos e o frais do dia
import { gerarHtmlFiche, type JourFiche, type InfoFiche } from './ficheHebdo'
import { agruparPorDia, type ServicoReg } from './utils/diasServicos'
import { montarDiaPdfMulti } from './utils/fichePdfDia'

const H = 3600
const srv = (id: string, debut: string, fin: string, seg: number, extra: Partial<ServicoReg> = {}): ServicoReg =>
  ({ id, date: '12/10/2026', jour: 'Lun', type: 'TRAB', debut, fin, segServico: seg, segPausa: 0, decouche: false, frais: 0, ...extra })

const jourBase = (over: Partial<JourFiche>): JourFiche => ({
  date: '12/10/2026', jourLabel: 'LUNDI', jourCourt: 'LUNDI', debut: '06h00', fin: '18h00', amplitude: '12h00', pauseTotal: '0h30', travailTotal: '7h30',
  kmDepart: '', kmArrivee: '', kmTotal: '320', petitDej: false, repas: true, nuit: false, adr: false, vehicule: 'AB-123-CD / EF-456-GH', remorque: '', commentaire: '', ...over,
})
const info = (jours: JourFiche[]): InfoFiche => ({ nom: 'X', prenom: 'Y', semaine: 42, dateDebut: '12/10/2026', dateFin: '17/10/2026', jours, totalKms: '320', totalHeures: '7h30' })

describe('ficheHebdo — dia com vários serviços', () => {
  const g = agruparPorDia([
    srv('2', '14h00', '18h00', 4 * H, { camiao: { type: 'immat', value: 'EF-456-GH' }, kmInicio: 5000, kmFim: 5200 }),
    srv('1', '06h00', '10h00', 3.5 * H, { segPausa: 0.5 * H, camiao: { type: 'immat', value: 'AB-123-CD' }, kmInicio: 1000, kmFim: 1120 }),
  ])[0]
  const p = montarDiaPdfMulti(g)
  const html = gerarHtmlFiche(info([jourBase({ multi: p.multi, commentaire: p.commentaire })]))

  it('mostra a reconciliação Amplitude = Serviço + Pausas + Intervalos', () => {
    expect(html).toContain('Amplitude 12h00 = Service cumulé 7h30 + Pauses dans les services 0h30 + Intervalles entre services 4h00')
  })
  it('intervalos à parte e sem classificação regulamentar', () => {
    expect(html).toContain('Intervalles (non classés')
    expect(html).toContain('1→2 : 4h00')
  })
  it('primeiro início / último fim, km por camião, km total e frais do dia', () => {
    expect(html).toContain('2 services')
    expect(html).toContain('1er début 06h00')
    expect(html).toContain('dernière fin 18h00')
    expect(html).toContain('AB-123-CD : 120 km')
    expect(html).toContain('EF-456-GH : 200 km')
    expect(html).toContain('total 320 km')
    expect(html).toContain('Frais du jour')
  })
  it('não afirma que o intervalo é pausa', () => {
    expect(html.includes('4h00 de pause')).toBe(false)
  })
  it('dia de serviço único: o PDF fica exactamente como antes (sem bloco multi)', () => {
    const h1 = gerarHtmlFiche(info([jourBase({ amplitude: '8h00', pauseTotal: '1h00', travailTotal: '7h00' })]))
    expect(h1.includes('Service cumulé')).toBe(false)
    expect(h1.includes('Frais du jour')).toBe(false)
  })
  it('frais manual marcado no PDF', () => {
    const g2 = agruparPorDia([srv('1', '06h00', '10h00', 4 * H, { frais: 30, fraisManual: true }), srv('2', '14h00', '18h00', 4 * H)])[0]
    const h = gerarHtmlFiche(info([jourBase({ multi: montarDiaPdfMulti(g2).multi })]))
    expect(h).toContain('30,00 €')
    expect(h).toContain('ajusté manuellement')
  })
  it('escreve o resíduo quando os dados não fecham (serviços sobrepostos)', () => {
    const g3 = agruparPorDia([srv('1', '06h00', '10h00', 4 * H), srv('2', '09h00', '12h00', 3 * H)])[0]
    const h = gerarHtmlFiche(info([jourBase({ multi: montarDiaPdfMulti(g3).multi })]))
    expect(h).toContain('écart non réconcilié −1h00')
  })
  it('matrícula com < > é escapada no bloco multi', () => {
    const g4 = agruparPorDia([srv('1', '06h00', '10h00', 4 * H, { camiao: { type: 'immat', value: '<b>X' } , kmInicio: 1, kmFim: 50 }), srv('2', '14h00', '18h00', 4 * H)])[0]
    const h = gerarHtmlFiche(info([jourBase({ multi: montarDiaPdfMulti(g4).multi })]))
    expect(h.includes('Km par camion : <b>X')).toBe(false)
  })
})
