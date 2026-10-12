// src/engine/regras/lerContexto.multiServicos.test.ts
// Assistente (leitura real do armazenamento) com um 2.º serviço no mesmo dia: não reinicia amplitude nem serviço,
// e o intervalo entre serviços fica DESCONHECIDO (nem pausa, nem descanso).
import { lerContextoAssistente, prepararRespostas, type LeitorStorage, type ContextoAssistente } from './lerContexto'

const L = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).getTime()
const W = (y: number, m: number, d: number, h: number, mi: number) => Date.UTC(y, m - 1, d, h, mi)
const H = 3600

function leitor(dados: Record<string, string | undefined>): LeitorStorage {
  return { multiGet: async (keys: readonly string[]) => keys.map(k => [k, dados[k] ?? null] as const) } as unknown as LeitorStorage
}
const ontem = { id: String(L(2026, 10, 12, 16, 0)), date: '12/10', jour: 'Lun', type: 'TRAB', debut: '06h00', fin: '16h00', segServico: 34000, segPausa: 2000, decouche: false, frais: 0 }
const s1 = (extra: Record<string, unknown> = {}) => ({ id: String(L(2026, 10, 13, 10, 0)), date: '13/10', jour: 'Mar', type: 'TRAB', debut: '06h00', fin: '10h00', segServico: 4 * H, segPausa: 0, decouche: false, frais: 0, ...extra })
const estado = (iniMs: number, hora: string) => JSON.stringify({
  enService: true, emPausa: false, decouche: false, dateInicio: new Date(iniMs).toISOString(), horaInicio: hora,
  segServicoBase: 0, tsInicioServico: iniMs, segPausaTotal: 0,
})
const ler = (d: Record<string, string | undefined>, agora: number) => lerContextoAssistente(leitor(d), agora)
const restr = (c: ContextoAssistente, id: string) => c.motor!.restricoes.find(r => r.id === id)!

describe('assistente — 2.º serviço do dia lido do armazenamento', () => {
  const agora = L(2026, 10, 13, 16, 0)
  const dados = (hist: unknown[]) => ({ TACHOOFFICE_estado: estado(L(2026, 10, 13, 14, 0), '14h00'), historique: JSON.stringify(hist), profil: 'MIXTE' })

  it('amplitude conta desde o início do 1.º serviço (06h00), não desde as 14h00', async () => {
    const c = await ler(dados([ontem, s1()]), agora)
    expect(c.situacao).toBe('em_curso')
    expect(restr(c, 'amplitude_janela_descanso').fimMaximoMs).toBe(W(2026, 10, 13, 19, 0))   // 06h00 + 24h − 11h
  })
  it('limite de serviço diário usa 1.º + 2.º serviço (4h + 2h): restam 6h, não 10h', async () => {
    const c = await ler(dados([ontem, s1()]), agora)
    expect(restr(c, 'servico_diario').fimMaximoMs).toBe(W(2026, 10, 13, 22, 0))   // agora 16h00 + 6h
  })
  it('resultado igual ao de um serviço contínuo equivalente (06h00 com 6h de serviço): o intervalo não dá folga', async () => {
    const multi = await ler(dados([ontem, s1()]), agora)
    const cont = await ler({ TACHOOFFICE_estado: estado(L(2026, 10, 13, 6, 0), '06h00').replace('"segServicoBase":0', `"segServicoBase":${6 * H}`).replace(/"tsInicioServico":\d+/, `"tsInicioServico":${agora}`), historique: JSON.stringify([ontem]), profil: 'MIXTE' }, agora)
    expect(restr(multi, 'amplitude_janela_descanso').fimMaximoMs).toBe(restr(cont, 'amplitude_janela_descanso').fimMaximoMs)
    expect(restr(multi, 'servico_diario').fimMaximoMs).toBe(restr(cont, 'servico_diario').fimMaximoMs)
  })
  it('o intervalo de 4h entre serviços fica desconhecido: nenhuma pausa registada e nenhum descanso confirmado', async () => {
    const c = await ler(dados([ontem, s1()]), agora)
    const ent = c.adaptador!.entrada
    expect(ent.pausas!.length).toBe(0)
    expect(ent.fimDescansoAnterior!.confirmado).toBe(false)
    // o fim do descanso anterior é o início do 1.º serviço (06h00), nunca o fim do 1.º serviço (10h00) nem o início do 2.º (14h00)
    expect(ent.fimDescansoAnterior!.ms).toBe(W(2026, 10, 13, 6, 0))
    expect(c.avisos.concat(c.adaptador!.avisos).some(a => a.includes('não é pausa nem descanso'))).toBe(true)
  })
  it('as respostas continuam condicionadas: simulação, sem autorização', async () => {
    const c = await ler(dados([ontem, s1()]), agora)
    expect(c.motor!.autorizacao).toBe('nao_concedida')
    const r = prepararRespostas(c).respostas
    expect(r.every(x => x.aviso.length > 0)).toBe(true)
  })
  it('pausa registada DENTRO do 1.º serviço continua a contar; o intervalo continua a não contar', async () => {
    const pausa = { inicio: L(2026, 10, 13, 8, 0), dur: 1800 }
    const c = await ler(dados([ontem, s1({ segServico: 3.5 * H, segPausa: 1800, pausasDetalhe: [pausa] })]), agora)
    expect(c.adaptador!.entrada.pausas!.length).toBe(1)
    expect(c.adaptador!.entrada.pausas![0].durSeg).toBe(1800)
  })
  it('serviço anterior do MESMO dia mas com intervalo ≥9h não se encadeia (já seria um descanso a classificar)', async () => {
    const manha = s1({ debut: '01h00', fin: '04h00', segServico: 3 * H, id: String(L(2026, 10, 13, 4, 0)) })
    const c = await ler(dados([ontem, manha]), L(2026, 10, 13, 16, 0))
    expect(restr(c, 'amplitude_janela_descanso').fimMaximoMs).toBe(W(2026, 10, 14, 3, 0))   // 14h00 + 24h − 11h
  })
  it('somente leitura: o leitor só expõe multiGet', async () => {
    const l = leitor(dados([ontem, s1()]))
    expect(Object.keys(l)).toEqual(['multiGet'])
  })
})
