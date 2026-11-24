@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-events.ps1" %*
