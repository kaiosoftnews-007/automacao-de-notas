@echo off
chcp 65001 >nul
echo Instalando o organizador da Automacao de Notas...
set "DEST=%LOCALAPPDATA%\AutomacaoNotas"
set "INICIO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if not exist "%DEST%" mkdir "%DEST%"

rem Para o organizador que estiver rodando (versao antiga ou nova)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*organizar.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

rem Remove o jeito antigo de iniciar (arquivo .vbs), que o Windows Defender estranhava
if exist "%INICIO%\AutomacaoNotas-organizador.vbs" del /q "%INICIO%\AutomacaoNotas-organizador.vbs"
if exist "%DEST%\organizar.vbs" del /q "%DEST%\organizar.vbs"

copy /y "%~dp0organizar.ps1" "%DEST%\" >nul
powershell -NoProfile -Command "Unblock-File -LiteralPath '%DEST%\organizar.ps1'" >nul 2>&1

rem Atalho na Inicializacao do Windows: abre o organizador sem janela quando voce entra no computador
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%INICIO%\Automacao de Notas - organizador.lnk'); $s.TargetPath='powershell.exe'; $s.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%DEST%\organizar.ps1\"'; $s.WindowStyle=7; $s.Description='Organizador da Automacao de Notas'; $s.Save()"

rem Liga agora
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%DEST%\organizar.ps1"

echo.
echo Pronto. O organizador ja esta rodando e vai abrir sozinho quando o Windows ligar.
echo Historico: %DEST%\organizador.log
echo.
pause
