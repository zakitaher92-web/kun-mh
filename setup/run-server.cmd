@echo off
rem Runs the KUN MH server. Started by the scheduled task "KUN-MH Server" (see 6-start-app.ps1).
rem The task runs as the local account kunapp (not SYSTEM, not an administrator).
rem
rem Log: kun-mh\logs\server.log. The log is checked at each start of the server:
rem - when it is larger than 10 MB, it is renamed to server-YYYYMMDD-HHMMSS.log;
rem - rotated logs older than 14 days are deleted.
rem The check runs when the server starts. A server that runs for weeks without a restart
rem keeps appending to the same file until its next start.
setlocal
set "ROOT=%~dp0.."
set "LOG=%ROOT%\logs\server.log"
set "NODE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"

rem 1. Rotate a log larger than 10 MB (10485760 bytes)
set "SIZE="
for %%F in ("%LOG%") do set "SIZE=%%~zF"
if defined SIZE if %SIZE% GTR 10485760 (
  for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%T"
  move /y "%LOG%" "%ROOT%\logs\server-%STAMP%.log" >nul
)

rem 2. Delete rotated logs older than 14 days
forfiles /P "%ROOT%\logs" /M "server-*.log" /D -14 /C "cmd /c del /q @path" 2>nul

rem 3. Start the server, output appended to the log
cd /d "%ROOT%\server"
echo. >> "%LOG%"
echo ===== %DATE% %TIME% starting the server ===== >> "%LOG%"
"%NODE%" --env-file-if-exists=.env src\server.js >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
