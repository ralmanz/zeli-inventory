import { useEffect, useMemo, useState } from 'react'
import { api, type CloseData, type Me } from './api.ts'
import { Header, DayCounter, Loading, ErrorBox, Tag, toast, go, fmtN, money, cls, plain, fmtCutoff, fmtDateTime } from './ui.tsx'
import { Uploader, loadSample } from './upload.tsx'
import { KINDS } from '../shared/datasets.js'
import {
  CAUSES, ALL_CAUSES, CATEGORY, DEFAULT_RULES, mergeCases, indexCases, value, recountOutcome, recountRequired, canPropose, finalQty, finalValue,
  needsAttention, adjustmentLines, adjustmentTotal, sortByValue, statusLabel, baseLabel, stats, shortName, selfApproval,
} from '../shared/logic.js'

type Props = { id?: string; token?: string; sub: string[]; me: Me | null }

export default function CloseApp({ id, token, sub, me }: Props) {
  const [data, setData] = useState<CloseData | null>(null)
  const [err, setErr] = useState('')
  const approver = !!token
  const base = approver ? `#/aprobar/${token}` : `#/c/${id}`
  const load = () => api<CloseData>('GET', approver ? `/api/approve/${token}` : `/api/closes/${id}`).then(setData).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [id, token])

  if (err) return <><Header steps={false} /><ErrorBox msg={err} /></>
  if (!data) return <Loading />

  const meta = data.meta
  const cases = mergeCases(data.analysis, data.decisions)
  const byCode = indexCases(cases)
  const step = sub[0] || (approver ? 'aprobacion' : data.analysis ? 'diferencias' : 'archivos')
  const ctx: Ctx = {
    data, setData, meta, cases, byCode, base, approver, me, reload: load,
    async decide(code: string, action: string, extra: any = {}) {
      try {
        const r: any = await api('POST', `/api/closes/${data.id}/decision`, { code, action, ...extra })
        setData({ ...data, decisions: r.decisions, log: r.log })
        return true
      } catch (e: any) { toast(e.message); return false }
    },
    async approve(code: string, approval: string | null, returnNote = '') {
      try {
        const r: any = await api('POST', `/api/approve/${token}/decision`, { code, approval, returnNote })
        setData({ ...data, decisions: r.decisions, log: r.log })
      } catch (e: any) { toast(e.message) }
    },
  }
  const kardexSince = data.analysis && data.analysis.totals ? data.analysis.totals.kardexAfterCutoff : undefined
  const home = approver ? base : '#/'
  return (
    <>
      <Header base={base} step={step === 'caso' ? 'caso' : step} meta={meta} home={home} right={<DayCounter meta={meta} signed={data.signed} kardexSince={kardexSince} />} />
      {approver && step !== 'aprobacion' && !data.signed && <div className="wrap" style={{ paddingTop: 16 }}><div className="note small">Está viendo como <strong>quien aprueba</strong>. Puede revisar todo; las propuestas las hace quien investiga. <a href={`${base}/aprobacion`}>Ir a aprobar →</a></div></div>}
      {step === 'archivos' && <Setup ctx={ctx} />}
      {step === 'diferencias' && <Differences ctx={ctx} />}
      {step === 'caso' && <CaseView ctx={ctx} code={decodeURIComponent(sub[1] || '')} />}
      {step === 'recuento' && <Recount ctx={ctx} />}
      {step === 'aprobacion' && <Approval ctx={ctx} />}
      {step === 'ajuste' && <Adjustment ctx={ctx} />}
    </>
  )
}

type Ctx = {
  data: CloseData; setData: (d: CloseData) => void; meta: any; cases: any[]; byCode: Record<string, any>; base: string; approver: boolean; me: Me | null
  reload: () => void
  decide: (code: string, action: string, extra?: any) => Promise<boolean>
  approve: (code: string, approval: string | null, returnNote?: string) => Promise<void>
}

function NeedAnalysis({ ctx }: { ctx: Ctx }) {
  return <main className="wrap page"><div className="card pad stack g10" style={{ maxWidth: 640 }}><h1 className="h2">Todavía no hay cruce</h1>
    <p style={{ margin: 0 }}>Suba el conteo físico y los saldos del sistema, y haga el cruce.</p>{!ctx.approver && <a className="btn" style={{ alignSelf: 'flex-start' }} href={`${ctx.base}/archivos`}>Ir a archivos</a>}</div></main>
}

