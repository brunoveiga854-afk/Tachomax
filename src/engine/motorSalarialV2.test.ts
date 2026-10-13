// src/engine/motorSalarialV2.test.ts — Etapa 1: horas, mês de trabalho e rastreabilidade (sem cálculo monetário).
import { calcularMotorV2, resolverMesTrabalhoV2, HORAS_POR_DIA_AUSENCIA } from './motorSalarialV2'

const L = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).getTime()

// Fiche do caso de referência: boletim de Abril/2026, salário recebido em Maio/2026 (banco explícito).
const ficheBase = (extra: Record<string, unknown> = {}): any => ({
  periode: 'Avril 2026', moisIndex: 3, annee: 2026, fichePages: 1,
  netPaye: 0, salairebrut: 0, totalCotisations: 0, remboursementFrais: 0, fraisBoletim: 0, montantTotalRecu: 0,
  jourPaiement1: 0, jourPaiement2: 0, analysedAt: '', entreprise: '', conducteur: '',
  pagamentoSalAno: 2026, pagamentoSalMesIndex: 4,
  ...extra,
})
const padrao = (extra: Record<string, unknown> = {}): any => ({ hbase: 169, hlag: 2, ...extra })
const apConf = (hlag: number, extra: Record<string, unknown> = {}): any => ({ hlag, hlagConfirmado: true, ...extra })

// Serviço em Março/2026 (mês de trabalho do caso de referência: pagamento Maio − 2)
let seq = 0
const srv = (dia: number, debut: string, fim: string, seg: number, extra: Record<string, unknown> = {}): any => {
  const [h, m] = fim.split('h').map(Number)
  seq += 1
  return { id: String(L(2026, 3, dia, h, m) + seq), date: `${String(dia).padStart(2, '0')}/03`, jour: 'Lun', type: 'TRAB', debut, fin: fim, segServico: seg, segPausa: 0, ...extra }
}

describe('mês de trabalho — origem, lag e fiabilidade', () => {
  it('caso de referência: lag 2 confirmado + banco explícito → Março, «confirmado»', () => {
    const r = resolverMesTrabalhoV2(ficheBase(), padrao(), apConf(2))
    expect([r.ano, r.mes]).toEqual([2026, 2])
    expect(r.pagamento).toEqual({ ano: 2026, mes: 4 })
    expect(r.lag).toBe(2)
    expect(r.lagOrigem).toBe('aprendizagem_confirmada')
    expect(r.lagConfirmado).toBe(true)
    expect(r.lagObservado).toBe(2)
    expect(r.fiabilidade).toBe('confirmado')
    expect(r.ancora).toBe('banco-explicito')
    expect(r.conflitos).toEqual([])
  })
  it('lag confirmado mas mês bancário igual ao rótulo → «inferido»', () => {
    const f = ficheBase({ pagamentoSalAno: undefined, pagamentoSalMesIndex: undefined })
    const r = resolverMesTrabalhoV2(f, padrao(), apConf(1))
    expect(r.fiabilidade).toBe('inferido')
    expect(r.ancora).toBe('rotulo')
    expect([r.ano, r.mes]).toEqual([2026, 2])
  })
  it('lag só do padrão (não confirmado): banco explícito → «explicito»; sem banco → «nao_confirmado»', () => {
    const a = resolverMesTrabalhoV2(ficheBase(), padrao(), undefined)
    expect(a.fiabilidade).toBe('explicito')
    expect(a.lagOrigem).toBe('padrao')
    expect(a.lagConfirmado).toBe(false)
    const b = resolverMesTrabalhoV2(ficheBase({ pagamentoSalAno: undefined, pagamentoSalMesIndex: undefined }), padrao(), undefined)
    expect(b.fiabilidade).toBe('nao_confirmado')
  })
  it('mês de trabalho gravado na fiche → «gravado», sem lag usado', () => {
    const r = resolverMesTrabalhoV2(ficheBase({ anoTrabalho: 2026, mesTrabalhoIndex: 2 }), padrao(), apConf(2))
    expect(r.fiabilidade).toBe('gravado')
    expect(r.lagOrigem).toBe('mes_gravado')
    expect(r.lag).toBeNull()
    expect(r.lagObservado).toBe(2)
    expect(r.conflitos).toEqual([])
  })
  it('mês gravado ≠ mês derivado do lag → conflito explícito (prevalece o gravado)', () => {
    const r = resolverMesTrabalhoV2(ficheBase({ anoTrabalho: 2026, mesTrabalhoIndex: 3 }), padrao(), apConf(2))
    expect([r.ano, r.mes]).toEqual([2026, 3])
    expect(r.conflitos.length).toBe(1)
    expect(r.conflitos[0]).toContain('difere do derivado')
  })
  it('mês gravado inválido é ignorado e assinalado', () => {
    const r = resolverMesTrabalhoV2(ficheBase({ anoTrabalho: 2026, mesTrabalhoIndex: 12 }), padrao(), apConf(2))
    expect(r.fiabilidade).toBe('confirmado')
    expect(r.avisos.join(' ')).toContain('gravado inválido')
  })
  it('virar de ano: pagamento em Janeiro com lag 2 → Novembro do ano anterior', () => {
    const r = resolverMesTrabalhoV2(ficheBase({ pagamentoSalAno: 2026, pagamentoSalMesIndex: 0 }), padrao(), apConf(2))
    expect([r.ano, r.mes]).toEqual([2025, 10])
  })
})

