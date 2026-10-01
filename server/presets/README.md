# Presets

- `families/*.json` — one file per base-model family (auto-discovered)
- `checkpoints.json` — `filename → { family, optional tag/settings overrides }`

Resolve order: **family → style → checkpoint → user text**

Unmapped checkpoints: UI prompts once and writes into `checkpoints.json`.
