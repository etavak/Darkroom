# Darkroom

A local image-generation studio inspired by NovelAI / SeaArt, running on a headless [ComfyUI](https://github.com/comfyanonymous/ComfyUI). Darkroom installs and manages ComfyUI for you, so you never touch a node graph.

Works on **Windows**, **macOS** (Apple Silicon recommended), and **Linux**.

<p align="center">
  <img src="docs/screenshots/menu.svg" alt="Darkroom terminal menu" width="720" />
</p>
<p align="center">
  <img src="docs/screenshots/generate.svg" alt="Darkroom generate UI" width="720" />
</p>

## Install

You don't need Node or Python beforehand — the launcher downloads what it needs into the Darkroom folder. On macOS, **Install everything** may ask to install Apple's Command Line Tools (for git); on Linux, install `git` from your package manager first.

1. **Download** the ZIP: **Code → Download ZIP** on GitHub, then unzip it anywhere (e.g. your Documents folder).
2. **Open the launcher** for your system:
   - **Windows:** double-click `Darkroom.bat`.
   - **macOS:** double-click `Darkroom.command`. If macOS blocks it, open **System Settings → Privacy & Security**, scroll to the message about Darkroom, and click **Open Anyway**. (Or run `xattr -dr com.apple.quarantine` on the folder in Terminal.)
   - **Linux:** run `./Darkroom.sh` (`chmod +x Darkroom.sh` first if needed).
3. **First run** opens the setup menu. Pick one:
   - **Install everything** — downloads ComfyUI and PyTorch for your hardware (NVIDIA CUDA, Apple Silicon MPS, or CPU) into the Darkroom folder.
   - **Use existing ComfyUI** — point at a ComfyUI you already have (source, Windows portable, or the Desktop app).
   - **Remote ComfyUI** — use ComfyUI running on another machine (it must be started with `--listen`).
4. Choose **Start Darkroom**. ComfyUI and the Darkroom server start and your browser opens.

Next time, just open the launcher again and choose **Start Darkroom**.

<details>
<summary>Prefer git? (macOS / Linux one-liner)</summary>

```bash
curl -fsSL https://raw.githubusercontent.com/etavak/Darkroom/main/install.sh | bash
```

Clones (or updates) `~/Darkroom` and launches it. If git is missing on macOS, it offers the Xcode Command Line Tools and waits for them.
</details>

## Adding models

From the launcher menu: **Install model from file** (drag a file into the terminal), **Download model from URL** (Civitai, Hugging Face, or a direct link), or **Manage models**. In the web UI, use **Add model…** in any model picker.

- The model type is detected from the file. Checkpoints and diffusion models ask for their **family** (SDXL, Pony, Illustrious, NoobAI, Flux, SD3, …) so the right defaults and tags apply.
- Families that need extra files (text encoders, VAE) offer to download them, sized to your VRAM and checksum-verified.
- Files outside ComfyUI can be **linked** instead of copied.
- `.gguf` quantized models are supported via the optional ComfyUI-GGUF node (offered automatically).

## Features

- **Generate** with family-aware presets — tags, sampler, CFG, and resolution follow the model family and style; injected tags are shown as chips you can dismiss.
- **Prompting** — Danbooru / e621 tag autocomplete with unknown-tag hints, token counter, recent prompts and snippets, `{a|b}` and `__wildcard__` files, optional LLM prompt enhance.
- **Source modes** — img2img, outpaint, and instruction edit (Flux Kontext / Qwen Image Edit).
- **Extras** — LoRA stacks, ControlNet (with canny / depth / openpose preprocessors), hires fix, face detailer, model upscaling, Vary.
- **Queue** — reorderable job queue, generate-forever, live previews, cancel a single job.
- **History** — gallery with favorites, undo delete, parent / derived links, A/B compare, PNG metadata; drop a PNG on the canvas to load its settings, or **Reuse** any result.
- **Use it from your phone** — **Start backend only** prints a LAN URL; the UI works on phones and tablets.

## Updating

Choose **Update** in the launcher menu. Darkroom downloads the latest version from GitHub and applies it in place, keeping your settings, history, models, and ComfyUI. Anything replaced is backed up and restored automatically if the update fails. ComfyUI, PyTorch, and the other components can be updated from the same menu.

## Troubleshooting

- **Doctor** (launcher menu) checks every component and offers repairs.
- **Diagnostics** shows your system, GPU, and paths; **Preferences → Advanced → Diagnostics** in the web UI copies a report with recent logs.
- Logs live in `logs/` (`comfyui.log`, `server.log`, and per-operation logs in `logs/ops/`).

## Configuration

The setup wizard writes `.env` (see [`.env.example`](.env.example)); you rarely need to edit it.

| Variable | Meaning |
|----------|---------|
| `PORT` | Darkroom server port (default `3001`) |
| `COMFY_URL` | ComfyUI base URL |
| `COMFY_MODE` | `local` (Darkroom starts ComfyUI) or `remote` |
| `COMFY_DIR` | Local ComfyUI / Windows portable root |
| `COMFY_PYTHON` | Optional Python override |
| `CIVITAI_TOKEN` / `HF_TOKEN` | Optional tokens for gated or early-access downloads |

Most other options live in the web UI under **Preferences**.

## Development

Requires Node.js 22.

```bash
npm install
npm run dev        # UI on http://localhost:5173, API on http://localhost:3001
npm run typecheck
npm run lint
```

`npm run build && npm start` serves the production build. A minimal fake ComfyUI for API smoke tests: `MOCK=true npm run mock:comfy`.

## License

MIT — see [LICENSE](LICENSE).