describe('lag — validação e conflitos', () => {
  it('hlag=3 declarado «confirmado» NÃO é aceite como confirmado em silêncio', () => {
    const r = resolverMesTrabalhoV2(ficheBase(), padrao({ hlag: 2 }), apConf(3))
    expect(r.lag).toBe(3)
    expect(r.lagConfirmado).toBe(false)
    expect(r.fiabilidade).toBe('explicito')
    expect(r.conflitos.join(' ')).toContain('difere do padrão')
    expect(r.avisos.join(' ')).toContain('NÃO confirmado')
  })
  it('hlag=3 no padrão sem confirmação → aviso e não confirmado', () => {
    const r = resolverMesTrabalhoV2(ficheBase(), padrao({ hlag: 3 }), undefined)
    expect(r.lagConfirmado).toBe(false)
    expect(r.avisos.join(' ')).toContain('sem confirmação documental')
  })
  it('valores inválidos nunca são usados (7, -1, 1.5, NaN, texto) e NÃO há lag por omissão', () => {
    for (const v of [7, -1, 1.5, NaN, '2']) {
      const r = resolverMesTrabalhoV2(ficheBase(), padrao({ hlag: undefined }), apConf(v as any))
      expect(r.lag).toBeNull()
      expect(r.lagOrigem).toBe('indisponivel')
      expect(r.fiabilidade).toBe('insuficiente')
      expect(r.mes).toBeNull()
      expect(r.conflitos.join(' ')).toContain('inválido')
    }
  })
  it('confirmado inválido mas padrão válido → usa o padrão, não confirmado, com conflito', () => {
    const r = resolverMesTrabalhoV2(ficheBase(), padrao({ hlag: 2 }), apConf(9))
    expect(r.lag).toBe(2)
    expect(r.lagOrigem).toBe('padrao')
    expect(r.lagConfirmado).toBe(false)
    expect(r.conflitos.length).toBe(1)
  })
  it('confirmado ≠ padrão → conflito explícito e prevalece o confirmado', () => {
    const r = resolverMesTrabalhoV2(ficheBase(), padrao({ hlag: 1 }), apConf(2))
    expect(r.lag).toBe(2)
    expect(r.lagConfirmado).toBe(true)
    expect(r.conflitos.join(' ')).toContain('prevalece o confirmado')
  })
  it('aprendizagem NÃO confirmada que diverge do padrão → só aviso (usa o padrão)', () => {
    const r = resolverMesTrabalhoV2(ficheBase(), padrao({ hlag: 2 }), { hlag: 3, hlagConfirmado: false })
    expect(r.lag).toBe(2)
    expect(r.avisos.join(' ')).toContain('Aprendizagem não confirmada')
  })
  it('sem nenhum lag utilizável → insuficiente (sem assumir 2)', () => {
    const r = resolverMesTrabalhoV2(ficheBase(), padrao({ hlag: undefined }), undefined)
    expect(r.fiabilidade).toBe('insuficiente')
    expect(r.lag).toBeNull()
  })
  it('mês de pagamento ausente → insuficiente', () => {
    const f = ficheBase({ pagamentoSalAno: undefined, pagamentoSalMesIndex: undefined, moisIndex: undefined, annee: undefined })
    const r = resolverMesTrabalhoV2(f, padrao(), apConf(2))
    expect(r.fiabilidade).toBe('insuficiente')
    expect(r.pagamento).toBeNull()
  })
  it('as entradas nunca são alteradas', () => {
    const f = ficheBase(), p = padrao({ hlag: 1 }), a = apConf(3), h = [srv(2, '06h00', '10h00', 14400)]
    const antes = JSON.stringify([f, p, a, h])
    calcularMotorV2(f, h, p, a)
    resolverMesTrabalhoV2(f, p, a)
    expect(JSON.stringify([f, p, a, h])).toBe(antes)
  })
})

