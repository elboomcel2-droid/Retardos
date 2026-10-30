// Motor de cálculo: convierte los marcajes crudos en un registro diario por
// empleado (entrada, salida, retardo, falta, incidencias) y en resúmenes.
// Es una función pura: misma entrada => mismo resultado, para que cualquier
// cifra se pueda reproducir y verificar contra los marcajes originales.

// Incidencias que se cuentan en los resúmenes (el texto es el que ve el usuario).
const INC = {
  SIN_ENTRADA: 'Sin checada de entrada',
  SIN_SALIDA: 'Sin checada de salida',
  SIN_COMIDA: 'No checó la salida ni el regreso de comer',
  COMIDA_INCOMPLETA: 'Le falta una checada de la comida',
};

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const ESTADOS = {
  PUNTUAL: 'PUNTUAL',
  RETARDO: 'RETARDO',
  FALTA: 'FALTA',
  INCOMPLETO: 'INCOMPLETO',
  JUSTIFICADO: 'JUSTIFICADO',
  DESCANSO: 'DESCANSO',
  EXTRA: 'DÍA EXTRA',
  FESTIVO: 'FESTIVO',
  SIN_DATOS: 'SIN DATOS',
  PENDIENTE: 'PENDIENTE',
};

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// "HH:MM" o "HH:MM:SS" -> minutos desde medianoche
function toMin(hhmm) {
  const [h, m, s] = hhmm.split(':').map(Number);
  return h * 60 + m + (s || 0) / 60;
}

