import type { ComfyNode, ComfyPrompt, GenerationSettings, NodeRef } from './types.js';

/**
 * Mutable ComfyUI graph. Modules add nodes and rewire by updating
 * PipelineContext ports (model/clip/vae/positive/negative/latent/image).
 */
export class WorkflowGraph {
  private nextId = 1;
  private readonly nodes = new Map<string, ComfyNode>();

  add(classType: string, inputs: Record<string, unknown> = {}, preferredId?: string): string {
    const id = preferredId ?? String(this.nextId++);
    if (!preferredId) {
      // keep counter ahead of any explicit ids
      const n = Number(id);
      if (Number.isFinite(n) && n >= this.nextId) this.nextId = n + 1;
    } else {
      const n = Number(preferredId);
      if (Number.isFinite(n) && n >= this.nextId) this.nextId = n + 1;
    }
    if (this.nodes.has(id)) {
      throw new Error(`Node id ${id} already exists`);
    }
    this.nodes.set(id, { class_type: classType, inputs });
    return id;
  }

  get(id: string): ComfyNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown node ${id}`);
    return node;
  }

  setInput(id: string, key: string, value: unknown): void {
    this.get(id).inputs[key] = value;
  }

  toPrompt(): ComfyPrompt {
    const out: ComfyPrompt = {};
    for (const [id, node] of this.nodes) {
      out[id] = {
        class_type: node.class_type,
        inputs: { ...node.inputs },
      };
    }
    return out;
  }
}

export type PipelineContext = {
  graph: WorkflowGraph;
  settings: GenerationSettings;
  model: NodeRef;
  clip: NodeRef;
  vae: NodeRef;
  positive: NodeRef;
  negative: NodeRef;
  latent: NodeRef;
  /** Decoded image after first (or subsequent) VAEDecode */
  image: NodeRef | null;
  /** Node id of SaveImage — always rewired to final `image` */
  saveNodeId: string | null;
};

export function ensureSave(ctx: PipelineContext): void {
  if (!ctx.image) {
    throw new Error('Cannot save: pipeline has no image yet');
  }
  if (!ctx.saveNodeId) {
    ctx.saveNodeId = ctx.graph.add('SaveImage', {
      filename_prefix: 'darkroom',
      images: ctx.image,
    });
  } else {
    ctx.graph.setInput(ctx.saveNodeId, 'images', ctx.image);
  }
}