describe('serviços do mesmo dia — soma e duplicados', () => {
  it('dois serviços legítimos no mesmo dia somam-se', () => {
    const h = [srv(10, '06h00', '10h00', 14400), srv(10, '14h00', '18h00', 14400)]
    const r = calcularMotorV2(ficheBase(), h, padrao(), apConf(2))
    expect(r.horasServicoReal).toBe(8)
    expect(r.servicosContados).toBe(2)
    expect(r.diasTrabalho).toBe(1)
    expect(r.servicosDuplicadosIgnorados).toBe(0)
  })
  it('cópia duplicada do mesmo serviço (outro id) conta uma só vez', () => {
    const a = srv(10, '06h00', '10h00', 14400)
    const copia = { ...a, id: String(Number(a.id) + 99999) }
    const r = calcularMotorV2(ficheBase(), [a, copia, { ...a }], padrao(), apConf(2))
    expect(r.horasServicoReal).toBe(4)
    expect(r.servicosContados).toBe(1)
    expect(r.servicosDuplicadosIgnorados).toBe(2)
    expect(r.avisos.join(' ')).toContain('duplicado')
  })
  it('duplicado + serviço legítimo no mesmo dia: só o duplicado é descartado', () => {
    const a = srv(10, '06h00', '10h00', 14400)
    const b = srv(10, '14h00', '17h00', 10800)
    const r = calcularMotorV2(ficheBase(), [a, { ...a }, b], padrao(), apConf(2))
    expect(r.horasServicoReal).toBe(7)
    expect(r.servicosContados).toBe(2)
    expect(r.servicosDuplicadosIgnorados).toBe(1)
  })
  it('mesma data, horários diferentes ou tempo de serviço diferente → serviços distintos', () => {
    const h = [srv(10, '06h00', '10h00', 14400), srv(10, '06h00', '10h00', 12000)]
    const r = calcularMotorV2(ficheBase(), h, padrao(), apConf(2))
    expect(r.servicosContados).toBe(2)
    expect(r.servicosDuplicadosIgnorados).toBe(0)
  })
  it('o mesmo serviço em dias diferentes não é duplicado', () => {
    const h = [srv(10, '06h00', '10h00', 14400), srv(11, '06h00', '10h00', 14400)]
    const r = calcularMotorV2(ficheBase(), h, padrao(), apConf(2))
    expect(r.servicosContados).toBe(2)
    expect(r.diasTrabalho).toBe(2)
    expect(r.horasServicoReal).toBe(8)
  })
  it('serviços distintos sobrepostos: somados como registados, mas assinalados', () => {
    const h = [srv(10, '06h00', '10h00', 14400), srv(10, '09h00', '12h00', 10800)]
    const r = calcularMotorV2(ficheBase(), h, padrao(), apConf(2))
    expect(r.horasServicoReal).toBe(7)
    expect(r.servicosSobrepostos).toBe(1)
    expect(r.avisos.join(' ')).toContain('sobrepostos')
  })
  it('só entram serviços de trabalho do mês de trabalho', () => {
    const h = [
      srv(10, '06h00', '10h00', 14400),
      { ...srv(11, '06h00', '10h00', 14400), type: 'RC' },
      { ...srv(12, '06h00', '10h00', 14400), type: 'FERIE' },
      { id: String(L(2026, 4, 10, 10, 0)), date: '10/04', type: 'TRAB', debut: '06h00', fin: '10h00', segServico: 14400 },
      { ...srv(13, '06h00', '10h00', 14400), type: 'dec' },
    ]
    const r = calcularMotorV2(ficheBase(), h, padrao(), apConf(2))
    expect(r.servicosContados).toBe(2)
    expect(r.horasServicoReal).toBe(8)
  })
  it('historique inválido não rebenta', () => {
    for (const h of [null, undefined, 'x', {}, [null, 3, 'a']] as any[]) {
      const r = calcularMotorV2(ficheBase(), h, padrao(), apConf(2))
      expect(r.calculado).toBe(true)
      expect(r.horasServicoReal).toBe(0)
    }
  })
})

