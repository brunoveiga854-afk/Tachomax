// src/utils/identidadeFicheiro.ts
// Identidade estável de um FICHEIRO importado (PDF/imagem), calculada sobre o seu conteúdo em base64.
//
// LIMITAÇÕES (deliberadamente assumidas — ver testes):
//  • hash16 = dois FNV-1a de 32 bits (64 bits no total). NÃO é criptográfico: não protege contra colisões fabricadas,
//    e para ~10^4 ficheiros a probabilidade ACIDENTAL de colisão é da ordem de 10^-12.
//  • Para reduzir ainda mais o risco juntam-se o TAMANHO do conteúdo e dois hashes de amostras (início/fim) — uma colisão
//    teria de coincidir nos três ao mesmo tempo.
//  • Bytes diferentes (p. ex. a mesma fiche fotografada duas vezes) dão identidades diferentes: é intencional; nunca se
//    assume que dois ficheiros distintos são «o mesmo documento».
//  • Consequência segura de uma colisão: o armazém (rubricasStore) trata «mesma identidade com conteúdo diferente» como
//    CONFLITO e conserva o existente — nunca sobrescreve. Portanto o pior caso é um falso conflito, não perda de dados.
//  • Função pura, síncrona, sem rede nem armazenamento.
import { hash16 } from './rubricas'

export const PREFIXO_IDENTIDADE = 'fx1'
const AMOSTRA = 4096

export type IdentidadeFicheiro = {
  /** Identificador completo, seguro para logs (só hex e números): fx1:<tamanho>:<hash>:<amostras> */
  id: string
  tamanhoBase64: number
  hash: string
  metodo: 'fnv1a-2x32+tamanho+amostras'
  criptografico: false
}

/** Devolve null se o conteúdo for vazio/inválido (nunca lança). */
export function identidadeFicheiro(base64: unknown): IdentidadeFicheiro | null {
  if (typeof base64 !== 'string' || base64.length === 0) return null
  const n = base64.length
  const hash = hash16(base64)
  const amostras = hash16(base64.slice(0, AMOSTRA) + '|' + base64.slice(Math.max(0, n - AMOSTRA)))
  return { id: `${PREFIXO_IDENTIDADE}:${n}:${hash}:${amostras}`, tamanhoBase64: n, hash, metodo: 'fnv1a-2x32+tamanho+amostras', criptografico: false }
}
