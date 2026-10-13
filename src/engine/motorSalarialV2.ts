// src/engine/motorSalarialV2.ts
// Motor salarial V2 — ETAPA 1: horas, mês de trabalho e rastreabilidade. Cálculo PARALELO, só para comparação com os
// boletins reais. Não é usado por nenhum ecrã e não altera nenhuma função existente (calcEstimativaMes, etc.).
//
// O QUE ESTA ETAPA FAZ (e só isto):
//  • soma as horas REGISTADAS (segServico) dos serviços do mês de trabalho — vários serviços legítimos no mesmo dia
//    somam-se; cópias idênticas do mesmo serviço contam UMA só vez (mesmo critério do projeto: dia|debut|fin|segServico);
//  • identifica o mês de trabalho e diz de onde veio (gravado / confirmado / explícito / inferido / não confirmado /
//    insuficiente), com o lag utilizado, a sua origem e os conflitos encontrados;
//  • separa o que é CALCULADO (horas registadas) do que é HIPÓTESE ou PARÂMETRO (7,80 h por dia de ausência,
//    janela noturna 21h–06h, hbase) — todos sem confirmação documental para efeitos salariais.
//
// O QUE NÃO FAZ: não calcula bruto, taxas, majorações nem classifica horas suplementares (sem regra confirmada por
// fiche/convenção, «horas acima de hbase» é só uma diferença aritmética, nunca «25%» ou «50%»).
//
// Regras de honestidade: nada é inventado nem «corrigido» em silêncio. Sem mês de trabalho utilizável → `calculado: false`
// e horas a `null`. O lag NUNCA tem valor por omissão aqui (o caso de 2 meses de um utilizador não é regra universal).
import type { MoisData } from '../types/moisdata'
import type { PadraoSalario } from './migracoes'
import { resolverMesTrabalho, mesPagamentoSalDe, type TimingAprendido, type FiabilidadeMes } from '../utils/projecoes'
import { shiftMois } from '../utils/calculos'
import { chaveDia } from '../utils/dataDia'
import { lagValido, LAG_MAX } from '../utils/lagsConfirmados'
import { log } from '../utils/logger'

// ── Parâmetros / hipóteses (NENHUM confirmado documentalmente) ──────────────────────────────────────────────
export const HORAS_POR_DIA_AUSENCIA = 7.8
export const JANELA_NOITE_INICIO_H = 21   // 21h00
export const JANELA_NOITE_FIM_H = 6       // 06h00 (dia seguinte)
/** lags que não geram alerta; o limite superior do intervalo válido (LAG_MAX) exige confirmação documental */
export const LAGS_SEM_ALERTA: readonly number[] = [0, 1, 2]
/** tolerância entre Σ pausasDetalhe e segPausa (segundos) */
export const TOLERANCIA_PAUSAS_SEG = 60

const TIPOS_TRABALHO = ['TRAB', 'DEC', 'work', 'dec']

// ── Tipos ──────────────────────────────────────────────────────────────────────────────────────────────────
export type FiabilidadeMesV2 = 'gravado' | 'confirmado' | 'explicito' | 'inferido' | 'nao_confirmado' | 'insuficiente'
export type OrigemLagV2 = 'mes_gravado' | 'aprendizagem_confirmada' | 'padrao' | 'indisponivel'

export type MesTrabalhoV2 = {
  ano: number | null
  mes: number | null                       // 0-11
  /** mês bancário do salário (null se a fiche não o tem de forma utilizável) */
  pagamento: { ano: number; mes: number } | null
  /** lag usado para derivar o mês (null quando o mês está gravado ou não há lag utilizável) */
  lag: number | null
  lagOrigem: OrigemLagV2
  /** o lag usado vem de uma confirmação válida e não excecional */
  lagConfirmado: boolean
  /** pagamento − trabalho em meses, quando ambos são conhecidos (observação, não regra) */
  lagObservado: number | null
  fiabilidade: FiabilidadeMesV2
  ancora: 'gravado' | 'banco-explicito' | 'rotulo' | null
  conflitos: string[]
  avisos: string[]
}

