@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Darkroom] Node.js was not found on PATH.
  echo Install Node.js 22 or newer from:
  echo   https://nodejs.org/
  pause
  exit /b 1
)

for /f "tokens=1 delims=v" %%V in ('node -v') do set NODEVER=%%V
for /f "tokens=1 delims=." %%M in ("!NODEVER!") do set NODEMAJOR=%%M
if not defined NODEMAJOR set NODEMAJOR=0
if !NODEMAJOR! LSS 22 (
  echo [Darkroom] Node.js 22+ is required. Found: v!NODEVER!
  echo Download Node.js 22 LTS from:
  echo   https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\@clack\prompts" (
  echo [Darkroom] Installing dependencies…
  call npm install
  if errorlevel 1 (
    echo [Darkroom] npm install failed.
    pause
    exit /b 1
  )
)

node scripts\cli\index.js
set EXITCODE=%ERRORLEVEL%
if not %EXITCODE%==0 (
  echo.
  echo [Darkroom] Exited with error code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
