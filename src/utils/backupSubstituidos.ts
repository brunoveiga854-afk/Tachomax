// src/utils/backupSubstituidos.ts
// Backup/importação do arquivo `historique_substituidos` (serviços substituídos por decisão explícita do motorista).
//
// Regras:
//   • exporta-se como as outras chaves; backups ANTIGOS (sem a chave) importam-se exactamente como antes;
//   • na importação o arquivo MESCLA-SE com o do telemóvel (só entram entradas que ainda não existem, por id + substituidoEm);
//     nunca substitui o arquivo existente e NUNCA devolve serviços ao `historique` principal;
//   • valor importado que não seja um array é ignorado (o resto da importação segue), nunca rebenta.
export const CHAVE_SUBSTITUIDOS = 'historique_substituidos'

export type ValidacaoSubstituidos =
  | { estado: 'ausente' }
  | { estado: 'invalido' }
  | { estado: 'ok'; lista: unknown[] }

export function validarSubstituidosImportados(valor: unknown): ValidacaoSubstituidos {
  if (valor === undefined || valor === null) return { estado: 'ausente' }
  if (!Array.isArray(valor)) return { estado: 'invalido' }
  return { estado: 'ok', lista: valor }
}

const chaveEntrada = (e: any): string | null => {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null
  if (e.id === undefined || e.id === null || e.id === '') return null
  return `${String(e.id)}|${String(e.substituidoEm ?? '')}`
}

export type ResultadoMescla = { lista: unknown[]; adicionados: number; ignorados: number; repetidos: number }

/** Junta `importado` ao arquivo `atual`: as entradas actuais ficam intactas e na mesma ordem; só se acrescentam as novas. */
export function mesclarArquivoSubstituidos(atual: unknown[], importado: unknown[]): ResultadoMescla {
  const vistos = new Set<string>()
  for (const e of atual) { const k = chaveEntrada(e); if (k) vistos.add(k) }
  const novos: unknown[] = []
  let ignorados = 0
  let repetidos = 0
  for (const e of importado) {
    const k = chaveEntrada(e)
    if (!k) { ignorados++; continue }
    if (vistos.has(k)) { repetidos++; continue }
    vistos.add(k)
    novos.push(e)
  }
  return { lista: [...atual, ...novos], adicionados: novos.length, ignorados, repetidos }
}
