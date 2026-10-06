jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'))
import AsyncStorage from '@react-native-async-storage/async-storage'
import { lerMapaKm, gravarKmCamiao, KM_POR_CAMIAO_KEY } from './kmPorCamiao'

beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks() })

it('sem a chave devolve {}', async () => { expect(await lerMapaKm()).toEqual({}) })
it('JSON corrompido ou array devolve {}', async () => {
  await AsyncStorage.setItem(KM_POR_CAMIAO_KEY, '{mau'); expect(await lerMapaKm()).toEqual({})
  await AsyncStorage.setItem(KM_POR_CAMIAO_KEY, '[1,2]'); expect(await lerMapaKm()).toEqual({})
})
it('grava pela matrícula normalizada e actualiza o mesmo camião', async () => {
  await gravarKmCamiao('ab-123-cd', 1100); await gravarKmCamiao('AB 123 CD', 1250)
  expect(await lerMapaKm()).toEqual({ AB123CD: 1250 })
})
it('km vazio, 0, NaN ou matrícula vazia não escrevem nada', async () => {
  await gravarKmCamiao('AB-123-CD', 0); await gravarKmCamiao('AB-123-CD', NaN); await gravarKmCamiao('', 900)
  expect(AsyncStorage.setItem).not.toHaveBeenCalled()
})
it('nunca lança, mesmo se o AsyncStorage falhar', async () => {
  ;(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('falha'))
  await expect(gravarKmCamiao('AB-123-CD', 1100)).resolves.toBeUndefined()
})
it('entradas inválidas guardadas são ignoradas na leitura', async () => {
  await AsyncStorage.setItem(KM_POR_CAMIAO_KEY, JSON.stringify({ A: 5, B: 'x', C: -1 }))
  expect(await lerMapaKm()).toEqual({ A: 5 })
})
