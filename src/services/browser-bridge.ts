import type {
  BridgeClientHello,
  BridgeIncomingMessage,
  BridgeProxyComplete,
  BridgeProxyError,
  BridgeProxyRequest,
  BridgeProxyResponseChunk,
  BridgeProxyResponseHead,
} from '../types/common.js'
import { Buffer } from 'node:buffer'
import { WebSocket, WebSocketServer } from 'ws'

interface PendingRequest {
  timeout: NodeJS.Timeout
  body: ReadableStream<Uint8Array>
  controller: ReadableStreamDefaultController<Uint8Array>
  responseStarted: boolean
  settled: boolean
  resolve: (response: Response) => void
  reject: (error: Error) => void
}

function safeParseMessage(raw: string): BridgeIncomingMessage | null {
  try {
    return JSON.parse(raw) as BridgeIncomingMessage
  }
  catch {
    return null
  }
}

function isClientHello(message: BridgeIncomingMessage): message is BridgeClientHello {
  return message.type === 'hello'
}

function isProxyResponseHead(message: BridgeIncomingMessage): message is BridgeProxyResponseHead {
  return message.type === 'proxy_response_head'
}

function isProxyResponseChunk(message: BridgeIncomingMessage): message is BridgeProxyResponseChunk {
  return message.type === 'proxy_response_chunk'
}

function isProxyError(message: BridgeIncomingMessage): message is BridgeProxyError {
  return message.type === 'proxy_error'
}

function isProxyComplete(message: BridgeIncomingMessage): message is BridgeProxyComplete {
  return message.type === 'proxy_complete'
}

export class BrowserBridgeService {
  // TODO ↓
  private readonly host = '127.0.0.1'
  private readonly port = 3001
  private readonly token = 'pointer-bridge-dev'
  private readonly requestTimeoutMs = 120000
  // TODO ↑

  private server?: WebSocketServer
  private activeSocket?: WebSocket
  private pendingRequests = new Map<string, PendingRequest>()

  public get isReady() {
    return this.server !== undefined
  }

  public get isAvailable() {
    return this.activeSocket?.readyState === WebSocket.OPEN
  }

