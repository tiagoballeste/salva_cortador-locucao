import { padFor, speechBlocks, type Analysis, type Pause } from './analysis'

export interface Take {
  id: string
  a: number
  b: number
  text: string
  reviewed: boolean
}

let counter = 0
export const newId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`

export function takesFromAnalysis(an: Analysis, duration: number): Take[] {
  const blocks = speechBlocks(an)
  return blocks.map((bl, i) => {
    const before = i > 0 ? an.pauses[i - 1] : null
    const after = i < an.pauses.length ? an.pauses[i] : null
    const a = before ? bl.start - padFor(before) : Math.max(0, bl.start - 0.12)
    const b = after ? bl.end + padFor(after) : Math.min(duration, bl.end + 0.12)
    return { id: newId(), a: round(a), b: round(b), text: '', reviewed: false }
  })
}

export const round = (x: number) => Math.round(x * 1000) / 1000

export const sortTakes = (t: Take[]) => [...t].sort((x, y) => x.a - y.a)

export type PauseState = 'corte' | 'respiro' | 'livre'

const EPS = 0.01

export function pauseState(p: Pause, takes: Take[]): PauseState {
  const mid = (p.start + p.end) / 2
  if (takes.some((t) => t.a < mid - EPS && t.b > mid + EPS)) return 'respiro'
  const s = sortTakes(takes)
  const left = s.filter((t) => t.b <= mid + EPS).pop()
  const right = s.find((t) => t.a >= mid - EPS)
  if (left && right) return 'corte'
  return 'livre'
}

export function togglePause(p: Pause, takes: Take[]): Take[] | null {
  const mid = (p.start + p.end) / 2
  const inside = takes.find((t) => t.a < mid - EPS && t.b > mid + EPS)
  const pad = padFor(p)
  if (inside) {
    const left: Take = { ...inside, b: round(p.start + pad), reviewed: false }
    const right: Take = { id: newId(), a: round(p.end - pad), b: inside.b, text: '', reviewed: false }
    if (left.b - left.a < 0.05 || right.b - right.a < 0.05) return null
    return sortTakes(takes.flatMap((t) => (t.id === inside.id ? [left, right] : [t])))
  }
  const s = sortTakes(takes)
  const left = s.filter((t) => t.b <= mid + EPS).pop()
  const right = s.find((t) => t.a >= mid - EPS)
  if (!left || !right) return null
  const merged: Take = {
    ...left,
    b: right.b,
    text: [left.text, right.text].filter(Boolean).join(' '),
    reviewed: false,
  }
  return s.filter((t) => t.id !== right.id).map((t) => (t.id === left.id ? merged : t))
}

export function mergeWithNext(id: string, takes: Take[]): Take[] | null {
  const s = sortTakes(takes)
  const i = s.findIndex((t) => t.id === id)
  if (i < 0 || i === s.length - 1) return null
  const a = s[i]
  const b = s[i + 1]
  const merged: Take = { ...a, b: Math.max(a.b, b.b), text: [a.text, b.text].filter(Boolean).join(' '), reviewed: false }
  return s.filter((t) => t.id !== b.id).map((t) => (t.id === a.id ? merged : t))
}

export function splitAt(id: string, at: number, takes: Take[]): Take[] | null {
  const t = takes.find((x) => x.id === id)
  if (!t || at <= t.a + 0.05 || at >= t.b - 0.05) return null
  const left: Take = { ...t, b: round(at), reviewed: false }
  const right: Take = { id: newId(), a: round(at), b: t.b, text: '', reviewed: false }
  return sortTakes(takes.flatMap((x) => (x.id === id ? [left, right] : [x])))
}

export function suggestNext(takes: Take[], an: Analysis, duration: number): { a: number; b: number } {
  const last = Math.max(0, ...takes.map((t) => t.b))
  const blocks = speechBlocks(an)
  const idx = blocks.findIndex((bl) => bl.end > last + 0.05 && !takes.some((t) => t.a <= bl.start + 0.01 && t.b >= bl.end - 0.01))
  if (idx >= 0) {
    const bl = blocks[idx]
    const before = idx > 0 ? an.pauses[idx - 1] : null
    const after = idx < an.pauses.length ? an.pauses[idx] : null
    const a = Math.max(last, before ? bl.start - padFor(before) : Math.max(0, bl.start - 0.12))
    const b = after ? bl.end + padFor(after) : Math.min(duration, bl.end + 0.12)
    return { a: round(a), b: round(b) }
  }
  const a = Math.min(last, Math.max(0, duration - 2))
  return { a: round(a), b: round(Math.min(duration, a + 2)) }
}

export const takeLabel = (i: number) => `T${String(i + 1).padStart(2, '0')}`

export function slugify(s: string, words = 4): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, words)
    .join('-')
}

export function cleanToken(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

export interface NameParts {
  peca: string
  duracao: string
  index: number
  text: string
  versao: number
}

export function fileBase(p: NameParts): string {
  const parts = [takeLabel(p.index), cleanToken(p.peca), cleanToken(p.duracao)]
  const sl = slugify(p.text)
  if (sl) parts.push(sl)
  parts.push(`v${String(p.versao).padStart(2, '0')}`)
  return parts.filter(Boolean).join('_')
}

export function durationLabelFromName(name: string): string | null {
  const m = name.match(/(?:^|[_\-\s])(\d{1,3})\s?(?:s|seg|sec)(?=$|[_\-\s.])/i)
  return m ? `${parseInt(m[1], 10)}s` : null
}

export function durationLabelFromSeconds(sec: number): string {
  const common = [5, 6, 10, 15, 20, 30, 45, 60, 90, 120]
  const near = common.find((c) => Math.abs(c - sec) <= Math.max(0.6, c * 0.04))
  return `${near ?? Math.round(sec)}s`
}

export function pecaFromName(name: string): string {
  let stem = name.replace(/\.[^.]+$/, '')
  stem = stem.replace(/^[0-9a-f]{8}-/i, '')
  const m = stem.match(/^(.*?)[_\-\s]\d{1,3}\s?(?:s|seg|sec)(?:[_\-\s]|$)/i)
  let base = m ? m[1] : stem
  base = base.replace(/^loc[_\-\s]?\d+[_\-\s]?/i, '')
  return cleanToken(base) || 'PECA'
}
