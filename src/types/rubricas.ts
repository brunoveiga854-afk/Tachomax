// src/types/rubricas.ts
// Estrutura que conserva TODAS as linhas («rubricas») de uma fiche de paie tal como estão impressas.
// Etapa 2A: só tipos. Ainda NÃO está ligada à app (nada lê nem escreve isto no AsyncStorage).
// Persistência futura: chave própria `monSalaire_rubricas_v1`, separada de `monSalaire_v2`, a implementar
// e a validar em conjunto com os backups/restauros antes de ativar a funcionalidade.
//
// Princípios:
//   • Valor ausente = null (NUNCA se converte em 0). 0 só existe se estiver impresso 0.
//   • Valores DOCUMENTAIS (impressos) vivem em campos próprios; estimativas, se um dia existirem, vão em `estimativas`
//     e nunca se misturam nem substituem os documentais.
//   • O libellé é guardado exatamente como foi recebido.
//   • Uma categoria sugerida (IA ou regra) nunca é «confirmada» automaticamente.
//   • Campos que não conhecemos ficam preservados em `desconhecidos`.

export const VERSAO_ESQUEMA_RUBRICAS = 1 as const

export type CategoriaRubrica =
  | 'salaire_base'
  | 'heures_equivalence'
  | 'heures_supplementaires'
  | 'travail_nuit'
  | 'conges_payes'          // inclui retenções e indemnizações (ver `subcategoria`)
  | 'jours_feries'
  | 'repos_compensateur'
  | 'arret_maladie'
  | 'autres_absences'
  | 'prime'
  | 'regularisation'
  | 'cotisation_retenue'
  | 'inconnue'

export const CATEGORIAS_RUBRICA: readonly CategoriaRubrica[] = [
  'salaire_base', 'heures_equivalence', 'heures_supplementaires', 'travail_nuit', 'conges_payes', 'jours_feries',
  'repos_compensateur', 'arret_maladie', 'autres_absences', 'prime', 'regularisation', 'cotisation_retenue', 'inconnue',
]

/** Quem propôs a categoria. 'nenhuma' = sem proposta. */
export type OrigemClassificacao = 'ia' | 'regra' | 'utilizador' | 'nenhuma'
/** 'sugerida' = proposta por IA/regra; 'confirmada' só por ação explícita do utilizador (nunca criada pelo normalizador). */
export type EstadoClassificacao = 'nao_classificada' | 'sugerida' | 'confirmada' | 'rejeitada'

export type ClassificacaoRubrica = {
  categoria: CategoriaRubrica
  /** p. ex. 'majoracao_25' | 'majoracao_50' | 'retenue' | 'indemnite' — só sugestão, texto livre controlado pelo extrator/regra */
  subcategoria: string | null
  origem: OrigemClassificacao
  estado: EstadoClassificacao
  /** 0..1 quando a IA o indica; null se desconhecida */
  confianca: number | null
  /** texto de categoria recebido, tal como veio (para auditoria), quando não foi reconhecido ou foi normalizado */
  categoriaBruta: string | null
}

/** Coluna do bulletin onde a linha está impressa. Não implica sinal (uma «retenue» costuma vir impressa positiva). */
export type ColunaRubrica = 'gain' | 'retenue' | 'patronal' | 'informatif' | 'inconnu'
/** Sinal ARITMÉTICO do montante impresso. 'desconhecido' quando não há montante nem indicação. */
export type SinalRubrica = 'positivo' | 'negativo' | 'zero' | 'desconhecido'

export type PeriodoRubrica = { de: string | null; ate: string | null }   // ISO yyyy-mm-dd, só se interpretável

export type GravidadeProblema = 'info' | 'aviso' | 'erro'
export type ProblemaDados = {
  codigo: string
  gravidade: GravidadeProblema
  campo?: string
  mensagem: string
}

/** Estimativa (NÃO documental). O normalizador desta etapa nunca cria nenhuma. */
export type EstimativaRubrica = {
  campo: 'quantidade' | 'taxa' | 'base' | 'montante'
  valor: number
  origem: string
  nota?: string
}

export type RubricaFiche = {
  id: string                       // estável: depende do documento, da posição e do conteúdo, não só do mês
  ordem: number                    // 1-based, ordem original no documento
  natureza: 'documental'           // os campos abaixo são os impressos
  libelleOriginal: string          // sem reescrita
  quantidade: number | null
  unidade: string | null           // como impresso ('h', 'j', '%'…)
  taxa: number | null
  base: number | null
  montante: number | null          // COM o sinal impresso; nunca se assume «ganho»
  sinal: SinalRubrica
  coluna: ColunaRubrica
  colunaBruta: string | null       // texto de coluna recebido, quando existia
  periodoTexto: string | null      // texto do período da linha, quando indicado
  periodo: PeriodoRubrica | null   // interpretação segura do texto (ou null)
  classificacao: ClassificacaoRubrica
  estimativas: EstimativaRubrica[]
  desconhecidos: Record<string, unknown>   // campos da linha que não conhecemos, preservados
  problemas: ProblemaDados[]
}

