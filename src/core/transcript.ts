import type { Take } from './takes'
import { encodeWav, type PcmAudio } from './wav'
import { mixMono } from './analysis'

export interface Word {
  w: string
  s: number
  e: number
}

export function wordsIn(take: Pick<Take, 'a' | 'b'>, words: Word[] | undefined): string {
  if (!words?.length) return ''
  return words
    .filter((x) => {
      const mid = (x.s + x.e) / 2
      return mid >= take.a && mid < take.b
    })
    .map((x) => x.w.trim())
    .filter(Boolean)
    .join(' ')
}

export function takeSpeech(take: Take, words: Word[] | undefined): string {
  return take.text.trim() || wordsIn(take, words)
}

export async function wavForTranscription(audio: PcmAudio): Promise<Uint8Array> {
  const sr = 16000
  const mono = mixMono(audio.channels)
  const len = Math.max(1, Math.ceil(audio.duration * sr))
  const ctx = new OfflineAudioContext(1, len, sr)
  const buf = ctx.createBuffer(1, mono.length, audio.sampleRate)
  buf.copyToChannel(mono as Float32Array<ArrayBuffer>, 0)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start()
  const out = await ctx.startRendering()
  return encodeWav([out.getChannelData(0)], sr, 16, 'int')
}
