// Prueba de punta a punta del motor con los archivos de ejemplo:
// lee cada CSV, sugiere columnas como lo hace la app, normaliza y analiza.
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { suggestMapping, findHeaderRow, KIND } from '../src/shared/datasets.js'
import { analyze } from '../server/engine.js'
import { mergeCases, indexCases, stats } from '../src/shared/logic.js'

const files = {
  count: 'conteo_fisico.csv', balances: 'saldos_sistema.csv', master: 'maestro_articulos.csv', kardex: 'kardex_septiembre.csv',
  invoices: 'facturas.csv', dispatches: 'guias_despacho.csv', receipts: 'recepciones.csv', returns: 'devoluciones.csv', adjustments: 'ajustes.csv',
}
const datasets = {}
let ok = true
for (const [kind, f] of Object.entries(files)) {
  const wb = XLSX.read(readFileSync(new URL('../public/ejemplo/' + f, import.meta.url)), { type: 'buffer', raw: true })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
  const h = findHeaderRow(rows)
  const headers = rows[h].map(String)
  const map = suggestMapping(kind, headers)
  const missing = KIND[kind].need.filter((n) => map[n] == null)
  console.log(kind.padEnd(12), JSON.stringify(Object.fromEntries(Object.entries(map).map(([k, i]) => [k, headers[i]]))), missing.length ? 'FALTA ' + missing : '')
  if (missing.length) ok = false
  datasets[kind] = { rows: rows.slice(h + 1).filter((r) => r.some((x) => x !== '')).map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, r[i]]))) }
}
const a = analyze(datasets, { cutoff: '2026-09-30T18:00', partialCount: false })
const expect = {
  'PIN-LB-01': 'Cruce de referencias', 'PIN-LBH-01': 'Cruce de referencias', 'TOR-DW-61': 'Recibido, no registrado', 'TAL-PER-12': 'Faltante real',
  'PVC-12-6M': 'Facturado, no despachado', 'CIN-TEF-34': 'Unidad de medida', 'DIS-CO-45': 'Error de despacho (picking)', 'BRK-20A-1P': 'Devolución mal procesada',
  'CAB-THHN-12': 'Faltante real', 'LLV-PAS-12': 'Error de código o maestro', 'SIL-TRA-300': 'Movimiento durante el corte', 'BRO-14': 'Error al recibir del proveedor',
  'GUA-NIT-M': 'Merma o vencido sin dar de baja', 'FOC-LED-9': 'Faltante real',
}
console.log('\ncasos:', a.cases.length, 'encontrados:', a.found.map((f) => f.code + '→' + (f.matchCode || '—')).join(', '))
for (const c of a.cases) {
  const good = expect[c.code] === c.cause
  if (!good) ok = false
  console.log(good ? 'ok ' : 'MAL', c.code.padEnd(12), String(c.diff).padStart(5), c.kind.padEnd(8), c.cause, good ? '' : '  (esperado: ' + expect[c.code] + ')')
}
const cases = mergeCases(a, {})
console.log('\nresumen:', stats(cases, { rules: { noDoc: true, shortage: true, judgment: true }, threshold: 100 }, indexCases(cases)))
console.log(ok ? '\nTODO BIEN' : '\nHAY FALLAS')
process.exit(ok ? 0 : 1)
