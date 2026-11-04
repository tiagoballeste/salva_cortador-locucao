import { useState } from 'react'
import { ChevronUp, Download, Settings2, TriangleAlert } from 'lucide-react'
import { planExport, renderWav, sheet, zipFiles, type ExportJob, type ExportOptions } from '../core/exporter'
import { cleanToken } from '../core/takes'
import { activeVersion, sources, useStore } from '../store'

type Downloads = { save: (r: { filename: string; data: Blob | Uint8Array }) => Promise<unknown> }
let dlCap: Promise<Downloads | null> | null = null
const claudeRuntime = () => (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude

function downloadsCap(): Promise<Downloads | null> {
  const c = claudeRuntime()
  if (!c?.use) return Promise.resolve(null)
  dlCap ??= c.use('downloads').then((x) => (x as Downloads | null) ?? null).catch(() => null)
  return dlCap
}

const ALLOWED = /\.(zip|csv|mp4|txt|json)$/i

async function save(data: Uint8Array, name: string, type: string): Promise<boolean> {
  if (claudeRuntime()?.use) {
    const cap = await downloadsCap()
    if (!cap) throw new Error('Download indisponível nesta visualização.')
    let filename = name
    let payload = data
    if (!ALLOWED.test(name)) {
      payload = zipFiles({ [name]: data })
      filename = name.replace(/\.[^.]+$/, '') + '.zip'
    }
    try {
      await cap.save({ filename, data: new Blob([payload as Uint8Array<ArrayBuffer>], { type: 'application/zip' }) })
      return true
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'declined') return false
      throw new Error((e as { message?: string }).message ?? 'Não foi possível baixar.')
    }
  }
  const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
}

