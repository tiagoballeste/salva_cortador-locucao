import { fromB64url } from './session'

export interface GoogleClaims {
  email: string
  name?: string
  picture?: string
  nonce?: string
}

type Jwk = JsonWebKey & { kid?: string }
export type KeySource = (refresh: boolean) => Promise<Jwk[]>

let cache: { keys: Jwk[]; until: number } | null = null

export const googleKeys: KeySource = async (refresh) => {
  if (!cache || refresh || cache.until < Date.now()) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/certs')
    if (!r.ok) throw new Error(`certs ${r.status}`)
    const j = (await r.json()) as { keys: Jwk[] }
    cache = { keys: j.keys, until: Date.now() + 3600_000 }
  }
  return cache.keys
}

const dec = new TextDecoder()

export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  nonce: string,
  keys: KeySource = googleKeys,
): Promise<GoogleClaims | string> {
  const parts = token.split('.')
  if (parts.length !== 3) return 'formato'
  let header: { kid?: string; alg?: string }
  let claims: Record<string, unknown>
  try {
    header = JSON.parse(dec.decode(fromB64url(parts[0])))
    claims = JSON.parse(dec.decode(fromB64url(parts[1])))
  } catch {
    return 'formato'
  }
  if (header.alg !== 'RS256') return 'alg'
  let jwk = (await keys(false)).find((k) => k.kid === header.kid)
  if (!jwk) jwk = (await keys(true)).find((k) => k.kid === header.kid)
  if (!jwk) return 'chave'
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    fromB64url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  )
  if (!ok) return 'assinatura'
  const iss = String(claims.iss ?? '')
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(iss)) return 'emissor'
  if (claims.aud !== clientId) return 'aud'
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) return 'expirado'
  if (claims.nonce !== nonce) return 'nonce'
  if (claims.email_verified !== true || typeof claims.email !== 'string') return 'email'
  return {
    email: claims.email.toLowerCase(),
    name: typeof claims.name === 'string' ? claims.name : '',
    picture: typeof claims.picture === 'string' ? claims.picture : '',
  }
}
