'use strict';
// Generador de PDF muy pequeño, sin dependencias: rectángulos, triángulos y texto
// (fuentes Helvetica incluidas en todos los lectores de PDF, con tildes y ñ).
// Coordenadas en puntos, con origen arriba a la izquierda (como en una página).
(function () {
  // Anchos de los caracteres ASCII 32..126 (en milésimas del tamaño de letra).
  const ANCHOS = {
    normal: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
    negrita: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
  };
  // Caracteres fuera de Latin-1 que sí existen en la codificación de Windows (WinAnsi).
  const WIN = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };

  function codigoWin(ch) {
    if (WIN[ch]) return WIN[ch];
    const c = ch.charCodeAt(0);
    return c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : 0x3f; // '?'
  }

  function anchoCaracter(ch, negrita) {
    const base = ch.normalize('NFD')[0];
    const c = base.charCodeAt(0);
    if (c >= 32 && c <= 126) return ANCHOS[negrita ? 'negrita' : 'normal'][c - 32];
    return ch === '·' ? 278 : 556;
  }

  const hex2 = n => n.toString(16).padStart(2, '0');
  const textoHex = s => `<${[...s].map(ch => hex2(codigoWin(ch))).join('')}>`;
  const color = (c = '#000000') => {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => (v / 255).toFixed(3)).join(' ');
  };
  const num = n => (Math.round(n * 100) / 100).toString();

  function crear({ ancho = 612, alto = 792, titulo = 'Documento' } = {}) {
    const ops = [];
    const Y = y => alto - y;

    const doc = {
      ancho,
      alto,
      medir(texto, tam, negrita = false) {
        return [...String(texto)].reduce((t, ch) => t + anchoCaracter(ch, negrita), 0) / 1000 * tam;
      },
      rect(x, y, w, h, { relleno, borde, grosor = 1 } = {}) {
        if (relleno) ops.push(`${color(relleno)} rg ${num(x)} ${num(Y(y + h))} ${num(w)} ${num(h)} re f`);
        if (borde) ops.push(`${grosor} w ${color(borde)} RG ${num(x)} ${num(Y(y + h))} ${num(w)} ${num(h)} re S`);
      },
      triangulo(x1, y1, x2, y2, x3, y3, relleno) {
        ops.push(`${color(relleno)} rg ${num(x1)} ${num(Y(y1))} m ${num(x2)} ${num(Y(y2))} l ${num(x3)} ${num(Y(y3))} l h f`);
      },
      // y = línea base del texto. alinear: 'izq' | 'centro' | 'der' respecto a x.
      texto(x, y, texto, { tam = 11, negrita = false, color: c = '#000000', alinear = 'izq', anchoMax } = {}) {
        let s = String(texto ?? '');
        if (anchoMax) while (s.length > 1 && doc.medir(s, tam, negrita) > anchoMax) s = s.slice(0, -2) + '…';
        const w = doc.medir(s, tam, negrita);
        const x0 = alinear === 'centro' ? x - w / 2 : alinear === 'der' ? x - w : x;
        ops.push(`BT /${negrita ? 'F2' : 'F1'} ${tam} Tf ${color(c)} rg 1 0 0 1 ${num(x0)} ${num(Y(y))} Tm ${textoHex(s)} Tj ET`);
      },
      // Código QR dibujado con cuadros (nítido a cualquier tamaño).
      qr(qr, x, y, lado) {
        const m = lado / qr.tamano;
        const partes = [];
        qr.modulos.forEach((fila, fy) => fila.forEach((v, fx) => {
          if (v) partes.push(`${num(x + fx * m)} ${num(Y(y + (fy + 1) * m))} ${num(m + 0.05)} ${num(m + 0.05)} re`);
        }));
        ops.push(`0 0 0 rg ${partes.join(' ')} f`);
      },
      bytes() {
        const contenido = ops.join('\n');
        const objetos = [
          '<< /Type /Catalog /Pages 2 0 R >>',
          '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ancho} ${alto}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
          `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
          `<< /Title ${textoHex(titulo)} /Producer (Reservas de Palcos) >>`,
        ];
        let salida = '%PDF-1.4\n';
        const posiciones = [];
        objetos.forEach((o, i) => {
          posiciones.push(salida.length);
          salida += `${i + 1} 0 obj\n${o}\nendobj\n`;
        });
        const inicioXref = salida.length;
        salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
        for (const p of posiciones) salida += `${String(p).padStart(10, '0')} 00000 n \n`;
        salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
        // Todo el contenido es ASCII (los textos van en hexadecimal).
        return Uint8Array.from(salida, ch => ch.charCodeAt(0));
      },
    };
    return doc;
  }

  const PDF = { crear };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDF;
  else window.PDF = PDF;
})();
