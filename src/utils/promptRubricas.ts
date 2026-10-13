// src/utils/promptRubricas.ts
// Etapa 2C — prompt de extração DETALHADA das fiches de paie (módulo puro, sem rede, sem armazenamento).
// • O prompt = prompt legado (cópia gerada de fiche.tsx, ver promptRubricasLegado.ts) + bloco novo de rubricas;
//   o legado é um PREFIXO exato, nunca reescrito.
// • Sem valores de contrato fixos: o bloco novo não presume horas de base, equivalência, majorações ou primes.
// • Respeita os limites do proxy Netlify (netlify/lib/validarPedido.js): texto ≤ 8000, system ≤ 500, max_tokens ≤ 4000.
import { PROMPT_FICHES_LEGADO, SYSTEM_EXTRACAO_LEGADO } from './promptRubricasLegado'
import { CATEGORIAS_RUBRICA } from '../types/rubricas'

export { PROMPT_FICHES_LEGADO, SYSTEM_EXTRACAO_LEGADO }

/** Valores aceites hoje pelo proxy (espelham netlify/lib/validarPedido.js e anthropic-proxy.js; um teste confirma). */
export const MODELO_PROXY = 'claude-sonnet-4-6'
export const MAX_TOKENS_PROXY = 4000
export const LIMITE_TEXTO_PROXY = 8000
export const LIMITE_SYSTEM_PROXY = 500
/** Pedido legado atual da app (importerImagens). */
export const MAX_TOKENS_LEGADO = 3500
/** Pedido detalhado: usa todo o orçamento que o proxy permite. */
export const MAX_TOKENS_DETALHADO = MAX_TOKENS_PROXY

/** Versão que o modelo deve repetir em `versionPrompt`. */
export const VERSAO_PROMPT_RUBRICAS = 'rub-2'

/** Chaves de cada fiche que a extração detalhada ACRESCENTA ao legado (ordem pedida ao modelo; `fin` é sempre a última). */
export const CHAVES_DETALHADAS = ['versionPrompt', 'nbLignes', 'totaux', 'lignes', 'fin'] as const

const FORMA_DETALHADA =
  `...,"versionPrompt":"${VERSAO_PROMPT_RUBRICAS}","nbLignes":0,` +
  '"totaux":{"brut":null,"cotisationsSalariales":null,"cotisationsPatronales":null,"netImposable":null,"netSocial":null,"netAvantImpot":null,"pas":null,"netPaye":null},' +
  '"lignes":[{"n":1,"libelle":"","quantite":null,"unite":"","taux":null,"base":null,"montant":null,"colonne":"gain","periode":"","categorie":"inconnue","sousCategorie":"","confiance":0}],' +
  '"fin":true'

/** Bloco ACRESCENTADO ao prompt legado. */
export const BLOCO_RUBRICAS = `EXTRACTION DÉTAILLÉE DES RUBRIQUES — s'ajoute aux champs ci-dessus, qui restent inchangés et obligatoires.
Dans le MÊME objet de chaque fiche, après les champs ci-dessus, ajoute dans cet ordre: versionPrompt, nbLignes, totaux, lignes, fin. Forme (valeurs d'exemple vides):
${FORMA_DETALHADA}

RÈGLES (elles priment sur « mets 0 » ci-dessus, pour totaux et lignes uniquement):
1. lignes = UNE entrée par rubrique imprimée dans le corps du bulletin (gains, retenues, cotisations salariales et patronales, lignes informatives), dans l'ordre d'impression, de haut en bas. Ne fusionne, ne résume, ne déduplique et ne réordonne JAMAIS: deux lignes au libellé identique sont deux entrées. Ne saute aucune ligne, même si tu ne la comprends pas.
2. Adapte-toi à CE document: écris seulement les lignes réellement imprimées. N'assume aucune configuration de contrat (heures de base, équivalence, majorations, primes, congés): une rubrique absente du document n'apparaît pas.
3. "n" = 1, 2, 3... sans trou ni doublon. "nbLignes" = nombre total d'entrées de "lignes". "fin":true est la DERNIÈRE clé de l'objet, écrite seulement si la liste est terminée.
4. "libelle": copie exacte du libellé imprimé (accents, majuscules, abréviations, espaces), sans corriger ni traduire.
5. "quantite", "taux", "base", "montant" et les valeurs de "totaux": NOMBRES JSON avec point décimal, sans guillemets, sans espaces, sans € ni %. Exemple: « 1 234,56 » devient 1234.56.
6. Valeurs négatives: conserve le signe imprimé. « -12,50 », « 12,50- » et « (12,50) » deviennent -12.5. Ne change jamais le signe d'un montant parce qu'il est dans la colonne retenue ou patronal.
7. Valeur non imprimée: OMETS la clé (ou null). Jamais 0, jamais "", jamais une valeur déduite ou calculée. Écris 0 seulement si « 0 » ou « 0,00 » est imprimé. Ne calcule rien: ne déduis pas un montant de quantite × taux.
8. "unite": telle qu'imprimée (h, j, %, €...). "periode": texte imprimé pour cette ligne (ex: « du 01/03 au 31/03 »); sinon omets.
9. "colonne": "gain", "retenue", "patronal" ou "informatif" selon la colonne où le montant est imprimé; si tu ne sais pas, omets.
10. "categorie" est une SUGGESTION non vérifiée, parmi: ${CATEGORIAS_RUBRICA.join(', ')}. Au moindre doute: "inconnue". "sousCategorie" optionnelle (ex: majoracao_25, retenue, indemnite). "confiance" entre 0 et 1.
11. "totaux": uniquement les totaux imprimés sur le bulletin; omets ceux qui n'existent pas.`

