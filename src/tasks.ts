import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const LOCATION_TASK_NAME = 'background-location-task'
const STORAGE_KEY = 'TACHOMAX_estado'
const VELOCIDADE_MIN = 8
const CONDUCAO_SEGUNDOS_ON = 8
const CONDUCAO_SEGUNDOS_OFF = 8
const KM_SALTO_MAX = 1
const GPS_PERDA_DEAD_RECKON_S = 30
const GPS_SALTO_DEAD_RECKON_MAX_KM = 50

const calcularDistancia = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const addRoundedKm = (kmAtual: number, dist: number, max: number) => {
  if (dist <= 0.001 || dist > max) return kmAtual
  return Math.round((kmAtual + dist) * 10) / 10
}

const media = (vals: number[]) =>
  vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
  if (error) { console.log('Background GPS error:', error); return }
  if (!data?.locations?.length) return

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const estado = JSON.parse(raw)
    if (!estado.enService) return

    let next = { ...estado }

    for (const loc of data.locations) {
      const now = loc.timestamp || Date.now()
      const lastTick = next.lastBgTick || next.tsBackground || now
      const dt = Math.max(0, Math.min(300, Math.floor((now - lastTick) / 1000)))
      const vel = Math.max(0, (loc.coords.speed || 0) * 3.6)
      const lat = loc.coords.latitude
      const lon = loc.coords.longitude

      if (dt > 0) {
        next.segAmplitude = (next.segAmplitude || 0) + dt
        if (next.emPausa) {
          next.segPausa = (next.segPausa || 0) + dt
          next.segPausaTotal = (next.segPausaTotal || 0) + dt
        } else {
          next.segServico = (next.segServico || 0) + dt
          if (next.emConducao) next.segConducao = (next.segConducao || 0) + dt
        }
      }

      if (!next.emPausa) {
        const buffer = [...(next.bgVelBuffer || []), vel].slice(-5)
        const velMedia = media(buffer)
        next.bgVelBuffer = buffer

        if (vel === 0) {
          next.bgConducaoTicks = 0
          next.bgParadoTicks = CONDUCAO_SEGUNDOS_OFF
          next.emConducao = false
        } else if (velMedia >= VELOCIDADE_MIN) {
          next.bgConducaoTicks = (next.bgConducaoTicks || 0) + Math.max(1, dt)
          next.bgParadoTicks = 0
          if (next.bgConducaoTicks >= CONDUCAO_SEGUNDOS_ON) next.emConducao = true
        } else {
          next.bgParadoTicks = (next.bgParadoTicks || 0) + Math.max(1, dt)
          next.bgConducaoTicks = 0
          if (next.bgParadoTicks >= CONDUCAO_SEGUNDOS_OFF) next.emConducao = false
        }
      } else {
        next.emConducao = false
        next.bgConducaoTicks = 0
        next.bgParadoTicks = 0
      }

      if (next.ultimaLocalizacao && !next.emPausa) {
        const dist = calcularDistancia(next.ultimaLocalizacao.lat, next.ultimaLocalizacao.lon, lat, lon)
        const gapS = next.ultimoGpsCallback ? (now - next.ultimoGpsCallback) / 1000 : 0
        next.kmDiarios = addRoundedKm(
          next.kmDiarios || 0,
          dist,
          gapS > GPS_PERDA_DEAD_RECKON_S ? GPS_SALTO_DEAD_RECKON_MAX_KM : KM_SALTO_MAX,
        )
      }

      next.ultimaLocalizacao = { lat, lon }
      next.ultimoGpsCallback = now
      next.lastBgTick = now
      next.tsBackground = now

      if (!next.emPausa && (!next.gpsTrackTimer || now - next.gpsTrackTimer >= 30000)) {
        next.gpsTrackTimer = now
        next.gpsTrack = [...(next.gpsTrack || []).slice(-200), { lat, lon, ts: now }]
      }
    }

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch (e) {
    console.log('Background GPS task failed:', e)
  }
})