function fmtMin(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}`;
}

// "08:30" + 10 -> "08:40"
function plusMin(hhmm, n) {
  const m = Math.round(toMin(hhmm) + n);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const hm = (t) => t.slice(0, 5);

// Minutos de retardo: desde la hora de entrada (8:41 → 11 min) o, si así se
// configura, desde que termina la tolerancia (8:41 con 10 min → 1 min).
function lateMinutes(diff, tolerance, settings) {
  return Math.floor(settings.retardo_desde === 'tolerancia' ? diff - tolerance : diff);
}
const desdeTxt = (hora, tolerance, settings) =>
  ` (contados desde las ${settings.retardo_desde === 'tolerancia' ? plusMin(hora, tolerance) : hora})`;

// En el checador los nombres se abrevian (con nombres largos salen símbolos
// raros). Con 4 letras o menos, o sin nombre, falta registrar el completo.
function isShortName(e) {
  const full = `${e.first_name || ''} ${e.last_name || ''}`.trim();
  const letters = full.replace(/[^\p{L}]/gu, '').length;
  const words = full.split(/\s+/).filter(Boolean).length;
  return letters <= 4 || words < 2;
}

function fullName(e) {
  return (e.alias || '').trim() || `${e.first_name || ''} ${e.last_name || ''}`.trim() || `Empleado ${e.emp_code}`;
}

/**
 * @param {object} p
 * @param {string} p.from  fecha inicial YYYY-MM-DD
 * @param {string} p.to    fecha final YYYY-MM-DD
 * @param {string} p.today fecha de hoy YYYY-MM-DD (los días futuros no se evalúan)
 * @param {object[]} p.branches  sucursales a evaluar (con schedule y tolerancia_min)
 * @param {object[]} [p.allBranches] todas las sucursales (para nombrar dónde checó
 *   alguien que fue a otra sucursal); por omisión, p.branches
 * @param {object} p.settings
 * @param {object[]} p.employees
 * @param {object[]} p.punches   marcajes desde (from - dias_contexto) hasta to; pueden
 *   incluir otras sucursales: cuentan para las personas vinculadas (employee.principal)
 * @param {object[]} p.holidays
 * @param {object[]} p.justifications
 */
function compute(p) {
  const { from, to, today, settings } = p;
  const evalTo = to < today ? to : today;
  const holidays = new Map(p.holidays.map((h) => [h.fecha, h.descripcion]));
  const justif = new Map(p.justifications.map((j) => [`${j.branch_id}|${j.emp_code}|${j.fecha}`, j]));
  const empInfo = new Map(p.employees.map((e) => [`${e.branch_id}|${e.emp_code}`, e]));
  const branchById = new Map((p.allBranches || p.branches).map((b) => [b.id, b]));
  for (const b of p.branches) branchById.set(b.id, b);

  // La misma persona puede tener número en varias sucursales (va a entregar,
  // la mandan unos días a otra sucursal, la cambian). Sus registros se unen al
  // principal: todas sus checadas cuentan como de una sola persona.
  const ownerOf = (key) => {
    const pr = empInfo.get(key)?.principal;
    return pr && pr !== key && empInfo.has(pr) && !empInfo.get(pr).principal ? pr : key;
  };

  // Días en que el checador de cada sucursal registró al menos un marcaje.
  const activeDays = new Map();
  // Marcajes agrupados por persona (registro principal) y día.
  const byOwner = new Map();
  for (const x of p.punches) {
    const day = x.punch_time.slice(0, 10);
    if (!activeDays.has(x.branch_id)) activeDays.set(x.branch_id, new Set());
    activeDays.get(x.branch_id).add(day);
    const owner = ownerOf(`${x.branch_id}|${x.emp_code}`);
    if (!byOwner.has(owner)) byOwner.set(owner, new Map());
    const byDay = byOwner.get(owner);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ t: x.punch_time, branch_id: x.branch_id });
  }
  // Registros vinculados a cada principal.
  const groups = new Map();
  for (const e of p.employees) {
    const key = `${e.branch_id}|${e.emp_code}`;
    const owner = ownerOf(key);
    if (owner === key) continue;
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(e);
  }

  const days = [];
  const ausentes = [];
  const sinNombre = [];
  const vinculos = [];
  const workdays = (week, a, b) => eachDay(a, b).filter((d) => week[weekday(d)].laborable && !holidays.has(d)).length;

  for (const branch of p.branches) {
    const tolerance = branch.tolerancia_min ?? settings.tolerancia_min;
    const branchActiveDays = activeDays.get(branch.id) || new Set();

    // Personas a evaluar: solo quienes checaron en el periodo o en los días de
    // contexto previos. El checador conserva a mucha gente que ya no trabaja
    // (siguen "activos" allá), así que estar registrado no basta.
    const prefix = `${branch.id}|`;
    const codes = [...byOwner.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));

    for (const code of codes) {
      const ownerKey = prefix + code;
      const info = empInfo.get(ownerKey) || { emp_code: code, activo: true };
      const byDay = byOwner.get(ownerKey);
      const linked = groups.get(ownerKey) || [];
      // Justificaciones capturadas con cualquiera de sus números (por si cambió el principal).
      const keys = [ownerKey, ...linked.map((e) => `${e.branch_id}|${e.emp_code}`)];
      const justFor = (fecha) => keys.map((k) => justif.get(`${k}|${fecha}`)).find(Boolean);
      const punchedInRange = [...byDay.keys()].some((d) => d >= from && d <= to);
      if (info.excluir) continue;
      if (!info.activo && !punchedInRange) continue;

      const firstSeen = [...byDay.keys()].sort()[0];
      let start = info.fecha_alta || firstSeen || from;
      if (start < from) start = from;
      let end = info.fecha_baja && info.fecha_baja < to ? info.fecha_baja : to;
      if (!info.activo && !info.fecha_baja) {
        // Baja sin fecha: solo se evalúan los días en que sí checó.
        const lastSeen = [...byDay.keys()].sort().pop();
        if (lastSeen && lastSeen < end) end = lastSeen;
      }

      const week = info.schedule || branch.schedule;
      const name = fullName({ ...info, emp_code: code });
      const lastPunch = [...byDay.keys()].filter((d) => d <= to).sort().pop() || null;
      if (info.activo && !info.fecha_baja && lastPunch) {
        const ausente = {
          branch_id: branch.id,
          sucursal: `${branch.code} ${branch.name}`,
          emp_code: code,
          nombre: name,
          ultima: lastPunch,
          dias: workdays(week, addDays(lastPunch, 1), evalTo),
          excluido: false,
        };
        // No checó en todo el periodo y ya llevaba varios días sin venir antes
        // de que empezara: probablemente ya no trabaja aquí. No se le cuentan
        // faltas, pero se avisa para que lo confirmen.
        if (!punchedInRange && workdays(week, addDays(lastPunch, 1), addDays(from, -1)) >= settings.dias_sin_checar) {
          ausentes.push({ ...ausente, excluido: true });
          continue;
        }
        if (ausente.dias >= settings.dias_sin_checar) ausentes.push(ausente);
      }
      if (linked.length) {
        vinculos.push({
          branch_id: branch.id,
          emp_code: code,
          otros: linked.map((e) => ({
            branch_id: e.branch_id,
            emp_code: e.emp_code,
            sucursal: branchLabel(branchById.get(e.branch_id)),
            checador: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
          })),
        });
      }
      const nombreIncompleto = !(info.alias || '').trim() && isShortName(info);
      if (nombreIncompleto) {
        sinNombre.push({ branch_id: branch.id, sucursal: `${branch.code} ${branch.name}`, emp_code: code, nombre: name });
      }

      for (const fecha of eachDay(from, to)) {
        const dayPunches = (byDay.get(fecha) || []).slice().sort((a, b) => a.t.localeCompare(b.t));
        const raw = dayPunches.map((x) => x.t);
        // Sucursal de cada checada cuando no fue en la suya.
        const lugares = dayPunches.map((x) => (x.branch_id === branch.id ? null : branchLabel(branchById.get(x.branch_id))));
        const outsideEmployment = fecha < start || fecha > end;
        if (outsideEmployment && raw.length === 0) continue;

        days.push(
          evaluateDay({
            fecha,
            branch,
            code,
            name,
            sched: week[weekday(fecha)],
            raw,
            lugares,
            tolerance,
            settings,
            holiday: holidays.get(fecha),
            justification: justFor(fecha),
            future: fecha > evalTo,
            isToday: fecha === today,
            branchHasData: branchActiveDays.has(fecha),
            nombreIncompleto,
          })
        );
      }
    }
  }

  sortDays(days);
  ausentes.sort((a, b) => b.dias - a.dias);
  sinNombre.sort((a, b) => a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre, 'es'));
  return { days, ...summaries(days, settings), ausentes, sinNombre, vinculos };
}

const branchLabel = (b) => (b ? `${b.code} ${b.name}` : 'otra sucursal');

function sortDays(days) {
  return days.sort(
    (a, b) =>
      a.sucursal_code.localeCompare(b.sucursal_code) ||
      a.nombre.localeCompare(b.nombre, 'es') ||
      a.emp_code.localeCompare(b.emp_code) ||
      a.fecha.localeCompare(b.fecha)
  );
}

// Resúmenes por persona y por sucursal a partir de los días ya evaluados
// (también se usa para armar periodos que incluyen quincenas cerradas).
function summaries(days, settings) {
  const employees = summarize(days, settings, (d) => `${d.branch_id}|${d.emp_code}`, true);
  const branches = summarize(days, settings, (d) => d.branch_id, false);
  for (const b of branches) {
    b.faltas_por_retardos = employees
      .filter((e) => e.branch_id === b.branch_id)
      .reduce((n, e) => n + (e.faltas_por_retardos || 0), 0);
  }
  return { employees, branches };
}

function evaluateDay(c) {
  const { fecha, branch, sched, raw, tolerance, settings } = c;
  const notas = [];

  // 1. Checadas repetidas: si vuelve a checar dentro del lapso configurado
  // (contado desde la primera checada válida), solo vale la primera.
  // Ej. con 10 min: 08:35, 08:37 y 08:44 → solo cuenta 08:35.
  const kept = [];
  const duplicadas = [];
  const lugares = c.lugares || [];
  for (const t of raw) {
    const last = kept[kept.length - 1];
    if (last && toMin(t.slice(11)) - toMin(last.slice(11)) < settings.duplicado_min) duplicadas.push(t);
    else kept.push(t);
  }
  if (duplicadas.length) {
    notas.push(
      `Volvió a checar ${duplicadas.length} vez/veces a menos de ${settings.duplicado_min} min de la anterior; solo se tomó la primera`
    );
  }

  const row = {
    fecha,
    dia: DIAS[weekday(fecha)],
    branch_id: branch.id,
    sucursal_code: branch.code,
    sucursal: `${branch.code} ${branch.name}`,
    emp_code: c.code,
    nombre: c.name,
    nombre_incompleto: !!c.nombreIncompleto,
    horario: sched.laborable ? `${sched.entrada}–${sched.salida}` : 'Descanso',
    tolerancia_min: tolerance,
    checadas: raw.map((t) => t.slice(11, 19)),
    // Sucursal de cada checada (null = en la suya). Solo se llena si checó en otra.
    checadas_lugar: lugares.some(Boolean) ? lugares : null,
    duplicadas: duplicadas.map((t) => t.slice(11, 19)),
    entrada: null,
    comida_salida: null,
    comida_regreso: null,
    salida: null,
    retardo_min: 0,
    retardo_grave: false,
    comida_temprano: false,
    comida_min: null,
    exceso_comida_min: 0,
    tiempo_extra_min: 0,
    minutos: null,
    salida_anticipada_min: 0,
    horas: null,
    estado: null,
    estado_original: null,
    incidencias: [],
    regla: '',
    notas,
    justificacion: null,
  };

  const otras = [...new Set(lugares.filter((l, i) => l && !duplicadas.includes(raw[i])))];
  if (otras.length) notas.push(`Checó en ${otras.join(' y ')}`);

  // 2. Identificar las 4 checadas: entrada, salida a comer, regreso de comer
  // y salida. Si faltan algunas, se deduce cuáles por la hora.
  const T = kept.map((t) => t.slice(11, 19));
  const n = T.length;
  const tieneComida = sched.comida ?? toMin(sched.salida) - toMin(sched.entrada) > 7 * 60;
  const cercaDeSalida = (t) => toMin(t) >= toMin(sched.salida) - settings.cerca_salida_min;
  if (n >= 4) {
    [row.entrada, row.comida_salida, row.comida_regreso, row.salida] = [T[0], T[1], T[n - 2], T[n - 1]];
    if (n > 4) notas.push(`${n - 4} checada(s) de más a media jornada (se tomaron la primera y la última como comida)`);
  } else if (n === 3) {
    if (cercaDeSalida(T[2])) {
      [row.entrada, row.salida] = [T[0], T[2]];
      row.comida_salida = T[1];
      row.incidencias.push(INC.COMIDA_INCOMPLETA);
    } else {
      [row.entrada, row.comida_salida, row.comida_regreso] = T;
      row.incidencias.push(INC.SIN_SALIDA);
    }
  } else if (n === 2) {
    [row.entrada, row.salida] = T;
    if (tieneComida && sched.laborable && toMin(T[1]) >= toMin(settings.comida_desde || '00:00')) row.incidencias.push(INC.SIN_COMIDA);
  } else if (n === 1) {
    const t = kept[0].slice(11, 19);
    // Una sola checada: se asigna a la entrada o a la salida según a cuál
    // horario esté más cerca.
    const closerToExit =
      sched.laborable && Math.abs(toMin(t) - toMin(sched.salida)) < Math.abs(toMin(t) - toMin(sched.entrada));
    if (closerToExit) {
      row.salida = t;
      row.incidencias.push(INC.SIN_ENTRADA);
    } else {
      row.entrada = t;
      row.incidencias.push(INC.SIN_SALIDA);
    }
  }

  // La comida es después de cierta hora (ej. 14:00 de lunes a viernes).
  if (row.comida_salida && tieneComida && sched.laborable && settings.comida_desde && row.comida_salida.slice(0, 5) < settings.comida_desde) {
    row.comida_temprano = true;
    row.incidencias.push(`Salió a comer a las ${hm(row.comida_salida)}, antes de las ${settings.comida_desde}`);
  }

  // Tiempo de comida y horas trabajadas (sin contar la comida).
  if (row.comida_salida && row.comida_regreso) {
    row.comida_min = Math.round(toMin(row.comida_regreso) - toMin(row.comida_salida));
    if (row.comida_min > settings.comida_min + settings.comida_tolerancia_min) {
      row.exceso_comida_min = row.comida_min - settings.comida_min;
      row.incidencias.push(`Tardó ${row.comida_min} min en comer (tiene ${settings.comida_min} min): ${row.exceso_comida_min} min de más`);
    }
  }
  if (row.entrada && row.salida) {
    row.minutos = Math.round(toMin(row.salida) - toMin(row.entrada) - (row.comida_min || 0));
    row.horas = fmtMin(row.minutos);
  }

  // 3. Clasificar el día.
  if (c.holiday) {
    row.estado = ESTADOS.FESTIVO;
    row.regla = `Día festivo: ${c.holiday}`;
    if (kept.length) notas.push('Laboró en día festivo');
  } else if (!sched.laborable && kept.length) {
    // Domingos: vigilancia, guardias o tiempo extra. No se evalúa puntualidad.
    row.estado = ESTADOS.EXTRA;
    row.regla = `Trabajó en su día de descanso (${DIAS[weekday(fecha)].toLowerCase()}): guardia o tiempo extra. Verifique que esté autorizado.`;
    if (row.minutos == null) row.incidencias.push('Solo checó una vez: no se pueden calcular las horas');
  } else if (!sched.laborable) {
    row.estado = ESTADOS.DESCANSO;
    row.regla = 'Día de descanso según horario';
  } else if (c.future) {
    row.estado = ESTADOS.PENDIENTE;
    row.regla = 'Este día todavía no llega';
  } else if (kept.length === 0) {
    if (c.isToday) {
      row.estado = ESTADOS.PENDIENTE;
      row.regla = 'Hoy todavía no ha checado';
    } else if (!c.branchHasData) {
      row.estado = ESTADOS.SIN_DATOS;
      row.regla = 'Nadie checó en esta sucursal ese día. Puede que el checador estuviera apagado o que falte actualizar las checadas. No se cuenta como falta.';
    } else {
      row.estado = ESTADOS.FALTA;
      row.regla = 'No checó en todo el día';
    }
  } else if (!row.entrada) {
    row.estado = ESTADOS.INCOMPLETO;
    row.regla = `Solo checó la salida (${hm(row.salida)}); no se sabe a qué hora llegó`;
  } else {
    const diff = toMin(row.entrada) - toMin(sched.entrada);
    if (diff > tolerance) {
      row.estado = ESTADOS.RETARDO;
      row.retardo_min = lateMinutes(diff, tolerance, settings);
      row.regla = `Llegó a las ${hm(row.entrada)}. Entra a las ${sched.entrada} y tenía hasta las ${plusMin(sched.entrada, tolerance)}: ${row.retardo_min} min de retardo${desdeTxt(sched.entrada, tolerance, settings)}`;
      if (settings.retardo_falta_min > 0 && row.retardo_min > settings.retardo_falta_min) {
        row.retardo_grave = true;
        row.incidencias.push(`Llegó más de ${settings.retardo_falta_min} min tarde: cuenta como falta`);
      }
    } else {
      row.estado = ESTADOS.PUNTUAL;
      row.regla = `Llegó a las ${hm(row.entrada)}. Entra a las ${sched.entrada} y tenía hasta las ${plusMin(sched.entrada, tolerance)}`;
    }
    if (row.salida) {
      const early = toMin(sched.salida) - toMin(row.salida);
      if (early > settings.salida_anticipada_min) {
        row.salida_anticipada_min = Math.floor(early);
        row.incidencias.push(`Se fue ${row.salida_anticipada_min} min antes de las ${sched.salida}`);
      }
      const later = toMin(row.salida) - toMin(sched.salida);
      if (settings.extra_min > 0 && later >= settings.extra_min) {
        row.tiempo_extra_min = Math.floor(later);
        notas.push(`Se quedó ${row.tiempo_extra_min} min después de su hora de salida`);
      }
    }
  }

  // 4. Justificación o nota capturada en el sistema.
  const j = c.justification;
  if (j && ![ESTADOS.DESCANSO, ESTADOS.EXTRA, ESTADOS.FESTIVO, ESTADOS.PENDIENTE].includes(row.estado)) {
    row.justificacion = {
      id: j.id,
      tipo: j.tipo,
      nota: j.nota,
      autor: j.autor,
      creado: j.creado,
      justificado: j.justificado !== 0,
      hora_permiso: j.hora_permiso || null,
    };
    if (!row.justificacion.justificado) {
      // "No justificado": se queda como retardo/falta; la nota del porqué viaja
      // en row.justificacion.
    } else if (j.hora_permiso && row.estado === ESTADOS.RETARDO) {
      // Permiso para llegar a cierta hora: si llegó después, sigue siendo retardo
      // contado desde la hora del permiso.
      const diff = toMin(row.entrada) - toMin(j.hora_permiso);
      if (diff > tolerance) {
        row.retardo_min = lateMinutes(diff, tolerance, settings);
        row.retardo_grave = settings.retardo_falta_min > 0 && row.retardo_min > settings.retardo_falta_min;
        row.incidencias = row.incidencias.filter((i) => !i.includes('cuenta como falta'));
        if (row.retardo_grave) row.incidencias.push(`Llegó más de ${settings.retardo_falta_min} min tarde: cuenta como falta`);
        row.regla =`Tenía permiso para llegar a las ${j.hora_permiso} (hasta las ${plusMin(j.hora_permiso, tolerance)} con tolerancia) y llegó a las ${hm(row.entrada)}: ${row.retardo_min} min de retardo${desdeTxt(j.hora_permiso, tolerance, settings)}`;
      } else {
        row.estado_original = row.estado;
        row.estado = ESTADOS.JUSTIFICADO;
        row.retardo_min = 0;
        row.retardo_grave = false;
        row.incidencias = row.incidencias.filter((i) => !i.includes('cuenta como falta'));
        row.regla = `Tenía permiso para llegar a las ${j.hora_permiso} y llegó a las ${hm(row.entrada)}`;
      }
    } else if (row.estado === ESTADOS.PUNTUAL) {
      // Llegó a tiempo: la justificación cubre sus incidencias (comida larga,
      // salió antes...) sin quitarle la puntualidad.
      row.incidencias_justificadas = true;
    } else {
      row.estado_original = row.estado;
      row.estado = ESTADOS.JUSTIFICADO;
    }
  }

  return row;
}

function emptyTotals() {
  return {
    dias_laborables: 0,
    asistencias: 0,
    puntuales: 0,
    retardos: 0,
    minutos_retardo: 0,
    faltas: 0,
    incompletos: 0,
    sin_salida: 0,
    salidas_anticipadas: 0,
    justificados: 0,
    sin_datos: 0,
    festivos_laborados: 0,
    dias_extra: 0,
    minutos_extra: 0,
    excesos_comida: 0,
    minutos_exceso_comida: 0,
    comida_sin_checar: 0,
    dias_tiempo_extra: 0,
    minutos_tiempo_extra: 0,
    retardos_graves: 0,
    comidas_antes: 0,
  };
}

function summarize(days, settings, keyOf, perEmployee) {
  const map = new Map();
  for (const d of days) {
    const k = keyOf(d);
    if (!map.has(k)) {
      map.set(k, {
        branch_id: d.branch_id,
        sucursal: d.sucursal,
        sucursal_code: d.sucursal_code,
        emp_code: d.emp_code,
        nombre: d.nombre,
        nombre_incompleto: d.nombre_incompleto,
        empleados: new Set(),
        ...emptyTotals(),
      });
    }
    const t = map.get(k);
    t.empleados.add(d.emp_code);
    const e = d.estado;
    const laborable = ![ESTADOS.DESCANSO, ESTADOS.EXTRA, ESTADOS.FESTIVO, ESTADOS.PENDIENTE, ESTADOS.SIN_DATOS].includes(e);
    if (laborable) t.dias_laborables++;
    if (e === ESTADOS.SIN_DATOS) t.sin_datos++;
    if (e === ESTADOS.PUNTUAL) t.puntuales++;
    if (e === ESTADOS.RETARDO) {
      t.retardos++;
      t.minutos_retardo += d.retardo_min;
    }
    if (e === ESTADOS.FALTA) t.faltas++;
    if (e === ESTADOS.INCOMPLETO) t.incompletos++;
    if (e === ESTADOS.JUSTIFICADO) t.justificados++;
    if ([ESTADOS.PUNTUAL, ESTADOS.RETARDO, ESTADOS.INCOMPLETO].includes(e)) t.asistencias++;
    if (e === ESTADOS.FESTIVO && d.checadas.length) t.festivos_laborados++;
    if (e === ESTADOS.EXTRA || (e === ESTADOS.FESTIVO && d.checadas.length)) {
      t.dias_extra++;
      t.minutos_extra += d.minutos || 0;
    }
    if (e === ESTADOS.JUSTIFICADO || d.incidencias_justificadas) continue;
    if (d.incidencias.includes(INC.SIN_SALIDA)) t.sin_salida++;
    if (d.salida_anticipada_min > 0) t.salidas_anticipadas++;
    if (d.retardo_grave) t.retardos_graves++;
    if (d.comida_temprano) t.comidas_antes++;
    if (d.exceso_comida_min > 0) {
      t.excesos_comida++;
      t.minutos_exceso_comida += d.exceso_comida_min;
    }
    if (d.incidencias.includes(INC.SIN_COMIDA) || d.incidencias.includes(INC.COMIDA_INCOMPLETA)) t.comida_sin_checar++;
    if (d.tiempo_extra_min > 0) {
      t.dias_tiempo_extra++;
      t.minutos_tiempo_extra += d.tiempo_extra_min;
    }
  }
  return [...map.values()]
    .map((t) => {
      const evaluables = t.puntuales + t.retardos;
      return {
        ...t,
        empleados: t.empleados.size,
        puntualidad: evaluables ? Math.round((t.puntuales / evaluables) * 1000) / 10 : null,
        asistencia: t.dias_laborables
          ? Math.round(((t.asistencias + t.justificados) / t.dias_laborables) * 1000) / 10
          : null,
        // Cada retardo grave es una falta; los demás se juntan (ej. 3 = 1 falta).
        faltas_por_retardos: perEmployee
          ? t.retardos_graves +
            (settings.retardos_por_falta > 0 ? Math.floor((t.retardos - t.retardos_graves) / settings.retardos_por_falta) : 0)
          : null,
      };
    })
    .sort((a, b) => a.sucursal_code.localeCompare(b.sucursal_code) || a.nombre.localeCompare(b.nombre, 'es'));
}

module.exports = { compute, evaluateDay, summaries, sortDays, addDays, eachDay, isShortName, ESTADOS, DIAS };
