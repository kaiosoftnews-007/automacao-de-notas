' Inicia o organizador da Automação de Notas sem abrir janela.
Set sh = CreateObject("WScript.Shell")
pasta = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\AutomacaoNotas"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & pasta & "\organizar.ps1""", 0, False
