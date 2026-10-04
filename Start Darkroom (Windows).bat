@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
REM Apply a launcher update staged by Update (a running .bat cannot be overwritten safely).
REM The block is parsed before it runs, so re-entering the replaced file is safe.
if exist "%~f0.new" (
  move /y "%~f0.new" "%~f0" >nul
  "%~f0" %*
  exit /b
)
set "ROOT=%CD%"
set "PIN_NODE=22.14.0"
REM Tidy up folders: Windows can't move runtime\ while the launcher runs from it, so it leaves
REM a note and the move happens here, before Node starts.
if exist "%ROOT%\runtime\.move-to-dependencies" if not exist "%ROOT%\dependencies\runtime" (
  if not exist "%ROOT%\dependencies" mkdir "%ROOT%\dependencies"
  move "%ROOT%\runtime" "%ROOT%\dependencies\runtime" >nul 2>nul
  if exist "%ROOT%\dependencies\runtime\.move-to-dependencies" del /f /q "%ROOT%\dependencies\runtime\.move-to-dependencies" >nul 2>nul
)
REM Portable Node lives in dependencies\runtime\node (older installs: runtime\node)
set "RUNTIME_NODE=%ROOT%\dependencies\runtime\node"
if not exist "%ROOT%\dependencies\runtime" if exist "%ROOT%\runtime" set "RUNTIME_NODE=%ROOT%\runtime\node"
REM Node folders an update or reinstall couldn't delete while this window's Node ran from them
if exist "%RUNTIME_NODE%\.remove" (
  for /f "usebackq delims=" %%R in ("%RUNTIME_NODE%\.remove") do (
    echo %%R| findstr /b /c:"node-v" >nul
    if not errorlevel 1 if exist "%RUNTIME_NODE%\%%R\" rmdir /s /q "%RUNTIME_NODE%\%%R"
  )
  del /f /q "%RUNTIME_NODE%\.remove" >nul 2>nul
)
set "OPS_LOG_DIR=%ROOT%\logs\ops"
if not exist "%RUNTIME_NODE%" mkdir "%RUNTIME_NODE%"
if not exist "%OPS_LOG_DIR%" mkdir "%OPS_LOG_DIR%"

set "NODE_BIN="
set "NODE_ARCH=x64"

REM Prefer Node 22 (LTS pin). Node 24+ can crash better-sqlite3 native addons.
REM DARKROOM_FORCE_PORTABLE_NODE=1 ignores an installed Node (CI uses it to test the download).
for /f "tokens=1 delims=." %%M in ("%PIN_NODE%") do set PIN_MAJOR=%%M
set "HAVE_SYSTEM_NODE="
if not defined DARKROOM_FORCE_PORTABLE_NODE (
  where node >nul 2>nul
  if not errorlevel 1 set "HAVE_SYSTEM_NODE=1"
)
if defined HAVE_SYSTEM_NODE (
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
  echo [Darkroom] Node.js %PIN_MAJOR% not found - downloading portable Node v%PIN_NODE%...
  REM Inside this block, values set here must be read with !NAME! (%NAME% is expanded
  REM before the block runs, so it would still be empty).
  set "ARCHIVE=node-v%PIN_NODE%-win-%NODE_ARCH%.zip"
  set "NODE_URL=https://nodejs.org/dist/v%PIN_NODE%/!ARCHIVE!"
  set "NODE_ZIP=%RUNTIME_NODE%\!ARCHIVE!"
  set "LOG=%OPS_LOG_DIR%\node-bootstrap.log"
  echo Downloading !NODE_URL! > "!LOG!"
  REM TLS 1.2 for older Windows PowerShell; no progress bar (it slows PowerShell 5.1 downloads a lot)
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '!NODE_ZIP!' -UseBasicParsing } catch { Write-Host ('[Darkroom] ' + $_.Exception.Message); exit 1 }" >> "!LOG!" 2>&1
  if errorlevel 1 (
    echo [Darkroom] Download failed - could not fetch !NODE_URL!
    type "!LOG!"
    echo [Darkroom] Check your internet connection, or install Node.js 22 from nodejs.org and try again.
    pause
    exit /b 1
  )
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='SilentlyContinue'; try { Expand-Archive -Path '!NODE_ZIP!' -DestinationPath '!RUNTIME_NODE!' -Force } catch { Write-Host ('[Darkroom] ' + $_.Exception.Message); exit 1 }" >> "!LOG!" 2>&1
  if errorlevel 1 (
    echo [Darkroom] Extract failed.
    type "!LOG!"
    pause
    exit /b 1
  )
  del /f /q "!NODE_ZIP!" >nul 2>nul
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
  echo [Darkroom] Installing dependencies...
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
  echo [Darkroom] Rebuilding native modules for Node !NODE_VER!...
  call "%NPM_BIN%" rebuild better-sqlite3 --prefix "%ROOT%"
  if errorlevel 1 (
    echo [Darkroom] npm rebuild failed.
    pause
    exit /b 1
  )
) else (
  REM bare require() only loads JS - native addon loads on new Database()
  "%NODE_BIN%" -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.close();" >nul 2>nul
  if errorlevel 1 (
    echo [Darkroom] Rebuilding native modules for Node !NODE_VER!...
    call "%NPM_BIN%" rebuild better-sqlite3 --prefix "%ROOT%"
    if errorlevel 1 (
      echo [Darkroom] npm rebuild failed.
      pause
      exit /b 1
    )
  )
)

REM --bootstrap-only: stop once Node and the dependencies are ready (CI checks this file this way)
if /i "%~1"=="--bootstrap-only" (
  echo [Darkroom] Bootstrap OK - Node !NODE_VER! at !NODE_BIN!
  exit /b 0
)

"%NODE_BIN%" "%ROOT%\launcher\index.js"
set EXITCODE=%ERRORLEVEL%
if not %EXITCODE%==0 (
  echo.
  echo [Darkroom] Exited with error code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
