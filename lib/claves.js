'use strict';
// Contraseñas: nunca se guardan en texto. Se guarda una huella (scrypt + sal aleatoria).
const crypto = require('node:crypto');

// Usuarios con los que arranca el sistema (y a los que vuelve restablecer-contrasena.bat).
const USUARIOS_INICIALES = [
  { usuario: 'CESAP', clave: 'Cesap2026*' },
  { usuario: 'CESNE', clave: 'Cesne2026*' },
];

const LARGO = 64;

function huella(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(clave), sal, LARGO);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}

// Compara en tiempo constante. Con huella vacía (usuario inexistente) igual calcula, para no dar pistas.
function coincide(clave, guardada) {
  const [tipo, sal, h] = String(guardada || '').split('$');
  const calculada = crypto.scryptSync(String(clave), Buffer.from(sal || '00', 'hex'), LARGO);
  if (tipo !== 'scrypt' || !h) return false;
  const esperada = Buffer.from(h, 'hex');
  return esperada.length === calculada.length && crypto.timingSafeEqual(esperada, calculada);
}

// Token de sesión aleatorio; en la base solo se guarda su resumen (sha256).
const nuevoToken = () => crypto.randomBytes(32).toString('hex');
const resumenToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { USUARIOS_INICIALES, huella, coincide, nuevoToken, resumenToken };
