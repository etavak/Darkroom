"""
Darkroom fixes for ComfyUI — installed and kept up to date by the Darkroom launcher
(it copies this folder into ComfyUI/custom_nodes each time it starts ComfyUI).

Adds no nodes. It only works around known runtime bugs:

* Apple Silicon (MPS): "Upscale Image (using Model)" passes the upscale model image
  tiles that are views of a reordered tensor (not contiguous in memory). On MPS,
  PyTorch's conv2d rejects those with "view size is not compatible with input tensor's
  size and stride". Handing the model a contiguous copy of each tile fixes it; the copy
  is the size of one tile and harmless on other devices.
"""

import logging

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

try:
    import torch
    from spandrel import ImageModelDescriptor

    if not getattr(ImageModelDescriptor.__call__, "_darkroom_contiguous", False):
        _original_call = ImageModelDescriptor.__call__

        def _contiguous_call(self, image, *args, **kwargs):
            if isinstance(image, torch.Tensor) and not image.is_contiguous():
                image = image.contiguous()
            return _original_call(self, image, *args, **kwargs)

        _contiguous_call._darkroom_contiguous = True
        ImageModelDescriptor.__call__ = _contiguous_call
        logging.info("[Darkroom] Upscale models get contiguous tiles (fixes MPS 'view size is not compatible').")
except Exception as e:  # never stop ComfyUI from starting
    logging.warning(f"[Darkroom] Could not apply the upscale fix: {e}")
