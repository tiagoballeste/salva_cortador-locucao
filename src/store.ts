import { create } from 'zustand'
import { analyze, mixMono, snapPoints, type Analysis, type Pause } from './core/analysis'
import { isWav, parseWav, type PcmAudio } from './core/wav'
import {
  durationLabelFromName, durationLabelFromSeconds, mergeWithNext, newId, pecaFromName, round, sortTakes, splitAt,
  suggestNext, takesFromAnalysis, togglePause, type Take,
} from './core/takes'
import { player } from './core/player'

export interface Source {
  audio: PcmAudio
  mono: Float32Array
  analysis: Analysis
  snaps: number[]
}

export const sources = new Map<string, Source>()

export interface Version {
  id: string
  label: string
  fileName: string
  takes: Take[]
}

type Snapshot = Record<string, Take[]>

export interface Toast {
  id: number
  msg: string
  undo?: boolean
}

interface State {
  versions: Version[]
  activeId: string | null
  openId: string | null
  selected: Record<string, true>
  lastClicked: string | null
  peca: string
  versao: number
  snap: boolean
  autoPreview: boolean
  onlyPending: boolean
  mono: boolean
  padBefore: number
  padAfter: number
  scope: 'active' | 'all'
  loading: string | null
  error: string | null
  toast: Toast | null
  help: boolean
  past: Snapshot[]
  future: Snapshot[]

  addFiles: (files: File[]) => Promise<void>
  setActive: (id: string) => void
  setOpen: (id: string | null) => void
  set: (p: Partial<State>) => void
  commit: () => void
  replaceTakes: (versionId: string, takes: Take[], opts?: { commit?: boolean }) => void
  patchTake: (id: string, patch: Partial<Take>, opts?: { commit?: boolean }) => void
  undo: () => void
  redo: () => void
  toggleSelect: (id: string, shift: boolean) => void
  selectAll: (on: boolean) => void
  removeTake: (id: string) => void
  addTake: () => void
  togglePause: (p: Pause) => void
  mergeNext: (id: string) => void
  splitAtPlayhead: (id: string) => void
  approveAndNext: () => void
  markReviewed: (ids: string[], value: boolean) => void
  renameVersion: (id: string, label: string) => void
  removeVersion: (id: string) => void
  showToast: (msg: string, undo?: boolean) => void
}

const snapshot = (versions: Version[]): Snapshot => Object.fromEntries(versions.map((v) => [v.id, v.takes]))

const restore = (versions: Version[], s: Snapshot) =>
  versions.map((v) => (s[v.id] ? { ...v, takes: s[v.id] } : v))

export const activeVersion = (s: Pick<State, 'versions' | 'activeId'>) =>
  s.versions.find((v) => v.id === s.activeId) ?? null

export const findTake = (s: Pick<State, 'versions'>, id: string | null) => {
  if (!id) return null
  for (const v of s.versions) {
    const t = v.takes.find((x) => x.id === id)
    if (t) return { version: v, take: t }
  }
  return null
}

async function decode(file: File): Promise<PcmAudio> {
  const buf = await file.arrayBuffer()
  if (isWav(buf)) {
    try {
      return parseWav(buf)
    } catch {
      /* fall back to the browser decoder */
    }
  }
  const ctx = new OfflineAudioContext(1, 1, 48000)
  const ab = await ctx.decodeAudioData(buf.slice(0))
  const channels = Array.from({ length: ab.numberOfChannels }, (_, i) => new Float32Array(ab.getChannelData(i)))
  return { sampleRate: ab.sampleRate, bitDepth: 24, format: 'int', channels, length: ab.length, duration: ab.duration }
}

let toastId = 0

