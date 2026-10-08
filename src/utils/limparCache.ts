// src/utils/limparCache.ts
// Apaga cópias temporárias (cache da app) criadas pelo DocumentPicker.
// Nunca lança erro e nunca regista URIs (podem conter nomes de ficheiros pessoais).

import * as FileSystem from 'expo-file-system'
import { log } from './logger'

export async function limparCopiasCache(uris: string[]): Promise<void> {
  const cache = FileSystem.cacheDirectory
  if (!cache) return
  let falhas = 0
  for (const uri of uris) {
    // Só apaga cópias dentro da cache da app — nunca o ficheiro original do utilizador.
    if (typeof uri !== 'string' || !uri.startsWith(cache)) continue
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true })
    } catch {
      falhas++
    }
  }
  if (falhas > 0) log.warn('fiche', 'limpeza cache: falhas', { falhas })
}
