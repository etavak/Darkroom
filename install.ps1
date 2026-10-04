# One-liner installer for Windows: download Darkroom into %USERPROFILE%\Darkroom, then launch it.
# The Windows counterpart of install.sh. No git needed - Darkroom updates itself from its menu.
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/etavak/Darkroom/main/install.ps1 | iex
# Runs in its own scope so `irm | iex` leaves the PowerShell window as it was (and open).
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $repo = if ($env:DARKROOM_REPO) { $env:DARKROOM_REPO } else { 'etavak/Darkroom' }
  $dest = if ($env:DARKROOM_HOME) { $env:DARKROOM_HOME } else { Join-Path $HOME 'Darkroom' }
  $start = Join-Path $dest 'Start Darkroom (Windows).bat'
  Write-Host "[Darkroom] Install target: $dest"

  if (Test-Path -LiteralPath $start) {
    Write-Host '[Darkroom] Already installed - opening it. (Update it from its menu: Update.)'
  } elseif (Test-Path -LiteralPath $dest) {
    Write-Host "[Darkroom] $dest exists but is not Darkroom."
    Write-Host 'Move it aside, or set DARKROOM_HOME to a different folder, then run this again.'
    return
  } else {
    $zip = Join-Path $env:TEMP 'darkroom-main.zip'
    $tmp = Join-Path $env:TEMP ('darkroom-' + [guid]::NewGuid())
    try {
      Write-Host '[Darkroom] Downloading...'
      Invoke-WebRequest -Uri "https://codeload.github.com/$repo/zip/refs/heads/main" -OutFile $zip -UseBasicParsing
      Write-Host '[Darkroom] Extracting...'
      Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
      # GitHub wraps everything in one <repo>-main folder
      $inner = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
      Move-Item -LiteralPath $inner.FullName -Destination $dest
    } catch {
      Write-Host "[Darkroom] Install failed: $($_.Exception.Message)"
      return
    } finally {
      Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host '[Darkroom] Launching...'
  & cmd.exe /c "`"$start`""
}
