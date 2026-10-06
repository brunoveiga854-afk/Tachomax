export type TipoCamiao = 'immat' | 'parc'
export type Camiao = { type: TipoCamiao; value: string }
export type ParteTroca = { camiao: Camiao; kmInicio: number; kmFim: number }
export type TrocaCamiao = { a: ParteTroca; b: ParteTroca; segParaPausa: number }
export type DiaComTroca = {
  kmInicio?: number | null
  kmFim?: number | null
  kmDiarios?: number | null
  troca?: TrocaCamiao | null
}
export type MapaKm = Record<string, number>

/** 'AB-123-CD', 'ab123cd' e ' ab 123 cd ' dão todos 'AB123CD'. Vazio, null ou undefined dão ''. */
export function normalizarMatricula(v: string | null | undefined): string {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Dois camiões são o mesmo se a matrícula normalizada for igual. Um vazio nunca é igual a nada. */
export function mesmoCamiao(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarMatricula(a)
  const nb = normalizarMatricula(b)
  return na !== '' && na === nb
}

/** Último km conhecido de um camião, ou null se nunca foi registado (ou for inválido). */
export function ultimoKmDoCamiao(mapa: MapaKm | null | undefined, v: string | null | undefined): number | null {
  const chave = normalizarMatricula(v)
  if (!chave || !mapa) return null
  const km = mapa[chave]
  return Number.isFinite(km) && km > 0 ? km : null
}

/** Devolve um mapa novo com o km do camião. Um km vazio, NaN ou menor ou igual a 0 deixa o mapa como estava. */
export function registarKm(mapa: MapaKm | null | undefined, v: string | null | undefined, km: number): MapaKm {
  const base: MapaKm = { ...(mapa ?? {}) }
  const chave = normalizarMatricula(v)
  if (!chave || !Number.isFinite(km) || km <= 0) return base
  base[chave] = km
  return base
}

/** Km feitos por um camião: fim menos início, só se os dois forem maiores que 0 e o fim não for menor. */
export function kmDoCamiao(inicio: number | null | undefined, fim: number | null | undefined): number {
  const i = Number(inicio)
  const f = Number(fim)
  if (!(i > 0) || !(f > 0) || f < i) return 0
  return f - i
}

/**
 * Km totais do dia para o PDF, como texto.
 * - Com troca de camião: soma dos km dos dois camiões (se nenhum tiver km válidos, cai para kmDiarios).
 * - Sem troca: a regra de hoje (|fim - início| se os dois forem maiores que 0, senão kmDiarios, senão '').
 */
export function kmTotalDoDia(dia: DiaComTroca | null | undefined): string {
  if (!dia) return ''
  if (dia.troca) {
    const soma = kmDoCamiao(dia.troca.a.kmInicio, dia.troca.a.kmFim) + kmDoCamiao(dia.troca.b.kmInicio, dia.troca.b.kmFim)
    if (soma > 0) return String(soma)
    return dia.kmDiarios ? String(dia.kmDiarios) : ''
  }
  const i = Number(dia.kmInicio)
  const f = Number(dia.kmFim)
  if (i > 0 && f > 0) return String(Math.abs(f - i))
  return dia.kmDiarios ? String(dia.kmDiarios) : ''
}

function parteTexto(p: ParteTroca): string {
  const nome = String(p.camiao?.value ?? '').trim() || '?'
  const km = kmDoCamiao(p.kmInicio, p.kmFim)
  return km > 0 ? `${nome} ${p.kmInicio}→${p.kmFim} = ${km} km` : nome
}

/** Texto da troca para os comentários do PDF. Sem troca devolve ''. */
export function textoTroca(troca: TrocaCamiao | null | undefined): string {
  if (!troca) return ''
  const kmA = kmDoCamiao(troca.a.kmInicio, troca.a.kmFim)
  const kmB = kmDoCamiao(troca.b.kmInicio, troca.b.kmFim)
  let texto = `Changement de camion : ${parteTexto(troca.a)} + ${parteTexto(troca.b)}`
  if (kmA > 0 && kmB > 0) texto += ` = ${kmA + kmB} km`
  return texto
}

/** Junta a nota do utilizador com o texto automático. A nota nunca é apagada nem substituída. */
export function juntarComentario(nota: string | null | undefined, auto: string | null | undefined): string {
  const n = String(nota ?? '').trim()
  const a = String(auto ?? '').trim()
  if (n && a) return n.includes(a) ? n : `${n} · ${a}`
  return n || a
}

/**
 * Reclassifica o intervalo da troca de serviço para pausa, se o condutor respondeu 'pause'.
 * O que se move é só o serviço realmente contado desde "Continuer" (agora menos ao continuar),
 * por isso, se esteve em pausa o tempo todo, não se conta duas vezes. A amplitude não entra aqui.
 */
export function reclassificar(
  segServicoAgora: number,
  segServicoAoContinuar: number,
  segPausaTotal: number,
  resposta: 'pause' | 'service',
): { segServico: number; segPausaTotal: number; movido: number } {
  if (resposta !== 'pause') return { segServico: segServicoAgora, segPausaTotal, movido: 0 }
  const delta = segServicoAgora - segServicoAoContinuar
  const movido = Number.isFinite(delta) ? Math.max(0, Math.min(segServicoAgora, delta)) : 0
  return { segServico: segServicoAgora - movido, segPausaTotal: segPausaTotal + movido, movido }
}
