'use strict';

const PLANO = window.PLANO;
const W = 46;          // ancho de una casilla del plano (unidades SVG)
const H = 40;          // alto de una casilla
const MARGEN = 14;
const NEUTRO = '#d3d8de';
const OCUPACION = [
  { clave: 'vacio', nombre: 'Vacíos', color: '#e4e8ed' },
  { clave: 'parcial', nombre: 'Con reservas', color: '#ffc94d' },
  { clave: 'lleno', nombre: 'Llenos', color: '#ef5b55' },
  { clave: 'bloqueado', nombre: 'Bloqueados', color: '#5b6470' },
];
const PALETA = ['#8b46c9', '#1f9d6b', '#f08a24', '#c2367a', '#13879c', '#7a5c3e', '#e8312f', '#3aa8f0', '#f5d547', '#62bd45'];
const ZOOMS = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const moneda = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const pesos = n => moneda.format(n || 0);
const leerPesos = v => Number(String(v ?? '').replace(/[^\d]/g, '').slice(0, 13)) || 0;

const estado = {
  palcos: new Map(),        // numero → { numero, capacidad, categoria_id, empresa_id, ocupadas: [sillas], reservas }
  categorias: [],
  empresas: [],
  colorear: leerLocal('colorear') || 'categoria',
  resaltar: '',
  zoom: Number(leerLocal('zoom')) || 1,
  organizar: false,
  seleccion: new Set(),     // palcos seleccionados en modo organizar
  coincidencias: new Set(), // palcos que aparecen en la búsqueda
  busqueda: '',
  abierto: null,            // palco abierto en el detalle
  detalle: null,
  editando: null,           // reserva en edición
  sillasSel: new Set(),     // sillas seleccionadas en el detalle
  valorManual: false,       // true si alguien escribió el valor a mano (no se recalcula con la tarifa)
};

const svgPlano = $('#plano');
const dialogo = $('#detalle');
const form = $('#formulario');

// ── Comunicación con el servidor ────────────────────────────────────────
async function api(metodo, ruta, cuerpo) {
  // El nombre de "Registrado por" de este equipo viaja en cada petición (historial interno).
  const opciones = { method: metodo, headers: { 'X-Registrado-Por': encodeURIComponent(leerLocal('registrado_por')) } };
  if (cuerpo) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  let res;
  try { res = await fetch(ruta, opciones); }
  catch { throw new Error('No hay conexión con el servidor'); }
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error || `Error ${res.status}`);
  return datos;
}

function aviso(texto, tipo = '') {
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.textContent = texto;
  $('#avisos').append(el);
  setTimeout(() => el.remove(), 4000);
}

function leerLocal(clave) {
  try { return localStorage.getItem(clave) || ''; } catch { return ''; }
}
function guardarLocal(clave, valor) {
  try { localStorage.setItem(clave, String(valor ?? '')); } catch { /* sin almacenamiento local */ }
}

// ── Ayudas ──────────────────────────────────────────────────────────────
function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Texto negro o blanco, el que mejor se lea sobre el color.
const tinta = hex => (luminancia(hex) > 0.179 ? '#14181f' : '#ffffff');

const categoria = id => estado.categorias.find(c => c.id === id);
const empresa = id => estado.empresas.find(e => e.id === id);

function estadoDe(p) {
  if (p.bloqueado) return 'bloqueado';
  if (p.ocupadas.length === 0) return 'vacio';
  return p.ocupadas.length >= p.capacidad ? 'lleno' : 'parcial';
}

function colorPalco(p) {
  if (estado.colorear === 'ocupacion') return OCUPACION.find(o => o.clave === estadoDe(p)).color;
  const g = estado.colorear === 'empresa' ? empresa(p.empresa_id) : categoria(p.categoria_id);
  return g ? g.color : NEUTRO;
}

function coincideResaltado(p) {
  if (!estado.resaltar) return true;
  const [tipo, valor] = estado.resaltar.split(':');
  if (tipo === 'cat') return String(p.categoria_id ?? 0) === valor;
  if (tipo === 'emp') return String(p.empresa_id ?? 0) === valor;
  if (tipo === 'disp') return valor === 'cupo' ? !['lleno', 'bloqueado'].includes(estadoDe(p)) : estadoDe(p) === valor;
  return true;
}

// Tarifa según la zona del palco: cada silla vale precio del palco / capacidad,
// y una reserva de una sola silla paga además el recargo. null si la zona no tiene precio.
function tarifa(palco, sillas) {
  const precio = categoria(palco.categoria_id)?.precio || 0;
  if (!precio || !sillas) return null;
  const porSilla = Math.round(precio / palco.capacidad);
  const recargo = sillas === 1 ? PLANO.RECARGO_SILLA_SOLA : 0;
  return { porSilla, recargo, total: porSilla * sillas + recargo };
}

// "1, 2, 3, 5, 7, 8" → "1–3, 5, 7–8"
function rangosTexto(numeros) {
  const n = [...numeros].sort((a, b) => a - b);
  const partes = [];
  for (let i = 0; i < n.length; i++) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    partes.push(j > i ? `${n[i]}–${n[j]}` : `${n[i]}`);
    i = j;
  }
  return partes.join(', ');
}

// "1-54, 60 135-152" → [1, 2, …]
function leerRangos(texto) {
  const numeros = [];
  for (const parte of texto.replace(/\s*[-–]\s*/g, '-').split(/[,;\s]+/)) {
    if (!parte) continue;
    const m = parte.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`No entiendo "${parte}". Usa números y rangos, por ejemplo: 1-54, 60`);
    let [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (a > b) [a, b] = [b, a];
    for (let n = a; n <= b; n++) if (estado.palcos.has(n)) numeros.push(n);
  }
  return numeros;
}

// ── Dibujo del plano (se arma una sola vez) ─────────────────────────────
const nodos = new Map(); // numero → { g, fondo, num, puntos, titulo, x, y }
const vista = { ancho: 0, alto: 0 };

