import { useEffect, useRef, useState } from 'react'
import { AudioLines, Check, Ear, LogOut, Keyboard, Magnet, Pause as PauseIcon, Play, Plus, Undo2, Upload, X } from 'lucide-react'
import { sortTakes } from './core/takes'
import { player } from './core/player'
import { activeVersion, findTake, sources, useStore, type Version } from './store'
import { MasterTrack } from './components/MasterTrack'
import { TakeList } from './components/TakeList'
import { Footer } from './components/Footer'
import { previewEdge } from './components/ZoomTrack'
import { fmtSec, fmtTime } from './components/draw'

function pickFiles(onFiles: (f: File[]) => void) {
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.multiple = true
  inp.accept = 'audio/*,.wav,.mp3,.m4a,.aif,.aiff'
  inp.onchange = () => onFiles(Array.from(inp.files ?? []))
  inp.click()
}

function useDrop(onFiles: (f: File[]) => void) {
  const [over, setOver] = useState(false)
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        setOver(true)
      }
    }
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setOver(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) onFiles(files)
    }
    window.addEventListener('dragover', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [onFiles])
  return over
}

function Empty() {
  const s = useStore()
  return (
    <div className="mx-auto flex max-w-[720px] flex-col items-center px-6 pt-24 text-center">
      <button
        data-testid="dropzone"
        onClick={() => pickFiles(s.addFiles)}
        className="flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-panel px-8 py-16 transition-colors hover:border-accent hover:bg-panel-2"
      >
        <Upload size={28} className="text-accent" aria-hidden />
        <span className="text-[17px] font-medium">Solte as locuções aqui</span>
        <span className="text-fg-2">WAV, MP3 ou M4A. Pode soltar a 30s, a 15s e a 6s juntas.</span>
        <span className="mt-2 text-[12px] text-fg-3">O áudio não sai do seu computador.</span>
      </button>
      {s.loading && <p className="mt-4 text-fg-2">{s.loading}</p>}
      {s.error && <p className="mt-4 text-danger">{s.error}</p>}
    </div>
  )
}

function Tabs() {
  const s = useStore()
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Durações">
      {s.versions.map((v) => {
        const pending = v.takes.filter((t) => !t.reviewed).length
        const active = v.id === s.activeId
        return (
          <div
            key={v.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            data-testid="tab"
            onClick={() => s.setActive(v.id)}
            onKeyDown={(e) => e.key === 'Enter' && s.setActive(v.id)}
            onDoubleClick={() => setEditing(v.id)}
            title={`${v.fileName} · clique duas vezes para renomear`}
            className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 ${
              active ? 'border-accent-strong bg-accent-soft' : 'border-line bg-panel hover:bg-panel-2'
            }`}
          >
            {editing === v.id ? (
              <input
                autoFocus
                className="field !h-6 w-20"
                defaultValue={v.label}
                onBlur={(e) => {
                  s.renameVersion(v.id, e.target.value.trim() || v.label)
                  setEditing(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <span className="font-semibold">{v.label}</span>
            )}
            <span className="text-[12px] text-fg-2">
              {v.takes.length} takes
              {pending ? ` · ${pending} a revisar` : ' · revisado'}
            </span>
            {removing === v.id ? (
              <span className="flex items-center gap-1 text-[12px]" onClick={(e) => e.stopPropagation()}>
                Remover?
                <button className="btn btn-sm !h-6 !px-2" onClick={() => s.removeVersion(v.id)}>
                  Sim
                </button>
                <button className="btn btn-ghost btn-sm !h-6 !px-2" onClick={() => setRemoving(null)}>
                  Não
                </button>
              </span>
            ) : (
              <button
                className="rounded p-0.5 text-fg-3 opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100"
                aria-label={`Remover a duração ${v.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setRemoving(v.id)
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )
      })}
      <button className="btn btn-ghost btn-sm" onClick={() => pickFiles(s.addFiles)}>
        <Plus size={14} aria-hidden /> Duração
      </button>
    </div>
  )
}

function UserBadge() {
  const [who, setWho] = useState<{ email: string } | null>(null)
  useEffect(() => {
    if (!/^https?:$/.test(location.protocol)) return
    fetch('/cdn-cgi/access/get-identity', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.email === 'string') setWho({ email: j.email })
      })
      .catch(() => {})
  }, [])
  if (!who) return null
  return (
    <div className="flex items-center gap-2 text-[12px] text-fg-2" data-testid="user">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent" aria-hidden>
        {who.email[0]?.toUpperCase()}
      </span>
      <span className="max-w-[200px] truncate" title={who.email}>
        {who.email}
      </span>
      <a className="btn btn-ghost btn-sm" href="/cdn-cgi/access/logout" title="Sair da ferramenta">
        <LogOut size={14} aria-hidden /> Sair
      </a>
    </div>
  )
}

