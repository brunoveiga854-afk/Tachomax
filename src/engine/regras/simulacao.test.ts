// src/engine/regras/simulacao.test.ts
import { lerContextoAssistente, prepararRespostas, type LeitorStorage, type ContextoAssistente } from './lerContexto'
import { simular, parametrosOriginais, saoParametrosOriginais, resolverFimDesejado, PAUSA_SIM_MAX_MIN, type ParametrosSimulacao } from './simulacao'

const L = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).getTime()
const leitor = (dados: Record<string, string | undefined>) =>
  ({ multiGet: async (keys: readonly string[]) => keys.map(k => [k, dados[k] ?? null] as const) }) as unknown as LeitorStorage
const T0 = L(2026, 10, 13, 6, 30)
const anterior = { id: String(L(2026, 10, 12, 16, 0)), date: '12/10', jour: 'Lun', type: 'TRAB', debut: '06h00', fin: '16h00', segServico: 34000, segPausa: 2000, decouche: false, frais: 0 }
const estado = JSON.stringify({ enService: true, emPausa: false, decouche: false, dateInicio: new Date(T0).toISOString(), horaInicio: '06h30', segServicoBase: 0, tsInicioServico: T0, segPausaTotal: 0 })
const base = async (): Promise<ContextoAssistente> =>
  lerContextoAssistente(leitor({ TACHOOFFICE_estado: estado, historique: JSON.stringify([anterior]), profil: 'MIXTE' }), T0 + 2 * 3600_000)
const semServico = async () => lerContextoAssistente(leitor({ historique: JSON.stringify([anterior]), profil: 'MIXTE' }), T0)

describe('parâmetros', () => {
  it('originais = pausa 0 e sem hora', () => {
    expect(saoParametrosOriginais(parametrosOriginais())).toBe(true)
    expect(saoParametrosOriginais({ pausaMin: 5, fimDesejado: null })).toBe(false)
    expect(saoParametrosOriginais({ pausaMin: 0, fimDesejado: { h: 1, m: 0 } })).toBe(false)
  })
  it('hora de fim resolve para a próxima ocorrência; inválidas → null', () => {
    const ref = Date.UTC(2026, 9, 13, 8, 30)
    expect(resolverFimDesejado(ref, 10, 0)).toBe(Date.UTC(2026, 9, 13, 10, 0))
    expect(resolverFimDesejado(ref, 8, 30)).toBe(ref)
    expect(resolverFimDesejado(ref, 6, 0)).toBe(Date.UTC(2026, 9, 14, 6, 0))
    expect(resolverFimDesejado(ref, 24, 0)).toBeNull()
    expect(resolverFimDesejado(ref, 1, 60)).toBeNull()
    expect(resolverFimDesejado(ref, 1.5, 0)).toBeNull()
    expect(resolverFimDesejado(NaN, 1, 0)).toBeNull()
  })
})

describe('simular — indisponível sem dados', () => {
  it('sem serviço em curso → «non disponible», nada inventado', async () => {
    const r = simular(await semServico(), parametrosOriginais())
    expect(r.disponivel).toBe(false)
    if ('motivo' in r) expect(r.motivo).toContain('Aucun service')
  })
  it('pausa fora dos limites → indisponível', async () => {
    const c = await base()
    for (const m of [-5, PAUSA_SIM_MAX_MIN + 1, 2.5, NaN]) expect(simular(c, { pausaMin: m, fimDesejado: null }).disponivel).toBe(false)
  })
  it('hora de fim inválida → indisponível', async () => {
    const r = simular(await base(), { pausaMin: 0, fimDesejado: { h: 25, m: 0 } })
    expect(r.disponivel).toBe(false)
  })
  it('pausa maior do que o tempo até ao fim pretendido → indisponível', async () => {
    const c = await base() // agora = 08:30 (hora local)
    const r = simular(c, { pausaMin: 120, fimDesejado: { h: 9, m: 0 } })
    expect(r.disponivel).toBe(false)
  })
})

describe('simular — parâmetros originais reproduzem o real', () => {
  it('mesmas respostas e mesmo estado do motor, não marcada como alterada', async () => {
    const c = await base()
    const r = simular(c, parametrosOriginais())
    expect(r.disponivel).toBe(true)
    if (!r.disponivel) return
    expect(r.alterada).toBe(false)
    expect(r.comparacao).toBeNull()
    expect(r.motor.estado).toBe(c.motor!.estado)
    expect(r.respostas.map(x => x.linhas)).toEqual(prepararRespostas(c).respostas.map(x => x.linhas))
  })
})