// modo 'registro': número + mini U de sillas. modo 'tv': número + texto de personas.
function construirPlano(svgPlano, nodos, vista, modo = 'registro') {
  const pre = svgPlano.id; // ids únicos por plano (gradientes)
  const todos = [...PLANO.celdas.map(c => ({ ...c, ancho: 1, alto: 1 })), ...PLANO.elementos];
  const minCol = Math.min(...todos.map(e => e.col));
  const maxCol = Math.max(...todos.map(e => e.col + e.ancho));
  const minFila = Math.min(...todos.map(e => e.fila));
  const maxFila = Math.max(...todos.map(e => e.fila + e.alto));
  const X = col => MARGEN + (col - minCol) * W;
  const Y = fila => MARGEN + (fila - minFila) * H;
  vista.ancho = X(maxCol) + MARGEN;
  vista.alto = Y(maxFila) + MARGEN;
  svgPlano.setAttribute('viewBox', `0 0 ${vista.ancho} ${vista.alto}`);

  const estilos = {
    zona: { fondo: `url(#${pre}-zona)`, texto: '#ffffff', tam: 15 },
    tarima: { fondo: `url(#${pre}-tarima)`, texto: '#ffffff', tam: 30 },
    pasarela: { fondo: `url(#${pre}-tarima)`, texto: '#ffffff', tam: 17 },
    bano: { fondo: `url(#${pre}-bano)`, texto: '#1b1b1b', tam: 18 },
    foh: { fondo: '#111111', texto: '#ffffff', tam: 12 },
  };

  let html = `
    <defs>
      <linearGradient id="${pre}-zona" x1="0" x2="1"><stop offset="0" stop-color="#0f8f9c"/><stop offset="1" stop-color="#6ccf63"/></linearGradient>
      <linearGradient id="${pre}-tarima" x1="0" x2="1"><stop offset="0" stop-color="#2e2e2e"/><stop offset=".5" stop-color="#8f8f8f"/><stop offset="1" stop-color="#2e2e2e"/></linearGradient>
      <linearGradient id="${pre}-bano" x1="0" x2="1"><stop offset="0" stop-color="#f5a01f"/><stop offset="1" stop-color="#ffd59a"/></linearGradient>
    </defs>
    <rect class="plano-fondo" width="${vista.ancho}" height="${vista.alto}" rx="10"/>`;

  for (const e of PLANO.elementos) {
    const x = X(e.col), y = Y(e.fila), w = e.ancho * W, h = e.alto * H;
    const s = estilos[e.tipo];
    html += `<g class="referencia"><rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h - 3}" rx="4" fill="${s.fondo}"/>`;
    if (e.vertical) {
      const letras = e.texto[0].split('');
      const paso = Math.min(28, (h - 60) / letras.length);
      const inicio = y + h / 2 - (paso * (letras.length - 1)) / 2;
      letras.forEach((l, i) => {
        html += `<text x="${x + w / 2}" y="${inicio + i * paso + s.tam * 0.35}" fill="${s.texto}" font-size="${s.tam}">${l}</text>`;
      });
    } else {
      e.texto.forEach((t, i) => {
        const dy = (i - (e.texto.length - 1) / 2) * s.tam * 1.15;
        html += `<text x="${x + w / 2}" y="${y + h / 2 + dy + s.tam * 0.35}" fill="${s.texto}" font-size="${s.tam}">${esc(t)}</text>`;
      });
    }
    html += '</g>';
  }

  const posiciones = new Map();
  for (const c of PLANO.celdas) {
    const x = X(c.col), y = Y(c.fila);
    if (c.bloqueado) {
      html += `<g class="referencia"><rect class="celda-n" x="${x + 1.5}" y="${y + 1.5}" width="${W - 3}" height="${H - 3}" rx="4"/>
               <text x="${x + W / 2}" y="${y + H / 2 + 5}" font-size="14" fill="#ffffff">N</text></g>`;
      continue;
    }
    posiciones.set(c.palco, { x, y });
    // Fondo + una "X" que solo se ve si el palco está bloqueado.
    const fondo = `<rect class="palco-fondo" x="${x + 1.5}" y="${y + 1.5}" width="${W - 3}" height="${H - 3}" rx="4"/>
      <path class="palco-bloqueo" d="M${x + 5} ${y + 5}L${x + W - 5} ${y + H - 5}M${x + W - 5} ${y + 5}L${x + 5} ${y + H - 5}"/>`;
    if (modo === 'tv') {
      html += `<g class="palco" data-palco="${c.palco}">${fondo}
        <text class="palco-num" x="${x + W / 2}" y="${y + 17}">${c.palco}</text>
        <text class="palco-sub" x="${x + W / 2}" y="${y + 32}"></text></g>`;
      continue;
    }
    // Mini "U" de 10 sillas alrededor del número.
    const puntos = PLANO.sillas.map(s =>
      `<circle class="punto" data-silla="${s.n}" cx="${x + 6 + s.x * 6.8}" cy="${y + 7 + s.y * 9}" r="2.5"/>`).join('');
    html += `<g class="palco" data-palco="${c.palco}">${fondo}
      <text class="palco-num" x="${x + W / 2}" y="${y + H / 2 + 3}">${c.palco}</text>
      ${puntos}<title></title></g>`;
  }

  if (modo === 'registro') html += '<rect id="rect-sel" class="rect-sel" style="display:none"/>';
  svgPlano.innerHTML = html;

  for (const g of svgPlano.querySelectorAll('.palco')) {
    const n = Number(g.dataset.palco);
    nodos.set(n, {
      g,
      fondo: g.querySelector('.palco-fondo'),
      num: g.querySelector('.palco-num'),
      puntos: [...g.querySelectorAll('.punto')],
      titulo: g.querySelector('title'),
      sub: g.querySelector('.palco-sub'),
      ...posiciones.get(n),
    });
  }
}

// ── Pintar datos ────────────────────────────────────────────────────────
async function cargarEstado() {
  const d = await api('GET', '/api/estado');
  estado.palcos = new Map(d.palcos.map(p => [p.numero, p]));
  estado.categorias = d.categorias;
  estado.empresas = d.empresas;
  pintarTodo();
}

// Otras pestañas (Finanzas, Pantalla TV) se suscriben para enterarse de los cambios.
const alActualizar = [];

function pintarTodo() {
  pintarResumen();
  pintarOpcionesResaltar();
  pintarPalcos();
  pintarLeyenda();
  pintarOrganizar();
  pintarOpcionesFormulario();
}

function pintarResumen() {
  const p = [...estado.palcos.values()];
  const capacidad = p.reduce((t, x) => t + x.capacidad, 0);
  const ocupadas = p.reduce((t, x) => t + x.ocupadas.length, 0);
  const llenos = p.filter(x => x.ocupadas.length >= x.capacidad).length;
  const bloqueados = p.filter(x => x.bloqueado).length;
  const registros = p.reduce((t, x) => t + x.reservas, 0);
  const pct = capacidad ? Math.round((ocupadas / capacidad) * 100) : 0;
  const datos = [
    ['Sillas ocupadas', `${ocupadas.toLocaleString('es')} / ${capacidad.toLocaleString('es')}`],
    ['Sillas libres', (capacidad - ocupadas).toLocaleString('es')],
    ['Ocupación', `${pct}%`],
    ['Palcos llenos', `${llenos} / ${p.length}`],
    ['Palcos bloqueados', bloqueados],
    ['Registros', registros.toLocaleString('es')],
  ];
  $('#resumen').innerHTML = datos.map(([t, v]) => `<div class="dato"><span>${t}</span><strong>${v}</strong></div>`).join('');
}

function pintarPalcos() {
  for (const [n, nodo] of nodos) {
    const p = estado.palcos.get(n);
    if (!p) continue;
    const color = colorPalco(p);
    const t = tinta(color);
    const ocupadas = new Set(p.ocupadas);
    nodo.fondo.setAttribute('fill', color);
    nodo.num.setAttribute('fill', t);
    for (const c of nodo.puntos) {
      const ocupada = ocupadas.has(Number(c.dataset.silla));
      c.setAttribute('fill', ocupada ? t : 'none');
      c.setAttribute('stroke', t);
      c.setAttribute('stroke-opacity', ocupada ? '1' : '0.5');
    }
    nodo.g.classList.toggle('atenuado', !coincideResaltado(p));
    nodo.g.classList.toggle('seleccionado', estado.organizar && estado.seleccion.has(n));
    nodo.g.classList.toggle('coincide', estado.coincidencias.has(n));
    nodo.g.classList.toggle('bloqueado', !!p.bloqueado);
    const cat = categoria(p.categoria_id)?.nombre || 'Sin categoría';
    const emp = empresa(p.empresa_id)?.nombre || 'Sin empresa';
    const bloq = p.bloqueado ? ` · BLOQUEADO${p.motivo_bloqueo ? ` (${p.motivo_bloqueo})` : ''}` : '';
    nodo.titulo.textContent = `Palco ${n} · ${p.ocupadas.length}/${p.capacidad} sillas · ${cat} · ${emp}${bloq}`;
  }
}

