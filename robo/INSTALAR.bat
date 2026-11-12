@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (echo.& echo Python nao encontrado. Instale o Python 3.12 em python.org e marque "Add python.exe to PATH".& pause & exit /b)
echo Instalando o robo...
python -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip -q
.venv\Scripts\pip install -r requirements.txt -q
if not exist .env copy .env.exemplo .env >nul
schtasks /Create /TN "Automacao de Notas - Robo" /TR "\"%~dp0INICIAR.bat\"" /SC ONLOGON /RL LIMITED /F >nul
echo.
echo Pronto! O robo vai abrir sozinho toda vez que o Windows iniciar.
echo Agora cole a chave secreta do Supabase no arquivo que vai abrir e salve.
notepad .env
pause
