/**
 * ROUTEMAX — Motor de Frais
 * Calcula automaticamente os frais com base no horário real
 * Valores base da convention collective — substituídos pelos da fiche de paye
 */

export type FraisConfig = {
  casseCroute: number      // Prise de service avant 5h
  petitDejeuner: number    // Prise de service avant 6h
  repasMidi: number        // Repas pendant service
  repasSoir: number        // Fin de service tardive
  repasNuit: number        // 4h+ entre 22h et 7h
  decouche: number         // Nuit hors domicile
}

// Valeurs convention collective 2025 (remplacées par upload fiche)
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

/**
 * Calcule les frais selon l'heure de début, de fin et le découché
 */
export function calculerFrais(
  heureDebut: Date,
  heureFin: Date,
  decouche: boolean,
  config: FraisConfig = FRAIS_DEFAULT
): FraisResult {
  const debut = heureDebut.getHours() * 60 + heureDebut.getMinutes()
  const fin = heureFin.getHours() * 60 + heureFin.getMinutes()
  const dureeService = (heureFin.getTime() - heureDebut.getTime()) / 60000 // minutes

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

  // 🌙 Casse-croûte — prise de service avant 5h00
  if (debut < 5 * 60) {
    result.casseCroute = true
    result.total += config.casseCroute
    result.detail.push(`Casse-croûte +${config.casseCroute.toFixed(2)}€`)
  }

  // 🌅 Petit déjeuner — prise de service avant 6h00
  else if (debut < 6 * 60) {
    result.petitDejeuner = true
    result.total += config.petitDejeuner
    result.detail.push(`Petit déjeuner +${config.petitDejeuner.toFixed(2)}€`)
  }

  // 🍽️ Repas midi — service couvre la période 11h-14h (au moins 1h)
  const couvreRepas = (debut <= 11 * 60 && fin >= 12 * 60) ||
                      (debut <= 13 * 60 && fin >= 14 * 60)
  if (couvreRepas && dureeService >= 60) {
    result.repasMidi = true
    result.total += config.repasMidi
    result.detail.push(`Repas midi +${config.repasMidi.toFixed(2)}€`)
  }

  // 🌆 Repas soir — fin de service après 19h30
  if (fin >= 19 * 60 + 30 && !decouche) {
    result.repasSoir = true
    result.total += config.repasSoir
    result.detail.push(`Repas soir +${config.repasSoir.toFixed(2)}€`)
  }

  // 🌙 Repas nuit — 4h+ de travail entre 22h et 7h
  const heuresNuit = calculerHeuresNuit(heureDebut, heureFin)
  if (heuresNuit >= 4 * 60) {
    result.repasNuit = true
    result.total += config.repasNuit
    result.detail.push(`Repas nuit +${config.repasNuit.toFixed(2)}€`)
  }

  // 🛏️ Découché — toggle manuel
  if (decouche) {
    result.decouche = true
    result.total += config.decouche
    result.detail.push(`Découché +${config.decouche.toFixed(2)}€`)
  }

  return result
}

/**
 * Calcule les minutes travaillées entre 21h et 6h
 */
function calculerHeuresNuit(debut: Date, fin: Date): number {
  let minutesNuit = 0
  const current = new Date(debut)

  while (current < fin) {
    const h = current.getHours()
    if (h >= 21 || h < 6) {
      minutesNuit++
    }
    current.setMinutes(current.getMinutes() + 1)
  }

  return minutesNuit
}
