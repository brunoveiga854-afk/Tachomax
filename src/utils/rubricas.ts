// src/utils/rubricas.ts
// Normalizador e validador PUROS das rubricas de uma fiche de paie (Etapas 2A/2C — isolado da app).
// • Não lê nem escreve armazenamento; não altera os dados de entrada (tudo é copiado);
// • preserva libellés e campos desconhecidos; valores ausentes ficam null (nunca 0);
// • não elimina linhas repetidas, não corrige dados inválidos, não confirma classificações;
// • NÃO contém fórmulas monetárias: a única aritmética é uma verificação de coerência (quantidade × taxa) que só gera aviso.
import {
  CATEGORIAS_RUBRICA, VERSAO_ESQUEMA_RUBRICAS,
  type CategoriaRubrica, type ColunaRubrica, type DocumentoRubricas, type EstadoDocumentoRubricas, type PeriodoDocumental,
  type PeriodoRubrica, type ProblemaDados, type RubricaFiche, type SinalRubrica, type TotaisImpressos, type ClassificacaoRubrica,
} from '../types/rubricas'

export type OpcoesNormalizacao = {
  /** ISO usado em `importadoEm` (testes determinísticos). Por omissão, agora. */
  agora?: string
  modeloIA?: string | null
  versaoPrompt?: string | null
  /** Sugerir categoria pelo libellé quando a IA não indicou nenhuma (origem 'regra'). Por omissão: sim. Nunca confirma. */
  usarRegrasLibelle?: boolean
}

// ───────────────────────── utilitários ─────────────────────────
const ehObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Cópia profunda de dados JSON-like (o resultado nunca partilha referências com a entrada). */
export function clonar<T>(v: T): T {
  if (Array.isArray(v)) return v.map(x => clonar(x)) as unknown as T
  if (ehObj(v)) {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(v)) o[k] = clonar((v as Record<string, unknown>)[k])
    return o as T
  }
  return v
}

/** FNV-1a 32 bits, 8 hex. */
function fnv(s: string, seed = 0x811c9dc5): string {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
export const hash16 = (s: string) => fnv(s) + fnv(s, 0x9e3779b1)

const semAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const slug = (s: string) => semAcentos(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const problema = (codigo: string, gravidade: ProblemaDados['gravidade'], mensagem: string, campo?: string): ProblemaDados =>
  ({ codigo, gravidade, mensagem, ...(campo ? { campo } : {}) })

/** Resultado da leitura de um número escrito em texto (formatos franceses). */
type LeituraTexto = { valor: number | null; motivo?: string; negativoPorFormato?: boolean }

/**
 * Lê um número em texto, só quando o formato é INEQUÍVOCO:
 *   «12,5» «12.5» «1234» · milhares por espaço (normal, U+00A0, U+202F) «1 234,56» · «1.234,56» (pontos de milhar + vírgula decimal)
 *   negativos: «-12,50» «12,50-» «(12,50)». «€» e «%» são ignorados.
 * Recusa (null) o que pode ter dois sentidos: «1.234» e «1,234» (1,234 ou 1234?), «1,234.56», «1.234.567», espaços mal agrupados, sinais duplos.
 */
function lerNumeroTexto(t: string): LeituraTexto {
  let s = t.replace(/[€%]/g, '').replace(/[\u2212\u2012\u2013]/g, '-').replace(/[\s\u00A0\u202F]+/g, ' ').trim()
  if (s === '') return { valor: null, motivo: 'sem dígitos' }
  let parenteses = false, sufixo = false, prefixo = ''
  const par = s.match(/^\(\s*(.+?)\s*\)$/)
  if (par) { parenteses = true; s = par[1] }
  const suf = s.match(/^(.+?)\s*-$/)
  if (suf) { sufixo = true; s = suf[1] }
  const pre = s.match(/^([+-])\s*(.+)$/)
  if (pre) { prefixo = pre[1]; s = pre[2] }
  if ((parenteses ? 1 : 0) + (sufixo ? 1 : 0) + (prefixo ? 1 : 0) > 1) return { valor: null, motivo: 'sinais múltiplos' }

  let textoNum: string | null = null
  if (/^\d+$/.test(s)) textoNum = s
  else if (/^\d+[.,]\d+$/.test(s)) {
    if (/^(?!0[.,])\d{1,3}[.,]\d{3}$/.test(s)) return { valor: null, motivo: 'ambíguo (separador seguido de 3 dígitos: decimal ou milhar?)' }
    textoNum = s.replace(',', '.')
  } else if (/^\d{1,3}( \d{3})+([.,]\d+)?$/.test(s)) textoNum = s.replace(/ /g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) textoNum = s.replace(/\./g, '').replace(',', '.')
  if (textoNum === null) return { valor: null, motivo: 'formato não inequívoco' }

  const n = Number(textoNum)
  if (!Number.isFinite(n)) return { valor: null, motivo: 'fora do intervalo' }
  const negativo = parenteses || sufixo || prefixo === '-'
  const valor = negativo ? (n === 0 ? 0 : -n) : n
  return { valor, negativoPorFormato: parenteses || sufixo }
}

/** Lê um número. Ausente → null (nunca 0). Texto só se for inequivocamente numérico (ver lerNumeroTexto); o resto → null + problema `numero_invalido`. */
export function lerNumero(v: unknown, campo: string, problemas: ProblemaDados[]): number | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return v
    problemas.push(problema('numero_invalido', 'erro', `${campo}: número não finito (${String(v)}); ignorado.`, campo))
    return null
  }
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    const r = lerNumeroTexto(t)
    if (r.valor === null) {
      problemas.push(problema('numero_invalido', 'erro', `${campo}: «${v}» não é um número inequívoco (${r.motivo}); ignorado (não se adivinha).`, campo))
      return null
    }
    problemas.push(problema('texto_convertido', 'info', `${campo}: «${v}» lido como número.`, campo))
    if (r.negativoPorFormato) problemas.push(problema('negativo_por_formato', 'info', `${campo}: «${v}» lido como negativo pelo formato (sufixo «-» ou parênteses).`, campo))
    return r.valor
  }
  problemas.push(problema('numero_invalido', 'erro', `${campo}: tipo ${typeof v} não aceite.`, campo))
  return null
}

