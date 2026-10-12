// src/utils/diasServicos.ts
// VÁRIOS SERVIÇOS NO MESMO DIA — camada PURA (sem React, sem AsyncStorage).
//
// MODELO (compatível com o histórico atual, sem migração):
//  • `historique` continua a ser uma lista plana: UM REGISTO = UM SERVIÇO, cada um com `id` próprio (Date.now() do fim).
//  • O «dia» é uma VISTA: os registos com a mesma `chaveDia` (data do INÍCIO, ver dataDia.ts) formam um dia.
//  • Dias antigos de serviço único são, simplesmente, dias com um registo: nada muda para eles.
//  • Nenhuma função aqui altera os argumentos; todas devolvem objetos novos.
import { chaveDia, normalizarDataDia } from './dataDia'
import { kmDoCamiao, normalizarMatricula, type TrocaCamiao } from './camioes'
import { calcularFraisJour, type FraisRegles, type FraisValeurs, type FraisJourResult } from '../frais'

export type ServicoReg = {
  id: string
  date: string
  jour?: string
  type?: string
  debut?: string
  fin?: string
  segServico?: number
  segPausa?: number
  decouche?: boolean
  frais?: number
  /** o motorista confirmou/editou este valor de frais à mão (não é o cálculo automático) — nunca se substitui sozinho */
  fraisManual?: boolean
  kmDiarios?: number
  kmInicio?: number
  kmFim?: number
  troca?: TrocaCamiao | null
  /** camião do serviço (ao fim). Opcional: só os registos novos o trazem */
  camiao?: { type: 'immat' | 'parc'; value: string } | null
  pausasDetalhe?: { inicio: number; dur: number; origem?: string }[]
  nota?: unknown
  [k: string]: unknown
}

const TIPOS_TRABALHO = ['TRAB', 'DEC', 'work', 'dec']
export const ehTrabalho = (j: { type?: string } | null | undefined): boolean => !!j && TIPOS_TRABALHO.includes(String(j.type ?? 'TRAB'))

/** «06h30» / «06:30» → minutos desde as 00h; null se inválido. */
export function minutosDe(t: string | undefined | null): number | null {
  if (!t) return null
  const m = /^\s*(\d{1,2})\s*[h:]\s*(\d{1,2})\s*$/i.exec(String(t))
  if (!m) return null
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10)
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return h * 60 + mi
}

/** Data (DD/MM/AAAA) → [ano, mês0, dia]; null se inválida. `anoFallback` só se a data vier sem ano e sem `id` útil. */
function partesData(j: { date?: unknown; id?: unknown }, anoFallback: number): [number, number, number] | null {
  const dd = normalizarDataDia(j.date, anoFallbackDoDia(j, anoFallback))
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dd)
  if (!m) return null
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), a = parseInt(m[3], 10)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return [a, mo - 1, d]
}
// o ano do dia segue a mesma regra de chaveDia (ano do `id`, com a exceção de Dezembro→Janeiro)
function anoFallbackDoDia(j: { date?: unknown; id?: unknown }, fallback: number): number {
  const k = chaveDia(j as any, fallback)
  const m = /\/(\d{4})$/.exec(k)
  return m ? parseInt(m[1], 10) : fallback
}

export type IntervaloMs = { inicio: number; fim: number }

/**
 * Início e fim REAIS (hora local do telemóvel) de um serviço. O fim cai no dia seguinte se `fin <= debut`
 * (mesma regra que calcServicoDe do Historique), por isso um serviço que atravessa a meia-noite tem fim > início.
 */
export function intervaloServico(j: ServicoReg, anoFallback: number = new Date().getFullYear()): IntervaloMs | null {
  const p = partesData(j, anoFallback)
  const a = minutosDe(j.debut), b = minutosDe(j.fin)
  if (!p || a === null || b === null) return null
  const [ano, mes, dia] = p
  const inicio = new Date(ano, mes, dia, Math.floor(a / 60), a % 60).getTime()
  const fimMin = b <= a ? b + 1440 : b
  const fim = new Date(ano, mes, dia, Math.floor(fimMin / 60), fimMin % 60).getTime() // Date normaliza horas ≥ 24
  return { inicio, fim }
}

