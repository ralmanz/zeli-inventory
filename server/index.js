// Servidor de Zeli Inventory: API del cierre de conteo + archivos de la app.
import express from 'express'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initDb, q } from './db.js'
import { analyze } from './engine.js'
import { sendMail, mailEnabled } from './mail.js'
import { aiEnabled, explainCases } from './ai.js'
import { KIND } from '../src/shared/datasets.js'
import { mergeCases, indexCases, canPropose, recountOutcome, needsAttention, adjustmentLines, adjustmentTotal, finalQty, finalValue, CATEGORY, ALL_CAUSES, shortName, selfApproval } from '../src/shared/logic.js'

const PROD = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT || 8787)
const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '60mb' }))

const id = (n = 18) => randomBytes(n).toString('base64url')
const now = () => new Date()
const baseUrl = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`

/* ---------- sesión ---------- */
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='))
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null
}
async function currentUser(req) {
  const sid = readCookie(req, 'zi_sess')
  if (!sid) return null
  const r = await q('SELECT email FROM sessions WHERE id=$1 AND expires_at > now()', [sid])
  return r.rows[0] ? r.rows[0].email : null
}
const auth = (fn) => async (req, res) => {
  try {
    const email = await currentUser(req)
    if (!email) return res.status(401).json({ error: 'Inicie sesión' })
    req.user = email
    await fn(req, res)
  } catch (e) { console.error(e); res.status(500).json({ error: e.message || 'Error' }) }
}
const open = (fn) => async (req, res) => {
  try { await fn(req, res) } catch (e) { console.error(e); res.status(500).json({ error: e.message || 'Error' }) }
}

function allowed(email) {
  const list = (process.env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (!list.length) return !PROD // sin lista: abierto solo en desarrollo
  return list.includes(email) || list.some((x) => x.startsWith('@') && email.endsWith(x))
}

const attempts = new Map()
app.post('/api/auth/request', open(async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Correo no válido' })
  const k = req.ip + email, n = (attempts.get(k) || 0) + 1
  attempts.set(k, n); setTimeout(() => attempts.delete(k), 15 * 60000)
  if (n > 5) return res.status(429).json({ error: 'Demasiados intentos. Espere unos minutos.' })
  if (!allowed(email)) return res.status(403).json({ error: 'Este correo no tiene acceso todavía.' })
  const token = id(24)
  await q('INSERT INTO login_tokens(token,email,expires_at) VALUES($1,$2,$3)', [token, email, new Date(Date.now() + 20 * 60000)])
  const link = `${baseUrl(req)}/api/auth/verify?token=${token}`
  if (mailEnabled()) {
    await sendMail({ to: email, subject: 'Su enlace para entrar a Zeli Inventory',
      text: `Entre con este enlace (vence en 20 minutos): ${link}`,
      html: `<p>Entre a Zeli Inventory con este enlace. Vence en 20 minutos.</p><p><a href="${link}">Entrar</a></p>` })
    return res.json({ sent: true })
  }
  console.log('[login] enlace para', email, '→', link)
  if (!PROD || process.env.SHOW_LOGIN_LINK === '1') return res.json({ sent: false, devLink: link })
  res.status(503).json({ error: 'El envío de correo no está configurado (RESEND_API_KEY).' })
}))

app.get('/api/auth/verify', open(async (req, res) => {
  const t = String(req.query.token || '')
  const r = await q('SELECT email FROM login_tokens WHERE token=$1 AND used=false AND expires_at > now()', [t])
  if (!r.rows[0]) return res.redirect('/#/entrar?error=enlace')
  const email = r.rows[0].email
  await q('UPDATE login_tokens SET used=true WHERE token=$1', [t])
  await q('INSERT INTO users(email) VALUES($1) ON CONFLICT DO NOTHING', [email])
  const sid = id(32)
  const days = 30
  await q('INSERT INTO sessions(id,email,expires_at) VALUES($1,$2,$3)', [sid, email, new Date(Date.now() + days * 86400000)])
  res.setHeader('Set-Cookie', `zi_sess=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${PROD ? '; Secure' : ''}`)
  res.redirect('/#/')
}))

app.post('/api/auth/logout', open(async (req, res) => {
  const sid = readCookie(req, 'zi_sess')
  if (sid) await q('DELETE FROM sessions WHERE id=$1', [sid])
  res.setHeader('Set-Cookie', 'zi_sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
  res.json({ ok: true })
}))

app.get('/api/me', open(async (req, res) => {
  res.json({ email: await currentUser(req), ai: aiEnabled(), mail: mailEnabled() })
}))

/* ---------- cierres ---------- */
async function loadClose(cid, owner) {
  const r = await q('SELECT * FROM closes WHERE id=$1' + (owner ? ' AND owner=$2' : ''), owner ? [cid, owner] : [cid])
  return r.rows[0] || null
}
async function datasetsSummary(cid) {
  const r = await q("SELECT kind, filename, mapping, jsonb_array_length(rows) AS n, updated_at FROM datasets WHERE close_id=$1", [cid])
  return Object.fromEntries(r.rows.map((d) => [d.kind, { filename: d.filename, mapping: d.mapping, n: Number(d.n), updated_at: d.updated_at }]))
}
function publicClose(c, files, req) {
  return {
    id: c.id, meta: c.meta, analysis: c.analysis, decisions: c.decisions, log: c.log, signed: c.signed,
    sentAt: c.sent_at, approverLink: c.approver_token ? `${baseUrl(req)}/#/aprobar/${c.approver_token}` : null,
    files, createdAt: c.created_at, updatedAt: c.updated_at,
  }
}
async function save(cid, fields) {
  const keys = Object.keys(fields)
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ')
  const vals = keys.map((k) => (typeof fields[k] === 'object' && fields[k] !== null && !(fields[k] instanceof Date) ? JSON.stringify(fields[k]) : fields[k]))
  await q(`UPDATE closes SET ${sets}, updated_at=now() WHERE id=$1`, [cid, ...vals])
}
const logEntry = (by, t) => ({ at: new Date().toISOString(), by, t })