function destellar(numeros) {
  for (const n of numeros || []) {
    const g = nodos.get(n)?.g;
    if (!g) continue;
    g.classList.remove('destello');
    void g.getBoundingClientRect();
    g.classList.add('destello');
  }
}

function pintarOpcionesResaltar() {
  const opcion = (valor, texto) => `<option value="${valor}">${esc(texto)}</option>`;
  const sel = $('#resaltar');
  sel.innerHTML = opcion('', 'Todos los palcos')
    + `<optgroup label="Disponibilidad">${opcion('disp:cupo', 'Con sillas libres')}${opcion('disp:vacio', 'Vacíos')}${opcion('disp:parcial', 'Con reservas')}${opcion('disp:lleno', 'Llenos')}${opcion('disp:bloqueado', 'Bloqueados')}</optgroup>`
    + `<optgroup label="Categoría">${estado.categorias.map(c => opcion(`cat:${c.id}`, c.nombre)).join('')}${opcion('cat:0', 'Sin categoría')}</optgroup>`
    + `<optgroup label="Empresa">${estado.empresas.map(e => opcion(`emp:${e.id}`, e.nombre)).join('')}${opcion('emp:0', 'Sin empresa')}</optgroup>`;
  if (![...sel.options].some(o => o.value === estado.resaltar)) estado.resaltar = '';
  sel.value = estado.resaltar;
}

function pintarLeyenda() {
  const palcos = [...estado.palcos.values()];
  let titulo, items;
  if (estado.colorear === 'ocupacion') {
    titulo = 'Ocupación';
    items = OCUPACION.map(o => ({ clave: `disp:${o.clave}`, nombre: o.nombre, color: o.color, palcos: palcos.filter(p => estadoDe(p) === o.clave) }));
  } else {
    const esEmpresa = estado.colorear === 'empresa';
    const campo = esEmpresa ? 'empresa_id' : 'categoria_id';
    const prefijo = esEmpresa ? 'emp' : 'cat';
    titulo = esEmpresa ? 'Empresas' : 'Categorías';
    items = (esEmpresa ? estado.empresas : estado.categorias).map(g => ({
      clave: `${prefijo}:${g.id}`, nombre: g.nombre, color: g.color, palcos: palcos.filter(p => p[campo] === g.id),
      precio: g.precio ? `Palco ${pesos(g.precio)} · silla ${pesos(Math.round(g.precio / PLANO.SILLAS_POR_PALCO))}` : '',
    }));
    const sinAsignar = palcos.filter(p => p[campo] == null);
    if (sinAsignar.length) items.push({ clave: `${prefijo}:0`, nombre: esEmpresa ? 'Sin empresa' : 'Sin categoría', color: NEUTRO, palcos: sinAsignar });
  }
  $('#leyenda-titulo').textContent = titulo;
  $('#leyenda').innerHTML = items.map(i => {
    const capacidad = i.palcos.reduce((t, p) => t + p.capacidad, 0);
    const ocupadas = i.palcos.reduce((t, p) => t + p.ocupadas.length, 0);
    return `<li><button type="button" data-resaltar="${i.clave}" class="${estado.resaltar === i.clave ? 'activo' : ''}">
        <i class="muestra" style="background:${i.color}"></i>
        <span class="nombre">${esc(i.nombre)}</span>
        <span class="cifras">${plural(i.palcos.length, 'palco', 'palcos')} · ${ocupadas}/${capacidad} sillas</span>
        ${i.precio ? `<span class="cifras precio-leyenda">${i.precio}</span>` : ''}
      </button></li>`;
  }).join('') || '<li class="suave pequeno">Aún no hay empresas. Créalas en "Organizar palcos".</li>';
  document.querySelectorAll('#colorear button').forEach(b => b.classList.toggle('activo', b.dataset.colorear === estado.colorear));
}

// ── Zoom ────────────────────────────────────────────────────────────────
function aplicarZoom(z) {
  estado.zoom = Math.min(3, Math.max(0.3, z));
  svgPlano.style.width = `${estado.zoom * 100}%`;
  guardarLocal('zoom', estado.zoom);
}

function ajustarZoom() {
  const caja = $('#plano-caja');
  aplicarZoom(Math.min(1, ((caja.clientHeight - 8) / caja.clientWidth) * (vista.ancho / vista.alto)));
}

// ── Detalle de un palco: sillas en U ────────────────────────────────────
async function abrirPalco(numero) {
  try {
    estado.abierto = numero;
    estado.editando = null;
    estado.sillasSel = new Set();
    await cargarDetalle();
    limpiarFormulario();
    if (!dialogo.open) dialogo.showModal();
  } catch (err) {
    estado.abierto = null;
    aviso(err.message, 'error');
  }
}

// silla → { reserva, indice } de las reservas del palco abierto
function duenosDeSillas() {
  const mapa = new Map();
  estado.detalle.reservas.forEach((r, indice) => r.sillas.forEach(s => mapa.set(s, { reserva: r, indice })));
  return mapa;
}

const esPropia = dueno => dueno && estado.editando && dueno.reserva.id === estado.editando.id;

async function cargarDetalle() {
  estado.detalle = await api('GET', `/api/palcos/${estado.abierto}`);
  if (estado.editando) {
    const actual = estado.detalle.reservas.find(r => r.id === estado.editando.id);
    if (actual) {
      estado.editando = actual; // datos frescos (pagos incluidos)
    } else {
      aviso('La reserva que estabas editando fue eliminada por otra persona', 'error');
      estado.editando = null;
      estado.sillasSel.clear();
      limpiarFormulario();
    }
  }
  // Si alguien ocupó sillas que yo tenía seleccionadas, se quitan de mi selección.
  const duenos = duenosDeSillas();
  const perdidas = [...estado.sillasSel].filter(s => duenos.has(s) && !esPropia(duenos.get(s)));
  if (perdidas.length) {
    perdidas.forEach(s => estado.sillasSel.delete(s));
    aviso(`Otra persona acaba de ocupar: silla ${perdidas.join(', ')}`, 'error');
  }
  pintarDetalle();
}

