// src/engine/regras/tempo.ts
// Datas, horas e intervalos de serviço (incluindo passagem da meia-noite). Puro e determinístico.
//
// Convenção: todos os instantes são ms «de relógio de parede» construídos com Date.UTC, isto é, as horas
// locais são tratadas como contínuas. A mudança de hora (DST) NÃO é tratada: num dia de mudança de hora o
// resultado pode divergir 1h da realidade. O orquestrador regista isto como pressuposto.

export const MS_H = 3_600_000
export const MS_DIA = 24 * MS_H
export const SEG_H = 3600

/** «06h30», «6h30», «06:30», «06h» → minutos desde 00:00 (0–1439); inválido → null. */
export function parseHoraMin(s: string | null | undefined): number | null {
  if (typeof s !== 'string') return null
  const m = s.trim().match(/^(\d{1,2})\s*(?:h|:)\s*(\d{0,2})$/i)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = m[2] === '' ? 0 : parseInt(m[2], 10)
  if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) return null
  return h * 60 + min
}

export type DataDia = { ano: number; mes0: number; dia: number }

/** «DD/MM/AAAA» ou «DD/MM» (com ano de recurso explícito); inválido → null. */
export function parseData(s: string | null | undefined, anoRecurso?: number): DataDia | null {
  if (typeof s !== 'string') return null
  const p = s.trim().split('/')
  if (p.length < 2) return null
  const dia = parseInt(p[0], 10)
  const mes = parseInt(p[1], 10)
  const ano = p.length >= 3 ? parseInt(p[2], 10) : anoRecurso
  if (ano == null || !Number.isInteger(ano) || !Number.isInteger(dia) || !Number.isInteger(mes)) return null
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 2000 || ano > 2100) return null
  const t = Date.UTC(ano, mes - 1, dia)
  const d = new Date(t)
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return { ano, mes0: mes - 1, dia }
}

export const instanteMs = (d: DataDia, minutos: number): number => Date.UTC(d.ano, d.mes0, d.dia, 0, minutos)

export type IntervaloServico = { inicioMs: number; fimMs: number; atravessaMeiaNoite: boolean }

/**
 * Intervalo de um serviço a partir da data de INÍCIO e das horas «debut»/«fin».
 * fin < debut → termina no dia seguinte (passagem da meia-noite).
 * fin === debut é ambíguo (0h ou 24h) → não se adivinha: devolve { motivo }.
 */
export function intervaloServico(
  data: string | null | undefined,
  debut: string | null | undefined,
  fin: string | null | undefined,
  anoRecurso?: number,
): IntervaloServico | { motivo: string } {
  const d = parseData(data, anoRecurso)
  if (!d) return { motivo: 'data do serviço ausente ou inválida' }
  const i = parseHoraMin(debut)
  if (i === null) return { motivo: 'hora de início ausente ou inválida' }
  const f = parseHoraMin(fin)
  if (f === null) return { motivo: 'hora de fim ausente ou inválida' }
  if (f === i) return { motivo: 'início e fim iguais: duração ambígua (0h ou 24h)' }
  const inicioMs = instanteMs(d, i)
  const atravessa = f < i
  const fimMs = instanteMs(d, f) + (atravessa ? MS_DIA : 0)
  return { inicioMs, fimMs, atravessaMeiaNoite: atravessa }
}

export const duracaoSeg = (iv: { inicioMs: number; fimMs: number }): number => Math.max(0, Math.round((iv.fimMs - iv.inicioMs) / 1000))

// ── Janela noturna 00h00–05h00 (L3312-1: «entre 24h et 5h») ───────────────────

export const NOITE_INICIO_MIN = 0
export const NOITE_FIM_MIN = 5 * 60

const inicioDiaMs = (ms: number): number => Math.floor(ms / MS_DIA) * MS_DIA

/** Primeira janela [00:00, 05:00) que se sobrepõe a [inicioMs, fimMs); null se nenhuma. */
export function primeiraJanelaNoturna(inicioMs: number, fimMs: number): { n0: number; n1: number } | null {
  if (!(fimMs > inicioMs)) return null
  for (let dia = inicioDiaMs(inicioMs); dia < fimMs; dia += MS_DIA) {
    const n0 = dia + NOITE_INICIO_MIN * 60_000
    const n1 = dia + NOITE_FIM_MIN * 60_000
    if (n0 < fimMs && n1 > inicioMs) return { n0, n1 }
  }
  return null
}

/** Minutos de [inicioMs, fimMs) que caem entre 00h00 e 05h00 (todas as noites tocadas). */
export function minutosNoturnos(inicioMs: number, fimMs: number): number {
  if (!(fimMs > inicioMs)) return 0
  let total = 0
  for (let dia = inicioDiaMs(inicioMs); dia < fimMs; dia += MS_DIA) {
    const a = Math.max(inicioMs, dia)
    const b = Math.min(fimMs, dia + NOITE_FIM_MIN * 60_000)
    if (b > a) total += (b - a) / 60_000
  }
  return Math.round(total)
}

/** Segunda-feira 00:00 (relógio de parede) da semana que contém `ms`. */
export function inicioSemanaMs(ms: number): number {
  const dia = inicioDiaMs(ms)
  const dow = new Date(dia).getUTCDay() // 0=dom … 6=sáb
  const desdeSegunda = (dow + 6) % 7
  return dia - desdeSegunda * MS_DIA
}

const dd = (n: number) => String(n).padStart(2, '0')
/** «HHhMM» ou «DD/MM HHhMM» (relógio de parede) – só para texto. */
export function formatarInstante(ms: number, comData = false): string {
  const d = new Date(ms)
  const hm = `${dd(d.getUTCHours())}h${dd(d.getUTCMinutes())}`
  return comData ? `${dd(d.getUTCDate())}/${dd(d.getUTCMonth() + 1)} ${hm}` : hm
}
