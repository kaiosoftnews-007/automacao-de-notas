@echo off
chcp 65001 >nul
cd /d "%~dp0"
set /p IE=Inscricao estadual da empresa para testar: 
.venv\Scripts\python robo.py --teste %IE%
