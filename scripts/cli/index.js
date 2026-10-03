#!/usr/bin/env node
// Compatibility for installs from before the launcher moved to launcher/: their
// "Darkroom.command" / "Darkroom.bat" still start this file. It hands over to the new
// launcher, which then retires those old start files (see launcher/lib/retireStartFiles.js).
await import('../../launcher/index.js');
