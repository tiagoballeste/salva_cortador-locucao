import type { PcmAudio } from './wav'

type Listener = () => void

export interface PlayState {
  versionId: string | null
  takeId: string | null
  a: number
  b: number
  pos: number
  playing: boolean
}

class Player {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private src: AudioBufferSourceNode | null = null
  private t0 = 0
  private raf = 0
  private listeners = new Set<Listener>()
  state: PlayState = { versionId: null, takeId: null, a: 0, b: 0, pos: 0, playing: false }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    this.state = { ...this.state }
    this.listeners.forEach((l) => l())
  }

  private buffer(versionId: string, audio: PcmAudio): AudioBuffer {
    const ctx = this.ctx!
    let b = this.buffers.get(versionId)
    if (!b) {
      b = ctx.createBuffer(audio.channels.length, audio.length, audio.sampleRate)
      audio.channels.forEach((c, i) => b!.copyToChannel(c as Float32Array<ArrayBuffer>, i))
      this.buffers.set(versionId, b)
    }
    return b
  }

  forget(versionId: string) {
    this.buffers.delete(versionId)
  }

  play(versionId: string, audio: PcmAudio, a: number, b: number, takeId: string | null = null) {
    this.stop(true)
    if (!this.ctx) this.ctx = new AudioContext()
    void this.ctx.resume()
    const buf = this.buffer(versionId, audio)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.ctx.destination)
    const dur = Math.max(0.01, b - a)
    src.start(0, a, dur)
    this.src = src
    this.t0 = this.ctx.currentTime
    this.state = { versionId, takeId, a, b, pos: a, playing: true }
    src.onended = () => {
      if (this.src === src) this.stop()
    }
    const tick = () => {
      if (!this.ctx || !this.state.playing) return
      this.state.pos = Math.min(b, a + (this.ctx.currentTime - this.t0))
      this.emit()
      this.raf = requestAnimationFrame(tick)
    }
    tick()
  }

  stop(silent = false) {
    cancelAnimationFrame(this.raf)
    if (this.src) {
      try {
        this.src.onended = null
        this.src.stop()
      } catch {
        /* already stopped */
      }
      this.src = null
    }
    if (this.state.playing) {
      this.state.playing = false
      if (!silent) this.emit()
    }
  }

  seek(versionId: string, pos: number) {
    this.stop(true)
    this.state = { ...this.state, versionId, pos, playing: false }
    this.emit()
  }
}

export const player = new Player()
