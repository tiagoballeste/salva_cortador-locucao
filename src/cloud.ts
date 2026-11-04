import { api, ApiError, type CutState, type CutSummary } from './api'
import { analyze, mixMono, snapPoints } from './core/analysis'
import { player } from './core/player'
import { sortTakes } from './core/takes'
import { encodeWav, isDualMono } from './core/wav'
import { decode, hooks, sources, useStore, type Version } from './store'

const online = () => useStore.getState().auth.mode === 'user'

export function summaryOf(versions: Version[]): CutSummary {
  return {
    durations: versions.map((v) => v.label),
    takes: versions.reduce((n, v) => n + v.takes.length, 0),
    pending: versions.reduce((n, v) => n + v.takes.filter((t) => !t.reviewed).length, 0),
  }
}

function stateOf(): CutState | null {
  const s = useStore.getState()
  if (s.versions.some((v) => !v.audioKey)) return null
  return {
    versions: s.versions.map((v) => ({ id: v.id, label: v.label, fileName: v.fileName, audioKey: v.audioKey!, takes: v.takes })),
    versao: s.versao,
    mono: s.mono,
    handles: s.handles,
    format: s.format,
    aspect: s.aspect,
  }
}

function audioForStorage(versionId: string): Uint8Array {
  const { audio } = sources.get(versionId)!
  const channels = isDualMono(audio.channels) ? [audio.channels[0]] : audio.channels
  return encodeWav(channels, audio.sampleRate, audio.bitDepth, audio.format)
}

let creating: Promise<string> | null = null

async function ensureCut(): Promise<string> {
  const s = useStore.getState()
  if (s.cutId) return s.cutId
  creating ??= api
    .createCut(s.peca, summaryOf(s.versions), { versions: [], versao: s.versao, mono: s.mono, handles: s.handles })
    .then((r) => {
      useStore.setState({ cutId: r.id })
      return r.id
    })
    .finally(() => {
      creating = null
    })
  return creating
}

hooks.afterAdd = async (added) => {
  if (!online()) return
  const st = useStore.getState()
  st.set({ saveStatus: 'saving' })
  try {
    const id = await ensureCut()
    for (const v of added) {
      st.set({ loading: `Guardando ${v.label} em Meus cortes…` })
      const { key } = await api.uploadAudio(id, audioForStorage(v.id))
      useStore.setState((s) => ({ versions: s.versions.map((x) => (x.id === v.id ? { ...x, audioKey: key } : x)) }))
    }
    useStore.setState({ loading: null })
    await saveNow()
  } catch (e) {
    useStore.setState({ loading: null, saveStatus: 'error' })
    st.showToast(`Não consegui guardar a locução: ${(e as Error).message}`)
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
let inflight = false
let again = false

export async function saveNow() {
  if (!online()) return
  const s = useStore.getState()
  const state = stateOf()
  if (!s.cutId || !state) return
  if (inflight) {
    again = true
    return
  }
  inflight = true
  useStore.setState({ saveStatus: 'saving' })
  try {
    await api.saveCut(s.cutId, s.peca, summaryOf(s.versions), state)
    useStore.setState({ saveStatus: 'saved' })
  } catch (e) {
    useStore.setState({ saveStatus: 'error' })
    if (e instanceof ApiError && e.status === 401) location.reload()
  } finally {
    inflight = false
    if (again) {
      again = false
      void saveNow()
    }
  }
}

useStore.subscribe((s, prev) => {
  if (!online() || !s.cutId) return
  if (s.versions === prev.versions && s.peca === prev.peca && s.versao === prev.versao && s.mono === prev.mono && s.handles === prev.handles && s.format === prev.format && s.aspect === prev.aspect)
    return
  if (s.cutId !== prev.cutId) return
  useStore.setState({ saveStatus: 'saving' })
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void saveNow(), 1200)
})

window.addEventListener('beforeunload', (e) => {
  if (useStore.getState().saveStatus === 'saving') e.preventDefault()
})

function resetEditor() {
  player.stop()
  for (const v of useStore.getState().versions) {
    player.forget(v.id)
    sources.delete(v.id)
  }
  useStore.setState({
    versions: [],
    activeId: null,
    openId: null,
    selected: {},
    lastClicked: null,
    peca: '',
    versao: 1,
    past: [],
    future: [],
    cutId: null,
    saveStatus: 'idle',
    error: null,
    loading: null,
  })
}

export async function goHome() {
  if (timer) {
    clearTimeout(timer)
    timer = null
    await saveNow()
  }
  resetEditor()
  useStore.setState({ view: 'home' })
}

export function newCut() {
  resetEditor()
  useStore.setState({ view: 'editor' })
}

export async function openCut(id: string) {
  resetEditor()
  useStore.setState({ view: 'editor', loading: 'Abrindo o corte…' })
  try {
    const cut = await api.getCut(id)
    const versions: Version[] = []
    for (const v of cut.state.versions) {
      useStore.setState({ loading: `Baixando a locução de ${v.label}…` })
      const audio = await decode(await api.getAudio(id, v.audioKey))
      const analysis = analyze(audio.channels, audio.sampleRate)
      sources.set(v.id, { audio, mono: mixMono(audio.channels), analysis, snaps: snapPoints(analysis, audio.duration) })
      versions.push({ id: v.id, label: v.label, fileName: v.fileName, takes: v.takes, audioKey: v.audioKey })
    }
    const first = versions[0]
    useStore.setState({
      cutId: id,
      versions,
      peca: cut.peca,
      versao: cut.state.versao ?? 1,
      mono: cut.state.mono ?? true,
      handles: cut.state.handles ?? false,
      format: cut.state.format ?? 'wav',
      aspect: cut.state.aspect ?? '9:16',
      activeId: first?.id ?? null,
      openId: first ? sortTakes(first.takes)[0]?.id ?? null : null,
      saveStatus: 'saved',
      loading: null,
    })
  } catch (e) {
    resetEditor()
    useStore.setState({ view: 'home' })
    useStore.getState().showToast(`Não consegui abrir o corte: ${(e as Error).message}`)
  }
}

export async function markDownloaded() {
  const id = useStore.getState().cutId
  if (online() && id) await api.markDownloaded(id).catch(() => {})
}
