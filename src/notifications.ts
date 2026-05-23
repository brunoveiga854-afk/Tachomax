/**
 * TachoMax — Notificações Push
 * Alertas de pausa obrigatória, amplitude e fim de serviço
 */

import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

// IDs fixos para cancelar/reprogramar sem duplicar
export const NOTIF_IDS = {
  PAUSA_ALERTA: 'tachomax-pausa-alerta',
  PAUSA_OBRIGATORIA: 'tachomax-pausa-obrigatoria',
  AMPLITUDE_ALERTA: 'tachomax-amplitude-alerta',
}

// Configuração do comportamento das notificações
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

/**
 * Pede permissão ao utilizador para enviar notificações.
 * Retorna true se concedida.
 */
export async function pedirPermissaoNotificacoes(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('tachomax', {
      name: 'TachoMax Alertas',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    })
  }

  const { status: existente } = await Notifications.getPermissionsAsync()
  if (existente === 'granted') return true

  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

/**
 * Agenda alerta de pausa em X segundos a partir de agora.
 * Cancela qualquer alerta anterior do mesmo tipo.
 */
export async function agendarAlertaPausa(segundosAteAlerta: number): Promise<void> {
  // Cancelar alertas anteriores
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.PAUSA_ALERTA).catch(() => {})
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.PAUSA_OBRIGATORIA).catch(() => {})

  if (segundosAteAlerta <= 0) return

  // Alerta de aviso (30 min antes)
  const alertaAviso = segundosAteAlerta - 30 * 60
  if (alertaAviso > 0) {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_IDS.PAUSA_ALERTA,
      content: {
        title: '⚠️ TachoMax — Pause dans 30 min',
        body: 'Tu approches de 4h30 de conduite continue. Prépare-toi à t\'arrêter.',
        sound: 'default',
        data: { type: 'pausa_aviso' },
      },
      trigger: { seconds: alertaAviso, channelId: 'tachomax' },
    })
  }

  // Alerta de pausa obrigatória
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.PAUSA_OBRIGATORIA,
    content: {
      title: '🛑 TachoMax — PAUSE OBLIGATOIRE',
      body: '4h30 de conduite atteintes ! Tu dois t\'arrêter 45 minutes minimum.',
      sound: 'default',
      data: { type: 'pausa_obrigatoria' },
    },
    trigger: { seconds: segundosAteAlerta, channelId: 'tachomax' },
  })
}

/**
 * Agenda alerta de amplitude em X segundos a partir de agora.
 */
export async function agendarAlertaAmplitude(segundosAteAlerta: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.AMPLITUDE_ALERTA).catch(() => {})

  if (segundosAteAlerta <= 0) return

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.AMPLITUDE_ALERTA,
    content: {
      title: '⏰ TachoMax — Amplitude maximale',
      body: 'Tu as atteint la durée maximale de ta journée de travail.',
      sound: 'default',
      data: { type: 'amplitude_max' },
    },
    trigger: { seconds: segundosAteAlerta, channelId: 'tachomax' },
  })
}

/**
 * Cancela todos os alertas agendados pelo TachoMax.
 * Chamar ao terminar o serviço ou ao pausar.
 */
export async function cancelarTodosAlertas(): Promise<void> {
  await Promise.all(
    Object.values(NOTIF_IDS).map(id =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
    )
  )
}
