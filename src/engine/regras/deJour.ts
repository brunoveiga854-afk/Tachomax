// src/engine/regras/deJour.ts
// Adaptador PURO: converte dados já carregados da app (Jour + histórico + profil) em `EntradaMotor`.
// Não lê storage, não escreve nada, não altera os argumentos. Só depende de funções puras
// (./tempo, ./descansos e ../../utils/dataDia para o ano do dia).
//
// REGRA DE OURO: o que a app não sabe fica DESCONHECIDO (`'desconhecido'`, `'desconhecida'`, null).
//  • `profil` (CD/MIXTE/LD) NUNCA decide a categoria regulamentar nem o enquadramento.
//  • Valores só entram como «declarados» (opcoes.declarados) quando o motorista os confirmar no futuro.
//  • Tudo o que é deduzido do histórico entra como NÃO confirmado e gera um aviso explícito.
//
// LIMITAÇÕES CONHECIDAS (documentadas, não escondidas)
//  1. `debut`/`fin` são strings sem data. A data (`date`) é a do INÍCIO do serviço; `fin` < `debut` é lido
//     como «termina no dia seguinte». Um serviço ≥24h, ou com `fin` === `debut`, não é resolvível: o início
//     fica null (→ «dados insuficientes» no motor). Se serviço+pausas > amplitude, avisa-se (possível erro).
//  2. `pausasDetalhe.inicio` é epoch real (Date.now) e o motor usa «relógio de parede»: a conversão é
//     injetável (`opcoes.relogioParede`); por omissão usa o fuso do dispositivo. Pausas que, depois de
//     convertidas, caem fora do serviço são descartadas com aviso (protege contra fuso/dado errado).
//  3. Pausas SEM detalhe (dias antigos, edição manual) não têm posição: ficam fora de `entrada.pausas` e o
//     total em falta vai para `diagnostico.segPausaSemDetalheSeg`. O motor, hoje, trata-as como «sem pausas
//     registadas» (pode parecer pior do que a realidade). Resolver exige um campo novo no EntradaMotor.
//  4. As pausas do adaptador NUNCA levam `natureza`: a app não sabe se a pausa foi tempo livre.
//  5. Fim do descanso anterior: se o histórico mostra um intervalo ≥9h desde o serviço anterior, assume-se
//     que o descanso terminou ao INÍCIO deste serviço (limite superior = hipótese mais permissiva), com
//     `confirmado:false`. Mudança de hora (DST) não é tratada.
//  6. Reduções entre semanais: só se contam com uma referência de descanso semanal (declarada, ou um intervalo
//     ≥24h nos últimos 14 dias, NÃO confirmado). Sem referência → `reducoes` = null (desconhecido).
import { anoDoDia, chaveDia } from '../../utils/dataDia'
import { contarReducoes, classificarDescansoDiario, type DescansoRegistado, type TipoDescanso } from './descansos'
import type { EntradaMotor } from './orquestrador'
import type { DescansoSeguinte } from './amplitude'
import type { PausaRegistada } from './pausas'
import type { Aplicabilidade, CategoriaServico } from './tipos'
import { MS_DIA, inicioSemanaMs, instanteMs, intervaloServico, parseData, parseHoraMin } from './tempo'

export type PausaDetalheApp = { inicio: number; dur: number; origem?: string }

/** Subconjunto estrutural de `Jour` (index.tsx / historique.tsx) de que o adaptador precisa. */
export type JourEntrada = {
  id?: string | number
  date: string
  type: string
  debut?: string
  /** vazio/ausente = serviço ainda em curso */
  fin?: string
  segServico?: number
  segPausa?: number
  pausasDetalhe?: PausaDetalheApp[]
}

export type ProfilApp = 'CD' | 'MIXTE' | 'LD' | null | undefined

export type Declarados = {
  categoria?: CategoriaServico
  regulamento561?: Aplicabilidade
  enquadramentoFrances?: Aplicabilidade
  equipagem?: boolean
  /** descanso que o motorista pretende gozar a seguir */
  descansoSeguinte?: DescansoSeguinte | null
  fimDescansoAnterior?: { ms: number; confirmado: boolean }
  fimUltimoDescansoSemanalMs?: number
  historicoCompleto?: boolean
  semanaCompleta?: boolean
  tempoServicoEquivale?: boolean
  pausaPrevistaSeg?: number
}

export type OpcoesDeJour = {
  /** instante atual REAL (epoch ms); necessário para um serviço em curso */
  agoraMs?: number | null
  /** epoch real → «relógio de parede» (ms). Por omissão: fuso do dispositivo. */
  relogioParede?: (epochMs: number) => number
  declarados?: Declarados
}

