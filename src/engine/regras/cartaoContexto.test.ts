// src/engine/regras/cartaoContexto.test.ts
import { lerContextoAssistente, prepararCartaoContexto, prepararRespostas, type LeitorStorage } from './lerContexto'

const L = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).getTime()
const leitor = (dados: Record<string, string | undefined>) =>
  ({ multiGet: async (keys: readonly string[]) => keys.map(k => [k, dados[k] ?? null] as const) }) as unknown as LeitorStorage
const T0 = L(2026, 10, 13, 6, 30)
const anterior = { id: String(L(2026, 10, 12, 16, 0)), date: '12/10', jour: 'Lun', type: 'TRAB', debut: '06h00', fin: '16h00', segServico: 34000, segPausa: 2000, decouche: false, frais: 0 }
const mk = (o: Record<string, unknown> = {}) => JSON.stringify({ enService: true, emPausa: false, decouche: false, dateInicio: new Date(T0).toISOString(), horaInicio: '06h30', segServicoBase: 0, tsInicioServico: T0, segPausaTotal: 0, ...o })

describe('cartão de contexto (dados reais, nada fictício)', () => {
  it('sem serviço: título «Aucun service en cours» e nenhuma linha', async () => {
    const k = prepararCartaoContexto(await lerContextoAssistente(leitor({ historique: JSON.stringify([anterior]), profil: 'MIXTE' }), T0))
    expect(k).toEqual({ emServico: false, titulo: 'Aucun service en cours', linhas: [], alertas: [] })
  })
  it('snapshot ilegível: título próprio, sem linhas', async () => {
    const k = prepararCartaoContexto(await lerContextoAssistente(leitor({ TACHOOFFICE_estado: '{mau', historique: '[]', profil: 'MIXTE' }), T0))
    expect(k.emServico).toBe(false)
    expect(k.titulo).toBe('Service illisible')
    expect(k.linhas).toHaveLength(0)
  })
  it('serviço em curso: início, amplitude, serviço acumulado e pausas — com valores reais', async () => {
    const c = await lerContextoAssistente(leitor({ TACHOOFFICE_estado: mk(), historique: JSON.stringify([anterior]), profil: 'MIXTE' }), T0 + 2 * 3600_000)
    const k = prepararCartaoContexto(c)
    expect(k.emServico).toBe(true)
    expect(k.titulo).toBe('Service en cours')
    const r = Object.fromEntries(k.linhas.map(l => [l.rotulo, l.valor]))
    expect(Object.keys(r)).toEqual(['Début', 'Amplitude écoulée', 'Service accumulé', 'Pauses cumulées'])
    expect(r['Début']).toContain('06h30')
    expect(r['Amplitude écoulée']).toContain('2')
  })
  it('em pausa: o título diz «en pause»', async () => {
    const c = await lerContextoAssistente(leitor({ TACHOOFFICE_estado: mk({ emPausa: true, tsPauseInicio: T0 + 3600_000, segServicoBase: 3600 }), historique: JSON.stringify([anterior]), profil: 'MIXTE' }), T0 + 2 * 3600_000)
    if (c.situacao === 'em_curso') expect(prepararCartaoContexto(c).titulo).toBe('Service en cours — en pause')
  })
})

describe('respostas enriquecidas', () => {
  it('amplitude/serviço/repos expõem destaque, hipóteses e alertas; avisos nunca dizem «autorisé»', async () => {
    const c = await lerContextoAssistente(leitor({ TACHOOFFICE_estado: mk(), historique: JSON.stringify([anterior]), profil: 'MIXTE' }), T0 + 2 * 3600_000)
    for (const r of prepararRespostas(c).respostas) {
      expect(Array.isArray(r.hipoteses)).toBe(true)
      expect(Array.isArray(r.alternativas)).toBe(true)
      expect(Array.isArray(r.alertas)).toBe(true)
      if (r.destaque) { expect(r.destaque.valor.length).toBeGreaterThan(0); expect(r.destaque.legenda.length).toBeGreaterThan(0) }
      expect(/vous êtes autoris/i.test(JSON.stringify(r))).toBe(false)
    }
  })
  it('sem serviço: sem destaque nem alternativas inventados', async () => {
    const c = await lerContextoAssistente(leitor({ historique: '[]', profil: 'MIXTE' }), T0)
    for (const r of prepararRespostas(c).respostas) { expect(r.destaque).toBeNull(); expect(r.alternativas).toHaveLength(0) }
  })
})
