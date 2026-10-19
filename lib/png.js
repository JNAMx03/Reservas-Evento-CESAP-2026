'use strict';
// Imagen PNG (blanco y negro) de un código QR, sin dependencias.
// Se usa como imagen dentro del correo. Devuelve Uint8Array.
(function () {
  const TABLA_CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLA_CRC[n] = c >>> 0;
  }
  function crc32(bytes, crc = 0) {
    crc = ~crc >>> 0;
    for (let i = 0; i < bytes.length; i++) crc = TABLA_CRC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return ~crc >>> 0;
  }

  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

  // Datos zlib con bloques "sin comprimir" (válido y suficiente para una imagen pequeña).
  function zlibSinComprimir(datos) {
    const salida = [0x78, 0x01];
    for (let i = 0; i < datos.length || i === 0; i += 65535) {
      const trozo = datos.subarray(i, i + 65535);
      const ultimo = i + 65535 >= datos.length;
      salida.push(ultimo ? 1 : 0, trozo.length & 255, trozo.length >>> 8, ~trozo.length & 255, (~trozo.length >>> 8) & 255);
      for (const b of trozo) salida.push(b);
      if (ultimo) break;
    }
    let a = 1, b = 0;
    for (const x of datos) { a = (a + x) % 65521; b = (b + a) % 65521; }
    salida.push(...u32(((b << 16) | a) >>> 0));
    return Uint8Array.from(salida);
  }

  function bloque(tipo, datos) {
    const tipoBytes = [...tipo].map(c => c.charCodeAt(0));
    const cuerpo = new Uint8Array(4 + datos.length);
    cuerpo.set(tipoBytes, 0);
    cuerpo.set(datos, 4);
    return [...u32(datos.length), ...cuerpo, ...u32(crc32(cuerpo))];
  }

  function pngQR(qr, escala = 8, margen = 4) {
    const lado = (qr.tamano + margen * 2) * escala;
    const bytesFila = Math.ceil(lado / 8);
    const crudo = new Uint8Array((bytesFila + 1) * lado); // 1 bit por pixel: 0 = negro, 1 = blanco
    for (let y = 0; y < lado; y++) {
      const inicio = y * (bytesFila + 1) + 1;
      const my = Math.floor(y / escala) - margen;
      for (let x = 0; x < bytesFila * 8; x++) {
        const mx = Math.floor(x / escala) - margen;
        const negro = x < lado && my >= 0 && my < qr.tamano && mx >= 0 && mx < qr.tamano && qr.modulos[my][mx];
        if (!negro) crudo[inicio + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    const ihdr = Uint8Array.from([...u32(lado), ...u32(lado), 1, 0, 0, 0, 0]);
    return Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      ...bloque('IHDR', ihdr),
      ...bloque('IDAT', zlibSinComprimir(crudo)),
      ...bloque('IEND', new Uint8Array(0)),
    ]);
  }

  const PNG = { pngQR, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = PNG;
  else window.PNG = PNG;
})();