describe('ausências e horas acima de hbase', () => {
  it('ausências = dias da fiche × parâmetro, assinalado como NÃO confirmado', () => {
    const h = [srv(10, '06h00', '10h00', 14400)]
    const r = calcularMotorV2(ficheBase({ joursRC: 1, joursConges: 2, joursFeries: 1 }), h, padrao(), apConf(2))
    expect(r.ausencias.horas).toBe(Math.round(4 * HORAS_POR_DIA_AUSENCIA * 100) / 100)
    expect(r.ausencias.natureza).toBe('parametro_nao_confirmado')
    expect(r.ausencias.diasConges).toBe(2)
    expect(r.horasAusencias).toBe(31.2)
    expect(r.horasServicoReal).toBe(4)
    expect(r.horasServGlobal).toBe(35.2)
    expect(r.avisos.join(' ')).toContain('7.8 h por dia de ausência')
    expect(r.avisos.join(' ')).toContain('janela noturna')
  })
  it('dias de ausência inválidos valem 0 e ficam assinalados', () => {
    const r = calcularMotorV2(ficheBase({ joursRC: -2, joursConges: NaN, joursFeries: 'x' }), [], padrao(), apConf(2))
    expect(r.horasAusencias).toBe(0)
    expect(r.avisos.join(' ')).toContain('inválido')
  })
  it('horas acima de hbase NÃO são classificadas como suplementares a 50% nem a 25%', () => {
    const muitas = Array.from({ length: 20 }, (_, i) => srv(i + 1, '06h00', '15h00', 34200))
    const r: any = calcularMotorV2(ficheBase(), muitas, padrao({ hbase: 169 }), apConf(2))
    expect(r.horasServicoReal).toBe(190)
    expect(r.horasAcimaHbase).toBe(21)
    expect(r.classificacaoSuplementares).toBe('nao_classificada')
    expect('horasExtra50' in r).toBe(false)
  })
  it('hbase inválido: sem referência, sem assumir 169', () => {
    const r = calcularMotorV2(ficheBase(), [srv(10, '06h00', '10h00', 14400)], padrao({ hbase: 0 }), apConf(2))
    expect(r.horasAcimaHbase).toBeNull()
    expect(r.hbase.origem).toBe('invalido')
    expect(r.hbase.valor).toBeNull()
    expect(r.horasServicoReal).toBe(4)
  })
  it('abaixo de hbase → 0 horas acima', () => {
    const r = calcularMotorV2(ficheBase(), [srv(10, '06h00', '10h00', 14400)], padrao(), apConf(2))
    expect(r.horasAcimaHbase).toBe(0)
  })
})

describe('horas noturnas — exatidão', () => {
  it('sem pausas (segPausa = 0): completa; 21h–23h30 = 150 min', () => {
    const r = calcularMotorV2(ficheBase(), [srv(10, '20h00', '23h30', 12600)], padrao(), apConf(2))
    expect(r.minutosNoite).toBe(150)
    expect(r.horasNoite).toBe(2.5)
    expect(r.noite.exatidao).toBe('completa')
    expect(r.noite.diasSemPausas).toBe(1)
    expect(r.noite.janela.confirmadaDocumentalmente).toBe(false)
  })
  it('pausa localizada dentro da janela é descontada', () => {
    const pausa = { inicio: L(2026, 3, 10, 22, 0), dur: 1800 }
    const s = srv(10, '20h00', '23h30', 10800, { segPausa: 1800, pausasDetalhe: [pausa] })
    const r = calcularMotorV2(ficheBase(), [s], padrao(), apConf(2))
    expect(r.minutosNoite).toBe(120)
    expect(r.noite.exatidao).toBe('completa')
    expect(r.noite.diasComPausasLocalizadas).toBe(1)
  })
  it('serviço que atravessa a meia-noite: 22h00→06h30 = 8 h na janela', () => {
    const r = calcularMotorV2(ficheBase(), [srv(10, '22h00', '06h30', 30600)], padrao(), apConf(2))
    expect(r.minutosNoite).toBe(480)
    expect(r.noite.exatidao).toBe('completa')
  })
  it('pausas sem localização: o serviço fica de fora e o valor NÃO é apresentado como exato', () => {
    const s = srv(10, '20h00', '23h30', 10800, { segPausa: 1800 })
    const r = calcularMotorV2(ficheBase(), [s], padrao(), apConf(2))
    expect(r.noite.exatidao).toBe('indisponivel')
    expect(r.horasNoite).toBeNull()
    expect(r.minutosNoite).toBeNull()
    expect(r.noite.diasForaSemDados).toBe(1)
    expect(r.diasNoiteForaSemDados).toBe(1)
  })
  it('mistura: um serviço calculável + um sem localização → «parcial» (mínimo) com aviso', () => {
    const ok = srv(10, '20h00', '23h30', 12600)
    const mau = srv(11, '20h00', '23h30', 10800, { segPausa: 1800 })
    const r = calcularMotorV2(ficheBase(), [ok, mau], padrao(), apConf(2))
    expect(r.noite.exatidao).toBe('parcial')
    expect(r.minutosNoite).toBe(150)
    expect(r.avisos.join(' ')).toContain('MÍNIMO')
  })
  it('pausas detalhadas que não somam segPausa → «aproximada»', () => {
    const pausa = { inicio: L(2026, 3, 10, 22, 0), dur: 600 }
    const s = srv(10, '20h00', '23h30', 10800, { segPausa: 1800, pausasDetalhe: [pausa] })
    const r = calcularMotorV2(ficheBase(), [s], padrao(), apConf(2))
    expect(r.noite.exatidao).toBe('aproximada')
    expect(r.noite.diasPausasInconsistentes).toBe(1)
    expect(r.minutosNoite).toBe(140)
  })
  it('pausasDetalhe inválido → tratado como sem localização', () => {
    const s = srv(10, '20h00', '23h30', 10800, { segPausa: 1800, pausasDetalhe: [{ inicio: -1, dur: 10 }] })
    const r = calcularMotorV2(ficheBase(), [s], padrao(), apConf(2))
    expect(r.noite.exatidao).toBe('indisponivel')
  })
  it('sem serviços → «sem_trabalho» e 0 minutos', () => {
    const r = calcularMotorV2(ficheBase(), [], padrao(), apConf(2))
    expect(r.noite.exatidao).toBe('sem_trabalho')
    expect(r.minutosNoite).toBe(0)
  })
  it('serviço duplicado não duplica as horas noturnas', () => {
    const a = srv(10, '20h00', '23h30', 12600)
    const r = calcularMotorV2(ficheBase(), [a, { ...a, id: String(Number(a.id) + 5) }], padrao(), apConf(2))
    expect(r.minutosNoite).toBe(150)
  })
})