function pintarDetalle() {
  const d = estado.detalle;
  const libres = d.capacidad - d.ocupadas.length;
  const cat = categoria(d.categoria_id);
  const emp = empresa(d.empresa_id);

  $('#detalle-titulo').textContent = `Palco ${d.numero}`;
  $('#detalle-etiquetas').innerHTML = [
    cat ? `<span class="chip"><i style="background:${cat.color}"></i>${esc(cat.nombre)}</span>` : '<span class="chip suave">Sin categoría</span>',
    emp ? `<span class="chip"><i style="background:${emp.color}"></i>${esc(emp.nombre)}</span>` : '<span class="chip suave">Sin empresa</span>',
  ].join('');
  $('#detalle-ocupacion').textContent = `${d.ocupadas.length} de ${d.capacidad} sillas ocupadas · ${libres === 0 ? 'lleno' : plural(libres, 'libre', 'libres')}`;

  pintarSillas();

  $('#detalle-lista').innerHTML = d.reservas.map((r, i) => {
    const contacto = [r.documento && `Doc. ${r.documento}`, r.telefono && `Tel. ${r.telefono}`].filter(Boolean).join(' · ');
    const editada = r.actualizado_en !== r.creado_en ? ` · editado ${esc(r.actualizado_en.slice(0, 16))}` : '';
    return `<li data-id="${r.id}" class="${estado.editando?.id === r.id ? 'editando' : ''}">
      <span class="punto-color c${i % 6}"></span>
      <div class="info">
        <strong>${esc(r.nombre)}</strong>
        <span class="pill codigo">${esc(r.codigo || '')}</span>
        <span class="pill">${r.sillas.length === 1 ? 'Silla' : 'Sillas'} ${r.sillas.join(', ')}</span>
        ${r.afiliacion ? `<span class="pill">${esc(r.afiliacion)}</span>` : ''}
        ${contacto ? `<small>${esc(contacto)}</small>` : ''}
        ${estadoPagoHtml(r)}
        ${estadoCorreoHtml(r)}
        ${r.notas ? `<small>${esc(r.notas)}</small>` : ''}
        <small>Registrado ${esc(r.creado_en.slice(0, 16))}${r.registrado_por ? ` por ${esc(r.registrado_por)}` : ''}${editada}</small>
      </div>
      <div class="botones">
        <button type="button" class="boton pequeno" data-editar="${r.id}">Editar</button>
        <a class="boton pequeno" href="/api/reservas/${r.id}/boleta.pdf" target="_blank" rel="noopener">Boleta PDF</a>
        ${r.correo && r.autoriza_datos ? `<button type="button" class="boton pequeno" data-reenviar="${r.id}">${r.correo_estado === 'enviado' ? 'Reenviar correo' : 'Enviar correo'}</button>` : ''}
        <button type="button" class="boton pequeno peligro" data-eliminar="${r.id}">Anular</button>
      </div>
    </li>`;
  }).join('') || '<li class="suave">Nadie ha reservado en este palco todavía.</li>';

  // Bloqueado: no se crean reservas nuevas, pero las existentes se pueden editar y cobrar.
  const bloqueado = !!d.bloqueado;
  $('#bloquear-palco').textContent = bloqueado ? 'Desbloquear palco' : 'Bloquear palco';
  $('#bloquear-palco').classList.toggle('activo', bloqueado);
  $('#bloqueado-msg').hidden = !bloqueado;
  $('#bloqueado-msg').textContent = `Palco bloqueado${d.motivo_bloqueo ? `: ${d.motivo_bloqueo}` : ''}. No admite reservas nuevas.`;

  const mostrarForm = (libres > 0 && !bloqueado) || !!estado.editando;
  form.hidden = !mostrarForm;
  $('#lleno').hidden = mostrarForm || bloqueado;
  actualizarTextoSeleccion();
  actualizarValorAutomatico();
  pintarPagos();
}

// Con la tarifa de la zona, el valor total se llena solo según las sillas elegidas
// (salvo que alguien lo haya escrito a mano).
function actualizarValorAutomatico() {
  if (!estado.detalle) return;
  if (estado.editando) {
    // Ya está pagada: el valor no cambia.
    form.valor.value = pesos(estado.editando.valor);
    $('#tarifa-ayuda').textContent = '';
    return;
  }
  const t = tarifa(estado.detalle, estado.sillasSel.size);
  if (!estado.valorManual) form.valor.value = t ? pesos(t.total) : '';
  pintarTarifa();
}

function pintarTarifa() {
  const ayuda = $('#tarifa-ayuda');
  const n = estado.sillasSel.size;
  const t = tarifa(estado.detalle, n);
  if (!t) {
    ayuda.innerHTML = categoria(estado.detalle.categoria_id)?.precio
      ? 'Selecciona sillas para calcular el valor.'
      : 'Esta zona no tiene precio definido: escribe el valor a mano.';
    return;
  }
  const detalle = `${plural(n, 'silla', 'sillas')} × ${pesos(t.porSilla)}${t.recargo ? ` + ${pesos(t.recargo)} por silla sola` : ''} = <strong>${pesos(t.total)}</strong>`;
  const valor = leerPesos(form.valor.value);
  const distinto = valor !== t.total
    ? ` <span class="tarifa-distinta">· El valor escrito es distinto a la tarifa. <button type="button" class="enlace" id="usar-tarifa">Usar tarifa</button></span>`
    : '';
  ayuda.innerHTML = `Tarifa: ${detalle}${distinto}`;
}

async function alternarBloqueo(palcos, bloquear) {
  let motivo = '';
  if (bloquear) {
    motivo = prompt(`Motivo del bloqueo (opcional) para ${palcos.length === 1 ? `el palco ${palcos[0]}` : `${palcos.length} palcos`}:`, '');
    if (motivo === null) return false; // canceló
  } else if (!confirm(`¿Desbloquear ${palcos.length === 1 ? `el palco ${palcos[0]}` : `${palcos.length} palcos`}?`)) {
    return false;
  }
  try {
    await api('POST', '/api/palcos/bloquear', { palcos, bloqueado: bloquear, motivo });
    aviso(`${plural(palcos.length, 'palco', 'palcos')} ${bloquear ? 'bloqueado' : 'desbloqueado'}${palcos.length === 1 ? '' : 's'}`);
    await cargarEstado();
    return true;
  } catch (err) {
    aviso(err.message, 'error');
    return false;
  }
}

// ── Correo con la boleta ────────────────────────────────────────────────
function estadoCorreoHtml(r) {
  if (!r.correo) return '';
  const correo = esc(r.correo);
  if (!r.autoriza_datos) return `<small class="estado-correo">✉ ${correo} · no autorizó el envío</small>`;
  const estados = {
    enviado: ['ok', `boleta enviada ${esc((r.correo_enviado_en || '').slice(0, 16))}`],
    pendiente: ['pendiente', 'enviando boleta…'],
    error: ['error', `no se pudo enviar: ${esc(r.correo_detalle)}`],
  };
  const [clase, texto] = estados[r.correo_estado] || ['', 'boleta sin enviar'];
  return `<small class="estado-correo ${clase}">✉ ${correo} · ${texto}</small>`;
}

async function reenviarCorreo(id) {
  try {
    await api('POST', `/api/reservas/${id}/correo`);
    aviso('Enviando la boleta por correo…');
  } catch (err) {
    aviso(err.message, 'error');
  }
}

async function revisarCorreo() {
  try {
    const e = await api('GET', '/api/correo/estado');
    $('#correo-estado').textContent = e.activo
      ? `Activo · se envía${e.remitente ? ` desde ${e.remitente}` : ''} (${{ graph: 'Microsoft 365', google_script: 'Gmail con Google Apps Script', smtp: 'SMTP' }[e.metodo]}).`
      : `No activo: ${e.problema || 'revisa config.json en el servidor'}. Las reservas se guardan, pero no se envían correos.`;
  } catch (err) {
    $('#correo-estado').textContent = err.message;
  }
}

// ── Pago de la reserva (siempre completo) ───────────────────────────────
const pagoCompleto = r => r.valor > 0 && r.pagado >= r.valor;

function estadoPagoHtml(r) {
  if (pagoCompleto(r)) {
    const medio = [...new Set(r.pagos.map(p => p.medio))].join(', ');
    return `<small class="estado-pago pagado">✓ Pagado ${pesos(r.pagado)}${medio ? ` · ${esc(medio)}` : ''}</small>`;
  }
  const falta = r.valor ? r.valor - r.pagado : 0;
  return `<small class="estado-pago pendiente">Pago incompleto (registro anterior)${falta > 0 ? `: faltan ${pesos(falta)}` : ': sin valor definido'}</small>`;
}

