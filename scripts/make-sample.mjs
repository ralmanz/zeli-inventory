// Genera archivos de ejemplo (CSV) con forma de exportación de un ERP local,
// con diferencias plantadas para probar cada causa. Uso: node scripts/make-sample.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const out = new URL('../public/ejemplo/', import.meta.url)
mkdirSync(out, { recursive: true })

const items = [
  ['PIN-LB-01', 'Pintura látex blanco galón', 22.5, 'Pasillo 4-B', 1],
  ['PIN-LBH-01', 'Pintura látex blanco hueso galón', 22.5, 'Pasillo 4-B', 1],
  ['TOR-DW-61', 'Tornillo drywall 6x1 caja 1000', 9.8, 'Pasillo 1-A', 1],
  ['TAL-PER-12', 'Taladro percutor 1/2 650W', 54, 'Pasillo 6-A', 1],
  ['PVC-12-6M', 'Tubo PVC 1/2 x 6 m', 2.4, 'Patio', 1],
  ['CIN-TEF-34', 'Cinta teflón 3/4', 0.35, 'Pasillo 2-B', 144],
  ['DIS-CO-45', 'Disco de corte 4 1/2', 1.85, 'Pasillo 5-A', 1],
  ['BRK-20A-1P', 'Breaker 20A 1 polo', 6.9, 'Pasillo 3-C', 1],
  ['CAB-THHN-12', 'Cable THHN 12 rollo 100 m', 38, 'Pasillo 3-D', 1],
  ['LLV-PAS-12', 'Llave de paso 1/2 bronce', 7.5, 'Pasillo 2-C', 1],
  ['SIL-TRA-300', 'Silicón transparente 300 ml', 3.2, 'Pasillo 5-C', 1],
  ['BRO-14', 'Broca 1/4 acero', 1.1, 'Pasillo 5-A', 1],
  ['GUA-NIT-M', 'Guantes nitrilo caja 100', 8.4, 'Pasillo 7-B', 1],
  ['FOC-LED-9', 'Foco LED 9W', 1.6, 'Pasillo 7-A', 1],
]
// 40 artículos sin diferencia para que el archivo parezca real
for (let i = 1; i <= 40; i++) items.push([`ART-${String(i).padStart(3, '0')}`, `Artículo de relleno ${i}`, 1 + (i % 9), `Pasillo ${1 + (i % 7)}-${'ABCD'[i % 4]}`, 1])

const sys = { 'PIN-LB-01': 120, 'PIN-LBH-01': 48, 'TOR-DW-61': 96, 'TAL-PER-12': 14, 'PVC-12-6M': 310, 'CIN-TEF-34': 1440, 'DIS-CO-45': 200, 'BRK-20A-1P': 64, 'CAB-THHN-12': 20, 'LLV-PAS-12': 40, 'SIL-TRA-300': 150, 'BRO-14': 300, 'GUA-NIT-M': 30, 'FOC-LED-9': 500 }
const phys = { 'PIN-LB-01': 108, 'PIN-LBH-01': 60, 'TOR-DW-61': 120, 'TAL-PER-12': 12, 'PVC-12-6M': 350, 'CIN-TEF-34': 1296, 'DIS-CO-45': 175, 'BRK-20A-1P': 61, 'CAB-THHN-12': 18, 'LLV-PAS-12': 34, 'SIL-TRA-300': 162, 'BRO-14': 290, 'GUA-NIT-M': 28, 'FOC-LED-9': 470 }

