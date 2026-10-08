const mockDelete = jest.fn()
let mockCache: string | null = 'file:///data/user/0/app/cache/'

jest.mock('expo-file-system', () => ({
  __esModule: true,
  get cacheDirectory() { return mockCache },
  deleteAsync: (...args: any[]) => mockDelete(...args),
}))

import { limparCopiasCache } from './limparCache'

beforeEach(() => {
  mockDelete.mockReset()
  mockDelete.mockResolvedValue(undefined)
  mockCache = 'file:///data/user/0/app/cache/'
})

describe('limparCopiasCache', () => {
  it('apaga URIs dentro da cache, com idempotent', async () => {
    await limparCopiasCache(['file:///data/user/0/app/cache/DocumentPicker/a.pdf'])
    expect(mockDelete).toHaveBeenCalledWith(
      'file:///data/user/0/app/cache/DocumentPicker/a.pdf', { idempotent: true })
  })

  it('(a) não apaga URIs fora de cacheDirectory', async () => {
    await limparCopiasCache([
      'content://com.android.providers/doc/1',
      'file:///storage/emulated/0/Download/original.pdf',
    ])
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('(b) não lança erro se deleteAsync falhar, e continua nas restantes', async () => {
    mockDelete.mockRejectedValueOnce(new Error('EACCES'))
    await expect(limparCopiasCache([
      'file:///data/user/0/app/cache/a.pdf',
      'file:///data/user/0/app/cache/b.pdf',
    ])).resolves.toBeUndefined()
    expect(mockDelete).toHaveBeenCalledTimes(2)
  })

  it('(c) com cacheDirectory null não faz nada', async () => {
    mockCache = null
    await limparCopiasCache(['file:///data/user/0/app/cache/a.pdf'])
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('lista vazia não faz nada', async () => {
    await limparCopiasCache([])
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