export type DiaGrupo = {
  /** chaveDia: DD/MM/AAAA */
  chave: string
  /** `date` tal como está no 1.º registo */
  date: string
  jour: string
  /** todos os registos do dia, por ordem cronológica de início (sem hora válida: mantém a ordem original no fim) */
  registos: ServicoReg[]
  /** só os serviços de trabalho (TRAB/DEC) */
  trabalho: ServicoReg[]
  /** registos sem trabalho (OFF/RC/FERIE/FER) */
  outros: ServicoReg[]
}

/**
 * Agrupa por dia. A ORDEM dos dias é a da primeira aparição de cada dia na lista de entrada
 * (o histórico guarda o mais recente primeiro; assim a ordem dos cartões não muda).
 */
export function agruparPorDia(lista: ServicoReg[] | null | undefined, anoFallback: number = new Date().getFullYear()): DiaGrupo[] {
  const mapa = new Map<string, { ordem: number; regs: { r: ServicoReg; i: number }[] }>()
  const src = Array.isArray(lista) ? lista : []
  src.forEach((r, i) => {
    if (!r || typeof r !== 'object') return
    const k = chaveDia(r as any, anoFallback)
    const g = mapa.get(k)
    if (g) g.regs.push({ r, i })
    else mapa.set(k, { ordem: i, regs: [{ r, i }] })
  })
  const out: DiaGrupo[] = []
  for (const [chave, g] of mapa) {
    const regs = g.regs
      .map(x => ({ ...x, t: ehTrabalho(x.r) ? intervaloServico(x.r, anoFallback)?.inicio ?? null : null }))
      .sort((a, b) => {
        if (a.t !== null && b.t !== null) return a.t - b.t || a.i - b.i
        if (a.t !== null) return -1
        if (b.t !== null) return 1
        return a.i - b.i
      })
      .map(x => x.r)
    out.push({
      chave,
      date: String(regs[0].date ?? ''),
      jour: String(regs[0].jour ?? ''),
      registos: regs,
      trabalho: regs.filter(ehTrabalho),
      outros: regs.filter(r => !ehTrabalho(r)),
    })
  }
  return out
}

// ── Km ──────────────────────────────────────────────────────────────────────

/** Km de UM serviço, sem duplicar: com troca = km de A + km de B; sem troca = |fim − início| ou kmDiarios. */
export function kmDoServico(j: ServicoReg): number {
  if (!ehTrabalho(j)) return 0
  if (j.troca) {
    const soma = kmDoCamiao(j.troca.a.kmInicio, j.troca.a.kmFim) + kmDoCamiao(j.troca.b.kmInicio, j.troca.b.kmFim)
    if (soma > 0) return soma
    return Number(j.kmDiarios) > 0 ? Number(j.kmDiarios) : 0
  }
  const i = Number(j.kmInicio), f = Number(j.kmFim)
  if (i > 0 && f > 0) return Math.abs(f - i)
  return Number(j.kmDiarios) > 0 ? Number(j.kmDiarios) : 0
}

export type KmPorCamiao = { matricula: string; chave: string; km: number }

/**
 * Km por camião no dia. Com troca, cada parte vai para o SEU camião. Sem troca, vai para `camiao` do registo
 * (registos antigos não o têm: ficam em «sem matrícula», nunca misturados com outro camião).
 */
export function kmPorCamiaoDoDia(servicos: ServicoReg[]): KmPorCamiao[] {
  const mapa = new Map<string, KmPorCamiao>()
  const add = (matricula: string, km: number) => {
    if (!(km > 0)) return
    const chave = normalizarMatricula(matricula)
    const atual = mapa.get(chave)
    if (atual) atual.km += km
    else mapa.set(chave, { matricula: chave ? matricula.trim() : '', chave, km })
  }
  for (const s of servicos) {
    if (!ehTrabalho(s)) continue
    if (s.troca) {
      const kmA = kmDoCamiao(s.troca.a.kmInicio, s.troca.a.kmFim)
      const kmB = kmDoCamiao(s.troca.b.kmInicio, s.troca.b.kmFim)
      if (kmA + kmB > 0) { add(s.troca.a.camiao.value, kmA); add(s.troca.b.camiao.value, kmB); continue }
    }
    add(s.camiao?.value ?? '', kmDoServico(s))
  }
  return Array.from(mapa.values())
}

