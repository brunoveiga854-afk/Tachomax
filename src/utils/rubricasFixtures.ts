// src/utils/rubricasFixtures.ts
// Etapa 2C — dados TOTALMENTE FICTÍCIOS (nomes, empresas, valores) para testar a extração detalhada.
// Só serve testes. Nenhum módulo da app importa este ficheiro. Nada aqui vem de fiches reais.
import { chavesLegadasDoPrompt, VERSAO_PROMPT_RUBRICAS } from './promptRubricas'

export type Obj = Record<string, unknown>

export type PerfilFicticio = {
  nome: string
  legado: Obj
  linhas: Obj[]            // SEM «n» (o construtor numera)
  totaux: Obj
}

/** Objeto legado com TODAS as chaves do prompt legado (lidas do próprio prompt), a 0/'' por omissão, mais `sobrepor`. */
export function legadoFicticio(sobrepor: Obj): Obj {
  const o: Obj = {}
  for (const k of chavesLegadasDoPrompt()) o[k] = (k === 'tipo' ? 'fiche' : (k === 'periode' || k === 'entreprise' || k === 'conducteur') ? '' : 0)
  return { ...o, ...sobrepor }
}

export type OpcoesFiche = { omitirNbLignes?: boolean; omitirFin?: boolean; nbLignes?: number; semDetalhe?: boolean }

/** Monta a resposta de UMA fiche como o modelo deve devolver: legado, versionPrompt, nbLignes, totaux, lignes (com «n»), fin (última). */
export function montarFicheDetalhada(p: PerfilFicticio, o: OpcoesFiche = {}): Obj {
  const r: Obj = { ...p.legado }
  if (o.semDetalhe) return r
  r.versionPrompt = VERSAO_PROMPT_RUBRICAS
  if (!o.omitirNbLignes) r.nbLignes = o.nbLignes ?? p.linhas.length
  r.totaux = { ...p.totaux }
  r.lignes = p.linhas.map((l, i) => ({ n: i + 1, ...l }))
  if (!o.omitirFin) r.fin = true
  return r
}

export const textoResposta = (docs: Obj[]): string => JSON.stringify(docs)

/** Resposta da API tal como o proxy a devolve. */
export const respostaAPI = (texto: string, stopReason: string | null = 'end_turn'): Obj =>
  ({ id: 'msg_ficticio', type: 'message', role: 'assistant', content: [{ type: 'text', text: texto }], stop_reason: stopReason, usage: { input_tokens: 1, output_tokens: 1 } })

// ───────────────────────── Perfil A — horas de base + equivalência + suplementares + noite ─────────────────────────
export const PERFIL_A: PerfilFicticio = {
  nome: 'A — com equivalência',
  legado: legadoFicticio({
    periode: 'Mars 2026', moisIndex: 2, annee: 2026, netPaye: 2310.45, salairebrut: 3010.2, totalCotisations: 640.1,
    entreprise: 'Transports Exemple SA', conducteur: 'Conducteur Fictif A', hbase: 140, hval: 12.35, h25: 15.44, lim25: 12, h50: 18.53, totalHeures: 188,
  }),
  totaux: { brut: 3010.2, cotisationsSalariales: 640.1, netImposable: 2480.3, netAvantImpot: 2370.1, pas: 59.65, netPaye: 2310.45 },
  linhas: [
    { libelle: 'Salaire de base', quantite: 140, unite: 'h', taux: 12.35, montant: 1729, colonne: 'gain', categorie: 'salaire_base', confiance: 0.95 },
    { libelle: "Heures d'équivalence", quantite: 22, unite: 'h', taux: 12.35, montant: 271.7, colonne: 'gain', categorie: 'heures_equivalence', confiance: 0.9 },
    { libelle: 'Heures supplémentaires 25%', quantite: 12, unite: 'h', taux: 15.44, montant: 185.28, colonne: 'gain', categorie: 'heures_supplementaires', sousCategorie: 'majoracao_25' },
    { libelle: 'Heures supplémentaires 50%', quantite: 6, unite: 'h', taux: 18.53, montant: 111.18, colonne: 'gain', categorie: 'heures_supplementaires', sousCategorie: 'majoracao_50' },
    { libelle: 'Majoration travail de nuit', quantite: 30, unite: 'h', taux: 1.1, montant: 33, colonne: 'gain', categorie: 'travail_nuit' },
    { libelle: 'Indemnité de repas', quantite: 18, unite: 'j', taux: 9.4, montant: 169.2, colonne: 'gain' },
    { libelle: 'Cotisation vieillesse plafonnée', base: 3010.2, taux: 6.9, unite: '%', montant: 207.7, colonne: 'retenue', categorie: 'cotisation_retenue' },
    { libelle: 'CSG déductible', base: 2954.2, taux: 6.8, unite: '%', montant: 200.89, colonne: 'retenue' },
    { libelle: 'Retraite complémentaire part patronale', base: 3010.2, taux: 4.72, unite: '%', montant: 142.09, colonne: 'patronal' },
  ],
}