/** Totais impressos no documento. null = não lido; 0 só se estiver impresso 0. */
export type TotaisImpressos = {
  brut: number | null
  cotisationsSalariales: number | null
  cotisationsPatronales: number | null
  netImposable: number | null
  netSocial: number | null
  netAvantImpot: number | null
  pas: number | null
  netPaye: number | null
  desconhecidos: Record<string, unknown>
}

export type EstadoDocumentoRubricas = 'extraido' | 'confirmado' | 'editado'

export type PeriodoDocumental = {
  mes: number | null               // 0-11
  ano: number | null
  texto: string | null             // «Avril 2026» como recebido
}

/** Completude ESTRUTURAL de uma extração. Nunca prova que todas as rubricas impressas foram lidas. */
export type EstadoCompletude = 'completo_estrutural' | 'incompleto' | 'desconhecido'

export type MotivoCompletude = {
  codigo: string
  gravidade: 'info' | 'aviso' | 'erro'
  mensagem: string
}

export type CompletudeDocumento = {
  estado: EstadoCompletude
  motivos: MotivoCompletude[]
  /** true quando as linhas foram recuperadas de uma resposta truncada/inválida (podem faltar linhas). */
  parcial: boolean
  nLinhas: number
  /** `nbLignes` declarado pela IA (null se ausente ou inválido). */
  nbLinhasDeclarado: number | null
  stopReason: string | null
  /** Sempre false: a verificação é estrutural; não garante que a IA leu todas as linhas do documento. */
  garantiaLeituraCompleta: false
}

/** Assinala que este documento coincide (por id ou hash) com um já guardado mas tem conteúdo DIFERENTE: o existente foi conservado. */
export type ConflitoDocumento = {
  comIdDocumento: string
  motivo: 'conteudo_diferente' | 'identificadores_ambiguos'
  detetadoEm: string
  origem: 'importacao' | 'restauro'
}

export type DocumentoRubricas = {
  versaoEsquema: typeof VERSAO_ESQUEMA_RUBRICAS
  idDocumento: string              // estável (hash do documento, id fornecido ou impressão digital do conteúdo)
  origemId: 'fornecido' | 'hash_documento' | 'conteudo'
  importadoEm: string              // ISO
  periodoDocumento: PeriodoDocumental
  modeloIA: string | null
  versaoPrompt: string | null
  hashDocumento: string | null
  linhas: RubricaFiche[]           // ordem original
  totaisImpressos: TotaisImpressos
  desconhecidos: Record<string, unknown>
  estado: EstadoDocumentoRubricas  // o normalizador devolve sempre 'extraido'
  problemas: ProblemaDados[]
  /** Preenchido pela Etapa 2C (extracaoRubricas.ts). Ausente em documentos da 2A. */
  completude?: CompletudeDocumento
  /** Preenchido pela Etapa 2D (rubricasStore.ts) quando a versão é uma alternativa em conflito com um documento já guardado. */
  conflito?: ConflitoDocumento
}

/**
 * CONTRATO que a futura extração por IA deverá produzir (um objeto por fiche). Todas as chaves são opcionais
 * exceto `lignes`; qualquer chave não listada é preservada em `desconhecidos`.
 *   {
 *     idDocumento?: string, hash?: string, modele?: string, versionPrompt?: string,
 *     periode?: "Avril 2026", moisIndex?: 0-11, annee?: 2026,
 *     totaux?: { brut, cotisationsSalariales, cotisationsPatronales, netImposable, netSocial, netAvantImpot, pas, netPaye },
 *     lignes: [{
 *       libelle: string,                // EXATAMENTE como impresso
 *       quantite?: number|string|null, unite?: string|null,
 *       taux?: number|string|null, base?: number|string|null, montant?: number|string|null,   // montant COM sinal impresso
 *       sens?: '+'|'-'|'positif'|'negatif',        // só se o documento o indicar de forma explícita
 *       colonne?: 'gain'|'retenue'|'patronal'|'informatif',
 *       periode?: string | { du, au },              // se a linha indicar um período
 *       categorie?: string, sousCategorie?: string, confiance?: 0..1   // SUGESTÃO da IA, nunca confirmação
 *     }, ...]
 *   }
 * Valores que não estão no documento: omitir ou null (nunca 0).
 * Etapa 2C — a extração detalhada acrescenta ainda (preservadas em `desconhecidos`, lidas por completudeRubricas.ts):
 *   documento: `nbLignes` (nº de linhas declarado) e `fin: true` (última chave); linha: `n` (1..N, sem buracos).
 * Números: JSON; o normalizador também aceita «1 234,56», «1.234,56», «12,50-» e «(12,50)» (negativos por formato).
 */
export type RespostaExtracaoRubricas = Record<string, unknown>
