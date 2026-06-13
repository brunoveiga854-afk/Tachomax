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
} from './constants'

export const LOCATION_TASK_NAME = 'background-location-task'
const STORAGE_KEY = 'TACHOOFFICE_estado'

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
  try {
    await activateKeepAwakeAsync('tachooffice-location-task')
  } catch (e) {}
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
      // Filtro de precisao GPS — igual ao foreground (>30m rejeitado)
      if ((loc.coords.accuracy ?? 999) > 30) continue

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

      if (!next.emPausa) {
        // Filtro de coerencia de aceleracao — rejeitar spikes impossiveis para um camiao
        const prevVelBg = next.bgVelAnterior ?? 0
        next.bgVelAnterior = velMovimento
        if (velMovimento - prevVelBg > ACCEL_SALTO_MAX_KMH && prevVelBg < VELOCIDADE_MIN) {
          // Spike GPS improvavel — ignorar detecao de conducao mas contar tempo de servico
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

        // Buffer de velocidade com mediana (VEL_BUFFER_SIZE leituras)
        const buffer = [...(next.bgVelBuffer || []), velMovimento].slice(-VEL_BUFFER_SIZE)
        const velMedia = mediana(buffer)
        next.bgVelBuffer = buffer

        const dtParagem = Math.max(1, dt)
        next.bgParadoAbaixo3Ticks = velMovimento < 3 ? (next.bgParadoAbaixo3Ticks || 0) + dtParagem : 0
        next.bgParadoAbaixo5Ticks = velMovimento < 5 ? (next.bgParadoAbaixo5Ticks || 0) + dtParagem : 0
        next.bgParadoAbaixo7Ticks = velMovimento < 7 ? (next.bgParadoAbaixo7Ticks || 0) + dtParagem : 0

        // Detecao de GPS congelado (velocidade presa entre 1-15 km/h sem variar mais de 2)
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

        // Detecao de GPS mentiroso (velocidade GPS alta mas posicao nao mudou)
        if (velGps > 20 && velInferida < 5) {
          next.bgTempoGpsMentiroso = (next.bgTempoGpsMentiroso || 0) + dtParagem
        } else {
          next.bgTempoGpsMentiroso = 0
        }
        const gpsMentiroso = (next.bgTempoGpsMentiroso || 0) >= 5

        const deveParar =
          next.bgParadoAbaixo3Ticks >= CONDUCAO_PARAR_ABAIXO_3_S ||
          next.bgParadoAbaixo5Ticks >= CONDUCAO_PARAR_ABAIXO_5_S ||
          next.bgParadoAbaixo7Ticks >= CONDUCAO_PARAR_ABAIXO_7_S ||
          gpsCongelado ||
          gpsMentiroso

        if (deveParar) {
          next.bgConducaoTicks = 0
          next.emConducao = false
        } else if (velMovimento >= VELOCIDADE_MIN && velMedia >= VELOCIDADE_MIN) {
          next.bgConducaoTicks = (next.bgConducaoTicks || 0) + dtParagem
          if (next.bgConducaoTicks >= CONDUCAO_SEGUNDOS_ON) next.emConducao = true
        } else if (velMovimento < VELOCIDADE_MIN) {
          next.bgConducaoTicks = 0
        }
      } else {
        next.emConducao = false
        next.bgConducaoTicks = 0
        next.bgParadoAbaixo3Ticks = 0
        next.bgParadoAbaixo5Ticks = 0
        next.bgParadoAbaixo7Ticks = 0
        next.bgVelAnterior = 0
      }

      if (dt > 0) {
        next.segAmplitude = (next.segAmplitude || 0) + dt
        if (next.emPausa) {
          next.segPausa = (next.segPausa || 0) + dt
          next.segPausaTotal = (next.segPausaTotal || 0) + dt
        } else {
          next.segServico = (next.segServico || 0) + dt
          // Corrigido: usar emConducao + velMovimento (max de velGps e velInferida)
          if (next.emConducao && velMovimento >= VELOCIDADE_MIN) {
            next.segConducao = (next.segConducao || 0) + dt
          }
        }
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
