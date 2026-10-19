'use strict';
// Carpeta de respaldos (y del historial exportado): config.json → "respaldos": { "carpeta": "..." }.
const fs = require('node:fs');
const path = require('node:path');

const CARPETA_PREDETERMINADA = 'D:\\sw\\BK\\AREA_DE_SERVICIOS\\EVENTOS\\GRAN FIESTA ANUAL AFILIADOS\\2026';
const CARPETA_LOCAL = path.join(__dirname, '..', 'data', 'respaldos');

function carpetaRespaldos() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8').replace(/^﻿/, ''));
    return c.respaldos?.carpeta || CARPETA_PREDETERMINADA;
  } catch {
    return CARPETA_PREDETERMINADA;
  }
}

module.exports = { carpetaRespaldos, CARPETA_LOCAL };
