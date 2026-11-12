@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (echo A instalacao nao terminou. Rode o INSTALAR.bat primeiro.& pause & exit /b)
set /p IE=Inscricao estadual da empresa para testar: 
.venv\Scripts\python robo.py --teste %IE%
echo.
echo ---- fim do teste. Se apareceu erro acima, tire um print desta janela. ----
pause