// ───────────────────────── datas / períodos ─────────────────────────
const MESES_FR = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']

function dataValida(a: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(a, m - 1, d))
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function datasNoTexto(t: string): string[] {
  const out: string[] = []
  const re = /(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const iso = m[1] ? dataValida(+m[1], +m[2], +m[3]) : dataValida(+m[6], +m[5], +m[4])
    if (iso) out.push(iso)
  }
  return out
}
function lerPeriodoLinha(raw: unknown, problemas: ProblemaDados[]): { texto: string | null; periodo: PeriodoRubrica | null } {
  if (raw === undefined || raw === null || raw === '') return { texto: null, periodo: null }
  let texto: string | null = null
  let de: string | null = null
  let ate: string | null = null
  if (typeof raw === 'string') {
    texto = raw
    const ds = datasNoTexto(raw)
    de = ds[0] ?? null; ate = ds.length > 1 ? ds[1] : null
  } else if (ehObj(raw)) {
    const pega = (...ks: string[]) => { for (const k of ks) if (typeof raw[k] === 'string') return raw[k] as string; return null }
    const a = pega('du', 'de', 'from'), b = pega('au', 'ate', 'to')
    texto = [a, b].filter((x): x is string => !!x).join(' → ') || null
    de = a ? (datasNoTexto(a)[0] ?? null) : null
    ate = b ? (datasNoTexto(b)[0] ?? null) : null
  } else {
    problemas.push(problema('periodo_invalido', 'aviso', 'periode: formato não suportado; ignorado.', 'periode'))
    return { texto: null, periodo: null }
  }
  if (de === null && ate === null) {
    problemas.push(problema('periodo_nao_interpretado', 'info', `periode: «${texto ?? ''}» não interpretável; texto preservado.`, 'periode'))
    return { texto, periodo: null }
  }
  if (de && ate && de > ate) problemas.push(problema('periodo_invertido', 'aviso', `periode: início (${de}) depois do fim (${ate}); preservado como lido.`, 'periode'))
  return { texto, periodo: { de, ate } }
}