function pintarOpcionesFormulario() {
  const afiliacion = form.afiliacion;
  const antes = afiliacion.value;
  const opciones = [...estado.empresas.map(e => e.nombre), PLANO.AFILIACION_EXTRA];
  afiliacion.innerHTML = '<option value="">—</option>' + opciones.map(o => `<option>${esc(o)}</option>`).join('');
  afiliacion.value = antes;
  for (const sel of document.querySelectorAll('select.medios')) {
    if (sel.options.length) continue;
    sel.innerHTML = PLANO.MEDIOS_PAGO.map(m => `<option>${esc(m)}</option>`).join('');
  }
}

// Nueva reserva: se elige el medio de pago y se paga el total.
// Al editar: se muestra el pago (no se cambia) y, solo en registros antiguos incompletos, "Completar pago".
function pintarPagos() {
  const r = estado.editando;
  $('#campo-medio').hidden = !!r;
  form.valor.readOnly = !!r;
  $('#bloque-pago').hidden = !r;
  if (r) {
    const completo = pagoCompleto(r);
    $('#pago-info').innerHTML = completo
      ? `✓ Pagado <strong>${pesos(r.pagado)}</strong> · ${r.pagos.map(p => `${esc(p.medio)}, ${esc(p.fecha.slice(0, 16))}`).join(' · ')}.<br>
         <span class="suave">El valor y la cantidad de sillas no se cambian: puedes pasarla a otras ${plural(r.sillas.length, 'silla', 'sillas')} libres.
         Para cambiar la cantidad, anula la reserva y créala de nuevo.</span>`
      : `Registro anterior con pago incompleto: pagado ${pesos(r.pagado)}${r.valor ? ` de ${pesos(r.valor)}` : ''}. Completa el pago para dejarla al día.`;
    $('#completar-pago').hidden = completo;
  }
  pintarSaldos();
}

function pintarSaldos() {
  const r = estado.editando;
  $('#saldos').innerHTML = r
    ? `<div><span>Valor de la reserva</span><strong>${pesos(r.valor)}</strong></div>
       <div class="${pagoCompleto(r) ? 'ok' : 'pendiente'}"><span>Estado</span><strong>${pagoCompleto(r) ? 'Pagada ✓' : 'Pago incompleto'}</strong></div>`
    : `<div><span>Total a pagar</span><strong>${pesos(leerPesos(form.valor.value))}</strong></div>
       <div><span>Medio de pago</span><strong>${esc(form.medio_pago.value)}</strong></div>`;
}

async function completarPago() {
  const r = estado.editando;
  if (!r) return;
  let valor;
  if (!r.valor) {
    valor = leerPesos(prompt('Esta reserva no tiene valor. Escribe el valor total de la reserva:', '') || '');
    if (!valor) return;
  }
  const medio = $('#completar-medio').value;
  const falta = (r.valor || valor) - r.pagado;
  if (!confirm(`¿Registrar el pago de ${pesos(falta)} (${medio}) para completar la reserva ${r.codigo}?`)) return;
  try {
    await api('POST', `/api/reservas/${r.id}/completar-pago`, { medio_pago: medio, valor });
    aviso('Pago completado');
    await cargarDetalle();
  } catch (err) {
    aviso(err.message, 'error');
  }
}

function pintarSillas() {
  const d = estado.detalle;
  const duenos = duenosDeSillas();
  const T = 58, PAD = 8, ARRIBA = 34;
  const maxX = Math.max(...PLANO.sillas.map(s => s.x));
  const maxY = Math.max(...PLANO.sillas.map(s => s.y));
  const ancho = PAD * 2 + (maxX + 1) * T;
  const alto = ARRIBA + (maxY + 1) * T + PAD;
  const svg = $('#sillas');
  svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);

  const mesa = { x: PAD + T + 6, y: ARRIBA + 6, w: (maxX - 1) * T - 12, h: maxY * T - 12 };
  let html = `<text class="sillas-tarima" x="${ancho / 2}" y="20">▲ TARIMA</text>
    <rect class="mesa" x="${mesa.x}" y="${mesa.y}" width="${mesa.w}" height="${mesa.h}" rx="10"/>
    <text class="mesa-texto" x="${mesa.x + mesa.w / 2}" y="${mesa.y + mesa.h / 2 + 6}">Palco ${d.numero}</text>`;

  for (const s of PLANO.sillas) {
    const x = PAD + s.x * T + 4, y = ARRIBA + s.y * T + 4, lado = T - 8;
    const dueno = duenos.get(s.n);
    const ajena = dueno && !esPropia(dueno);
    let clase = 'libre', titulo = `Silla ${s.n}: libre`;
    if (estado.sillasSel.has(s.n)) { clase = 'sel'; titulo = `Silla ${s.n}: seleccionada`; }
    else if (ajena) { clase = `ocupada c${dueno.indice % 6}`; titulo = `Silla ${s.n}: ${dueno.reserva.nombre}`; }
    html += `<g class="silla ${clase}" data-silla="${s.n}" tabindex="0" role="button" aria-label="${esc(titulo)}">
      <rect x="${x}" y="${y}" width="${lado}" height="${lado}" rx="12"/>
      <text x="${x + lado / 2}" y="${y + lado / 2 + 6}">${s.n}</text>
      <title>${esc(titulo)}</title></g>`;
  }
  svg.innerHTML = html;
}

function actualizarTextoSeleccion() {
  const s = [...estado.sillasSel].sort((a, b) => a - b);
  $('#sel-texto').innerHTML = s.length
    ? `<strong>${plural(s.length, 'silla seleccionada', 'sillas seleccionadas')}:</strong> ${s.join(', ')}`
    : 'Toca las sillas libres en el dibujo para seleccionarlas.';
  $('#sel-texto').classList.toggle('vacia', s.length === 0);
}

