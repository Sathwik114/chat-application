@echo off
title IT Support
echo Starting IT Support...
echo.
echo Make sure Django server is running on http://10.40.10.125:8001
echo.

REM Check if Django server is accessible
curl -s http://10.40.10.125:8001 >nul 2>&1
if %errorlevel% neq 0 (
    echo WARNING: Django server may not be running on http://10.40.10.125:8001
    echo Please start the Django server first.
    echo.
    echo Press any key to continue anyway...
    pause >nul
)

REM Launch Electron app
echo Launching Electron app...
node_modules\.bin\electron.cmd .

echo.
echo IT Support closed.
pause
