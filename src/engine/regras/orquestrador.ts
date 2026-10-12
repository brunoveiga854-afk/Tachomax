// src/engine/regras/orquestrador.ts
// Junta as restrições APLICÁVEIS, avalia-as e identifica a mais limitativa.
// Função pura: não lê storage, não conhece a UI, não escreve nada.
//
// REGRAS DE HONESTIDADE DO RESULTADO
//  • `resultadoMatematico.fimTeoricoMs` é uma conta; NÃO é autorização. A autorização só é
//    'limitada_as_restricoes_avaliadas' quando o estado é 'confirmado' – e nunca cobre `naoAvaliadas`.
//  • Falta de dados essenciais (início do serviço, fim do descanso anterior, restrição diária aplicável sem
//    dados) → 'dados_insuficientes' e SEM hora limite (apenas `limiteParcial`, para diagnóstico).
//  • O texto `resumo` nunca usa frases permissivas («podes continuar…»).
import { janelaDescansoDiario, type DescansoSeguinte } from './amplitude'
import { avaliarServicoDiario } from './servico'
import { avaliarPausas, type AvaliacaoPausas, type PausaRegistada } from './pausas'
import type { ContagemReducoes } from './descansos'
import { avaliarServicoSemanal, REGRAS_NAO_SUPORTADAS } from './semanal'
import { REF } from './referencias'
import { formatarInstante } from './tempo'
import {
  piorEstado,
  type ContextoRegulamentar, type EstadoResultado, type NaoAvaliada, type Referencia, type Restricao,
} from './tipos'

export type EntradaMotor = {
  contexto: ContextoRegulamentar
  /** início do serviço (ms de relógio de parede); null/ausente → dados insuficientes */
  inicioServicoMs: number | null | undefined
  /** instante da simulação (por omissão = início) */
  referenciaMs?: number | null
  /** serviço já feito até à referência */
  servicoAcumuladoSeg?: number
  /** pausa que se pretende fazer a partir da referência (hipótese, nunca dado confirmado) */
  pausaPrevistaSeg?: number
  pausas?: PausaRegistada[]
  /** fim do descanso anterior; `confirmado` = indicado/validado pelo motorista (não deduzido do histórico) */
  fimDescansoAnterior?: { ms: number; confirmado: boolean } | null
  /** descanso que o motorista pretende gozar a seguir; ausente → assume-se normal, como simulação */
  descansoSeguinte?: DescansoSeguinte | null
  reducoes?: ContagemReducoes | null
  semana?: { servicoSemanaSeg: number | null; completa: boolean } | null
  confirmacoes?: {
    /** o «segServico» da app corresponde ao tempo de serviço regulamentar (inclui o que a lei inclui) */
    tempoServicoEquivaleServicoRegulamentar?: boolean
  }
}

export type ResultadoMotor = {
  estado: EstadoResultado
  autorizacao: 'nao_concedida' | 'limitada_as_restricoes_avaliadas'
  resultadoMatematico: {
    natureza: 'calculo_matematico'
    fimTeoricoMs: number | null
    servicoUtilizavelSeg: number | null
  }
  /** só para diagnóstico quando o estado é 'dados_insuficientes' (NÃO usar como limite) */
  limiteParcial: { fimMs: number; apenasRestricoes: string[] } | null
  restricaoMaisLimitativa: Restricao | null
  restricoes: Restricao[]
  pausas: AvaliacaoPausas | null
  janelasDescanso: { normalMs: number | null; reduzidoMs: number | null; reduzidoDisponivel: boolean | null }
  pressupostos: string[]
  emFalta: string[]
  referencias: Referencia[]
  naoAvaliadas: NaoAvaliada[]
  resumo: string
}

const unico = <T>(xs: T[]): T[] => Array.from(new Set(xs))

