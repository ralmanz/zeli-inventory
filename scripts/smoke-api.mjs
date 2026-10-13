// Prueba del servidor de punta a punta: entrar, crear cierre, subir archivos, cruce, recuento,
// proponer, enviar, aprobar y firmar. Requiere el servidor corriendo en BASE (por defecto :8787).
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { suggestMapping, findHeaderRow } from '../src/shared/datasets.js'
import { mergeCases, indexCases, recountRequired, recountOutcome, canPropose, needsAttention } from '../src/shared/logic.js'

const BASE = process.env.BASE || 'http://localhost:8787'
let cookie = ''
async function api(method, p, body) {
  const r = await fetch(BASE + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined })
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  if (r.status >= 400) throw new Error(`${method} ${p} → ${r.status} ${t.slice(0, 200)}`)
  return j
}
const step = (s) => console.log('·', s)

const login = await api('POST', '/api/auth/request', { email: 'prueba@zeli.lat' })
step('enlace de desarrollo recibido: ' + !!login.devLink)
await fetch(login.devLink, { redirect: 'manual' }).then((r) => { cookie = r.headers.get('set-cookie').split(';')[0] })
step('sesión: ' + (await api('GET', '/api/me')).email)

let close = await api('POST', '/api/closes', { meta: { name: 'Conteo general — Bodega Central', company: 'Ferretería Central', cutoff: '2026-09-30T18:00', approver: 'L. Méndez · Gerencia', approverEmail: 'lmendez@example.com', investigator: 'Ronel Almanza' } })
const files = { count: 'conteo_fisico.csv', balances: 'saldos_sistema.csv', master: 'maestro_articulos.csv', kardex: 'kardex_septiembre.csv', invoices: 'facturas.csv', dispatches: 'guias_despacho.csv', receipts: 'recepciones.csv', returns: 'devoluciones.csv', adjustments: 'ajustes.csv' }
for (const [kind, f] of Object.entries(files)) {
  const wb = XLSX.read(readFileSync(new URL('../public/ejemplo/' + f, import.meta.url)), { type: 'buffer', raw: true })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
  const h = findHeaderRow(rows), map = suggestMapping(kind, rows[h].map(String))
  const data = rows.slice(h + 1).filter((r) => r.some((x) => x !== '')).map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, r[i]])))
  await api('PUT', `/api/closes/${close.id}/datasets/${kind}`, { filename: f, mapping: map, rows: data })
}
step('9 archivos subidos')
const an = await api('POST', `/api/closes/${close.id}/analyze`)
step(`cruce: ${an.analysis.cases.length} diferencias, ${an.analysis.found.length} códigos desconocidos`)

close = await api('GET', `/api/closes/${close.id}`)
const meta = close.meta
// recuentos: el cable resulta error de conteo; el resto confirma el conteo
let cases = mergeCases(close.analysis, close.decisions), by = indexCases(cases)
for (const c of cases.filter((x) => recountRequired(x, meta, by))) {
  await api('POST', `/api/closes/${close.id}/decision`, { code: c.code, action: 'recount', recount: c.code === 'CAB-THHN-12' ? c.sys : c.phys })
}
close = await api('GET', `/api/closes/${close.id}`)
cases = mergeCases(close.analysis, close.decisions); by = indexCases(cases)
step('recuentos: ' + cases.filter((c) => recountOutcome(c)).map((c) => c.code + '=' + recountOutcome(c)).join(', '))
for (const c of cases.filter((x) => x.status !== 'propuesta' && x.status !== 'cerrada')) {
  if (!canPropose(c, meta, by)) { console.log('  no se puede proponer', c.code); continue }
  await api('POST', `/api/closes/${close.id}/decision`, { code: c.code, action: 'propose' })
}
const sent = await api('POST', `/api/closes/${close.id}/send`)
const token = sent.link.split('/aprobar/')[1]
step('enviado; enlace de aprobación: ' + !!token)

let ap = await api('GET', `/api/approve/${token}`)
cases = mergeCases(ap.analysis, ap.decisions)
const att = cases.filter(needsAttention)
for (const c of att) if (!indexCases(cases)[c.code].approval) {
  await api('POST', `/api/approve/${token}/decision`, { code: c.code, approval: 'aceptada' })
  ap = await api('GET', `/api/approve/${token}`); cases = mergeCases(ap.analysis, ap.decisions)
}
step(`quien aprueba aceptó ${att.length} casos de atención`)
const s = await api('POST', `/api/approve/${token}/sign`, { name: 'L. Méndez' })
step(`firmado por ${s.signed.by}: ${s.signed.lines.length} líneas, ajuste neto ${s.signed.total}`)
let blocked = false
try { await api('POST', `/api/closes/${close.id}/decision`, { code: 'TAL-PER-12', action: 'note', note: 'x' }) } catch { blocked = true }
step('cambios bloqueados después de firmar: ' + blocked)
if (s.signed.total !== 23.45 || s.signed.lines.length !== 13 || !blocked) { console.log('FALLA'); process.exit(1) }
console.log('TODO BIEN')
