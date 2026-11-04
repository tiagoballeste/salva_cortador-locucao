export const C = {
  bg: '#1d1d21',
  wave: '#5b5b66',
  waveIn: '#c9c1ff',
  accent: '#9b8cff',
  accentStrong: '#7c6cf0',
  take: 'rgba(155,140,255,0.16)',
  takeOpen: 'rgba(155,140,255,0.34)',
  takeEdge: 'rgba(155,140,255,0.7)',
  overlap: 'rgba(244,113,116,0.45)',
  hatch: 'rgba(242,193,78,0.55)',
  fg: '#ededf0',
  fg2: '#a3a3ad',
  fg3: '#74747e',
  playhead: '#ffffff',
  ok: '#5fd08a',
}

export function setupCanvas(cv: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } {
  const w = cv.clientWidth
  const h = cv.clientHeight
  const d = window.devicePixelRatio || 1
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) {
    cv.width = Math.round(w * d)
    cv.height = Math.round(h * d)
  }
  const g = cv.getContext('2d')!
  g.setTransform(d, 0, 0, d, 0, 0)
  g.clearRect(0, 0, w, h)
  return { g, w, h }
}

export function drawWave(
  g: CanvasRenderingContext2D,
  mono: Float32Array,
  sr: number,
  wa: number,
  wb: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  color: (t: number) => string,
) {
  const mid = y0 + h / 2
  const span = wb - wa
  let last = ''
  for (let x = 0; x < w; x++) {
    const t0 = wa + (span * x) / w
    const t1 = wa + (span * (x + 1)) / w
    const i0 = Math.max(0, Math.floor(t0 * sr))
    const i1 = Math.min(mono.length, Math.max(i0 + 1, Math.floor(t1 * sr)))
    let mx = 0
    const step = Math.max(1, Math.floor((i1 - i0) / 400))
    for (let i = i0; i < i1; i += step) {
      const v = mono[i] < 0 ? -mono[i] : mono[i]
      if (v > mx) mx = v
    }
    const hh = Math.max(1, Math.min(1, mx * 1.05) * h * 0.92)
    const c = color((t0 + t1) / 2)
    if (c !== last) {
      g.fillStyle = c
      last = c
    }
    g.fillRect(x0 + x, mid - hh / 2, 1, hh)
  }
}

export function hatch(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.strokeStyle = color
  g.lineWidth = 1
  for (let k = x - h; k < x + w; k += 6) {
    g.beginPath()
    g.moveTo(k, y + h)
    g.lineTo(k + h, y)
    g.stroke()
  }
  g.restore()
}

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`.replace('.', ',')
}

export const fmtSec = (t: number, d = 1) => `${t.toFixed(d).replace('.', ',')}s`
