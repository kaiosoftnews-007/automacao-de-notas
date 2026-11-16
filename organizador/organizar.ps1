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
  $mae = if ($g.pasta) { $g.pasta } else { $g.mae }
  # Se a pasta informada já é a da empresa (tem o código ou o nome dela), usa ela mesma
  $folha = Normal (Split-Path -Leaf $mae)
  if ($g.codigo -and $folha -match ("^0*" + [regex]::Escape(($g.codigo.Trim() -replace '^0+', '')) + "(\D|$)")) { return $mae }
  if ($g.nome -and $folha -eq (Normal $g.nome)) { return $mae }
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

# ---------- Atualização da extensão (3.11.0) ----------
# A extensão baixa a versão nova para _organizar com o nome atualizar-extensao.<id>.<versão>.zip.
# O organizador acha a pasta da extensão nas configurações do Chrome/Edge (extensão "Carregar sem
# compactação" guarda o caminho em Preferences), descompacta por cima (só os arquivos que mudaram,
# manifest.json por último, nunca o credenciais.json) e grava atualizacao-status.json na pasta da
# extensão. A extensão lê esse arquivo e se recarrega.
function EhDaExtensao($p) {
  try {
    $m = Get-Content -LiteralPath (Join-Path $p 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    return ($m.name -like 'Automa*Notas*Sefaz GO')
  } catch { return $false }
}
function PastaDaExtensao($id) {
  $raizes = @((Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'), (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'))
  foreach ($r in $raizes) {
    if (-not (Test-Path -LiteralPath $r)) { continue }
    $arqs = Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      foreach ($n in 'Secure Preferences', 'Preferences') { $f = Join-Path $_.FullName $n; if (Test-Path -LiteralPath $f) { $f } } }
    foreach ($arq in $arqs) {
      try {
        $fs = [IO.File]::Open($arq, 'Open', 'Read', 'ReadWrite')
        try { $txt = (New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)).ReadToEnd() } finally { $fs.Close() }
      } catch { continue }
      $chave = '"' + $id + '":{'
      $i = $txt.IndexOf($chave)
      while ($i -ge 0) {
        $j = $txt.IndexOf('"path":"', $i)
        if ($j -gt 0 -and ($j - $i) -lt 50000) {
          $m = [regex]::Match($txt.Substring($j + 7, [Math]::Min(2000, $txt.Length - $j - 7)), '^"((?:[^"\\]|\\.)*)"')
          if ($m.Success) {
            $p = ('"' + $m.Groups[1].Value + '"') | ConvertFrom-Json
            if ([IO.Path]::IsPathRooted($p) -and (EhDaExtensao $p)) { return $p }
          }
        }
        $i = $txt.IndexOf($chave, $i + 1)
      }
    }
  }
  return $null
}
function GravarStatus($pasta, $obj) {
  $obj.em = (Get-Date).ToString('s')
  [IO.File]::WriteAllText((Join-Path $pasta 'atualizacao-status.json'), ($obj | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
}
function AtualizarExtensao($zip) {
  if ($zip.Name -notmatch '^atualizar-extensao\.([a-p]{32})\.(\d+\.\d+\.\d+)\.zip$') { return }
  $id = $Matches[1]; $versao = $Matches[2]
  $pasta = $null; $tmp = Join-Path $pastaLog ('tmp-atualizar-' + [guid]::NewGuid())
  try {
    $pasta = PastaDaExtensao $id
    if (-not $pasta) { throw "não achei a pasta da extensão $id nas configurações do Chrome/Edge" }
    Expand-Archive -LiteralPath $zip.FullName -DestinationPath $tmp -Force
    $nova = Join-Path $tmp 'extensao'
    $man = Get-Content -LiteralPath (Join-Path $nova 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($man.version -ne $versao -or $man.name -notlike 'Automa*Notas*Sefaz GO') { throw "o zip baixado não confere (versão $($man.version))" }
    $atual = (Get-Content -LiteralPath (Join-Path $pasta 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ([version]$versao -le [version]$atual) { GravarStatus $pasta @{ versao = $versao; ok = $true }; Anotar "EXTENSAO já está na $atual ($pasta)"; return }
    $n = 0
    foreach ($f in Get-ChildItem -LiteralPath $nova -Recurse -File) {
      if ($f.Name -eq 'manifest.json' -or $f.Name -eq 'credenciais.json') { continue }
      $dest = Join-Path $pasta $f.FullName.Substring($nova.Length + 1)
      if ((Test-Path -LiteralPath $dest) -and (Get-FileHash -LiteralPath $dest).Hash -eq (Get-FileHash -LiteralPath $f.FullName).Hash) { continue }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
      Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
      $n++
    }
    Copy-Item -LiteralPath (Join-Path $nova 'manifest.json') -Destination (Join-Path $pasta 'manifest.json') -Force
    GravarStatus $pasta @{ versao = $versao; ok = $true }
    Anotar "EXTENSAO $atual -> $versao ($($n + 1) arquivos) em $pasta"
  } catch {
    Anotar "ERRO atualização da extensão $versao -> $($_.Exception.Message)"
    if ($pasta) { try { GravarStatus $pasta @{ versao = $versao; ok = $false; erro = $_.Exception.Message } } catch {} }
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $zip.FullName -Force -ErrorAction SilentlyContinue
  }
}

Anotar "iniciado (vigiando $base)"
while ($true) {
  if (Test-Path -LiteralPath $base) {
    foreach ($zip in Get-ChildItem -LiteralPath $base -Filter 'atualizar-extensao.*.zip' -File) {
      if (Test-Path -LiteralPath "$($zip.FullName).crdownload") { continue }
      AtualizarExtensao $zip
    }
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