// ───────────────────────── sinal / coluna ─────────────────────────
function lerSens(v: unknown): SinalRubrica | null {
  if (typeof v !== 'string') return null
  const s = slug(v)
  if (v.trim() === '+' || ['positif', 'positivo', 'plus', 'credit'].includes(s)) return 'positivo'
  if (v.trim() === '-' || v.trim() === '−' || ['negatif', 'negativo', 'moins', 'debit'].includes(s)) return 'negativo'
  return null
}
function lerColuna(v: unknown): { coluna: ColunaRubrica; bruta: string | null } {
  if (typeof v !== 'string' || v.trim() === '') return { coluna: 'inconnu', bruta: null }
  const s = slug(v)
  if (/retenue|deduire|deduction|salarial/.test(s)) return { coluna: 'retenue', bruta: v }
  if (/patronal|employeur/.test(s)) return { coluna: 'patronal', bruta: v }
  if (/gain|payer|brut/.test(s)) return { coluna: 'gain', bruta: v }
  if (/inform/.test(s)) return { coluna: 'informatif', bruta: v }
  return { coluna: 'inconnu', bruta: v }
}
const sinalDe = (m: number | null): SinalRubrica => m === null ? 'desconhecido' : m > 0 ? 'positivo' : m < 0 ? 'negativo' : 'zero'

// ───────────────────────── classificação ─────────────────────────
const SINONIMOS: Record<string, CategoriaRubrica> = {
  salaire_base: 'salaire_base', base: 'salaire_base', salaire_de_base: 'salaire_base', heures_normales: 'salaire_base', heures_de_base: 'salaire_base',
  heures_equivalence: 'heures_equivalence', equivalence: 'heures_equivalence', heures_d_equivalence: 'heures_equivalence',
  heures_supplementaires: 'heures_supplementaires', heures_sup: 'heures_supplementaires', hs: 'heures_supplementaires',
  travail_nuit: 'travail_nuit', travail_de_nuit: 'travail_nuit', heures_de_nuit: 'travail_nuit', nuit: 'travail_nuit',
  conges_payes: 'conges_payes', cp: 'conges_payes', conges: 'conges_payes',
  jours_feries: 'jours_feries', jour_ferie: 'jours_feries', feries: 'jours_feries',
  repos_compensateur: 'repos_compensateur', rc: 'repos_compensateur',
  arret_maladie: 'arret_maladie', maladie: 'arret_maladie',
  autres_absences: 'autres_absences', absence: 'autres_absences', absences: 'autres_absences',
  prime: 'prime', primes: 'prime', interessement: 'prime', participation: 'prime',
  regularisation: 'regularisation', regularisations: 'regularisation',
  cotisation_retenue: 'cotisation_retenue', cotisation: 'cotisation_retenue', cotisations: 'cotisation_retenue', retenue: 'cotisation_retenue',
  inconnue: 'inconnue', inconnu: 'inconnue', rubrique_inconnue: 'inconnue', autre: 'inconnue',
}
const REGRAS_LIBELLE: [CategoriaRubrica, RegExp][] = [
  ['heures_equivalence', /equivalence/],
  ['travail_nuit', /\bnuit\b/],
  ['heures_supplementaires', /heures? sup|\bhs\b/],
  ['conges_payes', /conges? payes?|\bcp\b/],
  ['jours_feries', /jours? ferie|\bferie\b/],
  ['repos_compensateur', /repos compensateur|\brc\b/],
  ['arret_maladie', /maladie|arret de travail/],
  ['regularisation', /regularisation|\bregul\b|rappel de/],
  ['prime', /\bprime\b|interessement|participation|gratification|13eme/],
  ['cotisation_retenue', /cotisation|\bcsg\b|\bcrds\b|retraite|urssaf|prevoyance|mutuelle|prelevement|impot/],
  ['salaire_base', /salaire de base|heures? normales?|heures? de base/],
]
/** Sugestão conservadora: só devolve categoria se EXATAMENTE uma regra corresponder (ambíguo → null). */
export function sugerirCategoriaPorLibelle(libelle: string): CategoriaRubrica | null {
  const t = semAcentos(libelle).toLowerCase()
  const hits = REGRAS_LIBELLE.filter(([, re]) => re.test(t)).map(([c]) => c)
  return hits.length === 1 ? hits[0] : null
}
function subcategoriaSugerida(cat: CategoriaRubrica, libelle: string): string | null {
  const t = semAcentos(libelle).toLowerCase()
  if (cat === 'heures_supplementaires') { const m = t.match(/(\d{2,3})\s*%/); return m ? `majoracao_${m[1]}` : null }
  if (cat === 'conges_payes') {
    const r = /retenue|deduction/.test(t), i = /indemnit/.test(t)
    return r && !i ? 'retenue' : i && !r ? 'indemnite' : null
  }
  return null
}
const CHAVES_CONFIRMACAO = ['estadoClassificacao', 'classificacaoConfirmada', 'confirmada', 'confirme', 'confirmed']

