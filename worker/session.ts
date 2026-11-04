export interface SessionUser {
  email: string
  name: string
  picture: string
  exp: number
}

const enc = new TextEncoder()

const b64url = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const fromB64url = (s: string) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function key(secret: string) {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`cortador-session:${secret}`))
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signSession(user: SessionUser, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(user)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)))
  return `${body}.${b64url(sig)}`
}

export async function verifySession(token: string | null | undefined, secret: string): Promise<SessionUser | null> {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64url(sig), enc.encode(body))
    if (!ok) return null
    const user = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionUser
    if (typeof user.email !== 'string' || typeof user.exp !== 'number' || user.exp < Date.now()) return null
    return user
  } catch {
    return null
  }
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(part)))
  } catch {
    return null
  }
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export function cookie(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`
}

export function isStaff(email: string, domain: string): boolean {
  return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`)
}

export function isAdmin(email: string, admins: string): boolean {
  return admins
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}

export async function signState(secret: string): Promise<string> {
  const body = `${Date.now()}.${crypto.randomUUID()}`
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(`state:${secret}`), enc.encode(body)))
  return `${body}.${b64url(sig)}`
}

export async function verifyState(state: string, secret: string, maxAgeMs = 15 * 60_000): Promise<boolean> {
  const i = state.lastIndexOf('.')
  if (i < 0) return false
  const body = state.slice(0, i)
  const ts = Number(body.split('.')[0])
  if (!ts || Date.now() - ts > maxAgeMs) return false
  try {
    return await crypto.subtle.verify('HMAC', await key(`state:${secret}`), fromB64url(state.slice(i + 1)), enc.encode(body))
  } catch {
    return false
  }
}
