// Envío de correo con Resend (RESEND_API_KEY, MAIL_FROM). Sin clave, no envía y lo informa.
export function mailEnabled() { return !!process.env.RESEND_API_KEY }

export async function sendMail({ to, subject, html, text }) {
  if (!mailEnabled()) return { sent: false }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'Zeli Inventory <inventory@zeli.lat>', to: [to], subject, html, text }),
  })
  if (!r.ok) throw new Error('No se pudo enviar el correo (' + r.status + '): ' + (await r.text()).slice(0, 200))
  return { sent: true }
}