/* ---------------- 1. Archivos ---------------- */
function Setup({ ctx }: { ctx: Ctx }) {
  const { data, setData, approver } = ctx
  const [meta, setMeta] = useState<any>(data.meta)
  const [busy, setBusy] = useState('')
  const [ver, setVer] = useState(0)
  const locked = !!data.signed || approver
  const rules = meta.rules || DEFAULT_RULES

  async function saveMeta(patch: any) {
    const m = { ...meta, ...patch }
    setMeta(m)
    if (locked) return
    try { await api('PATCH', `/api/closes/${data.id}/meta`, { meta: patch }); setData({ ...data, meta: m }) } catch (e: any) { toast(e.message) }
  }
  const field = (k: string, label: string, type = 'text', span = 1, extra: any = {}) => (
    <div className="field" style={{ gridColumn: span === 2 ? '1/-1' : undefined }}>
      <label htmlFor={'f-' + k}>{label}</label>
      <input id={'f-' + k} className="input" type={type} disabled={locked} defaultValue={meta[k] ?? ''} onBlur={(e) => e.target.value !== String(meta[k] ?? '') && saveMeta({ [k]: e.target.value })} {...extra} />
    </div>
  )
  async function analyze() {
    setBusy('Haciendo el cruce…')
    try {
      const r: any = await api('POST', `/api/closes/${data.id}/analyze`)
      if (r.aiNote) toast(r.aiNote)
      setData({ ...data, meta, analysis: r.analysis })
      go(`${ctx.base}/diferencias`)
    } catch (e: any) { toast(e.message) } finally { setBusy('') }
  }
  async function sample() {
    try {
      const r: any = await loadSample(data.id, setBusy)
      const patch = { name: meta.name === 'Nuevo cierre' ? 'Ejemplo — Bodega Central' : meta.name, company: meta.company || 'Ferretería de ejemplo', cutoff: meta.cutoff || '2026-09-30T18:00', deadline: meta.deadline || '2026-10-05' }
      await api('PATCH', `/api/closes/${data.id}/meta`, { meta: patch })
      setMeta({ ...meta, ...patch }); setData({ ...data, meta: { ...meta, ...patch }, files: r.files }); setVer(ver + 1)
      toast('Archivos de ejemplo cargados')
    } catch (e: any) { toast(e.message) } finally { setBusy('') }
  }
  const coverage = data.analysis ? data.analysis.coverage : null
  const ready = data.files.count && data.files.balances

  return (
    <main className="wrap page">
      <div className="row between end g16 page-head">
        <div><h1 className="display">{data.analysis ? 'Archivos del cierre' : 'Nuevo cierre'}</h1><p className="lede">El conteo y los saldos del sistema al mismo corte bastan para el cruce. Cada documento adicional permite explicar más diferencias.</p></div>
        {!locked && !Object.keys(data.files).length && <div className="btns"><button className="btn ghost" onClick={sample} disabled={!!busy}>Probar con archivos de ejemplo</button></div>}
      </div>
      <div className="main-side">
        <div className="main">
          <section key={ver} className="card pad grid c2" style={{ gap: 16 }} aria-labelledby="dc">
            <h2 id="dc" className="h2" style={{ gridColumn: '1/-1' }}>Datos del cierre</h2>
            {field('name', 'Nombre', 'text', 2)}
            {field('company', 'Empresa')}
            {field('investigator', 'Quién investiga')}
            {field('cutoff', 'Corte del conteo (fecha y hora)', 'datetime-local')}
            {field('deadline', 'Cerrar a más tardar', 'date')}
            {field('approver', 'Quién aprueba (nombre · cargo)')}
            {field('approverEmail', 'Correo de quien aprueba', 'email')}
            <p className="hint" style={{ gridColumn: '1/-1', margin: 0 }}>Quien aprueba recibe un enlace que abre directo en la aprobación. Si lo deja vacío o es la misma persona que investiga, el informe dirá “sin separación de funciones”.</p>
            <label className="check" style={{ gridColumn: '1/-1' }}><input type="checkbox" disabled={locked} checked={!!meta.partialCount} onChange={(e) => saveMeta({ partialCount: e.target.checked })} /> Conteo parcial: comparar solo los artículos contados</label>
          </section>

          <section className="stack g12" aria-labelledby="fl">
            <h2 id="fl" className="h2">Archivos <span className="sub">— exportados de su sistema, en Excel o CSV</span></h2>
            <div className="grid c2" style={{ gap: 12 }}>
              {KINDS.map((k: any) => <Uploader key={k.kind} closeId={data.id} kind={k.kind} current={data.files[k.kind]} disabled={locked} onDone={(files) => setData({ ...data, files })} />)}
            </div>
          </section>

          <section className="card pad stack g12" aria-labelledby="rr">
            <h2 id="rr" className="h2">Cuándo se exige recuento</h2>
            <p className="small muted" style={{ margin: 0 }}>Un caso con estas condiciones no se puede proponer sin el resultado del recuento.</p>
            <label className="check"><input type="checkbox" disabled={locked} checked={rules.noDoc} onChange={(e) => saveMeta({ rules: { ...rules, noDoc: e.target.checked } })} /> Ningún documento explica la diferencia</label>
            <label className="check"><input type="checkbox" disabled={locked} checked={rules.shortage} onChange={(e) => saveMeta({ rules: { ...rules, shortage: e.target.checked } })} /> La conclusión sería faltante real</label>
            <div className="check"><input id="r-j" type="checkbox" disabled={locked} checked={rules.judgment} onChange={(e) => saveMeta({ rules: { ...rules, judgment: e.target.checked } })} />
              <label htmlFor="r-j">La causa depende de criterio y el valor pasa de $</label>
              <input aria-label="Umbral en dólares" className="input sm mono" style={{ width: 90 }} inputMode="decimal" disabled={locked} defaultValue={meta.threshold ?? 100} onBlur={(e) => saveMeta({ threshold: Number(e.target.value) || 100 })} /></div>
            <label className="check"><input type="checkbox" disabled={locked} checked={rules.blind} onChange={(e) => saveMeta({ rules: { ...rules, blind: e.target.checked } })} /> Recuento ciego: la lista no muestra la cantidad esperada</label>
          </section>
        </div>
        <aside className="side">
          <section className="card pad stack g12" aria-labelledby="cv">
            <h2 id="cv" className="h2">Causas que se pueden revisar</h2>
            {coverage ? (
              <>
                <p style={{ margin: 0, fontSize: '2.6rem', fontWeight: 800, fontStretch: '62%', lineHeight: 1 }}>{Object.values(coverage).filter(Boolean).length} <span className="muted" style={{ fontSize: '1rem', fontWeight: 400, fontStretch: '100%' }}>de {CAUSES.length}</span></p>
                <ul className="list small">{CAUSES.map((c: string) => (
                  <li key={c} className="row g10" style={{ padding: '5px 0', border: 0 }}><span className="mono" aria-hidden="true" style={{ width: 14, color: coverage[c] ? 'var(--green)' : 'var(--red)' }}>{coverage[c] ? '✓' : '–'}</span><span>{c}{!coverage[c] && <span className="sr"> (falta archivo)</span>}</span></li>
                ))}</ul>
              </>
            ) : <p className="small muted" style={{ margin: 0 }}>Se calcula al hacer el cruce, según los archivos que suba.</p>}
            {busy && <p className="note small" style={{ margin: 0 }}>{busy}</p>}
            {!locked && <button className="btn block" onClick={analyze} disabled={!ready || !!busy}>{data.analysis ? 'Rehacer el cruce' : 'Hacer el cruce'}</button>}
            {!ready && !locked && <span className="hint">Faltan el conteo físico y los saldos del sistema.</span>}
            {data.analysis && !locked && <span className="hint">Rehacer el cruce conserva sus recuentos, notas y propuestas.</span>}
          </section>
        </aside>
      </div>
    </main>
  )
}

