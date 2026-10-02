@echo off
cd /d "%~dp0"
title STAFF MB - Servidor
echo.
echo  STAFF MB se esta iniciando...
echo  Control:  http://localhost:3000/control
echo.
echo  Mantene esta ventana abierta mientras uses la aplicacion.
echo.
npm start
if errorlevel 1 (
  echo.
  echo  No se pudo iniciar STAFF MB.
  echo  Verifica que Node.js este instalado y volve a intentarlo.
  pause
)
