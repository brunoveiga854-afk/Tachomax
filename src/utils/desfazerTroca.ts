// src/utils/desfazerTroca.ts
// Diário dos efeitos secundários de uma TROCA DE CAMIÃO feita a meio de um serviço, para os poder desfazer com
// segurança se o serviço for DESCARTADO (serviço curto de teste, «ne pas enregistrer»).
//
// Efeitos de uma troca durante o serviço (antes de ele ser gravado):
//   • «Continuer le jour»  → km final do camião A gravado em `km_por_camiao`;
//   • «Camion B»           → km inicial de B gravado em `km_por_camiao` + camião actual (`tracteur_type/value`) passa a B.
// Se o serviço for descartado, estes efeitos NÃO podem ficar (alterariam o km «conhecido» de um camião usado num serviço anterior).
//
// Regras de segurança:
//   • cada entrada guarda o valor ANTES e o valor ESCRITO; só se desfaz se o valor actual ainda é o ESCRITO
//     (se mudou entretanto por outra via, não se mexe: devolve-se um BLOQUEIO e nada é alterado — tudo ou nada);
//   • nunca toca em `historique`, `historique_substituidos`, `km_ultimo_fim` nem em chaves de outros camiões;
//   • lógica pura + armazenamento injetado (AsyncStorage na app, falso nos testes).
import { normalizarMatricula } from './camioes'

export const CHAVE_DESFAZER = 'troca_desfazer'
export const CHAVE_KM_CAMIAO = 'km_por_camiao'
export const CHAVE_TRACTEUR_TIPO = 'tracteur_type'
export const CHAVE_TRACTEUR_VALOR = 'tracteur_value'

export type ArmazenamentoDesfazer = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export type EntradaKm = { chave: string; antes: number | null; escrito: number }
export type EfeitoTracteur = { antesTipo: string | null; antesValor: string | null; escritoTipo: string; escritoValor: string }
export type DiarioTroca = { v: 1; km: EntradaKm[]; tracteur?: EfeitoTracteur }
export type MapaKmSimples = Record<string, number>

export const diarioVazio = (): DiarioTroca => ({ v: 1, km: [] })

const kmValido = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** Acrescenta (sem mutar) o efeito «km de `matricula` passa a `km`». Mantém o `antes` MAIS ANTIGO de cada matrícula. */
export function adicionarKm(d: DiarioTroca, mapaAntes: MapaKmSimples | null | undefined, matricula: string | null | undefined, km: number): DiarioTroca {
  const chave = normalizarMatricula(matricula)
  if (!chave || !kmValido(km)) return d      // nada será escrito em km_por_camiao → nada a desfazer
  const existente = d.km.find(e => e.chave === chave)
  const lista: EntradaKm[] = existente
    ? d.km.map(e => (e.chave === chave ? { ...e, escrito: km } : e))
    : [...d.km, { chave, antes: kmValido(mapaAntes?.[chave]) ? (mapaAntes as MapaKmSimples)[chave] : null, escrito: km }]
  return { ...d, km: lista }
}

/** Acrescenta (sem mutar) o efeito «camião actual passa a B». Mantém o `antes` mais antigo. */
export function adicionarTracteur(d: DiarioTroca, antesTipo: string | null, antesValor: string | null, escritoTipo: string, escritoValor: string): DiarioTroca {
  const prev = d.tracteur
  return { ...d, tracteur: { antesTipo: prev ? prev.antesTipo : antesTipo, antesValor: prev ? prev.antesValor : antesValor, escritoTipo, escritoValor } }
}

export type PlanoDesfazer = {
  mapaNovo: MapaKmSimples
  mudouMapa: boolean
  /** null = não mexer; senão o valor a repor (null dentro = remover a chave) */
  restaurarTracteur: { tipo: string | null; valor: string | null } | null
  bloqueios: string[]
  revertidos: number
}

/** Calcula o que se pode desfazer. Se houver QUALQUER bloqueio, o chamador não deve alterar nada. */
export function planearDesfazer(
  d: DiarioTroca,
  mapaAtual: MapaKmSimples | null | undefined,
  tracteurAtual: { tipo: string | null; valor: string | null },
): PlanoDesfazer {
  const mapaNovo: MapaKmSimples = { ...(mapaAtual ?? {}) }
  const bloqueios: string[] = []
  let revertidos = 0
  let mudouMapa = false
  for (const e of d.km) {
    const atual = kmValido(mapaAtual?.[e.chave]) ? (mapaAtual as MapaKmSimples)[e.chave] : null
    if (atual === e.escrito) {
      if (e.antes === null) delete mapaNovo[e.chave]; else mapaNovo[e.chave] = e.antes
      mudouMapa = true; revertidos++
    } else if (atual === e.antes) {
      // já está como estava antes (a escrita nunca chegou a acontecer, ou já foi desfeita) → nada a fazer
    } else {
      bloqueios.push(`km de ${e.chave} alterado entretanto (esperado ${e.escrito}, actual ${atual ?? 'vazio'})`)
    }
  }
  let restaurarTracteur: PlanoDesfazer['restaurarTracteur'] = null
  const t = d.tracteur
  if (t) {
    const igualEscrito = tracteurAtual.valor === t.escritoValor && tracteurAtual.tipo === t.escritoTipo
    const igualAntes = tracteurAtual.valor === t.antesValor && tracteurAtual.tipo === t.antesTipo
    if (igualEscrito && !igualAntes) { restaurarTracteur = { tipo: t.antesTipo, valor: t.antesValor }; revertidos++ }
    else if (!igualEscrito && !igualAntes) bloqueios.push(`camion actuel alterado entretanto (esperado ${t.escritoValor}, actual ${tracteurAtual.valor ?? 'vazio'})`)
  }
  return { mapaNovo, mudouMapa, restaurarTracteur, bloqueios, revertidos }
}