export type ExatidaoNoite = 'completa' | 'aproximada' | 'parcial' | 'indisponivel' | 'sem_trabalho'

export type MotorV2Resultado = {
  versao: 'v2-etapa1'
  /** false = sem mês de trabalho utilizável: NENHUMA hora foi calculada */
  calculado: boolean
  ano: number | null
  mes: number | null                       // 0-11
  mesTrabalho: MesTrabalhoV2

  // ── horas REGISTADAS (calculadas a partir do histórico) ──
  horasServicoReal: number | null          // Σ segServico/3600 dos serviços TRAB/DEC do mês (sem cópias)
  servicosContados: number                 // serviços distintos somados
  servicosDuplicadosIgnorados: number      // cópias idênticas descartadas
  servicosSobrepostos: number              // pares de serviços distintos do mesmo dia que se sobrepõem (NÃO corrigido; só assinalado)
  diasTrabalho: number                     // dias distintos com trabalho
  registosSemData: number                  // registos de trabalho sem data utilizável (ignorados)

  // ── ausências: PARÂMETRO (dias da fiche × horas por dia assumidas) ──
  ausencias: {
    diasRC: number; diasConges: number; diasFeries: number
    horasPorDia: number
    horas: number | null
    natureza: 'parametro_nao_confirmado'
  }
  horasAusencias: number | null            // = ausencias.horas (compatibilidade)

  /** registadas + ausências parametrizadas (mistura de calculado com hipótese) */
  horasServGlobal: number | null
  /** diferença aritmética horasServGlobal − hbase. NÃO é «horas suplementares»: a classificação (25%/50%) não foi feita. */
  horasAcimaHbase: number | null
  classificacaoSuplementares: 'nao_classificada'
  hbase: { valor: number | null; origem: 'padrao' | 'invalido'; confirmado: false }

  // ── horas noturnas ──
  horasNoite: number | null                // ver `noite.exatidao`: pode ser mínimo ou aproximação
  minutosNoite: number | null
  noite: {
    janela: { inicioH: number; fimH: number; confirmadaDocumentalmente: false }
    exatidao: ExatidaoNoite
    /** 'parcial' → horasNoite é um MÍNIMO (há serviços de fora); 'aproximada' → pausas não totalmente localizadas */
    minutos: number | null
    diasCalculados: number
    diasSemPausas: number
    diasComPausasLocalizadas: number
    diasForaSemDados: number
    diasPausasInconsistentes: number
  }
  // compatibilidade com a versão anterior
  diasNoiteCalculados: number
  diasSemPausas: number
  diasNoiteForaSemDados: number

  avisos: string[]
}

type Intervalo = [number, number]   // [inicio, fim] em ms
type Registo = Record<string, any>

const r2 = (n: number): number => Math.round(n * 100) / 100
const diasNaoNegativos = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

const parseHM = (s: unknown): number | null => {
  if (typeof s !== 'string') return null
  const m = /^(\d{1,2})h(\d{1,2})$/.exec(s.trim())
  if (!m) return null
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10)
  return h < 24 && mi < 60 ? h * 60 + mi : null
}

// Intervalo [início, fim] do serviço em ms (hora local), reconstruído de date + debut/fin.
function intervaloServico(j: Registo, ano: number): Intervalo | null {
  const partes = String(j?.date ?? '').split('/')
  const d = parseInt(partes[0], 10), m = parseInt(partes[1], 10)
  const hmI = parseHM(j?.debut), hmF = parseHM(j?.fin)
  if (!Number.isFinite(d) || !Number.isFinite(m) || hmI === null || hmF === null) return null
  const ini = new Date(ano, m - 1, d, Math.floor(hmI / 60), hmI % 60).getTime()
  let fim = new Date(ano, m - 1, d, Math.floor(hmF / 60), hmF % 60).getTime()
  if (fim <= ini) fim = new Date(ano, m - 1, d + 1, Math.floor(hmF / 60), hmF % 60).getTime()   // atravessa a meia-noite
  return [ini, fim]
}

