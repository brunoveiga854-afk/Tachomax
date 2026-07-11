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
  try { await SecureStore.setItemAsync(key, value) }
  catch (e) {
    log.error('secureStorage', 'SecureStore write failed', { key, e })
  }
}

export const secureDelete = async (key: string): Promise<void> => {
  try { await SecureStore.deleteItemAsync(key) }
  catch (e) { log.error('secureStorage', 'SecureStore delete failed', { key, e }) }
}
