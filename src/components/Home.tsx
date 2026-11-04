import { useCallback, useEffect, useState } from 'react'
import { Clock, FolderOpen, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api, type CutMeta } from '../api'
import { goHome, newCut, openCut } from '../cloud'
import { useStore } from '../store'

const DAY = 86_400_000

function when(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const diff = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / DAY)
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (diff === 0) return `hoje, ${hm}`
  if (diff === 1) return `ontem, ${hm}`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + `, ${hm}`
}

function expiresIn(ts: number) {
  const days = Math.ceil((ts - Date.now()) / DAY)
  if (days <= 1) return 'apaga amanhã'
  return `apaga em ${days} dias`
}

export function Home() {
  const s = useStore()
  const [cuts, setCuts] = useState<CutMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const retention = s.auth.mode === 'user' ? s.auth.me.retentionDays : 90

  const load = useCallback(() => {
    setError(null)
    api
      .listCuts()
      .then(setCuts)
      .catch((e) => setError((e as Error).message))
  }, [])

  useEffect(load, [load])

  const startWithFiles = (files: File[]) => {
    newCut()
    void s.addFiles(files)
  }

  const pick = () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.multiple = true
    inp.accept = 'audio/*,.wav,.mp3,.m4a,.aif,.aiff'
    inp.onchange = () => startWithFiles(Array.from(inp.files ?? []))
    inp.click()
  }

  return (
    <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pt-8 pb-16" data-testid="home">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">Meus cortes</h1>
          <p className="mt-1 text-fg-2">
            Seus cortes ficam guardados por {retention} dias. Só você vê esta lista.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={load} aria-label="Atualizar lista">
            <RefreshCw size={14} aria-hidden /> Atualizar
          </button>
          <button className="btn btn-primary" onClick={pick} data-testid="new-cut">
            <Plus size={15} aria-hidden /> Novo corte
          </button>
        </div>
      </div>

      <button
        onClick={pick}
        className="mb-6 flex w-full items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong bg-panel px-6 py-6 text-fg-2 transition-colors hover:border-accent hover:text-fg"
      >
        <Upload size={18} className="text-accent" aria-hidden />
        Solte as locuções aqui para começar um corte novo (a 30s, a 15s e a 6s podem ir juntas)
      </button>

      {error && <p className="mb-4 text-danger">{error}</p>}

      {!cuts && !error && <p className="text-fg-2">Carregando seus cortes…</p>}

      {cuts && cuts.length === 0 && (
        <div className="rounded-xl border border-line bg-panel px-6 py-10 text-center">
          <p className="text-[15px]">Você ainda não tem cortes guardados.</p>
          <p className="mt-1 text-fg-2">Comece um corte novo e ele aparece aqui automaticamente.</p>
        </div>
      )}

      {cuts && cuts.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-panel" data-testid="cut-list">
          {cuts.map((c) => (
            <div
              key={c.id}
              data-testid="cut"
              className="flex min-h-[64px] cursor-pointer flex-wrap items-center gap-4 border-b border-line px-4 py-3 last:border-b-0 hover:bg-panel-2"
              onClick={() => void openCut(c.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px] font-semibold">{c.peca || 'Sem nome'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-fg-2">
                  {c.summary.durations.map((d) => (
                    <span key={d} className="rounded bg-panel-3 px-1.5 py-0.5 font-medium text-fg">
                      {d}
                    </span>
                  ))}
                  <span>
                    {c.summary.takes} takes
                    {c.summary.pending ? ` · ${c.summary.pending} a revisar` : ' · tudo revisado'}
                  </span>
                </div>
              </div>
              <div className="text-right text-[12px] text-fg-2">
                <div>Editado {when(c.updatedAt)}</div>
                <div className="mt-0.5 flex items-center justify-end gap-1 text-fg-3">
                  <Clock size={12} aria-hidden /> {expiresIn(c.expiresAt)}
                  {c.lastDownloadAt ? ` · baixado ${when(c.lastDownloadAt)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {removing === c.id ? (
                  <span className="flex items-center gap-1 text-[12px]">
                    Apagar?
                    <button
                      className="btn btn-sm !h-7"
                      onClick={async () => {
                        await api.deleteCut(c.id).catch(() => {})
                        setRemoving(null)
                        load()
                      }}
                    >
                      Sim
                    </button>
                    <button className="btn btn-ghost btn-sm !h-7" onClick={() => setRemoving(null)}>
                      Não
                    </button>
                  </span>
                ) : (
                  <>
                    <button className="btn btn-sm" onClick={() => void openCut(c.id)}>
                      <FolderOpen size={14} aria-hidden /> Abrir
                    </button>
                    <button className="btn btn-ghost btn-icon" aria-label={`Apagar ${c.peca}`} onClick={() => setRemoving(c.id)}>
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

export function BackHome() {
  return (
    <button className="btn btn-ghost btn-sm" onClick={() => void goHome()} data-testid="back-home">
      ← Meus cortes
    </button>
  )
}