/** Prompt completo: legado (prefixo exato) + bloco novo. */
export function construirPromptRubricas(): string {
  return `${PROMPT_FICHES_LEGADO}\n\n${BLOCO_RUBRICAS}`
}

/** Chaves do objeto de exemplo legado (`[{"tipo":"fiche",...}]`), lidas do próprio texto legado. */
export function chavesLegadasDoPrompt(prompt: string = PROMPT_FICHES_LEGADO): string[] {
  const i = prompt.indexOf('[{"tipo"')
  if (i < 0) return []
  const j = prompt.indexOf('}]', i)
  if (j < 0) return []
  const obj = JSON.parse(prompt.slice(i + 1, j + 1)) as Record<string, unknown>
  return Object.keys(obj)
}

export type BlocoFicheiro = { type: 'image' | 'document'; source: { type: 'base64'; media_type: string; data: string } }

export type PedidoProxy = {
  model: string
  max_tokens: number
  system: string
  messages: { role: 'user'; content: Array<BlocoFicheiro | { type: 'text'; text: string }> }[]
}

function montar(blocos: BlocoFicheiro[], prompt: string, system: string, maxTokens: number): PedidoProxy {
  const content: PedidoProxy['messages'][0]['content'] = []
  blocos.forEach((b, i) => {
    content.push(b)
    content.push({ type: 'text', text: `Document ${i + 1} de ${blocos.length}.` })
  })
  content.push({ type: 'text', text: prompt })
  return { model: MODELO_PROXY, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }
}

/** Corpo do pedido DETALHADO para UM ficheiro (uma fiche por pedido). Não faz chamadas de rede. */
export function construirPedidoRubricas(bloco: BlocoFicheiro): PedidoProxy {
  return montar([bloco], construirPromptRubricas(), SYSTEM_EXTRACAO_LEGADO, MAX_TOKENS_DETALHADO)
}

/** Corpo do pedido LEGADO (igual ao de hoje) — para o fallback futuro. */
export function construirPedidoLegado(blocos: BlocoFicheiro[]): PedidoProxy {
  return montar(blocos, PROMPT_FICHES_LEGADO, SYSTEM_EXTRACAO_LEGADO, MAX_TOKENS_LEGADO)
}

/** Verifica os limites conhecidos do proxy. Lista vazia = dentro dos limites. */
export function verificarLimitesPrompt(prompt: string = construirPromptRubricas(), system: string = SYSTEM_EXTRACAO_LEGADO): string[] {
  const p: string[] = []
  if (prompt.length > LIMITE_TEXTO_PROXY) p.push(`prompt com ${prompt.length} caracteres (limite ${LIMITE_TEXTO_PROXY})`)
  if (system.length > LIMITE_SYSTEM_PROXY) p.push(`system com ${system.length} caracteres (limite ${LIMITE_SYSTEM_PROXY})`)
  return p
}
