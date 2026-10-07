jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'))
import AsyncStorage from '@react-native-async-storage/async-storage'
import { lerUltimoCamiao, gravarUltimoCamiao, ULTIMO_CAMIAO_KEY } from './ultimoCamiao'

beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks() })

it('sem a chave devolve null', async () => { expect(await lerUltimoCamiao()).toBeNull() })
it('grava e lê de volta', async () => {
  await gravarUltimoCamiao({ type: 'immat', value: 'AB-123-CD' })
  expect(await lerUltimoCamiao()).toEqual({ type: 'immat', value: 'AB-123-CD' })
})
it('JSON corrompido devolve null', async () => {
  await AsyncStorage.setItem(ULTIMO_CAMIAO_KEY, '{mau')
  expect(await lerUltimoCamiao()).toBeNull()
})
it('valor vazio ou null não escreve nada', async () => {
  await gravarUltimoCamiao({ type: 'immat', value: '' })
  await gravarUltimoCamiao({ type: 'immat', value: '  ' })
  await gravarUltimoCamiao(null)
  expect(AsyncStorage.setItem).not.toHaveBeenCalled()
})
it('nunca lança, mesmo se o AsyncStorage falhar', async () => {
  ;(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('falha'))
  await expect(gravarUltimoCamiao({ type: 'immat', value: 'AB-123-CD' })).resolves.toBeUndefined()
  ;(AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('falha'))
  await expect(lerUltimoCamiao()).resolves.toBeNull()
})
