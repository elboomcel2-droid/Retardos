const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const store = require('./store');
const engine = require('./engine');
const biotime = require('./biotime');
const importer = require('./importer');
const { buildWorkbook } = require('./export');
const { buildReportHtml, buildPersonasHtml } = require('./report-html');
const mailer = require('./mailer');
// Envío de reportes por correo apagado por ahora. Para volver a usarlo, ponga
// true aquí y en CORREO_ACTIVO de public/app.js.
const CORREO_ACTIVO = false;
const { htmlToPdf } = require('./pdf');
const { createLive, weekPlan } = require('./live');
const auth = require('./auth');
const insights = require('./insights');
const { analyze } = require('./analytics');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'retardos.db');

const db = store.open(DB_FILE);
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
// Fecha que existe en el calendario (rechaza 2026-02-31) y en un rango razonable.
const ISO = {
  test(v) {
    if (!ISO_RE.test(v || '')) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '2000-01-01' && v <= '2100-12-31';
  },
};
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const fmtF = (v) => String(v).split('-').reverse().join('/');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Nombre de quien inició sesión: es el que queda en el historial y en los reportes.
const user = (req) => req.user?.nombre || 'sistema';

// Horario de 7 días: cada día laborable con horas válidas y salida después de la entrada.
function checkSchedule(week) {
  if (!Array.isArray(week) || week.length !== 7) throw bad('El horario debe tener los 7 días de la semana.');
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  week.forEach((d, i) => {
    if (!d || typeof d !== 'object') throw bad(`Revise el horario del ${DIAS[i]}.`);
    if (!d.laborable) return;
    if (!HORA.test(d.entrada || '') || !HORA.test(d.salida || '')) throw bad(`Escriba la hora de entrada y de salida del ${DIAS[i]}.`);
    if (d.salida <= d.entrada) throw bad(`El ${DIAS[i]} la hora de salida (${d.salida}) debe ser después de la entrada (${d.entrada}).`);
  });
  if (!week.some((d) => d.laborable)) throw bad('El horario debe tener al menos un día de trabajo.');
  return week;
}

function bad(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

function range(q) {
  const { from, to } = q;
  if (!from || !to) throw bad('Elija las fechas del periodo.');
  if (!ISO.test(from) || !ISO.test(to)) throw bad('Alguna fecha del periodo no existe. Revise el día y el mes.');
  if (from > to) throw bad('La fecha "Desde" es posterior a "Hasta".');
  if (engine.eachDay(from, to).length > 400) throw bad('El periodo es demasiado largo: elija como máximo un año.');
  return { from, to };
}

function selectedBranches(q) {
  const all = db.branches();
  if (!q.branch || q.branch === 'all') return all.filter((b) => b.enabled);
  const b = all.find((x) => String(x.id) === String(q.branch));
  if (!b) throw bad('Sucursal no encontrada.');
  return [b];
}

// Errores de programación o de la base local: no se muestran en inglés ni con
// detalles técnicos; quedan en la ventana del sistema para sistemas.
const inesperado = (e) =>
  [TypeError, RangeError, ReferenceError, SyntaxError].some((T) => e instanceof T) || /^(ERR_|SQLITE)/.test(String(e.code || ''));

const route = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    if (inesperado(e)) {
      console.error(new Date().toISOString(), req.method, req.originalUrl, e);
      return res.status(500).json({ error: 'Ocurrió un error inesperado. Intente de nuevo; si sigue pasando, avise a sistemas.' });
    }
    res.status(e.status || 500).json({ error: e.message });
  }
};

const fmtFecha = (s) => s.split('-').reverse().join('/');

// Reglas que se guardan con cada quincena cerrada (nunca contraseñas).
const reglasDe = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !/^(mysql_|smtp_|correo_)/.test(k)));

// Los días de una quincena cerrada se toman de la copia guardada al cerrarla,
// así lo que se pagó no cambia aunque después se edite un horario o una regla.
function applyCierres(result, cierres, branches, from, to, settings) {
  const ids = new Set(branches.map((b) => b.id));
  const closed = (f) => cierres.some((c) => f >= c.desde && f <= c.hasta);
  const days = result.days.filter((d) => !closed(d.fecha));
  for (const c of cierres) {
    for (const d of c.copia.days) if (d.fecha >= from && d.fecha <= to && ids.has(d.branch_id)) days.push({ ...d, cerrado: c.id });
  }
  engine.sortDays(days);
  // Si se pide justo la quincena cerrada, se usan las reglas con que se cerró.
  const exact = cierres.length === 1 && cierres[0].desde === from && cierres[0].hasta === to;
  const s = exact ? { ...settings, ...cierres[0].copia.settings } : settings;
  return { result: { ...result, days, ...engine.summaries(days, s) }, settings: s };
}

// Solo ciertas personas ("sucursal|número" separados por coma).
function onlyEmps(result, emp) {
  if (!emp) return result;
  const keys = new Set(String(emp).split(','));
  const has = (x) => keys.has(`${x.branch_id}|${x.emp_code}`);
  return { ...result, days: result.days.filter(has), employees: result.employees.filter(has) };
}

function computeReport(q) {
  const { from, to } = range(q);
  const branches = selectedBranches(q);
  let settings = db.getSettings();
  const ctxFrom = engine.addDays(from, -settings.dias_contexto);
  // Se leen las checadas de todas las sucursales: quien fue unos días a otra
  // sucursal checó allá y eso cuenta para su registro principal.
  const allBranches = db.branches();
  const punches = branches.length ? db.punches(allBranches.map((b) => b.id), ctxFrom, to) : [];
  const employees = db.employees();
  const justifications = db.justifications(from, to);
  let result = engine.compute({
    from,
    to,
    today: today(),
    branches,
    allBranches,
    settings,
    employees,
    punches,
    holidays: db.holidays(),
    justifications,
  });
  const cierres = db.cierresEn(from, to);
  if (cierres.length) ({ result, settings } = applyCierres(result, cierres, branches, from, to, settings));
  result = onlyEmps(result, q.emp);
  const sucursal = branches.length === 1 ? `${branches[0].code} ${branches[0].name}` : 'Todas las sucursales';
  const cierresInfo = cierres.map(({ copia, ...c }) => c);
  return { from, to, today: today(), sucursal, branches, settings, employees, punches, justifications, result, cierres: cierresInfo };
}

