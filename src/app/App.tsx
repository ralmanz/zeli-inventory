import { useEffect, useState } from 'react'
import { api, type Me } from './api.ts'
import { Header, useHash, go, toast, Loading, fmtCutoff, Tag } from './ui.tsx'
import CloseApp from './close.tsx'

export default function App() {
  const hash = useHash()
  const [me, setMe] = useState<Me | null>(null)
  useEffect(() => { api<Me>('GET', '/api/me').then(setMe).catch(() => setMe({ email: null, ai: false, mail: false })) }, [])

  const path = hash.replace(/^#\/?/, '').split('?')[0]
  const parts = path.split('/').filter(Boolean)

  // Quien aprueba: enlace privado, sin cuenta
  if (parts[0] === 'aprobar' && parts[1]) return <CloseApp token={parts[1]} sub={parts.slice(2)} me={me} />

  if (!me) return <Loading />
  if (!me.email) return <Login />
  if (parts[0] === 'c' && parts[1]) return <CloseApp id={parts[1]} sub={parts.slice(2)} me={me} />
  return <Home me={me} />
}

function Login() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<{ sent?: boolean; devLink?: string; error?: string; busy?: boolean }>({})
  const bad = /error=enlace/.test(location.hash)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState({ busy: true })
    try { const r: any = await api('POST', '/api/auth/request', { email }); setState(r) } catch (er: any) { setState({ error: er.message }) }
  }
  return (
    <>
      <Header steps={false} />
      <main className="wrap page" style={{ maxWidth: 640 }}>
        <div><h1 className="display">Entrar</h1><p className="lede">Le enviamos un enlace a su correo. No hay contraseña.</p></div>
        {bad && <div className="note" style={{ background: 'var(--red-soft)' }}>El enlace venció o ya se usó. Pida uno nuevo.</div>}
        <form className="card pad stack g12" onSubmit={submit}>
          <div className="field"><label htmlFor="em">Correo</label><input id="em" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn" disabled={state.busy}>{state.busy ? 'Enviando…' : 'Enviarme el enlace'}</button>
          {state.sent && <p className="note small" style={{ margin: 0, background: 'var(--green-soft)' }}>Listo. Revise su correo y abra el enlace en este navegador.</p>}
          {state.devLink && <p className="note small" style={{ margin: 0 }}>El envío de correo no está configurado. Enlace de desarrollo: <a href={state.devLink}>entrar</a></p>}
          {state.error && <p className="note small" style={{ margin: 0, background: 'var(--red-soft)' }}>{state.error}</p>}
        </form>
        <p className="small muted">¿Quiere ver cómo funciona primero? <a href="/demo/">Ver el ejemplo</a></p>
      </main>
    </>
  )
}

function Home({ me }: { me: Me }) {
  const [list, setList] = useState<any[] | null>(null)
  useEffect(() => { api<any[]>('GET', '/api/closes').then(setList).catch((e) => toast(e.message)) }, [])
  async function create() {
    const c: any = await api('POST', '/api/closes', { meta: { name: 'Nuevo cierre', investigator: me.email } })
    go(`#/c/${c.id}/archivos`)
  }
  async function logout() { await api('POST', '/api/auth/logout'); location.hash = '#/'; location.reload() }
  return (
    <>
      <Header steps={false} right={<><span className="ctx small">{me.email}</span><button className="btn ghost sm" onClick={logout}>Salir</button></>} />
      <main className="wrap page">
        <div className="row between end g16">
          <div><h1 className="display">Cierres de conteo</h1><p className="lede">Cada conteo se cierra aquí: diferencias explicadas con su documento, aprobadas y listas para el sistema.</p></div>
          <div className="row g10"><a className="btn" href="/demo/">Ver ejemplo</a><button className="btn ghost" onClick={create}>Nuevo cierre</button></div>
        </div>
        {!me.ai && <p className="small muted" style={{ margin: 0 }}>Redacción con el modelo: apagada (falta la clave). El análisis funciona igual.</p>}
        {list == null ? <p className="muted">Cargando…</p> : !list.length ? (
          <div className="card pad stack g10" style={{ maxWidth: 640 }}><h2 className="h2">Aún no hay cierres</h2><p style={{ margin: 0 }}>Cree uno y suba el conteo y los saldos del sistema. También puede probar con los archivos de ejemplo.</p><div className="row g10" style={{ alignSelf: 'flex-start' }}><a className="btn" href="/demo/">Ver ejemplo</a><button className="btn ghost" onClick={create}>Nuevo cierre</button></div></div>
        ) : (
          <section className="grid c3">
            {list.map((c) => (
              <a key={c.id} href={`#/c/${c.id}/${c.analyzed ? 'diferencias' : 'archivos'}`} className="card pad stack g8" style={{ textDecoration: 'none' }}>
                <div className="row between start g10"><h2 className="h3" style={{ fontSize: '1.35rem' }}>{c.meta.name}</h2>
                  {c.signed ? <Tag c="t-g">Firmado</Tag> : c.sentAt ? <Tag c="t-b">En aprobación</Tag> : c.analyzed ? <Tag c="t-y">En investigación</Tag> : <Tag c="t-s">Sin cruce</Tag>}</div>
                <span className="small muted">{c.meta.company || 'Sin empresa'} · corte {fmtCutoff(c.meta.cutoff)}</span>
                <span className="small">{c.analyzed ? `${c.nCases} diferencias` : 'Faltan archivos'}</span>
              </a>
            ))}
          </section>
        )}
      </main>
    </>
  )
}
