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

1. Install [Node.js 22 LTS](https://nodejs.org/).
2. Clone this repo.
3. Double-click **`Darkroom.command`** (right-click → Open the first time if Gatekeeper blocks it),  
   or in Terminal:

```bash
chmod +x Darkroom.command Darkroom.sh
./Darkroom.command
```

4. Complete the first-run wizard (detect / install / remote), then **Start Darkroom**.

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

MIT (add a `LICENSE` file when you publish).