export function avaliarRegras(e: EntradaMotor): ResultadoMotor {
  const ctx = e.contexto
  const pressupostos: string[] = ['Horas locais tratadas como contínuas (mudança de hora não tratada).']
  const emFalta: string[] = []
  const naoAvaliadas: NaoAvaliada[] = [...REGRAS_NAO_SUPORTADAS]

  const vazio = (): ResultadoMotor => ({
    estado: 'dados_insuficientes',
    autorizacao: 'nao_concedida',
    resultadoMatematico: { natureza: 'calculo_matematico', fimTeoricoMs: null, servicoUtilizavelSeg: null },
    limiteParcial: null,
    restricaoMaisLimitativa: null,
    restricoes: [],
    pausas: null,
    janelasDescanso: { normalMs: null, reduzidoMs: null, reduzidoDisponivel: null },
    pressupostos,
    emFalta: ['hora de início do serviço'],
    referencias: [],
    naoAvaliadas,
    resumo: 'Dados insuficientes: falta a hora de início do serviço. Nenhum limite calculado; isto não é uma autorização regulamentar.',
  })

  if (typeof e.inicioServicoMs !== 'number' || !Number.isFinite(e.inicioServicoMs)) return vazio()
  const inicio = e.inicioServicoMs
  const ref = typeof e.referenciaMs === 'number' && Number.isFinite(e.referenciaMs) ? e.referenciaMs : inicio
  const acum = Math.max(0, e.servicoAcumuladoSeg ?? 0)
  const pausaPrev = Math.max(0, e.pausaPrevistaSeg ?? 0)
  const equivale = e.confirmacoes?.tempoServicoEquivaleServicoRegulamentar === true

  if (pausaPrev > 0) pressupostos.push(`Pausa prevista de ${Math.round(pausaPrev / 60)} min assumida como hipótese (não é dado confirmado).`)
  if (ref < inicio) emFalta.push('referência anterior ao início do serviço (dados incoerentes)')

  const restricoes: Restricao[] = []

  // ── 1. Serviço diário (R3312-51 / L3312-1) ──────────────────────────────────
  const servicoAplicavel = ctx.enquadramentoFrances !== 'nao'
  let rServico: Restricao
  if (!servicoAplicavel) {
    rServico = {
      id: 'servico_diario', nome: 'Tempo de serviço diário', referencias: [REF.R3312_51, REF.L3312_1],
      avaliada: false, estado: 'dados_insuficientes', fimMaximoMs: null, pressupostos: [], emFalta: [],
      motivoNaoAvaliada: 'enquadramento do Code des transports não aplicável',
    }
  } else {
    const a = avaliarServicoDiario({ inicioServicoMs: inicio, referenciaMs: ref, servicoAcumuladoSeg: acum, pausaPrevistaSeg: pausaPrev })
    const pr = [...a.avisos]
    const ef: string[] = []
    let est: EstadoResultado = 'confirmado'
    if (ctx.enquadramentoFrances === 'desconhecido') { est = 'simulacao_condicionada'; pr.push('Assumido o enquadramento do Code des transports (transporte público rodoviário de mercadorias).'); ef.push('confirmação do enquadramento (Code des transports)') }
    if (!equivale) { est = 'simulacao_condicionada'; pr.push('Tempo de serviço da app tratado como tempo de serviço/trabalho regulamentar (inclui trabalho e, eventualmente, disponibilidade).'); ef.push('confirmação de que o serviço da app = tempo de serviço regulamentar') }
    if (a.trabalhoNoturno) pr.push('Limite noturno de 10h aplicado ao serviço como aproximação por excesso do tempo de trabalho.')
    if (pausaPrev > 0) est = 'simulacao_condicionada'
    rServico = {
      id: 'servico_diario', nome: 'Tempo de serviço diário', referencias: [REF.R3312_51, REF.L3312_1],
      avaliada: true, estado: est, fimMaximoMs: a.fimMaximoMs, pressupostos: pr, emFalta: ef,
      detalhe: { limiteAplicadoSeg: a.limiteAplicadoSeg, trabalhoNoturno: a.trabalhoNoturno, restanteServicoSeg: a.restanteServicoSeg },
    }
  }

  // ── 2. Amplitude / janela de descanso diário (Reg. 561/2006, art. 8.º n.º 2) ─
  const amplitudeAplicavel = ctx.regulamento561 !== 'nao' && !ctx.equipagem
  let rAmpl: Restricao
  let janelas: ResultadoMotor['janelasDescanso'] = { normalMs: null, reduzidoMs: null, reduzidoDisponivel: null }
  const baseAmpl = { id: 'amplitude_janela_descanso' as const, nome: 'Amplitude: janela de 24h para gozar o descanso diário', referencias: [REF.CE561_ART8_2, REF.CE561_ART8_4] }
  if (!amplitudeAplicavel) {
    const motivo = ctx.equipagem ? 'condução em equipagem: regime não suportado' : 'Reg. (CE) 561/2006 não aplicável'
    rAmpl = { ...baseAmpl, avaliada: false, estado: 'dados_insuficientes', fimMaximoMs: null, pressupostos: [], emFalta: [], motivoNaoAvaliada: motivo }
    naoAvaliadas.push({ id: 'amplitude_descanso_diario', texto: 'Janela de 24h do descanso diário', motivo })
  } else if (!e.fimDescansoAnterior || !Number.isFinite(e.fimDescansoAnterior.ms)) {
    rAmpl = { ...baseAmpl, avaliada: false, estado: 'dados_insuficientes', fimMaximoMs: null, pressupostos: [], emFalta: ['fim do descanso anterior'], motivoNaoAvaliada: 'sem fim do descanso anterior não é possível fixar a janela de 24h' }
  } else if (e.fimDescansoAnterior.ms > inicio) {
    rAmpl = { ...baseAmpl, avaliada: false, estado: 'dados_insuficientes', fimMaximoMs: null, pressupostos: [], emFalta: ['dados coerentes: o descanso anterior termina depois do início do serviço'], motivoNaoAvaliada: 'dados incoerentes' }
  } else {
    const fimDesc = e.fimDescansoAnterior.ms
    const restantes = e.reducoes ? e.reducoes.restantes : null
    const escolhido = e.descansoSeguinte ?? 'normal'
    const j = janelaDescansoDiario({ fimDescansoAnteriorMs: fimDesc, descansoSeguinte: escolhido, reducoesRestantes: restantes })
    const jN = janelaDescansoDiario({ fimDescansoAnteriorMs: fimDesc, descansoSeguinte: 'normal', reducoesRestantes: restantes })
    const jR = janelaDescansoDiario({ fimDescansoAnteriorMs: fimDesc, descansoSeguinte: 'reduzido', reducoesRestantes: restantes })
    janelas = { normalMs: jN.fimMaximoServicoMs, reduzidoMs: jR.reducaoPedidaIndisponivel ? null : jR.fimMaximoServicoMs, reduzidoDisponivel: restantes === null ? null : restantes > 0 }
    const pr = [...j.avisos, `Janela: fim do descanso anterior (${formatarInstante(fimDesc, true)}) + 24h − ${Math.round(j.descansoUsadoSeg / 3600)}h de descanso = ${formatarInstante(j.fimMaximoServicoMs, true)}.`]
    const ef: string[] = []
    let est: EstadoResultado = 'confirmado'
    if (!e.descansoSeguinte) { est = 'simulacao_condicionada'; pr.push('Descanso seguinte não indicado: assumido normal (11h).'); ef.push('descanso diário que pretendes gozar a seguir (11h ou 9h)') }
    if (!e.fimDescansoAnterior.confirmado) { est = 'simulacao_condicionada'; pr.push('Fim do descanso anterior deduzido do histórico, não confirmado.'); ef.push('confirmação do fim do descanso anterior') }
    if (ctx.regulamento561 === 'desconhecido') { est = 'simulacao_condicionada'; pr.push('Assumida a aplicabilidade do Reg. (CE) 561/2006.'); ef.push('confirmação de que o 561/2006 se aplica') }
    if (e.descansoSeguinte === 'reduzido') {
      if (!e.reducoes) { est = 'simulacao_condicionada'; ef.push('contagem das reduções já utilizadas') }
      else if (e.reducoes.estado !== 'confirmado') { est = 'simulacao_condicionada'; ef.push(...e.reducoes.emFalta, ...e.reducoes.pressupostos) }
    }
    if (j.reducaoPedidaIndisponivel && e.reducoes) pr.push(...e.reducoes.pressupostos)
    rAmpl = { ...baseAmpl, avaliada: true, estado: est, fimMaximoMs: j.fimMaximoServicoMs, pressupostos: pr, emFalta: ef,
      detalhe: { descansoUsado: j.descansoUsado, amplitudeMaximaSeg: j.amplitudeMaximaSeg, reducaoPedidaIndisponivel: j.reducaoPedidaIndisponivel } }
  }

  // ── 3. Serviço semanal numa semana isolada (R3312-50) ───────────────────────
  const baseSem = { id: 'servico_semanal_isolado' as const, nome: 'Tempo de serviço semanal (semana isolada)', referencias: [REF.R3312_50] }
  let rSem: Restricao
  if (ctx.enquadramentoFrances === 'nao') {
    rSem = { ...baseSem, avaliada: false, estado: 'dados_insuficientes', fimMaximoMs: null, pressupostos: [], emFalta: [], motivoNaoAvaliada: 'enquadramento do Code des transports não aplicável' }
  } else {
    const s = avaliarServicoSemanal({ categoria: ctx.categoria, servicoSemanaSeg: e.semana ? e.semana.servicoSemanaSeg : null, semanaCompleta: e.semana?.completa === true })
    if (!s.avaliada) {
      rSem = { ...baseSem, avaliada: false, estado: s.estado, fimMaximoMs: null, pressupostos: s.pressupostos, emFalta: s.emFalta, motivoNaoAvaliada: s.motivoNaoAvaliada }
    } else {
      let est = s.estado
      const pr = [...s.pressupostos]
      const ef = [...s.emFalta]
      if (ctx.enquadramentoFrances === 'desconhecido') { est = piorEstado(est, 'simulacao_condicionada'); ef.push('confirmação do enquadramento (Code des transports)') }
      if (!equivale) { est = piorEstado(est, 'simulacao_condicionada'); pr.push('Serviço semanal da app tratado como tempo de serviço regulamentar.') }
      if (pausaPrev > 0) est = piorEstado(est, 'simulacao_condicionada')
      rSem = { ...baseSem, avaliada: true, estado: est, pressupostos: pr, emFalta: ef,
        fimMaximoMs: ref + ((s.restanteSeg ?? 0) + pausaPrev) * 1000,
        detalhe: { limiteSeg: s.limiteSeg, restanteSeg: s.restanteSeg } }
    }
  }

  restricoes.push(rAmpl, rServico, rSem)

  // ── Restrição mais limitativa e estado global ──────────────────────────────
  const comFim = restricoes.filter(r => r.avaliada && r.fimMaximoMs !== null)
  // Restrições diárias aplicáveis mas sem dados para avaliar → nenhum limite numérico é comprovável.
  const essenciaisEmFalta = (amplitudeAplicavel && !rAmpl.avaliada) || (servicoAplicavel && !rServico.avaliada)
  const maisLimitativa = comFim.length === 0
    ? null
    : comFim.reduce((a, b) => ((b.fimMaximoMs as number) < (a.fimMaximoMs as number) ? b : a))

  for (const r of restricoes) {
    emFalta.push(...r.emFalta)
    pressupostos.push(...r.pressupostos)
  }

  // Pausas de trabalho (L3312-2): avaliadas sobre o serviço previsto até ao fim teórico.
  let pausas: AvaliacaoPausas | null = null
  const fimTeorico = !essenciaisEmFalta && maisLimitativa ? (maisLimitativa.fimMaximoMs as number) : null
  if (servicoAplicavel) {
    const fimRef = fimTeorico ?? ref
    const trabalhoSeg = fimTeorico !== null ? acum + Math.max(0, (fimTeorico - ref) / 1000 - pausaPrev) : acum
    pausas = avaliarPausas({ inicioMs: inicio, fimReferenciaMs: fimRef, trabalhoSeg, pausas: e.pausas ?? [], pausaPrevistaSeg: pausaPrev })
    pressupostos.push(...pausas.pressupostos)
    emFalta.push(...pausas.emFalta)
  }

  const estadosAvaliados = restricoes.filter(r => r.avaliada).map(r => r.estado)
  let estado: EstadoResultado
  if (comFim.length === 0 || essenciaisEmFalta) estado = 'dados_insuficientes'
  else {
    estado = piorEstado(...estadosAvaliados, ...(pausas ? [pausas.estado] : []))
    // restrição semanal aplicável mas sem dados: nunca confirmado
    if (servicoAplicavel && !rSem.avaliada) estado = piorEstado(estado, 'simulacao_condicionada')
  }

  const servicoUtilizavelSeg = fimTeorico !== null ? Math.max(0, Math.round(acum + (fimTeorico - ref) / 1000 - pausaPrev)) : null
  const limiteParcial = estado === 'dados_insuficientes' && maisLimitativa
    ? { fimMs: maisLimitativa.fimMaximoMs as number, apenasRestricoes: comFim.map(r => r.id) }
    : null

  const referencias = unico<Referencia>([
    ...restricoes.filter(r => r.avaliada).flatMap(r => r.referencias),
    ...(pausas ? pausas.referencias : []),
  ])

  const autorizacao: ResultadoMotor['autorizacao'] = estado === 'confirmado' ? 'limitada_as_restricoes_avaliadas' : 'nao_concedida'

  let resumo: string
  if (estado === 'dados_insuficientes') {
    resumo = `Dados insuficientes: ${unico(emFalta).join('; ') || 'restrição essencial não avaliável'}. Nenhum limite calculado; isto não é uma autorização regulamentar.`
  } else if (estado === 'simulacao_condicionada') {
    resumo = `Simulação condicionada: cálculo matemático com fim teórico às ${formatarInstante(fimTeorico as number, true)} (restrição mais limitativa: ${maisLimitativa?.nome}). Depende de pressupostos e dados por confirmar; não constitui autorização regulamentar.`
  } else {
    resumo = `Cálculo com dados confirmados: fim teórico às ${formatarInstante(fimTeorico as number, true)} (restrição mais limitativa: ${maisLimitativa?.nome}), limitado às restrições avaliadas; não cobre condução, regras semanais e demais pontos em «naoAvaliadas».`
  }

  return {
    estado,
    autorizacao,
    resultadoMatematico: { natureza: 'calculo_matematico', fimTeoricoMs: fimTeorico, servicoUtilizavelSeg },
    limiteParcial,
    restricaoMaisLimitativa: estado === 'dados_insuficientes' ? null : maisLimitativa,
    restricoes,
    pausas,
    janelasDescanso: janelas,
    pressupostos: unico(pressupostos),
    emFalta: unico(emFalta),
    referencias,
    naoAvaliadas,
    resumo,
  }
}