/** Camiões distintos usados no dia (matrícula normalizada), pela ordem em que aparecem. */
export function camioesDoDia(servicos: ServicoReg[]): string[] {
  const vistos = new Set<string>()
  const out: string[] = []
  const push = (v: string | undefined | null) => {
    const k = normalizarMatricula(v)
    if (k && !vistos.has(k)) { vistos.add(k); out.push(String(v).trim()) }
  }
  for (const s of servicos) {
    if (!ehTrabalho(s)) continue
    if (s.troca) { push(s.troca.a.camiao.value); push(s.troca.b.camiao.value) } else push(s.camiao?.value)
  }
  return out
}

// ── Resumo do dia ───────────────────────────────────────────────────────────

export type ResumoDia = {
  chave: string
  nServicos: number
  /** soma do tempo de serviço dos serviços */
  servicoSeg: number
  /** soma das pausas DENTRO dos serviços (o intervalo entre serviços NÃO está aqui) */
  pausaSeg: number
  /** do início do 1.º ao fim do último serviço (linha temporal real); null se faltarem horas */
  amplitudeSeg: number | null
  /** tempo entre o fim de um serviço e o início do seguinte (não é pausa nem repouso regulamentar) */
  intervaloEntreServicosSeg: number
  /** serviços com horários sobrepostos (dado suspeito; o intervalo conta 0) */
  temSobreposicao: boolean
  debut: string
  fin: string
  km: number
  kmPorCamiao: KmPorCamiao[]
  camioes: string[]
  decouche: boolean
  /** frais do DIA (nunca a soma dos frais dos serviços) */
  frais: number
  /** o valor de frais do dia vem de um ajuste manual do motorista (não do cálculo automático) */
  fraisManual: boolean
}

export type OpcoesResumo = {
  regles?: Partial<FraisRegles> | null
  valeurs?: Partial<FraisValeurs> | null
  /** o dia anterior foi découché (pequeno-almoço) */
  prevDecouche?: boolean
  anoFallback?: number
}

/** Dia com 2+ serviços em que algum tem frais ajustados à mão pelo motorista. */
export function temFraisManual(g: DiaGrupo): boolean {
  return g.trabalho.length >= 2 && g.trabalho.some(s => s.fraisManual === true)
}

/**
 * Frais do dia. Dia de serviço único: o valor guardado no registo (comportamento de sempre).
 * Vários serviços: calculados UMA vez sobre o dia (1.º início, serviço total, découché se algum) — o direito
 * depende do dia e não do número de serviços.
 */
export function fraisDoDia(g: DiaGrupo, o: OpcoesResumo = {}): number {
  if (g.trabalho.length === 0) return 0
  if (g.trabalho.length === 1) return Number(g.trabalho[0].frais) || 0
  // Ajuste manual do motorista (ver `fraisManual`) tem prioridade sobre o cálculo: nunca é substituído em silêncio.
  // O valor é o do DIA: com vários serviços marcados como manuais usa-se o MAIOR (não se somam: seria contar o dia duas vezes).
  const manuais = g.trabalho.filter(s => s.fraisManual === true)
  if (manuais.length > 0) return Math.max(...manuais.map(s => Number(s.frais) || 0))
  const servico = g.trabalho.reduce((a, s) => a + (Number(s.segServico) || 0), 0)
  const pausa = g.trabalho.reduce((a, s) => a + (Number(s.segPausa) || 0), 0)
  const dec = g.trabalho.some(s => !!s.decouche || s.type === 'DEC' || s.type === 'dec')
  return calcularFraisJour({
    type: dec ? 'DEC' : 'TRAB',
    debut: g.trabalho[0].debut,
    fin: g.trabalho[g.trabalho.length - 1].fin,
    segServico: servico,
    segPausa: pausa,
    decouche: dec,
    prevDecouche: !!o.prevDecouche,
    regles: o.regles ?? null,
    valeurs: o.valeurs ?? null,
  }).total
}

/**
 * Intervalos entre serviços consecutivos do dia (fim de um → início do seguinte), por ordem. Só entram intervalos > 0 entre serviços
 * que NÃO se sobrepõem. NÃO têm classificação regulamentar: não são pausa nem repouso até o motorista o confirmar.
 * `de`/`para` = número (1-based) dos serviços do dia.
 */
