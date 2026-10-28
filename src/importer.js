// Importación de archivos exportados de las consultas SQL (CSV o Excel) para
// cuando no hay conexión directa al servidor de los checadores.
// Columnas reconocidas: tienda, emp_code, first_name, last_name, punch_time.
const ExcelJS = require('exceljs');

const ALIASES = {
  tienda: ['tienda', 'sucursal'],
  emp_code: ['emp_code', 'codigo', 'código', 'no_empleado', 'num_empleado', 'clave'],
  first_name: ['first_name', 'nombre', 'nombres'],
  last_name: ['last_name', 'apellido', 'apellidos'],
  punch_time: ['punch_time', 'fecha_hora', 'checada', 'marcaje', 'fecha y hora'],
};

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = [];
    for (let c = 1; c <= r.cellCount; c++) {
      let v = r.getCell(c).value;
      if (v && typeof v === 'object' && !(v instanceof Date)) v = v.text ?? v.result ?? String(v);
      vals.push(v ?? '');
    }
    rows.push(vals);
  });
  return rows;
}

const pad = (n) => String(n).padStart(2, '0');

// Acepta "2026-09-01 08:55:12", "01/09/2026 08:55", fechas de Excel, etc.
function parseTime(v) {
  if (v instanceof Date) {
    // Excel guarda la hora local "tal cual"; exceljs la entrega como UTC.
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(
      v.getUTCMinutes()
    )}:${pad(v.getUTCSeconds())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4])}:${m[5]}:${m[6] || '00'}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/i);
  if (m) {
    let h = Number(m[4]);
    const ampm = (m[7] || '').toLowerCase().replace(/[.\s]/g, '');
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    // Formato mexicano: día/mes/año
    return `${m[3]}-${pad(m[2])}-${pad(m[1])} ${pad(h)}:${m[5]}:${m[6] || '00'}`;
  }
  return null;
}

function matchBranch(branches, tienda) {
  const t = String(tienda || '').trim().toUpperCase();
  if (!t) return null;
  return (
    branches.find((b) => t === `${b.code} ${b.name}`.toUpperCase()) ||
    branches.find((b) => t.startsWith(b.code + ' ') || t === b.code) ||
    branches.find((b) => t.includes(b.name.toUpperCase())) ||
    null
  );
}

/**
 * Devuelve { byBranch: Map(branchId -> {employees, punches}), errores: [] }.
 * forcedBranch: si se indica, todas las filas se asignan a esa sucursal.
 */
async function parseFile(buffer, filename, branches, forcedBranch) {
  const rows = /\.xlsx$/i.test(filename) ? await parseXlsx(buffer) : parseCsv(buffer.toString('utf8'));
  if (!rows.length) throw new Error('El archivo está vacío.');

  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = {};
  for (const [key, names] of Object.entries(ALIASES)) col[key] = header.findIndex((h) => names.includes(h));
  if (col.emp_code < 0 || col.punch_time < 0) {
    throw new Error('El archivo no tiene el formato esperado: debe traer el número de empleado y la fecha y hora de cada checada.');
  }
  if (!forcedBranch && col.tienda < 0) {
    throw new Error('El archivo no dice de qué sucursal es: elija la sucursal antes de subirlo.');
  }

  const byBranch = new Map();
  const errores = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const branch = forcedBranch || matchBranch(branches, r[col.tienda]);
    if (!branch) {
      errores.push(`Renglón ${i + 1}: no se reconoce la sucursal "${r[col.tienda]}"`);
      continue;
    }
    const code = String(r[col.emp_code] ?? '').trim();
    const time = parseTime(r[col.punch_time]);
    if (!code || !time) {
      errores.push(`Renglón ${i + 1}: falta el número de empleado o la fecha y hora`);
      continue;
    }
    if (!byBranch.has(branch.id)) byBranch.set(branch.id, { employees: new Map(), punches: [] });
    const g = byBranch.get(branch.id);
    g.punches.push({ emp_code: code, punch_time: time });
    if (!g.employees.has(code)) {
      g.employees.set(code, {
        emp_code: code,
        first_name: col.first_name >= 0 ? String(r[col.first_name] ?? '').trim() : '',
        last_name: col.last_name >= 0 ? String(r[col.last_name] ?? '').trim() : '',
      });
    }
  }
  return { byBranch, errores, filas: rows.length - 1 };
}

module.exports = { parseFile, parseCsv, parseTime, matchBranch };
