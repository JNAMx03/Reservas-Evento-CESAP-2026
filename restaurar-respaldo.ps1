# Restaurar un respaldo de la base de datos.
# 1) Muestra los respaldos disponibles (los más recientes primero).
# 2) Guarda la base actual en data\antes-de-restaurar_<fecha> (nunca se pierde nada).
# 3) Pone el respaldo elegido como base de datos.
# El sistema (iniciar.bat) debe estar CERRADO.

$raiz = $PSScriptRoot
$carpeta = 'D:\sw\BK\AREA_DE_SERVICIOS\EVENTOS\GRAN FIESTA ANUAL AFILIADOS\2026'
$config = Join-Path $raiz 'config.json'
if (Test-Path $config) {
  try {
    $c = Get-Content $config -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($c.respaldos.carpeta) { $carpeta = $c.respaldos.carpeta }
  } catch { }
}

Write-Host ""
Write-Host "  RESTAURAR UN RESPALDO" -ForegroundColor Cyan
Write-Host "  Carpeta de respaldos: $carpeta"
Write-Host ""

if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "  El sistema está abierto. Cierra primero la ventana de iniciar.bat y vuelve a ejecutar esto." -ForegroundColor Yellow
  exit 1
}

$fuentes = @(
  @{ Dir = (Join-Path $carpeta 'frecuentes'); Tipo = 'cada 15 min' },
  @{ Dir = (Join-Path $carpeta 'diarios'); Tipo = 'diario' },
  @{ Dir = (Join-Path $raiz 'data\respaldos\frecuentes'); Tipo = 'local' },
  @{ Dir = (Join-Path $raiz 'data\respaldos\diarios'); Tipo = 'local diario' }
)
$lista = @()
foreach ($f in $fuentes) {
  if (Test-Path $f.Dir) {
    $lista += Get-ChildItem $f.Dir -Filter *.db -File | ForEach-Object {
      [pscustomobject]@{ Archivo = $_; Tipo = $f.Tipo }
    }
  }
}
$lista = @($lista | Sort-Object { $_.Archivo.LastWriteTime } -Descending | Select-Object -First 40)
if ($lista.Count -eq 0) {
  Write-Host "  No se encontraron respaldos." -ForegroundColor Red
  exit 1
}

for ($i = 0; $i -lt $lista.Count; $i++) {
  $a = $lista[$i].Archivo
  Write-Host ("  {0,2}) {1:dd/MM/yyyy HH:mm}   {2,-12}  {3}" -f ($i + 1), $a.LastWriteTime, $lista[$i].Tipo, $a.Name)
}
Write-Host ""
$sel = Read-Host "  Número del respaldo a restaurar (Enter para cancelar)"
if (-not $sel) { Write-Host "  Cancelado."; exit 0 }
$n = 0
if (-not [int]::TryParse($sel, [ref]$n) -or $n -lt 1 -or $n -gt $lista.Count) {
  Write-Host "  Número inválido." -ForegroundColor Red
  exit 1
}
$elegido = $lista[$n - 1].Archivo

Write-Host ""
Write-Host "  Se restaurará: $($elegido.FullName)" -ForegroundColor Yellow
Write-Host "  Todo lo que se registró después de ese momento quedará solo en la copia de seguridad."
$ok = Read-Host "  Escribe SI para continuar"
if ($ok -ne 'SI') { Write-Host "  Cancelado."; exit 0 }

$datos = Join-Path $raiz 'data'
$seguridad = Join-Path $datos ('antes-de-restaurar_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'))
New-Item -ItemType Directory -Force $seguridad | Out-Null
foreach ($nombre in 'reservas.db', 'reservas.db-wal', 'reservas.db-shm') {
  $actual = Join-Path $datos $nombre
  if (Test-Path $actual) { Move-Item $actual $seguridad }
}
Copy-Item $elegido.FullName (Join-Path $datos 'reservas.db')

Write-Host ""
Write-Host "  Listo. Respaldo restaurado." -ForegroundColor Green
Write-Host "  La base anterior quedó guardada en: $seguridad"
Write-Host "  Ahora abre iniciar.bat."
