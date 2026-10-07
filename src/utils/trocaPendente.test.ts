jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'))
import AsyncStorage from '@react-native-async-storage/async-storage'
import { lerTrocaPendente, gravarTrocaPendente, limparTrocaPendente, completarTrocaPendente, trocaDoDia, TROCA_PENDENTE_KEY, TrocaPendente } from './trocaPendente'
import { kmTotalDoDia } from './camioes'

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

const B = { camiao: { type: 'parc' as const, value: 'T042' }, kmInicio: 5000 }

it('completar sem troca devolve null e não grava nada', async () => {
  expect(await completarTrocaPendente(B, 600, 'pause')).toBeNull()
  expect(AsyncStorage.setItem).not.toHaveBeenCalled()
})
it('completar grava b, segParaPausa e a resposta', async () => {
  await gravarTrocaPendente(T)
  const r = await completarTrocaPendente(B, 600, 'pause')
  expect(r).toEqual({ ...T, b: B, segParaPausa: 600, respostaPausa: 'pause' })
  expect(await lerTrocaPendente()).toEqual(r)
})
it('a segunda chamada a completar não sobrescreve', async () => {
  await gravarTrocaPendente(T)
  await completarTrocaPendente(B, 600, 'pause')
  expect(await completarTrocaPendente({ camiao: { type: 'immat', value: 'ZZ-999-ZZ' }, kmInicio: 1 }, 5, 'service')).toBeNull()
  const lida = await lerTrocaPendente()
  expect(lida?.b?.camiao.value).toBe('T042')
  expect(lida?.segParaPausa).toBe(600)
})
it('duas chamadas concorrentes a completar gravam uma só vez', async () => {
  await gravarTrocaPendente(T)
  jest.clearAllMocks()
  const [x, y] = await Promise.all([
    completarTrocaPendente(B, 600, 'pause'),
    completarTrocaPendente({ ...B, kmInicio: 9999 }, 1, 'service'),
  ])
  expect(x).not.toBeNull()
  expect(y).toBeNull()
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1)
  expect((await lerTrocaPendente())?.b?.kmInicio).toBe(5000)
})
it('registo antigo (peça 1) sem b continua a ler-se', async () => {
  await AsyncStorage.setItem(TROCA_PENDENTE_KEY, JSON.stringify(T))
  const lida = await lerTrocaPendente()
  expect(lida).toEqual(T)
  expect(lida?.b).toBeUndefined()
})

const TB: TrocaPendente = { ...T, b: B, segParaPausa: 600, respostaPausa: 'pause' }

it('trocaDoDia com B constrói a e b, com o km de fim de B', () => {
  expect(trocaDoDia(TB, 5250)).toEqual({
    a: { camiao: { type: 'immat', value: 'AB-123-CD' }, kmInicio: 1000, kmFim: 1100 },
    b: { camiao: { type: 'parc', value: 'T042' }, kmInicio: 5000, kmFim: 5250 },
    segParaPausa: 600,
  })
})
it('trocaDoDia sem B (ou sem troca) devolve null', () => {
  expect(trocaDoDia(T, 5250)).toBeNull()
  expect(trocaDoDia(null, 5250)).toBeNull()
  expect(trocaDoDia(undefined, 5250)).toBeNull()
})
it('trocaDoDia com tipo null assume immat e segParaPausa em falta assume 0', () => {
  const tp = { ...T, camiaoA: { type: null, value: 'X1' }, b: { camiao: { type: null, value: 'Y2' }, kmInicio: 10 } } as TrocaPendente
  const r = trocaDoDia(tp, 20)
  expect(r?.a.camiao.type).toBe('immat')
  expect(r?.b.camiao.type).toBe('immat')
  expect(r?.segParaPausa).toBe(0)
})
it('trocaDoDia com km de fim 0 ("Passer") guarda kmFim 0 e o total só conta A', () => {
  const r = trocaDoDia(TB, 0)
  expect(r?.b.kmFim).toBe(0)
  expect(kmTotalDoDia({ troca: r, kmDiarios: 0 })).toBe('100')
})
it('kmTotalDoDia com a troca construída soma A + B', () => {
  const r = trocaDoDia(TB, 5250)
  expect(kmTotalDoDia({ troca: r, kmDiarios: 0 })).toBe('350')
})