function tocarSilla(n) {
  const dueno = duenosDeSillas().get(n);
  if (dueno && !esPropia(dueno)) {
    // Silla de otra reserva: mostrar quién la tiene.
    const li = document.querySelector(`#detalle-lista li[data-id="${dueno.reserva.id}"]`);
    if (li) {
      li.classList.remove('resaltada');
      void li.offsetWidth;
      li.classList.add('resaltada');
      li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    return;
  }
  if (form.hidden) return;
  if (estado.sillasSel.has(n)) estado.sillasSel.delete(n);
  else estado.sillasSel.add(n);
  seleccionCambiada();
}

function seleccionCambiada() {
  pintarSillas();
  actualizarTextoSeleccion();
  actualizarValorAutomatico();
  pintarSaldos();
}

function limpiarFormulario() {
  form.reset();
  form.registrado_por.value = leerLocal('registrado_por');
  // La afiliación sugerida es la empresa del palco.
  const emp = estado.detalle && empresa(estado.detalle.empresa_id);
  form.afiliacion.value = emp ? emp.nombre : '';
  $('#form-titulo').textContent = 'Nueva reserva';
  $('#guardar').textContent = 'Registrar pago y reserva';
  $('#cancelar-edicion').hidden = true;
  $('#form-error').hidden = true;
  estado.valorManual = false;
  actualizarValorAutomatico();
  pintarPagos();
}

function editar(id) {
  const r = estado.detalle.reservas.find(x => x.id === id);
  if (!r) return;
  estado.editando = r;
  estado.sillasSel = new Set(r.sillas);
  limpiarFormulario();
  // "Registrado por" queda con el nombre de quien edita en este equipo (va al historial interno);
  // la reserva conserva a quien la registró originalmente.
  for (const campo of ['nombre', 'documento', 'telefono', 'notas', 'afiliacion', 'correo']) form[campo].value = r[campo] ?? '';
  form.autoriza_datos.checked = !!r.autoriza_datos;
  form.valor.value = r.valor ? pesos(r.valor) : '';
  $('#form-titulo').textContent = `Editando a ${r.nombre}`;
  $('#guardar').textContent = 'Guardar cambios';
  $('#cancelar-edicion').hidden = false;
  pintarDetalle();
  form.nombre.focus();
}

function cancelarEdicion() {
  estado.editando = null;
  estado.sillasSel.clear();
  limpiarFormulario();
  pintarDetalle();
}

// Anular: libera las sillas y anula el pago (queda registrado en el historial interno).
async function eliminar(id) {
  const r = estado.detalle.reservas.find(x => x.id === id);
  if (!r) return;
  const pago = r.pagado ? `\n\nSe anula el pago de ${pesos(r.pagado)} (${[...new Set(r.pagos.map(p => p.medio))].join(', ')}). Recuerda devolver el dinero si corresponde.` : '';
  if (!confirm(`¿Anular la reserva ${r.codigo} de ${r.nombre} (palco ${r.palco}, sillas ${r.sillas.join(', ')})?${pago}`)) return;
  try {
    await api('DELETE', `/api/reservas/${id}`);
    if (estado.editando?.id === id) cancelarEdicion();
    aviso(`Reserva ${r.codigo} anulada`);
    await cargarDetalle();
  } catch (err) {
    aviso(err.message, 'error');
  }
}

async function guardar(e) {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(form));
  datos.palco = estado.abierto;
  datos.sillas = [...estado.sillasSel];
  datos.valor = leerPesos(datos.valor);
  datos.autoriza_datos = form.autoriza_datos.checked;
  const error = $('#form-error');
  const fallar = mensaje => { error.textContent = mensaje; error.hidden = false; };
  if (datos.sillas.length === 0) return fallar('Selecciona al menos una silla en el dibujo.');
  if (estado.editando && datos.sillas.length !== estado.editando.sillas.length) {
    return fallar(`La reserva está pagada por ${plural(estado.editando.sillas.length, 'silla', 'sillas')}: elige esa misma cantidad (pueden ser otras sillas).`);
  }
  if (!estado.editando) {
    if (!datos.valor) return fallar('El valor total debe ser mayor a $ 0.');
    if (!confirm(`Confirmar pago y reserva:\n\n${datos.nombre || '(sin nombre)'} · palco ${estado.abierto} · sillas ${[...estado.sillasSel].sort((a, b) => a - b).join(', ')}\n`
      + `Valor pagado: ${pesos(datos.valor)} (${datos.medio_pago})`)) return;
  }
  if (datos.correo && !datos.autoriza_datos && !estado.editando
    && !confirm('Escribiste un correo pero no marcaste la autorización: la boleta NO se enviará. ¿Guardar de todos modos?')) return;
  guardarLocal('registrado_por', datos.registrado_por); // también viaja en el historial interno
  const boton = $('#guardar');
  boton.disabled = true;
  error.hidden = true;
  try {
    if (estado.editando) {
      await api('PUT', `/api/reservas/${estado.editando.id}`, datos);
      aviso('Cambios guardados');
    } else {
      const r = await api('POST', '/api/reservas', datos);
      aviso(`Reserva ${r.codigo} pagada · ${r.nombre}: palco ${r.palco}, sillas ${r.sillas.join(', ')}`);
      if (r.correo && r.autoriza_datos) {
        aviso(r.correoEnCola ? `Enviando la boleta a ${r.correo}…` : 'La reserva se guardó, pero el envío de correos no está configurado', r.correoEnCola ? '' : 'error');
      }
    }
    estado.editando = null;
    estado.sillasSel.clear();
    limpiarFormulario();
    await cargarDetalle();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    boton.disabled = false;
  }
}

// ── Modo organizar: categorías, empresas y asignación ───────────────────
function alternarOrganizar() {
  estado.organizar = !estado.organizar;
  if (!estado.organizar) estado.seleccion.clear();
  $('#organizar').classList.toggle('activo', estado.organizar);
  $('#organizar').textContent = estado.organizar ? 'Terminar de organizar' : 'Organizar palcos';
  $('#panel-organizar').hidden = !estado.organizar;
  $('#panel-leyenda').hidden = estado.organizar;
  svgPlano.classList.toggle('modo-organizar', estado.organizar);
  pintarOrganizar();
  pintarPalcos();
}

function pintarOrganizar() {
  if (!estado.organizar) return;
  pintarSeleccion();
  const opciones = (lista, quitar) => `<option value="">— No cambiar —</option><option value="0">${quitar}</option>`
    + lista.map(g => `<option value="${g.id}">${esc(g.nombre)}</option>`).join('');
  for (const [id, lista, quitar] of [['#asig-categoria', estado.categorias, 'Quitar categoría'], ['#asig-empresa', estado.empresas, 'Quitar empresa']]) {
    const sel = $(id);
    const antes = sel.value;
    sel.innerHTML = opciones(lista, quitar);
    if ([...sel.options].some(o => o.value === antes)) sel.value = antes;
  }
  pintarGrupos('categorias', 'categoria_id');
  pintarGrupos('empresas', 'empresa_id');
}

function pintarSeleccion() {
  const n = estado.seleccion.size;
  $('#sel-cantidad').textContent = plural(n, 'palco seleccionado', 'palcos seleccionados');
  $('#sel-lista').textContent = rangosTexto(estado.seleccion);
}

function pintarGrupos(tabla, campo) {
  const ul = $(`#lista-${tabla}`);
  if (ul.contains(document.activeElement)) return; // no interrumpir si alguien está escribiendo
  const palcos = [...estado.palcos.values()];
  ul.innerHTML = estado[tabla].map(g => {
    const cantidad = palcos.filter(p => p[campo] === g.id).length;
    return `<li data-id="${g.id}">
      <input type="color" name="color" value="${g.color}" aria-label="Color">
      <input name="nombre" value="${esc(g.nombre)}" maxlength="60" aria-label="Nombre">
      ${tabla === 'categorias' ? `<input name="precio" class="dinero precio" value="${g.precio ? pesos(g.precio) : ''}" inputmode="numeric" placeholder="Precio palco" title="Precio del palco completo" aria-label="Precio del palco completo">` : ''}
      <span class="suave pequeno">${plural(cantidad, 'palco', 'palcos')}</span>
      <button type="button" class="enlace" data-elegir title="Seleccionar sus palcos en el plano">Seleccionar</button>
      <button type="button" class="enlace peligro" data-borrar>Eliminar</button>
    </li>`;
  }).join('') || `<li class="suave pequeno">Todavía no hay ${tabla}.</li>`;
}

function seleccionar(numeros) {
  numeros.forEach(n => estado.seleccion.add(n));
  pintarSeleccion();
  pintarPalcos();
}

async function aplicarAsignacion() {
  const cuerpo = { palcos: [...estado.seleccion] };
  const cat = $('#asig-categoria').value;
  const emp = $('#asig-empresa').value;
  if (cat !== '') cuerpo.categoria_id = cat === '0' ? null : Number(cat);
  if (emp !== '') cuerpo.empresa_id = emp === '0' ? null : Number(emp);
  if (cuerpo.palcos.length === 0) return aviso('Primero selecciona palcos en el plano', 'error');
  if (cat === '' && emp === '') return aviso('Elige una categoría o una empresa para asignar', 'error');
  try {
    await api('POST', '/api/palcos/asignar', cuerpo);
    aviso(`Listo: ${plural(cuerpo.palcos.length, 'palco actualizado', 'palcos actualizados')}`);
    await cargarEstado();
  } catch (err) {
    aviso(err.message, 'error');
  }
}

