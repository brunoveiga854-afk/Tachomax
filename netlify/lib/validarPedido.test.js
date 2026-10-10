const { validarPedido, MAX_BODY_BYTES, MAX_BLOCOS, MAX_TEXTO, MAX_SYSTEM } = require('./validarPedido')

const SYS = 'Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans texte avant ou après.'
const pdf = () => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } })
const img = () => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } })
const txt = (t = 'Document 1 de 1.') => ({ type: 'text', text: t })
const pedido = (content, extra = {}) => ({
  model: 'claude-sonnet-4-6', max_tokens: 3500, system: SYS,
  messages: [{ role: 'user', content }], ...extra,
})

describe('validarPedido — pedidos legítimos (formato da app v28)', () => {
  test('fiche com 1 PDF + texto', () => {
    expect(validarPedido(pedido([pdf(), txt(), txt('x'.repeat(3000))]))).toBeNull()
  })
  test('boletim de frais com fotos', () => {
    expect(validarPedido(pedido([img(), txt(), img(), txt('Document 2 de 2.'), txt('y'.repeat(900))], { max_tokens: 3000 }))).toBeNull()
  })
  test('sem system também passa', () => {
    const p = pedido([pdf(), txt()]); delete p.system
    expect(validarPedido(p)).toBeNull()
  })
  test('limites exactos passam: 60 blocos, 8000 chars de texto, 500 de system', () => {
    const blocos = Array.from({ length: MAX_BLOCOS }, () => txt('a'))
    expect(validarPedido(pedido(blocos))).toBeNull()
    expect(validarPedido(pedido([txt('a'.repeat(MAX_TEXTO))]))).toBeNull()
    expect(validarPedido(pedido([txt()], { system: 's'.repeat(MAX_SYSTEM) }))).toBeNull()
  })
  test('constante do corpo é 6 000 000', () => { expect(MAX_BODY_BYTES).toBe(6000000) })
})

describe('validarPedido — rejeições', () => {
  test.each(['tools', 'stream', 'metadata', 'temperature'])('chave extra %s', k => {
    expect(validarPedido(pedido([txt()], { [k]: 1 }))).toBe('chave extra')
  })
  test('body não objecto', () => {
    for (const v of [null, [], 'x', 5, undefined]) expect(validarPedido(v)).toBe('body')
  })
  test('messages inválido', () => {
    expect(validarPedido(pedido([txt()], { messages: [] }))).toBe('messages')
    expect(validarPedido(pedido([txt()], { messages: [{ role: 'user', content: [txt()] }, { role: 'user', content: [txt()] }] }))).toBe('messages')
    expect(validarPedido(pedido([txt()], { messages: 'olá' }))).toBe('messages')
  })
  test('role diferente de user ou chave extra na mensagem', () => {
    expect(validarPedido(pedido([txt()], { messages: [{ role: 'assistant', content: [txt()] }] }))).toBe('message')
    expect(validarPedido(pedido([txt()], { messages: [{ role: 'user', content: [txt()], name: 'x' }] }))).toBe('message')
  })
  test('content vazio, não-array ou com 61 blocos', () => {
    expect(validarPedido(pedido([]))).toBe('content')
    expect(validarPedido(pedido('texto'))).toBe('content')
    expect(validarPedido(pedido(Array.from({ length: MAX_BLOCOS + 1 }, () => txt('a'))))).toBe('content')
  })
  test('texto com 8001 chars ou chave extra no bloco', () => {
    expect(validarPedido(pedido([txt('a'.repeat(MAX_TEXTO + 1))]))).toBe('text')
    expect(validarPedido(pedido([{ type: 'text', text: 'a', cache_control: {} }]))).toBe('text')
    expect(validarPedido(pedido([{ type: 'text', text: 5 }]))).toBe('text')
  })
  test('media_type fora da lista', () => {
    const z = { type: 'document', source: { type: 'base64', media_type: 'application/zip', data: 'QUJD' } }
    expect(validarPedido(pedido([z]))).toBe('document')
    const g = { type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'QUJD' } }
    expect(validarPedido(pedido([g]))).toBe('image')
  })
  test('source.type url, data não-string ou chave extra', () => {
    expect(validarPedido(pedido([{ type: 'image', source: { type: 'url', url: 'http://x' } }]))).toBe('image')
    expect(validarPedido(pedido([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 5 } }]))).toBe('document')
    expect(validarPedido(pedido([{ ...pdf(), title: 'x' }]))).toBe('document')
  })
  test('tipos de bloco não permitidos', () => {
    for (const t of ['tool_use', 'tool_result', 'thinking']) expect(validarPedido(pedido([{ type: t }]))).toBe('tipo de bloco')
    expect(validarPedido(pedido([null]))).toBe('bloco')
  })
  test('system não-string ou com 501 chars', () => {
    expect(validarPedido(pedido([txt()], { system: [{ type: 'text', text: 'x' }] }))).toBe('system')
    expect(validarPedido(pedido([txt()], { system: 's'.repeat(MAX_SYSTEM + 1) }))).toBe('system')
  })
})