// Lectura para RH: comparación con el periodo anterior, tendencia de las
// últimas quincenas, casos de atención, cuadro de honor, confianza en los
// datos y resumen en palabras. Cada periodo se calcula igual que su reporte
// (con la copia de las quincenas cerradas), con los mismos filtros.
function computeInsights(q, r) {
  const { from, to, today: hoy, settings } = r;
  const A = analyze(r.result, { from, to, today: hoy, settings });

  let comparativo = null;
  if (from <= hoy) {
    const prev = insights.rangoComparable(from, to, hoy);
    const P = computeReport({ ...q, from: prev.from, to: prev.to });
    const KP = analyze(P.result, { from: prev.from, to: prev.to, today: hoy, settings: P.settings }).kpis;
    const metricas = insights.comparar(A.kpis, KP);
    if (metricas) comparativo = { desde: prev.from, hasta: prev.to, tipo: prev.tipo, parcial: prev.parcial, texto: insights.refTexto(prev), metricas };
  }

  // Últimas quincenas hasta la del último día evaluado (si el periodo es una
  // de ellas, se reutiliza lo que ya se calculó).
  const ancla = to < hoy ? to : hoy;
  const hist = insights.quincenasHasta(ancla).map((p) => ({
    ...p,
    result: p.from === from && p.to === to ? r.result : computeReport({ ...q, from: p.from, to: p.to }).result,
  }));
  const orden = db.branches().map((b) => b.id);
  const tendencia = insights.tendencia(hist, (id) => orden.indexOf(id));

  const keys = r.result.employees.map((e) => `${e.branch_id}|${e.emp_code}`);
  const casos = insights.casos({ hist, actual: r.result, settings, acciones: db.acciones(keys) });
  const honor = insights.honor({ hist, actual: r.result });
  const calidad = insights.calidad({
    branches: r.branches,
    coverage: new Map(db.coverage().map((c) => [c.branch_id, c])),
    result: r.result,
    duplicados: duplicados(),
    holidays: db.holidays(),
    from,
    to,
    today: hoy,
  });
  const resumen = insights.resumen({ kpis: A.kpis, comparativo, sucursales: A.sucursales, casos, honor, calidad });
  return { resumen, comparativo, tendencia, casos, honor, calidad, llegadas: A.llegadas };
}

// Bloquea cambios en días de una quincena ya cerrada.
function assertAbierto(from, to) {
  const c = db.cierresEn(from, to, false)[0];
  if (c) {
    throw bad(`La quincena del ${fmtFecha(c.desde)} al ${fmtFecha(c.hasta)} ya se cerró y se entregó para pago (la cerró ${c.cerrado_por}). Para cambiarla, primero hay que reabrirla.`, 409);
  }
}

// ---------- inicio de sesión ----------
const publicUser = (u) => ({
  id: u.id,
  login: u.login,
  nombre: u.nombre,
  rol: u.rol,
  rol_nombre: auth.ROLES[u.rol]?.nombre || u.rol,
  puede: auth.ROLES[u.rol]?.puede || [],
  cambiar_clave: u.cambiar_clave,
  branch_id: u.branch_id ?? null,
});