function classificar(l: Record<string, unknown>, libelle: string, usarRegras: boolean, problemas: ProblemaDados[]): ClassificacaoRubrica {
  let confianca: number | null = null
  if (l.confiance !== undefined && l.confiance !== null) {
    const c = lerNumero(l.confiance, 'confiance', problemas)
    if (c !== null && c >= 0 && c <= 1) confianca = c
    else if (c !== null) problemas.push(problema('confianca_fora_de_intervalo', 'aviso', `confiance ${c} fora de [0,1]; ignorada.`, 'confiance'))
  }
  if (CHAVES_CONFIRMACAO.some(k => l[k] !== undefined))
    problemas.push(problema('confirmacao_ignorada', 'info', 'A extração não pode confirmar classificações; indicação ignorada (campo preservado).'))
  const subIn = typeof l.sousCategorie === 'string' && l.sousCategorie.trim() ? slug(l.sousCategorie) : null
  const brutaStr = typeof l.categorie === 'string' && l.categorie.trim() ? l.categorie : null
  if (brutaStr !== null) {
    const cat = SINONIMOS[slug(brutaStr)]
    if (cat && cat !== 'inconnue') {
      return { categoria: cat, subcategoria: subIn ?? subcategoriaSugerida(cat, libelle), origem: 'ia', estado: 'sugerida', confianca, categoriaBruta: brutaStr }
    }
    if (cat === 'inconnue') return { categoria: 'inconnue', subcategoria: subIn, origem: 'ia', estado: 'nao_classificada', confianca, categoriaBruta: brutaStr }
    problemas.push(problema('categoria_nao_reconhecida', 'aviso', `categorie «${brutaStr}» não reconhecida; preservada.`, 'categorie'))
  }
  if (usarRegras) {
    const c = sugerirCategoriaPorLibelle(libelle)
    if (c) return { categoria: c, subcategoria: subIn ?? subcategoriaSugerida(c, libelle), origem: 'regra', estado: 'sugerida', confianca: null, categoriaBruta: brutaStr }
  }
  return { categoria: 'inconnue', subcategoria: subIn, origem: 'nenhuma', estado: 'nao_classificada', confianca, categoriaBruta: brutaStr }
}

// ───────────────────────── linhas ─────────────────────────
const CHAVES_LINHA = new Set(['libelle', 'quantite', 'unite', 'taux', 'base', 'montant', 'sens', 'colonne', 'periode', 'categorie', 'sousCategorie', 'confiance'])

function coerente(q: number | null, t: number | null, m: number | null, base: number | null, unidade: string | null, cat: CategoriaRubrica): boolean {
  if (q === null || t === null || m === null) return true
  if (unidade === '%' || cat === 'cotisation_retenue') return true
  const tol = Math.max(0.05, Math.abs(m) * 0.01)
  if (Math.abs(q * t - Math.abs(m)) <= tol || Math.abs(q * t - m) <= tol) return true
  if (base !== null && Math.abs((base * t) / 100 - Math.abs(m)) <= tol) return true
  return false
}

