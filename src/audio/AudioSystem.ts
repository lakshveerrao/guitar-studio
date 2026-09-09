/**
 * Single persistent AudioContext for the whole app.
 * Created lazily on the first user gesture (browser autoplay policy).
 */
class AudioSystemImpl {
  private ctx: AudioContext | null = null
  private listeners = new Set<(ready: boolean) => void>()

  get context(): AudioContext | null {
    return this.ctx
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running'
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async unlock(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor({ latencyHint: 'interactive', sampleRate: 44100 })
      this.ctx.addEventListener('statechange', () => this.emit())
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume()
      } catch {
        /* autoplay restriction: not an error, will retry on next gesture */
      }
    }
    this.emit()
    return this.ctx
  }

  subscribe(fn: (ready: boolean) => void): () => void {
    this.listeners.add(fn)
    fn(this.ready)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    const r = this.ready
    this.listeners.forEach((l) => l(r))
  }
}

export const AudioSystem = new AudioSystemImpl()
