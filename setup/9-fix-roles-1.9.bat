@echo off
rem KUN MH - fix the roles of the Sigat members and Internal Auditors (version 1.9 upgrade).
rem Run as administrator, with the app stopped (setup\stop-app.bat). Shows what would change, then asks before saving.
setlocal
cd /d "%~dp0..\server"
if errorlevel 1 (
  echo The server folder was not found next to this setup folder.
  pause
  exit /b 1
)

echo === Fix roles (version 1.9): Sigat members and Internal Auditors ===
echo.
echo Step 1 of 2: showing what would change. Nothing is saved yet.
echo.
call npm run roles:fix-1.9 -- --dry-run
if errorlevel 1 (
  echo.
  echo The check failed. Nothing was changed. Read the message above, then press Enter.
  pause
  exit /b 1
)

echo.
set /p GO=Step 2 of 2: save these changes now? Type Y and press Enter, or just press Enter to cancel:
if /i not "%GO%"=="Y" (
  echo.
  echo Cancelled. Nothing was saved.
  pause
  exit /b 0
)

echo.
call npm run roles:fix-1.9
if errorlevel 1 (
  echo.
  echo The change failed and was not saved. Read the message above.
  pause
  exit /b 1
)

echo.
echo Next: open the app, go to Users and check the roles of SIGAT1, SIGAT2, TZAKI and TGHADIALI.
pause
exit /b 0
