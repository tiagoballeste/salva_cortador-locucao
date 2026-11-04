import { useEffect, useRef, useState } from 'react'
import { speechBlocks, type Pause } from '../core/analysis'
import { pauseState, sortTakes } from '../core/takes'
import { player } from '../core/player'
import { sources, useStore, type Version } from '../store'
import { C, drawWave, fmtSec, hatch, setupCanvas } from './draw'

const WAVE_H = 64
const MARK_H = 18

export function MasterTrack({ version }: { version: Version }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const base = useRef<{ key: string; img: HTMLCanvasElement } | null>(null)
  const openId = useStore((s) => s.openId)
  const togglePauseAction = useStore((s) => s.togglePause)
  const setOpen = useStore((s) => s.setOpen)
  const [hover, setHover] = useState<{ p: Pause; x: number } | null>(null)
  const [, force] = useState(0)
  const src = sources.get(version.id)!
  const dur = src.audio.duration

  useEffect(() => player.subscribe(() => force((n) => n + 1)), [])
  useEffect(() => {
    const ro = new ResizeObserver(() => force((n) => n + 1))
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  const markerX = (p: Pause, w: number) => (((p.start + p.end) / 2) / dur) * w

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const { g, w, h } = setupCanvas(cv)
    const X = (t: number) => (t / dur) * w
    const key = `${version.id}:${w}`
    if (!base.current || base.current.key !== key) {
      const img = document.createElement('canvas')
      const d = window.devicePixelRatio || 1
      img.width = Math.round(w * d)
      img.height = Math.round(WAVE_H * d)
      const bg = img.getContext('2d')!
      bg.setTransform(d, 0, 0, d, 0, 0)
      drawWave(bg, src.mono, src.audio.sampleRate, 0, dur, 0, 0, w, WAVE_H, () => C.wave)
      base.current = { key, img }
    }
    g.fillStyle = C.bg
    g.fillRect(0, 0, w, WAVE_H)
    g.drawImage(base.current.img, 0, 0, w, WAVE_H)
    const takes = sortTakes(version.takes)
    for (const bl of speechBlocks(src.analysis)) {
      let t = bl.start
      while (t < bl.end) {
        const cover = takes.find((k) => k.a <= t + 0.005 && k.b > t + 0.005)
        if (cover) {
          t = cover.b
          continue
        }
        const nxt = takes.find((k) => k.a > t)
        const e = Math.min(bl.end, nxt ? nxt.a : bl.end)
        if (e - t > 0.03) hatch(g, X(t), 0, X(e) - X(t), WAVE_H, C.hatch)
        t = e + 0.001
      }
    }
    takes.forEach((k, i) => {
      const open = k.id === openId
      g.fillStyle = open ? C.takeOpen : C.take
      g.fillRect(X(k.a), 0, X(k.b) - X(k.a), WAVE_H)
      g.fillStyle = C.takeEdge
      g.fillRect(X(k.a), 0, 1, WAVE_H)
      g.fillRect(X(k.b) - 1, 0, 1, WAVE_H)
      if (open) {
        g.strokeStyle = C.accent
        g.lineWidth = 1.5
        g.strokeRect(X(k.a) + 0.75, 0.75, X(k.b) - X(k.a) - 1.5, WAVE_H - 1.5)
      }
      g.fillStyle = C.fg
      g.font = '600 10px Inter, system-ui, sans-serif'
      g.fillText(String(i + 1), X(k.a) + 4, 12)
    })
    for (let i = 1; i < takes.length; i++) {
      const p = takes[i - 1]
      const q = takes[i]
      if (q.a < p.b - 0.01) {
        g.fillStyle = C.overlap
        g.fillRect(X(q.a), 0, X(Math.min(p.b, q.b)) - X(q.a), WAVE_H)
      }
    }
    for (const p of src.analysis.pauses) {
      const st = pauseState(p, takes)
      const x = markerX(p, w)
      const hot = hover?.p === p
      const y = WAVE_H + MARK_H / 2
      if (st === 'corte') {
        g.fillStyle = hot ? C.fg : C.accent
        g.fillRect(x - 0.75, 0, 1.5, WAVE_H)
        g.beginPath()
        g.moveTo(x, y - 6)
        g.lineTo(x + 6, y)
        g.lineTo(x, y + 6)
        g.lineTo(x - 6, y)
        g.closePath()
        g.fill()
      } else if (st === 'respiro') {
        g.strokeStyle = hot ? C.fg : C.fg2
        g.setLineDash([2, 3])
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, WAVE_H)
        g.stroke()
        g.setLineDash([])
        g.beginPath()
        g.arc(x, y, 5, 0, Math.PI * 2)
        g.lineWidth = 1.5
        g.stroke()
      } else {
        g.fillStyle = hot ? C.fg2 : C.fg3
        g.beginPath()
        g.arc(x, y, 2, 0, Math.PI * 2)
        g.fill()
      }
    }
    const ps = player.state
    if (ps.versionId === version.id && (ps.playing || ps.pos > 0)) {
      g.fillStyle = C.playhead
      g.fillRect(X(ps.pos) - 0.75, 0, 1.5, h)
    }
  })

  const hit = (clientX: number) => {
    const cv = ref.current!
    const r = cv.getBoundingClientRect()
    const x = clientX - r.left
    let best: Pause | null = null
    let bd = 8
    for (const p of src.analysis.pauses) {
      const d = Math.abs(markerX(p, r.width) - x)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return { x, t: (x / r.width) * dur, pause: best }
  }

  const tip = hover
    ? (() => {
        const st = pauseState(hover.p, version.takes)
        const len = fmtSec(hover.p.end - hover.p.start, 2)
        if (st === 'corte') return `Pausa de ${len} · corte. Clique para virar respiro e juntar os takes`
        if (st === 'respiro') return `Pausa de ${len} · respiro dentro do take. Clique para cortar aqui`
        return `Pausa de ${len} · fora dos takes`
      })()
    : null

  return (
    <div className="relative select-none">
      <canvas
        ref={ref}
        data-testid="master"
        className="block w-full rounded-lg cursor-pointer"
        style={{ height: WAVE_H + MARK_H }}
        onMouseMove={(e) => {
          const { pause } = hit(e.clientX)
          setHover(pause ? { p: pause, x: markerX(pause, e.currentTarget.getBoundingClientRect().width) } : null)
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const { t, pause } = hit(e.clientX)
          if (pause && pauseState(pause, version.takes) !== 'livre') {
            togglePauseAction(pause)
            return
          }
          const k = version.takes.find((x) => t >= x.a && t <= x.b)
          if (k) setOpen(k.id)
          const ps = player.state
          if (ps.playing && ps.takeId === null && ps.versionId === version.id) player.play(version.id, src.audio, t, dur, null)
          else player.seek(version.id, t)
        }}
      />
      {hover && tip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line-strong bg-panel-3 px-2 py-1 text-[12px] text-fg whitespace-nowrap"
          style={{ left: Math.max(140, Math.min(hover.x, (ref.current?.clientWidth ?? 0) - 140)), top: WAVE_H + MARK_H + 6 }}
        >
          {tip}
        </div>
      )}
    </div>
  )
}