function normalizarLinha(raw: unknown, indice: number, idDoc: string, opc: OpcoesNormalizacao, vistas: Set<string>): RubricaFiche {
  const problemas: ProblemaDados[] = []
  const l: Record<string, unknown> = ehObj(raw) ? raw : {}
  if (!ehObj(raw)) problemas.push(problema('linha_invalida', 'erro', 'Linha que não é um objeto; guardada vazia e preservada em desconhecidos.'))
  const ordem = indice + 1

  let libelle = ''
  if (typeof l.libelle === 'string') libelle = l.libelle
  else if (l.libelle === undefined || l.libelle === null) problemas.push(problema('libelle_ausente', 'erro', 'Linha sem libellé.', 'libelle'))
  else { libelle = String(l.libelle); problemas.push(problema('libelle_nao_texto', 'aviso', 'libellé não era texto; convertido sem reescrita.', 'libelle')) }
  if (typeof l.libelle === 'string' && l.libelle.trim() === '') problemas.push(problema('libelle_ausente', 'erro', 'libellé vazio.', 'libelle'))

  const quantidade = lerNumero(l.quantite, 'quantite', problemas)
  const taxa = lerNumero(l.taux, 'taux', problemas)
  const base = lerNumero(l.base, 'base', problemas)
  const montante = lerNumero(l.montant, 'montant', problemas)
  const unidade = typeof l.unite === 'string' && l.unite.trim() !== '' ? l.unite : null
  if (l.unite !== undefined && l.unite !== null && typeof l.unite !== 'string') problemas.push(problema('unidade_invalida', 'aviso', 'unite não é texto; ignorada.', 'unite'))

  const { coluna, bruta } = lerColuna(l.colonne)
  if (bruta !== null && coluna === 'inconnu') problemas.push(problema('coluna_desconhecida', 'info', `colonne «${bruta}» não reconhecida; preservada.`, 'colonne'))

  const sens = lerSens(l.sens)
  const sinal = montante !== null ? sinalDe(montante) : (sens ?? 'desconhecido')
  if (montante !== null && montante !== 0 && sens !== null && sens !== sinal)
    problemas.push(problema('sinal_inconsistente', 'aviso', `sens indica ${sens} mas o montante impresso é ${sinal}; montante preservado como lido.`, 'sens'))
  if (coluna === 'retenue' && montante !== null && montante < 0)
    problemas.push(problema('retenue_com_montante_negativo', 'info', 'Linha na coluna de retenção com montante negativo; preservado.', 'montant'))

  const per = lerPeriodoLinha(l.periode, problemas)
  const classificacao = classificar(l, libelle, opc.usarRegrasLibelle !== false, problemas)

  if (!coerente(quantidade, taxa, montante, base, unidade, classificacao.categoria))
    problemas.push(problema('montante_inconsistente', 'aviso', `quantite (${quantidade}) × taux (${taxa}) não corresponde a montant (${montante}); nada foi corrigido.`, 'montant'))

  const desconhecidos: Record<string, unknown> = {}
  for (const k of Object.keys(l)) if (!CHAVES_LINHA.has(k)) desconhecidos[k] = clonar(l[k])
  if (!ehObj(raw) && raw !== undefined) desconhecidos.valorOriginal = clonar(raw)

  const impressao = JSON.stringify([libelle, l.quantite ?? null, l.taux ?? null, l.base ?? null, l.montant ?? null, l.colonne ?? null, l.periode ?? null])
  if (vistas.has(impressao)) problemas.push(problema('linha_repetida', 'info', 'Linha idêntica a outra anterior; ambas mantidas (podem ser legítimas).'))
  vistas.add(impressao)

  return {
    id: `${idDoc}#${ordem}-${hash16(impressao).slice(0, 8)}`,
    ordem, natureza: 'documental', libelleOriginal: libelle,
    quantidade, unidade, taxa, base, montante, sinal, coluna, colunaBruta: bruta,
    periodoTexto: per.texto, periodo: per.periodo, classificacao,
    estimativas: [], desconhecidos, problemas,
  }
}

// ───────────────────────── documento ─────────────────────────
const CHAVES_DOC = new Set(['idDocumento', 'hash', 'modele', 'versionPrompt', 'periode', 'moisIndex', 'annee', 'totaux', 'lignes'])
const CHAVES_TOTAUX: Record<string, keyof Omit<TotaisImpressos, 'desconhecidos'>> = {
  brut: 'brut', cotisationsSalariales: 'cotisationsSalariales', cotisationsPatronales: 'cotisationsPatronales',
  netImposable: 'netImposable', netSocial: 'netSocial', netAvantImpot: 'netAvantImpot', pas: 'pas', netPaye: 'netPaye',
}