export function intervalosDoDia(g: DiaGrupo, anoFallback: number = new Date().getFullYear()): { de: number; para: number; seg: number }[] {
  const t = g.trabalho
  const ivs = t.map(s => intervaloServico(s, anoFallback))
  const out: { de: number; para: number; seg: number }[] = []
  if (t.length < 2 || ivs.some(x => x === null)) return out
  const iv = ivs as IntervaloMs[]
  let fimAnterior = iv[0].fim
  for (let i = 1; i < iv.length; i++) {
    const seg = Math.round((iv[i].inicio - fimAnterior) / 1000)
    if (seg > 0) out.push({ de: i, para: i + 1, seg })
    fimAnterior = Math.max(fimAnterior, iv[i].fim)
  }
  return out
}

export function resumoDia(g: DiaGrupo, o: OpcoesResumo = {}): ResumoDia {
  const ano = o.anoFallback ?? new Date().getFullYear()
  const t = g.trabalho
  const ivs = t.map(s => intervaloServico(s, ano))
  let amplitudeSeg: number | null = null
  let gaps = 0
  let sobreposicao = false
  if (t.length > 0 && ivs.every(x => x !== null)) {
    const iv = ivs as IntervaloMs[]
    const ini = Math.min(...iv.map(x => x.inicio))
    const fim = Math.max(...iv.map(x => x.fim))
    amplitudeSeg = Math.round((fim - ini) / 1000)
    let fimAnterior = iv[0].fim
    for (let i = 1; i < iv.length; i++) {
      if (iv[i].inicio < fimAnterior) sobreposicao = true
      else gaps += Math.round((iv[i].inicio - fimAnterior) / 1000)
      fimAnterior = Math.max(fimAnterior, iv[i].fim)
    }
  }
  const kms = kmPorCamiaoDoDia(t)
  return {
    chave: g.chave,
    nServicos: t.length,
    servicoSeg: t.reduce((a, s) => a + (Number(s.segServico) || 0), 0),
    pausaSeg: t.reduce((a, s) => a + (Number(s.segPausa) || 0), 0),
    amplitudeSeg,
    intervaloEntreServicosSeg: gaps,
    temSobreposicao: sobreposicao,
    debut: t.length ? String(t[0].debut ?? '') : '',
    fin: t.length ? String(t[t.length - 1].fin ?? '') : '',
    km: t.reduce((a, s) => a + kmDoServico(s), 0),
    kmPorCamiao: kms,
    camioes: camioesDoDia(t),
    decouche: t.some(s => !!s.decouche || s.type === 'DEC' || s.type === 'dec'),
    frais: fraisDoDia(g, o),
    fraisManual: temFraisManual(g),
  }
}


/**
 * Frais (ptd/dej/din/nui) de um dia. Dia com um só serviço: exatamente o cálculo por registo de sempre.
 * Vários serviços: UM cálculo sobre o dia (1.º início, serviço total, découché se algum).
 */
export function fraisDetalheDoGrupo(g: DiaGrupo, o: OpcoesResumo = {}): FraisJourResult {
  const base = { regles: o.regles ?? null, valeurs: o.valeurs ?? null, prevDecouche: !!o.prevDecouche }
  if (g.trabalho.length <= 1) {
    const j = g.trabalho[0] ?? g.registos[0]
    return calcularFraisJour({ ...base, type: j?.type, debut: j?.debut, fin: j?.fin, segServico: Number(j?.segServico) || 0, decouche: !!j?.decouche })
  }
  const dec = g.trabalho.some(s => !!s.decouche || s.type === 'DEC' || s.type === 'dec')
  return calcularFraisJour({
    ...base,
    type: dec ? 'DEC' : 'TRAB',
    debut: g.trabalho[0].debut,
    fin: g.trabalho[g.trabalho.length - 1].fin,
    segServico: g.trabalho.reduce((a, s) => a + (Number(s.segServico) || 0), 0),
    segPausa: g.trabalho.reduce((a, s) => a + (Number(s.segPausa) || 0), 0),
    decouche: dec,
  })
}

/**
 * Valor de frais do grupo para os totais que somam `frais` guardados. Dia de serviço único (ou sem trabalho):
 * a soma dos `frais` dos registos, como sempre. Vários serviços: frais do DIA (uma vez) + `frais` dos registos sem trabalho.
 */
