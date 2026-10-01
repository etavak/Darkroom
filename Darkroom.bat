@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "ROOT=%CD%"
set "PIN_NODE=22.14.0"
set "RUNTIME_NODE=%ROOT%\runtime\node"
set "OPS_LOG_DIR=%ROOT%\logs\ops"
if not exist "%RUNTIME_NODE%" mkdir "%RUNTIME_NODE%"
if not exist "%OPS_LOG_DIR%" mkdir "%OPS_LOG_DIR%"

set "NODE_BIN="
set "NODE_ARCH=x64"

REM Prefer Node 22 (LTS pin). Node 24+ can crash better-sqlite3 native addons.
for /f "tokens=1 delims=." %%M in ("%PIN_NODE%") do set PIN_MAJOR=%%M
where node >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=1 delims=v" %%V in ('node -v') do set NODEVER=%%V
  for /f "tokens=1 delims=." %%M in ("!NODEVER!") do set NODEMAJOR=%%M
  if not defined NODEMAJOR set NODEMAJOR=0
  if "!NODEMAJOR!"=="!PIN_MAJOR!" (
    for /f "delims=" %%P in ('where node') do (
      if not defined NODE_BIN set "NODE_BIN=%%P"
    )
  )
)

if not defined NODE_BIN (
  for /d %%D in ("%RUNTIME_NODE%\node-v*-win-%NODE_ARCH%") do (
    if exist "%%D\node.exe" (
      set "NODE_BIN=%%D\node.exe"
      goto :have_node
    )
  )
)
:have_node

if not defined NODE_BIN (
  echo [Darkroom] Node.js %PIN_MAJOR% not found — downloading portable Node v%PIN_NODE%…
  set "ARCHIVE=node-v%PIN_NODE%-win-%NODE_ARCH%.zip"
  set "URL=https://nodejs.org/dist/v%PIN_NODE%/!ARCHIVE!"
  set "TMP=%RUNTIME_NODE%\!ARCHIVE!"
  set "LOG=%OPS_LOG_DIR%\node-bootstrap.log"
  echo Downloading !URL! > "!LOG!"
  powershell -NoProfile -Command ^
    "try { Invoke-WebRequest -Uri '%URL%' -OutFile '%TMP%' -UseBasicParsing } catch { exit 1 }"
  if errorlevel 1 (
    echo [Darkroom] Download failed.
    pause
    exit /b 1
  )
  powershell -NoProfile -Command ^
    "Expand-Archive -Path '%TMP%' -DestinationPath '%RUNTIME_NODE%' -Force"
  if errorlevel 1 (
    echo [Darkroom] Extract failed.
    pause
    exit /b 1
  )
  del /f /q "%TMP%" >nul 2>nul
  for /d %%D in ("%RUNTIME_NODE%\node-v*-win-%NODE_ARCH%") do (
    if exist "%%D\node.exe" set "NODE_BIN=%%D\node.exe"
  )
)

if not defined NODE_BIN (
  echo [Darkroom] Could not locate Node binary.
  pause
  exit /b 1
)

set "NODE_DIR=%NODE_BIN%"
for %%I in ("%NODE_BIN%") do set "NODE_DIR=%%~dpI"
set "NPM_BIN=%NODE_DIR%npm.cmd"

if not exist "%ROOT%\node_modules\@clack\prompts" (
  echo [Darkroom] Installing dependencies…
  if exist "%ROOT%\package-lock.json" (
    call "%NPM_BIN%" ci --prefix "%ROOT%"
    if errorlevel 1 call "%NPM_BIN%" install --prefix "%ROOT%"
  ) else (
    call "%NPM_BIN%" install --prefix "%ROOT%"
  )
  if errorlevel 1 (
    echo [Darkroom] npm install failed.
    pause
    exit /b 1
  )
) else (
  "%NODE_BIN%" -e "require('better-sqlite3')" >nul 2>nul
  if errorlevel 1 (
    echo [Darkroom] Rebuilding native modules for current Node…
    call "%NPM_BIN%" rebuild better-sqlite3 --prefix "%ROOT%"
    if errorlevel 1 (
      echo [Darkroom] npm rebuild failed.
      pause
      exit /b 1
    )
  )
)

"%NODE_BIN%" "%ROOT%\scripts\cli\index.js"
set EXITCODE=%ERRORLEVEL%
if not %EXITCODE%==0 (
  echo.
  echo [Darkroom] Exited with error code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
