jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'))
import AsyncStorage from '@react-native-async-storage/async-storage'
import { lerTrocaPendente, gravarTrocaPendente, limparTrocaPendente, TROCA_PENDENTE_KEY, TrocaPendente } from './trocaPendente'

const T: TrocaPendente = { camiaoA: { type: 'immat', value: 'AB-123-CD' }, kmInicioA: 1000, kmFimA: 1100, ts: 1700000000000, estadoAoContinuar: 'service', segServicoAoContinuar: 3600 }
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks() })

it('sem a chave devolve null', async () => { expect(await lerTrocaPendente()).toBeNull() })
it('grava e lê de volta', async () => { expect(await gravarTrocaPendente(T)).toBe(true); expect(await lerTrocaPendente()).toEqual(T) })
it('não sobrescreve se já existe', async () => {
  await gravarTrocaPendente(T)
  expect(await gravarTrocaPendente({ ...T, kmFimA: 9999 })).toBe(false)
  expect((await lerTrocaPendente())?.kmFimA).toBe(1100)
})
it('JSON corrompido ou inválido devolve null', async () => {
  await AsyncStorage.setItem(TROCA_PENDENTE_KEY, '{mau'); expect(await lerTrocaPendente()).toBeNull()
  await AsyncStorage.setItem(TROCA_PENDENTE_KEY, JSON.stringify({ ...T, estadoAoContinuar: 'x' })); expect(await lerTrocaPendente()).toBeNull()
  await AsyncStorage.setItem(TROCA_PENDENTE_KEY, JSON.stringify({ ...T, kmFimA: -1 })); expect(await lerTrocaPendente()).toBeNull()
})
it('uma chave corrompida pode ser substituída', async () => {
  await AsyncStorage.setItem(TROCA_PENDENTE_KEY, '{mau')
  expect(await gravarTrocaPendente(T)).toBe(true)
})
it('aceita camião sem tipo, valor vazio e km 0 ("Passer")', async () => {
  const s = { ...T, camiaoA: { type: null, value: '' }, kmFimA: 0 } as TrocaPendente
  await gravarTrocaPendente(s); expect(await lerTrocaPendente()).toEqual(s)
})
it('limpar apaga, e limpar sem nada não falha', async () => {
  await gravarTrocaPendente(T); await limparTrocaPendente(); expect(await lerTrocaPendente()).toBeNull()
  await expect(limparTrocaPendente()).resolves.toBeUndefined()
})
it('nunca lança se o AsyncStorage falhar', async () => {
  ;(AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('f'))
  await expect(gravarTrocaPendente(T)).resolves.toBe(false)
  ;(AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('f'))
  await expect(lerTrocaPendente()).resolves.toBeNull()
  ;(AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('f'))
  await expect(limparTrocaPendente()).resolves.toBeUndefined()
})
it('duas chamadas concorrentes gravam uma só vez e a segunda devolve false', async () => {
  const [a, b] = await Promise.all([
    gravarTrocaPendente(T),
    gravarTrocaPendente({ ...T, kmFimA: 9999 }),
  ])
  expect(a).toBe(true)
  expect(b).toBe(false)
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1)
  expect((await lerTrocaPendente())?.kmFimA).toBe(1100)
})
