const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const store = require('./store');
const engine = require('./engine');
const biotime = require('./biotime');
const importer = require('./importer');
const { buildWorkbook } = require('./export');
const { buildReportHtml } = require('./report-html');
const { htmlToPdf } = require('./pdf');
const { createLive, weekPlan } = require('./live');
const auth = require('./auth');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'retardos.db');

const db = store.open(DB_FILE);
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Nombre de quien inició sesión: es el que queda en el historial y en los reportes.
const user = (req) => req.user?.nombre || 'sistema';

function bad(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

function range(q) {
  const { from, to } = q;
  if (!ISO.test(from || '') || !ISO.test(to || '')) throw bad('Elija las fechas del periodo.');
  if (from > to) throw bad('La fecha inicial es posterior a la final.');
  return { from, to };
}

function selectedBranches(q) {
  const all = db.branches();
  if (!q.branch || q.branch === 'all') return all.filter((b) => b.enabled);
  const b = all.find((x) => String(x.id) === String(q.branch));
  if (!b) throw bad('Sucursal no encontrada.');
  return [b];
}

const route = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

function computeReport(q) {
  const { from, to } = range(q);
  const branches = selectedBranches(q);
  const settings = db.getSettings();
  const ctxFrom = engine.addDays(from, -settings.dias_contexto);
  const ids = branches.map((b) => b.id);
  const punches = ids.length ? db.punches(ids, ctxFrom, to) : [];
  const employees = db.employees();
  const justifications = db.justifications(from, to);
  const result = engine.compute({
    from,
    to,
    today: today(),
    branches,
    settings,
    employees,
    punches,
    holidays: db.holidays(),
    justifications,
  });
  const sucursal = branches.length === 1 ? `${branches[0].code} ${branches[0].name}` : 'Todas las sucursales';
  return { from, to, today: today(), sucursal, branches, settings, employees, punches, justifications, result };
}

// ---------- inicio de sesión ----------
const publicUser = (u) => ({
  id: u.id,
  login: u.login,
  nombre: u.nombre,
  rol: u.rol,
  rol_nombre: auth.ROLES[u.rol]?.nombre || u.rol,
  cambiar_clave: u.cambiar_clave,
});

function cleanNombre(nombre) {
  const n = String(nombre || '').trim().replace(/\s+/g, ' ');
  if (n.split(' ').length < 2) throw bad('Escriba el nombre completo de la persona (nombre y apellido).');
  return n;
}

function cleanLogin(login) {
  const l = auth.normalizeLogin(login);
  if (!auth.LOGIN_RE.test(l)) throw bad('El usuario debe tener de 3 a 30 letras sin acentos, números, punto o guion bajo (ej. luz.samano).');
  return l;
}

function cleanPassword(password) {
  const err = auth.checkPassword(password);
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
  return { configurado: db.userCount() > 0, usuario: u ? publicUser(u) : null, roles: auth.ROLES };
}));

// Solo funciona mientras no exista ningún usuario: crea el primer administrador.
app.post('/api/auth/primer-usuario', route((req, res) => {
  if (db.userCount() > 0) throw bad('Ya hay usuarios registrados. Inicie sesión.', 403);
  const nombre = cleanNombre(req.body.nombre);
  const login = cleanLogin(req.body.login);
  const id = db.createUser({ login, nombre, rol: 'admin', password: cleanPassword(req.body.password), cambiar_clave: false });
  const u = db.user(id);
  startSession(res, u);
  db.log(u.nombre, 'Usuario creado', { login, nombre, rol: 'admin', primero: true });
  return { usuario: publicUser(u) };
}));

