# Organizador da Automação de Notas
# O Chrome só salva arquivos na pasta Downloads. A extensão baixa cada ZIP para
# Downloads\Notas Sefaz\_organizar com um arquivo .destino.txt ao lado, que diz para onde ele vai:
#   pasta=   pasta da empresa no cadastro (pode estar vazia)
#   mae=     pasta mãe da Rotina (onde ficam as pastas das empresas)
#   codigo=  código da empresa     nome= razão social
#   arquivo= 102026\Entrada_102026.zip
# Sem pasta no cadastro, procura dentro da pasta mãe uma pasta com o código ou o nome da empresa;
# se não achar, cria "código - nome". Depois cria a pasta do mês e move o ZIP para lá.
$mutex = New-Object System.Threading.Mutex($false, 'Local\AutomacaoNotasOrganizador')
if (-not $mutex.WaitOne(0)) { exit }   # já está rodando

$downloads = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
$base = Join-Path $downloads 'Notas Sefaz\_organizar'
$pastaLog = Join-Path $env:LOCALAPPDATA 'AutomacaoNotas'
New-Item -ItemType Directory -Force -Path $pastaLog | Out-Null
$log = Join-Path $pastaLog 'organizador.log'
function Anotar($t) { Add-Content -LiteralPath $log -Value ("{0:dd/MM HH:mm:ss} {1}" -f (Get-Date), $t) -Encoding UTF8 }

function Normal($t) {
  $d = ([string]$t).Normalize([Text.NormalizationForm]::FormD)
  $s = -join ($d.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' })
  return (($s.ToUpperInvariant() -replace '[^A-Z0-9]+', ' ').Trim())
}
function Limpo($t) { return (($t -replace '[\\/:*?"<>|]+', ' ') -replace '\s+', ' ').Trim() }

function PastaDaEmpresa($g) {
  if ($g.pasta) { return $g.pasta }
  $mae = $g.mae
  New-Item -ItemType Directory -Force -Path $mae | Out-Null
  $pastas = Get-ChildItem -LiteralPath $mae -Directory -ErrorAction SilentlyContinue
  if ($g.codigo) {
    $cod = [regex]::Escape(($g.codigo.Trim() -replace '^0+', ''))
    $p = $pastas | Where-Object { (Normal $_.Name) -match "^0*$cod(\D|$)" } | Select-Object -First 1
    if ($p) { return $p.FullName }
  }
  $nome = Normal $g.nome
  if ($nome) {
    $p = $pastas | Where-Object { $n = Normal $_.Name; $n -eq $nome -or $n.EndsWith(" $nome") -or $n.Contains($nome) } | Select-Object -First 1
    if ($p) { return $p.FullName }
  }
  $novo = if ($g.codigo) { "$($g.codigo.Trim()) - $($g.nome)" } else { $g.nome }
  return (Join-Path $mae (Limpo $novo))
}

function GuiaDoNome($arquivo) {
  # Nome: <ie>_<tipo>_<mmaaaa>__<destino em base64url>.zip
  $i = $arquivo.IndexOf('__')   # o prefixo (ie_tipo_mês) não tem '__'; o base64 pode ter
  if ($i -lt 0) { return $null }
  $b = $arquivo.Substring($i + 2) -replace '\.zip$', '' -replace '\s*\(\d+\)$', ''
  $b = $b.Replace('-', '+').Replace('_', '/')
  while ($b.Length % 4) { $b += '=' }
  $j = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) | ConvertFrom-Json
  return @{ pasta = $j.p; mae = $j.m; codigo = [string]$j.c; nome = $j.n; arquivo = $j.a }
}

Anotar "iniciado (vigiando $base)"
while ($true) {
  if (Test-Path -LiteralPath $base) {
    # Formato novo: o destino vem no próprio nome do ZIP
    foreach ($zip in Get-ChildItem -LiteralPath $base -Filter '*__*.zip' -File) {
      if (Test-Path -LiteralPath "$($zip.FullName).crdownload") { continue }
      try {
        $g = GuiaDoNome $zip.Name
        if (-not $g -or -not $g.arquivo) { continue }
        $destino = Join-Path (PastaDaEmpresa $g) $g.arquivo
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destino) | Out-Null
        Move-Item -LiteralPath $zip.FullName -Destination $destino -Force
        Anotar "OK  $destino"
      } catch {
        Anotar "ERRO $($zip.Name) -> $($_.Exception.Message)"
      }
    }
    # Formato antigo: guia em arquivo .destino.txt ao lado
    foreach ($guia in Get-ChildItem -LiteralPath $base -Filter '*.destino.txt' -File) {
      $zip = $guia.FullName -replace '\.destino\.txt$', ''
      if (-not (Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath "$zip.crdownload")) { continue }
      try {
        $g = @{}
        foreach ($linha in Get-Content -LiteralPath $guia.FullName -Encoding UTF8) {
          $i = $linha.IndexOf('=')
          if ($i -gt 0) { $g[$linha.Substring(0, $i).Trim()] = $linha.Substring($i + 1).Trim() }
        }
        if (-not $g.arquivo) { throw 'guia sem o campo arquivo' }
        $destino = Join-Path (PastaDaEmpresa $g) $g.arquivo
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