// Base menos as pausas (cortadas ao intervalo base, sobrepostas fundidas).
function subtrair(base: Intervalo, cortes: Intervalo[]): Intervalo[] {
  const cs = cortes
    .map(([a, b]) => [Math.max(a, base[0]), Math.min(b, base[1])] as Intervalo)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  const out: Intervalo[] = []
  let cur = base[0]
  for (const [a, b] of cs) {
    if (a > cur) out.push([cur, a])
    cur = Math.max(cur, b)
  }
  if (cur < base[1]) out.push([cur, base[1]])
  return out
}

// Minutos desses intervalos que caem em janelas [D 21h00, D+1 06h00].
function minutosNoturnos(ivs: Intervalo[], ini: number, fim: number): number {
  const d0 = new Date(ini); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - 1)   // janela que começou na véspera
  const d1 = new Date(fim); d1.setHours(0, 0, 0, 0)
  let ms = 0
  for (const d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    const wIni = new Date(d.getFullYear(), d.getMonth(), d.getDate(), JANELA_NOITE_INICIO_H, 0).getTime()
    const wFim = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, JANELA_NOITE_FIM_H, 0).getTime()
    for (const [a, b] of ivs) {
      const o = Math.min(b, wFim) - Math.max(a, wIni)
      if (o > 0) ms += o
    }
  }
  return ms / 60000
}

type PausasDia = { intervalos: Intervalo[]; localizadas: boolean; consistente: boolean }

// Pausas de um dia:
//  - com pausasDetalhe válido → os intervalos (consistente se Σdur ≈ segPausa);
//  - sem detalhe e segPausa === 0 → [] (não houve pausas: nada a subtrair);
//  - sem detalhe (ou inválido) e segPausa > 0 (ou desconhecido) → null (não sabemos onde foram as pausas → não estima).
function pausasDoDia(j: Registo): PausasDia | null {
  const det = j?.pausasDetalhe
  if (Array.isArray(det) && det.length > 0) {
    const intervalos: Intervalo[] = []
    let soma = 0
    for (const p of det) {
      if (!p || !Number.isFinite(p.inicio) || p.inicio <= 0 || !Number.isFinite(p.dur) || p.dur < 0) return null
      intervalos.push([p.inicio, p.inicio + p.dur * 1000])   // inicio em ms, dur em segundos
      soma += p.dur
    }
    const segPausa = Number(j?.segPausa)
    const consistente = !Number.isFinite(segPausa) || Math.abs(soma - segPausa) <= TOLERANCIA_PAUSAS_SEG
    return { intervalos, localizadas: true, consistente }
  }
  const segPausa = Number(j?.segPausa)
  return Number.isFinite(segPausa) && segPausa === 0 ? { intervalos: [], localizadas: false, consistente: true } : null
}

// ── Mês de trabalho ─────────────────────────────────────────────────────────────────────────────────────────
const anoSensato = (a: unknown): a is number => typeof a === 'number' && Number.isInteger(a) && a >= 2000 && a <= 2100
const mesSensato = (m: unknown): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= 11

const FIABILIDADE_V2: Record<FiabilidadeMes, FiabilidadeMesV2> = {
  gravada: 'gravado', declarada: 'confirmado', media: 'explicito', inferida: 'inferido', 'nao-confirmada': 'nao_confirmado',
}

/**
 * Resolve o mês de trabalho SEM alterar nada guardado e SEM lag por omissão.
 *  prioridade do lag: aprendizagem CONFIRMADA e válida > padrão (não confirmado) > indisponível.
 *  • lag inteiro fora de [0, LAG_MAX] → ignorado e assinalado;
 *  • lag = LAG_MAX (3) → nunca «confirmado» em silêncio: usa-se se for o único, mas como NÃO confirmado e com aviso;
 *  • confirmado ≠ padrão → conflito explícito (o confirmado prevalece);
 *  • mês gravado ≠ mês derivado do lag → conflito explícito (o gravado prevalece).
 */
