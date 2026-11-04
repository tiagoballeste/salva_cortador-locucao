import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_VERY_LOW, canEncodeAudio } from 'mediabunny'

export type Aspect = '9:16' | '16:9' | '1:1'

export const ASPECTS: Record<Aspect, [number, number]> = {
  '9:16': [720, 1280],
  '16:9': [1280, 720],
  '1:1': [720, 720],
}

export const FPS = 24

let aacReady: Promise<void> | null = null

function ensureAac(sampleRate: number, channels: number) {
  aacReady ??= (async () => {
    const native = await canEncodeAudio('aac', { numberOfChannels: channels, sampleRate }).catch(() => false)
    if (!native) {
      const m = await import('@mediabunny/aac-encoder')
      m.registerAacEncoder()
    }
  })()
  return aacReady
}

// Silêncio digital puro trava o encoder AAC em WASM; um ruído em -94 dBFS (inaudível) evita isso.
export async function blackMp4(channels: Float32Array[], sampleRate: number, aspect: Aspect): Promise<Uint8Array> {
  await ensureAac(sampleRate, channels.length)
  const [w, h] = ASPECTS[aspect]
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const video = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_VERY_LOW, keyFrameInterval: 2 })
  const audio = new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH })
  output.addVideoTrack(video, { frameRate: FPS })
  output.addAudioTrack(audio)
  await output.start()

  const length = channels[0].length
  channels = channels.map((c) => {
    const o = new Float32Array(c)
    for (let i = 0; i < o.length; i++) if (o[i] > -1e-7 && o[i] < 1e-7) o[i] = (Math.random() - 0.5) * 2e-5
    return o
  })
  const buffer = new AudioBuffer({ numberOfChannels: channels.length, length: Math.max(1, length), sampleRate })
  channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i))
  await audio.add(buffer)

  const frames = Math.max(1, Math.round((length / sampleRate) * FPS))
  for (let i = 0; i < frames; i++) await video.add(i / FPS, 1 / FPS)

  await output.finalize()
  return new Uint8Array(output.target.buffer!)
}