function lerTotais(raw: unknown, problemas: ProblemaDados[]): TotaisImpressos {
  const t: TotaisImpressos = {
    brut: null, cotisationsSalariales: null, cotisationsPatronales: null, netImposable: null, netSocial: null,
    netAvantImpot: null, pas: null, netPaye: null, desconhecidos: {},
  }
  if (raw === undefined || raw === null) return t
  if (!ehObj(raw)) { problemas.push(problema('totais_invalidos', 'erro', 'totaux não é um objeto; ignorado.', 'totaux')); return t }
  for (const k of Object.keys(raw)) {
    const alvo = CHAVES_TOTAUX[k]
    if (alvo) t[alvo] = lerNumero(raw[k], `totaux.${k}`, problemas)
    else t.desconhecidos[k] = clonar(raw[k])
  }
  return t
}

function lerPeriodoDocumento(raw: Record<string, unknown>, problemas: ProblemaDados[]): PeriodoDocumental {
  let mes: number | null = null, ano: number | null = null
  const texto = typeof raw.periode === 'string' && raw.periode.trim() ? raw.periode : null
  if (raw.moisIndex !== undefined && raw.moisIndex !== null) {
    if (typeof raw.moisIndex === 'number' && Number.isInteger(raw.moisIndex) && raw.moisIndex >= 0 && raw.moisIndex <= 11) mes = raw.moisIndex
    else problemas.push(problema('mes_invalido', 'erro', `moisIndex ${String(raw.moisIndex)} fora de 0-11; ignorado.`, 'moisIndex'))
  }
  if (raw.annee !== undefined && raw.annee !== null) {
    if (typeof raw.annee === 'number' && Number.isInteger(raw.annee) && raw.annee >= 2000 && raw.annee <= 2100) ano = raw.annee
    else problemas.push(problema('ano_invalido', 'erro', `annee ${String(raw.annee)} inválido; ignorado.`, 'annee'))
  }
  const partes = texto ? semAcentos(texto).toLowerCase().split(/\s+/) : []
  const im = MESES_FR.indexOf(partes[0] ?? '')
  const a = Number(partes[1])
  const textoLegivel = texto !== null && im >= 0 && Number.isInteger(a) && a >= 2000 && a <= 2100
  if ((mes === null || ano === null) && textoLegivel) {
    if (mes === null) mes = im
    if (ano === null) ano = a
    problemas.push(problema('periodo_lido_do_texto', 'info', `Período lido do texto «${texto}».`, 'periode'))
  } else if (textoLegivel && mes !== null && ano !== null && (im !== mes || a !== ano)) {
    problemas.push(problema('periodo_inconsistente', 'aviso', `periode «${texto}» difere de moisIndex/annee (${mes}/${ano}); ambos preservados.`, 'periode'))
  }
  return { mes, ano, texto }
}

