// Redacción con Claude. Solo se usa si ANTHROPIC_API_KEY está configurada; sin ella todo funciona igual
// con los textos que arma el motor. El modelo nunca decide la causa: solo la explica con la evidencia dada.

export function aiEnabled() { return !!process.env.ANTHROPIC_API_KEY }

async function claude(system, user, maxTokens = 2000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  })
  if (!r.ok) throw new Error('Claude ' + r.status + ': ' + (await r.text()).slice(0, 200))
  const j = await r.json()
  return (j.content || []).map((b) => b.text || '').join('')
}

/** Reescribe la explicación de los casos que requieren criterio o no tienen documento. Devuelve {code: texto}. */
export async function explainCases(cases) {
  if (!aiEnabled()) return {}
  const pick = cases.filter((c) => c.kind !== 'doc').slice(0, 60)
  if (!pick.length) return {}
  const payload = pick.map((c) => ({
    codigo: c.code, articulo: c.desc, sistema: c.sys, fisico: c.phys, diferencia: c.diff, costo: c.cost,
    causa_propuesta: c.cause, evidencia: c.evidence.slice(0, 6), revisadas: c.checks.filter((x) => x[0] !== 'Descartada').slice(0, 6),
  }))
  const system = 'Eres analista de inventarios en Panamá. Explicas diferencias de conteo a un gerente, en español claro, en 2 o 3 frases, sin inventar datos: usa solo la evidencia dada. Si la evidencia no basta, dilo y sugiere qué verificar. No cambies la causa propuesta.'
  const user = 'Para cada caso, escribe la explicación. Responde SOLO con JSON: {"<codigo>": "<explicación>", ...}\n\n' + JSON.stringify(payload)
  const text = await claude(system, user, 4000)
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return {}
  try { return JSON.parse(m[0]) } catch { return {} }
}
