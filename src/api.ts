import type { Take } from './core/takes'

export interface Me {
  email: string
  name: string
  picture: string
  admin: boolean
  retentionDays: number
}

export interface CutSummary {
  durations: string[]
  takes: number
  pending: number
}

export interface CutMeta {
  id: string
  peca: string
  summary: CutSummary
  createdAt: number
  updatedAt: number
  expiresAt: number
  lastDownloadAt: number | null
}

export interface SavedVersion {
  id: string
  label: string
  fileName: string
  audioKey: string
  takes: Take[]
}

export interface CutState {
  versions: SavedVersion[]
  versao: number
  mono: boolean
  handles: boolean
}

export interface Invite {
  email: string
  expires_at: number
  created_by: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin', ...init })
  const isJson = r.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await r.json() : null
  if (!r.ok) throw new ApiError(r.status, (body as { error?: string } | null)?.error ?? `Erro ${r.status}`)
  return body as T
}

const jsonInit = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
})

export type AuthState = { mode: 'loading' } | { mode: 'offline' } | { mode: 'anon' } | { mode: 'user'; me: Me }

export async function loadAuth(): Promise<AuthState> {
  if (!/^https?:$/.test(location.protocol) || location.hostname.endsWith('claudeusercontent.com')) return { mode: 'offline' }
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' })
    if (r.status === 401) return { mode: 'anon' }
    if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) return { mode: 'offline' }
    return { mode: 'user', me: (await r.json()) as Me }
  } catch {
    return { mode: 'offline' }
  }
}

export const api = {
  listCuts: () => call<CutMeta[]>('/api/cuts'),
  getCut: (id: string) => call<CutMeta & { state: CutState }>(`/api/cuts/${id}`),
  createCut: (peca: string, summary: CutSummary, state: CutState) =>
    call<{ id: string; expiresAt: number }>('/api/cuts', jsonInit('POST', { peca, summary, state })),
  saveCut: (id: string, peca: string, summary: CutSummary, state: CutState) =>
    call<{ ok: true }>(`/api/cuts/${id}`, jsonInit('PUT', { peca, summary, state })),
  deleteCut: (id: string) => call<{ ok: true }>(`/api/cuts/${id}`, { method: 'DELETE' }),
  markDownloaded: (id: string) => call<{ ok: true }>(`/api/cuts/${id}/downloaded`, { method: 'POST' }),
  uploadAudio: (id: string, wav: Uint8Array) =>
    call<{ key: string }>(`/api/cuts/${id}/audio`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }),
    }),
  getAudio: async (id: string, key: string) => {
    const r = await fetch(`/api/cuts/${id}/audio?key=${encodeURIComponent(key)}`, { credentials: 'same-origin' })
    if (!r.ok) throw new ApiError(r.status, r.status === 404 ? 'O áudio deste corte expirou ou foi apagado.' : `Erro ${r.status}`)
    return r.arrayBuffer()
  },
  listInvites: () => call<Invite[]>('/api/invites'),
  addInvite: (email: string, days: number) => call<{ ok: true }>('/api/invites', jsonInit('POST', { email, days })),
  removeInvite: (email: string) => call<{ ok: true }>(`/api/invites/${encodeURIComponent(email)}`, { method: 'DELETE' }),
}
