import { describe, expect, it } from 'vitest'
import { verifyGoogleIdToken } from '../worker/google'

const b64u = (b: Uint8Array | string) =>
  Buffer.from(typeof b === 'string' ? b : b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function setup() {
  const kp = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const pub = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' }
  const sign = async (claims: Record<string, unknown>, kid = 'k1') => {
    const h = b64u(JSON.stringify({ alg: 'RS256', kid }))
    const p = b64u(JSON.stringify(claims))
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`)))
    return `${h}.${p}.${b64u(sig)}`
  }
  return { keys: async () => [pub], sign }
}

const good = { iss: 'https://accounts.google.com', aud: 'cid', exp: Math.floor(Date.now() / 1000) + 300, nonce: 'n1', email: 'Tiago@Salva.Studio', email_verified: true, name: 'Tiago' }

describe('token do Google', () => {
  it('aceita token válido', async () => {
    const { keys, sign } = await setup()
    const r = await verifyGoogleIdToken(await sign(good), 'cid', 'n1', keys)
    expect(r).toMatchObject({ email: 'tiago@salva.studio', name: 'Tiago' })
  })
  it('recusa token adulterado, de outro app, vencido, nonce errado e e-mail não verificado', async () => {
    const { keys, sign } = await setup()
    const t = await sign(good)
    const forged = t.split('.')
    forged[1] = b64u(JSON.stringify({ ...good, email: 'intruso@x.com' }))
    expect(await verifyGoogleIdToken(forged.join('.'), 'cid', 'n1', keys)).toBe('assinatura')
    expect(await verifyGoogleIdToken(await sign({ ...good, aud: 'outro' }), 'cid', 'n1', keys)).toBe('aud')
    expect(await verifyGoogleIdToken(await sign({ ...good, exp: 1 }), 'cid', 'n1', keys)).toBe('expirado')
    expect(await verifyGoogleIdToken(t, 'cid', 'n2', keys)).toBe('nonce')
    expect(await verifyGoogleIdToken(await sign({ ...good, email_verified: false }), 'cid', 'n1', keys)).toBe('email')
    expect(await verifyGoogleIdToken(await sign(good, 'k9'), 'cid', 'n1', keys)).toBe('chave')
  })
})
