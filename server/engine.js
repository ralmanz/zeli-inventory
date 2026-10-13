// Motor del cierre: cruce, revisión de causas contra documentos y propuesta por diferencia.
// Todo es código determinista; el modelo de lenguaje solo redacta (ver ai.js).

import { CAUSES, SHORTAGE, SURPLUS, CATEGORY } from '../src/shared/logic.js'

/* ---------- normalización ---------- */
export function normCode(v) {
  if (v == null) return ''
  let s = String(v).trim().toUpperCase().replace(/\s+/g, ' ')
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '')
  if (/^0+\d+$/.test(s)) s = s.replace(/^0+/, '')
  return s
}

export function num(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim()
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/[$\s]/g, '')
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,50
  else s = s.replace(/,/g, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

/** Fecha "ingenua" (hora local del negocio) a milisegundos, tratando los componentes como UTC. */
export function ts(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return Math.round((v - 25569) * 86400000) // serial de Excel
    return null
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?)?/i)
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000
    let h = +(m[4] || 0)
    const ap = (m[7] || '').toLowerCase()
    if (ap.startsWith('p') && h < 12) h += 12
    if (ap.startsWith('a') && h === 12) h = 0
    return Date.UTC(y, +m[2] - 1, +m[1], h, +(m[5] || 0), +(m[6] || 0))
  }
  return null
}