export function toggleFull(v: Version) {
  const src = sources.get(v.id)!
  const ps = player.state
  const dur = src.audio.duration
  if (ps.playing && ps.takeId === null && ps.versionId === v.id) {
    player.stop()
    return
  }
  const from = ps.versionId === v.id && ps.pos > 0 && ps.pos < dur - 0.05 ? ps.pos : 0
  player.play(v.id, src.audio, from, dur, null)
}

function Transport({ version }: { version: Version }) {
  const [, force] = useState(0)
  useEffect(() => player.subscribe(() => force((n) => n + 1)), [])
  const ps = player.state
  const dur = sources.get(version.id)!.audio.duration
  const playingFull = ps.playing && ps.takeId === null && ps.versionId === version.id
  const pos = ps.versionId === version.id ? ps.pos : 0
  return (
    <div className="flex items-center gap-2.5">
      <button
        className={`btn btn-icon !h-8 !w-8 !rounded-full ${playingFull ? 'on' : ''}`}
        onClick={() => toggleFull(version)}
        aria-label={playingFull ? 'Pausar a locução completa' : 'Tocar a locução completa'}
        title="Tocar a locução completa (Shift+Espaço)"
        data-testid="play-full"
      >
        {playingFull ? <PauseIcon size={15} /> : <Play size={15} className="translate-x-[1px]" />}
      </button>
      <span className="font-medium text-fg">Locução completa</span>
      <span className="font-mono text-[12px] text-fg-2" data-testid="clock">
        {fmtTime(pos)} / {fmtTime(dur)}
      </span>
    </div>
  )
}

function Toolbar({ version }: { version: Version }) {
  const s = useStore()
  const ids = version.takes.map((t) => t.id)
  const nSel = ids.filter((id) => s.selected[id]).length
  const pending = version.takes.filter((t) => !t.reviewed).length
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = nSel > 0 && nSel < ids.length
  })
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 pl-3 text-[13px]">
        <input
          ref={ref}
          type="checkbox"
          className="chk"
          checked={nSel > 0 && nSel === ids.length}
          onChange={() => s.selectAll(nSel !== ids.length)}
          aria-label="Selecionar todos os takes"
        />
        Todos
      </label>
      <span className="flex-1 text-[13px] text-fg-2" data-testid="summary">
        {version.takes.length} takes · {pending} a revisar
      </span>
      {nSel > 0 && (
        <button
          className="btn btn-sm"
          onClick={() => s.markReviewed(ids.filter((id) => s.selected[id]), true)}
          data-testid="mark-selected"
        >
          <Check size={14} aria-hidden /> Marcar selecionados como revisados ({nSel})
        </button>
      )}
      <button className={`btn btn-sm ${s.onlyPending ? 'on' : ''}`} onClick={() => s.set({ onlyPending: !s.onlyPending })}>
        Só a revisar
      </button>
      <button
        className={`btn btn-sm ${s.autoPreview ? 'on' : ''}`}
        onClick={() => s.set({ autoPreview: !s.autoPreview })}
        title="Toca o trecho do corte ao soltar a alça"
      >
        <Ear size={14} aria-hidden /> Ouvir ao soltar
      </button>
      <button className={`btn btn-sm ${s.snap ? 'on' : ''}`} onClick={() => s.set({ snap: !s.snap })} title="Segure Alt para desligar enquanto arrasta">
        <Magnet size={14} aria-hidden /> Ímã
      </button>
    </div>
  )
}

