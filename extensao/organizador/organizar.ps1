# Organizador da Automação de Notas
# O Chrome só salva arquivos na pasta Downloads. A extensão baixa cada ZIP para
# Downloads\Notas Sefaz\_organizar com um arquivo .destino.txt ao lado, que diz para onde ele vai.
# Este script fica rodando escondido e move cada ZIP para a pasta da empresa (ex.: ...\102026\Entrada_102026.zip).
$mutex = New-Object System.Threading.Mutex($false, 'Local\AutomacaoNotasOrganizador')
if (-not $mutex.WaitOne(0)) { exit }   # já está rodando

$downloads = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
$base = Join-Path $downloads 'Notas Sefaz\_organizar'
$pastaLog = Join-Path $env:LOCALAPPDATA 'AutomacaoNotas'
New-Item -ItemType Directory -Force -Path $pastaLog | Out-Null
$log = Join-Path $pastaLog 'organizador.log'
function Anotar($t) { Add-Content -LiteralPath $log -Value ("{0:dd/MM HH:mm:ss} {1}" -f (Get-Date), $t) -Encoding UTF8 }
Anotar "iniciado (vigiando $base)"

while ($true) {
  if (Test-Path -LiteralPath $base) {
    foreach ($guia in Get-ChildItem -LiteralPath $base -Filter '*.destino.txt' -File) {
      $zip = $guia.FullName -replace '\.destino\.txt$', ''
      if (-not (Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath "$zip.crdownload")) { continue }
      try {
        $destino = (Get-Content -LiteralPath $guia.FullName -Raw -Encoding UTF8).Trim()
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destino) | Out-Null
        Move-Item -LiteralPath $zip -Destination $destino -Force
        Remove-Item -LiteralPath $guia.FullName -Force
        Anotar "OK  $destino"
      } catch {
        Anotar "ERRO $zip -> $($_.Exception.Message)"
      }
    }
  }
  Start-Sleep -Seconds 5
}
