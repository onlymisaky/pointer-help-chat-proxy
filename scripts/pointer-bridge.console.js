;(() => {
  const WS_URL = 'ws://127.0.0.1:3001'
  const BRIDGE_TOKEN = 'pointer-bridge-dev'
  const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000]
  const activeRequests = new Map()
  let retryIndex = 0
  let socket = null

  function log(...args) {
    const timestamp = new Date().toLocaleString()
    const prefix = `[${timestamp}] [pointer-bridge]`
    console.log(
      `%c${prefix}%c`,
      'color: hotpink;font-weight: bold;',
      '',
      ...args,
    )
  }

  function sendMessage(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('bridge socket is not connected')
    }

    socket.send(JSON.stringify(payload))
  }

  function trySendMessage(payload) {
    try {
      sendMessage(payload)
      return true
    }
    catch (error) {
      log('failed to send bridge message', error)
      return false
    }
  }

  function serializeHeaders(headers) {
    const result = {}

    headers.forEach((value, key) => {
      result[key] = value
    })

    return result
  }

  function toBase64(bytes) {
    let binary = ''
    const chunkSize = 0x8000

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize)
      binary += String.fromCharCode(...chunk)
    }

    return btoa(binary)
  }

  async function forwardResponse(requestId, response) {
    sendMessage({
      type: 'proxy_response_head',
      requestId,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: serializeHeaders(response.headers),
    })

    if (response.body) {
      const reader = response.body.getReader()

      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }

        if (value && value.length > 0) {
          sendMessage({
            type: 'proxy_response_chunk',
            requestId,
            chunk: toBase64(value),
            encoding: 'base64',
          })
        }
      }
    }

    sendMessage({
      type: 'proxy_complete',
      requestId,
    })
  }

  async function handleProxyRequest(message) {
    const controller = new AbortController()
    activeRequests.set(message.requestId, controller)

    try {
      const response = await fetch(message.url, {
        method: message.method,
        headers: message.headers,
        body: message.body,
        credentials: 'include',
        signal: controller.signal,
      })

      await forwardResponse(message.requestId, response)
    }
    catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      trySendMessage({
        type: 'proxy_error',
        requestId: message.requestId,
        message: messageText,
      })
    }
    finally {
      activeRequests.delete(message.requestId)
    }
  }

  function connect() {
    socket = new WebSocket(WS_URL)

    socket.addEventListener('open', () => {
      retryIndex = 0
      log('connected to local bridge')
      sendMessage({
        type: 'hello',
        token: BRIDGE_TOKEN,
      })
    })

    socket.addEventListener('message', async (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      }
      catch {
        return
      }

      if (message.type === 'hello_ack') {
        log('bridge authenticated')
        return
      }

      if (message.type === 'proxy_request') {
        await handleProxyRequest(message)
        return
      }

      if (message.type === 'error') {
        log('bridge error', message.message)
      }
    })

    socket.addEventListener('close', () => {
      for (const controller of activeRequests.values()) {
        controller.abort()
      }
      activeRequests.clear()

      const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)]
      retryIndex += 1
      log(`bridge disconnected, retrying in ${delay}ms`)
      window.setTimeout(connect, delay)
    })

    socket.addEventListener('error', () => {
      log('bridge socket error')
    })
  }

  connect()
})()
