// Envío de reportes por correo (SMTP). Sistemas configura el servidor de salida
// y Recursos Humanos decide a quién se envía.
const nodemailer = require('nodemailer');

const FRIENDLY = {
  EAUTH: 'El servidor de correo rechazó el usuario o la contraseña. Revise los datos del correo en Configuración.',
  ECONNECTION: 'No se pudo conectar con el servidor de correo. Revise el servidor y el puerto en Configuración.',
  ETIMEDOUT: 'El servidor de correo no respondió. Revise que haya internet e intente de nuevo.',
  EDNS: 'No se encontró el servidor de correo. Revise el nombre escrito en Configuración.',
  EENVELOPE: 'Alguna dirección de correo no es válida. Revise la lista de destinatarios.',
};

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// "a@x.com, b@y.com; c@z.com" → lista limpia (sin repetidos).
function parseList(text) {
  return [...new Set(String(text || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
}

function invalidEmails(text) {
  return parseList(text).filter((x) => !EMAIL_RE.test(x));
}

const configurado = (s) => !!(s.smtp_host && s.smtp_remitente);

async function send(settings, { to, subject, text, attachments = [] }) {
  if (!configurado(settings)) {
    const e = new Error('Falta configurar el servidor de correo (Configuración → Opciones avanzadas). Pídalo a sistemas.');
    e.status = 400;
    throw e;
  }
  const lista = parseList(to);
  if (!lista.length) {
    const e = new Error('No hay a quién enviar: escriba al menos un correo en Configuración → Envío por correo.');
    e.status = 400;
    throw e;
  }
  const port = Number(settings.smtp_port) || 587;
  const transport = nodemailer.createTransport({
    host: settings.smtp_host,
    port,
    // 465 usa conexión cifrada desde el inicio; 587 la cifra después (STARTTLS).
    secure: settings.smtp_seguro === true || port === 465,
    auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_password } : undefined,
    connectionTimeout: 20000,
  });
  try {
    await transport.sendMail({ from: settings.smtp_remitente, to: lista.join(', '), subject, text, attachments });
    return lista;
  } catch (err) {
    const e = new Error(FRIENDLY[err.code] || 'No se pudo enviar el correo. Intente de nuevo; si sigue fallando, avise a sistemas.');
    e.tecnico = `${err.code || ''} ${err.message}`.trim();
    e.status = 502;
    throw e;
  }
}

module.exports = { send, parseList, invalidEmails, configurado };