/** Transforma UMA resposta de extração (contrato em `types/rubricas.ts`) num documento estruturado. Puro. */
export function normalizarRespostaExtracao(resposta: unknown, opcoes: OpcoesNormalizacao = {}): DocumentoRubricas {
  const problemas: ProblemaDados[] = []
  const raw: Record<string, unknown> = ehObj(resposta) ? resposta : {}
  if (!ehObj(resposta)) problemas.push(problema('resposta_invalida', 'erro', 'A resposta de extração não é um objeto.'))

  const periodoDocumento = lerPeriodoDocumento(raw, problemas)
  const totaisImpressos = lerTotais(raw.totaux, problemas)
  const hashDocumento = typeof raw.hash === 'string' && raw.hash.trim() ? raw.hash : null

  let linhasRaw: unknown[] = []
  if (Array.isArray(raw.lignes)) linhasRaw = raw.lignes
  else problemas.push(problema('lignes_ausentes', 'erro', 'lignes ausente ou não é uma lista; documento sem rubricas.', 'lignes'))

  // identidade: id fornecido > hash do documento > impressão digital do conteúdo (nunca só o mês)
  let idDocumento: string
  let origemId: DocumentoRubricas['origemId']
  if (typeof raw.idDocumento === 'string' && raw.idDocumento.trim()) { idDocumento = raw.idDocumento; origemId = 'fornecido' }
  else if (hashDocumento) { idDocumento = `doc-${hash16(hashDocumento)}`; origemId = 'hash_documento' }
  else {
    const conteudo = JSON.stringify([
      periodoDocumento.texto, periodoDocumento.mes, periodoDocumento.ano,
      linhasRaw.map(x => (ehObj(x) ? [x.libelle ?? null, x.quantite ?? null, x.taux ?? null, x.base ?? null, x.montant ?? null, x.colonne ?? null, x.periode ?? null] : x ?? null)),
      raw.totaux ?? null,
    ])
    idDocumento = `doc-${hash16(conteudo)}`; origemId = 'conteudo'
  }

  const vistas = new Set<string>()
  const linhas = linhasRaw.map((x, i) => normalizarLinha(x, i, idDocumento, opcoes, vistas))

  const desconhecidos: Record<string, unknown> = {}
  for (const k of Object.keys(raw)) if (!CHAVES_DOC.has(k)) desconhecidos[k] = clonar(raw[k])

  return {
    versaoEsquema: VERSAO_ESQUEMA_RUBRICAS,
    idDocumento, origemId,
    importadoEm: opcoes.agora ?? new Date().toISOString(),
    periodoDocumento,
    modeloIA: typeof raw.modele === 'string' ? raw.modele : (opcoes.modeloIA ?? null),
    versaoPrompt: typeof raw.versionPrompt === 'string' ? raw.versionPrompt : (opcoes.versaoPrompt ?? null),
    hashDocumento,
    linhas, totaisImpressos, desconhecidos,
    estado: 'extraido',
    problemas,
  }
}

/** A extração devolve um array de fiches: normaliza cada uma; entradas que não são objetos ficam listadas, nunca descartadas em silêncio. */
export function normalizarRespostasExtracao(respostas: unknown, opcoes: OpcoesNormalizacao = {}): {
  documentos: DocumentoRubricas[]; ignoradas: { indice: number; motivo: string }[]
} {
  const documentos: DocumentoRubricas[] = []
  const ignoradas: { indice: number; motivo: string }[] = []
  if (!Array.isArray(respostas)) return { documentos, ignoradas: [{ indice: -1, motivo: 'a resposta não é uma lista' }] }
  respostas.forEach((r, i) => {
    if (ehObj(r)) documentos.push(normalizarRespostaExtracao(r, opcoes))
    else ignoradas.push({ indice: i, motivo: 'entrada que não é um objeto' })
  })
  return { documentos, ignoradas }
}

// ───────────────────────── validação de um documento (p. ex. lido do armazenamento no futuro) ─────────────────────────
const ESTADOS_DOC: EstadoDocumentoRubricas[] = ['extraido', 'confirmado', 'editado']
const ESTADOS_CLASS = ['nao_classificada', 'sugerida', 'confirmada', 'rejeitada']
const ORIGENS_CLASS = ['ia', 'regra', 'utilizador', 'nenhuma']
const numOuNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))

