/**
 * ROUTEMAX — Motor de Frais
 * Calcula automaticamente os frais com base no horário real
 * Valores base da convention collective — substituídos pelos da fiche de paye
 */

export type FraisConfig = {
  casseCroute: number
  petitDejeuner: number
  repasMidi: number
  repasSoir: number
  repasNuit: number
  decouche: number
}

export const FRAIS_DEFAULT: FraisConfig = {
  casseCroute: 8.87,
  petitDejeuner: 8.87,
  repasMidi: 15.96,
  repasSoir: 15.96,
  repasNuit: 9.81,
  decouche: 40.22,
}

export type FraisResult = {
  casseCroute: boolean
  petitDejeuner: boolean
  repasMidi: boolean
  repasSoir: boolean
  repasNuit: boolean
  decouche: boolean
  total: number
  detail: string[]
}

export function calculerFrais(
  heureDebut: Date,
  heureFin: Date,
  decouche: boolean,
  config: FraisConfig = FRAIS_DEFAULT
): FraisResult {
  const debut = heureDebut.getHours() * 60 + heureDebut.getMinutes()
  const fin = heureFin.getHours() * 60 + heureFin.getMinutes()
  const dureeService = (heureFin.getTime() - heureDebut.getTime()) / 60000

  const result: FraisResult = {
    casseCroute: false,
    petitDejeuner: false,
    repasMidi: false,
    repasSoir: false,
    repasNuit: false,
    decouche: false,
    total: 0,
    detail: [],
  }

  if (debut < 5 * 60) {
    result.casseCroute = true
    result.total += config.casseCroute
    result.detail.push(`Casse-croûte +${config.casseCroute.toFixed(2)}€`)
  } else if (debut < 6 * 60) {
    result.petitDejeuner = true
    result.total += config.petitDejeuner
    result.detail.push(`Petit déjeuner +${config.petitDejeuner.toFixed(2)}€`)
  }

  const couvreRepas = (debut <= 11 * 60 && fin >= 12 * 60) ||
                      (debut <= 13 * 60 && fin >= 14 * 60)
  if (couvreRepas && dureeService >= 60) {
    result.repasMidi = true
    result.total += config.repasMidi
    result.detail.push(`Repas midi +${config.repasMidi.toFixed(2)}€`)
  }

  if (fin >= 19 * 60 + 30 && !decouche) {
    result.repasSoir = true
    result.total += config.repasSoir
    result.detail.push(`Repas soir +${config.repasSoir.toFixed(2)}€`)
  }

  const heuresNuit = calculerHeuresNuit(heureDebut, heureFin)
  if (heuresNuit >= 4 * 60) {
    result.repasNuit = true
    result.total += config.repasNuit
    result.detail.push(`Repas nuit +${config.repasNuit.toFixed(2)}€`)
  }

  if (decouche) {
    result.decouche = true
    result.total += config.decouche
    result.detail.push(`Découché +${config.decouche.toFixed(2)}€`)
  }

  return result
}

function calculerHeuresNuit(debut: Date, fin: Date): number {
  let minutesNuit = 0
  const current = new Date(debut)
  while (current < fin) {
    const h = current.getHours()
    if (h >= 21 || h < 6) minutesNuit++
    current.setMinutes(current.getMinutes() + 1)
  }
  return minutesNuit
}