export type DiagnosticoDeJour = {
  emCurso: boolean
  atravessaMeiaNoite: boolean
  amplitudeSeg: number | null
  segServico: number
  segPausa: number
  nPausasDetalhe: number
  nPausasDescartadas: number
  segPausaSemDetalheSeg: number
  perfilApp: 'CD' | 'MIXTE' | 'LD' | null
  categoriaDeducidaDoPerfil: false
  servicoAnteriorEncontrado: boolean
  gapDescansoAnteriorSeg: number | null
  tipoDescansoDiarioAnterior: TipoDescanso | 'desconhecido'
  referenciaDescansoSemanalMs: number | null
}

export type ResultadoDeJour = { entrada: EntradaMotor; avisos: string[]; diagnostico: DiagnosticoDeJour }

export const relogioLocal = (epochMs: number): number => epochMs - new Date(epochMs).getTimezoneOffset() * 60_000

const TIPOS_TRABALHO = ['TRAB', 'DEC', 'work', 'dec']
const ehTrabalho = (j: { type?: string }): boolean => TIPOS_TRABALHO.includes(String(j.type))
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const seg = (n: unknown): number => (fin(n) && n > 0 ? n : 0)

type Intervalo = { j: JourEntrada; inicioMs: number; fimMs: number }

function intervaloDe(j: JourEntrada, anoRecurso: number | undefined): { inicioMs: number; fimMs: number } | null {
  const a = anoDoDia(j)
  const iv = intervaloServico(j.date, j.debut, j.fin, Number.isFinite(a) ? a : anoRecurso)
  return 'motivo' in iv ? null : { inicioMs: iv.inicioMs, fimMs: iv.fimMs }
}

const chaveData = (ano: number, mes0: number, dia: number) => `${ano}-${mes0}-${dia}`

