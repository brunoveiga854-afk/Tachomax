// src/assistente/preferencia.ts
// Preferência «Activer l'assistant». FONTE DE VERDADE ÚNICA: a chave 'assistente_ativo' no AsyncStorage
// (mesmo padrão dos outros interruptores das Réglages: 'rappel_saisie_ativo', 'transport_frigo', … guardados como
// 'true'/'false'). Nada é copiado para outro sítio: este módulo só interpreta, grava e AVISA quem está a ouvir.
//
//  • Instalações existentes (chave ausente) → ATIVADO por defeito, para o botão já apresentado não desaparecer.
//  • Só um valor explícito 'false' desativa (igual a `v !== 'false'` do rappel de saisie).
//  • Réglages grava → todos os ouvintes (botão da Home, página) atualizam logo, sem reiniciar a app.
//
// Módulo puro (sem React nem AsyncStorage): o armazenamento é injetado, o que permite testá-lo.
export const CHAVE_ASSISTENTE_ATIVO = 'assistente_ativo'
export const ASSISTENTE_ATIVO_POR_DEFEITO = true

export type ArmazenamentoSimples = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

/** chave ausente/ilegível → ativado; só 'false' desativa */
export function interpretarAtivo(raw: string | null | undefined): boolean {
  return raw !== 'false'
}

const ouvintes = new Set<(ativo: boolean) => void>()

export function subscreverAssistente(cb: (ativo: boolean) => void): () => void {
  ouvintes.add(cb)
  return () => { ouvintes.delete(cb) }
}

export async function lerAssistenteAtivo(storage: Pick<ArmazenamentoSimples, 'getItem'>): Promise<boolean> {
  try { return interpretarAtivo(await storage.getItem(CHAVE_ASSISTENTE_ATIVO)) }
  catch { return ASSISTENTE_ATIVO_POR_DEFEITO }
}

/** Grava e só depois notifica. Devolve false (sem notificar) se a gravação falhar: a UI deve repor o valor lido. */
export async function gravarAssistenteAtivo(storage: Pick<ArmazenamentoSimples, 'setItem'>, ativo: boolean): Promise<boolean> {
  try { await storage.setItem(CHAVE_ASSISTENTE_ATIVO, String(ativo)) }
  catch { return false }
  for (const cb of Array.from(ouvintes)) { try { cb(ativo) } catch { /* um ouvinte com erro não impede os outros */ } }
  return true
}

/** Visibilidade do botão flutuante na Home: ativado, já lido do armazenamento e sem teclado aberto. */
export function botaoFlutuanteVisivel(p: { ativo: boolean | null; tecladoAberto: boolean }): boolean {
  return p.ativo === true && !p.tecladoAberto
}