export const useStore = create<State>((set, get) => ({
  versions: [],
  activeId: null,
  openId: null,
  selected: {},
  lastClicked: null,
  peca: '',
  versao: 1,
  snap: true,
  autoPreview: true,
  onlyPending: false,
  mono: true,
  padBefore: 0,
  padAfter: 0,
  scope: 'all',
  loading: null,
  error: null,
  toast: null,
  help: false,
  past: [],
  future: [],

  set: (p) => set(p),

  addFiles: async (files) => {
    const audioFiles = files.filter((f) => /\.(wav|wave|mp3|m4a|aac|aif|aiff|flac|ogg)$/i.test(f.name) || f.type.startsWith('audio/'))
    if (!audioFiles.length) {
      set({ error: 'Nenhum arquivo de áudio encontrado. Use WAV, MP3 ou M4A.' })
      return
    }
    set({ error: null })
    const added: Version[] = []
    for (const f of audioFiles) {
      set({ loading: `Lendo ${f.name}…` })
      try {
        const audio = await decode(f)
        await new Promise((r) => setTimeout(r, 0))
        const analysis = analyze(audio.channels, audio.sampleRate)
        const id = newId()
        sources.set(id, { audio, mono: mixMono(audio.channels), analysis, snaps: snapPoints(analysis, audio.duration) })
        const existing = [...get().versions, ...added].map((v) => v.label)
        let label = durationLabelFromName(f.name) ?? durationLabelFromSeconds(audio.duration)
        if (existing.includes(label)) {
          let k = 2
          while (existing.includes(`${label} (${k})`)) k++
          label = `${label} (${k})`
        }
        added.push({ id, label, fileName: f.name, takes: takesFromAnalysis(analysis, audio.duration) })
      } catch (e) {
        set({ error: `Não consegui ler ${f.name}. ${(e as Error).message}` })
      }
    }
    if (!added.length) {
      set({ loading: null })
      return
    }
    const versions = [...get().versions, ...added].sort((a, b) => (parseFloat(b.label) || 0) - (parseFloat(a.label) || 0))
    set({
      versions,
      activeId: get().activeId ?? added[0].id,
      openId: get().openId,
      peca: get().peca || pecaFromName(added[0].fileName),
      loading: null,
    })
    if (!get().openId) {
      const v = activeVersion(get())
      if (v) set({ openId: sortTakes(v.takes)[0]?.id ?? null })
    }
  },

  setActive: (id) => {
    player.stop()
    const v = get().versions.find((x) => x.id === id)
    set({ activeId: id, openId: v ? sortTakes(v.takes)[0]?.id ?? null : null })
  },

  setOpen: (id) => set({ openId: id }),

  commit: () => set((s) => ({ past: [...s.past.slice(-80), snapshot(s.versions)], future: [] })),

  replaceTakes: (versionId, takes, opts) => {
    if (opts?.commit !== false) get().commit()
    set((s) => ({ versions: s.versions.map((v) => (v.id === versionId ? { ...v, takes: sortTakes(takes) } : v)) }))
  },

  patchTake: (id, patch, opts) => {
    const f = findTake(get(), id)
    if (!f) return
    get().replaceTakes(
      f.version.id,
      f.version.takes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      opts,
    )
  },

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1]
      if (!prev) return {}
      return { versions: restore(s.versions, prev), past: s.past.slice(0, -1), future: [snapshot(s.versions), ...s.future] }
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0]
      if (!next) return {}
      return { versions: restore(s.versions, next), future: s.future.slice(1), past: [...s.past, snapshot(s.versions)] }
    }),

  toggleSelect: (id, shift) => {
    const s = get()
    const v = activeVersion(s)
    if (!v) return
    const ids = sortTakes(v.takes).map((t) => t.id)
    const on = !s.selected[id]
    const sel = { ...s.selected }
    const apply = (k: string) => (on ? (sel[k] = true) : delete sel[k])
    if (shift && s.lastClicked && ids.includes(s.lastClicked)) {
      const [i, j] = [ids.indexOf(s.lastClicked), ids.indexOf(id)].sort((x, y) => x - y)
      ids.slice(i, j + 1).forEach(apply)
    } else apply(id)
    set({ selected: sel, lastClicked: id })
  },

  selectAll: (on) => {
    const v = activeVersion(get())
    if (!v) return
    const sel = { ...get().selected }
    v.takes.forEach((t) => (on ? (sel[t.id] = true) : delete sel[t.id]))
    set({ selected: sel })
  },

  removeTake: (id) => {
    const f = findTake(get(), id)
    if (!f) return
    const sorted = sortTakes(f.version.takes)
    const i = sorted.findIndex((t) => t.id === id)
    const rest = sorted.filter((t) => t.id !== id)
    get().replaceTakes(f.version.id, rest)
    const sel = { ...get().selected }
    delete sel[id]
    set({ selected: sel, openId: get().openId === id ? rest[Math.min(i, rest.length - 1)]?.id ?? null : get().openId })
    get().showToast(`Take T${String(i + 1).padStart(2, '0')} excluído`, true)
  },

  addTake: () => {
    const v = activeVersion(get())
    if (!v) return
    const src = sources.get(v.id)!
    const { a, b } = suggestNext(v.takes, src.analysis, src.audio.duration)
    const t: Take = { id: newId(), a, b, text: '', reviewed: false }
    get().replaceTakes(v.id, [...v.takes, t])
    set({ openId: t.id })
  },

  togglePause: (p) => {
    const v = activeVersion(get())
    if (!v) return
    const next = togglePause(p, v.takes)
    if (!next) return
    const before = v.takes.length
    get().replaceTakes(v.id, next)
    const mid = (p.start + p.end) / 2
    const host = next.find((t) => t.a <= mid && t.b >= mid) ?? next.find((t) => t.b >= mid - 0.2)
    if (host) set({ openId: host.id })
    get().showToast(next.length < before ? 'Pausa virou respiro, takes juntados' : 'Pausa virou corte, take dividido', true)
  },

  mergeNext: (id) => {
    const f = findTake(get(), id)
    if (!f) return
    const next = mergeWithNext(id, f.version.takes)
    if (next) {
      get().replaceTakes(f.version.id, next)
      get().showToast('Takes juntados', true)
    }
  },

  splitAtPlayhead: (id) => {
    const f = findTake(get(), id)
    if (!f) return
    const ps = player.state
    const at = ps.versionId === f.version.id ? ps.pos : (f.take.a + f.take.b) / 2
    const src = sources.get(f.version.id)!
    const snapped = src.snaps.reduce((best, p) => (Math.abs(p - at) < Math.abs(best - at) && Math.abs(p - at) < 0.25 ? p : best), at)
    const next = splitAt(id, round(snapped), f.version.takes)
    if (next) {
      get().replaceTakes(f.version.id, next)
      get().showToast('Take dividido', true)
    }
  },

  approveAndNext: () => {
    const s = get()
    const v = activeVersion(s)
    if (!v || !s.openId) return
    s.patchTake(s.openId, { reviewed: true })
    const sorted = sortTakes(get().versions.find((x) => x.id === v.id)!.takes)
    const i = sorted.findIndex((t) => t.id === s.openId)
    const nextPending = sorted.slice(i + 1).find((t) => !t.reviewed) ?? sorted.find((t) => !t.reviewed)
    set({ openId: nextPending?.id ?? s.openId })
  },

  markReviewed: (ids, value) => {
    const set_ = new Set(ids)
    get().commit()
    set((st) => ({
      versions: st.versions.map((v) =>
        v.takes.some((t) => set_.has(t.id)) ? { ...v, takes: v.takes.map((t) => (set_.has(t.id) ? { ...t, reviewed: value } : t)) } : v,
      ),
    }))
  },

  renameVersion: (id, label) => set((s) => ({ versions: s.versions.map((v) => (v.id === id ? { ...v, label } : v)) })),

  removeVersion: (id) => {
    player.stop()
    player.forget(id)
    sources.delete(id)
    set((s) => {
      const versions = s.versions.filter((v) => v.id !== id)
      const activeId = s.activeId === id ? versions[0]?.id ?? null : s.activeId
      const av = versions.find((v) => v.id === activeId)
      return {
        versions,
        activeId,
        openId: s.activeId === id ? (av ? sortTakes(av.takes)[0]?.id ?? null : null) : s.openId,
        past: [],
        future: [],
      }
    })
  },

  showToast: (msg, undo) => set({ toast: { id: ++toastId, msg, undo } }),
}))
