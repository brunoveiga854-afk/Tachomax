// src/utils/filaHistorico.ts
// Fila (mutex) para as operações de leitura-modificação-escrita da chave `historique`.
// Duas gravações quase simultâneas (ex.: terminar um serviço enquanto o Historique edita outro) executam UMA DE CADA VEZ,
// cada uma a ler o valor mais recente — assim nenhuma sobrescreve o trabalho da outra. Uma falha NÃO bloqueia a fila.
let cauda: Promise<unknown> = Promise.resolve()

export function comFilaHistorico<T>(fn: () => Promise<T>): Promise<T> {
  const p = cauda.then(fn)
  cauda = p.then(() => undefined, () => undefined)
  return p
}
