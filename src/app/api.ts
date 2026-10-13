export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }
  if (!r.ok) {
    const e: any = new Error((data && data.error) || `Error ${r.status}`)
    e.status = r.status
    throw e
  }
  return data as T
}

export type Me = { email: string | null; ai: boolean; mail: boolean }

export type CloseData = {
  id: string
  meta: any
  analysis: any
  decisions: Record<string, any>
  log: { at: string; by: string; t: string }[]
  signed: any
  sentAt: string | null
  approverLink: string | null
  files: Record<string, { filename: string; mapping: any; n: number; updated_at: string }>
  approverView?: boolean
}