export function fraisTotalDoGrupo(g: DiaGrupo, o: OpcoesResumo = {}): number {
  if (g.trabalho.length <= 1) return g.registos.reduce((a, r) => a + (Number(r.frais) || 0), 0)
  return fraisDoDia(g, o) + g.outros.reduce((a, r) => a + (Number(r.frais) || 0), 0)
}

/** Soma de frais por dia (sem duplicar) para uma lista de registos. */
export function somaFraisPorDia(lista: ServicoReg[], o: OpcoesResumo & { prevDecouche?: (g: DiaGrupo) => boolean } = {}): number {
  return agruparPorDia(lista, o.anoFallback).reduce(
    (a, g) => a + fraisDoDia(g, { ...o, prevDecouche: o.prevDecouche ? (o as any).prevDecouche(g) : false }), 0)
}

/** Número de DIAS de trabalho distintos (não de serviços). */
export function diasDeTrabalho(lista: ServicoReg[], anoFallback?: number): number {
  return agruparPorDia(lista, anoFallback).filter(g => g.trabalho.length > 0).length
}

// ── Vista por DIA para estatísticas (só leitura) ────────────────────────────

const chaveAnterior = (chave: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(chave)
  if (!m) return null
  const d = new Date(+m[3], +m[2] - 1, +m[1] - 1)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/**
 * Vista para ESTATÍSTICAS (devolve cópia; nunca altera nem grava): cada dia com 2+ serviços de trabalho passa a UM registo do dia
 * (1.º início → último fim, serviço e pausas somados, découché se algum, km somados sem duplicar, frais do DIA calculados uma só vez,
 * `id` do 1.º serviço, `servicosNoDia`). Dias de serviço único e registos sem trabalho passam inalterados (mesma referência).
 * Serviços idênticos (mesmo início, fim e tempo de serviço) contam uma só vez (cópias antigas do mesmo serviço).
 * NÃO usar para o motor salarial (precisa dos serviços separados para as horas noturnas).
 */
export function colapsarServicosDoDia<T extends ServicoReg>(lista: T[] | null | undefined, o: OpcoesResumo = {}): T[] {
  const src = Array.isArray(lista) ? lista : []
  const ano = o.anoFallback ?? new Date().getFullYear()
  const grupos = agruparPorDia(src, ano)
  const porChave = new Map(grupos.map(g => [g.chave, g] as const))
  const decouchou = new Set(grupos.filter(g => g.trabalho.some(s => !!s.decouche || s.type === 'DEC' || s.type === 'dec')).map(g => g.chave))
  const emitidos = new Set<string>()
  const vistos = new Set<string>()   // chave|debut|fin|seg dos serviços já contados
  const out: T[] = []
  for (const r of src) {
    if (!r || typeof r !== 'object') continue
    if (!ehTrabalho(r)) { out.push(r); continue }
    const k = chaveDia(r as any, ano)
    const g = porChave.get(k)
    const ident = `${k}|${r.debut}|${r.fin}|${Number(r.segServico) || 0}`
    if (vistos.has(ident)) continue          // cópia do mesmo serviço
    vistos.add(ident)
    if (!g) { out.push(r); continue }
    // serviços distintos do dia (sem cópias idênticas)
    const vi = new Set<string>()
    const distintos = g.trabalho.filter(s => { const i = `${s.debut}|${s.fin}|${Number(s.segServico) || 0}`; if (vi.has(i)) return false; vi.add(i); return true })
    if (distintos.length < 2) { out.push(r); continue }
    if (emitidos.has(k)) continue
    emitidos.add(k)
    const gd: DiaGrupo = { ...g, registos: distintos, trabalho: distintos }
    const ante = chaveAnterior(k)
    const resumo = resumoDia(gd, { ...o, anoFallback: ano, prevDecouche: o.prevDecouche ?? (ante ? decouchou.has(ante) : false) })
    out.push({
      ...(distintos[0] as T),
      type: resumo.decouche ? 'DEC' : 'TRAB',
      debut: resumo.debut,
      fin: resumo.fin,
      segServico: resumo.servicoSeg,
      segPausa: resumo.pausaSeg,
      decouche: resumo.decouche,
      kmDiarios: resumo.km,
      kmInicio: 0,
      kmFim: 0,
      troca: undefined,
      frais: resumo.frais,
      fraisManual: resumo.fraisManual ? true : undefined,
      servicosNoDia: resumo.nServicos,
    })
  }
  return out
}

// ── Itens da lista do Historique ────────────────────────────────────────────

export type ItemDia<T extends ServicoReg = ServicoReg> =
  | { tipo: 'um'; jour: T }
  | { tipo: 'dia'; chave: string; grupo: DiaGrupo; resumo: ResumoDia; ids: string[] }

/**
 * Lista do Historique: dias de serviço único = o registo de sempre (`um`); dias com 2+ serviços = UM cartão do dia (`dia`),
 * na posição do 1.º serviço desse dia. Registos sem trabalho do mesmo dia continuam como itens próprios. Não altera a entrada.
 */
export function itensPorDia<T extends ServicoReg>(
  lista: T[],
  o: OpcoesResumo & { prevDecoucheDe?: (g: DiaGrupo) => boolean } = {},
): ItemDia<T>[] {
  const ano = o.anoFallback ?? new Date().getFullYear()
  const multi = new Map<string, DiaGrupo>()
  agruparPorDia(lista, ano).forEach(g => { if (g.trabalho.length >= 2) multi.set(g.chave, g) })
  if (multi.size === 0) return lista.map(jour => ({ tipo: 'um' as const, jour }))
  const emitidos = new Set<string>()
  const out: ItemDia<T>[] = []
  for (const jour of lista) {
    const g = multi.get(chaveDia(jour as any, ano))
    if (g && ehTrabalho(jour)) {
      if (!emitidos.has(g.chave)) {
        emitidos.add(g.chave)
        const resumo = resumoDia(g, { ...o, anoFallback: ano, prevDecouche: o.prevDecoucheDe ? o.prevDecoucheDe(g) : !!o.prevDecouche })
        out.push({ tipo: 'dia', chave: g.chave, grupo: g, resumo, ids: g.trabalho.map(s => String(s.id)) })
      }
      continue
    }
    out.push({ tipo: 'um', jour })
  }
  return out
}

// ── Repouso entre DIAS ──────────────────────────────────────────────────────

export type RepousoEntreDias = { de: string; para: string; gapH: number }

/**
 * Repouso entre o FIM do último serviço de um dia e o INÍCIO do primeiro do dia de trabalho seguinte.
 * O intervalo entre dois serviços do MESMO dia nunca é avaliado aqui (não é repouso diário).
 */
export function repousosEntreDias(lista: ServicoReg[], anoFallback: number = new Date().getFullYear()): RepousoEntreDias[] {
  const dias = agruparPorDia(lista, anoFallback)
    .filter(g => g.trabalho.length > 0)
    .map(g => {
      const ivs = g.trabalho.map(s => intervaloServico(s, anoFallback)).filter((x): x is IntervaloMs => x !== null)
      if (ivs.length === 0) return null
      return { chave: g.chave, inicio: Math.min(...ivs.map(x => x.inicio)), fim: Math.max(...ivs.map(x => x.fim)) }
    })
    .filter((x): x is { chave: string; inicio: number; fim: number } => x !== null)
    .sort((a, b) => a.inicio - b.inicio)
  const out: RepousoEntreDias[] = []
  for (let i = 0; i < dias.length - 1; i++) {
    out.push({ de: dias[i].chave, para: dias[i + 1].chave, gapH: (dias[i + 1].inicio - dias[i].fim) / 3_600_000 })
  }
  return out
}

// ── Gravação sem substituição ───────────────────────────────────────────────

export type PlanoGravacao =
  /** acrescenta `lista` (já com o novo no topo); `arquivar` = registos de «dia sem trabalho» que o novo serviço substitui */
  | { acao: 'inserir'; lista: ServicoReg[]; arquivar: ServicoReg[] }
  /** o mesmo serviço já existe: nada a fazer (ou atualização do mesmo id) */
  | { acao: 'mesmo_servico'; lista: ServicoReg[]; existente: ServicoReg }
  /** identidade ambígua: NADA foi decidido; a interface tem de pedir a resolução */
  | { acao: 'ambiguo'; motivo: 'mesmo_inicio' | 'sobreposicao' | 'dia_com_servicos'; conflitos: ServicoReg[] }

export type ResolucaoAmbiguo = 'manter_ambos' | 'substituir'

const mesmaHora = (a?: string, b?: string) => {
  const x = minutosDe(a), y = minutosDe(b)
  return x !== null && y !== null && x === y
}

/**
 * Decide como gravar `novo` sem nunca substituir automaticamente um serviço.
 *  • outro serviço no mesmo dia, horário diferente e sem sobreposição → `inserir` (ambos ficam);
 *  • mesmo `id` → `mesmo_servico` (atualiza o registo em causa, sem duplicar);
 *  • mesmo dia, início e fim iguais, e mesmo tempo de serviço → `mesmo_servico` (regravação; lista inalterada);
 *  • mesmo início com fim/serviço diferente, ou horários sobrepostos → `ambiguo`;
 *  • dia só com registos «sem trabalho» (OFF/RC/FERIE/FER) + novo serviço → `inserir` e esses registos vão para `arquivar`;
 *  • novo registo «sem trabalho» num dia que já tem serviços → `ambiguo`.
 */
export function planearGravacao(lista: ServicoReg[], novo: ServicoReg, anoFallback: number = new Date().getFullYear()): PlanoGravacao {
  const base = Array.isArray(lista) ? lista : []
  const idx = base.findIndex(r => r && String(r.id) === String(novo.id))
  if (idx >= 0) {
    const copia = base.slice()
    copia[idx] = { ...base[idx], ...novo }
    return { acao: 'mesmo_servico', lista: copia, existente: base[idx] }
  }
  const chave = chaveDia(novo as any, anoFallback)
  const mesmoDia = base.filter(r => r && chaveDia(r as any, anoFallback) === chave)
  const trabalhoDia = mesmoDia.filter(ehTrabalho)
  const outrosDia = mesmoDia.filter(r => !ehTrabalho(r))

  if (!ehTrabalho(novo)) {
    if (trabalhoDia.length > 0) return { acao: 'ambiguo', motivo: 'dia_com_servicos', conflitos: trabalhoDia }
    const restantes = base.filter(r => !outrosDia.includes(r))
    if (outrosDia.length === 1 && outrosDia[0].type === novo.type) {
      return { acao: 'mesmo_servico', lista: base.slice(), existente: outrosDia[0] }
    }
    return { acao: 'inserir', lista: [novo, ...restantes], arquivar: outrosDia }
  }

  const ivNovo = intervaloServico(novo, anoFallback)
  for (const e of trabalhoDia) {
    const iguais = mesmaHora(e.debut, novo.debut) && mesmaHora(e.fin, novo.fin)
    if (iguais) {
      if ((Number(e.segServico) || 0) === (Number(novo.segServico) || 0)) return { acao: 'mesmo_servico', lista: base.slice(), existente: e }
      return { acao: 'ambiguo', motivo: 'mesmo_inicio', conflitos: [e] }
    }
    if (mesmaHora(e.debut, novo.debut)) return { acao: 'ambiguo', motivo: 'mesmo_inicio', conflitos: [e] }
    const iv = intervaloServico(e, anoFallback)
    if (iv && ivNovo && iv.inicio < ivNovo.fim && ivNovo.inicio < iv.fim) return { acao: 'ambiguo', motivo: 'sobreposicao', conflitos: [e] }
  }
  const restantes = base.filter(r => !outrosDia.includes(r))
  return { acao: 'inserir', lista: [novo, ...restantes], arquivar: outrosDia }
}

/** Aplica a resolução EXPLÍCITA de um conflito ambíguo. `substituir` devolve também o que deve ser arquivado. */
export function aplicarResolucao(
  lista: ServicoReg[], novo: ServicoReg, conflitos: ServicoReg[], r: ResolucaoAmbiguo,
): { lista: ServicoReg[]; arquivar: ServicoReg[] } {
  if (r === 'manter_ambos') return { lista: [novo, ...lista], arquivar: [] }
  const ids = new Set(conflitos.map(c => String(c.id)))
  return { lista: [novo, ...lista.filter(x => !ids.has(String(x.id)))], arquivar: conflitos }
}

/** Remove UM serviço pelo `id` (os restantes do mesmo dia ficam). */
export const removerServico = (lista: ServicoReg[], id: string): ServicoReg[] => lista.filter(r => String(r.id) !== String(id))

/** Altera UM serviço pelo `id` (os restantes do mesmo dia ficam intactos). */
export const alterarServico = (lista: ServicoReg[], id: string, alt: Partial<ServicoReg>): ServicoReg[] =>
  lista.map(r => (String(r.id) === String(id) ? { ...r, ...alt } : r))
