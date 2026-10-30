const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/auth');

test('contraseña: largo mínimo, letras y números', () => {
  assert.match(auth.checkPassword('abc12'), /al menos 8/);
  assert.match(auth.checkPassword('soloLetras'), /letras y números/);
  assert.match(auth.checkPassword('12345678'), /letras y números/);
  assert.equal(auth.checkPassword('Boom2026luz'), null);
});

test('contraseña: rechaza las obvias, con espacios al borde o con su usuario/nombre', () => {
  assert.match(auth.checkPassword('elboom123'), /fácil de adivinar/);
  assert.match(auth.checkPassword(' Boom2026luz'), /espacios/);
  assert.match(auth.checkPassword('luz.samano99', { login: 'luz.samano' }), /usuario ni su nombre/);
  assert.match(auth.checkPassword('Sámano2026x', { nombre: 'Luz Samano Ruiz' }), /usuario ni su nombre/);
  assert.match(auth.checkPassword('a1'.repeat(51)), /máximo/);
});

test('verificar contraseña: correcta, incorrecta y usuario inexistente', () => {
  const h = auth.hashPassword('Boom2026luz');
  assert.equal(auth.verifyPassword('Boom2026luz', h), true);
  assert.equal(auth.verifyPassword('boom2026luz', h), false);
  assert.equal(auth.verifyPassword('Boom2026luz', undefined), false);
  assert.equal(auth.verifyPassword(undefined, h), false);
});

test('bloqueo tras intentos fallidos', () => {
  const login = `prueba.${Date.now()}`;
  for (let i = 0; i < auth.MAX_FAILS - 1; i++) auth.registerFail(login);
  assert.equal(auth.attemptsLeft(login), 1);
  assert.equal(auth.lockedMinutes(login), 0);
  auth.registerFail(login);
  assert.equal(auth.lockedMinutes(login), auth.LOCK_MIN);
  auth.clearFails(login);
  assert.equal(auth.lockedMinutes(login), 0);
});

test('permisos por rol', () => {
  assert.equal(auth.allowed('gerente', 'PUT', '/api/settings'), false);
  assert.equal(auth.allowed('rh', 'PUT', '/api/settings'), true);
  assert.equal(auth.allowed('rh', 'POST', '/api/cierres/3/reabrir'), false);
  assert.equal(auth.allowed('dueno', 'POST', '/api/cierres/3/reabrir'), true);
  assert.equal(auth.allowed('dueno', 'POST', '/api/cuenta/clave'), true);
  assert.equal(auth.allowed('rh', 'GET', '/api/usuarios'), false);
  assert.equal(auth.allowed('desconocido', 'GET', '/api/report'), false);
});