describe('simular — pureza (nunca altera o real)', () => {
  it('o contexto de entrada não é mutado (cópia profunda antes/depois)', async () => {
    const c = await base()
    const antes = JSON.stringify(c)
    simular(c, { pausaMin: 45, fimDesejado: { h: 16, m: 0 } })
    simular(c, { pausaMin: 0, fimDesejado: { h: 20, m: 0 } })
    expect(JSON.stringify(c)).toBe(antes)
    expect(c.adaptador!.entrada.pausaPrevistaSeg ?? 0).toBe(0)
  })
  it('o módulo não importa nem usa armazenamento', () => {
    const fs = require('fs'); const path = require('path')
    const src: string = fs.readFileSync(path.join(__dirname, 'simulacao.ts'), 'utf8')
    expect(/AsyncStorage|setItem|removeItem|multiSet|\.clear\(/.test(src)).toBe(false)
  })
})

describe('simular — pausa', () => {
  it('uma pausa simulada torna o resultado condicional (nunca «confirmado») e é marcada como alterada', async () => {
    const r = simular(await base(), { pausaMin: 45, fimDesejado: null })
    expect(r.disponivel).toBe(true)
    if (!r.disponivel) return
    expect(r.alterada).toBe(true)
    expect(r.motor.estado).not.toBe('confirmado')
    expect(r.nota.amplitude).toContain('amplitude')
  })
  it('a amplitude máxima não muda com a pausa (janela de 24 h parte do repos anterior)', async () => {
    const c = await base()
    const a = simular(c, parametrosOriginais()); const b = simular(c, { pausaMin: 60, fimDesejado: null })
    if (!a.disponivel || !b.disponivel) throw new Error('indisponível')
    const fim = (m: typeof a.motor) => m.restricoes.find(x => x.id === 'amplitude_janela_descanso')?.fimMaximoMs
    expect(fim(b.motor)).toBe(fim(a.motor))
  })
})

describe('simular — hora de fim pretendida', () => {
  it('fim cedo → dentro dos limites calculados, texto sem «autorisé»', async () => {
    const r = simular(await base(), { pausaMin: 0, fimDesejado: { h: 9, m: 0 } })
    if (!r.disponivel) throw new Error('indisponível')
    expect(r.comparacao).not.toBeNull()
    const cmp = r.comparacao!
    expect(cmp.tudoDentro).toBe(true)
    expect(cmp.resumo).toContain('Ce n\'est pas une autorisation')
    expect(/autoris[ée]/i.test(cmp.resumo.replace("pas une autorisation", ''))).toBe(false)
    for (const l of cmp.linhas) expect(l.dentro).toBe(l.margemSeg >= 0)
  })
  it('fim muito tardio → ultrapassa pelo menos uma limitação calculada', async () => {
    const r = simular(await base(), { pausaMin: 0, fimDesejado: { h: 5, m: 0 } }) // próximo dia 05:00 = 22 h30 depois
    if (!r.disponivel) throw new Error('indisponível')
    const cmp = r.comparacao!
    expect(cmp.tudoDentro).toBe(false)
    expect(cmp.linhas.some(l => !l.dentro && l.margemSeg < 0)).toBe(true)
    expect(cmp.resumo).toContain('dépasse')
  })
  it('a pausa simulada reduz o serviço total até ao fim pretendido', async () => {
    const c = await base()
    const a = simular(c, { pausaMin: 0, fimDesejado: { h: 12, m: 0 } })
    const b = simular(c, { pausaMin: 60, fimDesejado: { h: 12, m: 0 } })
    if (!a.disponivel || !b.disponivel) throw new Error('indisponível')
    expect(a.comparacao!.servicoTotalSeg - b.comparacao!.servicoTotalSeg).toBe(3600)
  })
  it('margem = fim máximo − fim pretendido (aritmética simples, em segundos)', async () => {
    const r = simular(await base(), { pausaMin: 0, fimDesejado: { h: 10, m: 0 } })
    if (!r.disponivel) throw new Error('indisponível')
    for (const l of r.comparacao!.linhas) expect(l.margemSeg).toBe(Math.round((l.fimMaximoMs - r.comparacao!.fimDesejadoMs) / 1000))
  })
})