app.get('/api/closes', auth(async (req, res) => {
  const r = await q('SELECT id, meta, signed, sent_at, created_at, updated_at, analysis IS NOT NULL AS analyzed, (analysis->\'cases\') AS cases, decisions FROM closes WHERE owner=$1 ORDER BY updated_at DESC', [req.user])
  res.json(r.rows.map((c) => ({ id: c.id, meta: c.meta, signed: c.signed, sentAt: c.sent_at, analyzed: c.analyzed, updatedAt: c.updated_at, nCases: Array.isArray(c.cases) ? c.cases.length : 0 })))
}))

app.post('/api/closes', auth(async (req, res) => {
  const cid = id(10)
  const meta = { name: 'Nuevo cierre', company: '', cutoff: '', deadline: '', investigator: req.user, approver: '', approverEmail: '', threshold: 100,
    rules: { noDoc: true, shortage: true, judgment: true, blind: true }, partialCount: false, cutoffWindowHours: 24, ...(req.body && req.body.meta) }
  await q('INSERT INTO closes(id, owner, meta, log) VALUES($1,$2,$3,$4)', [cid, req.user, JSON.stringify(meta), JSON.stringify([logEntry(req.user, 'Creó el cierre')])])
  const c = await loadClose(cid, req.user)
  res.json(publicClose(c, {}, req))
}))

app.get('/api/closes/:id', auth(async (req, res) => {
  const c = await loadClose(req.params.id, req.user)
  if (!c) return res.status(404).json({ error: 'No existe' })
  res.json(publicClose(c, await datasetsSummary(c.id), req))
}))

app.delete('/api/closes/:id', auth(async (req, res) => {
  await q('DELETE FROM closes WHERE id=$1 AND owner=$2', [req.params.id, req.user])
  res.json({ ok: true })
}))

app.patch('/api/closes/:id/meta', auth(async (req, res) => {
  const c = await loadClose(req.params.id, req.user)
  if (!c) return res.status(404).json({ error: 'No existe' })
  if (c.signed) return res.status(409).json({ error: 'El cierre ya está firmado' })
  const meta = { ...c.meta, ...(req.body && req.body.meta) }
  await save(c.id, { meta })
  res.json({ ok: true, meta })
}))

app.put('/api/closes/:id/datasets/:kind', auth(async (req, res) => {
  const c = await loadClose(req.params.id, req.user)
  if (!c) return res.status(404).json({ error: 'No existe' })
  if (c.signed) return res.status(409).json({ error: 'El cierre ya está firmado' })
  const kind = req.params.kind
  if (!KIND[kind]) return res.status(400).json({ error: 'Tipo de archivo desconocido' })
  const { filename, mapping, rows } = req.body || {}
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Faltan filas' })
  if (rows.length > 300000) return res.status(413).json({ error: 'Archivo demasiado grande (más de 300,000 filas)' })
  await q(`INSERT INTO datasets(close_id, kind, filename, mapping, rows, updated_at) VALUES($1,$2,$3,$4,$5,now())
           ON CONFLICT (close_id, kind) DO UPDATE SET filename=EXCLUDED.filename, mapping=EXCLUDED.mapping, rows=EXCLUDED.rows, updated_at=now()`,
    [c.id, kind, filename || '', JSON.stringify(mapping || {}), JSON.stringify(rows)])
  await save(c.id, { log: [...c.log, logEntry(req.user, `Subió ${KIND[kind].title}: ${filename || ''} (${rows.length} filas)`)] })
  res.json({ ok: true, files: await datasetsSummary(c.id) })
}))

