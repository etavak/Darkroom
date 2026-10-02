# Presets

- `families/*.json` — one file per base-model family (auto-discovered)
- `checkpoints.json` — `filename → { family, optional tag/settings overrides }`
- `components.json` — downloadable companions (TE/VAE) with HF urls, sizeBytes, sha256

Family `dependencies` list roles (`clip_l`, `t5`, `vae`, …) with `options` pointing at
component ids. After a model is installed and mapped to a family, CLI and UI share the
same resolver to skip satisfied roles, prompt for choices, confirm total size, then
download with sha256 verification.

Resolve order: **family → style → checkpoint → user text**

Unmapped checkpoints: UI prompts once and writes into `checkpoints.json`.