// ───────────────────────── armazenamento ─────────────────────────

export async function lerDiario(s: ArmazenamentoDesfazer): Promise<DiarioTroca> {
  try {
    const raw = await s.getItem(CHAVE_DESFAZER)
    if (!raw) return diarioVazio()
    const p = JSON.parse(raw)
    if (!p || typeof p !== 'object' || !Array.isArray(p.km)) return diarioVazio()
    const km: EntradaKm[] = p.km.filter((e: any) => e && typeof e.chave === 'string' && e.chave && kmValido(e.escrito) && (e.antes === null || kmValido(e.antes)))
    const t = p.tracteur
    const tracteur = t && typeof t.escritoValor === 'string' && typeof t.escritoTipo === 'string' ? t : undefined
    return tracteur ? { v: 1, km, tracteur } : { v: 1, km }
  } catch { return diarioVazio() }
}

async function lerMapa(s: ArmazenamentoDesfazer): Promise<MapaKmSimples> {
  try {
    const raw = await s.getItem(CHAVE_KM_CAMIAO)
    if (!raw) return {}
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    const r: MapaKmSimples = {}
    for (const [k, v] of Object.entries(o)) if (kmValido(v)) r[k] = v
    return r
  } catch { return {} }
}

export async function limparDiario(s: ArmazenamentoDesfazer): Promise<void> {
  try { await s.removeItem(CHAVE_DESFAZER) } catch { /* silêncio: o diário é um extra */ }
}

/** Regista (ANTES de a escrita acontecer) o efeito «km de `matricula` = `km`». Nunca lança. */
export async function registarEfeitoKm(s: ArmazenamentoDesfazer, matricula: string, km: number): Promise<void> {
  try {
    const d = await lerDiario(s)
    const novo = adicionarKm(d, await lerMapa(s), matricula, km)
    if (novo !== d) await s.setItem(CHAVE_DESFAZER, JSON.stringify(novo))
  } catch { /* silêncio */ }
}

/** Regista (ANTES de a escrita acontecer) o efeito «camião actual passa a B». Lê o camião actual do armazenamento. Nunca lança. */
export async function registarEfeitoTracteur(s: ArmazenamentoDesfazer, escritoTipo: string, escritoValor: string): Promise<void> {
  try {
    const d = await lerDiario(s)
    const [t, v] = await Promise.all([s.getItem(CHAVE_TRACTEUR_TIPO), s.getItem(CHAVE_TRACTEUR_VALOR)])
    await s.setItem(CHAVE_DESFAZER, JSON.stringify(adicionarTracteur(d, t, v, escritoTipo, escritoValor)))
  } catch { /* silêncio */ }
}

export type ResultadoDesfazer =
  | { estado: 'nada' }
  | { estado: 'desfeito'; revertidos: number; tracteur: { tipo: string | null; valor: string | null } | null }
  | { estado: 'bloqueado'; bloqueios: string[] }
  | { estado: 'erro' }

/** Desfaz os efeitos de troca de um serviço DESCARTADO. Tudo ou nada: com bloqueios não escreve NADA e preserva o diário. */
export async function desfazerEfeitosDeTroca(s: ArmazenamentoDesfazer): Promise<ResultadoDesfazer> {
  try {
    const d = await lerDiario(s)
    if (d.km.length === 0 && !d.tracteur) { await limparDiario(s); return { estado: 'nada' } }
    const [mapa, t, v] = await Promise.all([lerMapa(s), s.getItem(CHAVE_TRACTEUR_TIPO), s.getItem(CHAVE_TRACTEUR_VALOR)])
    const plano = planearDesfazer(d, mapa, { tipo: t, valor: v })
    if (plano.bloqueios.length > 0) return { estado: 'bloqueado', bloqueios: plano.bloqueios }
    if (plano.mudouMapa) await s.setItem(CHAVE_KM_CAMIAO, JSON.stringify(plano.mapaNovo))
    if (plano.restaurarTracteur) {
      const { tipo, valor } = plano.restaurarTracteur
      if (tipo === null) await s.removeItem(CHAVE_TRACTEUR_TIPO); else await s.setItem(CHAVE_TRACTEUR_TIPO, tipo)
      if (valor === null) await s.removeItem(CHAVE_TRACTEUR_VALOR); else await s.setItem(CHAVE_TRACTEUR_VALOR, valor)
    }
    await limparDiario(s)
    return { estado: 'desfeito', revertidos: plano.revertidos, tracteur: plano.restaurarTracteur }
  } catch { return { estado: 'erro' } }
}
