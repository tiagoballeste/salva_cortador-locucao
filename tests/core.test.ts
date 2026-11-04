import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyze, speechBlocks } from '../src/core/analysis'
import { encodeWav, isDualMono, parseWav } from '../src/core/wav'
import {
  durationLabelFromName, durationLabelFromSeconds, fileBase, pauseState, pecaFromName, takesFromAnalysis, togglePause,
} from '../src/core/takes'
import { planExport, renderWav, sheet } from '../src/core/exporter'

// As locuções reais são material de cliente e não entram no repositório (.gitignore).
// Coloque os WAVs em tests/fixtures/ para rodar estes testes localmente.
const NAME = 'Loc_03_ML_SO_AMANHA_So_Amanha_Black_30s_261103_20h.wav'
const N15 = 'Loc_03_ML_SO_AMANHA_So_Amanha_Black_15s_261104_10h.wav'
const has30 = existsSync(`tests/fixtures/${NAME}`)
const has15 = existsSync(`tests/fixtures/${N15}`)
const load = (n: string) => {
  const b = readFileSync(`tests/fixtures/${n}`)
  return parseWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

describe.skipIf(!has30)('locução real SO_AMANHA 30s', () => {
  const audio = has30 ? load(NAME) : (null as never)
  const an = audio ? analyze(audio.channels, audio.sampleRate) : (null as never)

  it('lê o WAV sem perda', () => {
    expect(audio.sampleRate).toBe(48000)
    expect(audio.bitDepth).toBe(24)
    expect(audio.channels.length).toBe(2)
    expect(audio.duration).toBeCloseTo(30.03, 2)
    expect(isDualMono(audio.channels)).toBe(true)
    const re = parseWav(encodeWav(audio.channels, 48000, 24, 'int').buffer as ArrayBuffer)
    let diff = 0
    for (let i = 0; i < audio.length; i += 13) diff = Math.max(diff, Math.abs(re.channels[0][i] - audio.channels[0][i]))
    expect(diff).toBe(0)
  })

  it('encontra os 7 trechos de fala', () => {
    const bl = speechBlocks(an)
    expect(bl.length).toBe(7)
    const starts = [0, 5.5, 8.14, 9.48, 13.79, 17.0, 25.59]
    bl.forEach((b, i) => expect(Math.abs(b.start - starts[i])).toBeLessThan(0.15))
    const takes = takesFromAnalysis(an, audio.duration)
    takes.forEach((t, i) => expect(t.a).toBeLessThanOrEqual(starts[i] + 0.01))
  })

  it('o respiro entre T02 e T03 vira um take só com um clique', () => {
    const takes = takesFromAnalysis(an, audio.duration)
    expect(takes.length).toBe(7)
    const p = an.pauses[1]
    expect(p.end - p.start).toBeGreaterThan(0.4)
    expect(pauseState(p, takes)).toBe('corte')
    const merged = togglePause(p, takes)!
    expect(merged.length).toBe(6)
    expect(merged[1].a).toBeLessThan(5.5)
    expect(merged[1].b).toBeGreaterThan(9.2)
    expect(pauseState(p, merged)).toBe('respiro')
    const back = togglePause(p, merged)!
    expect(back.length).toBe(7)
  })

  it('exporta WAVs e planilha', () => {
    const takes = takesFromAnalysis(an, audio.duration)
    const opts = { peca: 'SO_AMANHA', versao: 1, mono: true, padBefore: 0, padAfter: 0, folders: true }
    const jobs = planExport([{ label: '30s', audio, takes }], null, opts)
    expect(jobs.length).toBe(7)
    expect(jobs[0].path).toBe('30s/T01_SO_AMANHA_30s_v01')
    const wav = parseWav(renderWav(jobs[1], opts).buffer as ArrayBuffer)
    expect(wav.channels.length).toBe(1)
    expect(wav.bitDepth).toBe(24)
    expect(wav.duration).toBeCloseTo(takes[1].b - takes[1].a, 2)
    expect(sheet(jobs, opts).split('\r\n').length).toBe(8)
  })
})

describe('nomes', () => {
  it('lê duração e peça do nome do estúdio', () => {
    expect(durationLabelFromName(NAME)).toBe('30s')
    expect(durationLabelFromName('loc_15s.wav')).toBe('15s')
    expect(durationLabelFromName('Loc_06_X_6s_261103.wav')).toBe('6s')
    expect(durationLabelFromName('locucao final.wav')).toBe(null)
    expect(durationLabelFromSeconds(30.03)).toBe('30s')
    expect(durationLabelFromSeconds(14.8)).toBe('15s')
    expect(pecaFromName(NAME)).toBe('ML_SO_AMANHA_So_Amanha_Black')
    expect(fileBase({ peca: 'SO AMANHÃ', duracao: '15s', index: 2, text: 'Só amanhã, corre pro app!', versao: 2 }))
      .toBe('T03_SO_AMANHA_15s_so-amanha-corre-pro_v02')
  })
})

describe.skipIf(!has15)('locução real SO_AMANHA 15s (regravada)', () => {
  const audio = has15 ? load(N15) : (null as never)
  const an = audio ? analyze(audio.channels, audio.sampleRate) : (null as never)
  it('lê duração e trechos', () => {
    expect(durationLabelFromName(N15)).toBe('15s')
    expect(audio.duration).toBeCloseTo(15.02, 2)
    expect(speechBlocks(an).length).toBe(6)
  })
})

describe('silence handle', () => {
  it('soma 1s de silêncio no começo e no fim', () => {
    const sr = 48000
    const tone = new Float32Array(sr * 2).map((_, i) => Math.sin(i / 10) * 0.5)
    const audio = { sampleRate: sr, bitDepth: 24, format: 'int' as const, channels: [tone], length: tone.length, duration: 2 }
    const takes = [{ id: 'a', a: 0.5, b: 1.5, text: '', reviewed: true }]
    const opts = { peca: 'X', versao: 1, mono: true, padBefore: 1, padAfter: 1, folders: false }
    const [job] = planExport([{ label: '6s', audio, takes }], null, opts)
    const wav = parseWav(renderWav(job, opts).buffer as ArrayBuffer)
    expect(wav.duration).toBeCloseTo(3, 3)
    expect(Math.max(...wav.channels[0].slice(0, sr).map(Math.abs))).toBe(0)
    expect(Math.max(...wav.channels[0].slice(sr * 2).map(Math.abs))).toBe(0)
    expect(Math.max(...wav.channels[0].slice(sr, sr * 2).map(Math.abs))).toBeGreaterThan(0.4)
    expect(sheet([job], opts)).toContain(';1,000;3,000;sim')
  })
})
