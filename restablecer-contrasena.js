'use strict';
// Devuelve la contraseña de un usuario a la de por defecto (por si alguien la olvida).
// Solo se ejecuta en el servidor, con restablecer-contrasena.bat. No existe en la página.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { DatabaseSync } = require('node:sqlite');
const CLAVES = require('./lib/claves');

const ARCHIVO_BD = path.join(__dirname, 'data', 'reservas.db');

async function principal() {
  if (!fs.existsSync(ARCHIVO_BD)) {
    console.error('  No se encontró la base de datos (data\\reservas.db).');
    return 1;
  }
  const bd = new DatabaseSync(ARCHIVO_BD);
  bd.exec('PRAGMA busy_timeout = 5000;');
  const hayTabla = bd.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'").get();
  if (!hayTabla) {
    console.error('  Esta base todavía no tiene usuarios. Inicia el sistema una vez (iniciar.bat) y vuelve a intentar.');
    bd.close();
    return 1;
  }

  const usuarios = bd.prepare('SELECT usuario, cambiada_en FROM usuarios ORDER BY usuario').all();
  console.log('  Usuarios:');
  for (const u of usuarios) {
    console.log(`    - ${u.usuario}${u.cambiada_en ? `  (contraseña cambiada el ${u.cambiada_en})` : '  (con la contraseña por defecto)'}`);
  }
  console.log('');

  const consola = readline.createInterface({ input: process.stdin });
  const lineas = consola[Symbol.asyncIterator]();
  const preguntar = async texto => {
    process.stdout.write(texto);
    const { value } = await lineas.next();
    return String(value ?? '').trim();
  };
  try {
    const escrito = await preguntar('  ¿Qué usuario quieres restablecer? ');
    const inicial = CLAVES.USUARIOS_INICIALES.find(u => u.usuario.toLowerCase() === escrito.toLowerCase());
    if (!escrito || !inicial || !usuarios.some(u => u.usuario.toLowerCase() === escrito.toLowerCase())) {
      console.log('\n  Ese usuario no existe. No se cambió nada.');
      return 1;
    }
    console.log(`\n  La contraseña de ${inicial.usuario} volverá a ser la de por defecto`);
    console.log('  y se cerrarán sus sesiones abiertas en todos los equipos.');
    const confirma = await preguntar('  Escribe SI para continuar: ');
    if (confirma !== 'SI') {
      console.log('\n  Cancelado. No se cambió nada.');
      return 0;
    }

    bd.exec('BEGIN IMMEDIATE');
    try {
      bd.prepare("UPDATE usuarios SET clave = ?, cambiada_en = '' WHERE usuario = ?").run(CLAVES.huella(inicial.clave), inicial.usuario);
      bd.prepare('DELETE FROM sesiones WHERE usuario = ?').run(inicial.usuario);
      bd.prepare('INSERT INTO historial (ip, usuario, registrado_por, accion, detalle) VALUES (?, ?, ?, ?, ?)')
        .run('servidor (script)', inicial.usuario, '', 'Restablecer contraseña',
          `Usuario ${inicial.usuario}: contraseña devuelta a la de por defecto con restablecer-contrasena.bat`);
      bd.exec('COMMIT');
    } catch (err) {
      bd.exec('ROLLBACK');
      throw err;
    }
    console.log(`\n  Listo. ${inicial.usuario} ya puede ingresar con la contraseña por defecto.`);
    console.log('  Recomendado: cambiarla después desde ⚙ Configuración en la página.');
    return 0;
  } finally {
    consola.close();
    bd.close();
  }
}

principal().then(codigo => { process.exitCode = codigo; }, err => {
  console.error(`  Error: ${err.message}`);
  process.exitCode = 1;
});
