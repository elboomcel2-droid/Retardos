// Inicio de sesión: contraseñas cifradas (scrypt), sesiones con cookie y
// permisos por rol. Todo queda en la base local; no usa servicios externos.
const crypto = require('node:crypto');

const COOKIE = 'retardos_sesion';
// La sesión se cierra sola tras 8 horas sin usar el sistema.
const SESSION_HOURS = 8;
// Tras 5 intentos fallidos seguidos, el usuario queda bloqueado 5 minutos.
const MAX_FAILS = 5;
const LOCK_MIN = 5;

const ROLES = {
  admin: { nombre: 'Administrador', desc: 'Todo, incluidos usuarios y la conexión con los checadores' },
  rh: { nombre: 'Recursos Humanos', desc: 'Justificaciones, nombres, bajas, festivos, horarios y reglas' },
  consulta: { nombre: 'Solo consulta', desc: 'Ver, descargar e imprimir reportes y actualizar checadas' },
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(password), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function checkPassword(password) {
  if (String(password || '').length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
  return null;
}

// Usuario para entrar: minúsculas, números, punto o guion bajo (ej. "luz.samano").
function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}
const LOGIN_RE = /^[a-z0-9._]{3,30}$/;

const newToken = () => crypto.randomBytes(32).toString('hex');

function readCookie(req, name = COOKIE) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

// Intentos fallidos por usuario (en memoria: se reinician al reiniciar el sistema).
const fails = new Map();
function lockedMinutes(login) {
  const f = fails.get(login);
  if (!f || f.count < MAX_FAILS) return 0;
  const left = f.until - Date.now();
  if (left <= 0) {
    fails.delete(login);
    return 0;
  }
  return Math.ceil(left / 60000);
}
function registerFail(login) {
  const f = fails.get(login) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) f.until = Date.now() + LOCK_MIN * 60000;
  fails.set(login, f);
}
const clearFails = (login) => fails.delete(login);

// Qué puede hacer cada rol. Ver y descargar reportes lo pueden todos.
function allowed(rol, method, url) {
  if (rol === 'admin' || url === '/api/cuenta/clave') return true;
  if (url.startsWith('/api/usuarios')) return false;
  if (method === 'GET') return url.startsWith('/api/audit') ? rol === 'rh' : true;
  if (rol === 'rh') return !/^\/api\/branches\/[^/]+\/test/.test(url);
  // Solo consulta: actualizar checadas y dejar constancia de impresiones.
  return url === '/api/sync' || url === '/api/registro/impresion';
}

module.exports = {
  COOKIE,
  SESSION_HOURS,
  ROLES,
  LOGIN_RE,
  hashPassword,
  verifyPassword,
  checkPassword,
  normalizeLogin,
  newToken,
  readCookie,
  setSessionCookie,
  clearSessionCookie,
  lockedMinutes,
  registerFail,
  clearFails,
  allowed,
};