function cleanNombre(nombre) {
  const n = String(nombre || '').trim().replace(/\s+/g, ' ');
  if (!n) throw bad('Escriba el nombre completo de la persona.');
  if (n.length > 80) throw bad('El nombre es demasiado largo (máximo 80 letras).');
  if (/[^\p{L} .'-]/u.test(n)) throw bad('El nombre solo puede llevar letras y espacios.');
  if (n.split(' ').filter((w) => /\p{L}{2,}/u.test(w)).length < 2) throw bad('Escriba el nombre completo de la persona (nombre y apellido).');
  return n;
}

function cleanLogin(login) {
  const l = auth.normalizeLogin(login);
  if (!l) throw bad('Escriba el usuario para entrar (ej. luz.samano).');
  if (/\s/.test(l)) throw bad('El usuario no puede llevar espacios (use punto: luz.samano).');
  if (/[áéíóúüñ]/.test(l)) throw bad('El usuario no puede llevar acentos ni ñ (ej. nunez en lugar de núñez).');
  if (!auth.LOGIN_RE.test(l)) throw bad('El usuario debe tener de 3 a 30 letras sin acentos, números, punto o guion bajo (ej. luz.samano).');
  if (/^[._]|[._]$|[._]{2}/.test(l)) throw bad('El usuario no puede empezar ni terminar con punto o guion bajo, ni llevar dos seguidos.');
  return l;
}

// persona: { login, nombre } para no aceptar contraseñas con su propio usuario o nombre.
function cleanPassword(password, persona) {
  const err = auth.checkPassword(password, persona);
  if (err) throw bad(err);
  return auth.hashPassword(password);
}

function startSession(res, u) {
  const token = auth.newToken();
  db.createSession(token, u.id, auth.SESSION_HOURS);
  auth.setSessionCookie(res, token);
}

// Quién está usando el sistema (o si todavía no hay ningún usuario creado).
app.get('/api/auth/estado', route((req) => {
  const u = db.sessionUser(auth.readCookie(req), auth.SESSION_HOURS);
  return { configurado: db.userCount() > 0, usuario: u ? publicUser(u) : null, roles: auth.ROLES, permisos: auth.PERMISOS };
}));

// Solo funciona mientras no exista ningún usuario: crea el primer administrador.
app.post('/api/auth/primer-usuario', route((req, res) => {
  if (db.userCount() > 0) throw bad('Ya hay usuarios registrados. Inicie sesión.', 403);
  const nombre = cleanNombre(req.body.nombre);
  const login = cleanLogin(req.body.login);
  const id = db.createUser({ login, nombre, rol: 'admin', password: cleanPassword(req.body.password, { login, nombre }), cambiar_clave: false });
  const u = db.user(id);
  startSession(res, u);
  db.log(u.nombre, 'Usuario creado', { login, nombre, rol: 'admin', primero: true });
  return { usuario: publicUser(u) };
}));

app.post('/api/auth/entrar', route((req, res) => {
  const login = auth.normalizeLogin(req.body.login);
  const password = String(req.body.password ?? '');
  // Campos vacíos: no cuentan como intento fallido.
  if (!login && !password) throw bad('Escriba su usuario y su contraseña.');
  if (!login) throw bad('Escriba su usuario.');
  if (!password) throw bad('Escriba su contraseña.');
  const mins = auth.lockedMinutes(login);
  if (mins) throw bad(`Por seguridad, después de ${auth.MAX_FAILS} intentos fallidos este usuario quedó bloqueado. Espere ${mins} minuto(s) e intente de nuevo, o pida al administrador una contraseña temporal.`, 429);
  const u = db.userByLogin(login);
  // Siempre se compara la contraseña (aunque el usuario no exista) para que la
  // respuesta tarde lo mismo. El mensaje no dice cuál de los dos estuvo mal.
  const okPass = auth.verifyPassword(password, u?.password);
  if (!u || !okPass) {
    auth.registerFail(login);
    db.log(login, 'Intento de acceso fallido', { login, motivo: u ? 'contraseña incorrecta' : 'usuario inexistente' });
    const left = auth.attemptsLeft(login);
    if (!left) throw bad(`Usuario o contraseña incorrectos. Por seguridad el usuario quedó bloqueado ${auth.LOCK_MIN} minutos.`, 429);
    const aviso = left <= 2 ? ` Le queda(n) ${left} intento(s) antes de que se bloquee ${auth.LOCK_MIN} minutos.` : '';
    const mayus = password !== password.toLowerCase() && password === password.toUpperCase() ? ' Revise que no esté activado Bloq Mayús.' : '';
    throw bad(`Usuario o contraseña incorrectos.${mayus}${aviso}`, 401);
  }
  if (!u.activo) {
    db.log(u.nombre, 'Intento de acceso fallido', { login, motivo: 'usuario desactivado' });
    throw bad('Este usuario está desactivado. Pida al administrador que lo active.', 403);
  }
  auth.clearFails(login);
  startSession(res, u);
  db.log(u.nombre, 'Inicio de sesión', { login });
  return { usuario: publicUser(u) };
}));

app.post('/api/auth/salir', route((req, res) => {
  const token = auth.readCookie(req);
  const u = db.sessionUser(token, auth.SESSION_HOURS);
  if (token) db.deleteSession(token);
  auth.clearSessionCookie(res);
  if (u) db.log(u.nombre, 'Cierre de sesión', { login: u.login });
  return { ok: true };
}));

// Todo lo demás requiere haber iniciado sesión y tener permiso según el rol.
app.use(['/api', '/reporte'], (req, res, next) => {
  const u = db.sessionUser(auth.readCookie(req), auth.SESSION_HOURS);
  if (!u) return res.status(401).json({ error: 'Su sesión terminó. Vuelva a iniciar sesión.' });
  req.user = u;
  const url = req.baseUrl + req.path;
  // Con contraseña temporal solo se permite cambiarla.
  if (u.cambiar_clave && url !== '/api/cuenta/clave') return res.status(403).json({ error: 'Primero cambie su contraseña temporal.' });
  if (!auth.allowed(u.rol, req.method, url)) return res.status(403).json({ error: 'Su usuario no tiene permiso para esto. Pídalo al administrador.' });
  next();
});

app.post('/api/cuenta/clave', route((req, res) => {
  const u = db.userByLogin(req.user.login);
  const llave = `clave:${u.login}`;
  const mins = auth.lockedMinutes(llave);
  if (mins) throw bad(`Demasiados intentos con la contraseña actual. Espere ${mins} minuto(s).`, 429);
  if (!req.body.actual) throw bad(u.cambiar_clave ? 'Escriba la contraseña temporal que le dieron.' : 'Escriba su contraseña actual.');
  if (!req.body.nueva) throw bad('Escriba la contraseña nueva.');
  if (req.body.nueva2 !== undefined && req.body.nueva !== req.body.nueva2) throw bad('La contraseña nueva y su confirmación no coinciden.');
  if (!auth.verifyPassword(req.body.actual, u.password)) {
    auth.registerFail(llave);
    db.log(u.nombre, 'Intento fallido de cambio de contraseña', { login: u.login });
    throw bad(u.cambiar_clave ? 'La contraseña temporal no es correcta.' : 'La contraseña actual no es correcta.');
  }
  auth.clearFails(llave);
  if (req.body.actual === req.body.nueva) throw bad('La nueva contraseña debe ser diferente a la actual.');
  db.setPassword(u.id, cleanPassword(req.body.nueva, u), false);
  // Cierra las sesiones abiertas en otros equipos.
  db.deleteSessionsOf(u.id, auth.readCookie(req));
  db.log(u.nombre, 'Contraseña cambiada', { login: u.login });
  return { usuario: publicUser(db.user(u.id)) };
}));

// ---------- usuarios (solo administrador) ----------
// Sucursal con la que abre el sistema (vacío = todas). Solo es el filtro
// inicial: no limita lo que la persona puede consultar.
function cleanBranch(v) {
  if (v === '' || v == null || v === 'all') return null;
  const b = db.branch(v);
  if (!b) throw bad('Sucursal no encontrada.');
  return b.id;
}

app.get('/api/usuarios', route(() => db.users().map((u) => ({ ...u, rol_nombre: auth.ROLES[u.rol]?.nombre || u.rol }))));

app.post('/api/usuarios', route((req) => {
  const nombre = cleanNombre(req.body.nombre);
  const login = cleanLogin(req.body.login);
  if (!auth.ROLES[req.body.rol]) throw bad('Elija el tipo de acceso.');
  if (db.userByLogin(login)) throw bad(`Ya existe el usuario «${login}».`);
  const branch_id = cleanBranch(req.body.branch_id);
  db.createUser({ login, nombre, rol: req.body.rol, password: cleanPassword(req.body.password, { login, nombre }), branch_id });
  db.log(user(req), 'Usuario creado', { login, nombre, rol: req.body.rol, branch_id });
  return { ok: true };
}));

app.put('/api/usuarios/:id', route((req) => {
  const u = db.user(req.params.id);
  if (!u) throw bad('Usuario no encontrado.');
  const nombre = cleanNombre(req.body.nombre ?? u.nombre);
  const rol = req.body.rol ?? u.rol;
  const activo = req.body.activo ?? u.activo;
  if (typeof activo !== 'boolean') throw bad('Opción "Activo" no válida.');
  if (!auth.ROLES[rol]) throw bad('Elija el tipo de acceso.');
  // Uno mismo no puede quitarse el acceso (se quedaría fuera sin querer).
  if (u.id === req.user.id && !activo) throw bad('No puede desactivar su propio usuario. Pídalo a otro administrador.');
  if (u.id === req.user.id && rol !== u.rol) throw bad('No puede cambiar su propio tipo de acceso. Pídalo a otro administrador.');
  const dejaDeSerAdmin = u.rol === 'admin' && u.activo && (rol !== 'admin' || !activo);
  if (dejaDeSerAdmin && db.activeAdmins() <= 1) throw bad('Debe quedar al menos un administrador activo.');
  const branch_id = req.body.branch_id === undefined ? u.branch_id ?? null : cleanBranch(req.body.branch_id);
  db.updateUser(u.id, { nombre, rol, activo, branch_id });
  if (!activo) db.deleteSessionsOf(u.id);
  const cambios = {};
  if (nombre !== u.nombre) cambios.nombre = nombre;
  if (branch_id !== (u.branch_id ?? null)) cambios.branch_id = branch_id;
  if (rol !== u.rol) cambios.rol = rol;
  if (!!activo !== u.activo) cambios.activo = !!activo;
  db.log(user(req), 'Usuario actualizado', { login: u.login, ...cambios });
  return { ok: true };
}));

// Para quien ya no trabaja aquí. El historial conserva su nombre en lo que hizo.
app.delete('/api/usuarios/:id', route((req) => {
  const u = db.user(req.params.id);
  if (!u) throw bad('Usuario no encontrado.');
  if (u.id === req.user.id) throw bad('No puede eliminar su propio usuario. Pídalo a otro administrador.');
  if (u.rol === 'admin' && u.activo && db.activeAdmins() <= 1) throw bad('Debe quedar al menos un administrador activo.');
  db.deleteUser(u.id);
  db.log(user(req), 'Usuario eliminado', { login: u.login, nombre: u.nombre, rol: u.rol });
  return { ok: true };
}));

// Contraseña temporal: la persona tendrá que cambiarla al entrar.
app.post('/api/usuarios/:id/clave', route((req) => {
  const u = db.user(req.params.id);
  if (!u) throw bad('Usuario no encontrado.');
  db.setPassword(u.id, cleanPassword(req.body.password, u), true);
  db.deleteSessionsOf(u.id);
  db.log(user(req), 'Contraseña restablecida', { login: u.login, nombre: u.nombre });
  return { ok: true };
}));

// ---------- configuración ----------
app.get('/api/settings', route(() => {
  const s = db.getSettings();
  return {
    ...s,
    mysql_password: s.mysql_password ? '********' : '',
    smtp_password: s.smtp_password ? '********' : '',
    correo_configurado: mailer.configurado(s),
  };
}));

app.put('/api/settings', route((req) => {
  const patch = { ...req.body };
  for (const k of ['mysql_password', 'smtp_password']) if (patch[k] === '********') delete patch[k];
  const keys = Object.keys(patch);
  if (keys.some((k) => /^(mysql_|smtp_)/.test(k)) && !auth.can(req.user.rol, 'conexion')) {
    throw bad('Solo sistemas puede cambiar la conexión con los checadores o el servidor de correo.', 403);
  }
  if (keys.some((k) => k.startsWith('correo_')) && !auth.can(req.user.rol, 'correo')) {
    throw bad('Su usuario no puede cambiar a quién se envía el correo.', 403);
  }
  if (patch.correo_rh !== undefined) {
    const malos = mailer.invalidEmails(patch.correo_rh);
    if (malos.length) throw bad(`Revise estos correos: ${malos.join(', ')}`);
    patch.correo_rh = mailer.parseList(patch.correo_rh).join(', ');
  }
  for (const k of ['smtp_seguro', 'correo_al_cerrar']) if (patch[k] !== undefined) patch[k] = patch[k] === true || patch[k] === 'true';
  // [nombre para el mensaje, mínimo, máximo]
  const LIMITES = {
    tolerancia_min: ['Minutos de tolerancia', 0, 120],
    duplicado_min: ['Minutos de checadas repetidas', 0, 120],
    retardos_por_falta: ['Retardos por falta', 0, 31],
    salida_anticipada_min: ['Minutos de "se fue antes"', 0, 600],
    dias_contexto: ['Días hacia atrás', 1, 366],
    dias_sin_checar: ['Días sin checar para avisar', 1, 60],
    comida_min: ['Minutos de comida', 0, 300],
    comida_tolerancia_min: ['Tolerancia de comida', 0, 120],
    cerca_salida_min: ['Minutos cerca de la salida', 0, 600],
    retardo_falta_min: ['Retardo que cuenta como falta', 0, 600],
    extra_min: ['Minutos para tiempo extra', 0, 600],
    mysql_port: ['Puerto del servidor de checadores', 1, 65535],
    smtp_port: ['Puerto del correo', 1, 65535],
  };
  for (const [k, [nombre, min, max]] of Object.entries(LIMITES)) {
    if (patch[k] === undefined) continue;
    if (String(patch[k]).trim() === '') throw bad(`Escriba un número en «${nombre}».`);
    patch[k] = Number(patch[k]);
    if (!Number.isInteger(patch[k])) throw bad(`«${nombre}» debe ser un número entero, sin decimales.`);
    if (patch[k] < min || patch[k] > max) throw bad(`«${nombre}» debe estar entre ${min} y ${max}.`);
  }
  if (patch.retardo_desde !== undefined && !['entrada', 'tolerancia'].includes(patch.retardo_desde)) throw bad('Opción no válida.');
  if (patch.comida_desde !== undefined && !HORA.test(patch.comida_desde)) throw bad('Revise la hora de comida (formato 14:00).');
  for (const k of ['mysql_host', 'smtp_host']) {
    if (patch[k] === undefined) continue;
    patch[k] = String(patch[k]).trim();
    if (patch[k] && !/^[a-z0-9.-]+$/i.test(patch[k])) throw bad('El servidor solo puede llevar letras, números, puntos y guiones (ej. smtp.gmail.com o 65.99.205.187).');
  }
  if (patch.smtp_remitente !== undefined) {
    patch.smtp_remitente = String(patch.smtp_remitente).trim();
    const correo = patch.smtp_remitente.match(/<([^>]+)>\s*$/)?.[1] || patch.smtp_remitente;
    if (patch.smtp_remitente && mailer.invalidEmails(correo).length) throw bad('El remitente debe ser un correo (ej. asistencia@elboom.com.mx o Asistencia <asistencia@elboom.com.mx>).');
  }
  if (patch.auto_sync !== undefined) patch.auto_sync = patch.auto_sync === true || patch.auto_sync === 'true';
  db.saveSettings(patch);
  const logged = { ...patch };
  if (logged.mysql_password) logged.mysql_password = '(cambiada)';
  if (logged.smtp_password) logged.smtp_password = '(cambiada)';
  db.log(user(req), 'Configuración', logged);
  return { ok: true };
}));

app.get('/api/branches', route(() => {
  const cov = new Map(db.coverage().map((c) => [c.branch_id, c]));
  return db.branches().map((b) => ({ ...b, cobertura: cov.get(b.id) || null }));
}));

app.put('/api/branches/:id', route((req) => {
  const b = db.branch(req.params.id);
  if (!b) throw bad('Sucursal no encontrada.');
  const body = { ...req.body };
  // La base de datos de cada sucursal es parte de la conexión: solo el administrador.
  if (!auth.can(req.user.rol, 'conexion')) delete body.db_name;
  const schedule = checkSchedule(body.schedule || b.schedule);
  if (body.tolerancia_min !== '' && body.tolerancia_min != null) {
    const t = Number(body.tolerancia_min);
    if (!Number.isInteger(t) || t < 0 || t > 120) throw bad('La tolerancia de la sucursal debe ser un número entero entre 0 y 120.');
  }
  if (body.name !== undefined && !String(body.name).trim()) throw bad('Escriba el nombre de la sucursal.');
  db.saveBranch(b.id, {
    name: body.name ?? b.name,
    db_name: body.db_name ?? b.db_name,
    enabled: body.enabled ?? b.enabled,
    schedule,
    tolerancia_min: body.tolerancia_min === '' || body.tolerancia_min == null ? null : Number(body.tolerancia_min),
  });
  db.log(user(req), 'Sucursal actualizada', { sucursal: `${b.code} ${b.name}`, ...body });
  return { ok: true };
}));

app.post('/api/branches/:id/test', route(async (req) => {
  const b = db.branch(req.params.id);
  if (!b) throw bad('Sucursal no encontrada.');
  return biotime.testConnection(db.getSettings(), b);
}));

// ---------- sincronización con los checadores ----------
// Descarga las checadas de las sucursales indicadas (solo lectura en el checador).
function syncBranches(branches, from, to) {
  const settings = db.getSettings();
  return Promise.all(
    branches.map(async (b) => {
      try {
        const data = await biotime.fetchBranch(settings, b, from, to);
        const nuevos = db.tx(() => {
          db.upsertEmployees(b.id, data.employees);
          return db.insertPunches(b.id, data.punches, 'checador');
        });
        db.markSynced(b.id);
        return { sucursal: `${b.code} ${b.name}`, ok: true, leidos: data.punches.length, nuevos };
      } catch (e) {
        return { sucursal: `${b.code} ${b.name}`, ok: false, error: e.message, tecnico: e.tecnico };
      }
    })
  );
}

app.post('/api/sync', route(async (req) => {
  const { from, to } = range(req.body);
  const settings = db.getSettings();
  const ctxFrom = engine.addDays(from, -settings.dias_contexto);
  const results = await syncBranches(selectedBranches(req.body), ctxFrom, to);
  db.log(user(req), 'Actualización de checadas', { desde: ctxFrom, hasta: to, results });
  return { desde: ctxFrom, hasta: to, results: results.map(({ tecnico, ...x }) => x) };
}));

// ---------- actualización automática (en vivo) ----------
// Solo trae las checadas de hoy: es una consulta muy ligera.
const live = createLive({ db, syncToday: () => syncBranches(db.branches().filter((b) => b.enabled), today(), today()) });

// Si alguien actualiza el programa sin reiniciar, las pantallas nuevas piden
// datos que esta versión no tiene. Se detecta comparando la fecha de los archivos.
const SRC_DIR = __dirname;
const codeStamp = () =>
  Math.max(...fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).map((f) => fs.statSync(path.join(SRC_DIR, f)).mtimeMs));
const STARTED_STAMP = codeStamp();

app.get('/api/live', route(() => ({ ...live.status(), reiniciar: codeStamp() > STARTED_STAMP })));
app.get('/api/live/semana', route(() => weekPlan(new Date(), db.branches(), db.holidays(), db.getSettings())));

// ---------- importación de archivos ----------
app.post('/api/import', express.raw({ type: '*/*', limit: '50mb' }), route(async (req) => {
  const filename = decodeURIComponent(req.get('x-filename') || 'archivo.csv');
  const branches = db.branches();
  const forced = req.query.branch ? branches.find((b) => String(b.id) === req.query.branch) : null;
  const parsed = await importer.parseFile(req.body, filename, branches, forced);
  const results = db.tx(() =>
    [...parsed.byBranch].map(([id, g]) => {
      const b = branches.find((x) => x.id === id);
      db.upsertEmployees(id, [...g.employees.values()]);
      const nuevos = db.insertPunches(id, g.punches, 'archivo');
      return { sucursal: `${b.code} ${b.name}`, leidos: g.punches.length, nuevos };
    })
  );
  db.log(user(req), 'Importación de archivo', { archivo: filename, results, errores: parsed.errores.length });
  return { archivo: filename, filas: parsed.filas, results, errores: parsed.errores.slice(0, 50), total_errores: parsed.errores.length };
}));

// ---------- reportes ----------
app.get('/api/report', route((req) => {
  const r = computeReport(req.query);
  return { from: r.from, to: r.to, settings: r.settings, cierres: r.cierres, ...r.result };
}));

app.get('/api/analisis', route((req) => computeInsights(req.query, computeReport(req.query))));

// Constancia de cada reporte que sale del sistema (descargado o impreso).
const reportLog = (req, accion, r, extra = {}) =>
  db.log(user(req), accion, { desde: r.from, hasta: r.to, sucursal: r.sucursal, ...extra });

app.get('/api/export.xlsx', route(async (req, res) => {
  const r = computeReport(req.query);
  const buf = await buildWorkbook({ ...r, insights: computeInsights(req.query, r), generadoPor: user(req) });
  const name = `Asistencia_${r.branches.length === 1 ? r.branches[0].name : 'Todas'}_${r.from}_a_${r.to}.xlsx`;
  reportLog(req, 'Descarga de Excel', r, { archivo: name });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(Buffer.from(buf));
}));

// Vista previa del reporte imprimible y su versión PDF (mismas cifras que el Excel).
app.get('/reporte', route((req, res) => {
  const r = computeReport(req.query);
  reportLog(req, 'Vista del reporte imprimible', r);
  res.type('html').send(buildReportHtml({ ...r, insights: computeInsights(req.query, r), generadoPor: user(req) }));
}));

// Reporte por persona: la ficha de cada empleado con todos sus días (para RH).
const accionesDe = (r) => db.acciones(r.result.employees.map((e) => `${e.branch_id}|${e.emp_code}`));
const personasHtml = (req, r, autoPrint = false) =>
  buildPersonasHtml({ ...r, acciones: accionesDe(r), generadoPor: user(req), autoPrint });

app.get('/reporte/personas', route((req, res) => {
  const r = computeReport(req.query);
  reportLog(req, req.query.imprimir ? 'Impresión del reporte por persona' : 'Vista del reporte por persona', r, { personas: r.result.employees.length });
  res.type('html').send(personasHtml(req, r, !!req.query.imprimir));
}));

app.get('/api/reporte-personas.pdf', route(async (req, res) => {
  const r = computeReport(req.query);
  const pdf = await htmlToPdf(personasHtml(req, r));
  const one = r.result.employees.length === 1 ? r.result.employees[0].nombre.replace(/[^\p{L}\d ]/gu, '').replace(/ /g, '_') : 'Por_persona';
  const name = `Asistencia_${one}_${r.from}_a_${r.to}.pdf`;
  reportLog(req, 'Descarga de PDF por persona', r, { archivo: name, personas: r.result.employees.length });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(pdf);
}));

// ---------- envío por correo ----------
// Crea los PDF (general y por persona) y los envía a la lista de RH.
async function enviarReporte(q, autor, asunto) {
  const settings = db.getSettings();
  const r = computeReport(q);
  const info = computeInsights(q, r);
  const incluir = q.incluir?.length ? q.incluir : ['general', 'personas'];
  const base = `${r.branches.length === 1 ? r.branches[0].name : 'Todas'}_${r.from}_a_${r.to}`;
  const attachments = [];
  if (incluir.includes('general')) attachments.push({ filename: `Asistencia_${base}.pdf`, content: await htmlToPdf(buildReportHtml({ ...r, insights: info, generadoPor: autor })) });
  if (incluir.includes('personas')) attachments.push({ filename: `Asistencia_por_persona_${base}.pdf`, content: await htmlToPdf(buildPersonasHtml({ ...r, acciones: accionesDe(r), generadoPor: autor })) });
  const periodo = `${fmtFecha(r.from)} al ${fmtFecha(r.to)}`;
  const destinatarios = await mailer.send(settings, {
    to: settings.correo_rh,
    subject: asunto || `Reporte de asistencia ${periodo} · ${r.sucursal}`,
    text: [
      `Reporte de asistencia del ${periodo} (${r.sucursal}).`,
      `Personas: ${r.result.employees.length}.`,
      '',
      'En pocas palabras:',
      ...info.resumen.map((x) => `- ${x}`),
      '',
      'Se adjuntan los archivos PDF. Este correo lo envió el sistema de Control de Retardos de El Boom Tractopartes.',
      `Enviado por: ${autor}.`,
    ].join('\n'),
    attachments,
  });
  db.log(autor, 'Reporte enviado por correo', { desde: r.from, hasta: r.to, sucursal: r.sucursal, destinatarios, archivos: attachments.map((a) => a.filename) });
  return destinatarios;
}

app.use('/api/correo', (req, res, next) => {
  if (!CORREO_ACTIVO) return res.status(403).json({ error: 'El envío por correo está desactivado por ahora.' });
  next();
});

app.post('/api/correo/enviar', route(async (req) => {
  const destinatarios = await enviarReporte(req.body, user(req));
  return { destinatarios };
}));

app.post('/api/correo/prueba', route(async (req) => {
  const destinatarios = await mailer.send(db.getSettings(), {
    to: db.getSettings().correo_rh,
    subject: 'Prueba de correo · Control de Retardos',
    text: `Si recibe este correo, el envío automático de reportes funciona.\nEnviado por: ${user(req)}.`,
  });
  db.log(user(req), 'Correo de prueba', { destinatarios });
  return { destinatarios };
}));

app.get('/api/reporte.pdf', route(async (req, res) => {
  const r = computeReport(req.query);
  const pdf = await htmlToPdf(buildReportHtml({ ...r, insights: computeInsights(req.query, r), generadoPor: user(req) }));
  const name = `Asistencia_${r.branches.length === 1 ? r.branches[0].name : 'Todas'}_${r.from}_a_${r.to}.pdf`;
  reportLog(req, 'Descarga de PDF', r, { archivo: name });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(pdf);
}));

// El navegador avisa justo antes de imprimir (botón Imprimir o Ctrl+P).
app.post('/api/registro/impresion', route((req) => {
  const { from, to } = range(req.body);
  const branches = selectedBranches(req.body);
  const sucursal = branches.length === 1 ? `${branches[0].code} ${branches[0].name}` : 'Todas las sucursales';
  reportLog(req, 'Impresión', { from, to, sucursal }, { pantalla: String(req.body.pantalla || '').slice(0, 60) });
  return { ok: true };
}));

app.get('/api/punches', route((req) => {
  const { from, to } = range(req.query);
  const ids = selectedBranches(req.query).map((b) => b.id);
  let rows = db.punches(ids, from, to);
  if (req.query.emp) rows = rows.filter((p) => p.emp_code === String(req.query.emp));
  return rows;
}));

// ---------- empleados ----------
app.get('/api/employees', route(() => db.employees()));

app.put('/api/employees/:branch/:code', route((req) => {
  const b = db.branch(req.params.branch);
  if (!b) throw bad('Sucursal no encontrada.');
  const e = req.body;
  for (const k of ['fecha_alta', 'fecha_baja']) if (e[k] && !ISO.test(e[k])) throw bad(`La fecha de ${k === 'fecha_alta' ? 'ingreso' : 'baja'} no existe. Revise el día y el mes.`);
  if (e.fecha_alta && e.fecha_baja && e.fecha_baja < e.fecha_alta) throw bad(`La baja (${fmtF(e.fecha_baja)}) no puede ser antes del ingreso (${fmtF(e.fecha_alta)}).`);
  if (e.fecha_alta && e.fecha_alta > engine.addDays(today(), 60)) throw bad('La fecha de ingreso está demasiado en el futuro. Revise el año.');
  if (e.schedule) checkSchedule(e.schedule);
  if (e.alias && String(e.alias).trim()) {
    const a = String(e.alias).trim().replace(/\s+/g, ' ');
    if (a.length > 80 || /[^\p{L} .'-]/u.test(a) || a.split(' ').length < 2) throw bad('El nombre completo debe llevar nombre y apellido, solo con letras (máximo 80).');
    e.alias = a;
  }
  if (String(e.notas || '').length > 300) throw bad('Las notas pueden tener como máximo 300 letras.');
  if (!db.employee(b.id, req.params.code)) throw bad('Empleado no encontrado.');
  db.saveEmployee(b.id, req.params.code, e);
  db.log(user(req), 'Empleado actualizado', { sucursal: `${b.code} ${b.name}`, emp_code: req.params.code, ...e });
  return { ok: true };
}));

// ---------- misma persona en varias sucursales ----------
const empKey = (b, c) => `${b}|${c}`;
function empOr404(branch, code) {
  const e = db.employee(branch, code);
  if (!e) throw bad('Empleado no encontrado.');
  return e;
}
// Registro principal del grupo al que pertenece alguien.
const rootOf = (e) => (e.principal && db.employee(...e.principal.split('|')) ? e.principal : empKey(e.branch_id, e.emp_code));
const etiqueta = (e) => {
  const b = db.branch(e.branch_id);
  return `${e.alias || `${e.first_name} ${e.last_name}`.trim() || `No. ${e.emp_code}`} (${b ? `${b.code} ${b.name}` : ''} · No. ${e.emp_code})`;
};

// Une otro registro (de otra sucursal) a esta persona.
app.post('/api/employees/:branch/:code/vincular', route((req) => {
  const base = empOr404(req.params.branch, req.params.code);
  const [ob, oc] = String(req.body.con || '').split('|');
  const otro = empOr404(ob, oc);
  const root = rootOf(base);
  if (rootOf(otro) === root) throw bad('Ya están vinculados.');
  db.tx(() => {
    // Lo que estaba unido al otro registro pasa a esta persona.
    const otroRoot = empKey(otro.branch_id, otro.emp_code);
    for (const e of db.linkedTo(otroRoot)) db.setPrincipal(e.branch_id, e.emp_code, root);
    db.setPrincipal(otro.branch_id, otro.emp_code, root);
  });
  db.log(user(req), 'Registros vinculados', { persona: etiqueta(base), con: etiqueta(otro) });
  return { ok: true };
}));

app.post('/api/employees/:branch/:code/desvincular', route((req) => {
  const e = empOr404(req.params.branch, req.params.code);
  if (!e.principal) throw bad('Este registro no está vinculado.');
  db.setPrincipal(e.branch_id, e.emp_code, null);
  db.log(user(req), 'Registros desvinculados', { registro: etiqueta(e) });
  return { ok: true };
}));

// Cambio de sucursal: este registro pasa a ser el principal (su sucursal es
// donde aparece en los reportes).
app.post('/api/employees/:branch/:code/principal', route((req) => {
  const e = empOr404(req.params.branch, req.params.code);
  const old = rootOf(e);
  const key = empKey(e.branch_id, e.emp_code);
  if (old === key) return { ok: true };
  const prev = db.employee(...old.split('|'));
  db.tx(() => {
    for (const x of db.linkedTo(old)) db.setPrincipal(x.branch_id, x.emp_code, x.branch_id === e.branch_id && x.emp_code === e.emp_code ? null : key);
    db.setPrincipal(prev.branch_id, prev.emp_code, key);
    if (!e.alias && prev.alias) db.setAlias(e.branch_id, e.emp_code, prev.alias);
  });
  db.log(user(req), 'Sucursal principal cambiada', { persona: etiqueta(e), antes: etiqueta(prev) });
  return { ok: true };
}));

// Posible misma persona en dos sucursales: mismo nombre completo y sin vincular.
app.get('/api/employees/duplicados', route(() => duplicados()));

function duplicados() {
  const branches = new Map(db.branches().map((b) => [b.id, b]));
  const groups = new Map();
  for (const e of db.employees()) {
    if (e.excluir || e.fecha_baja || e.principal || !branches.get(e.branch_id)?.enabled) continue;
    const name = (e.alias || '').trim() || (engine.isShortName(e) ? '' : `${e.first_name} ${e.last_name}`);
    const k = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return [...groups.values()]
    .filter((g) => new Set(g.map((e) => e.branch_id)).size > 1)
    .map((g) => g.map((e) => ({ branch_id: e.branch_id, emp_code: e.emp_code, nombre: e.alias || `${e.first_name} ${e.last_name}`.trim(), sucursal: `${branches.get(e.branch_id).code} ${branches.get(e.branch_id).name}` })));
}

app.get('/api/employees/pendientes', route(() => {
  const since = engine.addDays(today(), -db.getSettings().dias_contexto);
  const recent = new Map(db.recentPunchers(since).map((r) => [`${r.branch_id}|${r.emp_code}`, r]));
  const known = new Map(db.employees().map((e) => [`${e.branch_id}|${e.emp_code}`, e]));
  const branches = new Map(db.branches().map((b) => [b.id, b]));
  const out = [];
  for (const [key, r] of recent) {
    const b = branches.get(r.branch_id);
    if (!b || !b.enabled) continue;
    const e = known.get(key) || { emp_code: r.emp_code, first_name: '', last_name: '', alias: '', activo: true, excluir: false };
    if (e.excluir || e.principal || !e.activo || e.fecha_baja || (e.alias || '').trim() || !engine.isShortName(e)) continue;
    out.push({
      branch_id: r.branch_id,
      sucursal: `${b.code} ${b.name}`,
      emp_code: r.emp_code,
      abreviado: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
      primera: r.primera.slice(0, 10),
      ultima: r.ultima.slice(0, 10),
      checadas: r.checadas,
    });
  }
  return out.sort((a, b) => b.ultima.localeCompare(a.ultima) || a.sucursal.localeCompare(b.sucursal));
}));

app.post('/api/employees/:branch/:code/excluir', route((req) => {
  const b = db.branch(req.params.branch);
  if (!b) throw bad('Sucursal no encontrada.');
  const excluir = req.body.excluir !== false;
  db.setExcluir(b.id, req.params.code, excluir);
  db.log(user(req), excluir ? 'Cuenta excluida' : 'Cuenta incluida', { sucursal: `${b.code} ${b.name}`, emp_code: req.params.code });
  return { ok: true };
}));

app.post('/api/employees/:branch/:code/nombre', route((req) => {
  const b = db.branch(req.params.branch);
  if (!b) throw bad('Sucursal no encontrada.');
  const alias = String(req.body.alias || '').trim().replace(/\s+/g, ' ');
  if (alias.split(' ').length < 2 || alias.replace(/[^\p{L}]/gu, '').length < 5) throw bad('Escriba el nombre completo: al menos nombre y apellido.');
  if (alias.length > 80 || /[^\p{L} .'-]/u.test(alias)) throw bad('El nombre solo puede llevar letras y espacios (máximo 80).');
  db.setAlias(b.id, req.params.code, alias);
  db.log(user(req), 'Nombre registrado', { sucursal: `${b.code} ${b.name}`, emp_code: req.params.code, alias });
  return { ok: true };
}));

app.post('/api/employees/:branch/:code/baja', route((req) => {
  const b = db.branch(req.params.branch);
  if (!b) throw bad('Sucursal no encontrada.');
  if (!req.body.fecha_baja) throw bad('Falta la fecha de baja.');
  if (!ISO.test(req.body.fecha_baja)) throw bad('La fecha de baja no existe. Revise el día y el mes.');
  db.setBaja(b.id, req.params.code, req.body.fecha_baja);
  db.log(user(req), 'Baja registrada', { sucursal: `${b.code} ${b.name}`, emp_code: req.params.code, fecha_baja: req.body.fecha_baja });
  return { ok: true };
}));

// ---------- festivos ----------
app.get('/api/holidays', route(() => db.holidays()));
app.post('/api/holidays', route((req) => {
  const { fecha, descripcion } = req.body;
  if (!fecha) throw bad('Elija la fecha del día festivo.');
  if (!ISO.test(fecha)) throw bad('La fecha del día festivo no existe. Revise el día y el mes.');
  if (!String(descripcion || '').trim()) throw bad('Escriba el nombre del día festivo (ej. Día del Trabajo).');
  if (String(descripcion).length > 80) throw bad('El nombre del día festivo es demasiado largo.');
  db.addHoliday(fecha, descripcion);
  db.log(user(req), 'Festivo agregado', { fecha, descripcion });
  return { ok: true };
}));
app.delete('/api/holidays/:fecha', route((req) => {
  db.deleteHoliday(req.params.fecha);
  db.log(user(req), 'Festivo eliminado', { fecha: req.params.fecha });
  return { ok: true };
}));

// ---------- justificaciones ----------
const TIPOS = ['Permiso para llegar tarde', 'Permiso para salir temprano', 'Permiso con goce', 'Permiso sin goce', 'Incapacidad', 'Vacaciones', 'Comisión de trabajo', 'Trabajó en otra sucursal', 'Entregas o trabajo fuera de la sucursal', 'Falla del checador', 'Olvido de checada (verificado)', 'Otro'];
const NO_JUSTIFICADO = 'No justificado';

app.get('/api/justifications', route((req) => {
  const { from, to } = range(req.query);
  return { tipos: TIPOS, items: db.justifications(from, to) };
}));

app.post('/api/justifications', route((req) => {
  const j = req.body;
  if (!db.branch(j.branch_id)) throw bad('Sucursal no encontrada.');
  if (!j.emp_code || !ISO.test(j.fecha || '')) throw bad('Falta el empleado o la fecha.');
  if (j.fecha > today()) throw bad('No se puede justificar un día que todavía no llega.');
  j.justificado = j.justificado !== false;
  if (!j.justificado) j.tipo = NO_JUSTIFICADO;
  else if (!TIPOS.includes(j.tipo)) throw bad('Elija el tipo de justificación.');
  j.nota = String(j.nota || '').trim();
  if (!j.nota) throw bad('Escriba el porqué.');
  if (j.nota.length < 5) throw bad('Explique un poco más el porqué (por ejemplo, quién autorizó).');
  if (j.nota.length > 500) throw bad('El porqué puede tener como máximo 500 letras.');
  if (j.hora_permiso && !HORA.test(j.hora_permiso)) throw bad('Revise la hora del permiso (formato 10:30).');
  if (!j.justificado) j.hora_permiso = null;
  const autor = user(req);
  if (autor === 'sin nombre') throw bad('Escriba su nombre en el campo Usuario antes de guardar.');
  // "hasta": aplica la misma justificación a varios días seguidos (vacaciones, incapacidad).
  if (j.hasta && !ISO.test(j.hasta)) throw bad('La fecha "hasta" no existe. Revise el día y el mes.');
  const hasta = j.hasta || j.fecha;
  if (hasta < j.fecha) throw bad('La fecha "hasta" debe ser igual o posterior al día que se justifica.');
  const fechas = engine.eachDay(j.fecha, hasta);
  if (fechas.length > 62) throw bad('Se pueden justificar hasta 62 días a la vez.');
  assertAbierto(j.fecha, hasta);
  db.tx(() => fechas.forEach((fecha) => db.saveJustification({ ...j, fecha, emp_code: String(j.emp_code), autor })));
  db.log(autor, 'Justificación registrada', { ...j, dias: fechas.length });
  return { ok: true, dias: fechas.length };
}));

app.delete('/api/justifications/:id', route((req) => {
  const j = db.justification(req.params.id);
  if (!j) throw bad('No existe.');
  assertAbierto(j.fecha, j.fecha);
  db.deleteJustification(j.id);
  db.log(user(req), 'Justificación eliminada', j);
  return { ok: true };
}));

// ---------- seguimiento de RH ----------
// Pláticas, actas y compromisos con cada persona, y si después mejoró:
// retardos y faltas en los 30 días antes y en los 30 días después.
const TIPOS_ACCION = ['Plática verbal', 'Llamada de atención por escrito', 'Acta administrativa', 'Compromiso de mejora', 'Reconocimiento', 'Otro'];
const DIAS_EFECTO = 30;

function efectoAcciones(lista) {
  if (!lista.length) return lista;
  const { branch_id, emp_code } = lista[0];
  const hoy = today();
  const fechas = lista.map((a) => a.fecha).sort();
  let from = engine.addDays(fechas[0], -DIAS_EFECTO);
  const to = [engine.addDays(fechas[fechas.length - 1], DIAS_EFECTO), hoy].sort()[0];
  if (engine.eachDay(from, to).length > 400) from = engine.addDays(to, -399);
  const days = computeReport({ from, to, branch: branch_id, emp: `${branch_id}|${emp_code}` }).result.days;
  const cuenta = (a, z) => {
    const ds = days.filter((d) => d.fecha >= a && d.fecha <= z);
    const ret = ds.filter((d) => d.estado === 'RETARDO');
    return { desde: a, hasta: z, retardos: ret.length, minutos_retardo: ret.reduce((n, d) => n + d.retardo_min, 0), faltas: ds.filter((d) => d.estado === 'FALTA').length, dias: ds.filter((d) => ['PUNTUAL', 'RETARDO', 'FALTA', 'INCOMPLETO'].includes(d.estado)).length };
  };
  return lista.map((a) => {
    const antes = a.fecha > from ? cuenta(engine.addDays(a.fecha, -DIAS_EFECTO), engine.addDays(a.fecha, -1)) : null;
    const fin = [engine.addDays(a.fecha, DIAS_EFECTO), engine.addDays(hoy, -1)].sort()[0];
    const despues = fin > a.fecha ? cuenta(engine.addDays(a.fecha, 1), fin) : null;
    return { ...a, antes, despues };
  });
}

app.get('/api/acciones', route((req) => {
  const emp = String(req.query.emp || '');
  if (!/^\d+\|.+$/.test(emp)) throw bad('Falta la persona.');
  return { tipos: TIPOS_ACCION, items: efectoAcciones(db.acciones([emp])) };
}));

app.post('/api/acciones', route((req) => {
  const a = req.body;
  const b = db.branch(a.branch_id);
  if (!b || !a.emp_code) throw bad('Falta la persona.');
  if (!ISO.test(a.fecha || '')) throw bad('La fecha no existe. Revise el día y el mes.');
  if (a.fecha > today()) throw bad('La fecha no puede ser posterior a hoy.');
  if (!TIPOS_ACCION.includes(a.tipo)) throw bad('Elija qué se hizo.');
  const nota = String(a.nota || '').trim();
  if (nota.length < 5) throw bad('Escriba de qué se habló o qué se acordó.');
  if (nota.length > 500) throw bad('La nota puede tener como máximo 500 letras.');
  const id = db.saveAccion({ branch_id: b.id, emp_code: String(a.emp_code), fecha: a.fecha, tipo: a.tipo, nota, autor: user(req) });
  db.log(user(req), 'Seguimiento registrado', { branch_id: b.id, emp_code: String(a.emp_code), fecha: a.fecha, tipo: a.tipo, nota });
  return { id };
}));

app.delete('/api/acciones/:id', route((req) => {
  const a = db.accion(req.params.id);
  if (!a) throw bad('No existe.');
  db.deleteAccion(a.id);
  db.log(user(req), 'Seguimiento eliminado', a);
  return { ok: true };
}));

app.get('/api/audit', route(() => db.audit()));

// ---------- cierre de quincena ----------
// Al cerrar se guarda una copia de cómo quedó cada día; desde ese momento no se
// pueden justificar ni borrar notas de esos días, y los reportes salen de la copia.
app.get('/api/cierres', route(() => db.cierres()));

app.post('/api/cierres', route(async (req) => {
  const { from: desde, to: hasta } = range({ from: req.body.desde, to: req.body.hasta });
  if (hasta > today()) throw bad('Esa quincena todavía no termina: se puede cerrar a partir de su último día.');
  const ya = db.cierresEn(desde, hasta, false)[0];
  if (ya) throw bad(`Esas fechas ya están en la quincena cerrada del ${fmtFecha(ya.desde)} al ${fmtFecha(ya.hasta)}.`, 409);
  const r = computeReport({ from: desde, to: hasta, branch: 'all' });
  const autor = user(req);
  const nota = String(req.body.nota || '').trim().slice(0, 300);
  const id = db.crearCierre({ desde, hasta, nota, autor, copia: { days: r.result.days, settings: reglasDe(r.settings) } });
  const T = r.result.employees.reduce((t, e) => ({ retardos: t.retardos + e.retardos, faltas: t.faltas + e.faltas }), { retardos: 0, faltas: 0 });
  db.log(autor, 'Quincena cerrada', { desde, hasta, nota, personas: r.result.employees.length, ...T });
  // Envío automático a RH en segundo plano: crear los PDF tarda unos segundos.
  const s = db.getSettings();
  const destinatarios = mailer.parseList(s.correo_rh);
  const enviar = CORREO_ACTIVO && (req.body.enviar ?? s.correo_al_cerrar) && mailer.configurado(s) && destinatarios.length > 0;
  if (enviar) {
    enviarReporte({ from: desde, to: hasta, branch: 'all' }, autor, `Quincena cerrada ${fmtFecha(desde)} al ${fmtFecha(hasta)} · Reporte de asistencia`)
      .then((lista) => db.marcarCorreo(id, `Enviado a ${lista.join(', ')}`))
      .catch((e) => {
        db.marcarCorreo(id, `No se pudo enviar: ${e.message}`);
        db.log('sistema', 'Error al enviar correo', { desde, hasta, error: e.message, tecnico: e.tecnico });
      });
  }
  return { id, correo: enviar ? destinatarios : null };
}));

app.post('/api/cierres/:id/reabrir', route((req) => {
  const c = db.cierres().find((x) => String(x.id) === req.params.id);
  if (!c || c.reabierto_en) throw bad('Esa quincena no está cerrada.');
  const motivo = String(req.body.motivo || '').trim();
  if (motivo.length < 5) throw bad('Escriba el motivo para reabrir la quincena.');
  db.reabrirCierre(c.id, user(req), motivo);
  db.log(user(req), 'Quincena reabierta', { desde: c.desde, hasta: c.hasta, motivo });
  return { ok: true };
}));

// ---------- respaldo automático ----------
// Una copia por día en data/respaldos; se conservan las 14 más recientes.
const BACKUP_DIR = path.join(path.dirname(DB_FILE), 'respaldos');
function dailyBackup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `retardos-${today()}.db`);
    if (!fs.existsSync(file)) db.backup(file);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^retardos-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -14);
    for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  } catch (e) {
    console.error('No se pudo hacer el respaldo:', e.message);
  }
}
dailyBackup();
setInterval(dailyBackup, 60 * 60 * 1000).unref();

// Cuerpo de la petición mal formado u otro error fuera de las rutas.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const tooBig = err.type === 'entity.too.large';
  res.status(err.status || 500).json({
    error: tooBig ? 'El archivo o los datos son demasiado grandes.' : err.type === 'entity.parse.failed' ? 'Los datos enviados no son válidos. Recargue la página e intente de nuevo.' : 'Ocurrió un error inesperado. Intente de nuevo; si sigue pasando, avise a sistemas.',
  });
});

// En Express 5 el callback de listen también recibe el error, así que se revisa ahí.
app.listen(PORT, HOST, (e) => {
  if (e?.code === 'EADDRINUSE') {
    console.log(`El sistema ya está abierto en otra ventana. Abra en su navegador: http://localhost:${PORT}`);
    console.log('Puede cerrar esta ventana.');
    process.exit(0);
  }
  if (e) throw e;
  console.log(`Control de Retardos - El Boom Tractopartes`);
  console.log(`Abra en su navegador: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
