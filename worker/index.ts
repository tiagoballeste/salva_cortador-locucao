import {
  cookie, isAdmin, isStaff, readCookie, signSession, signState, verifySession, verifyState, type SessionUser,
} from './session'
import { verifyGoogleIdToken } from './google'

export interface Env {
  ASSETS: Fetcher
  DB: D1Database
  AUDIO: KVNamespace
  AI?: Ai
  DEV_FAKE_TRANSCRIBE?: string
  GOOGLE_CLIENT_ID: string
  ALLOWED_DOMAIN: string
  ADMIN_EMAILS: string
  RETENTION_DAYS?: string
  DEV_LOGIN?: string
}

const DAY = 86_400_000
const SESSION_DAYS = 30
const MAX_AUDIO = 25 * 1024 * 1024

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })
const err = (status: number, message: string) => json({ error: message }, status)
const retention = (env: Env) => Math.max(1, Number(env.RETENTION_DAYS || 90)) * DAY

let schemaReady: Promise<unknown> | null = null
function ensureSchema(env: Env) {
  schemaReady ??= env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS cuts (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, peca TEXT NOT NULL, summary TEXT NOT NULL, state TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_download_at INTEGER)`,
    ),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS cuts_owner ON cuts(owner, updated_at DESC)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)'),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '',
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, logins INTEGER NOT NULL DEFAULT 0)`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS invites (
        email TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    ),
  ]).catch((e) => {
    schemaReady = null
    throw e
  })
  return schemaReady
}

let keyCache: Promise<string> | null = null
function secretOf(env: Env): Promise<string> {
  keyCache ??= (async () => {
    await ensureSchema(env)
    const read = () => env.DB.prepare("SELECT value FROM settings WHERE key = 'session_key'").first<{ value: string }>()
    const row = await read()
    if (row) return row.value
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const k = btoa(String.fromCharCode(...bytes))
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('session_key', ?)").bind(k).run()
    return (await read())!.value
  })().catch((e) => {
    keyCache = null
    throw e
  })
  return keyCache
}

async function inviteValid(env: Env, email: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT expires_at FROM invites WHERE email = ?').bind(email.toLowerCase()).first<{ expires_at: number }>()
  return !!row && row.expires_at > Date.now()
}

async function allowed(env: Env, email: string): Promise<boolean> {
  return isStaff(email, env.ALLOWED_DOMAIN) || isAdmin(email, env.ADMIN_EMAILS) || inviteValid(env, email)
}

async function currentUser(req: Request, env: Env): Promise<SessionUser | null> {
  const user = await verifySession(readCookie(req.headers.get('cookie'), 'sess'), await secretOf(env))
  if (!user) return null
  if (!(await allowed(env, user.email))) return null
  return user
}

