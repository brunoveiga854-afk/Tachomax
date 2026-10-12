// src/utils/gravarServico.ts
// Gravação de um serviço no `historique` SEM substituir serviços existentes.
// Lógica pura sobre um armazenamento injetado (AsyncStorage na app, falso nos testes).
//  • lê e grava dentro da fila (comFilaHistorico): sem perdas por gravações concorrentes;
//  • se o histórico estiver ilegível, NÃO escreve nada;
//  • identidade ambígua → devolve 'ambiguo' sem escrever; só uma resolução explícita permite continuar;
//  • tudo o que um serviço novo substitui (só dias «sem trabalho», ou conflitos resolvidos com 'substituir') passa
//    primeiro pelo callback `arquivar` (historique_substituidos) ANTES de ser removido.
import { planearGravacao, aplicarResolucao, type ServicoReg, type ResolucaoAmbiguo } from './diasServicos'
import { comFilaHistorico } from './filaHistorico'

export type ArmazenamentoHistorico = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export const CHAVE_HISTORICO = 'historique'

export type OpcoesGravar = {
  /** resposta explícita a um conflito ambíguo anterior */
  resolucao?: ResolucaoAmbiguo | null
  /** guarda cópia dos registos que vão ser substituídos (nunca lança) */
  arquivar?: (removidos: ServicoReg[], idNovo: string) => Promise<void>
  /** corta o excedente arquivando-o (nunca lança); por defeito não corta */
  cortar?: (lista: ServicoReg[]) => Promise<ServicoReg[]>
  /** descarta entradas inválidas, como a Home sempre fez */
  filtrarValidas?: boolean
  ordenar?: (lista: ServicoReg[]) => ServicoReg[]
  anoFallback?: number
  aoIgnorarInvalida?: (entry: ServicoReg) => void
}

export type ResultadoGravar =
  | { estado: 'ok'; acao: 'inserir' | 'mesmo_servico'; lista: ServicoReg[]; listaGuardada: ServicoReg[]; arquivados: ServicoReg[] }
  | { estado: 'ambiguo'; motivo: 'mesmo_inicio' | 'sobreposicao' | 'dia_com_servicos'; conflitos: ServicoReg[] }
  | { estado: 'ilegivel' }
  | { estado: 'erro' }

const valida = (e: ServicoReg): boolean => {
  const isTrab = e.type === 'TRAB' || e.type === 'DEC'
  return !!(e.date && e.type && (!isTrab || (e.debut && e.fin)))
}

export function gravarServico(storage: ArmazenamentoHistorico, novo: ServicoReg, o: OpcoesGravar = {}): Promise<ResultadoGravar> {
  return comFilaHistorico<ResultadoGravar>(async () => {
    let lista: ServicoReg[] = []
    try {
      const raw = await storage.getItem(CHAVE_HISTORICO)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return { estado: 'ilegivel' }
        lista = parsed
      }
    } catch { return { estado: 'ilegivel' } }

    const plano = planearGravacao(lista, novo, o.anoFallback)
    let nova: ServicoReg[]
    let arquivados: ServicoReg[] = []
    let acao: 'inserir' | 'mesmo_servico'
    if (plano.acao === 'ambiguo') {
      if (!o.resolucao) return { estado: 'ambiguo', motivo: plano.motivo, conflitos: plano.conflitos }
      // dia_com_servicos nunca se resolve por substituição: não se apagam serviços para pôr um «repos»
      if (plano.motivo === 'dia_com_servicos') return { estado: 'ambiguo', motivo: plano.motivo, conflitos: plano.conflitos }
      const r = aplicarResolucao(lista, novo, plano.conflitos, o.resolucao)
      nova = r.lista; arquivados = r.arquivar; acao = 'inserir'
    } else if (plano.acao === 'mesmo_servico') {
      nova = plano.lista; acao = 'mesmo_servico'
    } else {
      nova = plano.lista; arquivados = plano.arquivar; acao = 'inserir'
    }

    if (o.filtrarValidas) {
      nova = nova.filter(e => { const ok = valida(e); if (!ok) o.aoIgnorarInvalida?.(e); return ok })
    }
    if (o.ordenar) nova = o.ordenar(nova)
    try {
      if (arquivados.length && o.arquivar) await o.arquivar(arquivados, String(novo.id))
      const guardada = o.cortar ? await o.cortar(nova) : nova
      // `mesmo_servico` sem alterações: não reescreve (evita tocar no histórico sem necessidade)
      if (!(acao === 'mesmo_servico' && JSON.stringify(nova) === JSON.stringify(lista))) {
        await storage.setItem(CHAVE_HISTORICO, JSON.stringify(guardada))
      }
      return { estado: 'ok', acao, lista: nova, listaGuardada: guardada, arquivados }
    } catch { return { estado: 'erro' } }
  })
}

