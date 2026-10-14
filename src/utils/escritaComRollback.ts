// src/utils/escritaComRollback.ts
// Escrita ATÓMICA de várias chaves com rollback — extraída do restauro de backup (reglages.tsx › confirmarImport) SEM mudar o comportamento:
//   1. lê os valores anteriores das chaves que vão ser escritas;
//   2. grava tudo numa só operação (multiSet);
//   3. se a gravação falhar, repõe os valores anteriores (removeItem se a chave não existia) e volta a lançar o erro original.
// Assim uma falha é sempre uma FALHA do restauro (nunca um sucesso parcial) e a chave das rubricas entra no mesmo mecanismo.

export interface ArmazenamentoMulti {
  multiGet(chaves: readonly string[]): Promise<readonly (readonly [string, string | null])[]>
  multiSet(pares: [string, string][]): Promise<void>
  setItem(chave: string, valor: string): Promise<void>
  removeItem(chave: string): Promise<void>
}

export type RegistoEscrita = { error: (mensagem: string, dados?: Record<string, unknown>) => void }

/** Lança o erro original se a gravação falhar (depois do rollback). `rollbackFalhou` lista as chaves que não se conseguiram repor. */
export async function escreverComRollback(arm: ArmazenamentoMulti, pares: [string, string][], registo?: RegistoEscrita): Promise<void> {
  const anteriores = await arm.multiGet(pares.map(p => p[0]))
  try {
    await arm.multiSet(pares)
  } catch (eEscrita) {
    registo?.error('confirmarImport: multiSet falhou — a restaurar valores anteriores', { tipo: (eEscrita as { name?: string })?.name, nChaves: pares.length })
    const rollbackFalhou: string[] = []
    for (const [k, v] of anteriores) {
      try { if (v === null) await arm.removeItem(k); else await arm.setItem(k, v) }
      catch (eRb) {
        rollbackFalhou.push(k)
        registo?.error('confirmarImport: rollback falhou', { chave: k, tipo: (eRb as { name?: string })?.name })
      }
    }
    if (eEscrita !== null && typeof eEscrita === 'object') (eEscrita as { rollbackFalhou?: string[] }).rollbackFalhou = rollbackFalhou
    throw eEscrita
  }
}
