import { useEffect, useRef, useState } from 'react'
import type { Take } from '../core/takes'
import { round } from '../core/takes'
import { player } from '../core/player'
import { sources, useStore, type Version } from '../store'
import { C, drawWave, fmtSec, setupCanvas } from './draw'

const H = 96
const GRAB = 12

const windowFor = (k: Take, dur: number): [number, number] => {
  const pad = Math.max(1, (k.b - k.a) * 0.25)
  return [Math.max(0, k.a - pad), Math.min(dur, k.b + pad)]
}

interface Drag {
  mode: 'a' | 'b' | 'm'
  W: [number, number]
  t0: number
  a0: number
  b0: number
  moved: boolean
}

export function previewEdge(version: Version, k: Take, edge: 'a' | 'b') {
  const src = sources.get(version.id)!
  if (edge === 'a') player.play(version.id, src.audio, k.a, Math.min(k.b, k.a + 1.5), k.id)
  else player.play(version.id, src.audio, Math.max(k.a, k.b - 1.5), k.b, k.id)
}

export function ZoomTrack({ version, take }: { version: Version; take: Take }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null)
  const [cursor, setCursor] = useState('default')
  const [, force] = useState(0)
  const src = sources.get(version.id)!
  const dur = src.audio.duration
  const W = drag.current?.W ?? windowFor(take, dur)

  useEffect(() => player.subscribe(() => force((n) => n + 1)), [])
  useEffect(() => {
    const ro = new ResizeObserver(() => force((n) => n + 1))
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const { g, w, h } = setupCanvas(cv)
    const X = (t: number) => ((t - W[0]) / (W[1] - W[0])) * w
    g.fillStyle = C.bg
    g.fillRect(0, 0, w, h)
    for (const p of src.analysis.pauses) {
      if (p.end < W[0] || p.start > W[1]) continue
      g.fillStyle = 'rgba(255,255,255,0.025)'
      g.fillRect(X(p.start), 0, X(p.end) - X(p.start), h)
    }
    g.fillStyle = 'rgba(155,140,255,0.10)'
    g.fillRect(X(take.a), 0, X(take.b) - X(take.a), h)
    drawWave(g, src.mono, src.audio.sampleRate, W[0], W[1], 0, 0, w, h, (t) =>
      t >= take.a && t <= take.b ? C.waveIn : C.wave,
    )
    for (const t of [take.a, take.b]) {
      const x = X(t)
      g.fillStyle = C.accent
      g.fillRect(x - 1, 0, 2, h)
      g.beginPath()
      g.roundRect(x - 5, h / 2 - 14, 10, 28, 3)
      g.fill()
      g.fillStyle = '#16161a'
      g.fillRect(x - 1.5, h / 2 - 6, 1, 12)
      g.fillRect(x + 0.5, h / 2 - 6, 1, 12)
    }
    const ps = player.state
    if (ps.versionId === version.id && ps.pos >= W[0] && ps.pos <= W[1] && (ps.playing || ps.pos > 0)) {
      g.fillStyle = C.playhead
      g.fillRect(X(ps.pos) - 0.75, 0, 1.5, h)
    }
  })

  const geo = (clientX: number, Wn = W) => {
    const r = ref.current!.getBoundingClientRect()
    const x = clientX - r.left
    const t = Wn[0] + ((Wn[1] - Wn[0]) * x) / r.width
    const px = (tt: number) => ((tt - Wn[0]) / (Wn[1] - Wn[0])) * r.width
    return { x, t, px }
  }

  const snapTo = (t: number) => {
    let best = t
    let bd = 0.25
    for (const p of src.snaps) {
      const d = Math.abs(p - t)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }

  const showTip = (t: number, k: Take, Wn: [number, number]) => {
    const r = ref.current!.getBoundingClientRect()
    setTip({ x: ((t - Wn[0]) / (Wn[1] - Wn[0])) * r.width, text: `${fmtSec(t, 2)} · take com ${fmtSec(k.b - k.a, 2)}` })
  }

  const store = useStore

  return (
    <div className="relative">
      <canvas
        ref={ref}
        data-testid="zoom"
        className="block w-full rounded-lg touch-none"
        style={{ height: H, cursor }}
        onPointerDown={(e) => {
          const { x, t, px } = geo(e.clientX)
          let mode: Drag['mode'] | null = null
          if (Math.abs(x - px(take.a)) < GRAB) mode = 'a'
          else if (Math.abs(x - px(take.b)) < GRAB) mode = 'b'
          else if (t > take.a && t < take.b) mode = 'm'
          if (!mode) {
            player.seek(version.id, Math.max(0, Math.min(dur, t)))
            return
          }
          store.getState().commit()
          drag.current = { mode, W, t0: t, a0: take.a, b0: take.b, moved: false }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) {
            const { x, t, px } = geo(e.clientX)
            setCursor(
              Math.abs(x - px(take.a)) < GRAB || Math.abs(x - px(take.b)) < GRAB
                ? 'ew-resize'
                : t > take.a && t < take.b
                  ? 'grab'
                  : 'text',
            )
            return
          }
          const { t } = geo(e.clientX, d.W)
          const tc = Math.max(0, Math.min(dur, t))
          if (Math.abs(tc - d.t0) > 0.005) d.moved = true
          let a = take.a
          let b = take.b
          if (d.mode === 'a') a = Math.min(tc, take.b - 0.05)
          else if (d.mode === 'b') b = Math.max(tc, take.a + 0.05)
          else {
            const len = d.b0 - d.a0
            a = Math.max(0, Math.min(dur - len, d.a0 + tc - d.t0))
            b = a + len
          }
          store.getState().patchTake(take.id, { a: round(a), b: round(b), reviewed: false }, { commit: false })
          showTip(d.mode === 'b' ? b : a, { ...take, a, b }, d.W)
        }}
        onPointerUp={(e) => {
          const d = drag.current
          if (!d) return
          drag.current = null
          setTip(null)
          const s = store.getState()
          const cur = s.versions.find((v) => v.id === version.id)?.takes.find((x) => x.id === take.id)
          if (!cur) return
          if (!d.moved) {
            s.past.pop()
            store.setState({ past: [...s.past] })
            player.seek(version.id, d.t0)
            return
          }
          let { a, b } = cur
          if (s.snap && !e.altKey) {
            if (d.mode !== 'b') a = snapTo(a)
            if (d.mode !== 'a') b = snapTo(b)
            if (d.mode === 'm') {
              const len = d.b0 - d.a0
              const sa = snapTo(cur.a)
              a = sa
              b = sa + len
            }
          }
          s.patchTake(take.id, { a: round(a), b: round(Math.max(b, a + 0.05)) }, { commit: false })
          force((n) => n + 1)
          if (s.autoPreview && d.mode !== 'm') {
            const fresh = store.getState().versions.find((v) => v.id === version.id)!.takes.find((x) => x.id === take.id)!
            previewEdge(version, fresh, d.mode)
          }
        }}
      />
      {tip && (
        <div
          className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 rounded-md border border-line-strong bg-panel-3 px-2 py-0.5 text-[12px] whitespace-nowrap"
          style={{ left: tip.x }}
        >
          {tip.text}
        </div>
      )}
    </div>
  )
}