const csv = (rows) => rows.map((r) => r.map((x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\n') + '\n'
const w = (name, rows) => writeFileSync(new URL(name, out), '﻿' + csv(rows))

// Saldos del sistema (Softland: código, descripción, existencia, costo promedio)
w('saldos_sistema.csv', [['Código', 'Descripción', 'Existencia', 'Costo Promedio'], ...items.map(([c, d, cost]) => [c, d, sys[c] ?? 50, cost.toFixed(2)])])

// Conteo físico (con ubicación y notas), incluye 2 códigos desconocidos
const count = [['Cod. Artículo', 'Cantidad Contada', 'Ubicación', 'Observación']]
for (const [c, , , loc] of items) count.push([c, phys[c] ?? 50, loc, ''])
count.push(['7709911', 6, 'Pasillo 2-C', 'Código no existe en el sistema'])
count.push(['7701290', 18, 'Pasillo 5-B', 'Sin descripción en etiqueta'])
w('conteo_fisico.csv', count)

// Maestro de artículos (empaque y código de barras)
w('maestro_articulos.csv', [['Código', 'Descripción', 'Unid. por empaque', 'Código de barras'],
  ...items.map(([c, d, , , pack]) => [c, d, pack, c === 'LLV-PAS-12' ? '7709911' : ''])])

// Kardex de septiembre
const kardex = [['Fecha', 'Código', 'Tipo', 'Documento', 'Cantidad']]
kardex.push(['15/09/2026 10:00', 'CIN-TEF-34', 'Recepción', 'REC-3349', 1440])
kardex.push(['18/09/2026 09:12', 'TAL-PER-12', 'Factura', 'FAC-20302', -1])
kardex.push(['19/09/2026 11:30', 'BRO-14', 'Recepción', 'REC-3355', 100])
kardex.push(['22/09/2026 15:40', 'BRK-20A-1P', 'Nota de crédito', 'NC-0912', 3])
kardex.push(['23/09/2026 08:05', 'BRK-20A-1P', 'Nota de crédito', 'NC-0912', 3])
kardex.push(['24/09/2026 16:20', 'PIN-LBH-01', 'Factura', 'FAC-20377', -12])
kardex.push(['27/09/2026 14:00', 'DIS-CO-45', 'Factura', 'FAC-20391', -50])
kardex.push(['30/09/2026 16:05', 'PVC-12-6M', 'Factura', 'FAC-20418', -40])
kardex.push(['30/09/2026 18:40', 'SIL-TRA-300', 'Recepción', 'REC-3380', 12])
w('kardex_septiembre.csv', kardex)

// Facturas de venta (líneas)
w('facturas.csv', [['No. Factura', 'Fecha', 'Código', 'Cantidad', 'Cliente'],
  ['FAC-20302', '18/09/2026', 'TAL-PER-12', 1, 'Constructora Arias'],
  ['FAC-20377', '24/09/2026', 'PIN-LBH-01', 12, 'Ferretería El Tornillo'],
  ['FAC-20391', '27/09/2026', 'DIS-CO-45', 50, 'Taller Mendoza'],
  ['FAC-20418', '30/09/2026 16:05', 'PVC-12-6M', 40, 'Constructora Arias']])

// Guías de despacho (líneas) — FAC-20418 sin guía; GD-7781 despachó de más
w('guias_despacho.csv', [['Guía', 'Factura', 'Fecha', 'Código', 'Cantidad'],
  ['GD-7702', 'FAC-20302', '18/09/2026', 'TAL-PER-12', 1],
  ['GD-7755', 'FAC-20377', '24/09/2026', 'PIN-LBH-01', 12],
  ['GD-7781', 'FAC-20391', '27/09/2026', 'DIS-CO-45', 75]])

// Recepciones — REC-3371 no está en el kardex; REC-3355 con diferencia de proveedor
w('recepciones.csv', [['Recepción', 'Fecha', 'Código', 'Cantidad', 'Cant. guía proveedor'],
  ['REC-3349', '15/09/2026', 'CIN-TEF-34', 1440, 1440],
  ['REC-3355', '19/09/2026', 'BRO-14', 100, 90],
  ['REC-3371', '30/09/2026 14:20', 'TOR-DW-61', 24, 24],
  ['REC-3380', '30/09/2026 18:40', 'SIL-TRA-300', 12, 12]])

// Devoluciones
w('devoluciones.csv', [['Nota de crédito', 'Fecha', 'Código', 'Cantidad'], ['NC-0912', '22/09/2026', 'BRK-20A-1P', 3]])

// Ajustes y bajas — DAÑ-044 reportado pero no registrado
w('ajustes.csv', [['Documento', 'Fecha', 'Código', 'Cantidad', 'Motivo', 'Aprobado'], ['DAÑ-044', '26/09/2026', 'GUA-NIT-M', -2, 'Daño por agua', 'No']])

console.log('Listo:', out.pathname)