export function resolverMesTrabalhoV2(fiche: MoisData, padrao: PadraoSalario | null | undefined, ap?: TimingAprendido): MesTrabalhoV2 {
  const conflitos: string[] = []
  const avisos: string[] = []
  const pagBruto = fiche ? mesPagamentoSalDe(fiche) : [NaN, NaN]
  const pagamento = anoSensato(pagBruto[0]) && mesSensato(pagBruto[1]) ? { ano: pagBruto[0], mes: pagBruto[1] } : null
  if (!pagamento) avisos.push('Mês de pagamento do salário ausente ou inválido na fiche.')

  // ── lag candidato ──
  const confBruto = ap?.hlagConfirmado === true ? ap.hlag : undefined
  let confValido: number | null = null
  if (ap?.hlagConfirmado === true) {
    if (lagValido(confBruto)) confValido = confBruto as number
    else conflitos.push(`hlag marcado como confirmado mas inválido (${String(confBruto)}): ignorado.`)
  }
  const padraoLag = lagValido(padrao?.hlag) ? (padrao!.hlag as number) : null
  if (padrao && padrao.hlag != null && padraoLag === null) avisos.push(`hlag do padrão inválido (${String(padrao.hlag)}): ignorado.`)
  const apNaoConf = ap?.hlagConfirmado !== true && lagValido(ap?.hlag) ? (ap!.hlag as number) : null
  if (apNaoConf !== null && padraoLag !== null && apNaoConf !== padraoLag) avisos.push(`Aprendizagem não confirmada propõe hlag=${apNaoConf}, o padrão tem ${padraoLag}: usa-se o do padrão.`)

  let lag: number | null = null
  let lagOrigem: OrigemLagV2 = 'indisponivel'
  let lagConfirmado = false
  if (confValido !== null) {
    lag = confValido; lagOrigem = 'aprendizagem_confirmada'; lagConfirmado = true
    if (padraoLag !== null && padraoLag !== confValido) conflitos.push(`hlag confirmado (${confValido}) difere do padrão (${padraoLag}): prevalece o confirmado.`)
  } else if (padraoLag !== null) {
    lag = padraoLag; lagOrigem = 'padrao'
  }
  if (lag === LAG_MAX) {
    // nunca aceite como «confirmado» em silêncio
    if (lagConfirmado) avisos.push(`hlag=${LAG_MAX} declarado como confirmado: tratado como NÃO confirmado até haver confirmação documental.`)
    else avisos.push(`hlag=${LAG_MAX} sem confirmação documental.`)
    lagConfirmado = false
  }

  // ── mês gravado ──
  const gAno = fiche?.anoTrabalho, gMes = fiche?.mesTrabalhoIndex
  const gravadoPresente = gAno != null || gMes != null
  const gravadoValido = anoSensato(gAno) && mesSensato(gMes)
  if (gravadoPresente && !gravadoValido) avisos.push(`Mês de trabalho gravado inválido (${String(gAno)}/${String(gMes)}): ignorado.`)

  const derivar = (): { ano: number; mes: number; fiab: FiabilidadeMesV2; ancora: 'banco-explicito' | 'rotulo' } | null => {
    if (lag === null || !pagamento) return null
    // sem os campos «gravados»: aqui queremos o mês que o LAG daria (para o comparar com o gravado, se existir)
    const semGravado = { ...fiche, anoTrabalho: undefined, mesTrabalhoIndex: undefined } as MoisData
    const r = resolverMesTrabalho(semGravado, { ...(padrao as PadraoSalario), hlag: lag }, { hlag: lag, hlagConfirmado: lagConfirmado }, 'horas')
    if (!anoSensato(r.ano) || !mesSensato(r.mes)) return null
    return { ano: r.ano, mes: r.mes, fiab: FIABILIDADE_V2[r.fiabilidade], ancora: r.ancora === 'banco-explicito' ? 'banco-explicito' : 'rotulo' }
  }

  if (gravadoValido) {
    const ano = gAno as number, mes = gMes as number
    const der = derivar()
    if (der && (der.ano !== ano || der.mes !== mes)) {
      conflitos.push(`Mês gravado ${ano}-${String(mes + 1).padStart(2, '0')} difere do derivado do lag ${lag} (${der.ano}-${String(der.mes + 1).padStart(2, '0')}): prevalece o gravado.`)
    }
    const lagObservado = pagamento ? (pagamento.ano - ano) * 12 + (pagamento.mes - mes) : null
    if (lagObservado !== null && !lagValido(lagObservado)) avisos.push(`Pagamento − mês gravado = ${lagObservado} meses: fora do intervalo 0 a ${LAG_MAX}.`)
    return { ano, mes, pagamento, lag: null, lagOrigem: 'mes_gravado', lagConfirmado: false, lagObservado, fiabilidade: 'gravado', ancora: 'gravado', conflitos, avisos }
  }

  const der = derivar()
  if (!der) {
    if (lag === null) avisos.push('Sem lag utilizável (nem confirmado nem do padrão): mês de trabalho não determinado.')
    return { ano: null, mes: null, pagamento, lag, lagOrigem, lagConfirmado, lagObservado: null, fiabilidade: 'insuficiente', ancora: null, conflitos, avisos }
  }
  const lagObservado = pagamento ? (pagamento.ano - der.ano) * 12 + (pagamento.mes - der.mes) : null
  // sanidade da aritmética (shiftMois): nunca deve falhar
  if (pagamento && lag !== null) {
    const [a, m] = shiftMois(pagamento.ano, pagamento.mes, -lag)
    if (a !== der.ano || m !== der.mes) conflitos.push('Inconsistência interna na resolução do mês (shiftMois).')
  }
  // fiabilidade nunca é «confirmado»/«inferido» se o lag não ficou confirmado (ex.: lag 3)
  let fiabilidade = der.fiab
  if (!lagConfirmado && (fiabilidade === 'confirmado' || fiabilidade === 'inferido')) fiabilidade = der.ancora === 'banco-explicito' ? 'explicito' : 'nao_confirmado'
  return { ano: der.ano, mes: der.mes, pagamento, lag, lagOrigem, lagConfirmado, lagObservado, fiabilidade, ancora: der.ancora, conflitos, avisos }
}

