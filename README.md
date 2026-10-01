# Darkroom

Local image generation UI inspired by NovelAI / SeaArt, backed by a headless [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance.

Works on **Windows**, **macOS**, and **Linux**.

<p align="center">
  <img src="docs/screenshots/menu.svg" alt="Darkroom terminal menu" width="720" />
</p>
<p align="center">
  <img src="docs/screenshots/generate.svg" alt="Darkroom generate UI" width="720" />
</p>

## Requirements

- **Node.js 22+** ([download](https://nodejs.org/))
- A ComfyUI install **or** a remote ComfyUI URL (setup wizard handles both)

## Quick start

### Windows

1. Install [Node.js 22 LTS](https://nodejs.org/).
2. Clone this repo and double-click **`Darkroom.bat`**.
3. On first run, the setup wizard asks you to:
   - use an existing ComfyUI folder,
   - download the Windows portable build, or
   - point at a remote ComfyUI URL.
4. Use **Start Darkroom** from the menu.

### macOS

**1. Recommended — one-liner** (clones or updates `~/Darkroom`, then launches):

```bash
curl -fsSL https://raw.githubusercontent.com/etavak/Darkroom/main/install.sh | bash
```

If git is missing, the script offers **Xcode Command Line Tools** (`xcode-select --install`), waits until git works, then continues.

**2. Git clone** (if you already have git / CLT):

```bash
git clone https://github.com/etavak/Darkroom.git ~/Darkroom
cd ~/Darkroom
bash Darkroom.command
```

**3. ZIP download** (when you cannot use git):

1. Download the repo ZIP from GitHub and unzip it.
2. If macOS blocks the app on first launch, open **System Settings → Privacy & Security**, scroll to the blocked-item message, and click **Open Anyway**. Confirm when prompted.
3. Or clear the quarantine flag in Terminal (replace the path with your unzipped folder):

```bash
xattr -dr com.apple.quarantine ~/Downloads/Darkroom-main
cd ~/Downloads/Darkroom-main
bash Darkroom.command
```

`Darkroom.command` bootstraps portable Node 22+ into `runtime/node/` if needed, then opens the setup wizard. Complete first-run (**Install everything** / Use existing / Remote), then **Start Darkroom**.

> Note: **right-click → Open** no longer bypasses Gatekeeper on current macOS — use Privacy & Security → Open Anyway, `xattr`, or the curl/git methods above.

### Linux

1. Install Node.js 22+ (NodeSource, nvm, or your distro’s package).
2. Clone this repo and run:

```bash
chmod +x Darkroom.sh
./Darkroom.sh
```

3. First-run wizard: use existing ComfyUI, install via `git clone` + venv + PyTorch (CUDA index when NVIDIA is detected), or remote URL.

## What the setup wizard does

When `.env` is missing:

1. **Use existing ComfyUI** — auto-detects common portable / `venv` / `.venv` paths, or accepts a pasted path. Validates `main.py` and Python.
2. **Install ComfyUI** — Windows: latest portable `.7z` from ComfyUI’s GitHub (extracted with `7zip-bin`). macOS/Linux: clone, venv, install torch + requirements.
3. **Remote ComfyUI** — URL only. Darkroom will **not** start ComfyUI; model install actions are hidden. The remote process must use `--listen` (e.g. `--listen 0.0.0.0`).

Then it downloads **TAESD** decoders (local mode) and **tag CSVs**, and writes `.env`.

## Development

```bash
npm install
npm run dev
```

- UI (Vite): http://localhost:5173  
- API: http://localhost:3001  

```bash
npm run build
npm start
```

```bash
npm run typecheck
npm run lint
```

Mock ComfyUI for API smoke tests only:

```bash
MOCK=true npm run mock:comfy
```

## Configuration

Copy [`.env.example`](.env.example) or let the wizard write `.env` (never commit `.env`).

| Variable | Meaning |
|----------|---------|
| `PORT` | Darkroom server port (default `3001`) |
| `COMFY_URL` | ComfyUI base URL |
| `COMFY_MODE` | `local` or `remote` |
| `COMFY_DIR` | Local ComfyUI / portable root |
| `COMFY_PYTHON` | Optional Python override |
| `CIVITAI_TOKEN` | Optional Civitai downloads |

## Features

- Prompt / negative with family-aware tag autocomplete
- Checkpoint + style presets (family → style → checkpoint → user)
- Aspect presets, seed, batch, live progress / preview
- History gallery
- One-click menu: start/stop, model install & download, custom nodes, updates, diagnostics

## License

MIT License

Copyright (c) 2026 etavak

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
