@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Automacao de Notas - Robo
.venv\Scripts\python robo.py
pause
