// Almacenamiento local (SQLite integrado en Node). Guarda la configuración,
// una copia de los marcajes descargados de cada checador y todo lo que
// Recursos Humanos captura (justificaciones, días festivos, ajustes).
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// Horario general de las sucursales. El domingo no es laborable: quien checa
// ese día (vigilancia, tiempo extra) se reporta aparte como día extra.
const DEFAULT_WEEK = [
  // 0 = domingo ... 6 = sábado
  { laborable: false, entrada: '09:00', salida: '15:00', comida: false },
  { laborable: true, entrada: '08:30', salida: '18:00', comida: true },
  { laborable: true, entrada: '08:30', salida: '18:00', comida: true },
  { laborable: true, entrada: '08:30', salida: '18:00', comida: true },
  { laborable: true, entrada: '08:30', salida: '18:00', comida: true },
  { laborable: true, entrada: '08:30', salida: '18:00', comida: true },
  { laborable: true, entrada: '09:00', salida: '15:00', comida: false },
];

// Horario provisional de la primera versión; si una sucursal lo conserva sin
// cambios se reemplaza por el horario real.
const OLD_DEFAULT_WEEK = JSON.stringify([
  { laborable: false, entrada: '09:00', salida: '14:00' },
  ...Array(5).fill({ laborable: true, entrada: '09:00', salida: '18:00' }),
  { laborable: true, entrada: '09:00', salida: '14:00' },
]);

const DEFAULT_BRANCHES = [
  { code: '01', name: 'ALPUYECA', db: 'refacc29_check_alp' },
  { code: '02', name: 'TIZOC', db: 'refacc29_check_tizoc_2' },
  { code: '03', name: 'ACAPULCO', db: 'refacc29_check_acapulco' },
  { code: '04', name: 'CHILPANCINGO', db: 'refacc29_check_chilpancingo' },
];

