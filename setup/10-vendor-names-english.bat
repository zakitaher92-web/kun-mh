@echo off
rem KUN MH - vendor names in English (version 1.9 update).
rem Run as administrator, with the app stopped (setup\stop-app.bat). Shows the vendor renames first, then asks before saving.
rem A backup of every document that changes is written to the backups folder before the change.
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
set "BACKUP=%BACKUPS%\vendor-names-%STAMP%.json"

echo === Vendor names in English (version 1.9) ===
echo.
echo Step 1 of 2: showing the vendor renames. Nothing is saved yet.
echo.
call npm run vendors:english -- --dry-run
if errorlevel 1 (
  echo.
  echo The check failed. Nothing was changed. Read the message above, then press Enter.
  pause
  exit /b 1
)

echo.
echo Check the new names against the trade licences. Names marked (2) may be duplicates.
set /p GO=Step 2 of 2: save these renames now? Type Y and press Enter, or just press Enter to cancel:
if /i not "%GO%"=="Y" (
  echo.
  echo Cancelled. Nothing was saved.
  pause
  exit /b 0
)

echo.
echo Backup: %BACKUP%
call npm run vendors:english -- --apply --backup "%BACKUP%"
if errorlevel 1 (
  echo.
  echo The rename failed and was not saved. Read the message above.
  pause
  exit /b 1
)

echo.
echo Next: open Vendors and check the names. Then run setup\11-budget-merge-1.9.bat.
pause
exit /b 0
