'use strict';
// Exporta el historial de movimientos (control interno) a Excel.
// Solo se ejecuta en el servidor, con exportar-historial.bat. No existe en la página.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { execFile } = require('node:child_process');
const XLSX = require('./lib/xlsx.js');
const { carpetaRespaldos, CARPETA_LOCAL } = require('./lib/carpetas');

const ARCHIVO_BD = path.join(__dirname, 'data', 'reservas.db');
if (!fs.existsSync(ARCHIVO_BD)) {
  console.error('  No se encontró la base de datos (data\\reservas.db).');
  process.exit(1);
}

// Solo lectura: se puede usar aunque el sistema esté abierto.
const bd = new DatabaseSync(ARCHIVO_BD, { readOnly: true });
const existe = bd.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'historial'").get();
const filas = existe ? bd.prepare('SELECT * FROM historial ORDER BY id DESC').all() : [];
bd.close();

const fecha = f => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)} ${f.slice(11, 19)}` : '');
const corto = (t, max = 32000) => (t && t.length > max ? `${t.slice(0, max)}…` : t || ''); // límite de una celda de Excel

// Resúmenes por equipo y por acción.
const porEquipo = new Map();
const porAccion = new Map();
for (const f of filas) {
  const e = porEquipo.get(f.ip) || { nombres: new Set(), total: 0, ultimo: f.fecha };
  if (f.registrado_por) e.nombres.add(f.registrado_por);
  e.total++;
  if (f.fecha > e.ultimo) e.ultimo = f.fecha;
  porEquipo.set(f.ip, e);
  porAccion.set(f.accion, (porAccion.get(f.accion) || 0) + 1);
}

const libro = XLSX.crear([
  {
    nombre: 'Historial',
    columnas: [
      { titulo: 'Fecha y hora', ancho: 19 }, { titulo: 'Equipo (IP)', ancho: 22 }, { titulo: 'Registrado por', ancho: 18 },
      { titulo: 'Acción', ancho: 24 }, { titulo: 'Palco', ancho: 8, tipo: 'numero' }, { titulo: 'Código', ancho: 11 },
      { titulo: 'Detalle', ancho: 60, tipo: 'largo' }, { titulo: 'Antes (datos completos)', ancho: 50, tipo: 'largo' },
      { titulo: 'Después (datos completos)', ancho: 50, tipo: 'largo' },
    ],
    filas: filas.map(f => [fecha(f.fecha), f.ip, f.registrado_por || '(sin nombre)', f.accion, f.palco ?? '', f.codigo,
      f.detalle, corto(f.antes), corto(f.despues)]),
  },
  {
    nombre: 'Por equipo',
    columnas: [
      { titulo: 'Equipo (IP)', ancho: 22 }, { titulo: 'Nombres usados en "Registrado por"', ancho: 40 },
      { titulo: 'Movimientos', ancho: 12, tipo: 'numero' }, { titulo: 'Último movimiento', ancho: 19 },
    ],
    totales: true,
    filas: [...porEquipo].sort((a, b) => b[1].total - a[1].total)
      .map(([ip, e]) => [ip, [...e.nombres].join(', ') || '(sin nombre)', e.total, fecha(e.ultimo)]),
  },
  {
    nombre: 'Por acción',
    columnas: [{ titulo: 'Acción', ancho: 30 }, { titulo: 'Movimientos', ancho: 12, tipo: 'numero' }],
    totales: true,
    filas: [...porAccion].sort((a, b) => b[1] - a[1]),
  },
]);

const d = new Date();
const dos = n => String(n).padStart(2, '0');
const nombre = `historial_${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}_${dos(d.getHours())}-${dos(d.getMinutes())}.xlsx`;

let destino;
for (const carpeta of [path.join(carpetaRespaldos(), 'historial'), path.join(CARPETA_LOCAL, 'historial')]) {
  try {
    fs.mkdirSync(carpeta, { recursive: true });
    destino = path.join(carpeta, nombre);
    fs.writeFileSync(destino, libro);
    break;
  } catch (err) {
    console.error(`  No se pudo guardar en ${carpeta}: ${err.message}`);
    destino = null;
  }
}
if (!destino) process.exit(1);

console.log(`  ${filas.length} movimiento(s) exportados.`);
console.log(`  Archivo: ${destino}`);
execFile('explorer.exe', [`/select,${destino}`], () => {});
