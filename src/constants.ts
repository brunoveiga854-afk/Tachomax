/**
 * TachoOffice — Constantes partilhadas entre foreground (index.tsx) e background (tasks.ts)
 * Editar aqui para afetar os dois lados ao mesmo tempo.
 */

// Limites de condução (regulamento europeu)
export const PAUSA_MAX = 4.5 * 3600        // 4h30 máx por ciclo de condução
export const MAX_CONDUITE = 9 * 3600       // 9h máx por dia

// Detecção de velocidade
export const VELOCIDADE_MIN = 8            // km/h mínimos para contar condução

// Arranque de condução: N segundos consecutivos acima de VELOCIDADE_MIN
export const CONDUCAO_SEGUNDOS_ON = 5

// Paragem de condução: abaixo de X km/h durante Y segundos consecutivos
export const CONDUCAO_PARAR_ABAIXO_3_S = 3
export const CONDUCAO_PARAR_ABAIXO_5_S = 6
export const CONDUCAO_PARAR_ABAIXO_7_S = 10

// GPS — proteção contra saltos de posição impossíveis
export const GPS_MOVIMENTO_SALTO_MAX_KM = 1    // salto máximo normal entre ticks
export const GPS_MOVIMENTO_GAP_S = 30          // se gap > 30s, aceita até 50km
export const GPS_MOVIMENTO_GAP_MAX_KM = 50     // salto máximo após gap longo

// GPS — precisão mínima aceite (metros); leituras com accuracy > este valor são rejeitadas
export const GPS_PRECISAO_MAX = 20

// Filtro de velocidade — mediana sobre os últimos N valores
export const VEL_BUFFER_SIZE = 9

// Filtro de coerência de aceleração — salto máximo de velocidade num único tick GPS
// a partir de velocidade baixa (< VELOCIDADE_MIN). Camião não pode ir de 0 a 15+ km/h em 1 segundo.
export const ACCEL_SALTO_MAX_KMH = 15

// GPS mentiroso em zona lenta — vel GPS na zona [MIN..MAX] mas posição inferida < INFERIDA_MAX
// durante TICKS segundos consecutivos → ignorar velocidade GPS, usar só velInferida
export const GPS_MENTIROSO_ZONA_VEL_MIN = 8
export const GPS_MENTIROSO_ZONA_VEL_MAX = 15
export const GPS_MENTIROSO_ZONA_INFERIDA_MAX = 2
export const GPS_MENTIROSO_ZONA_TICKS = 3

// Âncora GPS — se o dispositivo não se moveu mais de RAIO_M metros durante MOVIMENTO_TICKS ticks
// consecutivos, considera-se parado (ignora deriva GPS em repouso)
export const GPS_ANCORA_RAIO_M = 10
export const GPS_ANCORA_MOVIMENTO_TICKS = 3

// Histerese arranque/paragem — duas velocidades distintas para evitar oscilação na fronteira
// Arranque: vel ≥ HISTERESE_ARRANQUE_KMH para começar a contar condução
// Paragem: vel < HISTERESE_PARAGEM_KMH para parar de contar condução
export const HISTERESE_ARRANQUE_KMH = 8
export const HISTERESE_PARAGEM_KMH = 5

// Mediana sustentada — número de segundos que a mediana tem de estar acima do limiar
// antes de confirmar condução (camada extra sobre CONDUCAO_SEGUNDOS_ON)
export const MEDIANA_SUSTENTADA_S = 8

/**
 * Mediana de um array numérico — muito mais robusta a spikes do que a média.
 * Um spike isolado de 40 km/h num buffer [0,0,0,0,0,0,0,0,40] → mediana = 0 km/h.
 */
export const mediana = (vals: number[]): number => {
  if (!vals.length) return 0
  const sorted = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
