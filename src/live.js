// Actualización automática ("en vivo"). Para no saturar el servidor de los
// checadores, solo consulta en las horas en que la gente checa, con más
// frecuencia alrededor de la entrada, la comida y la salida, y nunca de noche.
// El plan se calcula con los horarios configurados de cada sucursal.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Igual que el motor: si el horario no lo dice, hay comida en jornadas de más de 7 horas.
const hasLunch = (d) => d.comida ?? toMin(d.salida) - toMin(d.entrada) > 7 * 60;

/** Ventanas de consulta de un día: [{ desde, hasta, cada (min), motivo }] */
function windowsFor(date, branches, holidays, settings) {
  const w = date.getDay();
  const iso = isoOf(date);
  const dias = branches.filter((b) => b.enabled).map((b) => b.schedule[w]).filter((d) => d.laborable);
  if (holidays.some((h) => h.fecha === iso) || !dias.length) {
    return [{ desde: '08:00', hasta: '16:00', cada: 60, motivo: 'Día de descanso: solo vigilancia o tiempo extra' }];
  }
  const E = Math.min(...dias.map((d) => toMin(d.entrada)));
  const S = Math.max(...dias.map((d) => toMin(d.salida)));
  const fixed = [{ a: E - 30, b: E + 60, cada: 5, motivo: 'Hora de entrada' }];
  if (dias.some(hasLunch)) {
    const c = toMin(settings.comida_desde || '14:00');
    fixed.push({ a: c, b: c + settings.comida_min + settings.comida_tolerancia_min + 30, cada: 10, motivo: 'Hora de comida' });
  }
  fixed.push({ a: S - 30, b: S + 60, cada: 5, motivo: 'Hora de salida' });
  fixed.sort((x, y) => x.a - y.a);

  // Los huecos entre ventanas se cubren con una consulta cada 30 min.
  const out = [];
  let cursor = fixed[0].a;
  for (const f of fixed) {
    if (f.a > cursor) out.push({ a: cursor, b: f.a, cada: 30, motivo: 'Durante la jornada' });
    const a = Math.max(f.a, cursor);
    if (f.b > a) out.push({ ...f, a });
    cursor = Math.max(cursor, f.b);
  }
  return out
    .map((x) => ({ desde: hhmm(Math.max(0, x.a)), hasta: hhmm(Math.min(23 * 60 + 59, x.b)), cada: x.cada, motivo: x.motivo }))
    .filter((x) => x.desde < x.hasta);
}

function currentWindow(now, branches, holidays, settings) {
  const m = now.getHours() * 60 + now.getMinutes();
  return windowsFor(now, branches, holidays, settings).find((x) => m >= toMin(x.desde) && m < toMin(x.hasta)) || null;
}

// Próxima vez que se reanuda (hoy más tarde o algún día siguiente).
function nextStart(now, branches, holidays, settings) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const m = i === 0 ? now.getHours() * 60 + now.getMinutes() : -1;
    const w = windowsFor(d, branches, holidays, settings).find((x) => toMin(x.desde) > m);
    if (w) return { dia: i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${DIAS[d.getDay()]}`, hora: w.desde };
  }
  return null;
}

// Plan semanal para mostrarlo en Configuración (lunes a domingo).
function weekPlan(now, branches, holidays, settings) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return [...Array(7)].map((_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return { dia: DIAS[d.getDay()], fecha: isoOf(d), ventanas: windowsFor(d, branches, holidays, settings) };
  });
}

/**
 * Programador: revisa cada minuto si toca consultar. Solo consulta si alguien
 * tiene el sistema abierto (aviso en los últimos minutos) y si está dentro de
 * una ventana; respeta la frecuencia de esa ventana.
 */
function createLive({ db, syncToday, viewerTimeoutMin = 10 }) {
  const state = { lastRun: null, lastOk: null, version: 0, running: false, lastViewer: 0, lastErrors: [] };

  async function tick(now = new Date()) {
    const settings = db.getSettings();
    if (!settings.auto_sync || !settings.mysql_host || state.running) return;
    if (Date.now() - state.lastViewer > viewerTimeoutMin * 60000) return;
    const win = currentWindow(now, db.branches(), db.holidays(), settings);
    if (!win) return;
    if (state.lastRun && now - state.lastRun < win.cada * 60000 - 5000) return;
    state.running = true;
    state.lastRun = now;
    try {
      const results = await syncToday();
      state.lastErrors = results.filter((r) => !r.ok).map((r) => `${r.sucursal}: ${r.error}`);
      if (results.some((r) => r.ok)) state.lastOk = new Date();
      if (results.some((r) => r.nuevos > 0)) state.version++;
    } catch (e) {
      state.lastErrors = [e.message];
    } finally {
      state.running = false;
    }
  }

  function status(now = new Date()) {
    state.lastViewer = Date.now();
    const settings = db.getSettings();
    const branches = db.branches();
    const holidays = db.holidays();
    const win = currentWindow(now, branches, holidays, settings);
    const hora = (d) => (d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null);
    return {
      habilitado: !!settings.auto_sync,
      configurado: !!settings.mysql_host,
      activo: !!(settings.auto_sync && settings.mysql_host && win),
      ventana: win,
      reanuda: win ? null : nextStart(now, branches, holidays, settings),
      ultima: hora(state.lastOk),
      version: state.version,
      errores: state.lastErrors,
      hoy: windowsFor(now, branches, holidays, settings),
    };
  }

  const timer = setInterval(() => tick().catch(() => {}), 60000);
  timer.unref?.();
  return { tick, status, state };
}

module.exports = { windowsFor, currentWindow, nextStart, weekPlan, createLive };
