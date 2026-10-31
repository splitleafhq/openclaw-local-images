import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';

// The image-generation subpath ships no declarations (openclaw 2026.10.3), so the types come from the registrar.
export type ImageGenerationProvider = Parameters<OpenClawPluginApi['registerImageGenerationProvider']>[0];
type ImageGenerationRequest = Parameters<ImageGenerationProvider['generateImage']>[0];
type ImageGenerationResult = Awaited<ReturnType<ImageGenerationProvider['generateImage']>>;
type GeneratedImageAsset = ImageGenerationResult['images'][number];

export const PROVIDER_ID = 'local-images';

/** Square first: OpenClaw falls back to the first size when a request names none it supports. */
export const SIZES = ['1024x1024', '832x1216', '1216x832', '768x1344', '1344x768'];

const ASPECT_RATIOS: Record<string, string> = {
  '1:1': '1024x1024',
  '2:3': '832x1216',
  '3:2': '1216x832',
  '9:16': '768x1344',
  '16:9': '1344x768',
};

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_COUNT = 4;
const MAX_INPUT_IMAGES = 1;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

export interface Config {
  baseUrl: string;
  models: string[];
}

export interface Timings {
  waitSeconds?: number;
  loadSeconds?: number;
  generateSeconds?: number;
}

interface ServerImage {
  pngBase64: string;
  seed: number;
}

interface ServerResponse {
  model: string;
  images: ServerImage[];
  timings?: Timings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Loopback only: prompts and images never leave the machine through this provider. */
export function isLoopbackUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  return url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
}

/** The plugin's config, or undefined when it can't serve: a missing or non-loopback `baseUrl`, or no models. */
export function resolveConfig(raw: unknown): Config | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const { baseUrl, models } = raw;
  if (typeof baseUrl !== 'string' || !isLoopbackUrl(baseUrl)) {
    return undefined;
  }
  if (!Array.isArray(models)) {
    return undefined;
  }
  const ids = models.filter((model): model is string => typeof model === 'string' && model.length > 0);
  if (ids.length === 0) {
    return undefined;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), models: [...new Set(ids)] };
}

export function resolveSize(req: Pick<ImageGenerationRequest, 'size' | 'aspectRatio'>): { width: number; height: number } {
  let size = SIZES[0] ?? '1024x1024';
  if (req.size && SIZES.includes(req.size)) {
    size = req.size;
  } else if (req.aspectRatio && ASPECT_RATIOS[req.aspectRatio]) {
    size = ASPECT_RATIOS[req.aspectRatio] ?? size;
  }
  const [width, height] = size.split('x').map(Number);
  return { width: width ?? 1024, height: height ?? 1024 };
}

/** The bare model id; a provider-qualified ref (`local-images/<id>`) is accepted too. */
export function resolveModel(model: string, config: Config): string {
  const bare = model.startsWith(`${PROVIDER_ID}/`) ? model.slice(PROVIDER_ID.length + 1) : model;
  if (!config.models.includes(bare)) {
    throw new Error(`${PROVIDER_ID}: unknown model "${bare}"; configured: ${config.models.join(', ')}`);
  }
  return bare;
}

function parseResponse(body: unknown): ServerResponse {
  if (!isRecord(body) || typeof body.model !== 'string' || !Array.isArray(body.images)) {
    throw new Error(`${PROVIDER_ID}: the image server returned an unexpected response`);
  }
  const images: ServerImage[] = [];
  for (const image of body.images) {
    if (!isRecord(image) || typeof image.pngBase64 !== 'string' || typeof image.seed !== 'number') {
      throw new Error(`${PROVIDER_ID}: the image server returned an image without data or seed`);
    }
    images.push({ pngBase64: image.pngBase64, seed: image.seed });
  }
  if (images.length === 0) {
    throw new Error(`${PROVIDER_ID}: the image server returned no images`);
  }
  const timings: Timings = {};
  if (isRecord(body.timings)) {
    for (const key of ['waitSeconds', 'loadSeconds', 'generateSeconds'] as const) {
      const value = body.timings[key];
      if (typeof value === 'number') {
        timings[key] = value;
      }
    }
  }
  return { model: body.model, images, timings };
}

/** One line naming what made the image, so the owner can see which model ran and how long it took. */
export function describe(model: string, seed: number, timings: Timings): string {
  const parts = [model, `seed ${seed}`];
  const total = (timings.waitSeconds ?? 0) + (timings.loadSeconds ?? 0) + (timings.generateSeconds ?? 0);
  if (total > 0) {
    parts.push(`${total.toFixed(1)} s`);
  }
  return parts.join(' · ');
}

export async function generate(req: ImageGenerationRequest, config: Config): Promise<ImageGenerationResult> {
  const inputs = req.inputImages ?? [];
  if (inputs.length > MAX_INPUT_IMAGES) {
    throw new Error(`${PROVIDER_ID}: at most ${MAX_INPUT_IMAGES} reference image per request`);
  }
  const model = resolveModel(req.model, config);
  const { width, height } = resolveSize(req);
  const count = Math.min(Math.max(req.count ?? 1, 1), MAX_COUNT);
  const response = await fetch(`${config.baseUrl}/v1/images`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: req.prompt,
      width,
      height,
      count,
      ...(inputs[0] ? { inputImage: { base64: inputs[0].buffer.toString('base64'), mimeType: inputs[0].mimeType } } : {}),
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${PROVIDER_ID}: the image server answered ${response.status}: ${text.slice(0, 300)}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new Error(`${PROVIDER_ID}: the image server returned invalid JSON`, { cause: error });
  }
  const parsed = parseResponse(body);
  const timings = parsed.timings ?? {};
  const images: GeneratedImageAsset[] = parsed.images.map((image) => {
    // Base64 decoding never throws: an empty or garbled string decodes to an empty or wrong buffer.
    const buffer = Buffer.from(image.pngBase64, 'base64');
    if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error(`${PROVIDER_ID}: the image server returned image data that is not a PNG (seed ${image.seed})`);
    }
    const caption = describe(parsed.model, image.seed, timings);
    return {
      buffer,
      mimeType: 'image/png',
      fileName: `${parsed.model}-${image.seed}.png`,
      metadata: { model: parsed.model, seed: image.seed, timings, caption },
    };
  });
  return { images, model: parsed.model, metadata: { timings } };
}

export function createProvider(getConfig: () => Config | undefined): ImageGenerationProvider {
  const initial = getConfig();
  return {
    id: PROVIDER_ID,
    label: 'Local images',
    defaultModel: initial?.models[0],
    models: initial?.models ?? [],
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    capabilities: {
      generate: { maxCount: MAX_COUNT, supportsSize: true, supportsAspectRatio: true },
      edit: { enabled: true, maxCount: MAX_COUNT, maxInputImages: MAX_INPUT_IMAGES, supportsSize: true, supportsAspectRatio: true },
      geometry: { sizes: SIZES, aspectRatios: Object.keys(ASPECT_RATIOS) },
      output: { formats: ['png'] },
    },
    isConfigured: () => getConfig() !== undefined,
    generateImage: async (req) => {
      const config = getConfig();
      if (!config) {
        throw new Error(`${PROVIDER_ID}: not configured; set baseUrl (loopback) and models`);
      }
      return generate(req, config);
    },
  };
}
