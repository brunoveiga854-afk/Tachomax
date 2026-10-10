// netlify/lib/validarPedido.js
// Validação do formato dos pedidos ao proxy. Fica FORA de netlify/functions/
// para não ser publicado como endpoint. Função pura (testável com Jest).
const CHAVES = ['model', 'max_tokens', 'system', 'messages']
const MAX_BODY_BYTES = 6_000_000
const MAX_BLOCOS = 60          // ~29 ficheiros (2 blocos cada) + texto final
const MAX_TEXTO = 8000         // prompts reais: ~3000
const MAX_SYSTEM = 500         // real: ~110
const IMAGENS = ['image/jpeg', 'image/png', 'image/webp']

const ehObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const soChaves = (o, ks) => Object.keys(o).every(k => ks.includes(k))

// Devolve null se o pedido é válido, ou um motivo curto (sem conteúdo do pedido).
function validarPedido(b) {
  if (!ehObj(b)) return 'body'
  if (!soChaves(b, CHAVES)) return 'chave extra'
  if (b.system !== undefined && (typeof b.system !== 'string' || b.system.length > MAX_SYSTEM)) return 'system'
  if (!Array.isArray(b.messages) || b.messages.length !== 1) return 'messages'
  const m = b.messages[0]
  if (!ehObj(m) || !soChaves(m, ['role', 'content']) || m.role !== 'user') return 'message'
  if (!Array.isArray(m.content) || m.content.length < 1 || m.content.length > MAX_BLOCOS) return 'content'
  for (const c of m.content) {
    if (!ehObj(c)) return 'bloco'
    if (c.type === 'text') {
      if (!soChaves(c, ['type', 'text']) || typeof c.text !== 'string' || c.text.length > MAX_TEXTO) return 'text'
    } else if (c.type === 'document' || c.type === 'image') {
      const s = c.source
      const mt = c.type === 'document' ? ['application/pdf'] : IMAGENS
      if (!soChaves(c, ['type', 'source']) || !ehObj(s) || !soChaves(s, ['type', 'media_type', 'data'])
          || s.type !== 'base64' || !mt.includes(s.media_type) || typeof s.data !== 'string') return c.type
    } else {
      return 'tipo de bloco'
    }
  }
  return null
}

module.exports = { validarPedido, MAX_BODY_BYTES, MAX_BLOCOS, MAX_TEXTO, MAX_SYSTEM }
