// ─── Fiche Hebdomadaire — gerador de PDF ─────────────────────────────────────
// Layout identique au formulaire papier de l'entreprise
// Police : Montserrat (saisie machine), bleu foncé #1a3a8f
// Jours sans saisie : raye en diagonale

export interface JourFiche {
  date: string          // "DD/MM/YYYY"
  jourLabel: string     // "LUNDI" etc.
  jourCourt: string     // "LUNDI" etc. (utilisé pour le sidebar)
  debut: string         // "06h30"
  fin: string           // "18h45"
  amplitude: string     // "12h15"
  pauseTotal: string    // "0h45"
  travailTotal: string  // "11h30"
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

// Sidebar letters for each day
const SIDEBAR: Record<string, string[]> = {
  LUNDI:     ['L','U','N','D','I'],
  MARDI:     ['M','A','R','D','I'],
  MERCREDI:  ['M','E','R','C','R','E','D','I'],
  JEUDI:     ['J','E','U','D','I'],
  VENDREDI:  ['V','E','N','D','R','E','D','I'],
  SAMEDI:    ['S','A','M','E','D','I'],
}

function chk(v: boolean): string {
  // Real checkbox look
  return v
    ? `<span style="display:inline-block;width:11px;height:11px;border:1.5px solid #333;background:#1a3a8f;vertical-align:middle;position:relative;"><span style="color:white;font-size:9px;font-weight:900;position:absolute;top:-1px;left:1px;">✓</span></span>`
    : `<span style="display:inline-block;width:11px;height:11px;border:1.5px solid #333;background:white;vertical-align:middle;"></span>`
}

function val(v: string): string {
  if (!v) return ''
  return `<span class="filled">${v}</span>`
}

function underline(label: string, content: string, minWidth = '60px'): string {
  return `<span class="field-label">${label}</span><span class="underline" style="min-width:${minWidth}">${val(content)}</span>`
}

function dayBlock(j: JourFiche): string {
  const isEmpty = !j.date && !j.debut && !j.fin
  const letters = SIDEBAR[j.jourLabel] || j.jourLabel.split('')
  const sidebarHtml = letters.map(l =>
    `<div style="font-size:8px;font-weight:800;line-height:1.3;text-align:center;letter-spacing:0">${l}</div>`
  ).join('')

  const [dd, mm, yy] = j.date ? j.date.split('/') : ['', '', '']

  const innerContent = `
    <div style="position:relative;">
      ${isEmpty ? `<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:10;background:linear-gradient(to bottom right,transparent calc(50% - 0.7px),#999 calc(50% - 0.7px),#999 calc(50% + 0.7px),transparent calc(50% + 0.7px))"></div>` : ''}

      <!-- DATE row - full width -->
      <div style="border-bottom:1px solid #bbb;padding:2px 3mm;display:flex;align-items:baseline;gap:6px;">
        <span class="field-label">DATE :</span>
        <span class="filled" style="letter-spacing:1px">${dd ? `${dd} / ${mm} / ${yy}` : ''}</span>
      </div>

      <!-- Main grid: 3 columns -->
      <div style="display:flex;min-height:55px;">

        <!-- Col LEFT: Véhicule / Remorque / ADR / frais -->
        <div style="flex:1.15;padding:2px 3mm;border-right:1px solid #bbb;">
          <div class="row-field">${underline('Véhicule :', j.vehicule, '70px')}</div>
          <div class="row-field">${underline('Remorque :', j.remorque, '70px')}</div>
          <div class="row-field" style="align-items:center;">
            <span class="field-label">ADR</span>&nbsp;${chk(j.adr)}
          </div>
          <div class="row-field" style="align-items:center;flex-wrap:wrap;gap:4px;margin-top:2px;">
            <span class="field-label-sm">Petit Déjeuner :</span>${chk(j.petitDej)}
            &nbsp;<span class="field-label-sm">Repas :</span>${chk(j.repas)}
            &nbsp;<span class="field-label-sm">Nuit :</span>${chk(j.nuit)}
          </div>
        </div>

        <!-- Col MIDDLE: KMs -->
        <div style="flex:0.85;padding:2px 3mm;border-right:1px solid #bbb;">
          <div class="row-field">${underline('KM Arrivée :', j.kmArrivee, '55px')}</div>
          <div class="row-field">${underline('KM Départ :', j.kmDepart, '55px')}</div>
          <div class="row-field">${underline('TOTAL :', j.kmTotal, '55px')}</div>
        </div>

        <!-- Col RIGHT: Heures -->
        <div style="flex:1.05;padding:2px 3mm;">
          <div class="row-field">${underline('Heure Fin :', j.fin, '65px')}</div>
          <div class="row-field">${underline('Heure Début :', j.debut, '65px')}</div>
          <div class="row-field">${underline('Amplitude :', j.amplitude, '65px')}</div>
          <div class="row-field">${underline('TOTAL Pause :', j.pauseTotal, '65px')}</div>
          <div class="row-field">${underline('TOTAL Travail :', j.travailTotal, '65px')}</div>
        </div>

      </div>
    </div>`

  return `
  <div class="day-wrap">
    <!-- Sidebar -->
    <div class="day-sidebar">${sidebarHtml}</div>
    <!-- Content box -->
    <div class="day-box">${innerContent}</div>
  </div>
  <!-- Comment lines -->
  <div class="comment-area">
    <span class="field-label-sm">*COMMENTAIRES :</span>
    <span class="filled" style="font-size:11px;margin-left:4px">${j.commentaire || ''}</span>
    <div class="comment-line"></div>
    <div class="comment-line"></div>
    <div class="comment-line" style="margin-bottom:2mm"></div>
  </div>`
}

export function gerarHtmlFiche(info: InfoFiche): string {
  const page1Jours = info.jours.slice(0, 3)  // Lun, Mar, Mer
  const page2Jours = info.jours.slice(3, 6)  // Jeu, Ven, Sam

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap');
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #111; background: white; }
    .filled { font-family: 'Montserrat', sans-serif; font-size: 11px; color: #1a3a8f; font-weight: 600; }
    .page { width: 210mm; height: 297mm; padding: 7mm 7mm 6mm 7mm; position: relative; display: flex; flex-direction: column; box-sizing: border-box; page-break-after: always; break-after: page; }
    .page-break { page-break-before: always; break-before: page; }
    .days-area { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
    .signature { position: absolute; bottom: 3mm; right: 7mm; font-size: 7px; color: #bbb; letter-spacing: 0.3px; font-family: 'Montserrat', sans-serif; }

    /* Header */
    .fiche-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2mm; }
    .fiche-title { font-weight: 800; font-size: 12px; letter-spacing: 0.5px; }
    .sem-box { display: inline-block; border: 1.5px solid #333; min-width: 28px; height: 16px; text-align: center; vertical-align: middle; padding: 0 4px; }
    .nom-row { display: flex; gap: 10mm; margin-bottom: 2mm; align-items: baseline; }
    .nom-field { display: flex; align-items: baseline; gap: 3px; flex: 1; }
    .nom-underline { flex: 1; border-bottom: 1px solid #333; min-width: 50px; height: 16px; padding-bottom: 1px; }

    /* Regulation block */
    .reglement { border: 1.5px solid #444; padding: 1.5mm 3mm; margin-bottom: 2mm; font-size: 8.5px; line-height: 1.4; }
    .reglement strong { font-size: 8.5px; }

    /* Day wrapper */
    .day-wrap { display: flex; border: 1.5px solid #444; margin-bottom: 0; }
    .day-sidebar { width: 13px; background: #f0f0f0; border-right: 1.5px solid #444; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 3px 0; }
    .day-box { flex: 1; }

    /* Comment area */
    .comment-area { padding: 0.5mm 3mm 0 3mm; }
    .comment-line { border-bottom: 0.5px solid #555; margin-top: 3.5mm; height: 0; }

    /* Field rows inside day */
    .row-field { display: flex; align-items: baseline; gap: 2px; margin-bottom: 1.5px; }
    .field-label { font-size: 9px; font-weight: 700; white-space: nowrap; color: #222; }
    .field-label-sm { font-size: 8px; font-weight: 700; white-space: nowrap; color: #222; }
    .underline { border-bottom: 0.5px solid #555; display: inline-block; vertical-align: baseline; }

    /* Total box */
    .total-box { border: 1.5px solid #333; display: flex; margin-top: 2mm; }
    .total-left { flex: 1; padding: 1.5mm 2mm; border-right: 1.5px solid #333; }
    .total-right { flex: 1; padding: 1.5mm 2mm; }
    .total-title { font-weight: 800; font-size: 11px; margin-bottom: 2mm; letter-spacing: 0.5px; }
    .total-field { display: flex; align-items: baseline; gap: 3px; margin-bottom: 1.5mm; }

    /* Legend */
    .legend { border: 1.5px solid #333; padding: 1mm 2mm; margin-top: 2mm; font-size: 8px; font-weight: 700; }
  `

  const makeHeader = () => `
    <div class="fiche-header">
      <div class="fiche-title">FICHE HEBDOMADAIRE &nbsp;&nbsp; Semaine N°&nbsp;<span class="sem-box"><span class="filled" style="font-size:12px;font-weight:700">${info.semaine}</span></span></div>
      <div style="font-size:10px;font-weight:700">
        Du :&nbsp;<span class="filled">${info.dateDebut.split('/').join(' / ')}</span>
        &nbsp;&nbsp;&nbsp;Au :&nbsp;<span class="filled">${info.dateFin.split('/').join(' / ')}</span>
      </div>
    </div>
    <div class="nom-row">
      <div class="nom-field">
        <span style="font-weight:700;font-size:10px">NOM :</span>
        <div class="nom-underline"><span class="filled" style="font-size:12px">${info.nom.toUpperCase()}</span></div>
      </div>
      <div class="nom-field">
        <div class="nom-underline"><span class="filled" style="font-size:12px">${info.prenom}</span></div>
      </div>
    </div>`

  const reglementBlock = `
    <div class="reglement">
      <strong>Pour ma sécurité et celle des autres je m'engage à respecter la réglementation,</strong><br>
      - 4H30 de temps de conduite : 45 minutes de pause ou fractionné en 15 + 30 minutes<br>
      - &gt; 6H de temps de service : 30 minutes de pause - &gt; 9H de temps de service : 45 minutes de pause<br>
      Temps de service sur 1 semaine : 52/56 Heures – Temps de service journalier : 12 Heures maximum
    </div>`

  const totalBlock = `
    <div class="total-box">
      <div class="total-left">
        <div class="total-title">TOTAL SEMAINE</div>
        <div class="total-field">
          <span class="field-label" style="font-size:10px">KMS :</span>
          <span class="underline" style="flex:1;min-width:80px"><span class="filled">${info.totalKms}</span></span>
        </div>
        <div class="total-field">
          <span class="field-label" style="font-size:10px">HEURES :</span>
          <span class="underline" style="flex:1;min-width:80px"><span class="filled">${info.totalHeures}</span></span>
        </div>
      </div>
      <div class="total-right">
        <div class="total-title">OBSERVATIONS :</div>
      </div>
    </div>
    <div class="legend">*COMMENTAIRES = Changements de vehicule / Panne / Temps Atelier / Temps Clio / Visite medicale / AUTRES</div>`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>${css}</style></head>
<body>
  <div class="page">
    ${makeHeader()}
    ${reglementBlock}
    <div class="days-area">
      ${page1Jours.map(j => dayBlock(j)).join('')}
    </div>
    <div class="signature">TachoOffice &copy; ${new Date().getFullYear()} &mdash; D&eacute;velopp&eacute; par Bruno Veiga</div>
  </div>
  <div class="page page-break">
    ${makeHeader()}
    <div class="days-area">
      ${page2Jours.map(j => dayBlock(j)).join('')}
    </div>
    ${totalBlock}
    <div class="signature">TachoOffice &copy; ${new Date().getFullYear()} &mdash; D&eacute;velopp&eacute; par Bruno Veiga</div>
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
