import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { activateKeepAwakeAsync } from 'expo-keep-awake'
import {
  VELOCIDADE_MIN,
  CONDUCAO_SEGUNDOS_ON,
  CONDUCAO_PARAR_ABAIXO_3_S,
  CONDUCAO_PARAR_ABAIXO_5_S,
  CONDUCAO_PARAR_ABAIXO_7_S,
  GPS_MOVIMENTO_SALTO_MAX_KM,
  GPS_MOVIMENTO_GAP_S,
  GPS_MOVIMENTO_GAP_MAX_KM,
  VEL_BUFFER_SIZE,
  ACCEL_SALTO_MAX_KMH,
  mediana,
  GPS_PRECISAO_MAX,
  GPS_MENTIROSO_ZONA_VEL_MIN,
  GPS_MENTIROSO_ZONA_VEL_MAX,
  GPS_MENTIROSO_ZONA_INFERIDA_MAX,
  GPS_MENTIROSO_ZONA_TICKS,
  GPS_ANCORA_RAIO_M,
  GPS_ANCORA_MOVIMENTO_TICKS,
  HISTERESE_ARRANQUE_KMH,
  HISTERESE_PARAGEM_KMH,
  MEDIANA_SUSTENTADA_S,
} from './constants'

export const LOCATION_TASK_NAME = 'background-location-task'
const STORAGE_KEY = 'TACHOOFFICE_estado'
let keepAwakeActivated = false

// ─── Âncora de posição ────────────────────────────────────────────────────────
// Persiste entre callbacks dentro da mesma sessão de background.
// Quando deveParar e emConducao passa a false → posição actual guardada como âncora.
// Enquanto o dispositivo não sair GPS_ANCORA_RAIO_M metros → deveParar imediato.
let bgAncora: { lat: number; lon: number } | null = null
let bgAncoraOkTicks = 0

// ─── Log GPS em memória ───────────────────────────────────────────────────────
// Máx 500 entradas FIFO. Flush para AsyncStorage a cada 50 novas entradas.
let bgGpsLog: Array<{
  ts: number
  velGps: number
  velInferida: number
  velMedia: number
  emConducao: boolean
  deveParar: boolean
  bgMentirosoZonaTicks: number
}> = []
let bgGpsLogCounter = 0