app.delete('/api/closes/:id/datasets/:kind', auth(async (req, res) => {
  const c = await loadClose(req.params.id, req.user)
  if (!c) return res.status(404).json({ error: 'No existe' })
  await q('DELETE FROM datasets WHERE close_id=$1 AND kind=$2', [c.id, req.params.kind])
  res.json({ ok: true, files: await datasetsSummary(c.id) })
}))

app.post('/api/closes/:id/analyze', auth(async (req, res) => {
  const c = await loadClose(req.params.id, req.user)
  if (!c) return res.status(404).json({ error: 'No existe' })
  if (c.signed) return res.status(409).json({ error: 'El cierre ya está firmado' })
  const r = await q('SELECT kind, rows FROM datasets WHERE close_id=$1', [c.id])
  const ds = Object.fromEntries(r.rows.map((d) => [d.kind, { rows: d.rows }]))
  if (!ds.count || !ds.balances) return res.status(400).json({ error: 'Faltan el conteo físico y los saldos del sistema' })
  const analysis = analyze(ds, c.meta)
  let aiNote = null
  if (aiEnabled()) {
    try {
      const texts = await explainCases(analysis.cases)
      for (const k of analysis.cases) if (texts[k.code]) { k.explain = texts[k.code]; k.explainedBy = 'modelo' }
    } catch (e) { aiNote = 'No se pudo redactar con el modelo: ' + e.message }
  }
  await save(c.id, { analysis, log: [...c.log, logEntry(req.user, `Hizo el cruce: ${analysis.cases.length} diferencias, ${analysis.found.length} códigos desconocidos`)] })
  res.json({ ok: true, analysis, aiNote })
}))

app.post('/api/closes/:id/decision', auth(async (req, res) => {
  const c = await loadClose(req.params.id, req.user)
  if (!c) return res.status(404).json({ error: 'No existe' })
  if (c.signed) return res.status(409).json({ error: 'El cierre ya está firmado' })
  const { code, action } = req.body || {}
  const cases = mergeCases(c.analysis, c.decisions)
  const byCode = indexCases(cases)
  const cs = byCode[code]
  if (!cs) return res.status(404).json({ error: 'Caso no encontrado' })
  const decisions = { ...c.decisions }
  const set = (k, patch) => { decisions[k] = { ...(decisions[k] || {}), ...patch } }
  const by = c.meta.investigator || req.user
  let msg = ''
  if (action === 'cause') {
    const cause = String(req.body.cause || '')
    if (!ALL_CAUSES.includes(cause)) return res.status(400).json({ error: 'Causa no válida' })
    set(code, { cause }); msg = `Cambió la causa de ${code} a ${cause}`
  } else if (action === 'note') {
    set(code, { note: String(req.body.note || '').slice(0, 2000) })
  } else if (action === 'recount') {
    const raw = req.body.recount
    const val = raw === '' || raw == null ? null : Number(raw)
    if (val != null && !Number.isFinite(val)) return res.status(400).json({ error: 'Número no válido' })
    set(code, { recount: val })
    const o = recountOutcome({ ...cs, recount: val })
    if (o === 'sistema') { set(code, { status: 'cerrada' }); msg = `Recuento de ${code}: ${val} (igual al sistema, error de conteo)` }
    else {
      if (cs.status === 'cerrada') set(code, { status: cs.kind === 'doc' ? 'propuesta' : 'revisar' })
      if (val != null) msg = `Recuento de ${code}: ${val}`
    }
  } else if (action === 'propose') {
    if (!canPropose(cs, c.meta, byCode)) return res.status(409).json({ error: 'Falta el resultado del recuento' })
    const was = cs.status === 'propuesta'
    set(code, { status: 'propuesta', proposedBy: by, approval: null, returnNote: '' })
    if (cs.pair && byCode[cs.pair] && !['propuesta', 'cerrada'].includes(byCode[cs.pair].status)) set(cs.pair, { status: 'propuesta', proposedBy: by, approval: null })
    msg = `${was ? 'Actualizó' : 'Propuso'} ${code}: ${cs.cause}`
  } else return res.status(400).json({ error: 'Acción desconocida' })
  const log = msg ? [...c.log, logEntry(by, msg)] : c.log
  await save(c.id, { decisions, log })
  res.json({ ok: true, decisions, log })
}))