// Selección por arrastre en el plano
let arrastre = null;
const rectSel = () => $('#rect-sel');

function puntoSvg(e) {
  return new DOMPoint(e.clientX, e.clientY).matrixTransform(svgPlano.getScreenCTM().inverse());
}

svgPlano.addEventListener('pointerdown', e => {
  if (!estado.organizar || e.button !== 0) return;
  const g = e.target.closest('.palco');
  arrastre = { inicio: puntoSvg(e), palco: g ? Number(g.dataset.palco) : null, movido: false, caja: null };
  svgPlano.setPointerCapture(e.pointerId);
  e.preventDefault();
});

svgPlano.addEventListener('pointermove', e => {
  if (!arrastre) return;
  const p = puntoSvg(e), a = arrastre.inicio;
  if (!arrastre.movido && Math.hypot(p.x - a.x, p.y - a.y) < 8) return;
  arrastre.movido = true;
  const caja = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) };
  arrastre.caja = caja;
  const r = rectSel();
  r.setAttribute('x', caja.x); r.setAttribute('y', caja.y);
  r.setAttribute('width', caja.w); r.setAttribute('height', caja.h);
  r.style.display = '';
});

function terminarArrastre(cancelado) {
  if (!arrastre) return;
  const { movido, palco, caja } = arrastre;
  arrastre = null;
  rectSel().style.display = 'none';
  if (cancelado) return;
  if (movido && caja) {
    const dentro = [];
    for (const [n, nodo] of nodos) {
      if (nodo.x < caja.x + caja.w && nodo.x + W > caja.x && nodo.y < caja.y + caja.h && nodo.y + H > caja.y) dentro.push(n);
    }
    seleccionar(dentro);
  } else if (palco) {
    if (estado.seleccion.has(palco)) estado.seleccion.delete(palco);
    else estado.seleccion.add(palco);
    pintarSeleccion();
    pintarPalcos();
  }
}
svgPlano.addEventListener('pointerup', () => terminarArrastre(false));
svgPlano.addEventListener('pointercancel', () => terminarArrastre(true));

// ── Búsqueda ────────────────────────────────────────────────────────────
let temporizador;

async function buscar() {
  const q = estado.busqueda;
  const caja = $('#resultados');
  if (!q) {
    caja.hidden = true;
    estado.coincidencias.clear();
    pintarPalcos();
    return;
  }
  try {
    const filas = await api('GET', `/api/buscar?q=${encodeURIComponent(q)}`);
    if (q !== estado.busqueda) return; // llegó una búsqueda más nueva
    estado.coincidencias = new Set(filas.map(r => r.palco));
    pintarPalcos();
    caja.hidden = false;
    caja.innerHTML = filas.length === 0
      ? `<p>Sin resultados para “${esc(q)}”.</p>`
      : `<table>
          <thead><tr><th>Código</th><th>Palco</th><th>Sillas</th><th>Nombre</th><th>Documento</th><th>Teléfono</th><th>Correo</th><th>Empresa</th><th>Notas</th></tr></thead>
          <tbody>${filas.map(r => `<tr data-palco="${r.palco}">
            <td>${esc(r.codigo)}</td><td><strong>${r.palco}</strong></td><td>${esc(r.sillas_texto)}</td><td>${esc(r.nombre)}</td>
            <td>${esc(r.documento)}</td><td>${esc(r.telefono)}</td><td>${esc(r.correo)}</td><td>${esc(r.empresa)}</td><td>${esc(r.notas)}</td></tr>`).join('')}
          </tbody>
        </table>${filas.length === 300 ? '<p>Mostrando los primeros 300 resultados.</p>' : ''}`;
  } catch (err) {
    aviso(err.message, 'error');
  }
}

function irAPalco(n) {
  nodos.get(n)?.g.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  destellar([n]);
  abrirPalco(n);
}

// ── Tiempo real ─────────────────────────────────────────────────────────
function conectarEventos() {
  const conexion = $('#conexion');
  const fuente = new EventSource('/api/eventos');

  fuente.onopen = () => {
    conexion.textContent = 'En línea';
    conexion.className = 'conexion en-linea';
    refrescar(null, true); // al reconectar, ponerse al día
  };
  fuente.onerror = () => {
    conexion.textContent = 'Sin conexión, reintentando…';
    conexion.className = 'conexion caida';
  };
  fuente.addEventListener('conectados', e => {
    const { total } = JSON.parse(e.data);
    conexion.textContent = `En línea · ${plural(total, 'equipo conectado', 'equipos conectados')}`;
  });
  fuente.addEventListener('cambio', e => refrescar(JSON.parse(e.data).palcos, false));
  fuente.addEventListener('config', () => refrescar(null, true));
}

async function refrescar(palcos, todo) {
  try {
    await cargarEstado();
    destellar(palcos);
    if (dialogo.open && (todo || palcos?.includes(estado.abierto))) await cargarDetalle();
    if (estado.busqueda) await buscar();
    for (const fn of alActualizar) await fn(palcos);
  } catch (err) {
    console.error(err);
  }
}

// ── Pestañas: #registro, #finanzas, #tv ─────────────────────────────────
const VISTAS = ['registro', 'finanzas', 'tv'];
const alMostrarVista = {}; // vista → función que la carga

function mostrarVista() {
  const actual = VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'registro';
  estado.vista = actual;
  for (const v of VISTAS) $(`#vista-${v}`).hidden = v !== actual;
  document.querySelectorAll('#pestanas a').forEach(a => a.classList.toggle('activa', a.dataset.vista === actual));
  document.body.classList.toggle('en-tv', actual === 'tv');
  alMostrarVista[actual]?.();
}
window.addEventListener('hashchange', mostrarVista);

// ── Eventos de la página ────────────────────────────────────────────────
svgPlano.addEventListener('click', e => {
  if (estado.organizar) return;
  const g = e.target.closest('.palco');
  if (g) abrirPalco(Number(g.dataset.palco));
});

$('#colorear').addEventListener('click', e => {
  const b = e.target.closest('[data-colorear]');
  if (!b) return;
  estado.colorear = b.dataset.colorear;
  guardarLocal('colorear', estado.colorear);
  pintarPalcos();
  pintarLeyenda();
});

$('#resaltar').addEventListener('change', e => {
  estado.resaltar = e.target.value;
  pintarPalcos();
  pintarLeyenda();
});

$('#leyenda').addEventListener('click', e => {
  const b = e.target.closest('[data-resaltar]');
  if (!b) return;
  estado.resaltar = estado.resaltar === b.dataset.resaltar ? '' : b.dataset.resaltar;
  $('#resaltar').value = estado.resaltar;
  pintarPalcos();
  pintarLeyenda();
});

$('#zoom-mas').addEventListener('click', () => aplicarZoom(ZOOMS.find(z => z > estado.zoom + 0.01) ?? 3));
$('#zoom-menos').addEventListener('click', () => aplicarZoom([...ZOOMS].reverse().find(z => z < estado.zoom - 0.01) ?? 0.3));
$('#zoom-ajustar').addEventListener('click', ajustarZoom);

