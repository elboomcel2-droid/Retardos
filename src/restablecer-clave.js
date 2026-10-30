// Recuperación de acceso: pone una contraseña temporal a un usuario.
// Se ejecuta en el equipo donde está instalado el sistema (restablecer-clave.bat),
// para cuando el administrador olvidó su contraseña y no hay otro que lo ayude.
//   node src/restablecer-clave.js            → lista los usuarios
//   node src/restablecer-clave.js luz.samano → le pone una contraseña temporal
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const auth = require('./auth');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'retardos.db');
const db = store.open(DB_FILE);
const login = auth.normalizeLogin(process.argv[2]);

if (!login) {
  const users = db.users();
  if (!users.length) {
    console.log('Todavía no hay usuarios: abra el sistema y cree el primero.');
    process.exit(0);
  }
  console.log('Usuarios registrados:\n');
  for (const u of users) {
    console.log(`  ${u.login.padEnd(20)} ${u.nombre} (${auth.ROLES[u.rol]?.nombre || u.rol}${u.activo ? '' : ', desactivado'})`);
  }
  console.log('\nPara ponerle una contraseña temporal a alguien escriba su usuario.');
  process.exit(0);
}

const u = db.userByLogin(login);
if (!u) {
  console.log(`No existe el usuario «${login}».`);
  process.exit(1);
}

// Sin letras ni números que se confundan (0/O, 1/l/I).
const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
const temporal = Array.from(crypto.randomBytes(8), (b) => ABC[b % ABC.length]).join('');
db.setPassword(u.id, auth.hashPassword(temporal), true);
db.deleteSessionsOf(u.id);
// Si estaba desactivado, se reactiva para que pueda entrar.
if (!u.activo) db.updateUser(u.id, { nombre: u.nombre, rol: u.rol, activo: true });
db.log('Recuperación desde el equipo', 'Contraseña restablecida', { login: u.login, nombre: u.nombre });

console.log(`\nUsuario:             ${u.login}  (${u.nombre})`);
console.log(`Contraseña temporal: ${temporal}`);
console.log('\nEntre al sistema con estos datos; le pedirá elegir una contraseña nueva.');
