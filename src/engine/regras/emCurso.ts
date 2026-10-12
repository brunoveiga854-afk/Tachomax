// src/engine/regras/emCurso.ts
// Converte o snapshot REAL do serviço em curso (AsyncStorage 'TACHOOFFICE_estado', escrito pela Home) num
// `JourEntrada` aceite por `entradaMotorDeJour` (deJour.ts).
//
// MÓDULO PURO E SÓ DE LEITURA: recebe o texto bruto do snapshot, não lê nem escreve storage, não altera nada.
//
// FORMATO DO SNAPSHOT (index.tsx): há dois tipos de escrita.
//  • `criarEstadoSnapshot` (autosave de 30 s, background, troca): inclui `tsInicioServico`, `segServicoBase`,
//    `tsPauseInicio`, `pausasDia`, `dateInicio` (ISO), `horaInicio`.
//  • objetos literais (iniciar, iniciar pausa, retomar): NÃO incluem `tsInicioServico`/`segServicoBase`/
//    `tsPauseInicio`, mas incluem `lastBgTick` = instante da escrita. Usa-se como âncora APROXIMADA (e avisa).
//  Sem nenhuma âncora fiável → 'invalido' (não se reconstrói o tempo).
//
// REGRAS
//  • O início vem de `dateInicio` (instante real) — nunca de `horaInicio` isolada; a data completa
//    (DD/MM/AAAA) evita o erro de ano num serviço iniciado a 31/12 e consultado a 01/01.
//  • Serviço a correr: segServicoDe(base, tsInicioServico, agora). Em pausa: o serviço fica congelado.
//  • Pausa em curso entra em `pausasDetalhe` com a duração até «agora». Pausa programada já expirada
//    (`pausaFimTimestamp` ≤ agora) é tratada como a Home a trata ao retomar: terminou nesse instante.
//  • Serviços ≥24h ou com início no futuro (>5 min) → 'invalido' (a Home também não os recupera).
import { segServicoDe } from '../../utils/camioes'
import type { JourEntrada, PausaDetalheApp } from './deJour'

export const LIMITE_HORAS_EM_CURSO = 24
const TOLERANCIA_FUTURO_MS = 5 * 60_000

export type ServicoEmCurso = {
  /** formato aceite por entradaMotorDeJour (sem `fin`, sem `id`) */
  jour: JourEntrada
  /** pausa efetivamente aberta neste instante */
  emPausa: boolean
  /** início da pausa aberta (epoch), se houver */
  pausaAbertaInicioMs: number | null
  inicioRealMs: number
  /** 'ancorada' = tsInicioServico/tsPauseInicio; 'aproximada' = lastBgTick */
  precisao: 'ancorada' | 'aproximada'
  /** a pausa programada já tinha expirado: a Home vai retomar quando voltar ao primeiro plano */
  pausaProgramadaExpirada: boolean
  avisos: string[]
}

export type LeituraEstado =
  | { tipo: 'sem_servico'; motivo: 'chave_ausente' | 'servico_nao_ativo' }
  | { tipo: 'invalido'; motivo: string }
  | { tipo: 'em_curso'; servico: ServicoEmCurso }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const dd = (n: number) => String(n).padStart(2, '0')
const invalido = (motivo: string): LeituraEstado => ({ tipo: 'invalido', motivo })

export type OpcoesEstado = {
  /** valor bruto de 'pausaFimTimestamp' (AsyncStorage), se existir */
  pausaFimTimestampRaw?: string | null
}

