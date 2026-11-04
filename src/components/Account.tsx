import { useEffect, useState } from 'react'
import { AudioLines, Check, Cloud, CloudOff, Loader2, LogOut, Trash2, UserPlus, X } from 'lucide-react'
import { api, type Invite, type Me } from '../api'
import { useStore } from '../store'

export function Login() {
  const params = new URLSearchParams(location.search)
  const reason = params.get('login')
  const email = params.get('email')
  const msg =
    reason === 'nao-liberado'
      ? `O e-mail ${email ?? ''} não tem acesso. Peça para um administrador liberar.`
      : reason === 'falhou'
        ? 'Não deu certo entrar. Tente de novo.'
        : reason === 'nao-configurado'
          ? 'O login com Google ainda não foi configurado no servidor.'
          : null
  return (
    <div className="flex min-h-full items-center justify-center px-6" data-testid="login">
      <div className="w-full max-w-[400px] rounded-2xl border border-line bg-panel p-8 text-center">
        <AudioLines size={28} className="mx-auto text-accent" aria-hidden />
        <h1 className="mt-3 text-[20px] font-semibold">Cortador de locução</h1>
        <p className="mt-1 text-fg-2">Ferramenta interna da Salva</p>
        <a href="/auth/login" className="btn btn-primary mt-6 w-full !h-10 text-[14px]" data-testid="google-login">
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Entrar com Google
        </a>
        {msg && <p className="mt-4 text-[13px] text-danger">{msg}</p>}
        <p className="mt-6 text-[12px] text-fg-3">Use seu e-mail @salva.studio. Freelancers entram com o e-mail que foi liberado.</p>
      </div>
    </div>
  )
}

export function SaveIndicator() {
  const st = useStore((s) => s.saveStatus)
  const cutId = useStore((s) => s.cutId)
  if (!cutId) return null
  const map = {
    idle: { icon: <Cloud size={14} aria-hidden />, text: 'Guardado', cls: 'text-fg-3' },
    saved: { icon: <Check size={14} aria-hidden />, text: 'Salvo', cls: 'text-fg-3' },
    saving: { icon: <Loader2 size={14} className="animate-spin" aria-hidden />, text: 'Salvando…', cls: 'text-fg-2' },
    error: { icon: <CloudOff size={14} aria-hidden />, text: 'Não salvou', cls: 'text-danger' },
  }[st]
  return (
    <span className={`flex items-center gap-1.5 text-[12px] ${map.cls}`} data-testid="save-status" title="Seus cortes salvam sozinhos">
      {map.icon} {map.text}
    </span>
  )
}

export function UserMenu({ me }: { me: Me }) {
  const [invites, setInvites] = useState(false)
  return (
    <div className="flex items-center gap-2 text-[12px] text-fg-2" data-testid="user">
      {me.admin && (
        <button className="btn btn-ghost btn-sm" onClick={() => setInvites(true)} data-testid="open-invites" title="Convidados" aria-label="Convidados">
          <UserPlus size={15} aria-hidden />
        </button>
      )}
      {me.picture ? (
        <img src={me.picture} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
      ) : (
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent" aria-hidden>
          {me.email[0]?.toUpperCase()}
        </span>
      )}
      <span className="max-w-[150px] truncate" title={me.email}>
        {me.email}
      </span>
      <a className="btn btn-ghost btn-sm" href="/auth/logout" title="Sair da ferramenta">
        <LogOut size={14} aria-hidden /> Sair
      </a>
      {invites && <Invites onClose={() => setInvites(false)} />}
    </div>
  )
}

const DAY = 86_400_000

function Invites({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Invite[] | null>(null)
  const [email, setEmail] = useState('')
  const [days, setDays] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    api
      .listInvites()
      .then(setList)
      .catch((e) => setError((e as Error).message))
  useEffect(() => {
    void load()
  }, [])
  const add = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Digite um e-mail válido.')
      return
    }
    setError(null)
    try {
      await api.addInvite(email.trim(), days)
      setEmail('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[520px] max-w-[92vw] rounded-xl border border-line-strong bg-panel p-5 text-[13px] text-fg" onClick={(e) => e.stopPropagation()} data-testid="invites">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[15px] font-medium">Convidados</span>
          <button className="btn btn-ghost btn-icon" aria-label="Fechar" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="mb-4 text-fg-2">
          Quem é @salva.studio já entra. Aqui você libera e-mails de fora, como freelancers, por um prazo. Quando o prazo acaba, o acesso
          some sozinho.
        </p>
        <div className="flex gap-2">
          <input
            className="field flex-1"
            placeholder="freelancer@gmail.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            aria-label="E-mail do convidado"
            data-testid="invite-email"
          />
          <select className="field" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Prazo do acesso">
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
          <button className="btn btn-primary" onClick={() => void add()} data-testid="invite-add">
            Liberar
          </button>
        </div>
        {error && <p className="mt-2 text-danger">{error}</p>}
        <div className="mt-4 max-h-[300px] overflow-auto rounded-lg border border-line">
          {list === null ? (
            <p className="p-3 text-fg-2">Carregando…</p>
          ) : list.length === 0 ? (
            <p className="p-3 text-fg-2">Nenhum convidado ainda.</p>
          ) : (
            list.map((i) => {
              const left = Math.ceil((i.expires_at - Date.now()) / DAY)
              return (
                <div key={i.email} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate">{i.email}</span>
                  <span className={left > 0 ? 'text-fg-2' : 'text-danger'}>{left > 0 ? `${left} dias restantes` : 'expirado'}</span>
                  <button
                    className="btn btn-ghost btn-icon"
                    aria-label={`Remover ${i.email}`}
                    onClick={async () => {
                      await api.removeInvite(i.email).catch(() => {})
                      await load()
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