app.post('/api/closes/:id/send', auth(async (req, res) => {
  const c = await loadClose(req.params.id, req.user)
  if (!c) return res.status(404).json({ error: 'No existe' })
  const token = c.approver_token || id(24)
  const link = `${baseUrl(req)}/#/aprobar/${token}`
  let emailed = false, mailError = null
  if (mailEnabled() && c.meta.approverEmail && !selfApproval(c.meta)) {
    try {
      await sendMail({ to: c.meta.approverEmail, subject: `Cierre de conteo listo para aprobar: ${c.meta.name}`,
        text: `${c.meta.investigator} le envía el cierre "${c.meta.name}" para su aprobación: ${link}`,
        html: `<p>${c.meta.investigator} le envía el cierre <strong>${c.meta.name}</strong> para su aprobación.</p><p><a href="${link}">Revisar y firmar</a></p>` })
      emailed = true
    } catch (e) { mailError = e.message }
  }
  await save(c.id, { approver_token: token, sent_at: now(), log: [...c.log, logEntry(c.meta.investigator || req.user, 'Envió el cierre a aprobación' + (emailed ? ' por correo' : ''))] })
  res.json({ ok: true, link, emailed, mailError })
}))

/* ---------- quien aprueba (enlace privado, sin cuenta) ---------- */
async function byToken(t) {
  const r = await q('SELECT * FROM closes WHERE approver_token=$1', [t])
  return r.rows[0] || null
}
app.get('/api/approve/:token', open(async (req, res) => {
  const c = await byToken(req.params.token)
  if (!c) return res.status(404).json({ error: 'Enlace no válido' })
  res.json({ ...publicClose(c, {}, req), approverLink: null, approverView: true })
}))
app.post('/api/approve/:token/decision', open(async (req, res) => {
  const c = await byToken(req.params.token)
  if (!c) return res.status(404).json({ error: 'Enlace no válido' })
  if (c.signed) return res.status(409).json({ error: 'El cierre ya está firmado' })
  const { code, approval, returnNote } = req.body || {}
  if (!['aceptada', 'devuelta', null].includes(approval)) return res.status(400).json({ error: 'Decisión no válida' })
  const cases = mergeCases(c.analysis, c.decisions)
  const cs = indexCases(cases)[code]
  if (!cs) return res.status(404).json({ error: 'Caso no encontrado' })
  const decisions = { ...c.decisions }
  const set = (k) => { decisions[k] = { ...(decisions[k] || {}), approval, returnNote: approval === 'devuelta' ? String(returnNote || '') : '' } }
  set(code); if (cs.pair) set(cs.pair)
  const by = shortName(c.meta.approver) || 'Quien aprueba'
  const log = [...c.log, logEntry(by, `${approval === 'aceptada' ? 'Aceptó' : approval === 'devuelta' ? 'Devolvió' : 'Reabrió'} ${code}${approval === 'devuelta' && returnNote ? ': ' + returnNote : ''}`)]
  await save(c.id, { decisions, log })
  res.json({ ok: true, decisions, log })
}))
app.post('/api/approve/:token/sign', open(async (req, res) => {
  const c = await byToken(req.params.token)
  if (!c) return res.status(404).json({ error: 'Enlace no válido' })
  if (c.signed) return res.status(409).json({ error: 'El cierre ya está firmado' })
  const name = String((req.body && req.body.name) || '').trim()
  if (name.length < 3) return res.status(400).json({ error: 'Escriba su nombre para firmar' })
  const cases = mergeCases(c.analysis, c.decisions)
  const pending = cases.filter((x) => needsAttention(x) && !x.approval)
  if (pending.length) return res.status(409).json({ error: `Faltan ${pending.length} casos por decidir` })
  const lines = adjustmentLines(cases).map((x) => ({ code: x.code, desc: x.desc, qty: finalQty(x), cost: x.cost, value: finalValue(x), cause: x.cause, summary: x.summary, category: CATEGORY[x.cause] }))
  const signed = { by: name, at: new Date().toISOString(), self: selfApproval(c.meta), total: adjustmentTotal(cases), lines }
  await save(c.id, { signed, log: [...c.log, logEntry(name, 'Firmó el cierre')] })
  res.json({ ok: true, signed })
}))

/* ---------- archivos de la app ---------- */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist, { index: 'index.html', extensions: ['html'] }))
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}
app.use('/api', (req, res) => res.status(404).json({ error: 'No existe' }))

const kind = await initDb()
app.listen(PORT, '0.0.0.0', () => console.log(`Zeli Inventory en http://0.0.0.0:${PORT} · base de datos: ${kind} · modelo: ${aiEnabled() ? 'sí' : 'no'} · correo: ${mailEnabled() ? 'sí' : 'no'}`))