// ───────────────────────── Perfil B — SEM equivalência; congés com dedução e indemnização; baixa; regularização negativa ─────────────────────────
export const PERFIL_B: PerfilFicticio = {
  nome: 'B — sem equivalência',
  legado: legadoFicticio({
    periode: 'Juin 2026', moisIndex: 5, annee: 2026, netPaye: 1721.8, salairebrut: 2210.5, totalCotisations: 470.3,
    entreprise: 'Logistique Modèle SARL', conducteur: 'Conducteur Fictif B', hbase: 130, hval: 11.9, h25: 14.88, lim25: 8, totalHeures: 138,
    joursConges: 5, montantConges: 492.5,
  }),
  totaux: { brut: 2210.5, cotisationsSalariales: 470.3, netAvantImpot: 1760, pas: 38.2, netPaye: 1721.8 },
  linhas: [
    { libelle: 'Heures normales', quantite: 130, unite: 'h', taux: 11.9, montant: 1547, colonne: 'gain' },
    { libelle: 'Heures supplémentaires 25%', quantite: 8, unite: 'h', taux: 14.88, montant: 119.04, colonne: 'gain', categorie: 'heures_supplementaires' },
    { libelle: "Prime d'ancienneté", base: 1547, taux: 3, unite: '%', montant: 46.41, colonne: 'gain' },
    { libelle: 'Retenue congés payés', quantite: 5, unite: 'j', taux: 90, montant: -450, colonne: 'retenue' },
    { libelle: 'Indemnité de congés payés', quantite: 5, unite: 'j', taux: 98.5, montant: 492.5, colonne: 'gain' },
    { libelle: 'Absence maladie', quantite: 3, unite: 'j', taux: 90, montant: -270, colonne: 'retenue' },
    { libelle: 'Subrogation IJSS', montant: 180, colonne: 'gain' },
    { libelle: 'Régularisation sur mois précédent', montant: -35.6, colonne: 'retenue' },
    { libelle: 'CSG déductible', base: 2200.1, taux: 6.8, unite: '%', montant: 149.61, colonne: 'retenue' },
  ],
}

// ───────────────────────── Perfil C — fériés, RC, prémios, desconhecidas, repetidas, formatos franceses ─────────────────────────
const NNBSP = ' '
export const PERFIL_C: PerfilFicticio = {
  nome: 'C — formatos franceses e rubricas estranhas',
  legado: legadoFicticio({
    periode: 'Septembre 2026', moisIndex: 8, annee: 2026, netPaye: 2890.1, salairebrut: 3650, totalCotisations: 760.4,
    entreprise: 'Fret Imaginaire SAS', conducteur: 'Conducteur Fictif C', hbase: 148.5, hval: 10.9, totalHeures: 160.5, joursFeries: 2, montantFeries: 171, joursRC: 1, montantRC: 76.3,
  }),
  totaux: { brut: 3650, netPaye: 2890.1 },
  linhas: [
    { libelle: 'Salaire de base', quantite: 148.5, unite: 'h', taux: 10.9, montant: 1618.65, colonne: 'gain' },
    { libelle: 'Jours fériés', quantite: 2, unite: 'j', taux: 85.5, montant: '171,00', colonne: 'gain' },
    { libelle: 'Repos compensateur', quantite: 7, unite: 'h', taux: 10.9, montant: 76.3, colonne: 'gain' },
    { libelle: 'Prime exceptionnelle', montant: `1${NNBSP}234,56`, colonne: 'gain' },
    { libelle: 'Prime panier', montant: 0, colonne: 'gain' },
    { libelle: 'Prime panier', montant: 0, colonne: 'gain' },
    { libelle: 'Rubrique XQ-42', montant: '12,50-', colonne: 'retenue' },
    { libelle: 'Régularisation', montant: '(75,40)', colonne: 'retenue' },
    { libelle: 'Acompte versé', montant: '1.234,56', colonne: 'retenue' },
    { libelle: 'Ajust. div. 7', colonne: 'informatif' },
    { libelle: 'CSG déductible', base: 3500, taux: 6.8, unite: '%', montant: 238, colonne: 'retenue' },
  ],
}

export const PERFIS = [PERFIL_A, PERFIL_B, PERFIL_C]
