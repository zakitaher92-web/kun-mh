@echo off
rem KUN MH - budget codes (version 1.9 update): MT-01..05, HK-01 and HK-02 become one line MT, new line SR,
rem and the HK item codes become ITM codes. Run as administrator, with the app stopped (setup\stop-app.bat).
rem Shows the change first, then asks before saving. A backup of every document that changes is written first.
setlocal
cd /d "%~dp0..\server"
if errorlevel 1 (
  echo The server folder was not found next to this setup folder.
  pause
  exit /b 1
)

set "BACKUPS=%~dp0..\..\backups"
if not exist "%BACKUPS%" mkdir "%BACKUPS%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"
set "BACKUP=%BACKUPS%\budget-merge-%STAMP%.json"

echo === Budget codes (version 1.9): MT and SR, ITM item codes ===
echo.
echo Step 1 of 2: showing the change. Nothing is saved yet.
echo.
call npm run budget:merge -- --dry-run
if errorlevel 1 (
  echo.
  echo The check failed. Nothing was changed. If it says the old budget lines were not found, the change was
  echo already made. Read the message above, then press Enter.
  pause
  exit /b 1
)

echo.
set /p GO=Step 2 of 2: save this change now? Type Y and press Enter, or just press Enter to cancel:
if /i not "%GO%"=="Y" (
  echo.
  echo Cancelled. Nothing was saved.
  pause
  exit /b 0
)

echo.
echo Backup: %BACKUP%
call npm run budget:merge -- --apply --backup "%BACKUP%"
if errorlevel 1 (
  echo.
  echo The change failed and was not saved. Read the message above.
  pause
  exit /b 1
)

echo.
echo Next: start the app (setup\6-start-app.bat) and check Budget, Items and Categories.
pause
exit /b 0
