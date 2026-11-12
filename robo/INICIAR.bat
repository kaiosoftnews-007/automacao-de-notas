@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Automacao de Notas - Robo
if not exist .venv\Scripts\python.exe (echo A instalacao nao terminou. Rode o INSTALAR.bat primeiro.& pause & exit /b)
.venv\Scripts\python robo.py
pause
