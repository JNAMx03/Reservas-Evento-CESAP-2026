/*
 * Distribución del plano (planimetría).
 * Este archivo lo usan el navegador (para dibujar) y el servidor (para crear los palcos).
 *
 * Coordenadas en "casillas": col = columna, fila = fila. La columna 8 es el centro
 * (pasarela arriba, columna central abajo). Las filas se agrupan de a dos.
 */
(function () {
  const SILLAS_POR_PALCO = 10;

  // Posición vertical de cada una de las 21 filas (fila 1 sola, luego pares separados).
  const FILAS = [0];
  for (let par = 0; par < 10; par++) FILAS.push(1.4 + par * 2.4, 2.4 + par * 2.4);

  const celdas = []; // { col, fila, palco } o { col, fila, bloqueado: true }
  const serie = (desde, cantidad, paso) => Array.from({ length: cantidad }, (_, i) => desde + i * paso);
  const poner = (f, col, contenidos) => contenidos.forEach((c, i) => {
    celdas.push(c === 'N' ? { col: col + i, fila: FILAS[f], bloqueado: true } : { col: col + i, fila: FILAS[f], palco: c });
  });

  // Filas 1 a 3: impares a la izquierda, pares a la derecha (7 casillas por lado).
  poner(0, 1, ['N', ...serie(1, 6, 2)]);   poner(0, 9, [...serie(2, 6, 2), 'N']);
  poner(1, 1, ['N', ...serie(13, 6, 2)]);  poner(1, 9, [...serie(14, 6, 2), 'N']);
  poner(2, 1, serie(25, 7, 2));            poner(2, 9, serie(26, 7, 2));

  // Filas 4 a 9: impares a la izquierda, pares a la derecha (8 por lado).
  for (let f = 3, base = 39; f <= 8; f++, base += 16) {
    poner(f, 0, serie(base, 8, 2));
    poner(f, 9, serie(base + 1, 8, 2));
  }

  // Filas 10 a 21: numeración consecutiva de izquierda a derecha.
  // Las filas 10 y 11 tienen una casilla extra a la izquierda (columna -1).
  for (let f = 9, n = 135; f <= 20; f++) {
    const desde = f <= 10 ? -1 : 0;
    const cantidad = 17 - desde;
    poner(f, desde, serie(n, cantidad, 1));
    n += cantidad;
  }

  // Elementos de referencia (no son palcos).
  const fondo = FILAS[8] + 1; // fin de la fila 9, donde termina la pasarela
  const elementos = [
    { tipo: 'zona', texto: ['ZONA', 'TRABAJO'], col: -0.6, fila: -2.6, ancho: 4.6, alto: 1.9 },
    { tipo: 'tarima', texto: ['TARIMA'], col: 4.2, fila: -2.6, ancho: 8.6, alto: 1.9 },
    { tipo: 'zona', texto: ['CAMERINOS'], col: 13, fila: -2.6, ancho: 4.6, alto: 1.9 },
    { tipo: 'pasarela', texto: ['PASARELA'], col: 8.06, fila: -0.6, ancho: 0.88, alto: fondo + 0.6, vertical: true },
    { tipo: 'bano', texto: ['B1'], col: -1, fila: FILAS[0], ancho: 1.9, alto: 1 },
    { tipo: 'bano', texto: ['B2'], col: 16.1, fila: FILAS[0], ancho: 1.9, alto: 1 },
    { tipo: 'foh', texto: ['FOH'], col: 17, fila: FILAS[9], ancho: 1, alto: 1 },
    { tipo: 'foh', texto: ['FOH'], col: 17, fila: FILAS[10], ancho: 1, alto: 1 },
    { tipo: 'bano', texto: ['B3'], col: -1, fila: FILAS[19], ancho: 1, alto: 2 },
    { tipo: 'bano', texto: ['B4'], col: 17, fila: FILAS[19], ancho: 1, alto: 2 },
  ];

  // Las 10 sillas en U, abierta hacia la tarima (arriba).
  // x de 0 a 5, y de 0 a 3. Mesa en el centro (x 1..4, y 0..2).
  //   1 .  .  .  . 10
  //   2  [ mesa ]   9
  //   3 .  .  .  .  8
  //     4  5  6  7
  const sillas = [
    { n: 1, x: 0, y: 0 }, { n: 2, x: 0, y: 1 }, { n: 3, x: 0, y: 2 },
    { n: 4, x: 1, y: 3 }, { n: 5, x: 2, y: 3 }, { n: 6, x: 3, y: 3 }, { n: 7, x: 4, y: 3 },
    { n: 8, x: 5, y: 2 }, { n: 9, x: 5, y: 1 }, { n: 10, x: 5, y: 0 },
  ];

  // Categorías (zonas por color) con las que arranca el sistema.
  // Después se renombran, recolorean o reasignan desde "Organizar palcos".
  // precio = valor del palco completo (10 sillas). Cada silla vale precio / 10.
  const categoriasIniciales = [
    { nombre: 'Morado', color: '#8e44ad', desde: 1, hasta: 38, precio: 3000000 },
    { nombre: 'Rojo', color: '#e8312f', desde: 39, hasta: 170, precio: 2500000 },
    { nombre: 'Azul', color: '#2f80ed', desde: 171, hasta: 238, precio: 2000000 },
    { nombre: 'Verde', color: '#43b047', desde: 239, hasta: 306, precio: 1800000 },
    { nombre: 'Naranja', color: '#f39c12', desde: 307, hasta: 340, precio: 1500000 },
  ];

  // Repartición de palcos entre las empresas (números y rangos). "resto" = todos los demás.
  // CESAP: 165 palcos · CESNE: 175 palcos.
  const empresasIniciales = [
    {
      nombre: 'CESAP',
      color: '#4fe3c6',
      palcos: '1,3,5,2,4,6,19,21,23,20,22,24,25,27,29,31,26,28,30,'
        + '47,49,51,53,48,50,52,54,55,57,59,61,56,58,60,62,79,81,83,85,80,82,84,86,'
        + '87,89,91,93,88,90,92,94,111,113,115,117,112,114,116,118,119,121,123,125,120,122,124,126,'
        + '135-138,143-145,149-152,157-160,164-166,171-173,178,180,184-187,192-194,198-200,'
        + '205-208,211-214,218-221,226-227,232-234,239-241,245-247,252-255,259-261,265-267,'
        + '273-275,279-281,286-289,293-295,299-301,307-309,313-315,320-323,327-329,334-336',
    },
    { nombre: 'CESNE', color: '#f2e600', palcos: 'resto' },
  ];

  const PLANO = {
    TITULO: 'GRAN FIESTA ANUAL DE AFILIADOS - CESNE - CESAP',
    SILLAS_POR_PALCO,
    // Afiliación de cada persona: las empresas + esta opción extra.
    AFILIACION_EXTRA: 'Invitado',
    MEDIOS_PAGO: ['Efectivo', 'Transferencia', 'Tarjeta', 'Nequi', 'Daviplata', 'Otro'],
    // Si una reserva tiene una sola silla, se cobra este valor adicional.
    RECARGO_SILLA_SOLA: 30000,
    celdas,
    elementos,
    sillas,
    categoriasIniciales,
    empresasIniciales,
    palcos: celdas.filter(c => c.palco).map(c => c.palco).sort((a, b) => a - b),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLANO;
  else window.PLANO = PLANO;
})();