/* ---------------- 2. Diferencias ---------------- */
function Differences({ ctx }: { ctx: Ctx }) {
  const { data, cases, meta, byCode, base, approver } = ctx
  const [filter, setFilter] = useState('todas')
  const [sending, setSending] = useState(false)
  if (!data.analysis) return <NeedAnalysis ctx={ctx} />
  const st = stats(cases, meta, byCode)
  const list = sortByValue(cases).filter((c: any) => {
    const t = statusLabel(c, meta, byCode).t
    if (filter === 'revisar') return t === 'Por revisar' || t === 'Devuelta'
    if (filter === 'recuento') return t === 'En recuento'
    if (filter === 'explicadas') return c.status === 'propuesta' || c.status === 'cerrada'
    return true
  })
  const pending = cases.filter((c: any) => c.status !== 'propuesta' && c.status !== 'cerrada').length
  async function send() {
    setSending(true)
    try {
      const r: any = await api('POST', `/api/closes/${data.id}/send`)
      ctx.setData({ ...data, sentAt: new Date().toISOString(), approverLink: r.link })
      try { await navigator.clipboard.writeText(r.link) } catch { /* sin portapapeles */ }
      toast(r.emailed ? `Enlace enviado a ${meta.approverEmail}` : r.mailError ? 'No se pudo enviar el correo; enlace copiado' : 'Enlace de aprobación copiado')
      go(`${base}/aprobacion`)
    } catch (e: any) { toast(e.message) } finally { setSending(false) }
  }
  const total = data.analysis.totals || {}
  return (
    <main className="wrap page">
      <div className="row between end g16 page-head">
        <h1 className="display">Diferencias</h1>
        {!approver && !data.signed && <div className="btns"><button className="btn" onClick={send} disabled={sending || !cases.length}>{data.sentAt ? 'Reenviar a aprobación' : 'Enviar a aprobación'}</button></div>}
      </div>
      {!approver && !data.signed && pending > 0 && <p className="small muted" style={{ margin: '-16px 0 0' }}>{pending} sin proponer. Puede enviar igual: quedan fuera del ajuste hasta que se resuelvan.</p>}
      <section className="grid c4" aria-label="Resumen">
        <div className="card kpi"><span className="k">Con diferencia</span><span className="v">{st.n} <span className="muted" style={{ fontSize: '1rem', fontWeight: 400, fontStretch: '100%' }}>de {plain(total.countItems || 0)} contados</span></span></div>
        <div className="card kpi"><span className="k">Faltante</span><span className="v neg">{money(st.short)}</span></div>
        <div className="card kpi"><span className="k">Sobrante</span><span className="v pos">{money(st.over)}</span></div>
        <div className="card kpi"><span className="k">Neto</span><span className="v">{money(st.net)}</span></div>
      </section>
      {st.n > 0 && (
        <section className="card flat pad-s stack g12" aria-labelledby="es">
          <h2 id="es" className="h3">Estado de las {st.n} diferencias</h2>
          <div className="bar" role="img" aria-label={`${st.doc} explicadas con documento, ${st.crit} requieren criterio, ${st.rec} en recuento, ${st.none} sin explicar`}>
            {st.doc > 0 && <div style={{ flex: st.doc, background: 'var(--green)' }} />}{st.crit > 0 && <div style={{ flex: st.crit, background: 'var(--blue)' }} />}
            {st.rec > 0 && <div style={{ flex: st.rec, background: 'var(--yellow)' }} />}{st.none > 0 && <div style={{ flex: st.none, background: 'var(--red)' }} />}
          </div>
          <div className="legend"><span><i className="sw" style={{ background: 'var(--green)' }} />{st.doc} explicadas con documento</span><span><i className="sw" style={{ background: 'var(--blue)' }} />{st.crit} requieren criterio</span><span><i className="sw" style={{ background: 'var(--yellow)', outline: '1px solid var(--ink)' }} />{st.rec} en recuento</span><span><i className="sw" style={{ background: 'var(--red)' }} />{st.none} sin explicar</span></div>
        </section>
      )}
      <section className="stack g12" aria-labelledby="lv">
        <div className="row between g12"><h2 id="lv" className="h2">Por valor <span className="sub">— {list.length} de {st.n}</span></h2>
          <div className="chips" role="group" aria-label="Filtrar">{[['todas', 'Todas'], ['revisar', 'Por revisar'], ['recuento', 'En recuento'], ['explicadas', 'Propuestas']].map(([k, l]) => <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div></div>
        <div className="card tablebox stack-table"><table>
          <thead><tr><th>Artículo</th><th className="r">Sistema</th><th className="r">Físico</th><th className="r">Dif.</th><th className="r">Valor</th><th>Causa propuesta</th><th>Base</th><th>Estado</th></tr></thead>
          <tbody>
            {list.map((c: any) => { const b = baseLabel(c), s = statusLabel(c, meta, byCode), v = value(c)
              return (
                <tr key={c.code} className={c.pair ? 'pair' : undefined}>
                  <td className="span" data-l="Artículo"><a href={`${base}/caso/${encodeURIComponent(c.code)}`} style={{ fontWeight: 700, textDecoration: 'none' }}>{c.desc || c.code}</a><div className="mono code">{c.code}</div></td>
                  <td className="r mono num" data-l="Sistema">{plain(c.sys)}</td><td className="r mono num" data-l="Físico">{plain(c.phys)}</td>
                  <td className={'r mono num ' + cls(c.diff)} data-l="Diferencia" style={{ fontWeight: 600 }}>{fmtN(c.diff)}</td><td className={'r mono num ' + cls(v)} data-l="Valor" style={{ fontWeight: 600 }}>{money(v)}</td>
                  <td className="span" data-l="Causa propuesta"><div style={{ fontWeight: 650 }}>{c.status === 'cerrada' ? 'Error de conteo' : c.cause}</div><div className="xs muted">{c.summary}</div></td>
                  <td data-l="Base"><Tag c={b.c}>{b.t}</Tag></td><td data-l="Estado"><Tag c={s.c}>{s.t}</Tag></td>
                </tr>) })}
            {!list.length && <tr><td colSpan={8} className="muted">{st.n ? 'Ninguna diferencia con este filtro.' : 'El conteo coincide con el sistema.'}</td></tr>}
          </tbody></table></div>
      </section>
      {data.analysis.found.length > 0 && (
        <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="enc">
          <div className="pad-s stack g4"><h2 id="enc" className="h2">Encontrados en el conteo <span className="sub">— {data.analysis.found.length} códigos que el sistema no reconoce</span></h2>
            <p className="small muted" style={{ margin: 0 }}>Primero se buscan contra faltantes parecidos.</p></div>
          <ul className="list">{data.analysis.found.map((f: any) => (
            <li key={f.code} className="row between start g12" style={{ padding: '14px 20px', borderTop: '1px solid var(--rule)' }}>
              <div style={{ flex: '1 1 220px' }}><strong>Código {f.code} · {plain(f.qty)} unid.</strong><div className="mono code">{f.loc || 'sin ubicación'}{f.notes && f.notes.length ? ' · ' + f.notes.join(' · ') : ''}</div></div>
              <span className="small" style={{ flex: '2 1 300px' }}>{f.match || 'Ningún faltante parecido. Revisar si falta en el maestro de artículos.'}</span>
              <Tag c={f.matchCode ? 't-b' : 't-ys'}>{f.matchCode ? 'Posible cruce' : 'Por revisar'}</Tag>
            </li>))}</ul>
        </section>
      )}
    </main>
  )
}

/* ---------------- 3. Revisión de un caso ---------------- */
const CHECK_TAG: Record<string, string> = { Encontrada: 't-g', Descartada: 't-s', 'No verificable': 't-ys', 'No aplica': 't-o' }
function CaseView({ ctx, code }: { ctx: Ctx; code: string }) {
  const { data, cases, meta, byCode, base, approver } = ctx
  const list = useMemo(() => sortByValue(cases), [cases])
  const c = byCode[code] || list.find((x: any) => x.status !== 'propuesta' && x.status !== 'cerrada') || list[0]
  const [note, setNote] = useState(c ? c.note : '')
  useEffect(() => { setNote(c ? c.note : '') }, [c && c.code])
  if (!data.analysis) return <NeedAnalysis ctx={ctx} />
  if (!c) return <main className="wrap page"><p>No hay diferencias.</p></main>
  const idx = list.indexOf(c)
  const prev = list[(idx - 1 + list.length) % list.length], next = list[(idx + 1) % list.length]
  const v = value(c), rr = recountRequired(c, meta, byCode), ro = recountOutcome(c), s = statusLabel(c, meta, byCode)
  const pair = c.pair && byCode[c.pair] && byCode[c.pair].status !== 'cerrada' ? byCode[c.pair] : null
  const can = !approver && !data.signed && canPropose(c, meta, byCode)
  const counts: Record<string, number> = {}
  c.checks.forEach((r: any) => { counts[r[0]] = (counts[r[0]] || 0) + 1 })
  async function propose() {
    if (note !== c.note) await ctx.decide(c.code, 'note', { note })
    if (await ctx.decide(c.code, 'propose')) {
      toast('Propuesta registrada')
      const nextOpen = list.find((x: any) => x.code !== c.code && x.status !== 'propuesta' && x.status !== 'cerrada' && (!recountRequired(x, meta, byCode) || recountOutcome(x)))
      if (nextOpen) go(`${base}/caso/${encodeURIComponent(nextOpen.code)}`)
    }
  }
  return (
    <main className="wrap page" style={{ paddingTop: 28 }}>
      <div className="row between g12 small" style={{ fontWeight: 650 }}><a href={`${base}/diferencias`} style={{ textDecoration: 'none' }}>← Diferencias</a><span className="muted" style={{ fontWeight: 400 }}>Caso {idx + 1} de {list.length} · por valor</span></div>
      <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="art">
        <div className="pad row between start g12">
          <div><h1 id="art" className="display" style={{ fontSize: 'clamp(2rem,4.2vw,2.8rem)' }}>{c.desc || c.code}</h1><p className="mono small muted" style={{ margin: '8px 0 0' }}>{c.code}{c.loc ? ' · ' + c.loc : ''} · costo {money(c.cost, false)}</p></div>
          <div className="row g8">{rr && !ro && <Tag c="t-y">Recuento obligatorio</Tag>}<Tag c={s.c}>{s.t}</Tag></div>
        </div>
        <div className="metrics">
          {[['Sistema', plain(c.sys), ''], ['Físico', plain(c.phys), ''], ['Diferencia', fmtN(c.diff), cls(c.diff)], ['Valor', money(v), cls(v)]].map((k) => (
            <div key={k[0]} className="stack g4"><span className="xs muted" style={{ fontWeight: 650 }}>{k[0]}</span><span className={'mono num n ' + k[2]}>{k[1]}</span></div>))}
        </div>
      </section>
      <div className="main-side">
        <div className="main">
          <section className="card pad stack g12" style={{ boxShadow: '4px 4px 0 var(--blue)' }} aria-labelledby="cp">
            <div className="row g10"><h2 id="cp" className="mono xs" style={{ margin: 0, color: 'var(--blue)', fontWeight: 600 }}>{c.status === 'cerrada' ? 'Resultado' : 'Conclusión propuesta'}</h2>
              <Tag c={c.kind === 'doc' ? 't-g' : c.kind === 'criterio' ? 't-b' : 't-r'}>{c.kind === 'doc' ? 'Con documento' : c.kind === 'criterio' ? 'Requiere criterio' : 'Sin documento'}</Tag></div>
            <p className="lead-title">{c.status === 'cerrada' ? 'Error de conteo: se cierra sin ajuste' : c.cause + (pair ? ` con ${pair.desc || pair.code}` : '')}</p>
            <p style={{ margin: 0, maxWidth: '68ch' }}>{c.status === 'cerrada' ? 'El recuento dio lo mismo que el sistema. La diferencia fue del conteo, no del inventario.' : c.explain}{c.explainedBy === 'modelo' && <span className="xs muted"> · redactado por el modelo</span>}</p>
            {c.cause !== c.originalCause && <p className="xs muted" style={{ margin: 0 }}>Zeli sugirió: {c.originalCause}. Quien investiga la cambió.</p>}
            {c.status !== 'cerrada' && (
              <div className="card flat pad-s stack g8" style={{ background: 'var(--cream)' }}><strong className="small">Ajuste propuesto</strong>
                <div className="mini mono">
                  <span>{c.code}</span><span className={cls(finalQty(c))}>{fmtN(finalQty(c))}</span><span className={cls(finalValue(c))}>{money(finalValue(c))}</span>
                  {pair && <><span>{pair.code}</span><span className={cls(finalQty(pair))}>{fmtN(finalQty(pair))}</span><span className={cls(finalValue(pair))}>{money(finalValue(pair))}</span>
                    <span style={{ fontWeight: 600 }}>Neto del par</span><span /><span style={{ fontWeight: 600 }}>{money(finalValue(c) + finalValue(pair))}</span></>}
                </div>
                <span className="xs muted">Categoría contable sugerida: {CATEGORY[c.cause]}. La confirma su contador.</span></div>
            )}
            {rr && !ro && <div className="note row between g10"><span><strong>Recuento obligatorio.</strong> {c.kind === 'none' ? 'Ningún documento explica la diferencia.' : `Depende de criterio y pasa de $${meta.threshold || 100}.`} Recontar{c.loc ? ' en ' + c.loc : ''}.</span><a href={`${base}/recuento`} style={{ fontWeight: 700 }}>Ir a recuento →</a></div>}
            {ro && <div className="note" style={{ background: ro === 'sistema' ? 'var(--green-soft)' : 'var(--blue-soft)' }}>Recuento: <strong className="mono">{c.recount}</strong> — {ro === 'sistema' ? 'igual al sistema, fue error de conteo.' : ro === 'conteo' ? 'igual al conteo, la diferencia es real.' : 'otro número; el ajuste usa el recuento y lo decide quien aprueba.'}</div>}
            {c.approval === 'devuelta' && <div className="note" style={{ background: 'var(--red-soft)' }}><strong>Devuelta por quien aprueba:</strong> {c.returnNote || 'sin comentario'}</div>}
          </section>
          <section className="card flat pad stack g8" aria-labelledby="cr">
            <h2 id="cr" className="h2">Causas revisadas <span className="sub">— {['Encontrada', 'Descartada', 'No verificable'].map((k) => `${counts[k] || 0} ${k.toLowerCase()}${(counts[k] || 0) === 1 ? '' : 's'}`).join(', ')}</span></h2>
            <ul className="list">{c.checks.map((r: any) => (
              <li key={r[1]} className="check-row"><span className={'tag ' + CHECK_TAG[r[0]]} style={{ justifySelf: 'start' }}>{r[0]}</span><div><div style={{ fontWeight: 700 }}>{r[1]}</div><div className="small muted">{r[2]}</div></div></li>))}</ul>
          </section>
          <section className="card flat pad stack g8" aria-labelledby="ev">
            <h2 id="ev" className="h2">Evidencia</h2>
            <div className="tablebox stack-table"><table><thead><tr><th style={{ paddingLeft: 0 }}>Fuente</th><th>Referencia</th><th>Detalle</th></tr></thead>
              <tbody>{c.evidence.map((e: any, i: number) => <tr key={i}><td className="span" data-l="Fuente" style={{ paddingLeft: 0, fontWeight: 650 }}>{e[0]}</td><td className="span mono small" data-l="Referencia">{e[1]}</td><td className="span small" data-l="Detalle">{e[2]}</td></tr>)}</tbody></table></div>
          </section>
        </div>
        <aside className="side">
          {!approver ? (
            <section className="card pad stack g12" aria-labelledby="pp">
              <h2 id="pp" className="h2">Su propuesta</h2>
              <p className="small muted" style={{ margin: 0 }}>Usted propone la causa. {selfApproval(meta) ? 'Usted mismo firmará al final; el informe lo indicará.' : `La aprueba ${shortName(meta.approver)} al final del cierre.`}</p>
              {c.status === 'propuesta' && c.approval !== 'devuelta' && <p className="note small" style={{ margin: 0, background: 'var(--green-soft)' }}>Propuesta {c.proposedBy === 'auto' ? 'con documento' : 'enviada por ' + c.proposedBy}. Puede cambiarla mientras no se firme.</p>}
              <div className="field"><label htmlFor="cause">Causa</label>
                <select id="cause" className="input" value={c.cause} disabled={c.status === 'cerrada' || !!data.signed} onChange={(e) => ctx.decide(c.code, 'cause', { cause: e.target.value })}>
                  {ALL_CAUSES.map((x: string) => <option key={x}>{x}</option>)}</select>
                {c.alternatives && c.alternatives.length > 0 && <span className="hint">También encontradas: {c.alternatives.join(', ')}.</span>}</div>
              <div className="field"><label htmlFor="note">Nota para quien aprueba</label>
                <textarea id="note" className="input" rows={3} value={note} disabled={!!data.signed} placeholder="Ej.: confirmado en el pasillo" onChange={(e) => setNote(e.target.value)} onBlur={() => note !== c.note && ctx.decide(c.code, 'note', { note })} /></div>
              <button className="btn block" onClick={propose} disabled={!can}>{c.status === 'propuesta' && c.approval !== 'devuelta' ? 'Actualizar propuesta' : 'Proponer esta conclusión'}</button>
              {!can && c.status !== 'cerrada' && !data.signed && <span className="hint" style={{ marginTop: -6 }}>Se habilita con el resultado del recuento.</span>}
              <p className="xs muted" style={{ margin: 0, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>Cada propuesta, cambio y aprobación queda registrado con nombre y hora.</p>
            </section>
          ) : (
            <section className="card pad stack g10"><h2 className="h2">Quien aprueba</h2><p className="small" style={{ margin: 0 }}>Las propuestas las hace quien investiga. Usted acepta o devuelve los casos en la aprobación.</p><a className="btn block" href={`${base}/aprobacion`}>Ir a aprobación</a></section>
          )}
          <div className="row between small" style={{ fontWeight: 650 }}><a href={`${base}/caso/${encodeURIComponent(prev.code)}`} style={{ textDecoration: 'none' }}>← Anterior</a><a href={`${base}/caso/${encodeURIComponent(next.code)}`} style={{ textDecoration: 'none' }}>Siguiente →</a></div>
        </aside>
      </div>
    </main>
  )
}

/* ---------------- 4. Recuento ---------------- */
function Recount({ ctx }: { ctx: Ctx }) {
  const { data, cases, meta, byCode, approver } = ctx
  if (!data.analysis) return <NeedAnalysis ctx={ctx} />
  const req = sortByValue(cases).filter((c: any) => recountRequired(c, meta, byCode) || recountOutcome(c) || (c.status === 'cerrada'))
  const blind = (meta.rules || DEFAULT_RULES).blind
  const byLoc: Record<string, any[]> = {}
  req.filter((c: any) => !recountOutcome(c)).forEach((c: any) => { (byLoc[c.loc || 'Sin ubicación'] ||= []).push(c) })
  const locs = Object.keys(byLoc).sort()
  const done = req.filter((c: any) => recountOutcome(c)).length
  function printList() {
    printHtml(`<h1>Lista de recuento</h1><p>${esc(meta.company)} · ${esc(meta.name)} · corte ${esc(fmtCutoff(meta.cutoff))}</p><table><thead><tr><th>Ubicación</th><th>Código</th><th>Artículo</th>${blind ? '' : '<th>Sistema</th>'}<th>Recuento</th></tr></thead><tbody>` +
      locs.flatMap((l) => byLoc[l].map((c: any) => `<tr><td>${esc(l)}</td><td>${esc(c.code)}</td><td>${esc(c.desc)}</td>${blind ? '' : `<td>${c.sys}</td>`}<td style="width:30mm">&nbsp;</td></tr>`)).join('') + '</tbody></table>')
  }
  return (
    <main className="wrap page">
      <div><h1 className="display">Recuento</h1><p className="lede">{req.length} casos necesitan recuento antes de proponerse. La lista sale agrupada por ubicación{blind ? ' y sin la cantidad esperada' : ''}.</p></div>
      <div className="main-side" style={{ flexDirection: 'row-reverse' }}>
        <div className="main">
          <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="rs">
            <div className="pad-s row between g10"><h2 id="rs" className="h2">Resultados</h2><Tag c="t-ys">{done} de {req.length} con resultado</Tag></div>
            <div className="tablebox stack-table"><table><thead><tr><th>Artículo</th><th className="r">Sistema</th><th className="r">Conteo</th><th className="r">Recuento</th><th>Qué significa</th></tr></thead>
              <tbody>
                {req.map((c: any) => { const o = recountOutcome(c)
                  const m = o === 'sistema' ? ['Igual al sistema', 't-g', 'Error de conteo: se cierra sin ajuste.'] : o === 'conteo' ? ['Igual al conteo', 't-b', c.kind === 'none' ? 'Sin documento que lo explique: queda como faltante o sobrante real.' : 'Confirma la diferencia; ya se puede proponer.'] : o === 'otro' ? ['Otro número', 't-r', 'Segundo recuento, o lo decide quien aprueba.'] : ['Pendiente', 't-s', 'Recontar' + (c.loc ? ' en ' + c.loc : '') + '.']
                  return (
                    <tr key={c.code}><td className="span" data-l="Artículo"><strong>{c.desc || c.code}</strong><div className="mono code">{c.code}</div></td>
                      <td className="r mono num" data-l="Sistema">{plain(c.sys)}</td><td className="r mono num" data-l="Conteo">{plain(c.phys)}</td>
                      <td className="r" data-l="Recuento"><label className="sr" htmlFor={'rc-' + c.code}>Recuento de {c.desc || c.code}</label>
                        <input id={'rc-' + c.code} className="input sm mono recount-in" inputMode="decimal" defaultValue={c.recount ?? ''} placeholder="—" disabled={!!data.signed || approver}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(c.recount ?? '')) ctx.decide(c.code, 'recount', { recount: v }) }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></td>
                      <td className="span" data-l="Qué significa"><Tag c={m[1]}>{m[0]}</Tag><div className="xs muted" style={{ marginTop: 6 }}>{m[2]}</div></td></tr>) })}
                {!req.length && <tr><td colSpan={5} className="muted">No hay recuentos pendientes.</td></tr>}
              </tbody></table></div>
          </section>
          <section className="card flat pad grid c3" style={{ gap: 16 }} aria-labelledby="cl">
            <h2 id="cl" className="h3" style={{ gridColumn: '1/-1' }}>Cómo se lee un recuento</h2>
            <div className="stack g6 small"><span className="tag t-g" style={{ alignSelf: 'flex-start' }}>Igual al sistema</span>Fue un error de conteo. El caso se cierra sin ajuste.</div>
            <div className="stack g6 small"><span className="tag t-b" style={{ alignSelf: 'flex-start' }}>Igual al conteo</span>La diferencia es real. Sigue la causa propuesta.</div>
            <div className="stack g6 small"><span className="tag t-r" style={{ alignSelf: 'flex-start' }}>Otro número</span>Segundo recuento, o lo decide quien aprueba.</div>
          </section>
        </div>
        <aside className="side">
          <section className="card dark pad stack g16" aria-labelledby="pl">
            <div><span className="mono xs" style={{ color: 'var(--yellow)' }}>Lista para el piso{blind ? ' · recuento ciego' : ''}</span><h2 id="pl" className="h2" style={{ marginTop: 4 }}>{locs.length} ubicaciones, {req.length - done} artículos</h2></div>
            <ul className="list">{locs.map((l) => (
              <li key={l} style={{ borderColor: '#3A443D' }}><span className="mono small" style={{ color: 'var(--yellow)', fontWeight: 600 }}>{l}</span>
                <div>{byLoc[l].map((c: any) => <div key={c.code}>{c.desc || c.code}{!blind && <span className="mono xs" style={{ color: '#C9BFA9' }}> (sistema {c.sys})</span>}</div>)}</div></li>))}</ul>
            {locs.length > 0 && <button className="btn ghost-light sm" style={{ alignSelf: 'flex-start' }} onClick={printList}>Imprimir lista</button>}
          </section>
        </aside>
      </div>
    </main>
  )
}

/* ---------------- 5. Aprobación ---------------- */
function Approval({ ctx }: { ctx: Ctx }) {
  const { data, cases, meta, base, approver } = ctx
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [name, setName] = useState(shortName(meta.approver))
  const [ack, setAck] = useState(false)
  if (!data.analysis) return <NeedAnalysis ctx={ctx} />
  const seen: Record<string, boolean> = {}
  const att = sortByValue(cases).filter((c: any) => { if (!needsAttention(c) || seen[c.code]) return false; if (c.pair) seen[c.pair] = true; return true })
  const docOk = cases.filter((c: any) => c.status === 'propuesta' && !needsAttention(c))
  const closed = cases.filter((c: any) => c.status === 'cerrada')
  const out = cases.filter((c: any) => c.status !== 'propuesta' && c.status !== 'cerrada')
  const pendingAtt = att.filter((c: any) => !c.approval).length
  const lines = cases.filter((c: any) => c.status === 'propuesta' && c.approval !== 'devuelta' && finalQty(c) !== 0)
  const loss = lines.filter((c: any) => ['Faltante real', 'Merma o vencido sin dar de baja'].includes(c.cause)).reduce((s: number, c: any) => s + finalValue(c), 0)
  const cats: Record<string, number> = {}
  lines.forEach((c: any) => { const k = CATEGORY[c.cause]; cats[k] = (cats[k] || 0) + finalValue(c) })
  const self = selfApproval(meta)
  async function sign() {
    if (!ack) { toast('Marque la casilla de revisión para firmar'); return }
    try {
      const token = base.split('/aprobar/')[1]
      const r: any = await api('POST', `/api/approve/${token}/sign`, { name })
      ctx.setData({ ...data, signed: r.signed }); toast('Cierre firmado'); go(`${base}/ajuste`)
    } catch (e: any) { toast(e.message) }
  }
  return (
    <main className="wrap page">
      <div className="stack g12"><h1 className="display">Aprobar el cierre</h1>
        <p className="lede" style={{ margin: 0 }}>{shortName(meta.investigator) || 'Quien investiga'} investigó las {cases.length} diferencias. Revise lo que necesita criterio; el resto viene respaldado por documentos.</p>
        <Tag c={self ? 't-ys' : 't-g'} style={{ alignSelf: 'flex-start' }}>{self ? 'Investiga y aprueba la misma persona · sin separación de funciones' : `Investigó ${shortName(meta.investigator)} · aprueba ${shortName(meta.approver)} · funciones separadas`}</Tag></div>
      {!data.sentAt && !data.signed && <div className="note">Quien investiga todavía no ha enviado el cierre.</div>}
      <section className="grid c4" aria-label="Resumen">
        <div className="card kpi"><span className="k">Ajuste neto</span><span className="v">{money(data.signed ? data.signed.total : adjustmentTotal(cases))}</span><span className="xs muted">{out.length} caso(s) quedan fuera</span></div>
        <div className="card kpi"><span className="k">Pérdida real y merma</span><span className="v neg">{money(loss)}</span><span className="xs muted">Sin documento que la explique, o merma</span></div>
        <div className="card kpi"><span className="k">Respaldadas por documento</span><span className="v pos">{docOk.length}</span><span className="xs muted">{closed.length} cerradas por error de conteo</span></div>
        <div className="card kpi"><span className="k">Su atención</span><span className="v" style={{ color: 'var(--blue)' }}>{att.length}</span><span className="xs muted">{pendingAtt} sin decidir</span></div>
      </section>
      <div className="main-side">
        <div className="main">
          <h2 className="h2">Requieren su atención <span className="sub">— {att.length} casos</span></h2>
          {!att.length && <p className="card flat pad-s small" style={{ margin: 0 }}>Nada pendiente de criterio.</p>}
          {att.map((c: any) => {
            const why = c.cause === 'Faltante real' || c.cause === 'Sobrante sin documento' ? [c.cause, 't-r', 'Ningún documento explica la diferencia' + (recountOutcome(c) ? ' y el recuento la confirmó.' : '.')]
              : c.cause !== c.originalCause ? ['Causa cambiada', 't-ys', `Zeli sugirió ${c.originalCause.toLowerCase()}; quien investiga la cambió a ${c.cause.toLowerCase()}.`]
              : recountOutcome(c) === 'otro' ? ['Recuento distinto', 't-r', `El recuento dio otro número (${c.recount}); el ajuste usa el recuento.`] : ['Requiere criterio', 't-b', c.explain]
            return (
              <article key={c.code} className="card pad stack g10">
                <div className="row between start g10"><div className="row g8"><Tag c={why[1]}>{why[0]}</Tag>{c.approval === 'aceptada' && <Tag c="t-g">Aceptada</Tag>}{c.approval === 'devuelta' && <Tag c="t-r">Devuelta</Tag>}</div>
                  <span className={'mono num ' + cls(finalValue(c))} style={{ fontWeight: 600 }}>{money(finalValue(c))}</span></div>
                <h3 className="h3" style={{ fontSize: '1.35rem' }}>{c.desc || c.code} · {fmtN(finalQty(c))}</h3>
                <p className="small" style={{ margin: 0 }}>{why[2]}</p>
                {c.note && <p className="xs muted" style={{ margin: 0 }}>Nota de quien investiga: {c.note}</p>}
                {approver && !data.signed && !c.approval && (
                  <>
                    <div className="field"><label htmlFor={'rn-' + c.code}>Comentario (si la devuelve)</label><input id={'rn-' + c.code} className="input sm" value={notes[c.code] || ''} onChange={(e) => setNotes({ ...notes, [c.code]: e.target.value })} /></div>
                    <div className="row g10 tap-row" style={{ marginTop: 4 }}><button className="btn sm" onClick={() => ctx.approve(c.code, 'aceptada')}>Aceptar</button><button className="btn ghost sm" onClick={() => ctx.approve(c.code, 'devuelta', notes[c.code] || '')}>Devolver con comentario</button><a className="small" href={`${base}/caso/${encodeURIComponent(c.code)}`} style={{ fontWeight: 650, padding: '8px 4px' }}>Ver evidencia</a></div>
                  </>
                )}
                {approver && !data.signed && c.approval && <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => ctx.approve(c.code, null)}>Deshacer</button>}
                {!approver && <a className="small" href={`${base}/caso/${encodeURIComponent(c.code)}`} style={{ fontWeight: 650 }}>Ver evidencia</a>}
              </article>)
          })}
          <section className="card flat pad-s row between g10"><div><h2 className="h3">Respaldadas por documento — {docOk.length} casos</h2><p className="small muted" style={{ margin: '4px 0 0' }}>Cada una tiene el documento que la explica.{closed.length ? ` ${closed.length} se cerró por error de conteo.` : ''}</p></div><a href={`${base}/diferencias`} className="small" style={{ fontWeight: 700 }}>Ver lista →</a></section>
          {out.length > 0 && <section className="card dash pad-s stack g6"><h2 className="h3">Fuera de este ajuste — {out.length}</h2><p className="small muted" style={{ margin: 0 }}>{out.map((c: any) => c.desc || c.code).join(', ')}. Siguen sin propuesta o en recuento; pasan abiertos al próximo conteo.</p></section>}
        </div>
        <aside className="side">
          <section className="card flat pad stack g8" aria-labelledby="ec"><h2 id="ec" className="h3">Efecto contable sugerido</h2>
            <ul className="list small">{Object.keys(cats).map((k) => <li key={k} className="row between g10"><span>{k}</span><span className={'mono num ' + cls(cats[k])} style={{ fontWeight: 600 }}>{money(cats[k])}</span></li>)}</ul>
            <span className="xs muted">Es una sugerencia por categoría. Las cuentas y el asiento los define su contador.</span></section>
          {data.signed ? (
            <section className="card dark pad stack g10"><h2 className="h2">Firmado</h2><p className="small" style={{ margin: 0 }}>{data.signed.by} · {fmtDateTime(data.signed.at)}</p><a className="btn yellow block" href={`${base}/ajuste`}>Ver archivo de ajuste</a></section>
          ) : approver ? (
            <section className="card dark pad stack g12" aria-labelledby="fi"><h2 id="fi" className="h2">Firmar</h2>
              <p className="small" style={{ margin: 0 }}>{out.length ? `${out.length} caso(s) quedan fuera del ajuste. ` : ''}{pendingAtt ? `Decida los ${pendingAtt} casos de atención para firmar.` : 'Todos los casos de atención están decididos.'}</p>
              <div className="field"><label htmlFor="sn" style={{ color: 'var(--cream)' }}>Su nombre</label><input id="sn" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <label className="check"><input type="checkbox" checked={ack} disabled={!!pendingAtt} onChange={(e) => setAck(e.target.checked)} /> Revisé los casos que requieren mi atención y apruebo el ajuste</label>
              <button className="btn yellow block" onClick={sign} disabled={!!pendingAtt}>Firmar cierre</button></section>
          ) : (
            <section className="card dark pad stack g10"><h2 className="h2">Firma</h2>
              {data.approverLink ? <>
                <p className="small" style={{ margin: 0 }}>Firma {self ? 'usted mismo' : shortName(meta.approver)} con este enlace{meta.approverEmail && !self ? ` (también se envió a ${meta.approverEmail} si el correo está configurado)` : ''}:</p>
                <input className="input sm mono" readOnly value={data.approverLink} onFocus={(e) => e.target.select()} aria-label="Enlace de aprobación" />
                <div className="row g10"><button className="btn yellow sm" onClick={() => navigator.clipboard.writeText(data.approverLink!).then(() => toast('Enlace copiado'))}>Copiar enlace</button>
                  {self && <a className="btn ghost-light sm" href={data.approverLink.slice(data.approverLink.indexOf('#'))}>Revisar y firmar yo mismo</a>}</div>
              </> : <p className="small" style={{ margin: 0 }}>Envíe el cierre desde Diferencias para generar el enlace de aprobación.</p>}
            </section>
          )}
        </aside>
      </div>
    </main>
  )
}

/* ---------------- 6. Ajuste ---------------- */
function esc(s: any) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]) }
function printHtml(html: string) {
  const r = document.getElementById('report')!
  r.innerHTML = html
  window.print()
}
function csv(rows: any[][]) { return rows.map((r) => r.map((x) => { const s = String(x ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }).join(',')).join('\r\n') }
function download(name: string, text: string) {
  const b = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }); const u = URL.createObjectURL(b)
  const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click()
  setTimeout(() => { URL.revokeObjectURL(u); a.remove() }, 500); toast('Descargado: ' + name)
}