export function Footer() {
  const s = useStore()
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null)
  const [showOpts, setShowOpts] = useState(false)
  const [confirm, setConfirm] = useState<{ jobs: ExportJob[]; pending: number } | null>(null)
  const v = activeVersion(s)
  if (!v) return null
  const multi = s.versions.length > 1
  const scopeVersions = s.scope === 'all' || !multi ? s.versions : [v]
  const allIds = new Set(scopeVersions.flatMap((x) => x.takes.map((t) => t.id)))
  const selIds = Object.keys(s.selected).filter((id) => allIds.has(id))
  const selVersions = scopeVersions.filter((x) => x.takes.some((t) => s.selected[t.id])).length
  const total = allIds.size
  const opts: ExportOptions = {
    peca: s.peca,
    versao: s.versao,
    mono: s.mono,
    padBefore: s.padBefore,
    padAfter: s.padAfter,
    folders: false,
  }

  const prepare = (onlySelected: boolean) => {
    const sel = onlySelected ? new Set(selIds) : null
    const exportVersions = scopeVersions
      .filter((x) => !sel || x.takes.some((t) => sel.has(t.id)))
      .map((x) => ({ label: x.label, audio: sources.get(x.id)!.audio, takes: x.takes }))
    opts.folders = exportVersions.length > 1
    const jobs = planExport(exportVersions, sel, opts)
    const pending = jobs.filter((j) => !j.take.reviewed).length
    if (pending) setConfirm({ jobs, pending })
    else void run(jobs)
  }

  const run = async (jobs: ExportJob[]) => {
    setConfirm(null)
    if (!jobs.length) return
    if (jobs.length === 1) {
      try {
        if (await save(renderWav(jobs[0], opts), `${jobs[0].base}.wav`, 'audio/wav')) s.showToast('1 arquivo baixado')
      } catch (e) {
        s.showToast((e as Error).message)
      }
      return
    }
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < jobs.length; i++) {
      setProgress({ i: i + 1, n: jobs.length })
      await new Promise((r) => setTimeout(r, 0))
      files[`${jobs[i].path}.wav`] = renderWav(jobs[i], opts)
    }
    files['planilha_de_takes.csv'] = new TextEncoder().encode(sheet(jobs, opts))
    const zip = zipFiles(files)
    const labels = [...new Set(jobs.map((j) => j.version.label))]
    const scopeName = labels.length > 1 ? 'todas' : cleanToken(labels[0])
    setProgress(null)
    try {
      const ok = await save(zip, `${cleanToken(s.peca) || 'takes'}_${scopeName}_v${String(s.versao).padStart(2, '0')}.zip`, 'application/zip')
      if (ok) s.showToast(`${jobs.length} arquivos no zip, com a planilha de takes`)
    } catch (e) {
      s.showToast((e as Error).message)
    }
  }

  return (
    <footer className="sticky bottom-0 z-20 border-t border-line bg-bg/95 backdrop-blur" data-testid="footer">
      {confirm && (
        <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-6 pt-3 text-[13px]">
          <TriangleAlert size={16} className="text-warn" aria-hidden />
          <span>
            {confirm.pending} {confirm.pending > 1 ? 'takes ainda estão' : 'take ainda está'} como "A revisar". Para revisar um take, clique no selo dele ou abra o take e aperte Enter.
          </span>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              s.markReviewed(confirm.jobs.map((j) => j.take.id), true)
              void run(confirm.jobs.map((j) => ({ ...j, take: { ...j.take, reviewed: true } })))
            }}
            data-testid="mark-and-download"
          >
            Marcar como revisados e baixar
          </button>
          <button className="btn btn-sm" onClick={() => void run(confirm.jobs)}>
            Baixar sem marcar
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>
            Cancelar
          </button>
        </div>
      )}
      {showOpts && (
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 border-b border-line px-6 py-3 text-[12px] text-fg-2" data-testid="export-opts">
          <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
            <button className={`btn btn-sm !h-6 !border-0 ${s.mono ? 'on' : 'btn-ghost'}`} onClick={() => s.set({ mono: true })}>
              Mono
            </button>
            <button className={`btn btn-sm !h-6 !border-0 ${!s.mono ? 'on' : 'btn-ghost'}`} onClick={() => s.set({ mono: false })}>
              Canais originais
            </button>
          </div>
          {multi && (
            <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
              <button className={`btn btn-sm !h-6 !border-0 ${s.scope === 'active' ? 'on' : 'btn-ghost'}`} onClick={() => s.set({ scope: 'active' })}>
                Esta duração
              </button>
              <button className={`btn btn-sm !h-6 !border-0 ${s.scope === 'all' ? 'on' : 'btn-ghost'}`} onClick={() => s.set({ scope: 'all' })}>
                Todas as durações
              </button>
            </div>
          )}
          <label className="flex items-center gap-1.5">
            Respiro antes
            <input
              className="field !h-7 w-14 font-mono text-[12px]"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={s.padBefore}
              onChange={(e) => s.set({ padBefore: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })}
            />
            s
          </label>
          <label className="flex items-center gap-1.5">
            depois
            <input
              className="field !h-7 w-14 font-mono text-[12px]"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={s.padAfter}
              onChange={(e) => s.set({ padAfter: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })}
            />
            s
          </label>
        </div>
      )}
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-fg-2">
          {selIds.length > 0 ? (
            <>
              <span className="text-[13px] text-fg">
                {selIds.length} {selIds.length > 1 ? 'selecionados' : 'selecionado'}
                {multi && s.scope === 'all' && selVersions > 1 ? ` em ${selVersions} durações` : ''}
              </span>
              <button className="btn btn-ghost btn-sm !text-accent" onClick={() => useStore.setState({ selected: {} })}>
                Limpar seleção
              </button>
            </>
          ) : null}
          <button className={`btn btn-sm ${showOpts ? 'on' : 'btn-ghost'}`} onClick={() => setShowOpts(!showOpts)} aria-expanded={showOpts}>
            <Settings2 size={14} aria-hidden />
            {s.mono ? 'Mono' : 'Canais originais'}
            {multi ? (s.scope === 'all' ? ' · Todas as durações' : ' · Esta duração') : ''}
            {s.padBefore || s.padAfter ? ` · respiro ${s.padBefore}s/${s.padAfter}s` : ' · sem respiro'}
            <ChevronUp size={14} className={showOpts ? '' : 'rotate-180'} aria-hidden />
          </button>
        </div>
        <span className="flex-1" />
        {progress ? (
          <div className="flex items-center gap-3 text-[13px] text-fg-2">
            Gerando {progress.i} de {progress.n}…
            <span className="h-1.5 w-40 overflow-hidden rounded-full bg-panel-3">
              <span className="block h-full bg-accent" style={{ width: `${(progress.i / progress.n) * 100}%` }} />
            </span>
          </div>
        ) : selIds.length ? (
          <>
            <button className="btn" onClick={() => prepare(false)}>
              Baixar tudo ({total})
            </button>
            <button className="btn btn-primary" onClick={() => prepare(true)} data-testid="dl-selected">
              <Download size={15} aria-hidden /> Baixar selecionados ({selIds.length})
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => prepare(false)} data-testid="dl-all">
            <Download size={15} aria-hidden /> Baixar tudo ({total})
          </button>
        )}
      </div>
    </footer>
  )
}