// ── Cálculo principal ───────────────────────────────────────────────────────────────────────────────────────
const identidadeServico = (j: Registo, chave: string): string => `${chave}|${j.debut}|${j.fin}|${Number(j.segServico) || 0}`

export function calcularMotorV2(fiche: MoisData, historique: any[], padrao: PadraoSalario, ap?: TimingAprendido): MotorV2Resultado {
  const mt = resolverMesTrabalhoV2(fiche, padrao, ap)
  const avisos: string[] = [...mt.avisos, ...mt.conflitos]
  const hbaseValor = Number.isFinite(padrao?.hbase) && padrao.hbase > 0 ? padrao.hbase : null
  const hbase = { valor: hbaseValor, origem: (hbaseValor !== null ? 'padrao' : 'invalido') as 'padrao' | 'invalido', confirmado: false as const }
  if (hbaseValor === null) avisos.push('hbase inválido ou ausente no padrão: sem referência para «horas acima de hbase» (não se assume nenhum valor).')

  const joursRC = diasNaoNegativos(fiche?.joursRC), joursConges = diasNaoNegativos(fiche?.joursConges), joursFeries = diasNaoNegativos(fiche?.joursFeries)
  for (const [nome, v] of [['joursRC', fiche?.joursRC], ['joursConges', fiche?.joursConges], ['joursFeries', fiche?.joursFeries]] as const) {
    if (v != null && diasNaoNegativos(v) === 0 && v !== 0) avisos.push(`${nome} inválido (${String(v)}): tratado como 0.`)
  }
  const noiteBase = { janela: { inicioH: JANELA_NOITE_INICIO_H, fimH: JANELA_NOITE_FIM_H, confirmadaDocumentalmente: false as const } }
  avisos.push(`Parâmetro não confirmado documentalmente: ${HORAS_POR_DIA_AUSENCIA} h por dia de ausência.`)
  avisos.push(`Parâmetro não confirmado documentalmente: janela noturna ${JANELA_NOITE_INICIO_H}h–${String(JANELA_NOITE_FIM_H).padStart(2, '0')}h.`)

  // ── sem mês de trabalho: nada é calculado ──
  if (mt.ano === null || mt.mes === null) {
    avisos.push('Dados insuficientes: nenhuma hora foi calculada.')
    const res: MotorV2Resultado = {
      versao: 'v2-etapa1', calculado: false, ano: null, mes: null, mesTrabalho: mt,
      horasServicoReal: null, servicosContados: 0, servicosDuplicadosIgnorados: 0, servicosSobrepostos: 0, diasTrabalho: 0, registosSemData: 0,
      ausencias: { diasRC: joursRC, diasConges: joursConges, diasFeries: joursFeries, horasPorDia: HORAS_POR_DIA_AUSENCIA, horas: null, natureza: 'parametro_nao_confirmado' },
      horasAusencias: null, horasServGlobal: null, horasAcimaHbase: null, classificacaoSuplementares: 'nao_classificada', hbase,
      horasNoite: null, minutosNoite: null,
      noite: { ...noiteBase, exatidao: 'indisponivel', minutos: null, diasCalculados: 0, diasSemPausas: 0, diasComPausasLocalizadas: 0, diasForaSemDados: 0, diasPausasInconsistentes: 0 },
      diasNoiteCalculados: 0, diasSemPausas: 0, diasNoiteForaSemDados: 0, avisos,
    }
    log.warn('MOTOR_V2', 'mês de trabalho indeterminado — nada calculado', { periode: fiche?.periode, mesTrabalho: mt })
    return res
  }

  const ano = mt.ano, mes = mt.mes
  const hist: Registo[] = Array.isArray(historique) ? historique : []

  // 1. serviços de trabalho do mês, sem cópias idênticas (critério do projeto: dia|debut|fin|segServico)
  const vistos = new Set<string>()
  const servicos: Array<{ j: Registo; chave: string }> = []
  let duplicados = 0, semData = 0
  for (const j of hist) {
    if (!j || typeof j !== 'object' || !TIPOS_TRABALHO.includes(String(j.type ?? ''))) continue
    const chave = chaveDia(j, ano)
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(chave)
    if (!m) { semData++; continue }
    if (parseInt(m[2], 10) - 1 !== mes || parseInt(m[3], 10) !== ano) continue
    const ident = identidadeServico(j, chave)
    if (vistos.has(ident)) { duplicados++; continue }
    vistos.add(ident)
    servicos.push({ j, chave })
  }
  if (duplicados > 0) avisos.push(`${duplicados} serviço(s) duplicado(s) ignorado(s) (mesmo dia, início, fim e tempo de serviço).`)
  if (semData > 0) avisos.push(`${semData} registo(s) de trabalho sem data utilizável ignorado(s).`)

  const diasDistintos = new Set(servicos.map(s => s.chave))
  const horasServicoReal = servicos.reduce((s, x) => s + (Number(x.j.segServico) || 0), 0) / 3600

  // serviços distintos do mesmo dia que se sobrepõem: assinalado, NUNCA corrigido
  let sobrepostos = 0
  const porDia = new Map<string, Intervalo[]>()
  for (const s of servicos) {
    const iv = intervaloServico(s.j, ano)
    if (!iv) continue
    const l = porDia.get(s.chave) ?? []
    l.push(iv); porDia.set(s.chave, l)
  }
  for (const l of porDia.values()) for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) if (l[a][0] < l[b][1] && l[b][0] < l[a][1]) sobrepostos++
  if (sobrepostos > 0) avisos.push(`${sobrepostos} par(es) de serviços do mesmo dia com horários sobrepostos: horas somadas tal como registadas (verificar).`)

  // 2. ausências: dias da fiche × parâmetro (HIPÓTESE)
  const horasAusencias = (joursRC + joursConges + joursFeries) * HORAS_POR_DIA_AUSENCIA

  // 3. total e diferença aritmética para hbase (sem classificar horas suplementares)
  const horasServGlobal = horasServicoReal + horasAusencias
  const horasAcimaHbase = hbaseValor !== null ? Math.max(0, horasServGlobal - hbaseValor) : null

  // 4. horas de noite
  let minutosNoite = 0, calculados = 0, semPausas = 0, comPausas = 0, fora = 0, inconsistentes = 0
  for (const { j } of servicos) {
    try {
      const pausas = pausasDoDia(j)
      const iv = pausas ? intervaloServico(j, ano) : null
      if (!pausas || !iv) { fora++; continue }
      minutosNoite += minutosNoturnos(subtrair(iv, pausas.intervalos), iv[0], iv[1])
      calculados++
      if (pausas.localizadas) comPausas++; else semPausas++
      if (!pausas.consistente) inconsistentes++
    } catch (e) {
      fora++
      log.warn('MOTOR_V2', 'serviço ignorado no cálculo nocturno', { tipo: (e as any)?.name })
    }
  }
  let exatidao: ExatidaoNoite
  if (servicos.length === 0) exatidao = 'sem_trabalho'
  else if (calculados === 0) exatidao = 'indisponivel'
  else if (fora > 0) exatidao = 'parcial'
  else if (inconsistentes > 0) exatidao = 'aproximada'
  else exatidao = 'completa'
  if (fora > 0) avisos.push(`Horas noturnas: ${fora} serviço(s) com pausas não localizáveis ficaram de fora — o valor é um MÍNIMO.`)
  if (inconsistentes > 0) avisos.push(`Horas noturnas: ${inconsistentes} serviço(s) com pausas detalhadas que não somam o tempo de pausa registado — valor aproximado.`)
  const minutosNoiteInt = exatidao === 'indisponivel' || exatidao === 'sem_trabalho' ? (exatidao === 'sem_trabalho' ? 0 : null) : Math.round(minutosNoite)

  const res: MotorV2Resultado = {
    versao: 'v2-etapa1', calculado: true, ano, mes, mesTrabalho: mt,
    horasServicoReal: r2(horasServicoReal),
    servicosContados: servicos.length,
    servicosDuplicadosIgnorados: duplicados,
    servicosSobrepostos: sobrepostos,
    diasTrabalho: diasDistintos.size,
    registosSemData: semData,
    ausencias: { diasRC: joursRC, diasConges: joursConges, diasFeries: joursFeries, horasPorDia: HORAS_POR_DIA_AUSENCIA, horas: r2(horasAusencias), natureza: 'parametro_nao_confirmado' },
    horasAusencias: r2(horasAusencias),
    horasServGlobal: r2(horasServGlobal),
    horasAcimaHbase: horasAcimaHbase === null ? null : r2(horasAcimaHbase),
    classificacaoSuplementares: 'nao_classificada',
    hbase,
    horasNoite: minutosNoiteInt === null ? null : r2(minutosNoiteInt / 60),
    minutosNoite: minutosNoiteInt,
    noite: { ...noiteBase, exatidao, minutos: minutosNoiteInt, diasCalculados: calculados, diasSemPausas: semPausas, diasComPausasLocalizadas: comPausas, diasForaSemDados: fora, diasPausasInconsistentes: inconsistentes },
    diasNoiteCalculados: calculados,
    diasSemPausas: semPausas,
    diasNoiteForaSemDados: fora,
    avisos,
  }
  log.debug('MOTOR_V2', `mês ${ano}-${String(mes + 1).padStart(2, '0')}`, {
    periode: fiche?.periode,
    mesTrabalho: { lag: mt.lag, lagOrigem: mt.lagOrigem, lagConfirmado: mt.lagConfirmado, lagObservado: mt.lagObservado, fiabilidade: mt.fiabilidade, ancora: mt.ancora, conflitos: mt.conflitos },
    entradas: { hbase, joursRC, joursConges, joursFeries, horasPorDiaAusencia: HORAS_POR_DIA_AUSENCIA },
    ...res,
  })
  return res
}