/** Elimina UM serviço pelo id (lê o valor mais recente dentro da fila). */
export function eliminarServicoGravado(storage: ArmazenamentoHistorico, id: string): Promise<{ estado: 'ok'; lista: ServicoReg[] } | { estado: 'ilegivel' } | { estado: 'erro' }> {
  return comFilaHistorico(async () => {
    let lista: ServicoReg[] = []
    try {
      const raw = await storage.getItem(CHAVE_HISTORICO)
      if (raw) { const p = JSON.parse(raw); if (!Array.isArray(p)) return { estado: 'ilegivel' as const }; lista = p }
    } catch { return { estado: 'ilegivel' as const } }
    const nova = lista.filter(r => String(r.id) !== String(id))
    try { await storage.setItem(CHAVE_HISTORICO, JSON.stringify(nova)); return { estado: 'ok' as const, lista: nova } } catch { return { estado: 'erro' as const } }
  })
}

/** Altera UM serviço pelo id (lê o valor mais recente dentro da fila; os restantes ficam intactos). */
export function alterarServicoGravado(storage: ArmazenamentoHistorico, id: string, alt: (atual: ServicoReg) => ServicoReg): Promise<{ estado: 'ok'; lista: ServicoReg[] } | { estado: 'ilegivel' } | { estado: 'inexistente' } | { estado: 'erro' }> {
  return comFilaHistorico(async () => {
    let lista: ServicoReg[] = []
    try {
      const raw = await storage.getItem(CHAVE_HISTORICO)
      if (raw) { const p = JSON.parse(raw); if (!Array.isArray(p)) return { estado: 'ilegivel' as const }; lista = p }
    } catch { return { estado: 'ilegivel' as const } }
    if (!lista.some(r => String(r.id) === String(id))) return { estado: 'inexistente' as const }
    const nova = lista.map(r => (String(r.id) === String(id) ? alt(r) : r))
    try { await storage.setItem(CHAVE_HISTORICO, JSON.stringify(nova)); return { estado: 'ok' as const, lista: nova } } catch { return { estado: 'erro' as const } }
  })
}

/**
 * Leitura-modificação-escrita genérica (dentro da fila): `fn` recebe o histórico MAIS RECENTE e devolve o que gravar
 * (ou null = não gravar). Se o histórico estiver ilegível, nada é escrito.
 */
export function atualizarHistorico<T>(
  storage: ArmazenamentoHistorico,
  fn: (lista: ServicoReg[]) => Promise<{ gravar: ServicoReg[]; extra: T } | null>,
): Promise<{ estado: 'ok'; extra: T } | { estado: 'sem_alteracao' } | { estado: 'ilegivel' } | { estado: 'erro' }> {
  return comFilaHistorico(async () => {
    let lista: ServicoReg[] = []
    try {
      const raw = await storage.getItem(CHAVE_HISTORICO)
      if (raw) { const p = JSON.parse(raw); if (!Array.isArray(p)) return { estado: 'ilegivel' as const }; lista = p }
    } catch { return { estado: 'ilegivel' as const } }
    try {
      const r = await fn(lista)
      if (!r) return { estado: 'sem_alteracao' as const }
      await storage.setItem(CHAVE_HISTORICO, JSON.stringify(r.gravar))
      return { estado: 'ok' as const, extra: r.extra }
    } catch { return { estado: 'erro' as const } }
  })
}