  async start() {
    if (this.server) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.host,
        port: this.port,
      })

      server.once('listening', () => {
        this.server = server
        resolve()
      })

      server.once('error', reject)
      server.on('connection', (socket) => {
        this.handleConnection(socket)
      })
    })
  }

  async stop() {
    for (const requestId of this.pendingRequests.keys()) {
      this.failRequest(requestId, 'browser bridge stopped')
    }

    if (!this.server) {
      return
    }

    const server = this.server
    this.server = undefined
    this.activeSocket = undefined

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  async request(payload: {
    requestId: string
    url: string
    method: 'POST'
    headers: Record<string, string>
    body: string
  }): Promise<Response> {
    const socket = this.activeSocket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(this.notConnectedMessage())
    }

    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start: (_controller) => {
        controller = _controller
      },
      cancel: () => {
        this.clearRequest(payload.requestId)
      },
    })

    if (!controller) {
      throw new Error('browser bridge request stream did not initialize')
    }
    const initializedController = controller

    return await new Promise<Response>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failRequest(payload.requestId, 'browser bridge request timed out')
      }, this.requestTimeoutMs)

      this.pendingRequests.set(payload.requestId, {
        timeout,
        body,
        controller: initializedController,
        responseStarted: false,
        settled: false,
        resolve,
        reject,
      })

      const message: BridgeProxyRequest = {
        type: 'proxy_request',
        requestId: payload.requestId,
        url: payload.url,
        method: payload.method,
        headers: payload.headers,
        body: payload.body,
      }

      try {
        socket.send(JSON.stringify(message))
      }
      catch (error) {
        const message
          = socket.readyState === WebSocket.OPEN
            ? error instanceof Error ? error.message : 'browser bridge send failed'
            : this.notConnectedMessage()
        this.failRequest(payload.requestId, message)
      }
    })
  }

  private handleConnection(socket: WebSocket) {
    if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'error',
        message: 'another browser client is already active',
      }))
      socket.close(1013, 'another client is already active')
      return
    }

    socket.once('close', () => {
      if (this.activeSocket === socket) {
        this.activeSocket = undefined
        for (const requestId of this.pendingRequests.keys()) {
          this.failRequest(requestId, 'browser bridge disconnected')
        }
      }
    })

    socket.on('message', (raw) => {
      const message = safeParseMessage(raw.toString())
      if (!message) {
        return
      }

      if (isClientHello(message)) {
        this.handleHello(socket, message)
        return
      }

      if (this.activeSocket !== socket) {
        socket.close(1008, 'unauthenticated bridge client')
        return
      }

      if (isProxyResponseHead(message)) {
        this.handleProxyResponseHead(message)
        return
      }

      if (isProxyResponseChunk(message)) {
        this.handleProxyResponseChunk(message)
        return
      }

      if (isProxyError(message)) {
        this.handleProxyError(message)
        return
      }

      if (isProxyComplete(message)) {
        this.handleProxyComplete(message)
      }
    })
  }

  private handleHello(socket: WebSocket, message: BridgeClientHello) {
    if (message.token !== this.token) {
      socket.send(JSON.stringify({
        type: 'error',
        message: 'invalid bridge token',
      }))
      socket.close(1008, 'invalid bridge token')
      return
    }

    this.activeSocket = socket
    socket.send(JSON.stringify({
      type: 'hello_ack',
      ok: true,
    }))
  }

  private handleProxyResponseHead(message: BridgeProxyResponseHead) {
    const pending = this.pendingRequests.get(message.requestId)
    if (!pending) {
      return
    }

    if (pending.responseStarted) {
      this.failRequest(message.requestId, 'browser bridge sent duplicate response head')
      return
    }

    pending.responseStarted = true
    pending.settled = true
    pending.resolve(new Response(pending.body, {
      status: message.status,
      statusText: message.statusText,
      headers: message.headers,
    }))
  }

  private handleProxyResponseChunk(message: BridgeProxyResponseChunk) {
    const pending = this.pendingRequests.get(message.requestId)
    if (!pending) {
      return
    }

    if (!pending.responseStarted) {
      this.failRequest(message.requestId, 'browser bridge sent response chunk before response head')
      return
    }

    try {
      const chunk = Buffer.from(message.chunk, 'base64')
      pending.controller.enqueue(chunk)
    }
    catch {
      this.failRequest(message.requestId, 'browser bridge sent invalid response chunk')
    }
  }

  private handleProxyComplete(message: BridgeProxyComplete) {
    const pending = this.pendingRequests.get(message.requestId)
    if (!pending) {
      return
    }

    if (!pending.responseStarted) {
      this.rejectPending(pending, new Error('browser bridge completed without response head'))
    }
    else {
      pending.controller.close()
    }

    this.clearRequest(message.requestId)
  }

  private handleProxyError(message: BridgeProxyError) {
    const details = message.details
      ? `${message.message}: ${message.details}`
      : message.message
    this.failRequest(message.requestId, details)
  }

  private failRequest(requestId: string, message: string) {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) {
      return
    }

    const error = new Error(message)
    if (pending.responseStarted) {
      pending.controller.error(error)
    }
    else {
      this.rejectPending(pending, error)
    }

    this.clearRequest(requestId)
  }

  private clearRequest(requestId: string) {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) {
      return
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(requestId)
  }

  private rejectPending(pending: PendingRequest, error: Error) {
    if (pending.settled) {
      return
    }

    pending.settled = true
    pending.reject(error)
  }

  private notConnectedMessage() {
    return 'browser bridge is not connected'
  }
}

export const browserBridgeService = new BrowserBridgeService()