function Toast() {
  const t = useStore((s) => s.toast)
  const undo = useStore((s) => s.undo)
  useEffect(() => {
    if (!t) return
    const id = setTimeout(() => useStore.setState((s) => (s.toast?.id === t.id ? { toast: null } : {})), 5000)
    return () => clearTimeout(id)
  }, [t])
  if (!t) return null
  return (
    <div className="fixed top-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-panel-3 px-4 py-2 text-[13px]" role="status">
      {t.msg}
      {t.undo && (
        <button
          className="btn btn-ghost btn-sm !text-accent"
          onClick={() => {
            undo()
            useStore.setState({ toast: null })
          }}
        >
          <Undo2 size={14} aria-hidden /> Desfazer
        </button>
      )}
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Espaço', 'Toca ou pausa o take aberto'],
  ['Shift+Espaço', 'Toca ou pausa a locução completa'],
  ['↑ ↓', 'Troca de take'],
  ['Enter', 'Aprova e vai para o próximo'],
  ['R', 'Marca ou desmarca como revisado'],
  ['X', 'Seleciona para download'],
  ['I / O', 'Entrada ou saída no playhead'],
  ['Shift+I / Shift+O', 'Ouve a entrada ou a saída'],
  ['S', 'Divide no playhead'],
  ['J', 'Junta com o próximo'],
  ['N', 'Novo take'],
  ['Delete', 'Exclui o take'],
  ['Cmd+Z / Shift+Cmd+Z', 'Desfaz e refaz'],
  ['Alt (arrastando)', 'Desliga o ímã'],
  ['?', 'Mostra ou esconde esta lista'],
]

function Help() {
  const s = useStore()
  if (!s.help) return null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={() => s.set({ help: false })}>
      <div className="w-[420px] rounded-xl border border-line-strong bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[15px] font-medium">Atalhos</span>
          <button className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={() => s.set({ help: false })}>
            <X size={15} />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd className="text-fg-2">{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox')
      if (typing) return
      const s = useStore.getState()
      const v = activeVersion(s)
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod) return
      if (e.key === '?') {
        s.set({ help: !s.help })
        return
      }
      if (e.key === 'Escape') {
        s.set({ help: false })
        return
      }
      if (!v) return
      const src = sources.get(v.id)!
      const sorted = sortTakes(v.takes)
      const cur = findTake(s, s.openId)?.take ?? null
      const k = e.key.toLowerCase()
      if (e.key === ' ' && e.shiftKey) {
        e.preventDefault()
        toggleFull(v)
        return
      }
      if (e.key === ' ') {
        if (el.tagName === 'BUTTON') return
        e.preventDefault()
        if (!cur) {
          toggleFull(v)
          return
        }
        if (player.state.playing) player.stop()
        else if (cur) player.play(v.id, src.audio, cur.a, cur.b, cur.id)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const i = cur ? sorted.findIndex((t) => t.id === cur.id) : -1
        const j = Math.max(0, Math.min(sorted.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
        if (sorted[j]) {
          player.stop()
          s.setOpen(sorted[j].id)
        }
        return
      }
      if (k === 'n') {
        s.addTake()
        return
      }
      if (!cur) return
      if (e.key === 'Enter') {
        if (el.tagName === 'BUTTON') return
        e.preventDefault()
        s.approveAndNext()
      } else if (k === 'x') s.toggleSelect(cur.id, false)
      else if (k === 'r') s.markReviewed([cur.id], !cur.reviewed)
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        s.removeTake(cur.id)
      } else if (k === 'j') s.mergeNext(cur.id)
      else if (k === 's') s.splitAtPlayhead(cur.id)
      else if (k === 'i' || k === 'o') {
        if (e.shiftKey) {
          previewEdge(v, cur, k === 'i' ? 'a' : 'b')
          return
        }
        const ps = player.state
        if (ps.versionId !== v.id) return
        if (k === 'i' && ps.pos < cur.b - 0.05) s.patchTake(cur.id, { a: ps.pos, reviewed: false })
        if (k === 'o' && ps.pos > cur.a + 0.05) s.patchTake(cur.id, { b: ps.pos, reviewed: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const s = useStore()
  const over = useDrop(s.addFiles)
  useShortcuts()
  const v = activeVersion(s)
  const src = v ? sources.get(v.id) : null

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <AudioLines size={18} className="text-accent" aria-hidden />
            <span className="font-semibold">Cortador de locução</span>
            <span className="rounded bg-panel-3 px-1.5 py-0.5 text-[11px] text-fg-2">Salva</span>
          </div>
          <span className="flex-1" />
          {s.versions.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-[12px] text-fg-2">
                Peça
                <input
                  className="field w-[260px] font-mono text-[12px]"
                  value={s.peca}
                  onChange={(e) => s.set({ peca: e.target.value })}
                  data-testid="peca"
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-fg-2">
                Versão
                <input
                  className="field w-[64px] font-mono text-[12px]"
                  type="number"
                  min={1}
                  max={99}
                  value={s.versao}
                  onChange={(e) => s.set({ versao: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                />
              </label>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => s.set({ help: true })}>
            <Keyboard size={14} aria-hidden /> Atalhos <kbd>?</kbd>
          </button>
          <UserBadge />
        </div>
      </header>

      {!v || !src ? (
        <Empty />
      ) : (
        <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pt-5 pb-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs />
            <span className="text-[12px] text-fg-3" title={v.fileName}>
              {src.audio.sampleRate / 1000} kHz · {src.audio.bitDepth} bits · {src.audio.channels.length === 1 ? 'mono' : 'estéreo'} · {fmtSec(src.audio.duration, 2)}
            </span>
          </div>
          {s.loading && <p className="mb-3 text-fg-2">{s.loading}</p>}
          {s.error && <p className="mb-3 text-danger">{s.error}</p>}
          <div className="mb-2 flex items-center justify-between text-[12px] text-fg-2">
            <Transport version={v} />
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rotate-45 bg-accent" aria-hidden /> corte
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-fg-2" aria-hidden /> respiro
              </span>
              <span>Clique numa pausa para alternar</span>
            </span>
          </div>
          <MasterTrack version={v} />
          <div className="mt-5 mb-2">
            <Toolbar version={v} />
          </div>
          <TakeList version={v} />
          <button className="btn mt-3 w-full" onClick={() => s.addTake()}>
            <Plus size={15} aria-hidden /> Novo take <kbd>N</kbd>
          </button>
        </main>
      )}
      {v && <Footer />}
      <Toast />
      <Help />
      {over && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent-strong/20 backdrop-blur-sm">
          <div className="rounded-xl border border-accent bg-panel px-6 py-4 text-[15px]">Solte para adicionar as locuções</div>
        </div>
      )}
    </div>
  )
}
