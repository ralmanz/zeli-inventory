import { useState } from 'react'
import { KIND, FIELDS, suggestMapping, findHeaderRow } from '../shared/datasets.js'
import { api } from './api.ts'
import { toast } from './ui.tsx'

type Parsed = { filename: string; sheets: string[]; sheet: string; headers: string[]; body: any[][] }

function naive(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

async function readSheet(file: File | ArrayBuffer, name: string, sheetName?: string): Promise<Parsed> {
  const XLSX = await import('xlsx')
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  const isCsv = /\.(csv|txt)$/i.test(name)
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(buf).replace(/^﻿/, ''), { type: 'string', raw: true })
    : XLSX.read(buf, { type: 'array', cellDates: true })
  const sheets = wb.SheetNames
  const pick = sheetName || sheets.find((s) => (XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1 }) as any[]).length > 1) || sheets[0]
  const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[pick], { header: 1, raw: true, defval: '' })
  const h = findHeaderRow(rows)
  const headers = (rows[h] || []).map((x: any, i: number) => String(x || '').trim() || `Columna ${i + 1}`)
  const body = rows.slice(h + 1).filter((r) => r.some((x) => x !== '' && x != null)).map((r) => r.map((x) => (x instanceof Date ? naive(x) : x)))
  return { filename: name, sheets, sheet: pick, headers, body }
}

export function mapRows(parsed: Parsed, mapping: Record<string, number>) {
  return parsed.body.map((r) => Object.fromEntries(Object.entries(mapping).filter(([, i]) => i != null && i >= 0).map(([k, i]) => [k, r[i]])))
}

export async function uploadParsed(closeId: string, kind: string, parsed: Parsed, mapping: Record<string, number>) {
  const rows = mapRows(parsed, mapping)
  return api('PUT', `/api/closes/${closeId}/datasets/${kind}`, { filename: parsed.filename, mapping: Object.fromEntries(Object.entries(mapping).map(([k, i]) => [k, parsed.headers[i]])), rows })
}

/** Carga los archivos de ejemplo de /ejemplo y los sube con columnas sugeridas. */
export async function loadSample(closeId: string, onProgress: (s: string) => void) {
  const files: Record<string, string> = { count: 'conteo_fisico.csv', balances: 'saldos_sistema.csv', master: 'maestro_articulos.csv', kardex: 'kardex_septiembre.csv', invoices: 'facturas.csv', dispatches: 'guias_despacho.csv', receipts: 'recepciones.csv', returns: 'devoluciones.csv', adjustments: 'ajustes.csv' }
  let last: any
  for (const [kind, f] of Object.entries(files)) {
    onProgress(`Subiendo ${KIND[kind].title}…`)
    const buf = await (await fetch('/ejemplo/' + f)).arrayBuffer()
    const parsed = await readSheet(buf, f)
    last = await uploadParsed(closeId, kind, parsed, suggestMapping(kind, parsed.headers))
  }
  return last
}

export function Uploader({ closeId, kind, current, onDone, disabled }: { closeId: string; kind: string; current?: { filename: string; n: number }; onDone: (files: any) => void; disabled?: boolean }) {
  const spec = KIND[kind]
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  async function onFile(f: File | undefined) {
    if (!f) return
    try {
      setBusy(true)
      const p = await readSheet(f, f.name)
      setFile(f); setParsed(p); setMapping(suggestMapping(kind, p.headers))
    } catch (e: any) { toast('No se pudo leer el archivo: ' + e.message) } finally { setBusy(false) }
  }
  async function changeSheet(s: string) {
    if (!file) return
    const p = await readSheet(file, file.name, s)
    setParsed(p); setMapping(suggestMapping(kind, p.headers))
  }
  async function save() {
    if (!parsed) return
    const missing = spec.need.filter((n: string) => mapping[n] == null || mapping[n] < 0)
    if (missing.length) { toast('Falta indicar: ' + missing.map((m: string) => FIELDS[m].label).join(', ')); return }
    try {
      setBusy(true)
      const r: any = await uploadParsed(closeId, kind, parsed, mapping)
      setParsed(null); onDone(r.files); toast(`${spec.title}: ${parsed.body.length} filas guardadas`)
    } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  async function remove() {
    const r: any = await api('DELETE', `/api/closes/${closeId}/datasets/${kind}`)
    onDone(r.files)
  }

  const ok = !!current
  return (
    <div className={'card ' + (ok ? 'flat' : spec.required ? '' : 'dash') + ' pad-s stack g8'}>
      <div className="row between start g10">
        <strong style={{ fontSize: '.97rem' }}>{spec.title}{spec.required && <span className="muted small"> · obligatorio</span>}</strong>
        <span className={'tag ' + (ok ? 't-g' : spec.required ? 't-y' : 't-ys')}>{ok ? `${current!.n.toLocaleString('en-US')} filas` : 'Falta'}</span>
      </div>
      {ok && <span className="mono code">{current!.filename}</span>}
      <span className="xs muted">Permite revisar: {spec.enables}</span>
      {!parsed && !disabled && (
        <div className="row g8">
          <label className="btn ghost sm">{busy ? 'Leyendo…' : ok ? 'Reemplazar' : 'Subir archivo'}
            <input type="file" className="sr" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {ok && <button className="btn ghost sm" onClick={remove}>Quitar</button>}
        </div>
      )}
      {parsed && (
        <div className="stack g10" style={{ borderTop: '1px solid var(--rule)', paddingTop: 10 }}>
          <span className="small"><strong>{parsed.filename}</strong> · {parsed.body.length.toLocaleString('en-US')} filas. Indique qué columna es cada dato:</span>
          {parsed.sheets.length > 1 && (
            <div className="field"><label htmlFor={`sh-${kind}`}>Hoja</label>
              <select id={`sh-${kind}`} className="input sm" value={parsed.sheet} onChange={(e) => changeSheet(e.target.value)}>{parsed.sheets.map((s) => <option key={s}>{s}</option>)}</select></div>
          )}
          <div className="grid c2" style={{ gap: 10 }}>
            {spec.fields.map((f: string) => (
              <div className="field" key={f}>
                <label htmlFor={`m-${kind}-${f}`}>{FIELDS[f].label}{spec.need.includes(f) ? ' *' : ''}</label>
                <select id={`m-${kind}-${f}`} className="input sm" value={mapping[f] ?? -1} onChange={(e) => setMapping({ ...mapping, [f]: Number(e.target.value) })}>
                  <option value={-1}>— no está —</option>
                  {parsed.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="tablebox" style={{ border: '1px solid var(--rule)', borderRadius: 8 }}>
            <table style={{ fontSize: '.8rem' }}>
              <thead><tr>{spec.fields.filter((f: string) => mapping[f] != null && mapping[f] >= 0).map((f: string) => <th key={f}>{FIELDS[f].label}</th>)}</tr></thead>
              <tbody>{parsed.body.slice(0, 4).map((r, i) => (
                <tr key={i}>{spec.fields.filter((f: string) => mapping[f] != null && mapping[f] >= 0).map((f: string) => <td key={f} className="mono">{String(r[mapping[f]] ?? '')}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row g8">
            <button className="btn sm" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
            <button className="btn ghost sm" onClick={() => setParsed(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