export function fmtDate(t) {
  if (t == null) return ''
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  const base = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
  return d.getUTCHours() || d.getUTCMinutes() ? `${base} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : base
}

function truthy(v) {
  if (v == null || v === '') return null
  const s = String(v).trim().toLowerCase()
  if (['si', 'sí', 's', 'yes', 'y', '1', 'true', 'aprobado', 'autorizado', 'x', 'recibido', 'completo'].includes(s)) return true
  if (['no', 'n', '0', 'false', 'pendiente', 'rechazado', 'en transito', 'en tránsito', 'abierto'].includes(s)) return false
  return null
}

const STOP = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'para', 'en', 'x', 'por', 'a', 'unid', 'und', 'u'])
function tokens(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9½¼¾]+/).filter((t) => t && !STOP.has(t))
}
export function similarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  A.forEach((t) => { if (B.has(t)) inter++ })
  return inter / Math.min(A.size, B.size)
}

function clean(rows, fields) {
  return (rows || []).map((r) => {
    const o = { ...r }
    o.code = normCode(r.code)
    if ('qty' in r || fields.includes('qty')) o.qty = num(r.qty)
    if (r.cost != null) o.cost = num(r.cost)
    if (r.pack != null) o.pack = num(r.pack)
    if (r.supplier_qty != null) o.supplier_qty = num(r.supplier_qty)
    if (r.date != null) o.t = ts(r.date)
    if (r.doc_ref != null) o.doc_ref = String(r.doc_ref).trim()
    if (r.invoice_ref != null) o.invoice_ref = String(r.invoice_ref).trim()
    if (r.barcode != null) o.barcode = normCode(r.barcode)
    return o
  }).filter((r) => r.code)
}

function groupBy(rows, key = 'code') {
  const m = new Map()
  for (const r of rows) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return m
}
const sum = (rows, f = 'qty') => rows.reduce((s, r) => s + (Number(r[f]) || 0), 0)
const round2 = (n) => Math.round(n * 100) / 100
const fmtN = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US')

/* ---------- análisis ---------- */
export function analyze(datasets, meta = {}) {
  const has = (k) => !!(datasets[k] && datasets[k].rows && datasets[k].rows.length)
  const D = {}
  for (const k of Object.keys(datasets)) D[k] = clean(datasets[k].rows, Object.keys((datasets[k].rows || [])[0] || {}))
  const cutoff = ts(meta.cutoff)
  const windowMs = (Number(meta.cutoffWindowHours) || 24) * 3600000

  const bal = new Map()
  for (const r of D.balances || []) {
    const cur = bal.get(r.code) || { qty: 0, cost: null, desc: '' }
    cur.qty += r.qty || 0
    if (r.cost != null) cur.cost = r.cost
    if (r.desc) cur.desc = String(r.desc)
    bal.set(r.code, cur)
  }
  const master = new Map()
  const byBarcode = new Map()
  for (const r of D.master || []) {
    master.set(r.code, r)
    if (r.barcode) byBarcode.set(r.barcode, r.code)
  }
  const cnt = new Map()
  for (const r of D.count || []) {
    const cur = cnt.get(r.code) || { qty: 0, locs: new Set(), notes: [], desc: '', lines: [] }
    cur.qty += r.qty || 0
    if (r.location) cur.locs.add(String(r.location))
    if (r.note) cur.notes.push(String(r.note))
    if (r.desc) cur.desc = String(r.desc)
    cur.lines.push(r)
    cnt.set(r.code, cur)
  }

  const descOf = (code) => (bal.get(code) && bal.get(code).desc) || (master.get(code) && master.get(code).desc) || (cnt.get(code) && cnt.get(code).desc) || ''
  const costOf = (code) => {
    const b = bal.get(code); if (b && b.cost != null) return b.cost
    const m = master.get(code); if (m && m.cost != null) return m.cost
    return 0
  }

  /* artículos encontrados en el conteo que el sistema no conoce */
  const found = []
  const codes = new Set([...bal.keys(), ...cnt.keys()])
  for (const code of cnt.keys()) {
    if (bal.has(code) || master.has(code)) continue
    codes.delete(code)
    const c = cnt.get(code)
    const viaBarcode = byBarcode.get(code)
    found.push({ code, qty: c.qty, loc: [...c.locs].join(', '), notes: c.notes, matchCode: viaBarcode || null, match: viaBarcode ? `El código de barras pertenece a ${viaBarcode}` : '' })
  }

  /* diferencias */
  const partial = !!meta.partialCount
  let cases = []
  for (const code of codes) {
    const sys = bal.has(code) ? round2(bal.get(code).qty) : 0
    if (partial && !cnt.has(code)) continue
    const phys = cnt.has(code) ? round2(cnt.get(code).qty) : 0
    const diff = round2(phys - sys)
    if (!diff) continue
    cases.push({ code, desc: descOf(code), loc: cnt.has(code) ? [...cnt.get(code).locs].join(', ') : '', sys, phys, diff, cost: costOf(code), countNotes: cnt.has(code) ? cnt.get(code).notes : [] })
  }

  /* índices de documentos */
  const K = groupBy(D.kardex || [])
  const kardexDocs = new Map() // code -> Map(doc_ref -> rows)
  for (const [code, rows] of K) kardexDocs.set(code, groupBy(rows.filter((r) => r.doc_ref), 'doc_ref'))
  const INV = groupBy(D.invoices || []), DIS = groupBy(D.dispatches || []), REC = groupBy(D.receipts || [])
  const TRF = groupBy(D.transfers || []), RET = groupBy(D.returns || []), ADJ = groupBy(D.adjustments || [])
  const before = (r) => cutoff == null || r.t == null || r.t <= cutoff
  const after = (r) => cutoff != null && r.t != null && r.t > cutoff && r.t <= cutoff + windowMs

  const adjHasApproval = (D.adjustments || []).some((r) => r.approved != null && r.approved !== '')
  const recHasSupplier = (D.receipts || []).some((r) => r.supplier_qty != null)
  const kardexHasDates = (D.kardex || []).some((r) => r.t != null)

  const avail = {
    'Facturado, no despachado': has('invoices') && has('dispatches'),
    'Recibido, no registrado': has('receipts') && has('kardex'),
    'Error de despacho (picking)': has('invoices') && has('dispatches'),
    'Error al recibir del proveedor': has('receipts') && recHasSupplier,
    'Transferencia desconocida o en tránsito': has('transfers'),
    'Devolución mal procesada': has('returns') && has('kardex'),
    'Ajuste sin aprobar': has('adjustments') && adjHasApproval,
    'Merma o vencido sin dar de baja': has('adjustments') && has('kardex'),
    'Cruce de referencias': true,
    'Error de código o maestro': true,
    'Unidad de medida': has('master') && (D.master || []).some((r) => r.pack > 1),
    'Movimiento durante el corte': cutoff != null && ((has('kardex') && kardexHasDates) || has('receipts') || has('invoices')),
  }
  const missingWhy = {
    'Facturado, no despachado': 'Faltan facturas o guías de despacho.',
    'Recibido, no registrado': 'Faltan recepciones o kardex.',
    'Error de despacho (picking)': 'Faltan facturas o guías de despacho.',
    'Error al recibir del proveedor': 'Las recepciones no traen la cantidad según el proveedor.',
    'Transferencia desconocida o en tránsito': 'No se subió el archivo de transferencias.',
    'Devolución mal procesada': 'Faltan devoluciones o kardex.',
    'Ajuste sin aprobar': 'Los ajustes no indican si fueron aprobados.',
    'Merma o vencido sin dar de baja': 'Faltan ajustes/bajas o kardex.',
    'Unidad de medida': 'El maestro no trae unidades por empaque.',
    'Movimiento durante el corte': 'Falta la hora de corte o documentos con fecha.',
  }

  const ev = (source, r, detail) => [source, r.doc_ref || r.invoice_ref || '—', detail]

  function checksFor(c) {
    const out = [] // {cause, qty, evidence:[], why, kind}
    const code = c.code
    const inv = INV.get(code) || [], dis = DIS.get(code) || [], rec = REC.get(code) || []
    const kd = kardexDocs.get(code) || new Map()

    // 1. Facturado, no despachado (+)
    if (avail['Facturado, no despachado']) {
      const dispatchedInv = new Set(dis.filter(before).map((r) => r.invoice_ref))
      const pend = inv.filter(before).filter((r) => !dispatchedInv.has(r.doc_ref))
      const q = sum(pend)
      out.push({ cause: 'Facturado, no despachado', qty: q, evidence: pend.slice(0, 6).map((r) => ev('Facturas', r, `${fmtDate(r.t)} · ${r.qty} sin guía de despacho al corte`)),
        found: `${pend.length} factura(s) por ${q} sin guía al corte.`, none: 'Ninguna factura de este artículo sin guía al corte.' })
    }
    // 2. Recibido, no registrado (+)
    if (avail['Recibido, no registrado']) {
      const pend = rec.filter(before).filter((r) => !kd.has(r.doc_ref))
      const q = sum(pend)
      out.push({ cause: 'Recibido, no registrado', qty: q, evidence: pend.slice(0, 6).map((r) => ev('Recepciones', r, `${fmtDate(r.t)} · ${r.qty} sin entrada en el kardex`)),
        found: `${pend.length} recepción(es) por ${q} sin entrada en el kardex.`, none: 'Todas las recepciones están en el kardex.' })
    }
    // 3. Error de despacho: se despachó distinto a lo facturado (despacho de más => faltante)
    if (avail['Error de despacho (picking)']) {
      const invByRef = groupBy(inv, 'doc_ref')
      let excess = 0; const evid = []
      for (const [ref, rows] of groupBy(dis.filter(before), 'invoice_ref')) {
        const iq = sum(invByRef.get(ref) || [])
        if (!invByRef.has(ref)) continue
        const dq = sum(rows)
        if (dq !== iq) { excess += dq - iq; evid.push(['Guías', rows[0].doc_ref || ref, `Despachó ${dq}; la factura ${ref} dice ${iq}`]) }
      }
      out.push({ cause: 'Error de despacho (picking)', qty: -excess, evidence: evid.slice(0, 6),
        found: `Guías y facturas difieren en ${Math.abs(excess)}.`, none: 'Guías y facturas coinciden en cantidad.' })
    }
    // 4. Error al recibir del proveedor: se registró más de lo que llegó
    if (avail['Error al recibir del proveedor']) {
      const rows = rec.filter((r) => r.supplier_qty != null && r.qty !== r.supplier_qty)
      const over = rows.reduce((s, r) => s + (r.qty - r.supplier_qty), 0)
      out.push({ cause: 'Error al recibir del proveedor', qty: -over, evidence: rows.slice(0, 6).map((r) => ev('Recepciones', r, `Registró ${r.qty}; el proveedor entregó ${r.supplier_qty}`)),
        found: `Recepciones difieren de la guía del proveedor en ${Math.abs(over)}.`, none: 'Recepciones iguales a la guía del proveedor.' })
    }
    // 5. Transferencias pendientes
    if (avail['Transferencia desconocida o en tránsito']) {
      const rows = (TRF.get(code) || []).filter((r) => truthy(r.status) !== true)
      const q = sum(rows)
      out.push({ cause: 'Transferencia desconocida o en tránsito', qty: q, abs: true, evidence: rows.slice(0, 6).map((r) => ev('Transferencias', r, `${fmtDate(r.t)} · ${r.qty} ${r.status ? '· ' + r.status : 'sin confirmar'}`)),
        found: `${rows.length} transferencia(s) sin confirmar por ${q}.`, none: 'Sin transferencias pendientes.' })
    }
    // 6. Devolución: duplicada (+sistema) o no registrada (+físico)
    if (avail['Devolución mal procesada']) {
      let dup = 0, missing = 0; const evid = []
      for (const r of RET.get(code) || []) {
        const k = kd.get(r.doc_ref) || []
        if (k.length > 1) { dup += sum(k.slice(1)); evid.push(['Devoluciones', r.doc_ref, `Registrada ${k.length} veces en el kardex`]) }
        if (!k.length && before(r)) { missing += r.qty || 0; evid.push(['Devoluciones', r.doc_ref, `${r.qty} sin entrada en el kardex`]) }
      }
      out.push({ cause: 'Devolución mal procesada', qty: missing - dup, evidence: evid.slice(0, 6),
        found: dup ? `Devolución registrada de más por ${dup}.` : `Devolución sin registrar por ${missing}.`, none: 'Sin devoluciones con problemas.' })
    }
    // 7. Ajuste sin aprobar: revertirlo explica la diferencia
    if (avail['Ajuste sin aprobar']) {
      const rows = (ADJ.get(code) || []).filter((r) => truthy(r.approved) === false && kd.has(r.doc_ref || '__'))
      const q = sum(rows)
      out.push({ cause: 'Ajuste sin aprobar', qty: -q, evidence: rows.slice(0, 6).map((r) => ev('Ajustes', r, `${fmtDate(r.t)} · ${r.qty} sin aprobación${r.reason ? ' · ' + r.reason : ''}`)),
        found: `Ajuste(s) sin aprobar por ${q}.`, none: 'Sin ajustes sin aprobar.' })
    }
    // 8. Merma: baja reportada que no llegó al kardex
    if (avail['Merma o vencido sin dar de baja']) {
      const rows = (ADJ.get(code) || []).filter((r) => /da[ñn]|venc|merma|rot|desech|perdid/i.test(String(r.reason || r.doc_type || '')) && !kd.has(r.doc_ref || '__'))
      const q = sum(rows.map((r) => ({ qty: -Math.abs(r.qty || 0) })))
      out.push({ cause: 'Merma o vencido sin dar de baja', qty: q, evidence: rows.slice(0, 6).map((r) => ev('Ajustes / bajas', r, `${fmtDate(r.t)} · ${Math.abs(r.qty)} ${r.reason || ''} sin registrar en el kardex`)),
        found: `Baja(s) por ${Math.abs(q)} sin registrar.`, none: 'Sin reportes de daño pendientes.' })
    }
    // 12. Movimientos después del corte que el conteo sí refleja
    if (avail['Movimiento durante el corte']) {
      let q = 0; const evid = []
      if (has('kardex') && kardexHasDates) {
        for (const r of (K.get(code) || []).filter(after)) { q += r.qty || 0; evid.push(['Kardex', r.doc_ref || '—', `${fmtDate(r.t)} · ${fmtN(r.qty)} después del corte`]) }
      } else {
        for (const r of rec.filter(after)) { q += r.qty || 0; evid.push(['Recepciones', r.doc_ref, `${fmtDate(r.t)} · ${r.qty} después del corte`]) }
      }
      out.push({ cause: 'Movimiento durante el corte', qty: q, evidence: evid.slice(0, 6),
        found: `Movimientos por ${fmtN(q)} justo después del corte.`, none: 'Sin movimientos justo después del corte.' })
    }
    // 11. Unidad de medida
    if (avail['Unidad de medida']) {
      const m = master.get(code)
      const pack = m && m.pack > 1 ? m.pack : null
      const hit = pack && Math.abs(c.diff) % pack === 0
      out.push({ cause: 'Unidad de medida', judgment: true, qty: hit ? c.diff : 0,
        evidence: hit ? [['Maestro', code, `Empaque de ${pack}: la diferencia es ${Math.abs(c.diff) / pack} empaque(s)`]] : [],
        found: `${fmtN(c.diff)} = ${Math.abs(c.diff) / (pack || 1)} empaque(s) de ${pack}.`, none: pack ? `No es múltiplo del empaque de ${pack}.` : 'Sin empaque en el maestro.' })
    }
    return out
  }

  const byCode = new Map(cases.map((c) => [c.code, c]))

  /* cruce de referencias: pares con diferencia contraria, costo y descripción parecidos */
  const pairs = []
  const neg = cases.filter((c) => c.diff < 0), pos = cases.filter((c) => c.diff > 0)
  for (const a of neg) {
    for (const b of pos) {
      const qa = Math.abs(a.diff), qb = b.diff
      if (Math.abs(qa - qb) > Math.max(1, 0.05 * qa)) continue
      const ca = a.cost || 0, cb = b.cost || 0
      if (ca && cb && Math.abs(ca - cb) / Math.max(ca, cb) > 0.15) continue
      const sim = similarity(a.desc, b.desc)
      const sameLoc = a.loc && b.loc && a.loc === b.loc
      const score = sim + (sameLoc ? 0.3 : 0) + (qa === qb ? 0.2 : 0)
      if (sim >= 0.5 || (sim >= 0.34 && sameLoc)) pairs.push({ a: a.code, b: b.code, score, sim, sameLoc })
    }
  }
  pairs.sort((x, y) => y.score - x.score)
  const paired = new Map()
  for (const p of pairs) {
    if (paired.has(p.a) || paired.has(p.b)) continue
    paired.set(p.a, p); paired.set(p.b, p)
  }

  /* código desconocido del conteo que explica un faltante */
  const foundFor = new Map()
  for (const f of found) {
    let target = f.matchCode && byCode.get(f.matchCode)
    if (!target) {
      target = neg.find((c) => Math.abs(c.diff) === f.qty && !foundFor.has(c.code) && (!f.loc || !c.loc || c.loc === f.loc))
    }
    if (target && target.diff < 0) {
      foundFor.set(target.code, f)
      f.matchCode = target.code
      f.match = f.match || `Coincide con el faltante de ${target.code} ${target.desc} (${fmtN(target.diff)})`
    }
  }

  cases = cases.map((c) => {
    const results = checksFor(c)
    const checks = []
    const hits = []
    for (const cause of CAUSES) {
      if (cause === 'Cruce de referencias') {
        const p = paired.get(c.code)
        if (p) {
          const other = byCode.get(p.a === c.code ? p.b : p.a)
          hits.push({ cause, kind: 'criterio', exact: true, evidence: [['Conteo físico', other.code, `${other.desc}: ${fmtN(other.diff)}${p.sameLoc ? ' en la misma ubicación' : ''}`]], pair: other.code,
            found: `${other.code} ${other.desc} tiene ${fmtN(other.diff)}: descripción parecida${p.sameLoc ? ', misma ubicación' : ''} y costo similar.` })
          checks.push(['Encontrada', cause, hits[hits.length - 1].found])
        } else checks.push(['Descartada', cause, 'Ningún artículo parecido con la diferencia contraria.'])
        continue
      }
      if (cause === 'Error de código o maestro') {
        const f = foundFor.get(c.code)
        if (f) {
          const strong = !!(master.get(c.code) && master.get(c.code).barcode === f.code)
          hits.push({ cause, kind: strong ? 'doc' : 'criterio', exact: f.qty === Math.abs(c.diff), evidence: [['Notas del conteo', f.code, `${f.qty} unidades con código desconocido${f.loc ? ' en ' + f.loc : ''}`]],
            found: `Se contaron ${f.qty} unidades con el código ${f.code}, que el sistema no conoce.` })
          checks.push(['Encontrada', cause, hits[hits.length - 1].found])
        } else checks.push(['Descartada', cause, 'Sin códigos desconocidos que coincidan.'])
        continue
      }
      if (!avail[cause]) { checks.push(['No verificable', cause, missingWhy[cause]]); continue }
      const r = results.find((x) => x.cause === cause)
      if (!r || !r.qty) { checks.push(['Descartada', cause, r ? r.none : '']); continue }
      const sameSign = Math.sign(r.qty) === Math.sign(c.diff) || r.abs
      const q = r.abs ? Math.sign(c.diff) * Math.abs(r.qty) : r.qty
      if (!sameSign) { checks.push(['Descartada', cause, 'Hay documentos, pero en sentido contrario a la diferencia.']); continue }
      const exact = Math.abs(q - c.diff) < 1e-9
      const partialQty = Math.min(Math.abs(q), Math.abs(c.diff))
      hits.push({ cause, kind: r.judgment ? 'criterio' : 'doc', exact, explained: Math.sign(c.diff) * partialQty, evidence: r.evidence, found: r.found })
      checks.push(['Encontrada', cause, exact ? r.found : `${r.found} Explica ${partialQty} de ${Math.abs(c.diff)}.`])
    }

    const order = (h) => (h.exact ? 0 : 2) + (h.kind === 'doc' ? 0 : 1)
    hits.sort((x, y) => order(x) - order(y))
    const best = hits[0]
    let cause, kind, evidence, summary, explain, pair = null
    const countEv = [['Conteo físico', c.code, `${c.phys} contadas${c.loc ? ' · ' + c.loc : ''}; sistema ${c.sys}`]]
    if (best && (best.exact || best.cause === 'Cruce de referencias')) {
      cause = best.cause; kind = best.kind; evidence = [...countEv, ...best.evidence]; pair = best.pair || null
      summary = best.found
      explain = best.found
    } else if (best) {
      cause = best.cause; kind = 'criterio'; evidence = [...countEv, ...best.evidence]
      summary = `${best.found} No explica toda la diferencia.`
      explain = `${best.found} Quedan ${Math.abs(c.diff) - Math.abs(best.explained)} sin documento: revisar antes de proponer.`
    } else {
      cause = c.diff < 0 ? SHORTAGE : SURPLUS; kind = 'none'; evidence = countEv
      summary = 'Ningún documento explica la diferencia'
      explain = `Se revisaron las causas posibles con los archivos subidos y ninguna explica la diferencia de ${fmtN(c.diff)}.`
    }
    if (c.countNotes && c.countNotes.length) evidence.push(['Notas del conteo', c.code, c.countNotes.join(' · ')])
    return { ...c, cause, kind, pair, summary, explain, evidence, checks, alternatives: hits.slice(1, 4).map((h) => h.cause), category: CATEGORY[cause] }
  })

  // un par de cruce debe quedar con la misma causa en ambos lados
  for (const c of cases) {
    if (c.pair) {
      const o = cases.find((x) => x.code === c.pair)
      if (o && !o.pair) { o.pair = c.code; o.cause = 'Cruce de referencias'; o.kind = 'criterio' }
    }
  }

  const coverage = Object.fromEntries(CAUSES.map((k) => [k, !!avail[k]]))
  return {
    at: new Date().toISOString(),
    totals: { countLines: (D.count || []).length, countItems: cnt.size, balanceItems: bal.size, kardexAfterCutoff: cutoff == null ? 0 : (D.kardex || []).filter((r) => r.t != null && r.t > cutoff).length },
    coverage,
    files: Object.fromEntries(Object.keys(datasets).map((k) => [k, (datasets[k].rows || []).length])),
    cases,
    found,
  }
}
