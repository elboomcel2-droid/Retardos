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
const user = (req) => {
  let u = req.get('x-usuario') || '';
  try {
    u = decodeURIComponent(u);
  } catch {}
  return u.trim() || 'sin nombre';
};

function bad(msg) {
  const e = new Error(msg);
  e.status = 400;
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

// ---------- configuración ----------
app.get('/api/settings', route(() => {
  const s = db.getSettings();
  return { ...s, mysql_password: s.mysql_password ? '********' : '' };
}));

app.put('/api/settings', route((req) => {
  const patch = { ...req.body };
  if (patch.mysql_password === '********') delete patch.mysql_password;
  for (const k of ['tolerancia_min', 'duplicado_min', 'retardos_por_falta', 'salida_anticipada_min', 'dias_contexto', 'dias_sin_checar', 'comida_min', 'comida_tolerancia_min', 'cerca_salida_min', 'retardo_falta_min', 'extra_min', 'mysql_port']) {
    if (patch[k] !== undefined) {
      patch[k] = Number(patch[k]);
      if (!Number.isFinite(patch[k]) || patch[k] < 0) throw bad('Revise los números: deben ser 0 o mayores.');
    }
  }
  if (patch.retardo_desde !== undefined && !['entrada', 'tolerancia'].includes(patch.retardo_desde)) throw bad('Opción no válida.');
  if (patch.comida_desde !== undefined && !/^d{2}:d{2}$/.test(patch.comida_desde)) throw bad('Revise la hora de comida.');
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
  const body = req.body;
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

app.get('/api/export.xlsx', route(async (req, res) => {
  const r = computeReport(req.query);
  const buf = await buildWorkbook({ ...r, generadoPor: req.query.usuario });
  const name = `Asistencia_${r.branches.length === 1 ? r.branches[0].name : 'Todas'}_${r.from}_a_${r.to}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(Buffer.from(buf));
}));

// Vista previa del reporte imprimible y su versión PDF (mismas cifras que el Excel).
app.get('/reporte', route((req, res) => {
  const r = computeReport(req.query);
  res.type('html').send(buildReportHtml({ ...r, generadoPor: req.query.usuario }));
}));

app.get('/api/reporte.pdf', route(async (req, res) => {
  const r = computeReport(req.query);
  const pdf = await htmlToPdf(buildReportHtml({ ...r, generadoPor: req.query.usuario }));
  const name = `Asistencia_${r.branches.length === 1 ? r.branches[0].name : 'Todas'}_${r.from}_a_${r.to}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(pdf);
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
