// Qué archivos acepta un cierre y qué columnas necesita cada uno.

/** @type {Record<string, {label: string, syn: string[]}>} */
export const FIELDS = {
  code: { label: 'Código del artículo', syn: ['codigo', 'cod', 'sku', 'item', 'referencia', 'ref articulo', 'material', 'part', 'id articulo', 'codigo articulo', 'cod art'] },
  qty: { label: 'Cantidad', syn: ['cantidad', 'cant', 'qty', 'conteo', 'contado', 'fisico', 'existencia', 'saldo', 'stock', 'unidades', 'quantity'] },
  cost: { label: 'Costo unitario', syn: ['costo unitario', 'costo', 'cost', 'costo prom', 'costo promedio', 'cu', 'valor unitario', 'precio costo'] },
  desc: { label: 'Descripción', syn: ['descripcion', 'nombre', 'articulo', 'producto', 'detalle', 'description', 'desc'] },
  location: { label: 'Ubicación', syn: ['ubicacion', 'pasillo', 'bodega', 'almacen', 'location', 'zona', 'estante', 'rack'] },
  note: { label: 'Nota del conteo', syn: ['nota', 'observacion', 'comentario', 'obs', 'notes'] },
  date: { label: 'Fecha y hora', syn: ['fecha', 'date', 'fec', 'fecha hora', 'timestamp'] },
  doc_ref: { label: 'Número de documento', syn: ['documento', 'numero', 'no documento', 'num doc', 'doc', 'comprobante', 'folio', 'factura', 'guia', 'recepcion', 'nota credito', 'nota de credito', 'nc', 'devolucion', 'ajuste', 'transferencia', 'traslado', 'no'] },
  doc_type: { label: 'Tipo de documento', syn: ['tipo', 'tipo doc', 'tipo documento', 'concepto', 'movimiento', 'transaccion'] },
  invoice_ref: { label: 'Factura relacionada', syn: ['factura', 'no factura', 'ref factura', 'factura relacionada', 'invoice'] },
  pack: { label: 'Unidades por empaque', syn: ['empaque', 'unidades por caja', 'unid caja', 'pack', 'factor', 'contenido', 'multiplo'] },
  barcode: { label: 'Código de barras', syn: ['codigo de barras', 'barras', 'barcode', 'ean', 'upc'] },
  supplier_qty: { label: 'Cantidad según proveedor', syn: ['cantidad proveedor', 'cant guia', 'guia proveedor', 'cantidad guia', 'cant proveedor'] },
  approved: { label: 'Aprobado (sí/no)', syn: ['aprobado', 'autorizado', 'aprobacion', 'approved'] },
  reason: { label: 'Motivo', syn: ['motivo', 'razon', 'causa', 'reason'] },
  status: { label: 'Estado', syn: ['estado', 'status', 'recibido'] },
}

export const KINDS = [
  { kind: 'count', title: 'Conteo físico', required: true, fields: ['code', 'qty', 'location', 'note', 'desc'], need: ['code', 'qty'],
    enables: 'el cruce y los artículos encontrados en el conteo' },
  { kind: 'balances', title: 'Saldos del sistema al corte', required: true, fields: ['code', 'qty', 'cost', 'desc'], need: ['code', 'qty'],
    enables: 'el cruce y el valor de cada diferencia' },
  { kind: 'master', title: 'Maestro de artículos', fields: ['code', 'desc', 'pack', 'barcode', 'cost'], need: ['code'],
    enables: 'cruce de referencias, código o maestro, unidad de medida' },
  { kind: 'kardex', title: 'Kardex / movimientos', fields: ['code', 'qty', 'date', 'doc_ref', 'doc_type'], need: ['code', 'qty', 'doc_ref'],
    enables: 'recibido sin registrar, devoluciones, mermas, movimientos durante el corte' },
  { kind: 'invoices', title: 'Facturas de venta (líneas)', fields: ['code', 'qty', 'doc_ref', 'date'], need: ['code', 'qty', 'doc_ref'],
    enables: 'facturado no despachado, error de despacho' },
  { kind: 'dispatches', title: 'Guías de despacho (líneas)', fields: ['code', 'qty', 'invoice_ref', 'doc_ref', 'date'], need: ['code', 'qty', 'invoice_ref'],
    enables: 'facturado no despachado, error de despacho' },
  { kind: 'receipts', title: 'Recepciones de compra (líneas)', fields: ['code', 'qty', 'doc_ref', 'date', 'supplier_qty'], need: ['code', 'qty', 'doc_ref'],
    enables: 'recibido sin registrar, error al recibir del proveedor' },
  { kind: 'transfers', title: 'Transferencias', fields: ['code', 'qty', 'doc_ref', 'date', 'status'], need: ['code', 'qty'],
    enables: 'transferencias desconocidas o en tránsito' },
  { kind: 'returns', title: 'Devoluciones / notas de crédito', fields: ['code', 'qty', 'doc_ref', 'date'], need: ['code', 'qty', 'doc_ref'],
    enables: 'devolución mal procesada' },
  { kind: 'adjustments', title: 'Ajustes y bajas', fields: ['code', 'qty', 'doc_ref', 'date', 'approved', 'reason'], need: ['code', 'qty'],
    enables: 'ajuste sin aprobar, merma sin dar de baja' },
]

/** @type {Record<string, any>} */
export const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k]))

export function normHeader(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Sugiere qué columna corresponde a cada campo, por nombre. */
export function suggestMapping(kind, headers) {
  const spec = KIND[kind]
  if (!spec) return {}
  const H = headers.map(normHeader)
  const used = new Set()
  const out = {}
  // primero los campos obligatorios, para que no les roben la columna
  const order = [...spec.need, ...spec.fields.filter((f) => !spec.need.includes(f))]
  for (const f of order) {
    let best = -1, bestScore = 0
    H.forEach((h, i) => {
      if (used.has(i) || !h) return
      let score = 0
      for (const syn of FIELDS[f].syn) {
        if (h === syn) score = Math.max(score, 3)
        else if (h.startsWith(syn + ' ') || h.endsWith(' ' + syn)) score = Math.max(score, 2)
        else if (syn.length > 3 && h.includes(syn)) score = Math.max(score, 1)
      }
      if (score > bestScore) { bestScore = score; best = i }
    })
    if (best >= 0) { out[f] = best; used.add(best) }
  }
  return out
}

/** Primera fila que parece encabezado: al menos 2 textos no vacíos. */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i] || []
    const texts = r.filter((x) => typeof x === 'string' && x.trim() && isNaN(Number(x)))
    if (texts.length >= 2) return i
  }
  return 0
}
