import { describe, expect, it } from 'vitest'
import { cookie, decodeJwtPayload, isAdmin, isStaff, readCookie, signSession, verifySession } from '../worker/session'

describe('sessão', () => {
  const user = { email: 'tiago@salva.studio', name: 'Tiago', picture: '', exp: Date.now() + 60_000 }
  it('assina e confere', async () => {
    const t = await signSession(user, 'segredo')
    expect((await verifySession(t, 'segredo'))?.email).toBe('tiago@salva.studio')
  })
  it('recusa segredo errado, token adulterado e expirado', async () => {
    const t = await signSession(user, 'segredo')
    expect(await verifySession(t, 'outro')).toBe(null)
    const [b, s] = t.split('.')
    const forged = btoa(JSON.stringify({ ...user, email: 'intruso@x.com' })).replace(/=+$/, '')
    expect(await verifySession(`${forged}.${s}`, 'segredo')).toBe(null)
    expect(await verifySession(`${b}.${s}x`, 'segredo')).toBe(null)
    const old = await signSession({ ...user, exp: Date.now() - 1 }, 'segredo')
    expect(await verifySession(old, 'segredo')).toBe(null)
  })
  it('regras de acesso', () => {
    expect(isStaff('Ana@Salva.Studio', 'salva.studio')).toBe(true)
    expect(isStaff('ana@salva.studio.evil.com', 'salva.studio')).toBe(false)
    expect(isStaff('ana@notsalva.studio', 'salva.studio')).toBe(false)
    expect(isAdmin('TiagoPrado000@gmail.com', 'tiago@salva.studio, tiagoprado000@gmail.com')).toBe(true)
    expect(isAdmin('outro@gmail.com', 'tiago@salva.studio')).toBe(false)
  })
  it('cookies e jwt', () => {
    expect(readCookie('a=1; sess=abc.def; b=2', 'sess')).toBe('abc.def')
    expect(cookie('sess', 'x', 10)).toContain('HttpOnly; Secure; SameSite=Lax')
    const jwt = `x.${btoa(JSON.stringify({ email: 'a@b.c' })).replace(/=+$/, '')}.y`
    expect(decodeJwtPayload(jwt)?.email).toBe('a@b.c')
  })
})
