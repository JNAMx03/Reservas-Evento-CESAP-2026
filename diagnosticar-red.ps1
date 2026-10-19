# Diagnóstico: muestra qué certificado presenta cada sitio de Google al servidor
# (para saber si el firewall de la red lo intercepta o lo bloquea) y qué responde el script.
$sitios = @('script.google.com', 'script.googleusercontent.com', 'www.google.com', 'gmail.googleapis.com', 'oauth2.googleapis.com')

foreach ($sitio in $sitios) {
  Write-Host ""
  Write-Host "== $sitio" -ForegroundColor Cyan
  try {
    $tcp = New-Object Net.Sockets.TcpClient($sitio, 443)
    $aceptar = [Net.Security.RemoteCertificateValidationCallback] { param($a, $b, $c, $d) $true }
    $ssl = New-Object Net.Security.SslStream($tcp.GetStream(), $false, $aceptar)
    $ssl.AuthenticateAsClient($sitio)
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
    $ssl.Dispose(); $tcp.Close()
    $cadena = New-Object Security.Cryptography.X509Certificates.X509Chain
    $cadena.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
    $confia = $cadena.Build($cert)
    Write-Host "   Certificado para: $($cert.Subject)"
    Write-Host "   Emitido por:      $($cert.Issuer)"
    if ($confia) { Write-Host "   Windows confia:   SI" -ForegroundColor Green }
    else {
      Write-Host "   Windows confia:   NO" -ForegroundColor Yellow
      foreach ($s in $cadena.ChainStatus) { Write-Host "     motivo: $($s.StatusInformation.Trim())" -ForegroundColor Yellow }
    }
    foreach ($el in $cadena.ChainElements) { Write-Host "     cadena: $($el.Certificate.Subject)" }
  } catch {
    Write-Host "   No se pudo conectar: $($_.Exception.Message)" -ForegroundColor Red
  }
}

# Qué responde la URL del script configurada en config.json (sin validar el certificado,
# solo para ver si es Google o una página de bloqueo del firewall).
$archivo = Join-Path $PSScriptRoot 'config.json'
if (Test-Path $archivo) {
  $url = (Get-Content $archivo -Raw | ConvertFrom-Json).correo.google_script.url
  if ($url) {
    Write-Host ""
    Write-Host "== Respuesta de la URL del script" -ForegroundColor Cyan
    try {
      Add-Type -TypeDefinition @'
public static class SinValidar {
  static bool Si(object a, System.Security.Cryptography.X509Certificates.X509Certificate b,
                 System.Security.Cryptography.X509Certificates.X509Chain c, System.Net.Security.SslPolicyErrors d) { return true; }
  public static System.Net.Security.RemoteCertificateValidationCallback Funcion { get { return Si; } }
}
'@ -ErrorAction SilentlyContinue
      [Net.ServicePointManager]::ServerCertificateValidationCallback = [SinValidar]::Funcion
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop
      $texto = $r.Content
      Write-Host "   Estado: $($r.StatusCode)"
    } catch {
      $resp = $_.Exception.Response
      if ($resp) {
        Write-Host "   Estado: $([int]$resp.StatusCode)  Redirige a: $($resp.Headers['Location'])"
        $texto = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
      } else { Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red }
    }
    if ($texto) {
      $limpio = ($texto -replace '<script[\s\S]*?</script>', '' -replace '<style[\s\S]*?</style>', '' -replace '<[^>]+>', ' ' -replace '\s+', ' ').Trim()
      Write-Host "   Contenido: $($limpio.Substring(0, [Math]::Min(400, $limpio.Length)))"
    }
  }
}
Write-Host ""
