'use strict';
// Libro de Excel (.xlsx) sin dependencias: varias hojas, encabezados con color,
// formato de pesos, totales, filtros y primera fila fija.
//
//   XLSX.crear([{ nombre, columnas: [{ titulo, ancho, tipo }], filas: [[...]], totales: true }])
//   tipo de columna: 'texto' | 'dinero' | 'numero' | 'largo' (texto con ajuste de línea)
//   Una celda también puede ser { v: valor, estilo: 'titulo' | 'negrita' | 'dinero' | 'dineroTotal' | 'total' }
(function () {
  const PNG = typeof module !== 'undefined' && module.exports ? require('./png.js') : window.PNG;

  // Índices de estilo (deben coincidir con <cellXfs> más abajo).
  const E = { normal: 0, encabezado: 1, dinero: 2, negrita: 3, dineroTotal: 4, total: 5, titulo: 6, numero: 7, largo: 8, numeroTotal: 9 };

  const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1B2330"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF8A96A8"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="3" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const xml = v => String(v ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function letra(i) { // 0 → A, 26 → AA
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  const ESTILO_COLUMNA = { texto: E.normal, dinero: E.dinero, numero: E.numero, largo: E.largo };

  function celda(ref, valor, estiloBase) {
    let v = valor, estilo = estiloBase;
    if (valor && typeof valor === 'object') {
      if (valor.estilo) estilo = E[valor.estilo];
      if (valor.formula) return `<c r="${ref}" s="${estilo}"><f>${xml(valor.formula)}</f></c>`;
      v = valor.v;
    }
    if (v === null || v === undefined || v === '') return estilo ? `<c r="${ref}" s="${estilo}"/>` : '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${estilo}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }

  function hoja(h) {
    const cols = h.columnas || [];
    const filas = [];
    const conEncabezado = cols.length > 0 && !h.sinEncabezado;
    let r = 0;
    if (conEncabezado) {
      r++;
      filas.push(`<row r="${r}" ht="32" customHeight="1">${cols.map((c, i) => celda(`${letra(i)}${r}`, c.titulo, E.encabezado)).join('')}</row>`);
    }
    const primera = r + 1;
    for (const fila of h.filas) {
      r++;
      filas.push(`<row r="${r}">${fila.map((v, i) => celda(`${letra(i)}${r}`, v, ESTILO_COLUMNA[cols[i]?.tipo] ?? E.normal)).join('')}</row>`);
    }
    const ultima = r;
    // Fila de totales: suma las columnas de dinero y número.
    if (h.totales && h.filas.length) {
      r++;
      const celdas = cols.map((c, i) => {
        const ref = `${letra(i)}${r}`;
        if (i === 0) return celda(ref, 'TOTAL', E.total);
        if ((c.tipo === 'dinero' || c.tipo === 'numero') && c.sumar !== false) {
          return celda(ref, { formula: `SUM(${letra(i)}${primera}:${letra(i)}${ultima})`, estilo: c.tipo === 'dinero' ? 'dineroTotal' : 'numeroTotal' });
        }
        return celda(ref, '', E.total);
      });
      filas.push(`<row r="${r}">${celdas.join('')}</row>`);
    }

    const anchos = cols.length
      ? `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 14}" customWidth="1"/>`).join('')}</cols>`
      : (h.anchos ? `<cols>${h.anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '');
    const fijar = conEncabezado
      ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
      : '';
    const filtro = conEncabezado && h.filas.length ? `A1:${letra(cols.length - 1)}${ultima}` : null;
    return {
      filtro,
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0">${fijar}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${anchos}
<sheetData>${filas.join('')}</sheetData>
${filtro ? `<autoFilter ref="${filtro}"/>` : ''}
</worksheet>`,
    };
  }

  // ── ZIP sin compresión (Excel lo acepta) ──
  function zip(archivos) {
    const enc = new TextEncoder();
    const partes = [];
    const central = [];
    let desplazamiento = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255];
    const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const { nombre, contenido } of archivos) {
      const datos = typeof contenido === 'string' ? enc.encode(contenido) : contenido;
      const n = enc.encode(nombre);
      const crc = PNG.crc32(datos);
      const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(datos.length), ...u32(datos.length), ...u16(n.length), ...u16(0), ...n]);
      partes.push(local, datos);
      central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(datos.length), ...u32(datos.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(desplazamiento), ...n]));
      desplazamiento += local.length + datos.length;
    }
    const tamCentral = central.reduce((t, c) => t + c.length, 0);
    const fin = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(archivos.length), ...u16(archivos.length),
      ...u32(tamCentral), ...u32(desplazamiento), ...u16(0)]);
    const todo = [...partes, ...central, fin];
    const salida = new Uint8Array(todo.reduce((t, p) => t + p.length, 0));
    let k = 0;
    for (const p of todo) { salida.set(p, k); k += p.length; }
    return salida;
  }

  function crear(hojas) {
    const generadas = hojas.map(hoja);
    const nombres = hojas.map((h, i) => (h.nombre || `Hoja${i + 1}`).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31));
    const filtros = generadas
      .map((g, i) => g.filtro && `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(nombres[i])}'!${g.filtro.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`)
      .filter(Boolean).join('');
    const archivos = [
      {
        nombre: '[Content_Types].xml',
        contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${generadas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
      },
      {
        nombre: '_rels/.rels',
        contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      },
      {
        nombre: 'xl/workbook.xml',
        contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${filtros ? `<definedNames>${filtros}</definedNames>` : ''}
</workbook>`,
      },
      {
        nombre: 'xl/_rels/workbook.xml.rels',
        contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${generadas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${generadas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      },
      { nombre: 'xl/styles.xml', contenido: ESTILOS },
      ...generadas.map((g, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: g.xml })),
    ];
    return zip(archivos);
  }

  const XLSX = { crear };
  if (typeof module !== 'undefined' && module.exports) module.exports = XLSX;
  else window.XLSX = XLSX;
})();