export function entradaMotorDeJour(
  servico: JourEntrada,
  historico: JourEntrada[],
  profil: ProfilApp,
  opcoes: OpcoesDeJour = {},
): ResultadoDeJour {
  const avisos: string[] = []
  const relogio = opcoes.relogioParede ?? relogioLocal
  const dec = opcoes.declarados ?? {}
  const agoraParede = fin(opcoes.agoraMs) ? relogio(opcoes.agoraMs) : null
  const segServico = seg(servico.segServico)
  const segPausa = seg(servico.segPausa)

  const anoId = anoDoDia(servico)
  const ano = Number.isFinite(anoId) ? anoId : agoraParede !== null ? new Date(agoraParede).getUTCFullYear() : undefined
  const emCurso = !(typeof servico.fin === 'string' && servico.fin.trim() !== '')

  // ── 1. Intervalo do serviço (passagem da meia-noite incluída) ───────────────
  let inicioMs: number | null = null
  let fimMs: number | null = null
  let atravessa = false
  if (!emCurso) {
    const iv = intervaloServico(servico.date, servico.debut, servico.fin, ano)
    if ('motivo' in iv) avisos.push(`Serviço sem intervalo utilizável: ${iv.motivo}.`)
    else { inicioMs = iv.inicioMs; fimMs = iv.fimMs; atravessa = iv.atravessaMeiaNoite }
  } else {
    const d = parseData(servico.date, ano)
    const m = parseHoraMin(servico.debut)
    if (!d || m === null) avisos.push('Serviço em curso sem data ou hora de início válidas.')
    else inicioMs = instanteMs(d, m)
  }

  let referenciaMs: number | null = null
  if (fimMs !== null) referenciaMs = fimMs
  else if (inicioMs !== null) {
    if (agoraParede !== null) {
      referenciaMs = Math.max(inicioMs, agoraParede)
      if (agoraParede < inicioMs) avisos.push('«Agora» anterior ao início do serviço: referência igual ao início.')
    } else {
      referenciaMs = inicioMs + (segServico + segPausa) * 1000
      avisos.push('Serviço em curso sem «agora»: referência estimada como início + serviço + pausas.')
    }
  }
  const amplitudeSeg = inicioMs !== null && fimMs !== null ? Math.round((fimMs - inicioMs) / 1000) : null
  if (amplitudeSeg !== null && segServico + segPausa > amplitudeSeg + 300) {
    avisos.push('Serviço + pausas excedem a amplitude entre início e fim: possível serviço ≥24h ou hora de fim errada (a passagem da meia-noite pode não estar bem resolvida).')
  }

  // ── 2. Pausas (epoch real → relógio de parede) ──────────────────────────────
  const brutas = Array.isArray(servico.pausasDetalhe) ? servico.pausasDetalhe : []
  const pausas: PausaRegistada[] = []
  let descartadas = 0
  for (const p of brutas) {
    if (!p || !fin(p.inicio) || p.inicio <= 0 || !fin(p.dur) || p.dur < 0) { descartadas++; continue }
    const ini = relogio(p.inicio)
    if (inicioMs !== null && referenciaMs !== null && (ini < inicioMs - 60_000 || ini + p.dur * 1000 > referenciaMs + 60_000)) { descartadas++; continue }
    pausas.push(p.origem ? { inicioMs: ini, durSeg: p.dur, origem: p.origem } : { inicioMs: ini, durSeg: p.dur })
  }
  if (descartadas > 0) avisos.push(`${descartadas} pausa(s) do detalhe descartada(s): inválidas ou fora do intervalo do serviço.`)
  const somaPausas = pausas.reduce((a, p) => a + p.durSeg, 0)
  const semDetalhe = Math.max(0, segPausa - somaPausas)
  if (semDetalhe > 60) avisos.push(`Pausas sem detalhe: ${Math.round(semDetalhe / 60)} min de «segPausa» não têm posição no tempo e não entram em «pausas».`)

  // ── 3. Histórico: serviço anterior, descanso anterior, semana ───────────────
  const anteriores: Intervalo[] = []
  if (inicioMs !== null) {
    for (const h of historico) {
      if (h === servico || !ehTrabalho(h)) continue
      if (h.id !== undefined && servico.id !== undefined && String(h.id) === String(servico.id)) continue
      if (h.date === servico.date && h.debut === servico.debut) continue
      const iv = intervaloDe(h, ano)
      if (iv && iv.fimMs <= inicioMs) anteriores.push({ j: h, ...iv })
    }
    anteriores.sort((a, b) => a.inicioMs - b.inicioMs)
  }
  // VÁRIOS SERVIÇOS NO MESMO DIA: serviços anteriores do MESMO dia com intervalo <9h continuam o mesmo período de trabalho.
  // O intervalo entre eles NÃO é pausa nem descanso: a amplitude e o tempo de serviço contam desde o início do 1.º serviço
  // do dia (nunca se reinicia o limite ao começar o 2.º). Dias diferentes mantêm o comportamento de sempre.
  const anoFb = Number.isFinite(ano as number) ? (ano as number) : new Date().getFullYear()
  const periodo: Intervalo[] = []
  if (inicioMs !== null) {
    const chaveAtual = chaveDia(servico as any, anoFb)
    let limite = inicioMs
    for (let i = anteriores.length - 1; i >= 0; i--) {
      const a = anteriores[i]
      if (chaveDia(a.j as any, anoFb) !== chaveAtual) break
      if ((limite - a.fimMs) / 1000 >= 9 * 3600) break
      periodo.unshift(a)
      limite = Math.min(limite, a.inicioMs)
    }
  }
  const inicioPeriodoMs: number | null = periodo.length > 0 ? periodo[0].inicioMs : inicioMs
  const anterioresRepouso = anteriores.slice(0, anteriores.length - periodo.length)
  const segPeriodoAnterior = periodo.reduce((acc, a) => acc + seg(a.j.segServico), 0)
  if (periodo.length > 0) {
    avisos.push(`${periodo.length} serviço(s) anterior(es) no mesmo dia: a amplitude e o tempo de serviço contam desde o início do primeiro; o intervalo entre serviços não é pausa nem descanso.`)
    const pausasAnt: PausaRegistada[] = []
    for (const a of periodo) {
      for (const p of Array.isArray(a.j.pausasDetalhe) ? a.j.pausasDetalhe : []) {
        if (!p || !fin(p.inicio) || p.inicio <= 0 || !fin(p.dur) || p.dur < 0) continue
        const ini = relogio(p.inicio)
        if (ini < a.inicioMs - 60_000 || ini + p.dur * 1000 > a.fimMs + 60_000) continue
        pausasAnt.push(p.origem ? { inicioMs: ini, durSeg: p.dur, origem: p.origem } : { inicioMs: ini, durSeg: p.dur })
      }
    }
    pausas.unshift(...pausasAnt)
  }
  const prev = anterioresRepouso.length > 0 ? anterioresRepouso[anterioresRepouso.length - 1] : null

  let fimDescansoAnterior: EntradaMotor['fimDescansoAnterior'] = null
  let gapSeg: number | null = null
  let tipoAnterior: DiagnosticoDeJour['tipoDescansoDiarioAnterior'] = 'desconhecido'
  if (dec.fimDescansoAnterior) {
    fimDescansoAnterior = dec.fimDescansoAnterior
  }
  if (prev && inicioPeriodoMs !== null) {
    gapSeg = Math.round((inicioPeriodoMs - prev.fimMs) / 1000)
    tipoAnterior = classificarDescansoDiario(gapSeg)
    if (!dec.fimDescansoAnterior) {
      if (gapSeg >= 9 * 3600) {
        fimDescansoAnterior = { ms: inicioPeriodoMs, confirmado: false }
        avisos.push('Fim do descanso anterior assumido igual ao início do serviço (hipótese mais permissiva; não confirmado).')
      } else {
        avisos.push('Intervalo <9h desde o serviço anterior: não é um descanso diário válido; fim do descanso anterior desconhecido.')
      }
    }
  } else if (inicioMs !== null && !dec.fimDescansoAnterior) {
    avisos.push('Sem serviço anterior no histórico: fim do descanso anterior desconhecido.')
  }

  // Reduções entre descansos semanais
  let reducoes: EntradaMotor['reducoes'] = null
  let refSemanal: number | null = null
  if (inicioMs !== null) {
    const cadeia = [...anterioresRepouso.map(a => ({ inicioMs: a.inicioMs, fimMs: a.fimMs })), { inicioMs: inicioPeriodoMs as number, fimMs: inicioPeriodoMs as number }]
    const gaps: DescansoRegistado[] = []
    for (let i = 1; i < cadeia.length; i++) gaps.push({ inicioMs: cadeia[i - 1].fimMs, fimMs: cadeia[i].inicioMs })
    if (fin(dec.fimUltimoDescansoSemanalMs)) refSemanal = dec.fimUltimoDescansoSemanalMs
    else {
      const candidatos = gaps.filter(g => g.fimMs - g.inicioMs >= MS_DIA && g.fimMs >= (inicioPeriodoMs as number) - 14 * MS_DIA)
      if (candidatos.length > 0) {
        refSemanal = candidatos[candidatos.length - 1].fimMs
        avisos.push('Descanso semanal deduzido de um intervalo ≥24h nos últimos 14 dias (não confirmado).')
      }
    }
    if (refSemanal !== null) {
      reducoes = contarReducoes({ descansos: gaps, fimUltimoDescansoSemanalMs: refSemanal, historicoCompleto: dec.historicoCompleto === true })
    } else {
      avisos.push('Sem referência de descanso semanal: reduções já utilizadas desconhecidas.')
    }
  }

  // Semana (segunda a domingo)
  let semana: EntradaMotor['semana'] = null
  if (inicioMs !== null) {
    const ini = inicioSemanaMs(inicioMs)
    const daSemana = anteriores.filter(a => a.inicioMs >= ini)
    const soma = daSemana.reduce((acc, a) => acc + seg(a.j.segServico), 0) + segServico
    const dias = new Set<string>()
    for (const h of historico) {
      const a = anoDoDia(h)
      const d = parseData(h.date, Number.isFinite(a) ? a : ano)
      if (d) dias.add(chaveData(d.ano, d.mes0, d.dia))
    }
    let completa = true
    for (let t = ini; t < Math.floor(inicioMs / MS_DIA) * MS_DIA; t += MS_DIA) {
      const dd = new Date(t)
      if (!dias.has(chaveData(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate()))) { completa = false; break }
    }
    if (dec.semanaCompleta === false) completa = false
    semana = { servicoSemanaSeg: soma, completa }
    if (!completa) avisos.push('Há dias da semana sem registo no histórico: a semana não é dada como completa.')
  }

  // ── 4. Contexto: nada é deduzido de `profil` ────────────────────────────────
  const entrada: EntradaMotor = {
    contexto: {
      regulamento561: dec.regulamento561 ?? 'desconhecido',
      enquadramentoFrances: dec.enquadramentoFrances ?? 'desconhecido',
      categoria: dec.categoria ?? 'desconhecida',
      ...(dec.equipagem !== undefined ? { equipagem: dec.equipagem } : {}),
    },
    inicioServicoMs: inicioPeriodoMs,
    referenciaMs,
    servicoAcumuladoSeg: segServico + segPeriodoAnterior,
    ...(dec.pausaPrevistaSeg !== undefined ? { pausaPrevistaSeg: dec.pausaPrevistaSeg } : {}),
    pausas,
    fimDescansoAnterior,
    descansoSeguinte: dec.descansoSeguinte ?? null,
    reducoes,
    semana,
    confirmacoes: { tempoServicoEquivaleServicoRegulamentar: dec.tempoServicoEquivale === true },
  }

  return {
    entrada,
    avisos,
    diagnostico: {
      emCurso,
      atravessaMeiaNoite: atravessa,
      amplitudeSeg,
      segServico,
      segPausa,
      nPausasDetalhe: pausas.length,
      nPausasDescartadas: descartadas,
      segPausaSemDetalheSeg: semDetalhe,
      perfilApp: profil ?? null,
      categoriaDeducidaDoPerfil: false,
      servicoAnteriorEncontrado: prev !== null,
      gapDescansoAnteriorSeg: gapSeg,
      tipoDescansoDiarioAnterior: tipoAnterior,
      referenciaDescansoSemanalMs: refSemanal,
    },
  }
}
