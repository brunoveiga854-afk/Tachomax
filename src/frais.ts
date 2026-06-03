export type FraisJourType = 'TRAB' | 'DEC' | 'FER' | 'FERIE' | 'RC' | 'OFF' | 'work' | 'dec' | string

export type FraisRegles = {
  ptDejAte: number
  dejMinAmp: number
  dinerDe: number
}

export type FraisValeurs = {
  ptDej: number
  dej: number
  diner: number
  nuit: number
}

export type CalculerFraisJourInput = {
  type?: FraisJourType
  debut?: string | null
  fin?: string | null
  segServico?: number
  segPausa?: number
  decouche?: boolean
  prevDecouche?: boolean
  regles?: Partial<FraisRegles> | null
  valeurs?: Partial<FraisValeurs> | null
}

export type FraisJourResult = {
  ptd: number
  dej: number
  din: number
  nui: number
  total: number
  details: string[]
}

export const DEFAULT_FRAIS_REGLES: FraisRegles = {
  ptDejAte: 6.0,
  dejMinAmp: 6.017,
  dinerDe: 21.25,
}

export const DEFAULT_FRAIS_VALEURS: FraisValeurs = {
  ptDej: 4.42,
  dej: 16.36,
  diner: 23.94,
  nuit: 23.94,
}

export const TYPES_TRAVAIL_FRAIS = ['TRAB', 'DEC', 'work', 'dec']
export const TYPES_SANS_FRAIS = ['OFF', 'RC', 'FERIE', 'FER', 'vac', 'CONGE', 'FERIADO', 'hol']

const emptyResult = (): FraisJourResult => ({ ptd: 0, dej: 0, din: 0, nui: 0, total: 0, details: [] })

const valNumber = (v: unknown, fallback: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

const valPositive = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function sanitizeFraisRegles(
  raw: Partial<FraisRegles> | null | undefined = {},
  fallback: Partial<FraisRegles> = DEFAULT_FRAIS_REGLES
): FraisRegles {
  return {
    ptDejAte: valNumber(raw?.ptDejAte, fallback.ptDejAte ?? DEFAULT_FRAIS_REGLES.ptDejAte, 5, 8),
    dejMinAmp: valNumber(raw?.dejMinAmp, fallback.dejMinAmp ?? DEFAULT_FRAIS_REGLES.dejMinAmp, 4, 8),
    dinerDe: valNumber(raw?.dinerDe, fallback.dinerDe ?? DEFAULT_FRAIS_REGLES.dinerDe, 18, 23),
  }
}

export function sanitizeFraisValeurs(
  raw: Partial<FraisValeurs> | null | undefined = {},
  fallback: Partial<FraisValeurs> = DEFAULT_FRAIS_VALEURS
): FraisValeurs {
  return {
    ptDej: valPositive(raw?.ptDej, fallback.ptDej ?? DEFAULT_FRAIS_VALEURS.ptDej),
    dej: valPositive(raw?.dej, fallback.dej ?? DEFAULT_FRAIS_VALEURS.dej),
    diner: valPositive(raw?.diner, fallback.diner ?? DEFAULT_FRAIS_VALEURS.diner),
    nuit: valPositive(raw?.nuit, fallback.nuit ?? DEFAULT_FRAIS_VALEURS.nuit),
  }
}

export function isJourSansFrais(type?: FraisJourType) {
  return TYPES_SANS_FRAIS.includes(String(type || ''))
}

export function isJourTravailFrais(type?: FraisJourType) {
  return TYPES_TRAVAIL_FRAIS.includes(String(type || ''))
}

export function parseHeureToMinutes(value?: string | null): number | null {
  if (!value) return null
  const normalized = String(value).trim().replace('h', ':')
  const [hRaw, mRaw = '0'] = normalized.split(':')
  const h = parseInt(hRaw, 10)
  const m = parseInt(mRaw, 10)
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

const roundMoney = (v: number) => Math.round(v * 100) / 100

export function calcularFraisJour(input: CalculerFraisJourInput): FraisJourResult {
  const type = String(input.type || 'TRAB')
  const isDec = type === 'DEC' || type === 'dec' || !!input.decouche

  if (!isDec && isJourSansFrais(type)) return emptyResult()
  if (!isJourTravailFrais(type) && !isDec) return emptyResult()

  const regles = sanitizeFraisRegles(input.regles)
  const valeurs = sanitizeFraisValeurs(input.valeurs)
  const debutMin = parseHeureToMinutes(input.debut)
  const finMin = parseHeureToMinutes(input.fin)
  const serviceMin = Math.max(0, Math.floor((input.segServico || 0) / 60))
  const pauseMin = Math.max(0, Math.floor((input.segPausa || 0) / 60))
  const amplitudeMin = debutMin !== null && finMin !== null
    ? Math.max(0, finMin - debutMin)
    : serviceMin + pauseMin

  const ptd = (debutMin !== null && debutMin <= Math.round(regles.ptDejAte * 60)) || input.prevDecouche || isDec ? 1 : 0
  const dej = amplitudeMin >= Math.round(regles.dejMinAmp * 60) || isDec ? 1 : 0
  const din = (finMin !== null && finMin >= Math.round(regles.dinerDe * 60)) || isDec ? 1 : 0
  const nui = isDec ? 1 : 0

  const total = roundMoney(
    ptd * valeurs.ptDej +
    dej * valeurs.dej +
    din * valeurs.diner +
    nui * valeurs.nuit
  )

  const details: string[] = []
  if (ptd) details.push(`Pt.D +${valeurs.ptDej.toFixed(2)}`)
  if (dej) details.push(`Dejeuner +${valeurs.dej.toFixed(2)}`)
  if (din) details.push(`Diner +${valeurs.diner.toFixed(2)}`)
  if (nui) details.push(`Nuit +${valeurs.nuit.toFixed(2)}`)

  return { ptd, dej, din, nui, total, details }
}