app.post('/api/auth/entrar', route((req, res) => {
  const login = auth.normalizeLogin(req.body.login);
  const mins = auth.lockedMinutes(login);
  if (mins) throw bad(`Demasiados intentos. Espere ${mins} minuto(s) e intente de nuevo.`, 429);
  const u = db.userByLogin(login);
  if (!u || !auth.verifyPassword(req.body.password, u.password)) {
    auth.registerFail(login);
    db.log(login || '(vacío)', 'Intento de acceso fallido', { login });
    throw bad('Usuario o contraseña incorrectos.', 401);
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
  if (!auth.verifyPassword(req.body.actual, u.password)) throw bad('La contraseña actual no es correcta.');
  if (req.body.actual === req.body.nueva) throw bad('La nueva contraseña debe ser diferente a la actual.');
  db.setPassword(u.id, cleanPassword(req.body.nueva), false);
  // Cierra las sesiones abiertas en otros equipos.
  db.deleteSessionsOf(u.id, auth.readCookie(req));
  db.log(u.nombre, 'Contraseña cambiada', { login: u.login });
  return { usuario: publicUser(db.user(u.id)) };
}));

// ---------- usuarios (solo administrador) ----------
app.get('/api/usuarios', route(() => db.users().map((u) => ({ ...u, rol_nombre: auth.ROLES[u.rol]?.nombre || u.rol }))));

app.post('/api/usuarios', route((req) => {
  const nombre = cleanNombre(req.body.nombre);
  const login = cleanLogin(req.body.login);
  if (!auth.ROLES[req.body.rol]) throw bad('Elija el tipo de acceso.');
  if (db.userByLogin(login)) throw bad(`Ya existe el usuario «${login}».`);
  db.createUser({ login, nombre, rol: req.body.rol, password: cleanPassword(req.body.password) });
  db.log(user(req), 'Usuario creado', { login, nombre, rol: req.body.rol });
  return { ok: true };
}));

app.put('/api/usuarios/:id', route((req) => {
  const u = db.user(req.params.id);
  if (!u) throw bad('Usuario no encontrado.');
  const nombre = cleanNombre(req.body.nombre ?? u.nombre);
  const rol = req.body.rol ?? u.rol;
  const activo = req.body.activo ?? u.activo;
  if (!auth.ROLES[rol]) throw bad('Elija el tipo de acceso.');
  const dejaDeSerAdmin = u.rol === 'admin' && u.activo && (rol !== 'admin' || !activo);
  if (dejaDeSerAdmin && db.activeAdmins() <= 1) throw bad('Debe quedar al menos un administrador activo.');
  db.updateUser(u.id, { nombre, rol, activo });
  if (!activo) db.deleteSessionsOf(u.id);
  const cambios = {};
  if (nombre !== u.nombre) cambios.nombre = nombre;
  if (rol !== u.rol) cambios.rol = rol;
  if (!!activo !== u.activo) cambios.activo = !!activo;
  db.log(user(req), 'Usuario actualizado', { login: u.login, ...cambios });
  return { ok: true };
}));

// Contraseña temporal: la persona tendrá que cambiarla al entrar.
app.post('/api/usuarios/:id/clave', route((req) => {
  const u = db.user(req.params.id);
  if (!u) throw bad('Usuario no encontrado.');
  db.setPassword(u.id, cleanPassword(req.body.password), true);
  db.deleteSessionsOf(u.id);
  db.log(user(req), 'Contraseña restablecida', { login: u.login, nombre: u.nombre });
  return { ok: true };
}));

// ---------- configuración ----------
app.get('/api/settings', route(() => {
  const s = db.getSettings();
  return { ...s, mysql_password: s.mysql_password ? '********' : '' };
}));

app.put('/api/settings', route((req) => {
  const patch = { ...req.body };
  if (patch.mysql_password === '********') delete patch.mysql_password;
  if (req.user.rol !== 'admin' && Object.keys(patch).some((k) => k.startsWith('mysql_'))) {
    throw bad('Solo el administrador puede cambiar la conexión con los checadores.', 403);
  }
  for (const k of ['tolerancia_min', 'duplicado_min', 'retardos_por_falta', 'salida_anticipada_min', 'dias_contexto', 'dias_sin_checar', 'comida_min', 'comida_tolerancia_min', 'cerca_salida_min', 'retardo_falta_min', 'extra_min', 'mysql_port']) {
    if (patch[k] !== undefined) {
      patch[k] = Number(patch[k]);
      if (!Number.isFinite(patch[k]) || patch[k] < 0) throw bad('Revise los números: deben ser 0 o mayores.');
    }
  }
  if (patch.retardo_desde !== undefined && !['entrada', 'tolerancia'].includes(patch.retardo_desde)) throw bad('Opción no válida.');
  if (patch.comida_desde !== undefined && !/^\d{2}:\d{2}$/.test(patch.comida_desde)) throw bad('Revise la hora de comida.');
  if (patch.auto_sync !== undefined) patch.auto_sync = patch.auto_sync === true || patch.auto_sync === 'true';
  db.saveSettings(patch);
  const logged = { ...patch };
  if (logged.mysql_password) logged.mysql_password = '(cambiada)';
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
  if (req.user.rol !== 'admin') delete body.db_name;
  const schedule = body.schedule || b.schedule;
  if (!Array.isArray(schedule) || schedule.length !== 7) throw bad('El horario debe tener 7 días.');
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
  return { from: r.from, to: r.to, settings: r.settings, ...r.result };
}));

// Constancia de cada reporte que sale del sistema (descargado o impreso).
const reportLog = (req, accion, r, extra = {}) =>
  db.log(user(req), accion, { desde: r.from, hasta: r.to, sucursal: r.sucursal, ...extra });

app.get('/api/export.xlsx', route(async (req, res) => {
  const r = computeReport(req.query);
  const buf = await buildWorkbook({ ...r, generadoPor: user(req) });
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
  res.type('html').send(buildReportHtml({ ...r, generadoPor: user(req) }));
}));

app.get('/api/reporte.pdf', route(async (req, res) => {
  const r = computeReport(req.query);
  const pdf = await htmlToPdf(buildReportHtml({ ...r, generadoPor: user(req) }));
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
  for (const k of ['fecha_alta', 'fecha_baja']) if (e[k] && !ISO.test(e[k])) throw bad('Revise las fechas de alta y baja.');
  if (e.schedule && (!Array.isArray(e.schedule) || e.schedule.length !== 7)) throw bad('El horario debe tener 7 días.');
  db.saveEmployee(b.id, req.params.code, e);
  db.log(user(req), 'Empleado actualizado', { sucursal: `${b.code} ${b.name}`, emp_code: req.params.code, ...e });
  return { ok: true };
}));

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
    if (e.excluir || !e.activo || e.fecha_baja || (e.alias || '').trim() || !engine.isShortName(e)) continue;
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
  db.setAlias(b.id, req.params.code, alias);
  db.log(user(req), 'Nombre registrado', { sucursal: `${b.code} ${b.name}`, emp_code: req.params.code, alias });
  return { ok: true };
}));