describe('dados insuficientes — nada é calculado nem inventado', () => {
  it('sem lag utilizável: calculado = false, horas a null, motivo nos avisos', () => {
    const r = calcularMotorV2(ficheBase(), [srv(10, '06h00', '10h00', 14400)], padrao({ hlag: undefined }), undefined)
    expect(r.calculado).toBe(false)
    expect(r.ano).toBeNull()
    expect(r.horasServicoReal).toBeNull()
    expect(r.horasServGlobal).toBeNull()
    expect(r.horasNoite).toBeNull()
    expect(r.noite.exatidao).toBe('indisponivel')
    expect(r.mesTrabalho.fiabilidade).toBe('insuficiente')
    expect(r.avisos.join(' ')).toContain('Dados insuficientes')
  })
  it('fiche, padrão e historique em falta não rebentam', () => {
    expect(() => calcularMotorV2(undefined as any, undefined as any, undefined as any, undefined)).not.toThrow()
    const r = calcularMotorV2(undefined as any, undefined as any, undefined as any, undefined)
    expect(r.calculado).toBe(false)
  })
})

describe('âmbito da etapa 1', () => {
  it('o resultado não tem nenhum campo monetário', () => {
    const r = calcularMotorV2(ficheBase(), [srv(10, '06h00', '10h00', 14400)], padrao(), apConf(2))
    const chaves = JSON.stringify(Object.keys(r)) + JSON.stringify(Object.keys(r.noite)) + JSON.stringify(Object.keys(r.ausencias))
    expect(chaves).not.toMatch(/bruto|brut|taxa|montant|euro|salaire|net|valor/i)
  })
  it('o motor V2 não está integrado: nenhum ficheiro da app o importa', () => {
    const fs = require('fs'), path = require('path')
    const raiz = path.join(__dirname, '..', '..')
    const visitar = (dir: string, out: string[]) => {
      for (const n of fs.readdirSync(dir)) {
        if (n === 'node_modules' || n.startsWith('.')) continue
        const p = path.join(dir, n)
        if (fs.statSync(p).isDirectory()) visitar(p, out)
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(p)
      }
    }
    const fich: string[] = []
    for (const d of ['app', 'src', 'context']) { const p = path.join(raiz, d); if (fs.existsSync(p)) visitar(p, fich) }
    const importadores = fich.filter(f => !f.endsWith('motorSalarialV2.ts') && /motorSalarialV2/.test(fs.readFileSync(f, 'utf8')))
    expect(importadores).toEqual([])
  })
})
