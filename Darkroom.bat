@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
REM Apply a launcher update staged by Update (a running .bat cannot be overwritten safely).
REM The block is parsed before it runs, so re-entering the replaced file is safe.
if exist "%~dp0Darkroom.bat.new" (
  move /y "%~dp0Darkroom.bat.new" "%~f0" >nul
  "%~f0" %*
  exit /b
)
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
      for /f "tokens=1 delims=v" %%V in ('"%%D\node.exe" -v') do set PORTVER=%%V
      for /f "tokens=1 delims=." %%M in ("!PORTVER!") do set PORTMAJOR=%%M
      if "!PORTMAJOR!"=="!PIN_MAJOR!" (
        set "NODE_BIN=%%D\node.exe"
        goto :have_node
      )
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
    if exist "%%D\node.exe" (
      for /f "tokens=1 delims=v" %%V in ('"%%D\node.exe" -v') do set PORTVER=%%V
      for /f "tokens=1 delims=." %%M in ("!PORTVER!") do set PORTMAJOR=%%M
      if "!PORTMAJOR!"=="!PIN_MAJOR!" set "NODE_BIN=%%D\node.exe"
    )
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
REM Put this Node first so npm/node-gyp never pick a different major from PATH.
set "PATH=%NODE_DIR%;%PATH%"

for /f "delims=" %%V in ('"%NODE_BIN%" -v') do set "NODE_VER=%%V"

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
  echo [Darkroom] Rebuilding native modules for Node !NODE_VER!…
  call "%NPM_BIN%" rebuild better-sqlite3 --prefix "%ROOT%"
  if errorlevel 1 (
    echo [Darkroom] npm rebuild failed.
    pause
    exit /b 1
  )
) else (
  REM bare require() only loads JS — native addon loads on new Database()
  "%NODE_BIN%" -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.close();" >nul 2>nul
  if errorlevel 1 (
    echo [Darkroom] Rebuilding native modules for Node !NODE_VER!…
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
