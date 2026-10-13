// Reglas compartidas entre el navegador y el servidor.
// Una diferencia ("caso") viene del análisis; las decisiones de las personas se guardan aparte, por código.

export const CAUSES = [
  'Facturado, no despachado',
  'Recibido, no registrado',
  'Error de despacho (picking)',
  'Error al recibir del proveedor',
  'Transferencia desconocida o en tránsito',
  'Devolución mal procesada',
  'Ajuste sin aprobar',
  'Merma o vencido sin dar de baja',
  'Cruce de referencias',
  'Error de código o maestro',
  'Unidad de medida',
  'Movimiento durante el corte',
]
export const SHORTAGE = 'Faltante real'
export const SURPLUS = 'Sobrante sin documento'
export const ALL_CAUSES = [...CAUSES, SHORTAGE, SURPLUS]

/** @type {Record<string, string>} */
export const CATEGORY = {
  'Facturado, no despachado': 'Corrección de registro',
  'Recibido, no registrado': 'Corrección de registro',
  'Error de despacho (picking)': 'Por reclamar a cliente',
  'Error al recibir del proveedor': 'Por reclamar a proveedor',
  'Transferencia desconocida o en tránsito': 'Corrección de registro',
  'Devolución mal procesada': 'Corrección de registro',
  'Ajuste sin aprobar': 'Corrección de registro',
  'Merma o vencido sin dar de baja': 'Merma (gasto)',
  'Cruce de referencias': 'Reclasificación entre artículos',
  'Error de código o maestro': 'Corrección de registro',
  'Unidad de medida': 'Corrección de registro',
  'Movimiento durante el corte': 'Corrección de registro',
  [SHORTAGE]: 'Faltante (gasto)',
  [SURPLUS]: 'Sobrante (ingreso)',
}

export const DEFAULT_RULES = { noDoc: true, shortage: true, judgment: true, blind: true }

const round2 = (n) => Math.round(n * 100) / 100

/** Une el análisis con las decisiones y devuelve casos listos para mostrar. */
export function mergeCases(analysis, decisions) {
  const list = (analysis && analysis.cases) || []
  const dec = decisions || {}
  return list.map((c) => {
    const d = dec[c.code] || {}
    const status = d.status || (c.kind === 'doc' ? 'propuesta' : 'revisar')
    return {
      ...c,
      originalCause: c.cause,
      cause: d.cause || c.cause,
      status,
      note: d.note || '',
      recount: d.recount == null ? null : d.recount,
      approval: d.approval || null,
      returnNote: d.returnNote || '',
      proposedBy: d.proposedBy || (c.kind === 'doc' && !d.status ? 'auto' : null),
    }
  })
}

export function indexCases(cases) {
  const m = {}
  cases.forEach((c) => { m[c.code] = c })
  return m
}

export function value(c) { return round2(c.diff * c.cost) }

export function recountOutcome(c) {
  if (c.recount == null || c.recount === '') return null
  const r = Number(c.recount)
  if (r === c.sys) return 'sistema'
  if (r === c.phys) return 'conteo'
  return 'otro'
}

export function recountRequired(c, meta, byCode) {
  if (c.status === 'cerrada') return false
  const rules = (meta && meta.rules) || DEFAULT_RULES
  const threshold = Number((meta && meta.threshold) || 100)
  if (rules.noDoc && c.kind === 'none') return true
  if (rules.shortage && c.cause === SHORTAGE) return true
  if (rules.judgment && c.kind === 'criterio' && Math.abs(value(c)) > threshold) return true
  if (c.pair && byCode) {
    const p = byCode[c.pair]
    if (p && rules.judgment && p.kind === 'criterio' && Math.abs(value(p)) > threshold) return true
  }
  return false
}

function readyOne(c, meta, byCode) {
  const o = recountOutcome(c)
  return !recountRequired(c, meta, byCode) || o === 'conteo' || o === 'otro'
}

export function canPropose(c, meta, byCode) {
  if (c.status === 'cerrada') return false
  if (!readyOne(c, meta, byCode)) return false
  if (c.pair && byCode) {
    const p = byCode[c.pair]
    if (p && p.status !== 'cerrada' && !readyOne(p, meta, byCode)) return false
  }
  return true
}

export function finalQty(c) {
  if (recountOutcome(c) === 'otro') return Number(c.recount) - c.sys
  return c.diff
}
export function finalValue(c) { return round2(finalQty(c) * c.cost) }

export function needsAttention(c) {
  return c.status === 'propuesta' && (
    c.kind !== 'doc' || c.cause !== c.originalCause || c.cause === SHORTAGE || c.cause === SURPLUS || recountOutcome(c) === 'otro'
  )
}

export function inAdjustment(c) {
  return c.status === 'propuesta' && c.approval !== 'devuelta' && finalQty(c) !== 0
}

export function adjustmentLines(cases) {
  return sortByValue(cases.filter(inAdjustment))
}

export function adjustmentTotal(cases) {
  return round2(cases.filter(inAdjustment).reduce((s, c) => s + finalValue(c), 0))
}

export function sortByValue(cases) {
  return cases.slice().sort((a, b) => Math.abs(value(b)) - Math.abs(value(a)))
}

export function statusLabel(c, meta, byCode) {
  if (c.approval === 'devuelta') return { t: 'Devuelta', c: 't-r' }
  if (c.status === 'cerrada') return { t: 'Cerrada sin ajuste', c: 't-g' }
  if (c.status === 'propuesta') return { t: c.approval === 'aceptada' ? 'Aceptada' : 'Propuesta', c: 't-g' }
  if (recountRequired(c, meta, byCode) && !recountOutcome(c)) return { t: 'En recuento', c: 't-y' }
  return { t: 'Por revisar', c: 't-b' }
}

export function baseLabel(c) {
  if (c.status === 'cerrada') return { t: 'Error de conteo', c: 't-g' }
  if (c.kind === 'doc') return { t: 'Documento', c: 't-g' }
  if (c.kind === 'criterio') return { t: 'Criterio', c: 't-b' }
  return { t: 'Sin documento', c: 't-r' }
}

export function stats(cases, meta, byCode) {
  const s = { n: cases.length, short: 0, over: 0, net: 0, doc: 0, crit: 0, rec: 0, none: 0, prop: 0, closed: 0 }
  cases.forEach((c) => {
    const v = value(c)
    if (v < 0) s.short += v; else s.over += v
    if (c.status === 'cerrada') { s.closed++; s.doc++; return }
    if (c.status === 'propuesta') s.prop++
    if (recountRequired(c, meta, byCode) && !recountOutcome(c)) { s.rec++; return }
    if (c.kind === 'doc') s.doc++
    else if (c.kind === 'criterio') s.crit++
    else s.none++
  })
  s.short = round2(s.short); s.over = round2(s.over); s.net = round2(s.short + s.over)
  return s
}

/** Nombre corto de quien aprueba (antes del primer " · "). */
export function shortName(s) { return String(s || '').split(' · ')[0].trim() }

export function selfApproval(meta) {
  const a = shortName(meta && meta.approver)
  const i = shortName(meta && meta.investigator)
  return !a || a.toLowerCase() === i.toLowerCase()
}
