@echo off
echo Building Electron App to .exe...
cd /d "%~dp0"

echo Installing dependencies...
call npm install

echo.
echo Building Windows executable...
call npm run build-win

echo.
echo Build complete!
echo Check the 'dist' folder for your .exe file
echo.
echo The installer will be located at:
echo   dist\IT Support Setup 1.0.13.exe
echo.
pause