async function startSession(env: Env, user: Omit<SessionUser, 'exp'>, origin: string) {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (email, name, picture, first_seen, last_seen, logins) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, picture = excluded.picture, last_seen = excluded.last_seen, logins = logins + 1`,
  )
    .bind(user.email, user.name, user.picture, now, now)
    .run()
  const token = await signSession({ ...user, exp: Date.now() + SESSION_DAYS * DAY }, await secretOf(env))
  const h = new Headers({ location: `${origin}/` })
  h.append('set-cookie', cookie('sess', token, SESSION_DAYS * 86400))
  return new Response(null, { status: 302, headers: h })
}

const deny = (origin: string, reason: string, email = '', detail = '') => {
  if (detail) console.warn(`login negado: ${reason} (${detail})`)
  const q = new URLSearchParams({ login: reason })
  if (email) q.set('email', email)
  if (detail) q.set('motivo', detail)
  return Response.redirect(`${origin}/?${q}`, 302)
}

async function auth(req: Request, env: Env, url: URL): Promise<Response> {
  const origin = url.origin
  const redirectUri = `${origin}/auth/callback`
  if (url.pathname === '/auth/login') {
    if (!env.GOOGLE_CLIENT_ID) return deny(origin, 'nao-configurado', '', 'sem-client-id')
    const state = await signState(await secretOf(env))
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'id_token',
      response_mode: 'form_post',
      scope: 'openid email profile',
      state,
      nonce: state,
      prompt: 'select_account',
    })
    return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${q}` } })
  }
  if (url.pathname === '/auth/callback') {
    let params: URLSearchParams
    if (req.method === 'POST') {
      const form = await req.formData()
      params = new URLSearchParams()
      for (const [k, v] of form.entries()) if (typeof v === 'string') params.set(k, v)
    } else params = url.searchParams
    const gErr = params.get('error')
    if (gErr) return deny(origin, 'falhou', '', `google:${gErr}`)
    const state = params.get('state')
    const idToken = params.get('id_token')
    if (!idToken || !state) return deny(origin, 'falhou', '', 'sem-token')
    if (!(await verifyState(state, await secretOf(env)))) return deny(origin, 'falhou', '', 'estado')
    const result = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID, state)
    if (typeof result === 'string') return deny(origin, 'falhou', '', `token:${result}`)
    await ensureSchema(env)
    if (!(await allowed(env, result.email))) {
      const t = Date.now()
      await env.DB.prepare(
        `INSERT INTO users (email, name, picture, first_seen, last_seen, logins) VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(email) DO UPDATE SET name = excluded.name, picture = excluded.picture, last_seen = excluded.last_seen`,
      )
        .bind(result.email, result.name ?? '', result.picture ?? '', t, t)
        .run()
      return deny(origin, 'nao-liberado', result.email)
    }
    return startSession(env, { email: result.email, name: result.name ?? '', picture: result.picture ?? '' }, origin)
  }
  if (url.pathname === '/auth/logout') {
    return new Response(null, { status: 302, headers: { location: `${origin}/`, 'set-cookie': cookie('sess', '', 0) } })
  }
  if (url.pathname === '/auth/dev' && env.DEV_LOGIN === '1') {
    const email = (url.searchParams.get('email') || 'dev@salva.studio').toLowerCase()
    await ensureSchema(env)
    if (!(await allowed(env, email))) {
      const t = Date.now()
      await env.DB.prepare(
        `INSERT INTO users (email, name, picture, first_seen, last_seen, logins) VALUES (?, ?, '', ?, ?, 0)
         ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen`,
      )
        .bind(email, email.split('@')[0], t, t)
        .run()
      return deny(origin, 'nao-liberado', email)
    }
    return startSession(env, { email, name: email.split('@')[0], picture: '' }, origin)
  }
  return err(404, 'Rota não encontrada')
}

interface CutRow {
  id: string
  owner: string
  peca: string
  summary: string
  state: string
  created_at: number
  updated_at: number
  expires_at: number
  last_download_at: number | null
}

const cutMeta = (r: CutRow) => ({
  id: r.id,
  peca: r.peca,
  summary: JSON.parse(r.summary),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  expiresAt: r.expires_at,
  lastDownloadAt: r.last_download_at,
})

async function ownCut(env: Env, id: string, owner: string) {
  return env.DB.prepare('SELECT * FROM cuts WHERE id = ? AND owner = ?').bind(id, owner).first<CutRow>()
}

