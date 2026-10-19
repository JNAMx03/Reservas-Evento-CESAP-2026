/*
 * Generador de códigos QR sin dependencias (modo byte UTF-8, corrección de errores nivel M,
 * versiones 1 a 10: hasta 213 bytes). Lo usan el navegador y el servidor.
 *
 *   const qr = QR.crear('texto');      → { tamano, modulos: boolean[][] }  (true = cuadro negro)
 *   QR.svg(qr, { margen: 4 })          → texto SVG
 */
(function () {
  // versión: [códigos de corrección por bloque, [[cantidad de bloques, datos por bloque], ...]]
  const BLOQUES = {
    1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
    6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]],
  };
  const ALINEACION = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  const NIVEL_M = 0; // bits de formato del nivel de corrección M

  // ── Aritmética en GF(256) y Reed-Solomon ──
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function generador(grado) {
    let g = [1];
    for (let i = 0; i < grado; i++) {
      const sig = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        sig[j] ^= g[j];
        sig[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = sig;
    }
    return g;
  }

  function correccion(datos, grado) {
    const g = generador(grado);
    const resto = new Array(grado).fill(0);
    for (const d of datos) {
      const factor = d ^ resto.shift();
      resto.push(0);
      for (let i = 0; i < grado; i++) resto[i] ^= mul(g[i + 1], factor);
    }
    return resto;
  }

  // ── Máscaras ──
  const MASCARAS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function crear(texto) {
    const bytes = new TextEncoder().encode(String(texto));

    // Versión más pequeña donde quepa el texto.
    let version = 0;
    for (let v = 1; v <= 10; v++) {
      const capacidad = BLOQUES[v][1].reduce((t, [b, d]) => t + b * d, 0);
      if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= capacidad * 8) { version = v; break; }
    }
    if (!version) throw new Error('El texto es demasiado largo para el código QR');
    const [largoEC, grupos] = BLOQUES[version];
    const capacidad = grupos.reduce((t, [b, d]) => t + b * d, 0);

    // Flujo de bits: modo byte, longitud, datos, terminador, relleno.
    const bits = [];
    const poner = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
    poner(0b0100, 4);
    poner(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) poner(b, 8);
    poner(0, Math.min(4, capacidad * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const palabras = [];
    for (let i = 0; i < bits.length; i += 8) palabras.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let relleno = 0xec; palabras.length < capacidad; relleno ^= 0xec ^ 0x11) palabras.push(relleno);

    // Bloques con su corrección, intercalados.
    const bloques = [];
    let k = 0;
    for (const [cantidad, largo] of grupos) {
      for (let i = 0; i < cantidad; i++) {
        const datos = palabras.slice(k, k + largo);
        k += largo;
        bloques.push({ datos, ec: correccion(datos, largoEC) });
      }
    }
    const final = [];
    const maxDatos = Math.max(...bloques.map(b => b.datos.length));
    for (let i = 0; i < maxDatos; i++) for (const b of bloques) if (i < b.datos.length) final.push(b.datos[i]);
    for (let i = 0; i < largoEC; i++) for (const b of bloques) final.push(b.ec[i]);

    // Matriz y patrones fijos.
    const n = version * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fijo = Array.from({ length: n }, () => new Array(n).fill(false));
    const fijar = (x, y, oscuro) => { m[y][x] = oscuro; fijo[y][x] = true; };

    const buscador = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          fijar(x, y, d !== 2 && d !== 4);
        }
      }
    };
    buscador(3, 3);
    buscador(n - 4, 3);
    buscador(3, n - 4);

    for (let i = 8; i < n - 8; i++) {
      fijar(6, i, i % 2 === 0);
      fijar(i, 6, i % 2 === 0);
    }

    const al = ALINEACION[version];
    const ultimo = al[al.length - 1];
    for (const ay of al) {
      for (const ax of al) {
        if ((ax === 6 && ay === 6) || (ax === 6 && ay === ultimo) || (ax === ultimo && ay === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) fijar(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    const formato = (matriz, mascara) => {
      const datos = (NIVEL_M << 3) | mascara;
      let resto = datos;
      for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
      const b = ((datos << 10) | resto) ^ 0x5412;
      const bit = i => ((b >>> i) & 1) === 1;
      const f = (x, y, v) => { matriz[y][x] = v; fijo[y][x] = true; };
      for (let i = 0; i <= 5; i++) f(8, i, bit(i));
      f(8, 7, bit(6));
      f(8, 8, bit(7));
      f(7, 8, bit(8));
      for (let i = 9; i < 15; i++) f(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) f(n - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) f(8, n - 15 + i, bit(i));
      f(8, n - 8, true); // módulo oscuro fijo
    };
    formato(m, 0); // reserva el área de formato

    if (version >= 7) {
      let resto = version;
      for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
      const b = (version << 12) | resto;
      for (let i = 0; i < 18; i++) {
        const v = ((b >>> i) & 1) === 1;
        const a = n - 11 + (i % 3), c = Math.floor(i / 3);
        fijar(a, c, v);
        fijar(c, a, v);
      }
    }

    // Datos en zigzag desde la esquina inferior derecha.
    let i = 0;
    for (let derecha = n - 1; derecha >= 1; derecha -= 2) {
      if (derecha === 6) derecha = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = derecha - j;
          const subiendo = ((derecha + 1) & 2) === 0;
          const y = subiendo ? n - 1 - vert : vert;
          if (!fijo[y][x] && i < final.length * 8) {
            m[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }

    // Se prueba cada máscara y se queda la de menor penalización.
    let mejor = null;
    for (let mascara = 0; mascara < 8; mascara++) {
      const copia = m.map(fila => fila.slice());
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fijo[y][x] && MASCARAS[mascara](x, y)) copia[y][x] = !copia[y][x];
      formato(copia, mascara);
      const p = penalizacion(copia);
      if (!mejor || p < mejor.p) mejor = { p, copia };
    }
    return { tamano: n, version, modulos: mejor.copia };
  }

  function penalizacion(m) {
    const n = m.length;
    let p = 0;
    // Regla 1: rachas de 5 o más del mismo color.
    for (let a = 0; a < n; a++) {
      for (const leer of [i => m[a][i], i => m[i][a]]) {
        let racha = 1;
        for (let i = 1; i <= n; i++) {
          if (i < n && leer(i) === leer(i - 1)) racha++;
          else { if (racha >= 5) p += 3 + racha - 5; racha = 1; }
        }
      }
    }
    // Regla 2: bloques de 2x2 del mismo color.
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
    }
    // Regla 3: patrones parecidos a los cuadros de las esquinas.
    const patron = [true, false, true, true, true, false, true, false, false, false, false];
    const inverso = patron.slice().reverse();
    for (let a = 0; a < n; a++) {
      for (let i = 0; i + 11 <= n; i++) {
        for (const leer of [j => m[a][j], j => m[j][a]]) {
          let p1 = true, p2 = true;
          for (let j = 0; j < 11; j++) {
            const v = leer(i + j);
            if (v !== patron[j]) p1 = false;
            if (v !== inverso[j]) p2 = false;
          }
          if (p1) p += 40;
          if (p2) p += 40;
        }
      }
    }
    // Regla 4: proporción de oscuros.
    let oscuros = 0;
    for (const fila of m) for (const v of fila) if (v) oscuros++;
    const total = n * n;
    p += Math.max(0, Math.ceil(Math.abs(oscuros * 20 - total * 10) / total) - 1) * 10;
    return p;
  }

  function svg(qr, { margen = 4, oscuro = '#000000', claro = '#ffffff' } = {}) {
    const lado = qr.tamano + margen * 2;
    let d = '';
    qr.modulos.forEach((fila, y) => fila.forEach((v, x) => { if (v) d += `M${x + margen} ${y + margen}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges">`
      + `<rect width="${lado}" height="${lado}" fill="${claro}"/><path d="${d}" fill="${oscuro}"/></svg>`;
  }

  const QR = { crear, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
  else window.QR = QR;
})();
