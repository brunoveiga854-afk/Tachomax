/**
 * TachoMax — Notificações Push
 * Compatível com expo-notifications 0.31+ (Expo SDK 53)
 */

import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

export const NOTIF_IDS = {
  PAUSA_ALERTA: 'tachomax-pausa-alerta',
  PAUSA_OBRIGATORIA: 'tachomax-pausa-obrigatoria',
  AMPLITUDE_ALERTA: 'tachomax-amplitude-alerta',
  RAPPEL_SAISIE: 'tachomax-rappel-saisie',
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

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

export async function agendarAlertaPausa(segundosAteAlerta: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.PAUSA_ALERTA).catch(() => {})
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.PAUSA_OBRIGATORIA).catch(() => {})

  if (segundosAteAlerta <= 60) return

  const alertaAviso = segundosAteAlerta - 30 * 60
  if (alertaAviso > 60) {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_IDS.PAUSA_ALERTA,
      content: {
        title: '⚠️ TachoMax — Pause dans 30 min',
        body: 'Il te reste 30 min de conduite continue. Prépare-toi à t\'arrêter.',
        sound: 'default',
        data: { type: 'pausa_aviso' },
        ...(Platform.OS === 'android' ? { channelId: 'tachomax' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: alertaAviso,
        repeats: false,
      },
    })
  }

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.PAUSA_OBRIGATORIA,
    content: {
      title: '🛑 TachoMax — PAUSE OBLIGATOIRE',
      body: '4h30 de conduite atteintes ! Tu dois t\'arrêter 45 minutes minimum.',
      sound: 'default',
      data: { type: 'pausa_obrigatoria' },
      ...(Platform.OS === 'android' ? { channelId: 'tachomax' } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: segundosAteAlerta,
      repeats: false,
    },
  })
}

export async function agendarAlertaAmplitude(segundosAteAlerta: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.AMPLITUDE_ALERTA).catch(() => {})

  if (segundosAteAlerta <= 60) return

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.AMPLITUDE_ALERTA,
    content: {
      title: '⏰ TachoMax — Amplitude maximale',
      body: 'Tu as atteint la durée maximale de ta journée de travail.',
      sound: 'default',
      data: { type: 'amplitude_max' },
      ...(Platform.OS === 'android' ? { channelId: 'tachomax' } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: segundosAteAlerta,
      repeats: false,
    },
  })
}

export async function cancelarTodosAlertas(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync()
    await Notifications.dismissAllNotificationsAsync()
  } catch {}
}

export async function agendarRappelSaisie(hora = 20, minuto = 0): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.RAPPEL_SAISIE).catch(() => {})

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.RAPPEL_SAISIE,
    content: {
      title: '📋 TachoMax — Saisie du jour',
      body: 'N\'oublie pas d\'enregistrer ta journée de travail !',
      sound: 'default',
      data: { type: 'rappel_saisie' },
      ...(Platform.OS === 'android' ? { channelId: 'tachomax' } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: hora,
      minute: minuto,
    },
  })
}

export async function cancelarRappelSaisie(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.RAPPEL_SAISIE).catch(() => {})
}
