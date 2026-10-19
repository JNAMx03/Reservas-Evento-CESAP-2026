# Exporta los certificados con los que este equipo se conecta a Google (incluido el del
# firewall de la red, si inspecciona las conexiones seguras) a "certificados.pem".
# iniciar.bat lo usa para que Node.js confíe en ellos, igual que Windows.
#
# Solo se exportan certificados en los que Windows ya confía: si la cadena no es de confianza,
# no se escribe nada.
param(
  [string]$Destino = (Join-Path $PSScriptRoot 'certificados.pem'),
  [string[]]$Sitios = @('script.google.com', 'script.googleusercontent.com', 'www.google.com')
)

$bloques = [ordered]@{}
foreach ($sitio in $Sitios) {
  try {
    $tcp = New-Object Net.Sockets.TcpClient($sitio, 443)
    $aceptar = [Net.Security.RemoteCertificateValidationCallback] { param($a, $b, $c, $d) $true }
    $ssl = New-Object Net.Security.SslStream($tcp.GetStream(), $false, $aceptar)
    $ssl.AuthenticateAsClient($sitio)
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
    $ssl.Dispose(); $tcp.Close()

    $cadena = New-Object Security.Cryptography.X509Certificates.X509Chain
    # Sin consultar revocación: en redes cerradas esa consulta falla aunque la cadena sea válida
    # (Node.js tampoco la hace). Lo demás —firma, vigencia y raíz instalada en Windows— sí se exige.
    $cadena.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
    if (-not $cadena.Build($cert)) {
      Write-Host "  $sitio : Windows NO confia en este certificado; se omite." -ForegroundColor Yellow
      continue
    }
    Write-Host "  $sitio" -ForegroundColor Cyan
    # Se omite el certificado del sitio (posicion 0); se guardan los intermedios y la raiz.
    foreach ($el in ($cadena.ChainElements | Select-Object -Skip 1)) {
      $c = $el.Certificate
      Write-Host "     - $($c.Subject)"
      if (-not $bloques.Contains($c.Thumbprint)) {
        $b64 = [Convert]::ToBase64String($c.RawData, 'InsertLineBreaks')
        $bloques[$c.Thumbprint] = "# $($c.Subject)`r`n-----BEGIN CERTIFICATE-----`r`n$b64`r`n-----END CERTIFICATE-----"
      }
    }
  } catch {
    Write-Host "  $sitio : no se pudo conectar ($($_.Exception.Message))" -ForegroundColor Yellow
  }
}

if ($bloques.Count -eq 0) {
  Write-Host "`nNo se exporto ningun certificado." -ForegroundColor Red
  exit 1
}
[IO.File]::WriteAllText($Destino, (($bloques.Values -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)
Write-Host "`nListo: $($bloques.Count) certificado(s) guardados en $Destino" -ForegroundColor Green
Write-Host "Cierra y vuelve a abrir iniciar.bat para que el sistema los use."
