export type SampleFormat = 'int' | 'float'

export interface PcmAudio {
  sampleRate: number
  bitDepth: number
  format: SampleFormat
  channels: Float32Array[]
  length: number
  duration: number
}

const tag = (v: DataView, o: number) =>
  String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))

export function isWav(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false
  const v = new DataView(buf)
  return tag(v, 0) === 'RIFF' && tag(v, 8) === 'WAVE'
}

export function parseWav(buf: ArrayBuffer): PcmAudio {
  const v = new DataView(buf)
  if (!isWav(buf)) throw new Error('Esse arquivo não é um WAV válido.')
  let off = 12
  let fmt: { format: number; ch: number; sr: number; bits: number; align: number } | null = null
  let dataOff = -1
  let dataLen = 0
  while (off + 8 <= v.byteLength) {
    const id = tag(v, off)
    const size = v.getUint32(off + 4, true)
    const body = off + 8
    if (id === 'fmt ') {
      let format = v.getUint16(body, true)
      const ch = v.getUint16(body + 2, true)
      const sr = v.getUint32(body + 4, true)
      const align = v.getUint16(body + 12, true)
      const bits = v.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true)
      fmt = { format, ch, sr, bits, align }
    } else if (id === 'data') {
      dataOff = body
      dataLen = Math.min(size, v.byteLength - body)
      break
    }
    off = body + size + (size % 2)
  }
  if (!fmt || dataOff < 0) throw new Error('Não encontrei os dados de áudio dentro do WAV.')
  const { format, ch, sr, bits, align } = fmt
  if (format !== 1 && format !== 3) throw new Error('Formato de WAV não suportado (só PCM ou float).')
  const n = Math.floor(dataLen / align)
  const channels = Array.from({ length: ch }, () => new Float32Array(n))
  const bps = bits / 8
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const p = dataOff + i * align + c * bps
      let s: number
      if (format === 3) s = bits === 64 ? v.getFloat64(p, true) : v.getFloat32(p, true)
      else if (bits === 16) s = v.getInt16(p, true) / 32768
      else if (bits === 24) {
        let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16)
        if (x & 0x800000) x |= ~0xffffff
        s = x / 8388608
      } else if (bits === 32) s = v.getInt32(p, true) / 2147483648
      else if (bits === 8) s = (v.getUint8(p) - 128) / 128
      else throw new Error(`Profundidade de ${bits} bits não suportada.`)
      channels[c][i] = s
    }
  }
  return {
    sampleRate: sr,
    bitDepth: bits,
    format: format === 3 ? 'float' : 'int',
    channels,
    length: n,
    duration: n / sr,
  }
}

export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  bitDepth: number,
  format: SampleFormat,
): Uint8Array {
  const ch = channels.length
  const n = channels[0].length
  const bits = format === 'float' ? 32 : bitDepth === 8 ? 16 : bitDepth
  const bps = bits / 8
  const align = ch * bps
  const dataLen = n * align
  const out = new ArrayBuffer(44 + dataLen)
  const v = new DataView(out)
  const w = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  w(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, format === 'float' ? 3 : 1, true)
  v.setUint16(22, ch, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * align, true)
  v.setUint16(32, align, true)
  v.setUint16(34, bits, true)
  w(36, 'data')
  v.setUint32(40, dataLen, true)
  let p = 44
  const clamp = (x: number) => (x > 1 ? 1 : x < -1 ? -1 : x)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = channels[c][i]
      if (format === 'float') v.setFloat32(p, s, true)
      else if (bits === 16) v.setInt16(p, Math.max(-32768, Math.min(32767, Math.round(clamp(s) * 32768))), true)
      else if (bits === 24) {
        let x = Math.max(-8388608, Math.min(8388607, Math.round(clamp(s) * 8388608)))
        if (x < 0) x += 0x1000000
        v.setUint8(p, x & 0xff)
        v.setUint8(p + 1, (x >> 8) & 0xff)
        v.setUint8(p + 2, (x >> 16) & 0xff)
      } else v.setInt32(p, Math.max(-2147483648, Math.min(2147483647, Math.round(clamp(s) * 2147483648))), true)
      p += bps
    }
  }
  return new Uint8Array(out)
}

export function isDualMono(channels: Float32Array[]): boolean {
  if (channels.length < 2) return true
  const [l, r] = channels
  let max = 0
  for (let i = 0; i < l.length; i += 7) max = Math.max(max, Math.abs(l[i] - r[i]))
  return max < 0.001
}

export function slice(
  channels: Float32Array[],
  sampleRate: number,
  a: number,
  b: number,
  mono: boolean,
): Float32Array[] {
  const i0 = Math.max(0, Math.round(a * sampleRate))
  const i1 = Math.min(channels[0].length, Math.round(b * sampleRate))
  const parts = channels.map((c) => c.slice(i0, i1))
  const fade = Math.min(Math.round(sampleRate * 0.004), Math.floor(parts[0].length / 4))
  for (const c of parts) {
    for (let i = 0; i < fade; i++) {
      const g = i / fade
      c[i] *= g
      c[c.length - 1 - i] *= g
    }
  }
  if (!mono || parts.length === 1) return parts
  const m = new Float32Array(parts[0].length)
  for (let i = 0; i < m.length; i++) {
    let s = 0
    for (const c of parts) s += c[i]
    m[i] = s / parts.length
  }
  return [m]
}