/** Valida a estrutura sem a alterar. Devolve a lista de problemas (vazia = coerente). */
export function validarDocumentoRubricas(doc: unknown): ProblemaDados[] {
  const p: ProblemaDados[] = []
  if (!ehObj(doc)) return [problema('documento_invalido', 'erro', 'Não é um objeto.')]
  if (doc.versaoEsquema !== VERSAO_ESQUEMA_RUBRICAS) p.push(problema('versao_desconhecida', 'aviso', `versaoEsquema ${String(doc.versaoEsquema)} desconhecida.`, 'versaoEsquema'))
  if (typeof doc.idDocumento !== 'string' || !doc.idDocumento) p.push(problema('id_ausente', 'erro', 'idDocumento ausente.', 'idDocumento'))
  if (!ESTADOS_DOC.includes(doc.estado as EstadoDocumentoRubricas)) p.push(problema('estado_invalido', 'erro', `estado ${String(doc.estado)} inválido.`, 'estado'))
  if (doc.completude !== undefined) {
    const c = doc.completude
    if (!ehObj(c) || !['completo_estrutural', 'incompleto', 'desconhecido'].includes(c.estado as string) || c.garantiaLeituraCompleta !== false)
      p.push(problema('completude_invalida', 'erro', 'completude inválida (estado desconhecido ou garantiaLeituraCompleta diferente de false).', 'completude'))
  }
  if (!Array.isArray(doc.linhas)) { p.push(problema('linhas_invalidas', 'erro', 'linhas não é uma lista.', 'linhas')); return p }
  const ids = new Set<string>()
  doc.linhas.forEach((x, i) => {
    const pref = `linhas[${i}]`
    if (!ehObj(x)) { p.push(problema('linha_invalida', 'erro', `${pref} não é um objeto.`, pref)); return }
    if (x.ordem !== i + 1) p.push(problema('ordem_incoerente', 'erro', `${pref}.ordem=${String(x.ordem)} (esperado ${i + 1}).`, `${pref}.ordem`))
    if (typeof x.id !== 'string' || !x.id) p.push(problema('id_ausente', 'erro', `${pref}.id ausente.`, `${pref}.id`))
    else if (ids.has(x.id)) p.push(problema('id_duplicado', 'erro', `${pref}.id repetido.`, `${pref}.id`))
    else ids.add(x.id)
    if (typeof x.libelleOriginal !== 'string') p.push(problema('libelle_invalido', 'erro', `${pref}.libelleOriginal não é texto.`, `${pref}.libelleOriginal`))
    if (x.natureza !== 'documental') p.push(problema('natureza_invalida', 'erro', `${pref}.natureza deve ser «documental».`, `${pref}.natureza`))
    for (const c of ['quantidade', 'taxa', 'base', 'montante'] as const)
      if (!numOuNull(x[c])) p.push(problema('numero_invalido', 'erro', `${pref}.${c} não é número finito nem null.`, `${pref}.${c}`))
    const cl = x.classificacao
    if (!ehObj(cl)) p.push(problema('classificacao_invalida', 'erro', `${pref}.classificacao ausente.`, `${pref}.classificacao`))
    else {
      if (!CATEGORIAS_RUBRICA.includes(cl.categoria as CategoriaRubrica)) p.push(problema('categoria_invalida', 'erro', `${pref}: categoria ${String(cl.categoria)} desconhecida.`))
      if (!ESTADOS_CLASS.includes(cl.estado as string)) p.push(problema('estado_classificacao_invalido', 'erro', `${pref}: estado de classificação inválido.`))
      if (!ORIGENS_CLASS.includes(cl.origem as string)) p.push(problema('origem_classificacao_invalida', 'erro', `${pref}: origem de classificação inválida.`))
      if (cl.estado === 'confirmada' && cl.origem !== 'utilizador')
        p.push(problema('confirmacao_sem_utilizador', 'erro', `${pref}: classificação «confirmada» sem origem «utilizador».`))
    }
    if (!Array.isArray(x.estimativas)) p.push(problema('estimativas_invalidas', 'erro', `${pref}.estimativas deve ser uma lista.`))
    else x.estimativas.forEach((e, j) => {
      if (!ehObj(e) || typeof e.valor !== 'number' || !Number.isFinite(e.valor) || typeof e.origem !== 'string')
        p.push(problema('estimativa_invalida', 'erro', `${pref}.estimativas[${j}] inválida.`))
    })
  })
  return p
}

// ───────────────────────── consultas simples (sem dinheiro) ─────────────────────────
/** Nº de linhas por categoria + quantas têm classificação confirmada pelo utilizador. */
export function contarPorCategoria(doc: DocumentoRubricas): { porCategoria: Record<CategoriaRubrica, number>; confirmadas: number; porClassificar: number } {
  const porCategoria = Object.fromEntries(CATEGORIAS_RUBRICA.map(c => [c, 0])) as Record<CategoriaRubrica, number>
  let confirmadas = 0, porClassificar = 0
  for (const l of doc.linhas) {
    porCategoria[l.classificacao.categoria]++
    if (l.classificacao.estado === 'confirmada') confirmadas++
    else porClassificar++
  }
  return { porCategoria, confirmadas, porClassificar }
}
