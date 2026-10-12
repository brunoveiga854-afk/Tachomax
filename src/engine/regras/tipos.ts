// src/engine/regras/tipos.ts
// Tipos comuns do motor de regras de condução/repouso (assistente). MÓDULO ISOLADO:
// não importa nada da app (nem AppContext, nem Home, nem salário). Funções puras, sem I/O.
//
// Conceitos que NUNCA se confundem neste motor:
//   • resultado MATEMÁTICO  – conta feita com os dados recebidos (ex.: «24h − 11h = 13h»);
//   • AUTORIZAÇÃO regulamentar – só existe quando o estado é «confirmado» e, mesmo então,
//     limitada às restrições efetivamente avaliadas (ver `naoAvaliadas`).

export type EstadoResultado = 'confirmado' | 'simulacao_condicionada' | 'dados_insuficientes'

/** Ordem de «fiabilidade»: o pior estado prevalece ao combinar resultados. */
const ORDEM: Record<EstadoResultado, number> = {
  dados_insuficientes: 0,
  simulacao_condicionada: 1,
  confirmado: 2,
}
export function piorEstado(...estados: EstadoResultado[]): EstadoResultado {
  if (estados.length === 0) return 'dados_insuficientes'
  return estados.reduce((a, b) => (ORDEM[b] < ORDEM[a] ? b : a))
}

/**
 * Nível de verificação da fonte, para sermos honestos sobre o que foi realmente lido:
 *  - 'texto_oficial_lido'        → texto do regulamento/lei lido numa publicação oficial;
 *  - 'fonte_oficial_secundaria'  → síntese de ministério/portal oficial, sem o artigo primário à vista.
 */
export type NivelVerificacao = 'texto_oficial_lido' | 'fonte_oficial_secundaria'

export type Referencia = { id: string; texto: string; verificacao: NivelVerificacao }

export type Aplicabilidade = 'sim' | 'nao' | 'desconhecido'

/** Categoria regulamentar de tempo de serviço (R3312-50). NUNCA deduzida de CD/MIXTE/LD. */
export type CategoriaServico = 'grand_routier' | 'outro_marchandises' | 'messagerie_fonds' | 'desconhecida'

export type ContextoRegulamentar = {
  /** Regulamento (CE) 561/2006 aplicável ao veículo/transporte (ex.: >3,5 t). */
  regulamento561: Aplicabilidade
  /** Transporte público rodoviário de mercadorias sujeito ao Code des transports (L3312-x / R3312-x). */
  enquadramentoFrances: Aplicabilidade
  categoria: CategoriaServico
  /** Condução em equipagem (art. 8.º n.º 5): não suportado. */
  equipagem?: boolean
}

export type IdRestricao =
  | 'amplitude_janela_descanso'
  | 'servico_diario'
  | 'servico_semanal_isolado'

export type Restricao = {
  id: IdRestricao
  nome: string
  referencias: Referencia[]
  /** false = não foi possível/permitido avaliar (ver motivoNaoAvaliada). */
  avaliada: boolean
  estado: EstadoResultado
  /** Instante teórico (ms) até ao qual o serviço pode terminar segundo ESTA restrição. */
  fimMaximoMs: number | null
  pressupostos: string[]
  emFalta: string[]
  motivoNaoAvaliada?: string
  /** Detalhes numéricos úteis (limite aplicado, janela, etc.). */
  detalhe?: Record<string, number | string | boolean | null>
}

export type NaoAvaliada = { id: string; texto: string; motivo: string }
