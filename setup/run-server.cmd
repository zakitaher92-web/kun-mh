@echo off
rem Runs the KUN MH server. Started by the scheduled task "KUN-MH Server" (see 6-start-app.bat).
rem Output is appended to kun-mh\logs\server.log.
setlocal
set "ROOT=%~dp0.."
set "NODE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
cd /d "%ROOT%\server"
echo. >> "%ROOT%\logs\server.log"
echo ===== %DATE% %TIME% starting the server ===== >> "%ROOT%\logs\server.log"
"%NODE%" --env-file-if-exists=.env src\server.js >> "%ROOT%\logs\server.log" 2>&1
exit /b %ERRORLEVEL%