const calcularDistancia = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
  if (!keepAwakeActivated) {
    try { await activateKeepAwakeAsync('tachooffice-location-task'); keepAwakeActivated = true } catch (e) {}
  }
  if (error) { console.log('Background GPS error:', error); return }
  if (!data?.locations?.length) return

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const estado = JSON.parse(raw)
    if (!estado.enService) return

    let next = { ...estado }
    delete next.gpsTrack
    delete next.gpsTrackTimer
    delete next.kmDiariosExact
    delete next.bgParadoTicks

    for (const loc of data.locations) {
      // ── 1. Filtro de precisão GPS — usa GPS_PRECISAO_MAX (não hardcoded) ──────
      if ((loc.coords.accuracy ?? 999) > GPS_PRECISAO_MAX) continue

      const now = loc.timestamp || Date.now()
      const lastTick = next.lastBgTick || next.tsBackground || now
      const dt = Math.max(0, Math.min(300, Math.floor((now - lastTick) / 1000)))
      const velGps = Math.max(0, (loc.coords.speed || 0) * 3.6)
      const lat = loc.coords.latitude
      const lon = loc.coords.longitude
      let dist = 0
      const gapS = next.ultimoGpsCallback ? Math.max(0, (now - next.ultimoGpsCallback) / 1000) : 0
      const saltoMax = gapS > GPS_MOVIMENTO_GAP_S ? GPS_MOVIMENTO_GAP_MAX_KM : GPS_MOVIMENTO_SALTO_MAX_KM

      if (next.ultimaLocalizacao && !next.emPausa) {
        dist = calcularDistancia(next.ultimaLocalizacao.lat, next.ultimaLocalizacao.lon, lat, lon)
      }

      const velInferida = gapS > 0 && dist > 0.001 && dist <= saltoMax ? (dist / gapS) * 3600 : 0
      const velMovimento = Math.max(velGps, velInferida)

      // Declaradas aqui para ficarem disponíveis no log abaixo do bloco principal
      let deveParar = false
      let velMedia = 0

      if (!next.emPausa) {
        // ── Filtro de coerência de aceleração — spike impossível para um camião ──
        const prevVelBg = next.bgVelAnterior ?? 0
        next.bgVelAnterior = velMovimento
        if (velMovimento - prevVelBg > ACCEL_SALTO_MAX_KMH && prevVelBg < VELOCIDADE_MIN) {
          // Spike GPS improvável — ignorar detecção de condução mas contar tempo de serviço
          next.ultimaLocalizacao = { lat, lon }
          next.ultimoGpsCallback = now
          next.lastBgTick = now
          next.tsBackground = now
          if (dt > 0) {
            next.segAmplitude = (next.segAmplitude || 0) + dt
            next.segServico = (next.segServico || 0) + dt
          }
          continue
        }

        // ── Buffer de velocidade com mediana ──────────────────────────────────────
        const buffer = [...(next.bgVelBuffer || []), velMovimento].slice(-VEL_BUFFER_SIZE)
        velMedia = mediana(buffer)
        next.bgVelBuffer = buffer

        const dtParagem = Math.max(1, dt)

        // ── Contadores de paragem multi-nível ────────────────────────────────────
        next.bgParadoAbaixo3Ticks = velMovimento < 3 ? (next.bgParadoAbaixo3Ticks || 0) + dtParagem : 0
        next.bgParadoAbaixo5Ticks = velMovimento < 5 ? (next.bgParadoAbaixo5Ticks || 0) + dtParagem : 0
        next.bgParadoAbaixo7Ticks = velMovimento < 7 ? (next.bgParadoAbaixo7Ticks || 0) + dtParagem : 0

        // ── GPS congelado (vel presa entre 1-15 km/h sem variar mais de 2) ───────
        if (velMovimento >= 1 && velMovimento <= 15) {
          if (next.bgUltimaVelCongelada == null || Math.abs((next.bgUltimaVelCongelada || 0) - velMovimento) > 2) {
            next.bgUltimaVelCongelada = velMovimento
            next.bgTempoVelCongelada = 0
          } else {
            next.bgTempoVelCongelada = (next.bgTempoVelCongelada || 0) + dtParagem
          }
        } else {
          next.bgUltimaVelCongelada = null
          next.bgTempoVelCongelada = 0
        }
        const gpsCongelado = (next.bgTempoVelCongelada || 0) >= 4

        // ── GPS mentiroso clássico (velGps > 20 mas posição não mudou) ───────────
        if (velGps > 20 && velInferida < 5) {
          next.bgTempoGpsMentiroso = (next.bgTempoGpsMentiroso || 0) + dtParagem
        } else {
          next.bgTempoGpsMentiroso = 0
        }
        const gpsMentiroso = (next.bgTempoGpsMentiroso || 0) >= 5

        // ── 2. GPS mentiroso zona lenta 8-15 km/h ────────────────────────────────
        // velGps na zona mas velInferida quase zero → GPS está a mentir em velocidade baixa
        if (
          velGps >= GPS_MENTIROSO_ZONA_VEL_MIN &&
          velGps <= GPS_MENTIROSO_ZONA_VEL_MAX &&
          velInferida < GPS_MENTIROSO_ZONA_INFERIDA_MAX
        ) {
          next.bgMentirosoZonaTicks = (next.bgMentirosoZonaTicks || 0) + dtParagem
        } else {
          next.bgMentirosoZonaTicks = 0
        }
        const gpsMentirosoZona = (next.bgMentirosoZonaTicks || 0) >= GPS_MENTIROSO_ZONA_TICKS

        // ── 4. Âncora de posição ──────────────────────────────────────────────────
        // Se estamos dentro do raio da âncora → deveParar imediato (parado no mesmo sítio)
        const distAncora = bgAncora
          ? calcularDistancia(bgAncora.lat, bgAncora.lon, lat, lon) * 1000  // km → metros
          : Infinity
        const dentroAncora = bgAncora !== null && distAncora < GPS_ANCORA_RAIO_M

        // Reset de âncora: velInferida > 5 durante GPS_ANCORA_MOVIMENTO_TICKS consecutivos
        if (velInferida > 5) {
          bgAncoraOkTicks++
          if (bgAncoraOkTicks >= GPS_ANCORA_MOVIMENTO_TICKS) {
            bgAncora = null
            bgAncoraOkTicks = 0
          }
        } else {
          bgAncoraOkTicks = 0
        }

        // ── Decisão final deveParar ───────────────────────────────────────────────
        deveParar =
          next.bgParadoAbaixo3Ticks >= CONDUCAO_PARAR_ABAIXO_3_S ||
          next.bgParadoAbaixo5Ticks >= CONDUCAO_PARAR_ABAIXO_5_S ||
          next.bgParadoAbaixo7Ticks >= CONDUCAO_PARAR_ABAIXO_7_S ||
          gpsCongelado ||
          gpsMentiroso ||
          gpsMentirosoZona ||
          dentroAncora

        if (deveParar) {
          // 4b. Se condução estava ativa ao parar → fixar âncora na posição actual
          if (next.emConducao) {
            bgAncora = { lat, lon }
            bgAncoraOkTicks = 0
          }
          next.bgConducaoTicks = 0
          next.bgMedianaSustentadaTicks = 0
          next.emConducao = false
        } else {
          // ── 3. Histerese arranque/paragem + mediana sustentada ────────────────
          if (velMovimento >= HISTERESE_ARRANQUE_KMH && velMedia >= HISTERESE_ARRANQUE_KMH) {
            next.bgConducaoTicks = (next.bgConducaoTicks || 0) + dtParagem
            // Mediana tem de estar acima do limiar durante MEDIANA_SUSTENTADA_S segundos
            next.bgMedianaSustentadaTicks = (next.bgMedianaSustentadaTicks || 0) + dtParagem
            if (
              next.bgConducaoTicks >= CONDUCAO_SEGUNDOS_ON &&
              next.bgMedianaSustentadaTicks >= MEDIANA_SUSTENTADA_S
            ) {
              next.emConducao = true
            }
          } else if (velMovimento < HISTERESE_PARAGEM_KMH) {
            // Histerese: só reset abaixo de 5 km/h (não de 8) — evita oscilação na fronteira
            next.bgConducaoTicks = 0
            next.bgMedianaSustentadaTicks = 0
          }
          // Zona [HISTERESE_PARAGEM_KMH, HISTERESE_ARRANQUE_KMH[ → nem incrementa nem reset
        }
      } else {
        // Em pausa — parar tudo e limpar contadores
        next.emConducao = false
        next.bgConducaoTicks = 0
        next.bgMedianaSustentadaTicks = 0
        next.bgParadoAbaixo3Ticks = 0
        next.bgParadoAbaixo5Ticks = 0
        next.bgParadoAbaixo7Ticks = 0
        next.bgVelAnterior = 0
        next.bgMentirosoZonaTicks = 0
      }

      if (dt > 0) {
        next.segAmplitude = (next.segAmplitude || 0) + dt
        if (next.emPausa) {
          next.segPausa = (next.segPausa || 0) + dt
          next.segPausaTotal = (next.segPausaTotal || 0) + dt
        } else {
          next.segServico = (next.segServico || 0) + dt
          if (next.emConducao && velMovimento >= VELOCIDADE_MIN) {
            next.segConducao = (next.segConducao || 0) + dt
          }
        }
      }

      // ── 5. Logging silencioso — 1 entrada por tick GPS ───────────────────────
      bgGpsLog.push({
        ts: now,
        velGps,
        velInferida,
        velMedia,
        emConducao: !!next.emConducao,
        deveParar,
        bgMentirosoZonaTicks: next.bgMentirosoZonaTicks || 0,
      })
      if (bgGpsLog.length > 500) bgGpsLog = bgGpsLog.slice(-500)
      bgGpsLogCounter++
      if (bgGpsLogCounter >= 50) {
        bgGpsLogCounter = 0
        // fire-and-forget — não bloquear o loop principal
        AsyncStorage.setItem('gps_log', JSON.stringify(bgGpsLog)).catch(() => {})
      }

      next.ultimaLocalizacao = { lat, lon }
      next.ultimoGpsCallback = now
      next.lastBgTick = now
      next.tsBackground = now
    }

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (e) {
    console.log('Background GPS task failed:', e)
  }
})
