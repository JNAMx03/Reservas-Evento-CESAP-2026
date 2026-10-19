'use strict';
// Respaldos automáticos de la base de datos, fuera de la carpeta del sistema.
//
//   <carpeta>\frecuentes\reservas_AAAA-MM-DD_HH-MM.db   cada 15 min si hubo cambios (últimas 24 h)
//   <carpeta>\diarios\reservas_AAAA-MM-DD.db            la última copia de cada día (se guardan todas)
//
// La carpeta se configura en config.json → "respaldos": { "carpeta": "..." }.
// Si no está disponible, se guarda en data\respaldos y se avisa en la ventana.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');
const { carpetaRespaldos: carpetaConfigurada, CARPETA_LOCAL } = require('./carpetas');

const MINUTOS = 15;
const FRECUENTES_A_GUARDAR = (24 * 60) / MINUTOS; // 24 horas

const dos = n => String(n).padStart(2, '0');
function marcas() {
  const d = new Date();
  const dia = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  return { dia, momento: `${dia}_${dos(d.getHours())}-${dos(d.getMinutes())}` };
}

// Abre la copia y revisa que no esté dañada.
function verificar(archivo) {
  const copia = new DatabaseSync(archivo);
  try {
    const r = copia.prepare('PRAGMA quick_check').get();
    const resultado = Object.values(r)[0];
    if (resultado !== 'ok') throw new Error(`la copia quedó dañada (${resultado})`);
  } finally {
    copia.close();
  }
}

function respaldarEn(raiz, motivo) {
  const { dia, momento } = marcas();
  const dirFrecuentes = path.join(raiz, 'frecuentes');
  const dirDiarios = path.join(raiz, 'diarios');
  fs.mkdirSync(dirFrecuentes, { recursive: true });
  fs.mkdirSync(dirDiarios, { recursive: true });

  const archivo = path.join(dirFrecuentes, `reservas_${momento}${motivo === 'inicio' ? '_inicio' : ''}.db`);
  if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
  db.copiarBaseA(archivo);
  verificar(archivo);
  // La copia del día se reemplaza por la más reciente.
  fs.copyFileSync(archivo, path.join(dirDiarios, `reservas_${dia}.db`));

  const viejos = fs.readdirSync(dirFrecuentes).filter(f => f.endsWith('.db')).sort().reverse().slice(FRECUENTES_A_GUARDAR);
  for (const f of viejos) fs.unlinkSync(path.join(dirFrecuentes, f));
  return archivo;
}

// motivo: 'inicio' | 'programado' | 'cierre'
function respaldar(motivo = 'programado') {
  if (motivo === 'programado' && !db.hayCambios()) return null;
  const carpeta = carpetaConfigurada();
  try {
    const archivo = respaldarEn(carpeta, motivo);
    db.cambiosRespaldados();
    console.log(`[respaldo] ${archivo}`);
    return archivo;
  } catch (err) {
    console.error(`[respaldo] No se pudo guardar en "${carpeta}": ${err.message}`);
    try {
      const archivo = respaldarEn(CARPETA_LOCAL, motivo);
      db.cambiosRespaldados();
      console.error(`[respaldo] Se guardó en la carpeta local mientras tanto: ${archivo}`);
      return archivo;
    } catch (err2) {
      console.error(`[respaldo] Tampoco se pudo guardar en la carpeta local: ${err2.message}`);
      return null;
    }
  }
}

function iniciar() {
  respaldar('inicio');
  setInterval(() => respaldar('programado'), MINUTOS * 60_000);
}

module.exports = { iniciar, respaldar, carpetaConfigurada, CARPETA_LOCAL };
