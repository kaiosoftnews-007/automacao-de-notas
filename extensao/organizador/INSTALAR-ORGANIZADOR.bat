@echo off
chcp 65001 >nul
echo Instalando o organizador da Automacao de Notas...
set "DEST=%LOCALAPPDATA%\AutomacaoNotas"
if not exist "%DEST%" mkdir "%DEST%"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*organizar.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
copy /y "%~dp0organizar.ps1" "%DEST%\" >nul
copy /y "%~dp0organizar.vbs" "%DEST%\" >nul
copy /y "%~dp0organizar.vbs" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AutomacaoNotas-organizador.vbs" >nul
wscript "%DEST%\organizar.vbs"
echo.
echo Pronto. O organizador ja esta rodando e vai abrir sozinho quando o Windows ligar.
echo Historico: %DEST%\organizador.log
echo.
pause
