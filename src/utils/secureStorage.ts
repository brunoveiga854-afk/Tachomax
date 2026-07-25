import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from './logger'

export const secureGet = async (key: string): Promise<string | null> => {
  try { return await SecureStore.getItemAsync(key) }
  catch (e) {
    log.warn('secureStorage', 'SecureStore read failed, fallback AsyncStorage', { key })
    return AsyncStorage.getItem(key)
  }
}

export const secureSet = async (key: string, value: string): Promise<void> => {
  const results = await Promise.allSettled([
    SecureStore.setItemAsync(key, value),
    AsyncStorage.setItem(key, value),
  ])
  if (results[0].status === 'rejected')
    log.warn('secureStorage', 'SecureStore write failed', { key, reason: results[0].reason })
  if (results[1].status === 'rejected')
    log.warn('secureStorage', 'AsyncStorage write failed', { key, reason: results[1].reason })
}

export const secureDelete = async (key: string): Promise<void> => {
  try { await SecureStore.deleteItemAsync(key) }
  catch (e) { log.error('secureStorage', 'SecureStore delete failed', { key, e }) }
}
