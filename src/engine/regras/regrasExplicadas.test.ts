// src/engine/regras/regrasExplicadas.test.ts
import { REGRAS, ORDEM_REGRAS, todasAsRegras, regrasUsadas } from './regrasExplicadas'
import { REF } from './referencias'
import { lerContextoAssistente, type LeitorStorage } from './lerContexto'

const L = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).getTime()
const leitor = (dados: Record<string, string | undefined>) =>
  ({ multiGet: async (keys: readonly string[]) => keys.map(k => [k, dados[k] ?? null] as const) }) as unknown as LeitorStorage
const T0 = L(2026, 10, 13, 6, 30)
const anterior = { id: String(L(2026, 10, 12, 16, 0)), date: '12/10', jour: 'Lun', type: 'TRAB', debut: '06h00', fin: '16h00', segServico: 34000, segPausa: 2000, decouche: false, frais: 0 }
const estado = JSON.stringify({ enService: true, emPausa: false, decouche: false, dateInicio: new Date(T0).toISOString(), horaInicio: '06h30', segServicoBase: 0, tsInicioServico: T0, segPausaTotal: 0 })

describe('Comprendre cette règle', () => {
  it('cada regra tem explicação, condições, artigo e ligação oficial', () => {
    for (const r of todasAsRegras()) {
      expect(r.explication.length).toBeGreaterThan(40)
      expect(r.conditions.length).toBeGreaterThan(0)
      expect(r.nonVerifie.length).toBeGreaterThan(0)
      expect(r.reference.length).toBeGreaterThan(3)
      expect(r.lien.url.startsWith('https://')).toBe(true)
    }
    expect(ORDEM_REGRAS).toHaveLength(6)
  })
  it('as referências vêm de referencias.ts (mesmo id e nível de verificação)', () => {
    expect(REGRAS.amplitude_561_8_2.reference).toBe(REF.CE561_ART8_2.id)
    expect(REGRAS.reducoes_561_8_4.reference).toBe(REF.CE561_ART8_4.id)
    expect(REGRAS.servico_r3312_51.reference).toBe(REF.R3312_51.id)
    expect(REGRAS.noturno_l3312_1.reference).toBe(REF.L3312_1.id)
    expect(REGRAS.pausas_l3312_2.reference).toBe(REF.L3312_2.id)
    expect(REGRAS.semanal_r3312_50.reference).toBe(REF.R3312_50.id)
    for (const r of todasAsRegras()) expect(r.verificacao).toBeDefined()
  })
  it('ligações só em domínios oficiais; cada artigo com o seu próprio identificador', () => {
    for (const r of todasAsRegras()) {
      const host = new URL(r.lien.url).host
      expect(['eur-lex.europa.eu', 'www.legifrance.gouv.fr']).toContain(host)
      expect(r.lien.origem).toBe(host === 'eur-lex.europa.eu' ? 'EUR-Lex' : 'Légifrance')
    }
    expect(REGRAS.servico_r3312_51.lien.url).toContain('LEGIARTI000033450339')
    expect(REGRAS.noturno_l3312_1.lien.url).toContain('LEGIARTI000033021297')
    expect(REGRAS.pausas_l3312_2.lien.url).toContain('LEGIARTI000026054561')
    expect(REGRAS.semanal_r3312_50.lien.url).toContain('LEGIARTI000033450337')
    expect(REGRAS.amplitude_561_8_2.lien.url).toContain('32006R0561')
    expect(REGRAS.servico_r3312_51.lien.rotulo).toContain('R3312-51')
    expect(REGRAS.noturno_l3312_1.lien.rotulo).toContain('L3312-1')
    expect(REGRAS.pausas_l3312_2.lien.rotulo).toContain('L3312-2')
    expect(REGRAS.semanal_r3312_50.lien.rotulo).toContain('R3312-50')
    const ids = new Set(['LEGIARTI000033450339', 'LEGIARTI000033021297', 'LEGIARTI000026054561', 'LEGIARTI000033450337'])
    const usados = todasAsRegras().filter(r => r.lien.origem === 'Légifrance').map(r => r.lien.url.split('/').pop())
    expect(new Set(usados).size).toBe(usados.length)
    for (const u of usados) expect(ids.has(u as string)).toBe(true)
  })
  it('nenhuma regra afirma autorização nem verificação primária que não existe', () => {
    for (const r of todasAsRegras()) expect(/vous êtes autoris|tu es autoris/i.test(r.explication)).toBe(false)
  })
  it('sem motor (sem serviço) → todas as regras suportadas', () => {
    expect(regrasUsadas(null)).toHaveLength(6)
  })
  it('com serviço em curso → só as regras que o motor avaliou, sem repetições', async () => {
    const c = await lerContextoAssistente(leitor({ TACHOOFFICE_estado: estado, historique: JSON.stringify([anterior]), profil: 'MIXTE' }), T0 + 2 * 3600_000)
    const usadas = regrasUsadas(c.motor)
    const ids = usadas.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('amplitude_561_8_2')
    expect(ids).toContain('servico_r3312_51')
    expect(ids.length).toBeLessThanOrEqual(6)
    for (const id of ids) expect(ORDEM_REGRAS).toContain(id)
  })
})
