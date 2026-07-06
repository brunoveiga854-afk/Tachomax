// src/utils/calculos.ts
// Utilitários puros extraídos de fiche.tsx — sem dependências React

import { calcularFraisJour, isJourTravailFrais, isJourSansFrais } from '../frais'

/** Subconjunto do Padrao necessário para calcular frais por horários */
export type PadraoFrais = {
  ptd: number
  dej: number
  din: number
  nui: number
  regles?: { ptDejAte: number; dejMinAmp: number; dinerDe: number } | null
}

// ── shiftMois ─────────────────────────────────────────────────────────────────
export const shiftMois = (ano: number, mes: number, delta: number): [number, number] => {
  let m = mes + delta, a = ano
  while (m < 0) { m += 12; a-- }
  while (m > 11) { m -= 12; a++ }
  return [a, m]
}

// ── calcFraisHorario ──────────────────────────────────────────────────────────
export function calcFraisHorario(
  type: string,
  inicio: string,
  fim: string,
  prevDec: boolean,
  p: PadraoFrais,
  segServico?: number,
  decouche?: boolean,
): { ptd: number; dej: number; din: number; nui: number; total: number } {
  return calcularFraisJour({
    type,
    debut: inicio,
    fin: fim,
    prevDecouche: prevDec,
    segServico,
    decouche,
    regles: p.regles,
    valeurs: { ptDej: p.ptd, dej: p.dej, diner: p.din, nuit: p.nui },
  })
}

// ── calcFraisMesPorHorarios ───────────────────────────────────────────────────
export function calcFraisMesPorHorarios(
  hist: any[],
  ano: number,
  mes: number,
  p: PadraoFrais
): { total: number; ptd: number; dej: number; din: number; nui: number } {
  const diasMes = hist
    .filter((j: any) => {
      const parts = j.date?.split('/')
      if (!parts || parts.length < 2) return false
      const m = parseInt(parts[1]) - 1
      const a = j.id ? new Date(parseInt(j.id)).getFullYear() : ano
      return m === mes && a === ano
    })
    .sort((a: any, b: any) => {
      const da = parseInt(a.date?.split('/')[0] || '0')
      const db = parseInt(b.date?.split('/')[0] || '0')
      return da - db
    })

  let total = 0, ptd = 0, dej = 0, din = 0, nui = 0
  const normTime = (t: string) => t ? t.replace('h', ':') : ''

  for (let i = 0; i < diasMes.length; i++) {
    const j = diasMes[i]
    const type = j.type || 'TRAB'
    const prevDec = i > 0 && ['dec', 'DEC'].includes(diasMes[i - 1].type || '') && !isJourSansFrais(type)

    if (isJourTravailFrais(type)) {
      const debut = normTime(j.debut || j.inicio || '')
      const fin = normTime(j.fin || j.fim || '')
      if (debut && fin) {
        const f = calcFraisHorario(type, debut, fin, prevDec, p, j.segServico || 0, !!j.decouche)
        total += f.total; ptd += f.ptd; dej += f.dej; din += f.din; nui += f.nui
      } else if (j.frais != null && j.frais > 0) {
        total += j.frais
        ptd += 1
      }
    }
  }

  return { total, ptd, dej, din, nui }
}