const DEFAULT_SETTINGS = {
  tolerancia_min: 10,
  duplicado_min: 10,
  comida_min: 40,
  retardo_desde: 'entrada',
  comida_desde: '14:00',
  auto_sync: true,
  comida_tolerancia_min: 10,
  cerca_salida_min: 90,
  retardo_falta_min: 0,
  extra_min: 30,
  retardos_por_falta: 3,
  salida_anticipada_min: 5,
  dias_contexto: 31,
  dias_sin_checar: 5,
  mysql_host: '',
  mysql_port: 3306,
  mysql_user: '',
  mysql_password: '',
  // Correo: servidor de salida (lo configura sistemas) y a quién se envía (RH).
  smtp_host: '',
  smtp_port: 587,
  smtp_seguro: false,
  smtp_user: '',
  smtp_password: '',
  smtp_remitente: '',
  correo_rh: '',
  correo_al_cerrar: true,
};

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      db_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      schedule TEXT NOT NULL,
      tolerancia_min INTEGER,
      last_sync TEXT
    );

    CREATE TABLE IF NOT EXISTS employees (
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      emp_code TEXT NOT NULL,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      activo INTEGER NOT NULL DEFAULT 1,
      fecha_alta TEXT,
      fecha_baja TEXT,
      schedule TEXT,
      notas TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (branch_id, emp_code)
    );

    CREATE TABLE IF NOT EXISTS punches (
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      emp_code TEXT NOT NULL,
      punch_time TEXT NOT NULL,
      source TEXT NOT NULL,
      loaded_at TEXT NOT NULL,
      PRIMARY KEY (branch_id, emp_code, punch_time)
    );
    CREATE INDEX IF NOT EXISTS punches_time ON punches(branch_id, punch_time);

    CREATE TABLE IF NOT EXISTS holidays (
      fecha TEXT PRIMARY KEY,
      descripcion TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS justifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      emp_code TEXT NOT NULL,
      fecha TEXT NOT NULL,
      tipo TEXT NOT NULL,
      nota TEXT NOT NULL DEFAULT '',
      autor TEXT NOT NULL,
      creado TEXT NOT NULL,
      UNIQUE (branch_id, emp_code, fecha)
    );

    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      autor TEXT NOT NULL,
      accion TEXT NOT NULL,
      detalle TEXT NOT NULL
    );

    -- Personas que pueden entrar al sistema (no confundir con los empleados del checador).
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      rol TEXT NOT NULL,
      password TEXT NOT NULL,
      activo INTEGER NOT NULL DEFAULT 1,
      cambiar_clave INTEGER NOT NULL DEFAULT 1,
      creado TEXT NOT NULL,
      ultimo_acceso TEXT
    );

    -- Quincenas entregadas para pago: se guarda una copia exacta de cómo quedó
    -- cada día para que nada de lo que se cambie después altere lo que se pagó.
    CREATE TABLE IF NOT EXISTS cierres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      desde TEXT NOT NULL,
      hasta TEXT NOT NULL,
      nota TEXT NOT NULL DEFAULT '',
      cerrado_por TEXT NOT NULL,
      cerrado_en TEXT NOT NULL,
      copia TEXT NOT NULL,
      reabierto_por TEXT,
      reabierto_en TEXT,
      motivo_reapertura TEXT,
      correo TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      creado TEXT NOT NULL,
      expira INTEGER NOT NULL
    );
  `);

  // Nombre completo capturado en el sistema (el checador a veces solo tiene iniciales).
  if (!db.prepare('PRAGMA table_info(employees)').all().some((c) => c.name === 'alias')) {
    db.exec("ALTER TABLE employees ADD COLUMN alias TEXT NOT NULL DEFAULT ''");
  }

  // "No es una persona" (cuentas genéricas como ADMIN): no se evalúan.
  if (!db.prepare('PRAGMA table_info(employees)').all().some((c) => c.name === 'excluir')) {
    db.exec('ALTER TABLE employees ADD COLUMN excluir INTEGER NOT NULL DEFAULT 0');
  }

  // Misma persona en otra sucursal: apunta a su registro principal ("sucursal|número").
  if (!db.prepare('PRAGMA table_info(employees)').all().some((c) => c.name === 'principal')) {
    db.exec('ALTER TABLE employees ADD COLUMN principal TEXT');
  }

  // El rol "Solo consulta" se dividió en Gerente y Dueño; quien lo tenía queda como Gerente.
  db.prepare("UPDATE users SET rol = 'gerente' WHERE rol = 'consulta'").run();

  // Justificaciones: "no justificado" (solo nota) y hora hasta la que tenía permiso.
  const jCols = db.prepare('PRAGMA table_info(justifications)').all().map((c) => c.name);
  if (!jCols.includes('justificado')) db.exec('ALTER TABLE justifications ADD COLUMN justificado INTEGER NOT NULL DEFAULT 1');
  if (!jCols.includes('hora_permiso')) db.exec('ALTER TABLE justifications ADD COLUMN hora_permiso TEXT');

  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, JSON.stringify(v));
  // Antes el lapso de checadas repetidas era de 3 min; ahora 10 (solo si no lo cambiaron).
  db.prepare("UPDATE settings SET value = '10' WHERE key = 'duplicado_min' AND value = '3'").run();
  // La comida es de 40 min (antes se suponían 60).
  db.prepare("UPDATE settings SET value = '40' WHERE key = 'comida_min' AND value = '60'").run();

  const insBranch = db.prepare(
    'INSERT OR IGNORE INTO branches (code, name, db_name, schedule) VALUES (?, ?, ?, ?)'
  );
  for (const b of DEFAULT_BRANCHES) insBranch.run(b.code, b.name, b.db, JSON.stringify(DEFAULT_WEEK));
  db.prepare('UPDATE branches SET schedule = ? WHERE schedule = ?').run(JSON.stringify(DEFAULT_WEEK), OLD_DEFAULT_WEEK);

  return new Store(db);
}

// Hora local del equipo (no UTC), para que RH vea la hora real de cada acción.
const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

class Store {
  constructor(db) {
    this.db = db;
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- configuración ----------
  getSettings() {
    const out = { ...DEFAULT_SETTINGS };
    for (const r of this.db.prepare('SELECT key, value FROM settings').all()) out[r.key] = JSON.parse(r.value);
    return out;
  }

  saveSettings(patch) {
    const st = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (patch[k] !== undefined) st.run(k, JSON.stringify(patch[k]));
    }
  }

  // ---------- sucursales ----------
  branches() {
    return this.db.prepare('SELECT * FROM branches ORDER BY code').all().map(parseBranch);
  }

  branch(id) {
    const r = this.db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
    return r ? parseBranch(r) : null;
  }

  saveBranch(id, b) {
    this.db
      .prepare(
        'UPDATE branches SET name = ?, db_name = ?, enabled = ?, schedule = ?, tolerancia_min = ? WHERE id = ?'
      )
      .run(b.name, b.db_name, b.enabled ? 1 : 0, JSON.stringify(b.schedule), b.tolerancia_min ?? null, id);
  }

  markSynced(id) {
    this.db.prepare('UPDATE branches SET last_sync = ? WHERE id = ?').run(now(), id);
  }

  // ---------- empleados ----------
  employees(branchId) {
    const sql = branchId
      ? 'SELECT * FROM employees WHERE branch_id = ? ORDER BY last_name, first_name'
      : 'SELECT * FROM employees ORDER BY branch_id, last_name, first_name';
    const rows = branchId ? this.db.prepare(sql).all(branchId) : this.db.prepare(sql).all();
    return rows.map(parseEmployee);
  }

  upsertEmployees(branchId, list) {
    const st = this.db.prepare(`
      INSERT INTO employees (branch_id, emp_code, first_name, last_name, fecha_alta, activo) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (branch_id, emp_code) DO UPDATE SET
        fecha_alta = COALESCE(fecha_alta, excluded.fecha_alta),
        first_name = CASE WHEN excluded.first_name <> '' THEN excluded.first_name ELSE first_name END,
        last_name = CASE WHEN excluded.last_name <> '' THEN excluded.last_name ELSE last_name END
    `);
    // La fecha de ingreso y el estado del checador solo se toman la primera vez;
    // después manda lo que capture la persona en el sistema.
    for (const e of list) {
      st.run(branchId, String(e.emp_code), e.first_name || '', e.last_name || '', e.hire_date || null, e.activo === false ? 0 : 1);
    }
  }

  // Cambios puntuales desde los avisos del Panel. Usan "upsert" porque hay
  // números que checan sin estar dados de alta en el checador.
  setAlias(branchId, code, alias) {
    this.db
      .prepare(
        `INSERT INTO employees (branch_id, emp_code, alias) VALUES (?, ?, ?)
         ON CONFLICT (branch_id, emp_code) DO UPDATE SET alias = excluded.alias`
      )
      .run(branchId, code, alias);
  }

  setExcluir(branchId, code, excluir) {
    this.db
      .prepare(
        `INSERT INTO employees (branch_id, emp_code, excluir) VALUES (?, ?, ?)
         ON CONFLICT (branch_id, emp_code) DO UPDATE SET excluir = excluded.excluir`
      )
      .run(branchId, code, excluir ? 1 : 0);
  }

  // Personas que checaron desde cierta fecha, con su primera y última checada.
  recentPunchers(since) {
    return this.db
      .prepare(
        `SELECT branch_id, emp_code, MIN(punch_time) AS primera, MAX(punch_time) AS ultima, COUNT(*) AS checadas
         FROM punches WHERE punch_time >= ? GROUP BY branch_id, emp_code`
      )
      .all(`${since} 00:00:00`);
  }

  // Copia de seguridad de la base (se guarda un archivo por día).
  backup(file) {
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }

  setBaja(branchId, code, fecha) {
    this.db
      .prepare(
        `INSERT INTO employees (branch_id, emp_code, activo, fecha_baja) VALUES (?, ?, 0, ?)
         ON CONFLICT (branch_id, emp_code) DO UPDATE SET activo = 0, fecha_baja = excluded.fecha_baja`
      )
      .run(branchId, code, fecha);
  }

  saveEmployee(branchId, code, e) {
    this.db
      .prepare(
        `UPDATE employees SET activo = ?, fecha_alta = ?, fecha_baja = ?, schedule = ?, notas = ?, alias = ?, excluir = ?
         WHERE branch_id = ? AND emp_code = ?`
      )
      .run(
        e.activo ? 1 : 0,
        e.fecha_alta || null,
        e.fecha_baja || null,
        e.schedule ? JSON.stringify(e.schedule) : null,
        e.notas || '',
        String(e.alias || '').trim(),
        e.excluir ? 1 : 0,
        branchId,
        code
      );
  }

  // Une el registro de una persona en otra sucursal con su registro principal.
  // Siempre se apunta al principal del grupo (nunca cadenas de vínculos).
  setPrincipal(branchId, code, principal) {
    this.db
      .prepare(
        `INSERT INTO employees (branch_id, emp_code, principal) VALUES (?, ?, ?)
         ON CONFLICT (branch_id, emp_code) DO UPDATE SET principal = excluded.principal`
      )
      .run(branchId, code, principal);
  }

  // Registros vinculados a un principal ("sucursal|número").
  linkedTo(key) {
    return this.db.prepare('SELECT * FROM employees WHERE principal = ?').all(key).map(parseEmployee);
  }

  employee(branchId, code) {
    const r = this.db.prepare('SELECT * FROM employees WHERE branch_id = ? AND emp_code = ?').get(branchId, code);
    return r ? parseEmployee(r) : null;
  }

  // ---------- marcajes ----------
  insertPunches(branchId, list, source) {
    const st = this.db.prepare(
      'INSERT OR IGNORE INTO punches (branch_id, emp_code, punch_time, source, loaded_at) VALUES (?, ?, ?, ?, ?)'
    );
    const t = now();
    let added = 0;
    for (const p of list) added += Number(st.run(branchId, String(p.emp_code), p.punch_time, source, t).changes);
    return added;
  }

  punches(branchIds, from, to) {
    const marks = branchIds.map(() => '?').join(',');
    return this.db
      .prepare(
        `SELECT branch_id, emp_code, punch_time, source FROM punches
         WHERE branch_id IN (${marks}) AND punch_time >= ? AND punch_time <= ?
         ORDER BY punch_time`
      )
      .all(...branchIds, `${from} 00:00:00`, `${to} 23:59:59`);
  }

  coverage() {
    return this.db
      .prepare(
        `SELECT branch_id, MIN(punch_time) AS desde, MAX(punch_time) AS hasta, COUNT(*) AS total
         FROM punches GROUP BY branch_id`
      )
      .all();
  }

  // ---------- festivos ----------
  holidays() {
    return this.db.prepare('SELECT * FROM holidays ORDER BY fecha').all();
  }

  addHoliday(fecha, descripcion) {
    this.db.prepare('INSERT OR REPLACE INTO holidays (fecha, descripcion) VALUES (?, ?)').run(fecha, descripcion);
  }

  deleteHoliday(fecha) {
    this.db.prepare('DELETE FROM holidays WHERE fecha = ?').run(fecha);
  }

  // ---------- justificaciones ----------
  justifications(from, to) {
    return this.db
      .prepare('SELECT * FROM justifications WHERE fecha >= ? AND fecha <= ? ORDER BY fecha')
      .all(from, to);
  }

  justification(id) {
    return this.db.prepare('SELECT * FROM justifications WHERE id = ?').get(id);
  }

  saveJustification(j) {
    this.db
      .prepare(
        `INSERT INTO justifications (branch_id, emp_code, fecha, tipo, nota, autor, creado, justificado, hora_permiso)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (branch_id, emp_code, fecha) DO UPDATE SET
           tipo = excluded.tipo, nota = excluded.nota, autor = excluded.autor, creado = excluded.creado,
           justificado = excluded.justificado, hora_permiso = excluded.hora_permiso`
      )
      .run(j.branch_id, j.emp_code, j.fecha, j.tipo, j.nota || '', j.autor, now(), j.justificado ? 1 : 0, j.hora_permiso || null);
  }

  deleteJustification(id) {
    this.db.prepare('DELETE FROM justifications WHERE id = ?').run(id);
  }

  // ---------- cierres de quincena ----------
  cierres() {
    return this.db
      .prepare('SELECT id, desde, hasta, nota, cerrado_por, cerrado_en, reabierto_por, reabierto_en, motivo_reapertura, correo FROM cierres ORDER BY desde DESC, id DESC')
      .all();
  }

  cierre(id) {
    const r = this.db.prepare('SELECT * FROM cierres WHERE id = ?').get(id);
    return r ? { ...r, copia: JSON.parse(r.copia) } : null;
  }

  // Cierres vigentes (no reabiertos) que tocan el periodo; con su copia si se pide.
  cierresEn(from, to, conCopia = true) {
    const cols = conCopia ? '*' : 'id, desde, hasta, nota, cerrado_por, cerrado_en, correo';
    return this.db
      .prepare(`SELECT ${cols} FROM cierres WHERE reabierto_en IS NULL AND desde <= ? AND hasta >= ? ORDER BY desde`)
      .all(to, from)
      .map((r) => (conCopia ? { ...r, copia: JSON.parse(r.copia) } : r));
  }

  crearCierre({ desde, hasta, nota, autor, copia }) {
    return Number(
      this.db
        .prepare('INSERT INTO cierres (desde, hasta, nota, cerrado_por, cerrado_en, copia) VALUES (?, ?, ?, ?, ?, ?)')
        .run(desde, hasta, nota || '', autor, now(), JSON.stringify(copia)).lastInsertRowid
    );
  }

  reabrirCierre(id, autor, motivo) {
    this.db.prepare('UPDATE cierres SET reabierto_por = ?, reabierto_en = ?, motivo_reapertura = ? WHERE id = ?').run(autor, now(), motivo, id);
  }

  marcarCorreo(id, texto) {
    this.db.prepare('UPDATE cierres SET correo = ? WHERE id = ?').run(texto, id);
  }

  // ---------- usuarios y sesiones ----------
  users() {
    return this.db
      .prepare('SELECT id, login, nombre, rol, activo, cambiar_clave, creado, ultimo_acceso FROM users ORDER BY nombre')
      .all()
      .map(parseUser);
  }

  userCount() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  }

  activeAdmins() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE rol = 'admin' AND activo = 1").get().n;
  }

  user(id) {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return r ? parseUser(r) : null;
  }

  userByLogin(login) {
    const r = this.db.prepare('SELECT * FROM users WHERE login = ?').get(login);
    return r ? parseUser(r) : null;
  }

  createUser({ login, nombre, rol, password, cambiar_clave = true }) {
    return Number(
      this.db
        .prepare('INSERT INTO users (login, nombre, rol, password, cambiar_clave, creado) VALUES (?, ?, ?, ?, ?, ?)')
        .run(login, nombre, rol, password, cambiar_clave ? 1 : 0, now()).lastInsertRowid
    );
  }

  updateUser(id, { nombre, rol, activo }) {
    this.db.prepare('UPDATE users SET nombre = ?, rol = ?, activo = ? WHERE id = ?').run(nombre, rol, activo ? 1 : 0, id);
  }

  setPassword(id, password, cambiar_clave) {
    this.db.prepare('UPDATE users SET password = ?, cambiar_clave = ? WHERE id = ?').run(password, cambiar_clave ? 1 : 0, id);
  }

  createSession(token, userId, hours) {
    this.db.prepare('DELETE FROM sessions WHERE expira < ?').run(Date.now());
    this.db
      .prepare('INSERT INTO sessions (token, user_id, creado, expira) VALUES (?, ?, ?, ?)')
      .run(token, userId, now(), Date.now() + hours * 3600000);
    this.db.prepare('UPDATE users SET ultimo_acceso = ? WHERE id = ?').run(now(), userId);
  }

  // Usuario de una sesión vigente; cada uso la extiende (se cierra por inactividad).
  sessionUser(token, hours) {
    if (!token) return null;
    const s = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!s || s.expira < Date.now()) return null;
    const u = this.user(s.user_id);
    if (!u || !u.activo) return null;
    this.db.prepare('UPDATE sessions SET expira = ? WHERE token = ?').run(Date.now() + hours * 3600000, token);
    return u;
  }

  deleteSession(token) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  deleteSessionsOf(userId, exceptToken = '') {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, exceptToken);
  }

  // ---------- bitácora ----------
  log(autor, accion, detalle) {
    this.db
      .prepare('INSERT INTO audit (fecha, autor, accion, detalle) VALUES (?, ?, ?, ?)')
      .run(now(), autor || 'sistema', accion, typeof detalle === 'string' ? detalle : JSON.stringify(detalle));
  }

  audit(limit = 2000) {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit);
  }
}

function parseBranch(r) {
  return { ...r, enabled: !!r.enabled, schedule: JSON.parse(r.schedule) };
}

function parseUser(r) {
  return { ...r, activo: !!r.activo, cambiar_clave: !!r.cambiar_clave };
}

function parseEmployee(r) {
  return { ...r, activo: !!r.activo, excluir: !!r.excluir, schedule: r.schedule ? JSON.parse(r.schedule) : null };
}

module.exports = { open, DEFAULT_WEEK, DEFAULT_SETTINGS };
