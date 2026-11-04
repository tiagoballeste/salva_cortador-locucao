export interface Pause {
  start: number
  end: number
}

export interface Analysis {
  hop: number
  db: Float32Array
  threshold: number
  pauses: Pause[]
  speechStart: number
  speechEnd: number
  peaks: Float32Array
}

const PEAK_BINS = 4000

export function mixMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const n = channels[0].length
  const m = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const c of channels) s += c[i]
    m[i] = s / channels.length
  }
  return m
}

export function analyze(
  channels: Float32Array[],
  sampleRate: number,
  opts: { minPause?: number; hop?: number } = {},
): Analysis {
  const hop = opts.hop ?? 0.01
  const minPause = opts.minPause ?? 0.12
  const m = mixMono(channels)
  const hs = Math.max(1, Math.round(sampleRate * hop))
  const frames = Math.floor(m.length / hs)
  const db = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    const o = f * hs
    for (let i = 0; i < hs; i++) s += m[o + i] * m[o + i]
    db[f] = 10 * Math.log10(s / hs + 1e-12)
  }
  const sorted = Array.from(db).sort((x, y) => x - y)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? -20
  const threshold = Math.max(-55, Math.min(-30, p95 - 32))
  const loud = Array.from(db, (d) => d > threshold)
  let first = loud.indexOf(true)
  let last = loud.lastIndexOf(true)
  if (first < 0) {
    first = 0
    last = frames - 1
  }
  const pauses: Pause[] = []
  let i = first
  while (i <= last) {
    if (!loud[i]) {
      let j = i
      while (j <= last && !loud[j]) j++
      const len = (j - i) * hop
      if (len >= minPause) pauses.push({ start: i * hop, end: j * hop })
      i = j
    } else i++
  }
  const speechLevel = threshold + 14
  for (let k = 0; k <= pauses.length; k++) {
    const s = k === 0 ? first : Math.round(pauses[k - 1].end / hop)
    const e = k === pauses.length ? last + 1 : Math.round(pauses[k].start / hop)
    let mx = -200
    for (let f = s; f < e; f++) mx = Math.max(mx, db[f])
    if (mx < speechLevel && pauses.length > 0) {
      pauses.splice(k === 0 ? 0 : k - 1, 1)
      k = -1
    }
  }
  const peaks = new Float32Array(PEAK_BINS)
  const per = m.length / PEAK_BINS
  for (let b = 0; b < PEAK_BINS; b++) {
    let mx = 0
    const s = Math.floor(b * per)
    const e = Math.min(m.length, Math.floor((b + 1) * per))
    for (let k = s; k < e; k++) {
      const a = Math.abs(m[k])
      if (a > mx) mx = a
    }
    peaks[b] = mx
  }
  return {
    hop,
    db,
    threshold,
    pauses,
    speechStart: first * hop,
    speechEnd: Math.min((last + 1) * hop, m.length / sampleRate),
    peaks,
  }
}

export function speechBlocks(an: Analysis): Pause[] {
  const blocks: Pause[] = []
  let s = an.speechStart
  for (const p of an.pauses) {
    blocks.push({ start: s, end: p.start })
    s = p.end
  }
  blocks.push({ start: s, end: an.speechEnd })
  return blocks
}

export function padFor(p: Pause): number {
  return Math.min(0.15, (p.end - p.start) / 2)
}

export function snapPoints(an: Analysis, duration: number): number[] {
  const pts = [0, duration]
  for (const p of an.pauses) {
    const pad = padFor(p)
    pts.push(p.start + pad, p.end - pad, (p.start + p.end) / 2)
  }
  pts.push(Math.max(0, an.speechStart - 0.12), Math.min(duration, an.speechEnd + 0.12))
  return pts.sort((a, b) => a - b)
}
