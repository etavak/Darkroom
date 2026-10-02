# Workflow builder

Generation prompts are assembled at runtime by `server/src/workflow/`.

Flow: **UI state → `buildWorkflow(settings)` → POST ComfyUI `/prompt`**

| Module | When | Notes |
|--------|------|--------|
| `base` | always | Checkpoint, CLIP encode, EmptyLatent, KSampler, VAEDecode, SaveImage |
| `loras` | `loras[]` non-empty | Chains `LoraLoader` between model load and prompt encode |
| `controlnet` | `controlnet.name` + `image` | `ControlNetLoader` + `ControlNetApplyAdvanced` |
| `hiresFix` | `hiresFix.enabled` | `LatentUpscaleBy` + 2nd `KSampler` |
| `detailer` | `detailer.enabled` | Impact Pack `FaceDetailer` (custom nodes required) |
| `upscale` | `upscale.enabled` | `UpscaleModelLoader` + `ImageUpscaleWithModel` |

Each module mutates shared pipeline ports (`model`, `clip`, `vae`, `positive`, `negative`, `latent`, `image`) and rewires `SaveImage` to the final image.