function audioKeys(state: string): string[] {
  try {
    const s = JSON.parse(state) as { versions?: { audioKey?: string }[] }
    return (s.versions ?? []).map((v) => v.audioKey).filter((k): k is string => typeof k === 'string')
  } catch {
    return []
  }
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  await ensureSchema(env)
  const user = await currentUser(req, env)
  if (!user) return err(401, 'Faça login para continuar')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const o = req.headers.get('origin')
    if (o && o !== url.origin) return err(403, 'Origem não permitida')
  }
  const me = user.email
  const admin = isAdmin(me, env.ADMIN_EMAILS)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (email, name, picture, first_seen, last_seen, logins) VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen WHERE users.last_seen < ?`,
  )
    .bind(me, user.name, user.picture, now, now, now - 5 * 60_000)
    .run()
  const parts = url.pathname.split('/').filter(Boolean).slice(1)
  const [res, id, sub] = parts

  if (res === 'me' && req.method === 'GET') {
    return json({ email: me, name: user.name, picture: user.picture, admin, retentionDays: retention(env) / DAY })
  }

  if (res === 'cuts') {
    if (!id && req.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM cuts WHERE owner = ? AND expires_at > ? ORDER BY updated_at DESC LIMIT 200',
      )
        .bind(me, Date.now())
        .all<CutRow>()
      return json(results.map(cutMeta))
    }
    if (!id && req.method === 'POST') {
      const body = (await req.json()) as { peca?: string; summary?: unknown; state?: unknown }
      const now = Date.now()
      const cid = crypto.randomUUID()
      await env.DB.prepare(
        'INSERT INTO cuts (id, owner, peca, summary, state, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(cid, me, String(body.peca ?? '').slice(0, 200), JSON.stringify(body.summary ?? {}), JSON.stringify(body.state ?? {}), now, now, now + retention(env))
        .run()
      return json({ id: cid, expiresAt: now + retention(env) }, 201)
    }
    if (!id) return err(405, 'Método não permitido')
    const row = await ownCut(env, id, me)
    if (!row || row.expires_at < Date.now()) return err(404, 'Corte não encontrado')
    if (!sub && req.method === 'GET') return json({ ...cutMeta(row), state: JSON.parse(row.state) })
    if (!sub && req.method === 'PUT') {
      const body = (await req.json()) as { peca?: string; summary?: unknown; state?: unknown }
      const state = JSON.stringify(body.state ?? {})
      if (state.length > 900_000) return err(413, 'Corte grande demais para salvar')
      await env.DB.prepare('UPDATE cuts SET peca = ?, summary = ?, state = ?, updated_at = ? WHERE id = ? AND owner = ?')
        .bind(String(body.peca ?? row.peca).slice(0, 200), JSON.stringify(body.summary ?? {}), state, Date.now(), id, me)
        .run()
      const keep = new Set(audioKeys(state))
      await Promise.all(audioKeys(row.state).filter((k) => !keep.has(k)).map((k) => env.AUDIO.delete(k)))
      return json({ ok: true })
    }
    if (!sub && req.method === 'DELETE') {
      await Promise.all(audioKeys(row.state).map((k) => env.AUDIO.delete(k)))
      await env.DB.prepare('DELETE FROM cuts WHERE id = ? AND owner = ?').bind(id, me).run()
      return json({ ok: true })
    }
    if (sub === 'downloaded' && req.method === 'POST') {
      await env.DB.prepare('UPDATE cuts SET last_download_at = ? WHERE id = ? AND owner = ?').bind(Date.now(), id, me).run()
      return json({ ok: true })
    }
    if (sub === 'audio' && req.method === 'POST') {
      const len = Number(req.headers.get('content-length') || 0)
      if (!req.body || !len) return err(400, 'Áudio vazio')
      if (len > MAX_AUDIO) return err(413, 'Locução grande demais para guardar (limite de 25 MB)')
      const key = `a/${id}/${crypto.randomUUID()}`
      const ttl = Math.max(60, Math.floor((row.expires_at - Date.now()) / 1000))
      await env.AUDIO.put(key, req.body, { expirationTtl: ttl })
      return json({ key }, 201)
    }
    if (sub === 'audio' && req.method === 'GET') {
      const key = url.searchParams.get('key') || ''
      if (!key.startsWith(`a/${id}/`)) return err(404, 'Áudio não encontrado')
      const obj = await env.AUDIO.get(key, 'stream')
      if (!obj) return err(404, 'Áudio expirado ou não encontrado')
      return new Response(obj, { headers: { 'content-type': 'audio/wav', 'cache-control': 'private, max-age=3600' } })
    }
    return err(405, 'Método não permitido')
  }

  if (res === 'transcribe' && req.method === 'POST') {
    const len = Number(req.headers.get('content-length') || 0)
    if (!req.body || !len) return err(400, 'Áudio vazio')
    if (len > 12 * 1024 * 1024) return err(413, 'Áudio grande demais para transcrever')
    if (env.DEV_FAKE_TRANSCRIBE === '1') {
      const secs = (len - 44) / 32000
      const n = Math.max(1, Math.floor(secs * 2.5))
      return json({ text: 'fala de teste', words: Array.from({ length: n }, (_, i) => ({ w: `palavra${i + 1}`, s: (i / n) * secs, e: ((i + 0.8) / n) * secs })) })
    }
    if (!env.AI) return err(503, 'Transcrição indisponível neste servidor')
    try {
      const out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
        audio: { body: req.body, contentType: 'audio/wav' },
        language: 'pt',
        task: 'transcribe',
        initial_prompt: 'Magalu, Lu do Magalu, Black das Blacks, Black Friday, app do Magalu.',
        condition_on_previous_text: false,
      })
      const words = (out.segments ?? []).flatMap((sg) =>
        (sg.words ?? [])
          .filter((w) => typeof w.word === 'string' && typeof w.start === 'number' && typeof w.end === 'number')
          .map((w) => ({ w: w.word!, s: w.start!, e: w.end! })),
      )
      return json({ text: out.text ?? '', words })
    } catch (e) {
      const m = String((e as Error).message || e)
      console.warn('transcrição falhou', m)
      if (/limit|quota|neuron|429|exceed/i.test(m)) return err(429, 'A cota diária de transcrição acabou. Ela volta amanhã às 21h.')
      return err(502, 'A transcrição falhou. Tente de novo.')
    }
  }

  if (res === 'users' && req.method === 'GET') {
    if (!admin) return err(403, 'Só administradores veem os acessos')
    const { results } = await env.DB.prepare(
      `SELECT u.email, u.name, u.picture, u.first_seen, u.last_seen, u.logins,
        (SELECT COUNT(*) FROM cuts c WHERE c.owner = u.email AND c.expires_at > ?) AS cuts,
        (SELECT expires_at FROM invites i WHERE i.email = u.email) AS invite_expires
       FROM users u ORDER BY u.last_seen DESC LIMIT 500`,
    )
      .bind(now)
      .all<{ email: string; invite_expires: number | null }>()
    return json(
      results.map((r) => ({
        ...r,
        role: isAdmin(r.email, env.ADMIN_EMAILS)
          ? 'admin'
          : isStaff(r.email, env.ALLOWED_DOMAIN)
            ? 'equipe'
            : r.invite_expires && r.invite_expires > now
              ? 'convidado'
              : 'sem acesso',
      })),
    )
  }

  if (res === 'invites') {
    if (!admin) return err(403, 'Só administradores podem convidar')
    if (!id && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM invites ORDER BY expires_at DESC').all()
      return json(results)
    }
    if (!id && req.method === 'POST') {
      const body = (await req.json()) as { email?: string; days?: number }
      const email = String(body.email ?? '').trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, 'E-mail inválido')
      const days = Math.max(1, Math.min(365, Number(body.days) || 30))
      const now = Date.now()
      await env.DB.prepare(
        'INSERT INTO invites (email, expires_at, created_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET expires_at = excluded.expires_at, created_by = excluded.created_by',
      )
        .bind(email, now + days * DAY, me, now)
        .run()
      return json({ ok: true }, 201)
    }
    if (id && req.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM invites WHERE email = ?').bind(decodeURIComponent(id).toLowerCase()).run()
      return json({ ok: true })
    }
    return err(405, 'Método não permitido')
  }

  return err(404, 'Rota não encontrada')
}

const PRIVACY = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Política de privacidade · Cortador de locução</title>
<style>body{font:15px/1.65 system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;color:#1d1d21}h1{font-size:22px}h2{font-size:16px;margin-top:28px}a{color:#6d5ce8}</style></head><body>
<h1>Política de privacidade</h1>
<p>O Cortador de locução é uma ferramenta interna da Salva (salva.studio) para dividir locuções em takes. Esta página explica quais dados ela usa.</p>
<h2>O que coletamos</h2>
<p>Ao entrar com Google, recebemos apenas seu nome, e-mail e foto de perfil. Não acessamos Gmail, Drive, contatos nem qualquer outro dado da sua conta Google.</p>
<p>Também guardamos as locuções que você envia e as decisões de corte (pontos de corte, revisões, nomes dos arquivos).</p>
<h2>Para que usamos</h2>
<p>Para confirmar que você tem acesso à ferramenta e para mostrar a você, e só a você, a lista "Meus cortes". Os dados não são vendidos, compartilhados com terceiros nem usados para publicidade.</p>
<h2>Por quanto tempo</h2>
<p>Cada corte e sua locução são apagados automaticamente 90 dias depois de criados. Você também pode apagar um corte a qualquer momento.</p>
<h2>Onde ficam</h2>
<p>Os dados ficam armazenados na infraestrutura da Cloudflare, usada para hospedar a ferramenta.</p>
<h2>Contato</h2>
<p>Dúvidas ou pedidos de exclusão: <a href="mailto:tiago@salva.studio">tiago@salva.studio</a>.</p>
<p><a href="/">Voltar para a ferramenta</a></p>
</body></html>`

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/privacidade')
      return new Response(PRIVACY, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' } })
    try {
      if (url.pathname.startsWith('/auth/')) return await auth(req, env, url)
      if (url.pathname.startsWith('/api/')) return await api(req, env, url)
    } catch (e) {
      console.error(e)
      return err(500, 'Erro no servidor. Tente de novo.')
    }
    return env.ASSETS.fetch(req)
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await ensureSchema(env)
    const now = Date.now()
    await env.DB.batch([
      env.DB.prepare('DELETE FROM cuts WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM invites WHERE expires_at < ?').bind(now),
    ])
  },
} satisfies ExportedHandler<Env>
