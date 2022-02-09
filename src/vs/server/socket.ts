import { promises as fs } from "fs"
import * as net from "net"
import * as path from "path"
import * as tls from "tls"
import { tmpdir } from "os"

/**
 * Return a promise that resolves with whether the socket path is active.
 */
 export function canConnect(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect(path)
      socket.once("error", () => resolve(false))
      socket.once("connect", () => {
        socket.destroy()
        resolve(true)
      })
    })
  }

export const generateUuid = (length = 24): string => {
    const possible = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    return Array(length)
      .fill(1)
      .map(() => possible[Math.floor(Math.random() * possible.length)])
      .join("")
  }


/**
 * Event emitter callback. Called with the emitted value and a promise that
 * resolves when all emitters have finished.
 */
export type Callback<T, R = void | Promise<void>> = (t: T, p: Promise<void>) => R

export interface Disposable {
  dispose(): void | Promise<void>
}

export interface Event<T> {
  (listener: Callback<T>): Disposable
}

/**
 * Emitter typecasts for a single event type.
 */
export class Emitter<T> {
  private listeners: Array<Callback<T>> = []

  public get event(): Event<T> {
    return (cb: Callback<T>): Disposable => {
      this.listeners.push(cb)

      return {
        dispose: (): void => {
          const i = this.listeners.indexOf(cb)
          if (i !== -1) {
            this.listeners.splice(i, 1)
          }
        },
      }
    }
  }

  /**
   * Emit an event with a value.
   */
  public async emit(value: T): Promise<void> {
    let resolve: () => void
    const promise = new Promise<void>((r) => (resolve = r))

    await Promise.all(
      this.listeners.map(async (cb) => {
        try {
          await cb(value, promise)
        } catch (error: any) {
            // oh well
        }
      }),
    )

    resolve!()
  }

  public dispose(): void {
    this.listeners = []
  }
}


/**
 * Provides a way to proxy a TLS socket. Can be used when you need to pass a
 * socket to a child process since you can't pass the TLS socket.
 */
export class SocketProxyProvider {
  private readonly onProxyConnect = new Emitter<net.Socket>()
  private proxyPipe = path.join(tmpdir(), "tls-proxy")
  private _proxyServer?: Promise<net.Server>
  private readonly proxyTimeout = 5000

  /**
   * Stop the proxy server.
   */
  public stop(): void {
    if (this._proxyServer) {
      this._proxyServer.then((server) => server.close())
      this._proxyServer = undefined
    }
  }

  /**
   * Create a socket proxy for TLS sockets. If it's not a TLS socket the
   * original socket is returned. This will spawn a proxy server on demand.
   */
  public async createProxy(socket: net.Socket): Promise<net.Socket> {
    if (!(socket instanceof tls.TLSSocket)) {
      return socket
    }

    await this.startProxyServer()

    return new Promise((resolve, reject) => {
      const id = generateUuid()
      const proxy = net.connect(this.proxyPipe)
      proxy.once("connect", () => proxy.write(id))

      const timeout = setTimeout(() => {
        listener.dispose() // eslint-disable-line @typescript-eslint/no-use-before-define
        socket.destroy()
        proxy.destroy()
        reject(new Error("TLS socket proxy timed out"))
      }, this.proxyTimeout)

      const listener = this.onProxyConnect.event((connection) => {
        connection.once("data", (data) => {
          if (!socket.destroyed && !proxy.destroyed && data.toString() === id) {
            clearTimeout(timeout)
            listener.dispose()
            ;[
              [proxy, socket],
              [socket, proxy],
            ].forEach(([a, b]) => {
              a.pipe(b)
              a.on("error", () => b.destroy())
              a.on("close", () => b.destroy())
              a.on("end", () => b.end())
            })
            resolve(connection)
          }
        })
      })
    })
  }

  private async startProxyServer(): Promise<net.Server> {
    if (!this._proxyServer) {
      this._proxyServer = this.findFreeSocketPath(this.proxyPipe)
        .then((pipe) => {
          this.proxyPipe = pipe
          return Promise.all([
            fs.mkdir(path.dirname(this.proxyPipe), { recursive: true }),
            fs.rmdir(this.proxyPipe, { recursive: true }),
          ])
        })
        .then(() => {
          return new Promise((resolve) => {
            const proxyServer = net.createServer((p) => this.onProxyConnect.emit(p))
            proxyServer.once("listening", () => resolve(proxyServer))
            proxyServer.listen(this.proxyPipe)
          })
        })
    }
    return this._proxyServer
  }

  public async findFreeSocketPath(basePath: string, maxTries = 100): Promise<string> {
    let i = 0
    let path = basePath
    while ((await canConnect(path)) && i < maxTries) {
      path = `${basePath}-${++i}`
    }
    return path
  }
}
