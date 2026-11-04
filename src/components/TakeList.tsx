import { useEffect, useRef, useState } from 'react'
import { Check, Ear, Merge, Pause as PauseIcon, Play, Scissors, Trash2 } from 'lucide-react'
import { fileBase, sortTakes, takeLabel, type Take } from '../core/takes'
import { player } from '../core/player'
import { sources, useStore, type Version } from '../store'
import { ZoomTrack, previewEdge } from './ZoomTrack'
import { fmtSec } from './draw'

function usePlayer() {
  const [, force] = useState(0)
  useEffect(() => player.subscribe(() => force((n) => n + 1)), [])
  return player.state
}

function Status({ take }: { take: Take }) {
  const markReviewed = useStore((s) => s.markReviewed)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        markReviewed([take.id], !take.reviewed)
      }}
      title={take.reviewed ? 'Clique para voltar para a revisar' : 'Clique para marcar como revisado (R)'}
      aria-pressed={take.reviewed}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] transition-colors ${
        take.reviewed
          ? 'border-transparent bg-ok-soft text-ok hover:border-ok/40'
          : 'border-line-strong bg-panel-3 text-fg-2 hover:border-ok/60 hover:text-ok'
      }`}
      data-testid="status"
    >
      {take.reviewed ? (
        <>
          <Check size={13} aria-hidden /> Revisado
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-fg-3" aria-hidden /> A revisar
        </>
      )}
    </button>
  )
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [txt, setTxt] = useState(value.toFixed(3).replace('.', ','))
  useEffect(() => setTxt(value.toFixed(3).replace('.', ',')), [value])
  const apply = () => {
    const v = parseFloat(txt.replace(',', '.'))
    if (isNaN(v)) setTxt(value.toFixed(3).replace('.', ','))
    else if (Math.abs(v - value) > 0.0005) onCommit(v)
  }
  return (
    <label className="flex items-center gap-2 text-[12px] text-fg-2">
      {label}
      <input
        className="field w-[84px] font-mono text-[12px]"
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            apply()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        aria-label={`${label} em segundos`}
      />
    </label>
  )
}

function TakePanel({ version, take, index }: { version: Version; take: Take; index: number }) {
  const s = useStore()
  const dur = sources.get(version.id)!.audio.duration
  const textRef = useRef<HTMLInputElement>(null)
  const isLast = index === version.takes.length - 1
  return (
    <div className="border-b border-line bg-panel-2 px-4 pt-4 pb-4" data-testid="panel">
      <ZoomTrack version={version} take={take} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <TimeField
          label="Entrada"
          value={take.a}
          onCommit={(v) => s.patchTake(take.id, { a: Math.max(0, Math.min(v, take.b - 0.05)), reviewed: false })}
        />
        <TimeField
          label="Saída"
          value={take.b}
          onCommit={(v) => s.patchTake(take.id, { b: Math.min(dur, Math.max(v, take.a + 0.05)), reviewed: false })}
        />
        <span className="text-[12px] text-fg-2">
          Duração <span className="font-mono text-fg">{fmtSec(take.b - take.a, 2)}</span>
        </span>
        <span className="flex-1" />
        <button className="btn btn-sm" onClick={() => previewEdge(version, take, 'a')} title="Ouvir entrada (Shift+I)">
          <Ear size={14} aria-hidden /> Ouvir entrada
        </button>
        <button className="btn btn-sm" onClick={() => previewEdge(version, take, 'b')} title="Ouvir saída (Shift+O)">
          <Ear size={14} aria-hidden /> Ouvir saída
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={textRef}
          className="field min-w-[240px] flex-1"
          placeholder="Fala deste take (opcional, entra no nome do arquivo)"
          defaultValue={take.text}
          key={take.id + take.text}
          onFocus={() => s.commit()}
          onBlur={(e) => {
            if (e.target.value !== take.text) s.patchTake(take.id, { text: e.target.value }, { commit: false })
            else useStore.setState((st) => ({ past: st.past.slice(0, -1) }))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          aria-label="Fala deste take"
        />
        <button className="btn btn-sm" onClick={() => s.splitAtPlayhead(take.id)} title="Dividir no playhead (S)">
          <Scissors size={14} aria-hidden /> Dividir no playhead
        </button>
        {!isLast && (
          <button className="btn btn-sm" onClick={() => s.mergeNext(take.id)} title="Juntar com o próximo (J)">
            <Merge size={14} aria-hidden /> Juntar com o próximo
          </button>
        )}
        <button className="btn btn-sm btn-primary" onClick={() => s.approveAndNext()} title="Aprovar e ir para o próximo (Enter)">
          <Check size={14} aria-hidden /> Aprovar <kbd className="!border-white/30 !bg-white/10 !text-white">Enter</kbd>
        </button>
      </div>
      <div className="mt-2 font-mono text-[11px] text-fg-3" data-testid="filename">
        {fileBase({ peca: s.peca, duracao: version.label, index, text: take.text, versao: s.versao })}.wav
      </div>
    </div>
  )
}

export function TakeList({ version }: { version: Version }) {
  const s = useStore()
  const ps = usePlayer()
  const src = sources.get(version.id)!
  const dur = src.audio.duration
  const takes = sortTakes(version.takes)
  const visible = takes.filter((t) => !s.onlyPending || !t.reviewed || t.id === s.openId)
  const openRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    openRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [s.openId])

  if (!visible.length)
    return (
      <div className="rounded-lg border border-line bg-panel px-4 py-6 text-center text-fg-2">
        {takes.length ? 'Tudo revisado nesta duração.' : 'Nenhum take ainda. Clique em Novo take ou aperte N.'}
      </div>
    )

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel" data-testid="takes">
      {visible.map((t) => {
        const i = takes.indexOf(t)
        const open = t.id === s.openId
        const sel = !!s.selected[t.id]
        const playing = ps.playing && ps.takeId === t.id
        return (
          <div key={t.id} ref={open ? openRef : undefined}>
            <div
              data-testid="row"
              className={`flex min-h-[46px] cursor-pointer items-center gap-3 border-b border-line px-3 transition-colors ${
                open ? 'bg-panel-2' : sel ? 'bg-accent-soft' : 'hover:bg-panel-2'
              }`}
              onClick={() => {
                player.stop()
                s.setOpen(open ? null : t.id)
              }}
            >
              <input
                type="checkbox"
                className="chk"
                checked={sel}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => s.toggleSelect(t.id, (e.nativeEvent as MouseEvent).shiftKey)}
                aria-label={`Selecionar ${takeLabel(i)} para download`}
                title="Selecionar para download"
              />
              <span className="w-8 flex-none font-mono text-[12px] font-semibold">{takeLabel(i)}</span>
              <span className={`min-w-0 flex-1 truncate text-[13px] ${t.text ? '' : 'text-fg-3'}`}>
                {t.text || 'Sem fala'}
              </span>
              <Status take={t} />
              <span className="w-12 flex-none text-right font-mono text-[12px] text-fg-2">{fmtSec(t.b - t.a)}</span>
              <span className="relative h-1.5 w-16 flex-none rounded-full bg-panel-3" aria-hidden>
                <span
                  className="absolute top-0 h-full rounded-full bg-accent"
                  style={{ left: `${(t.a / dur) * 100}%`, width: `${Math.max(2, ((t.b - t.a) / dur) * 100)}%` }}
                />
              </span>
              <button
                className="btn btn-ghost btn-icon"
                aria-label={playing ? `Pausar ${takeLabel(i)}` : `Tocar ${takeLabel(i)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (playing) player.stop()
                  else player.play(version.id, src.audio, t.a, t.b, t.id)
                }}
              >
                {playing ? <PauseIcon size={15} /> : <Play size={15} />}
              </button>
              <button
                className="btn btn-ghost btn-icon"
                aria-label={`Excluir ${takeLabel(i)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  s.removeTake(t.id)
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
            {open && <TakePanel version={version} take={t} index={i} />}
          </div>
        )
      })}
    </div>
  )
}
