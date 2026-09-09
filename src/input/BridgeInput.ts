import { AiroMoteInput } from './AiroMoteInput'

/**
 * Development bridge: a local script reads the AiroMote boards over BLE from
 * the PC and forwards their raw packets over a WebSocket. Lets the real
 * hardware drive the app in browsers that lack Web Bluetooth and enables
 * automated hardware tests. Enabled only in dev builds with ?bridge=1.
 * Frame: first byte = slot (0/1), rest = one or more 32-byte packets.
 */
export function startBridge(url = 'ws://127.0.0.1:8765'): () => void {
  let ws: WebSocket | null = null
  let stopped = false
  const attached = new Set<number>()
  const open = () => {
    if (stopped) return
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const m = JSON.parse(ev.data) as { slot: number; name?: string; event: 'attach' | 'detach' }
          if (m.event === 'attach') {
            AiroMoteInput.device(m.slot).attachExternal(m.name ?? `Bridge ${m.slot + 1}`)
            attached.add(m.slot)
          } else {
            AiroMoteInput.device(m.slot).detachExternal()
            attached.delete(m.slot)
          }
        } catch {
          /* ignore */
        }
        return
      }
      const b = new Uint8Array(ev.data as ArrayBuffer)
      if (b.length < 33) return
      const dev = AiroMoteInput.device(b[0])
      if (dev.status.state !== 'connected') {
        // packets arriving before (or without) an attach message: treat as attached
        dev.attachExternal(`Bridge ${b[0] + 1}`)
        attached.add(b[0])
      }
      dev.feed(b.subarray(1))
    }
    ws.onclose = () => {
      attached.forEach((s) => AiroMoteInput.device(s).detachExternal())
      attached.clear()
      if (!stopped) window.setTimeout(open, 1500)
    }
    ws.onerror = () => ws?.close()
  }
  open()
  return () => {
    stopped = true
    ws?.close()
  }
}
