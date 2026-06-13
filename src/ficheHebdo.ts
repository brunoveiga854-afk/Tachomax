// ─── Fiche Hebdomadaire — gerador de PDF ────────────────────────────────────
// Fonte manuscrita azul = "Caveat" (Google Fonts, carregada inline)
// Layout: 2 páginas A4 — página 1: Lun/Mar/Mer, página 2: Jeu/Ven/Sam + Total

export interface JourFiche {
  date: string        // "DD/MM/YYYY"
  jourLabel: string   // "LUNDI" etc.
  jourCourt: string   // "L\nU\nN\nD\nI" etc.
  debut: string       // "06:30"
  fin: string         // "18:45"
  amplitude: string   // "12h15"
  pauseTotal: string  // "0h45"
  travailTotal: string // "11h30"
  kmDepart: string
  kmArrivee: string
  kmTotal: string
  petitDej: boolean
  repas: boolean
  nuit: boolean
  adr: boolean
  vehicule: string
  remorque: string
  commentaire: string
}

export interface InfoFiche {
  nom: string
  prenom: string
  semaine: number
  dateDebut: string   // "DD/MM/YYYY"
  dateFin: string
  jours: JourFiche[]  // 6 jours: lun→sam
  totalKms: string
  totalHeures: string
}

function fmtSec(s: number): string {
  if (!s || s <= 0) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h${String(m).padStart(2, '0')}`
}

function dayBlock(j: JourFiche, idx: number): string {
  const bg = idx % 2 === 0 ? '#fafafa' : '#fff'
  const [d, m, y] = j.date ? j.date.split('/') : ['', '', '']
  const dateVal = j.date ? `${d} / ${m} / ${y || ''}` : '&nbsp;&nbsp; / &nbsp;&nbsp; / &nbsp;&nbsp;&nbsp;&nbsp;'
  const chk = (v: boolean) => v ? '&#9746;' : '&#9744;'  // ☒ or ☐

  return `
  <div class="day-block" style="background:${bg}">
    <div class="day-row">
      <div class="day-label"><span class="day-vert">${j.jourCourt}</span></div>
      <div class="day-content">
        <div class="top-row">
          <div class="left-col">
            <div class="field-row">
              <span class="label">DATE :</span>
              <span class="hand">${dateVal}</span>
            </div>
            <div class="field-row">
              <span class="label">Véhicule :</span>
              <span class="hand">${j.vehicule}</span>
            </div>
            <div class="field-row">
              <span class="label">Remorque :</span>
              <span class="hand">${j.remorque}</span>
            </div>
            <div class="field-row">
              <span class="label">KM Arrivée :</span>
              <span class="hand">${j.kmArrivee}</span>
            </div>
            <div class="field-row">
              <span class="label">KM Départ :</span>
              <span class="hand">${j.kmDepart}</span>
            </div>
            <div class="field-row">
              <span class="label">TOTAL :</span>
              <span class="hand">${j.kmTotal}</span>
            </div>
            <div class="field-row">
              <span class="label">ADR</span>
              <span class="check">${chk(j.adr)}</span>
            </div>
            <div class="frais-row">
              <span class="label-sm">Petit Déjeuner :</span><span class="check">${chk(j.petitDej)}</span>
              <span class="label-sm">Repas :</span><span class="check">${chk(j.repas)}</span>
              <span class="label-sm">Nuit :</span><span class="check">${chk(j.nuit)}</span>
            </div>
          </div>
          <div class="right-col">
            <div class="field-row-r"><span class="label">Heure Fin :</span><span class="hand">${j.fin}</span></div>
            <div class="field-row-r"><span class="label">Heure Début :</span><span class="hand">${j.debut}</span></div>
            <div class="field-row-r"><span class="label">Amplitude :</span><span class="hand">${j.amplitude}</span></div>
            <div class="field-row-r"><span class="label">TOTAL Pause :</span><span class="hand">${j.pauseTotal}</span></div>
            <div class="field-row-r"><span class="label">TOTAL Travail :</span><span class="hand">${j.travailTotal}</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="comment-row">
      <span class="label">*COMMENTAIRES :</span>
      <span class="hand comment-text">${j.commentaire}</span>
    </div>
  </div>`
}

export function gerarHtmlFiche(info: InfoFiche): string {
  const page1Jours = info.jours.slice(0, 3)  // Lun, Mar, Mer
  const page2Jours = info.jours.slice(3, 6)  // Jeu, Ven, Sam

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; }
    .hand { font-family: 'Caveat', cursive; font-size: 15px; color: #1a3a8f; font-weight: 600; }
    .page { width: 210mm; min-height: 297mm; padding: 8mm 8mm 6mm 8mm; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .header { display: flex; justify-content: space-between; margin-bottom: 4mm; border-bottom: 1px solid #333; padding-bottom: 2mm; }
    .header-left { font-weight: bold; font-size: 13px; }
    .nom-row { display: flex; gap: 12mm; margin-bottom: 3mm; }
    .nom-field { display: flex; align-items: baseline; gap: 4px; }
    .day-block { border: 1px solid #555; margin-bottom: 3mm; }
    .day-row { display: flex; }
    .day-label { width: 12px; background: #e8e8e8; display: flex; align-items: center; justify-content: center; border-right: 1px solid #555; padding: 2px; }
    .day-vert { font-weight: bold; font-size: 8px; letter-spacing: 1px; writing-mode: vertical-rl; text-orientation: upright; }
    .day-content { flex: 1; padding: 2mm; }
    .top-row { display: flex; gap: 4mm; }
    .left-col { flex: 1.2; }
    .right-col { flex: 1; border-left: 1px solid #ccc; padding-left: 3mm; }
    .field-row { display: flex; align-items: baseline; margin-bottom: 1.5mm; gap: 3px; }
    .field-row-r { display: flex; align-items: baseline; margin-bottom: 2mm; gap: 3px; }
    .label { font-size: 9.5px; font-weight: bold; white-space: nowrap; }
    .label-sm { font-size: 8.5px; font-weight: bold; }
    .check { font-size: 13px; margin: 0 3px; }
    .frais-row { display: flex; align-items: center; gap: 2px; margin-top: 1mm; flex-wrap: wrap; }
    .comment-row { border-top: 1px solid #ccc; padding: 1mm 2mm; display: flex; align-items: baseline; gap: 4px; min-height: 7mm; }
    .comment-text { flex: 1; }
    .total-box { border: 1.5px solid #333; margin-top: 3mm; display: flex; }
    .total-left { flex: 1; padding: 2mm; border-right: 1px solid #333; }
    .total-right { flex: 1; padding: 2mm; }
    .total-title { font-weight: bold; font-size: 11px; margin-bottom: 2mm; }
    .obs-title { font-weight: bold; font-size: 11px; margin-bottom: 2mm; }
    .legend { font-size: 8px; margin-top: 3mm; border: 1px solid #333; padding: 1.5mm 2mm; }
  `

  const headerP1 = `
    <div class="header">
      <div class="header-left">FICHE HEBDOMADAIRE &nbsp; Semaine N° <span class="hand">${info.semaine}</span></div>
      <div>Du : <span class="hand">${info.dateDebut}</span> &nbsp;&nbsp; Au : <span class="hand">${info.dateFin}</span></div>
    </div>
    <div class="nom-row">
      <div class="nom-field"><span class="label">NOM :</span>&nbsp;<span class="hand">${info.nom}</span></div>
      <div class="nom-field"><span class="label">PRÉNOM :</span>&nbsp;<span class="hand">${info.prenom}</span></div>
    </div>`

  const totalBlock = `
    <div class="total-box">
      <div class="total-left">
        <div class="total-title">TOTAL SEMAINE</div>
        <div class="field-row"><span class="label">KMS :</span>&nbsp;<span class="hand">${info.totalKms}</span></div>
        <div class="field-row"><span class="label">HEURES :</span>&nbsp;<span class="hand">${info.totalHeures}</span></div>
      </div>
      <div class="total-right">
        <div class="obs-title">OBSERVATIONS :</div>
      </div>
    </div>
    <div class="legend">*COMMENTAIRES = Changements de véhicule / Panne / Temps Atelier / Temps Clio / Visite médicale / AUTRES</div>`

  const reglementBlock = `
    <div style="border:1px solid #555; padding:2mm; margin-bottom:3mm; font-size:9px;">
      <strong>Pour ma sécurité et celle des autres je m'engage à respecter la réglementation,</strong><br>
      - 4H30 de temps de conduite : 45 minutes de pause ou fractionné en 15 + 30 minutes<br>
      - &gt; 6H de temps de service : 30 minutes de pause - &gt; 9H de temps de service : 45 minutes de pause<br>
      Temps de service sur 1 semaine : 52/56 Heures – Temps de service journalier : 12 Heures maximum
    </div>`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>${css}</style></head>
<body>
  <div class="page">
    ${headerP1}
    ${reglementBlock}
    ${page1Jours.map((j, i) => dayBlock(j, i)).join('')}
  </div>
  <div class="page">
    ${headerP1}
    ${page2Jours.map((j, i) => dayBlock(j, i)).join('')}
    ${totalBlock}
  </div>
</body></html>`
}

export function getNumeroSemaine(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

export function getLundiDaSemana(semana: number, ano: number): Date {
  const simple = new Date(ano, 0, 1 + (semana - 1) * 7)
  const dow = simple.getDay()
  const lundi = new Date(simple)
  lundi.setDate(simple.getDate() - (dow === 0 ? 6 : dow - 1))
  return lundi
}
