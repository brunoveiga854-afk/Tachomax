/**
 * TachoOffice — Notificações Push
 * Compatível com expo-notifications 0.31+ (Expo SDK 53)
 */

import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

export const NOTIF_IDS = {
  PAUSA_ALERTA: 'tachooffice-pausa-alerta',
  PAUSA_OBRIGATORIA: 'tachooffice-pausa-obrigatoria',
  AMPLITUDE_ALERTA: 'tachooffice-amplitude-alerta',
  RAPPEL_SAISIE: 'tachooffice-rappel-saisie',
  CONDUITE_DIARIA: 'tachooffice-conduite-diaria',
  PAUSE_CONV_COL_15: 'tachooffice-pause-convcol-15',
  PAUSE_CONV_COL_45: 'tachooffice-pause-convcol-45',
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
    await Notifications.setNotificationChannelAsync('tachooffice', {
      name: 'TachoOffice Alertas',
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
        title: '⚠️ TachoOffice — Pause dans 30 min',
        body: "Il te reste 30 min de conduite continue. Prépare-toi à t'arrêter.",
        sound: 'default',
        data: { type: 'pausa_aviso' },
        ...(Platform.OS === 'android' ? { channelId: 'tachooffice' } : {}),
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
      title: '🛑 TachoOffice — PAUSE OBLIGATOIRE',
      body: "4h30 de conduite atteintes ! Tu dois t'arrêter 45 minutes minimum.",
      sound: 'default',
      data: { type: 'pausa_obrigatoria' },
      ...(Platform.OS === 'android' ? { channelId: 'tachooffice' } : {}),
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
      title: '⏰ TachoOffice — Amplitude maximale',
      body: 'Tu as atteint la durée maximale de ta journée de travail.',
      sound: 'default',
      data: { type: 'amplitude_max' },
      ...(Platform.OS === 'android' ? { channelId: 'tachooffice' } : {}),
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
      title: '📋 TachoOffice — Saisie du jour',
      body: "N'oublie pas d'enregistrer ta journée de travail !",
      sound: 'default',
      data: { type: 'rappel_saisie' },
      ...(Platform.OS === 'android' ? { channelId: 'tachooffice' } : {}),
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

/**
 * Agenda alerta para o limite diário de 9h de condução.
 * Chamado quando segConducaoHoje atinge 8h45 (15min antes do limite).
 * segundosAteAlerta = 0 → dispara imediatamente.
 */
export async function agendarAlertaConduicaoDiaria(segundosAteAlerta: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.CONDUITE_DIARIA).catch(() => {})

  if (segundosAteAlerta <= 0) {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_IDS.CONDUITE_DIARIA,
      content: {
        title: '🚛 TachoOffice — Limite journalière !',
        body: "Tu as atteint 9h de conduite aujourd'hui. Arrêt obligatoire.",
        sound: 'default',
        data: { type: 'conduite_diaria_max' },
        ...(Platform.OS === 'android' ? { channelId: 'tachooffice' } : {}),
      },
      trigger: null,
    })
    return
  }

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.CONDUITE_DIARIA,
    content: {
      title: '⚠️ TachoOffice — 9h journalières dans 15 min',
      body: "Tu approches de la limite de 9h de conduite pour aujourd'hui.",
      sound: 'default',
      data: { type: 'conduite_diaria_aviso' },
      ...(Platform.OS === 'android' ? { channelId: 'tachooffice' } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: segundosAteAlerta,
      repeats: false,
    },
  })
}

/**
 * Notificação imediata — convention collective: pause 15 min requise avant 6h de service
 */
export async function agendarAlertaPauseCC15(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.PAUSE_CONV_COL_15).catch(() => {})
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.PAUSE_CONV_COL_15,
    content: {
      title: '⚠️ TachoOffice — Pause requise',
      body: 'Tu approches de 6h de service. Une pause de 15 min est requise avant 6h (Convention collective).',
      sound: 'default',
      data: { type: 'pause_cc_15' },
      ...(Platform.OS === 'android' ? { channelId: 'tachooffice' } : {}),
    },
    trigger: null,
  })
}

/**
 * Notificação imediata — convention collective: 45 min de pause requises avant 9h de service
 */
export async function agendarAlertaPauseCC45(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIF_IDS.PAUSE_CONV_COL_45).catch(() => {})
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.PAUSE_CONV_COL_45,
    content: {
      title: '🟠 TachoOffice — 45 min de pause requises',
      body: 'Tu approches de 9h de service. 45 min de pause sont requises avant 9h (Convention collective).',
      sound: 'default',
      data: { type: 'pause_cc_45' },
      ...(Platform.OS === 'android' ? { channelId: 'tachooffice' } : {}),
    },
    trigger: null,
  })
}