app.post('/api/employees/:branch/:code/baja', route((req) => {
  const b = db.branch(req.params.branch);
  if (!b) throw bad('Sucursal no encontrada.');
  if (!ISO.test(req.body.fecha_baja || '')) throw bad('Falta la fecha de baja.');
  db.setBaja(b.id, req.params.code, req.body.fecha_baja);
  db.log(user(req), 'Baja registrada', { sucursal: `${b.code} ${b.name}`, emp_code: req.params.code, fecha_baja: req.body.fecha_baja });
  return { ok: true };
}));

// ---------- festivos ----------
app.get('/api/holidays', route(() => db.holidays()));
app.post('/api/holidays', route((req) => {
  const { fecha, descripcion } = req.body;
  if (!ISO.test(fecha || '') || !descripcion) throw bad('Escriba la fecha y el nombre del día festivo.');
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
const TIPOS = ['Permiso para llegar tarde', 'Permiso para salir temprano', 'Permiso con goce', 'Permiso sin goce', 'Incapacidad', 'Vacaciones', 'Comisión de trabajo', 'Falla del checador', 'Olvido de checada (verificado)', 'Otro'];
const NO_JUSTIFICADO = 'No justificado';

app.get('/api/justifications', route((req) => {
  const { from, to } = range(req.query);
  return { tipos: TIPOS, items: db.justifications(from, to) };
}));

app.post('/api/justifications', route((req) => {
  const j = req.body;
  if (!db.branch(j.branch_id)) throw bad('Sucursal no encontrada.');
  if (!j.emp_code || !ISO.test(j.fecha || '')) throw bad('Falta el empleado o la fecha.');
  j.justificado = j.justificado !== false;
  if (!j.justificado) j.tipo = NO_JUSTIFICADO;
  else if (!TIPOS.includes(j.tipo)) throw bad('Elija el tipo de justificación.');
  if (!String(j.nota || '').trim()) throw bad('Escriba el porqué.');
  if (j.hora_permiso && !/^\d{2}:\d{2}$/.test(j.hora_permiso)) throw bad('Revise la hora del permiso.');
  if (!j.justificado) j.hora_permiso = null;
  const autor = user(req);
  if (autor === 'sin nombre') throw bad('Escriba su nombre en el campo Usuario antes de guardar.');
  // "hasta": aplica la misma justificación a varios días seguidos (vacaciones, incapacidad).
  const hasta = j.hasta && ISO.test(j.hasta) ? j.hasta : j.fecha;
  if (hasta < j.fecha) throw bad('La fecha "hasta" debe ser igual o posterior al día que se justifica.');
  const fechas = engine.eachDay(j.fecha, hasta);
  if (fechas.length > 62) throw bad('Se pueden justificar hasta 62 días a la vez.');
  db.tx(() => fechas.forEach((fecha) => db.saveJustification({ ...j, fecha, emp_code: String(j.emp_code), autor })));
  db.log(autor, 'Justificación registrada', { ...j, dias: fechas.length });
  return { ok: true, dias: fechas.length };
}));

app.delete('/api/justifications/:id', route((req) => {
  const j = db.justification(req.params.id);
  if (!j) throw bad('No existe.');
  db.deleteJustification(j.id);
  db.log(user(req), 'Justificación eliminada', j);
  return { ok: true };
}));

app.get('/api/audit', route(() => db.audit()));

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