$('#organizar').addEventListener('click', () => {
  alternarOrganizar();
  if (estado.organizar) revisarCorreo();
});
$('#form-correo-prueba').addEventListener('submit', async e => {
  e.preventDefault();
  const boton = e.target.querySelector('button');
  boton.disabled = true;
  try {
    await api('POST', '/api/correo/prueba', { para: e.target.para.value });
    aviso(`Correo de prueba enviado a ${e.target.para.value}. Revisa la bandeja (y el correo no deseado).`);
  } catch (err) {
    aviso(err.message, 'error');
  } finally {
    boton.disabled = false;
  }
});
$('#sel-vaciar').addEventListener('click', () => { estado.seleccion.clear(); pintarSeleccion(); pintarPalcos(); });
$('#asig-aplicar').addEventListener('click', aplicarAsignacion);

$('#form-rango').addEventListener('submit', e => {
  e.preventDefault();
  try {
    const numeros = leerRangos(e.target.rango.value);
    if (!numeros.length) return aviso('Ninguno de esos números es un palco', 'error');
    seleccionar(numeros);
    e.target.reset();
  } catch (err) {
    aviso(err.message, 'error');
  }
});

document.querySelectorAll('form[data-nuevo]').forEach(f => f.addEventListener('submit', async e => {
  e.preventDefault();
  const tabla = f.dataset.nuevo;
  try {
    await api('POST', `/api/${tabla}`, { nombre: f.nombre.value, color: f.color.value, precio: leerPesos(f.precio?.value) });
    f.nombre.value = '';
    if (f.precio) f.precio.value = '';
    f.color.value = PALETA[(estado[tabla].length + 1) % PALETA.length];
    await cargarEstado();
  } catch (err) {
    aviso(err.message, 'error');
  }
}));

for (const [tabla, campo] of [['categorias', 'categoria_id'], ['empresas', 'empresa_id']]) {
  const ul = $(`#lista-${tabla}`);
  ul.addEventListener('change', async e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    try {
      await api('PUT', `/api/${tabla}/${li.dataset.id}`, {
        nombre: li.querySelector('[name=nombre]').value,
        color: li.querySelector('[name=color]').value,
        precio: leerPesos(li.querySelector('[name=precio]')?.value),
      });
      e.target.blur();
      await cargarEstado();
    } catch (err) {
      aviso(err.message, 'error');
    }
  });
  ul.addEventListener('click', async e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const id = Number(li.dataset.id);
    if (e.target.closest('[data-elegir]')) {
      seleccionar([...estado.palcos.values()].filter(p => p[campo] === id).map(p => p.numero));
    }
    if (e.target.closest('[data-borrar]')) {
      const nombre = li.querySelector('[name=nombre]').value;
      if (!confirm(`¿Eliminar "${nombre}"? Sus palcos quedarán sin asignar (las reservas no se tocan).`)) return;
      try {
        await api('DELETE', `/api/${tabla}/${id}`);
        await cargarEstado();
      } catch (err) {
        aviso(err.message, 'error');
      }
    }
  });
}

$('#buscar').addEventListener('input', e => {
  estado.busqueda = e.target.value.trim();
  clearTimeout(temporizador);
  temporizador = setTimeout(buscar, 250);
});

$('#buscar').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const n = Number(e.target.value.trim());
  if (Number.isInteger(n) && estado.palcos.has(n)) irAPalco(n);
});

$('#resultados').addEventListener('click', e => {
  const fila = e.target.closest('[data-palco]');
  if (fila) irAPalco(Number(fila.dataset.palco));
});

$('#sillas').addEventListener('click', e => {
  const g = e.target.closest('.silla');
  if (g) tocarSilla(Number(g.dataset.silla));
});
$('#sillas').addEventListener('keydown', e => {
  const g = e.target.closest('.silla');
  if (!g || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  const n = Number(g.dataset.silla);
  tocarSilla(n);
  $(`#sillas .silla[data-silla="${n}"]`)?.focus();
});

$('#sel-libres').addEventListener('click', () => {
  if (form.hidden) return;
  const duenos = duenosDeSillas();
  for (const s of PLANO.sillas) if (!duenos.has(s.n) || esPropia(duenos.get(s.n))) estado.sillasSel.add(s.n);
  seleccionCambiada();
});
$('#sel-ninguna').addEventListener('click', () => {
  estado.sillasSel.clear();
  seleccionCambiada();
});

$('#bloquear-palco').addEventListener('click', async () => {
  const d = estado.detalle;
  if (d && await alternarBloqueo([d.numero], !d.bloqueado)) await cargarDetalle();
});
$('#sel-bloquear').addEventListener('click', () => {
  if (!estado.seleccion.size) return aviso('Primero selecciona palcos en el plano', 'error');
  alternarBloqueo([...estado.seleccion], true);
});
$('#sel-desbloquear').addEventListener('click', () => {
  if (!estado.seleccion.size) return aviso('Primero selecciona palcos en el plano', 'error');
  alternarBloqueo([...estado.seleccion], false);
});
$('#tarifa-ayuda').addEventListener('click', e => {
  if (e.target.id !== 'usar-tarifa') return;
  estado.valorManual = false;
  actualizarValorAutomatico();
  pintarSaldos();
});

$('#detalle-lista').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.editar) editar(Number(b.dataset.editar));
  if (b.dataset.eliminar) eliminar(Number(b.dataset.eliminar));
  if (b.dataset.reenviar) reenviarCorreo(Number(b.dataset.reenviar));
});

form.addEventListener('submit', guardar);
form.addEventListener('input', e => {
  if (e.target.name === 'valor') {
    estado.valorManual = e.target.value.trim() !== ''; // vaciarlo vuelve a usar la tarifa
    if (!estado.valorManual) actualizarValorAutomatico();
    else pintarTarifa();
  }
  if (e.target.name === 'valor' || e.target.name === 'medio_pago') pintarSaldos();
});
form.addEventListener('change', e => {
  if (e.target.name === 'medio_pago') pintarSaldos();
});
// Campos de dinero: se muestran como "$ 3.000.000" al salir del campo.
document.addEventListener('focusout', e => {
  if (!e.target.classList?.contains('dinero')) return;
  const v = leerPesos(e.target.value);
  e.target.value = v ? pesos(v) : '';
});
$('#completar-boton').addEventListener('click', completarPago);
// La descarga del Excel también queda en el historial interno con el nombre de este equipo.
document.addEventListener('click', e => {
  const enlace = e.target.closest('a[href^="/api/exportar.xlsx"]');
  if (enlace) enlace.href = `/api/exportar.xlsx?por=${encodeURIComponent(leerLocal('registrado_por'))}`;
});
$('#cancelar-edicion').addEventListener('click', cancelarEdicion);
$('#cerrar').addEventListener('click', () => dialogo.close());
dialogo.addEventListener('click', e => {
  // Cerrar solo al hacer clic en el fondo oscuro, fuera de la ventana.
  if (e.target !== dialogo) return;
  const r = dialogo.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialogo.close();
});
dialogo.addEventListener('close', () => {
  estado.abierto = null;
  estado.editando = null;
  estado.sillasSel.clear();
});

// ── Inicio ──────────────────────────────────────────────────────────────
construirPlano(svgPlano, nodos, vista);
aplicarZoom(estado.zoom);
// finanzas.js y tv.js se cargan después de este archivo: se arranca cuando todo está listo.
window.addEventListener('DOMContentLoaded', () => {
  mostrarVista();
  cargarEstado()
    .then(() => Promise.all(alActualizar.map(fn => fn(null))))
    .catch(err => aviso(err.message, 'error'));
  conectarEventos();
});
