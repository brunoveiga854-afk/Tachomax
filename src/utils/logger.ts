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

// ── Histórico circular (máx 100) ──────────────────────────────────────────────

const MAX_ENTRIES = 100
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
  },
}
