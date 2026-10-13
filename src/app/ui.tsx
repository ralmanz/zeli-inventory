import { useEffect, useState, type ReactNode } from 'react'

export const fmtN = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US')
export const money = (n: number, sign = true) => {
  const s = '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (!sign) return (n < 0 ? '−' : '') + s
  return (n < 0 ? '−' : n > 0 ? '+' : '') + s
}
export const cls = (n: number) => (n < 0 ? 'neg' : n > 0 ? 'pos' : '')
export const plain = (n: number) => n.toLocaleString('en-US')

export function fmtDateTime(v: string | null | undefined) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  return d.toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' })
}
/** "2026-09-30T18:00" (hora local del negocio) → "30/09/2026 · 18:00" */
export function fmtCutoff(v: string) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return v || '—'
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` · ${m[4]}:${m[5]}` : ''}`
}
export function daysBetween(fromIso: string, to = new Date()) {
  const m = String(fromIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const a = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.floor((b - a) / 86400000) + 1
}

export function useHash() {
  const [h, setH] = useState(() => location.hash)
  useEffect(() => {
    const f = () => { setH(location.hash); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return h
}
export const go = (hash: string) => { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash }

let toastTimer: any
export function toast(msg: string) {
  let el = document.getElementById('toast')
  if (!el) {
    el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite')
    document.body.appendChild(el)
  }
  el.textContent = msg; el.hidden = false
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el!.hidden = true }, 3200)
}

export const Logo = () => (
  <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
    <rect x="0" width="3" height="18" fill="#1E2621" /><rect x="5" width="1.5" height="18" fill="#1E2621" /><rect x="8.5" width="3" height="18" fill="#1E2621" />
    <rect x="13.5" width="1.5" height="18" fill="#1E2621" /><rect x="17" width="1.5" height="18" fill="#1E2621" /><rect x="20" width="2" height="18" fill="#1E2621" />
  </svg>
)

export const Tag = ({ c, children, style }: { c: string; children: ReactNode; style?: React.CSSProperties }) => <span className={'tag ' + c} style={style}>{children}</span>

const STEPS: [string, string][] = [['archivos', '1 Archivos'], ['diferencias', '2 Diferencias'], ['caso', '3 Revisión'], ['recuento', '4 Recuento'], ['aprobacion', '5 Aprobación'], ['ajuste', '6 Ajuste']]

export function Header({ base, step, meta, right, steps = true, home = '#/' }: { base?: string; step?: string; meta?: any; right?: ReactNode; steps?: boolean; home?: string }) {
  return (
    <header className="top">
      <div className="wrap bar1">
        <div className="row g16">
          <a className="brand" href={home}><Logo /><b>Zeli</b><span>Inventory</span></a>
          {meta && <span className="ctx">{[meta.company, meta.name].filter(Boolean).join(' · ')}</span>}
        </div>
        <div className="row g10">{right}</div>
      </div>
      {steps && base && (
        <nav className="wrap steps" aria-label="Pasos del cierre">
          {STEPS.map(([k, label]) => (
            <a key={k} href={`${base}/${k}`} aria-current={k === step ? 'step' : undefined}>{label}</a>
          ))}
        </nav>
      )}
    </header>
  )
}

export function DayCounter({ meta, signed, kardexSince }: { meta: any; signed: any; kardexSince?: number }) {
  const day = daysBetween(meta.cutoff)
  const total = meta.deadline && meta.cutoff ? daysBetween(meta.cutoff, new Date(meta.deadline + 'T12:00')) : null
  if (signed) return <Tag c="t-g">Firmado {fmtDateTime(signed.at)}</Tag>
  if (day == null) return null
  const late = total != null && day > total
  return (
    <>
      <Tag c={late ? 't-r' : 't-y'}>Día {day}{total && !late ? ` de ${total}` : ''}{meta.deadline ? (late ? ` · venció ${fmtCutoff(meta.deadline)}` : ` · cierra ${fmtCutoff(meta.deadline)}`) : ''}</Tag>
      {kardexSince != null && kardexSince > 0 && <span className="ctx xs">{kardexSince} {kardexSince === 1 ? 'movimiento' : 'movimientos'} en el kardex desde el corte</span>}
    </>
  )
}

export function Loading() { return <main className="wrap page"><p className="muted">Cargando…</p></main> }
export function ErrorBox({ msg }: { msg: string }) { return <main className="wrap page"><div className="note" style={{ background: 'var(--red-soft)' }}>{msg}</div></main> }