export function lerEstadoPersistido(raw: string | null | undefined, agoraMs: number, opcoes: OpcoesEstado = {}): LeituraEstado {
  if (typeof raw !== 'string' || raw.trim() === '') return { tipo: 'sem_servico', motivo: 'chave_ausente' }
  let e: any
  try { e = JSON.parse(raw) } catch { return invalido('Snapshot do serviço ilegível (JSON inválido).') }
  if (!e || typeof e !== 'object' || Array.isArray(e)) return invalido('Snapshot do serviço com formato inesperado.')
  if (e.enService !== true) return { tipo: 'sem_servico', motivo: 'servico_nao_ativo' }
  if (!Number.isFinite(agoraMs)) return invalido('Instante atual inválido.')

  // ── Início (instante real) ──────────────────────────────────────────────────
  const inicio = typeof e.dateInicio === 'string' ? new Date(e.dateInicio) : null
  if (!inicio || Number.isNaN(inicio.getTime())) return invalido('Snapshot sem data de início (formato antigo): início real desconhecido.')
  const inicioRealMs = inicio.getTime()
  const horas = (agoraMs - inicioRealMs) / 3_600_000
  if (horas < -TOLERANCIA_FUTURO_MS / 3_600_000) return invalido('Início do serviço no futuro: relógio ou snapshot incoerente.')
  if (horas > LIMITE_HORAS_EM_CURSO) return invalido('Serviço com 24 h ou mais: a Home não o recupera e o assistente não o interpreta.')

  const avisos: string[] = []
  const date = `${dd(inicio.getDate())}/${dd(inicio.getMonth() + 1)}/${inicio.getFullYear()}`
  const debut = `${dd(inicio.getHours())}h${dd(inicio.getMinutes())}`
  if (typeof e.horaInicio === 'string' && /^\d{1,2}h\d{2}$/.test(e.horaInicio) && e.horaInicio.padStart(5, '0') !== debut) {
    avisos.push(`horaInicio do snapshot (${e.horaInicio}) difere da data de início (${debut}): usado o instante real.`)
  }

  // ── Tempo de serviço e pausas ───────────────────────────────────────────────
  const segServicoSnap = num(e.segServico)
  const base = num(e.segServicoBase) ?? segServicoSnap
  if (base === undefined) return invalido('Snapshot sem tempo de serviço.')
  const tsServico = num(e.tsInicioServico)
  const lastTick = num(e.lastBgTick)
  const segPausaSnap = Math.max(0, num(e.segPausa) ?? 0)
  const totalSnap = Math.max(0, num(e.segPausaTotal) ?? 0)
  // Na Home, em pausa o segPausaTotal do snapshot já inclui a pausa aberta (ver aplicarEstadoPersistido).
  const fechadaSnap = e.emPausa === true ? Math.max(0, totalSnap - segPausaSnap) : totalSnap

  const detalhe: PausaDetalheApp[] = []
  const brutas = Array.isArray(e.pausasDia) ? e.pausasDia : []
  let invalidasDia = 0
  for (const p of brutas) {
    const ini = num(p?.inicio); const dur = num(p?.dur)
    if (ini === undefined || ini <= 0 || dur === undefined || dur < 0) { invalidasDia++; continue }
    detalhe.push(typeof p.origem === 'string' ? { inicio: ini, dur, origem: p.origem } : { inicio: ini, dur })
  }
  if (invalidasDia > 0) avisos.push(`${invalidasDia} pausa(s) do snapshot ignorada(s): inválidas.`)

  let precisao: 'ancorada' | 'aproximada' = 'ancorada'
  let servicoSeg: number
  let segPausa = fechadaSnap
  let emPausa = false
  let pausaAbertaInicioMs: number | null = null
  let pausaProgramadaExpirada = false

  if (e.emPausa === true) {
    if (tsServico !== undefined) avisos.push('Snapshot em pausa com âncora de serviço ativa: âncora ignorada (serviço congelado).')
    // início da pausa
    let inicioPausa = num(e.tsPauseInicio)
    if (inicioPausa === undefined || inicioPausa <= 0) {
      if (lastTick === undefined) return invalido('Pausa sem âncora temporal fiável (snapshot antigo).')
      inicioPausa = lastTick - segPausaSnap * 1000
      precisao = 'aproximada'
      avisos.push('Início da pausa estimado a partir da hora de escrita do snapshot (aproximado).')
    }
    if (inicioPausa > agoraMs + 60_000) return invalido('Início da pausa no futuro: snapshot incoerente.')
    const fimProgramado = Number(opcoes.pausaFimTimestampRaw)
    const expirou = Number.isFinite(fimProgramado) && opcoes.pausaFimTimestampRaw != null && fimProgramado > inicioPausa && fimProgramado <= agoraMs
    if (expirou) {
      // mesma convenção da Home (handlePause): a pausa terminou no instante programado; o serviço retoma aí.
      pausaProgramadaExpirada = true
      const dur = Math.max(0, Math.floor((fimProgramado - inicioPausa) / 1000))
      detalhe.push({ inicio: inicioPausa, dur })
      segPausa += dur
      servicoSeg = segServicoDe(base, fimProgramado, agoraMs)
      avisos.push('A pausa programada já terminou; a Home retoma o serviço quando voltar ao primeiro plano. Considerado retomado no fim programado.')
    } else {
      emPausa = true
      pausaAbertaInicioMs = inicioPausa
      const dur = Math.max(0, Math.floor((agoraMs - inicioPausa) / 1000))
      detalhe.push({ inicio: inicioPausa, dur })
      segPausa += dur
      servicoSeg = base
    }
  } else {
    let ancora = tsServico
    if (ancora === undefined || ancora <= 0) {
      if (lastTick === undefined) return invalido('Serviço sem âncora temporal fiável (snapshot antigo): tempo de serviço não reconstruído.')
      ancora = lastTick
      precisao = 'aproximada'
      avisos.push('Sem âncora de serviço no snapshot: tempo extrapolado a partir da hora de escrita (aproximado).')
    }
    if (ancora > agoraMs + 60_000) return invalido('Âncora de serviço no futuro: snapshot incoerente.')
    servicoSeg = segServicoDe(base, ancora, agoraMs)
  }
  servicoSeg = Math.max(0, servicoSeg)

  const jour: JourEntrada = {
    date,
    type: e.decouche === true ? 'DEC' : 'TRAB',
    debut,
    segServico: servicoSeg,
    segPausa,
    ...(detalhe.length ? { pausasDetalhe: detalhe } : {}),
  }
  return { tipo: 'em_curso', servico: { jour, emPausa, pausaAbertaInicioMs, inicioRealMs, precisao, pausaProgramadaExpirada, avisos } }
}
