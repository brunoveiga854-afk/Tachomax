// src/utils/logger.ts
// Módulo de logging centralizado — TachoOffice

const __DEV__ = process.env.NODE_ENV !== 'production'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export type LogEntry = {
  timestamp: string   // ISO 8601
  level: LogLevel
  module: string
  message: string
  data?: unknown
}

// ── Histórico circular (máx 300) ──────────────────────────────────────────────

const MAX_ENTRIES = 300
const history: LogEntry[] = []

const push = (entry: LogEntry) => {
  if (history.length >= MAX_ENTRIES) history.shift()
  history.push(entry)
}

// ── Formatação DEV ────────────────────────────────────────────────────────────

const COLORS: Record<LogLevel, string> = {
  DEBUG: '\x1b[36m',  // cyan
  INFO:  '\x1b[32m',  // green
  WARN:  '\x1b[33m',  // yellow
  ERROR: '\x1b[31m',  // red
}
const RESET = '\x1b[0m'

const printDev = (entry: LogEntry) => {
  const prefix = `${COLORS[entry.level]}[${entry.level}]${RESET} [${entry.module}] ${entry.message}`
  if (entry.data !== undefined) {
    console.log(prefix, entry.data)
  } else {
    console.log(prefix)
  }
}

// ── Núcleo ────────────────────────────────────────────────────────────────────

const record = (level: LogLevel, module: string, message: string, data?: unknown) => {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    ...(data !== undefined ? { data } : {}),
  }
  push(entry)
  if (__DEV__) printDev(entry)
}

// ── API pública ───────────────────────────────────────────────────────────────

// ── Performance timing ────────────────────────────────────────────────────────

const timings: Record<string, number> = {}
const performanceLogs: Array<{ module: string; label: string; duration: number; ts: number }> = []

export const perfLog = {
  time: (module: string, label: string) => {
    timings[`${module}:${label}`] = Date.now()
  },
  timeEnd: (module: string, label: string) => {
    const start = timings[`${module}:${label}`]
    if (!start) return
    const duration = Date.now() - start
    delete timings[`${module}:${label}`]
    performanceLogs.unshift({ module, label, duration, ts: Date.now() })
    if (performanceLogs.length > 5) performanceLogs.length = 5
    // warn declared below — use record directly to avoid forward reference
    if (duration > 500) record('WARN', module, `SLOW: ${label} took ${duration}ms`)
  },
  getPerformanceLogs: () => [...performanceLogs],
}

// ── Logs só quando o valor muda ───────────────────────────────────────────────

const ultimosPorChave = new Map<string, string>()

const serializar = (v: unknown): string | null => {
  try { return JSON.stringify(v) ?? 'undefined' } catch { return null }
}

// Escreve só se `data` for diferente da última vez que esta `chave` escreveu.
// Se não for possível comparar (ex.: referência circular), escreve na mesma.
export const logSeMudou = (chave: string, module: string, message: string, data?: unknown) => {
  const atual = serializar(data)
  if (atual !== null && ultimosPorChave.get(chave) === atual) return
  if (atual !== null) ultimosPorChave.set(chave, atual)
  record('INFO', module, message, data)
}

// Escreve só se o valor mudou (antigo !== novo, comparação por JSON).
export const logMudanca = (campo: string, antigo: unknown, novo: unknown, origem: string) => {
  const a = serializar(antigo)
  const n = serializar(novo)
  if (a !== null && n !== null && a === n) return
  record('INFO', origem, `mudança ${campo}`, { antigo, novo })
}

export const log = {
  debug: (module: string, message: string, data?: unknown) =>
    record('DEBUG', module, message, data),

  info: (module: string, message: string, data?: unknown) =>
    record('INFO', module, message, data),

  warn: (module: string, message: string, data?: unknown) =>
    record('WARN', module, message, data),

  error: (module: string, message: string, data?: unknown) =>
    record('ERROR', module, message, data),

  getHistory: (): ReadonlyArray<LogEntry> =>
    [...history],

  getHistoryByLevel: (level: LogLevel): ReadonlyArray<LogEntry> =>
    history.filter(e => e.level === level),

  clear: () => {
    history.length = 0
    ultimosPorChave.clear()
  },

  time: (module: string, label: string) => perfLog.time(module, label),
  timeEnd: (module: string, label: string) => perfLog.timeEnd(module, label),
  getPerformanceLogs: () => perfLog.getPerformanceLogs(),
}
