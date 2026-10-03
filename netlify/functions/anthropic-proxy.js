exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const appSecret = process.env.APP_SECRET
  if (!appSecret || event.headers['x-app-secret'] !== appSecret) {
    return { statusCode: 401, body: 'Unauthorized' }
  }

  try {
    const body = JSON.parse(event.body)

    if (body.model !== 'claude-sonnet-4-6') {
      return { statusCode: 400, body: 'Model not allowed' }
    }
    if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 4000) {
      return { statusCode: 400, body: 'max_tokens not allowed' }
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    })

    const data = await response.json()

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    }
  }
}