function Adjustment({ ctx }: { ctx: Ctx }) {
  const { data, cases, meta, base } = ctx
  if (!data.analysis) return <NeedAnalysis ctx={ctx} />
  if (!data.signed) return (
    <main className="wrap page"><div><h1 className="display">Archivo de ajuste</h1><p className="lede">Se habilita cuando quien aprueba firma el cierre.</p></div>
      <div className="card pad stack g12" style={{ maxWidth: 640 }}><p style={{ margin: 0 }}>Mientras tanto, el ajuste neto propuesto es <strong className="mono">{money(adjustmentTotal(cases))}</strong> en {adjustmentLines(cases).length} líneas.</p><a className="btn" href={`${base}/aprobacion`} style={{ alignSelf: 'flex-start' }}>Ir a aprobación</a></div></main>
  )
  const s = data.signed
  const lines: any[] = s.lines
  const out = cases.filter((c: any) => c.status !== 'propuesta' && c.status !== 'cerrada')
  const slug = (meta.company || 'cierre').replace(/\W+/g, '_')
  function report() {
    printHtml(`<h1>Informe de cierre de conteo</h1>
      <p>${esc(meta.company)} · ${esc(meta.name)} · corte ${esc(fmtCutoff(meta.cutoff))}</p>
      <p>Investigó: ${esc(meta.investigator)} · Firmó: ${esc(s.by)} · ${esc(fmtDateTime(s.at))}</p>
      ${s.self ? '<p><strong>Sin separación de funciones:</strong> investigó y aprobó la misma persona.</p>' : ''}
      <p>Diferencias: ${cases.length} · en el ajuste: ${lines.length} · fuera: ${out.length} · ajuste neto: <strong>${esc(money(s.total))}</strong></p>
      <table><thead><tr><th>Código</th><th>Artículo</th><th>Ajuste</th><th>Valor</th><th>Causa</th><th>Respaldo</th><th>Categoría</th></tr></thead><tbody>
      ${lines.map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.desc)}</td><td>${esc(fmtN(l.qty))}</td><td>${esc(money(l.value))}</td><td>${esc(l.cause)}</td><td>${esc(l.summary)}</td><td>${esc(l.category)}</td></tr>`).join('')}
      </tbody></table>
      <h2>Registro</h2><ul>${data.log.map((l) => `<li>${esc(fmtDateTime(l.at))} · ${esc(l.by)} · ${esc(l.t)}</li>`).join('')}</ul>`)
  }
  return (
    <main className="wrap page">
      <div className="row between end g16 page-head"><div><h1 className="display">Archivo de ajuste</h1><p className="lede">Firmado por {s.by} · {fmtDateTime(s.at)} · investigó {meta.investigator}</p></div><span className="stamp">FIRMADO</span></div>
      {s.self && <p className="note" style={{ margin: 0 }}>Investigó y aprobó la misma persona. El informe lo indica como “sin separación de funciones”.</p>}
      <div className="main-side">
        <div className="main">
          <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="la"><div className="pad-s"><h2 id="la" className="h2">Líneas aprobadas <span className="sub">— {lines.length}</span></h2></div>
            <div className="tablebox stack-table"><table><thead><tr><th>Artículo</th><th className="r">Ajuste</th><th className="r">Valor</th><th>Causa · respaldo</th><th>Categoría sugerida</th></tr></thead>
              <tbody>{lines.map((l) => <tr key={l.code}><td className="span" data-l="Artículo"><strong>{l.desc || l.code}</strong><div className="mono code">{l.code}</div></td><td className={'r mono num ' + cls(l.qty)} data-l="Ajuste" style={{ fontWeight: 600 }}>{fmtN(l.qty)}</td><td className={'r mono num ' + cls(l.value)} data-l="Valor" style={{ fontWeight: 600 }}>{money(l.value)}</td><td className="span" data-l="Causa · respaldo"><div style={{ fontWeight: 650 }}>{l.cause}</div><div className="xs muted">{l.summary}</div></td><td className="span small" data-l="Categoría sugerida">{l.category}</td></tr>)}</tbody></table></div></section>
          {out.length > 0 && <section className="card dash pad-s stack g6"><h2 className="h3">Fuera de este ajuste — {out.length}</h2><p className="small muted" style={{ margin: 0 }}>{out.map((c: any) => c.desc || c.code).join(', ')}. Pasan abiertos al próximo conteo.</p></section>}
        </div>
        <aside className="side">
          <section className="card pad stack g12" aria-labelledby="dl"><h2 id="dl" className="h2">Descargar</h2>
            <div className="stack g4" style={{ paddingBottom: 12, borderBottom: '1px solid var(--rule)' }}><span className="xs muted" style={{ fontWeight: 650 }}>Ajuste neto firmado</span><span className="mono num" style={{ fontSize: '1.8rem', fontWeight: 600 }}>{money(s.total)}</span></div>
            <button className="btn block" onClick={() => download(`ajuste_${slug}.csv`, csv([['Código', 'Artículo', 'Ajuste', 'Costo', 'Valor', 'Causa', 'Respaldo', 'Categoría sugerida', 'Firmó'], ...lines.map((l) => [l.code, l.desc, l.qty, Number(l.cost).toFixed(2), Number(l.value).toFixed(2), l.cause, l.summary, l.category, s.by])]))}>Archivo de ajuste (CSV para Excel)</button>
            <button className="btn ghost block" onClick={() => download('ajuste_importar.csv', csv([['codigo', 'cantidad', 'costo_unitario', 'motivo'], ...lines.map((l) => [l.code, l.qty, Number(l.cost).toFixed(2), l.cause])]))}>CSV para importar al ERP</button>
            <button className="btn ghost block" onClick={report}>Informe de cierre (imprimir o PDF)</button>
            <p className="note xs" style={{ margin: 0 }}>Este archivo no modifica su sistema. Impórtelo o regístrelo en su ERP como cualquier ajuste.</p></section>
        </aside>
      </div>
    </main>
  )
}
