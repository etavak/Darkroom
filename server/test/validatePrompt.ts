import objectInfo from './fixtures/object_info.json';

type Spec = unknown[];
type NodeInfo = { input?: { required?: Record<string, Spec>; optional?: Record<string, Spec> }; output?: string[] };
type PromptNode = { class_type: string; inputs: Record<string, unknown> };

const INFO = objectInfo as Record<string, NodeInfo>;

/** A dropdown's choices (classic `[[...]]` or the newer `["COMBO", {options}]`), or null. */
function comboChoices(spec: Spec): unknown[] | null {
  if (Array.isArray(spec[0])) return spec[0];
  if (spec[0] === 'COMBO') return ((spec[1] as { options?: unknown[] } | undefined)?.options ?? []) as unknown[];
  return null;
}

/** Model / image dropdowns were replaced by placeholders in the fixture — any name is fine. */
const isFileList = (choices: unknown[]) => choices.some((c) => typeof c === 'string' && /^([a-z]+\/)?model-[ab]\./.test(c));

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';

/**
 * Problems ComfyUI would reject (or silently mis-wire) in a prompt, checked against the
 * recorded object_info: unknown nodes, missing required inputs, links to missing nodes or
 * the wrong output type, and values outside a dropdown or number range.
 */
export function validatePrompt(prompt: Record<string, PromptNode>): string[] {
  const problems: string[] = [];
  for (const [id, node] of Object.entries(prompt)) {
    const info = INFO[node.class_type];
    if (!info) {
      problems.push(`#${id} ${node.class_type}: not a ComfyUI node`);
      continue;
    }
    const required = info.input?.required ?? {};
    const all = { ...(info.input?.optional ?? {}), ...required };
    for (const key of Object.keys(required)) {
      if (!(key in node.inputs)) problems.push(`#${id} ${node.class_type}: missing required input "${key}"`);
    }
    for (const [key, value] of Object.entries(node.inputs)) {
      const spec = all[key];
      if (!spec) {
        problems.push(`#${id} ${node.class_type}: unknown input "${key}"`);
        continue;
      }
      if (isLink(value)) {
        const src = prompt[value[0]];
        if (!src) {
          problems.push(`#${id} ${node.class_type}.${key}: links to missing node #${value[0]}`);
          continue;
        }
        const outType = INFO[src.class_type]?.output?.[value[1]];
        const want = typeof spec[0] === 'string' && spec[0] !== 'COMBO' ? spec[0] : null;
        if (!outType) problems.push(`#${id} ${node.class_type}.${key}: #${value[0]} ${src.class_type} has no output ${value[1]}`);
        else if (want && want !== '*' && outType !== '*' && !want.split(',').includes(outType)) {
          problems.push(`#${id} ${node.class_type}.${key}: expects ${want}, got ${outType} from #${value[0]} ${src.class_type}`);
        }
        continue;
      }
      const choices = comboChoices(spec);
      if (choices && !isFileList(choices) && !choices.includes(value)) {
        problems.push(`#${id} ${node.class_type}.${key}: "${String(value)}" isn't one of ${choices.slice(0, 6).join(', ')}…`);
      }
      const opts = (typeof spec[0] === 'string' ? spec[1] : undefined) as { min?: number; max?: number } | undefined;
      if (typeof value === 'number' && opts) {
        if (opts.min !== undefined && value < opts.min) problems.push(`#${id} ${node.class_type}.${key}: ${value} < min ${opts.min}`);
        if (opts.max !== undefined && value > opts.max) problems.push(`#${id} ${node.class_type}.${key}: ${value} > max ${opts.max}`);
      }
    }
  }
  return problems;
}
