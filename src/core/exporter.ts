import { zipSync, type Zippable } from 'fflate'
import { encodeWav, slice, type PcmAudio } from './wav'
import { blackMp4, type Aspect } from './mp4'
import { fileBase, sortTakes, takeLabel, type Take } from './takes'

export interface ExportVersion {
  label: string
  audio: PcmAudio
  takes: Take[]
}

export interface ExportOptions {
  peca: string
  versao: number
  mono: boolean
  padBefore: number
  padAfter: number
  folders: boolean
}

export interface ExportJob {
  version: ExportVersion
  take: Take
  index: number
  base: string
  path: string
}

export function planExport(versions: ExportVersion[], selected: Set<string> | null, opts: ExportOptions): ExportJob[] {
  const jobs: ExportJob[] = []
  for (const v of versions) {
    const sorted = sortTakes(v.takes)
    sorted.forEach((take, index) => {
      if (selected && !selected.has(take.id)) return
      const base = fileBase({ peca: opts.peca, duracao: v.label, index, text: take.text, versao: opts.versao })
      const path = opts.folders ? `${v.label}/${base}` : base
      jobs.push({ version: v, take, index, base, path })
    })
  }
  return jobs
}

function takeChannels(job: ExportJob, opts: ExportOptions): Float32Array[] {
  const { audio } = job.version
  const parts = slice(audio.channels, audio.sampleRate, job.take.a, job.take.b, opts.mono)
  return addSilence(parts, audio.sampleRate, opts.padBefore, opts.padAfter)
}

export function renderWav(job: ExportJob, opts: ExportOptions): Uint8Array {
  const { audio } = job.version
  return encodeWav(takeChannels(job, opts), audio.sampleRate, audio.bitDepth, audio.format)
}

export function renderMp4(job: ExportJob, opts: ExportOptions, aspect: Aspect): Promise<Uint8Array> {
  return blackMp4(takeChannels(job, opts), job.version.audio.sampleRate, aspect)
}

export function addSilence(parts: Float32Array[], sr: number, before: number, after: number): Float32Array[] {
  const nb = Math.round(before * sr)
  const na = Math.round(after * sr)
  if (!nb && !na) return parts
  return parts.map((c) => {
    const o = new Float32Array(nb + c.length + na)
    o.set(c, nb)
    return o
  })
}

const csvCell = (s: string | number) => {
  const t = String(s)
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

const num = (x: number) => x.toFixed(3).replace('.', ',')

export function sheet(jobs: ExportJob[], opts: ExportOptions): string {
  const head = ['duracao', 'take', 'arquivo', 'fala', 'entrada_s', 'saida_s', 'silence_handle_s', 'duracao_arquivo_s', 'revisado']
  const rows = jobs.map((j) => {
    const dur = j.take.b - j.take.a + opts.padBefore + opts.padAfter
    return [
      j.version.label,
      takeLabel(j.index),
      j.base,
      j.take.text,
      num(j.take.a),
      num(j.take.b),
      num(opts.padBefore),
      num(dur),
      j.take.reviewed ? 'sim' : 'nao',
    ]
  })
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')
}

export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  const z: Zippable = {}
  for (const [k, v] of Object.entries(files)) z[k] = [v, { level: 0 }]
  return zipSync(z)
}
