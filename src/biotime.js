// Lectura directa de las bases de datos de los checadores (ZKTeco BioTime en
// MySQL). Solo se ejecutan consultas SELECT: nunca se modifica el checador.
const mysql = require('mysql2/promise');

// Mensajes para el usuario: sin términos técnicos. El detalle técnico se
// conserva en la bitácora para quien dé soporte.
const FRIENDLY = {
  ECONNREFUSED: 'No se pudo conectar con el servidor de los checadores. Revise la dirección del servidor en Configuración.',
  ETIMEDOUT: 'El servidor de los checadores no respondió. Revise que haya internet o red, e intente de nuevo.',
  ENOTFOUND: 'No se encontró el servidor de los checadores. Revise la dirección escrita en Configuración.',
  ER_ACCESS_DENIED_ERROR: 'El usuario o la contraseña de los checadores son incorrectos, o este equipo no tiene permiso de entrar.',
  ER_DBACCESS_DENIED_ERROR: 'El usuario no tiene permiso para ver las checadas de esta sucursal.',
  ER_BAD_DB_ERROR: 'No se encontraron las checadas de esta sucursal en el servidor. Revise el nombre configurado.',
  ER_NO_SUCH_TABLE: 'El servidor no tiene el formato de checadas esperado.',
};

function friendly(e) {
  const msg = FRIENDLY[e.code] || 'No se pudo leer el checador. Intente de nuevo; si sigue fallando, avise a sistemas.';
  const err = new Error(msg);
  err.tecnico = e.code ? `${e.code}: ${e.message}` : e.message;
  return err;
}

async function withConn(settings, dbName, fn) {
  let conn;
  try {
    conn = await connect(settings, dbName);
    // Candado: el servidor rechaza cualquier escritura en esta sesión, aunque
    // el usuario de MySQL tenga más permisos.
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    return await fn(conn);
  } catch (e) {
    throw e.code === 'SIN_CONFIG' ? e : friendly(e);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

async function connect(settings, dbName) {
  if (!settings.mysql_host || !settings.mysql_user) {
    throw Object.assign(new Error('Falta configurar la conexión con los checadores (Configuración → Opciones avanzadas).'), { code: 'SIN_CONFIG' });
  }
  if (!dbName) throw Object.assign(new Error('Falta indicar dónde están las checadas de esta sucursal (Configuración → Opciones avanzadas).'), { code: 'SIN_CONFIG' });
  return mysql.createConnection({
    host: settings.mysql_host,
    port: Number(settings.mysql_port) || 3306,
    user: settings.mysql_user,
    password: settings.mysql_password,
    database: dbName,
    dateStrings: true,
    connectTimeout: 15000,
  });
}

function normTime(v) {
  return String(v).replace('T', ' ').slice(0, 19);
}

async function testConnection(settings, branch) {
  return withConn(settings, branch.db_name, async (conn) => {
    const [[emp]] = await conn.query('SELECT COUNT(*) AS n FROM personnel_employee');
    const [[tx]] = await conn.query(
      'SELECT COUNT(*) AS n, MIN(punch_time) AS desde, MAX(punch_time) AS hasta FROM iclock_transaction'
    );
    return {
      empleados: Number(emp.n),
      marcajes: Number(tx.n),
      desde: tx.desde && normTime(tx.desde),
      hasta: tx.hasta && normTime(tx.hasta),
      permisos: await grants(conn),
    };
  });
}

// Revisa qué permisos tiene el usuario de MySQL (SHOW GRANTS solo consulta).
// Lo ideal: únicamente SELECT sobre las bases de los checadores.
async function grants(conn) {
  try {
    const [rows] = await conn.query('SHOW GRANTS FOR CURRENT_USER()');
    const lines = rows.map((r) => String(Object.values(r)[0]).replace(/IDENTIFIED BY PASSWORD\s+'[^']*'/i, '').trim());
    const extra = lines.filter((l) => {
      const m = l.match(/^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO/i);
      if (!m) return false;
      const privs = m[1].split(',').map((p) => p.trim().toUpperCase());
      if (privs.every((p) => p === 'USAGE')) return false;
      const db = m[2].replace(/[`'"]/g, '').split('.')[0];
      const soloLectura = privs.every((p) => ['SELECT', 'SHOW VIEW', 'USAGE'].includes(p));
      return !soloLectura || db === '*' || !/_check_/i.test(db);
    });
    return { solo_lectura: extra.length === 0, sobrantes: extra };
  } catch {
    return null;
  }
}

async function fetchBranch(settings, branch, from, to) {
  return withConn(settings, branch.db_name, async (conn) => {
    // hire_date / is_active existen en BioTime; si una versión no los tiene, se omiten.
    const [employees] = await conn
      .query('SELECT emp_code, first_name, last_name, hire_date, is_active FROM personnel_employee')
      .catch((e) => {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
        return conn.query('SELECT emp_code, first_name, last_name FROM personnel_employee');
      });
    const [punches] = await conn.query(
      `SELECT emp_code, punch_time FROM iclock_transaction
       WHERE punch_time BETWEEN ? AND ? ORDER BY punch_time`,
      [`${from} 00:00:00`, `${to} 23:59:59`]
    );
    return {
      employees: employees.map((e) => ({
        emp_code: String(e.emp_code).trim(),
        first_name: (e.first_name || '').trim(),
        last_name: (e.last_name || '').trim(),
        hire_date: /^\d{4}-\d{2}-\d{2}/.test(e.hire_date || '') ? String(e.hire_date).slice(0, 10) : null,
        activo: e.is_active == null ? true : Number(e.is_active) === 1,
      })),
      punches: punches.map((p) => ({ emp_code: String(p.emp_code).trim(), punch_time: normTime(p.punch_time) })),
    };
  });
}

module.exports = { testConnection, fetchBranch };
