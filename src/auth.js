// Inicio de sesión: contraseñas cifradas (scrypt), sesiones con cookie y
// permisos por rol. Todo queda en la base local; no usa servicios externos.
const crypto = require('node:crypto');

const COOKIE = 'retardos_sesion';
// La sesión se cierra sola tras 8 horas sin usar el sistema.
const SESSION_HOURS = 8;
// Tras 5 intentos fallidos seguidos, el usuario queda bloqueado 5 minutos.
const MAX_FAILS = 5;
const LOCK_MIN = 5;

// Lo que se puede hacer en el sistema. Cada rol tiene una lista de permisos;
// la pantalla de Usuarios muestra esta misma tabla para que nadie adivine.
const PERMISOS = {
  ver: 'Ver panel, empleados y detalle; descargar Excel/PDF e imprimir',
  actualizar: 'Actualizar las checadas desde los checadores',
  justificar: 'Justificar o anotar retardos y faltas',
  seguimiento: 'Registrar pláticas, actas y compromisos con el personal (seguimiento)',
  empleados: 'Nombres completos, bajas, horarios especiales y vincular sucursales',
  reglas: 'Reglas de puntualidad, horarios de sucursal, festivos y ajustes del cálculo',
  importar: 'Cargar checadas desde archivo',
  correo: 'A quién se envía el reporte por correo y enviarlo',
  cerrar: 'Cerrar la quincena (bloquea cambios una vez pagada)',
  reabrir: 'Reabrir una quincena cerrada',
  historial: 'Ver el historial de quién hizo qué',
  usuarios: 'Dar acceso a personas y cambiar su tipo de acceso',
  conexion: 'Conexión con los checadores y con el servidor de correo',
};

const ROLES = {
  admin: { nombre: 'Administrador (Sistemas)', desc: 'Todo, incluidos usuarios y las conexiones', puede: Object.keys(PERMISOS) },
  rh: {
    nombre: 'Recursos Humanos',
    desc: 'Casi toda la configuración, justificaciones, cierre de quincena y correo',
    puede: ['ver', 'actualizar', 'justificar', 'seguimiento', 'empleados', 'reglas', 'importar', 'correo', 'cerrar', 'historial'],
  },
  gerente: {
    nombre: 'Gerente',
    desc: 'Ver y descargar reportes, actualizar checadas y justificar a su personal',
    puede: ['ver', 'actualizar', 'justificar'],
  },
  dueno: {
    nombre: 'Dueño / Dirección',
    desc: 'Ver todo, historial y reabrir quincenas; no cambia la configuración',
    puede: ['ver', 'actualizar', 'historial', 'reabrir'],
  },
};

const can = (rol, permiso) => !!ROLES[rol]?.puede.includes(permiso);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Si el usuario no existe se compara contra esta clave falsa: así la respuesta
// tarda lo mismo y no se puede adivinar qué usuarios existen por el tiempo.
const DUMMY = hashPassword(crypto.randomBytes(16).toString('hex'));

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || DUMMY).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(password ?? '').slice(0, MAX_PASSWORD), salt, 64);
  return !!stored && a.length === b.length && crypto.timingSafeEqual(a, b);
}

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 100;
// Contraseñas que cualquiera adivina (se comparan sin acentos ni mayúsculas).
const OBVIAS = ['12345678', '123456789', '1234567890', '87654321', 'password', 'contrasena', 'qwertyui', 'elboom123', 'boom1234', 'retardos', 'asistencia', 'tractopartes', 'administrador'];
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Reglas de contraseña nueva. login y nombre: para no usar el propio usuario o nombre.
function checkPassword(password, { login = '', nombre = '' } = {}) {
  const p = String(password ?? '');
  if (p.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  if (p.length > MAX_PASSWORD) return `La contraseña puede tener como máximo ${MAX_PASSWORD} caracteres.`;
  if (p.trim() !== p) return 'La contraseña no debe empezar ni terminar con espacios.';
  if (!/\p{L}/u.test(p) || !/\d/.test(p)) return 'La contraseña debe tener letras y números (ej. Boom2026luz).';
  if (/^(.)\1+$/.test(p) || OBVIAS.includes(plain(p))) return 'Esa contraseña es muy fácil de adivinar. Elija otra.';
  const q = plain(p);
  const partes = [plain(login), ...plain(nombre).split(/\s+/)].filter((x) => x.length >= 4);
  if (partes.some((x) => q.includes(x))) return 'La contraseña no debe contener su usuario ni su nombre.';
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
// Intentos que quedan antes del bloqueo (para avisar a la persona).
const attemptsLeft = (login) => Math.max(MAX_FAILS - (fails.get(login)?.count || 0), 0);

// Permiso que pide cada ruta. Lo que no aparece aquí solo lo hace el administrador.
function permisoDe(method, url) {
  if (url.startsWith('/api/usuarios')) return 'usuarios';
  if (url.startsWith('/api/audit')) return 'historial';
  if (method === 'GET') return 'ver';
  if (url === '/api/registro/impresion') return 'ver';
  if (url === '/api/sync') return 'actualizar';
  if (url.startsWith('/api/justifications')) return 'justificar';
  if (url.startsWith('/api/acciones')) return 'seguimiento';
  if (url.startsWith('/api/employees')) return 'empleados';
  if (/^\/api\/branches\/[^/]+\/test/.test(url)) return 'conexion';
  if (url.startsWith('/api/branches') || url.startsWith('/api/settings') || url.startsWith('/api/holidays')) return 'reglas';
  if (url === '/api/import') return 'importar';
  if (/^\/api\/cierres\/[^/]+\/reabrir/.test(url)) return 'reabrir';
  if (url.startsWith('/api/cierres')) return 'cerrar';
  if (url.startsWith('/api/correo')) return 'correo';
  return 'conexion';
}

function allowed(rol, method, url) {
  return url === '/api/cuenta/clave' || can(rol, permisoDe(method, url));
}

module.exports = {
  COOKIE,
  SESSION_HOURS,
  ROLES,
  PERMISOS,
  can,
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
  attemptsLeft,
  allowed,
  MIN_PASSWORD,
  MAX_FAILS,
  LOCK_MIN,
};
