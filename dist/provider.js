export const PROVIDER_ID = 'local-images';
/** Square first: OpenClaw falls back to the first size when a request names none it supports. */
export const SIZES = ['1024x1024', '832x1216', '1216x832', '768x1344', '1344x768'];
const ASPECT_RATIOS = {
    '1:1': '1024x1024',
    '2:3': '832x1216',
    '3:2': '1216x832',
    '9:16': '768x1344',
    '16:9': '1344x768',
};
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_COUNT = 4;
const MAX_INPUT_IMAGES = 1;
/** A seed number with its exact decimal text from the response: seeds can exceed 2^53, which a JS number rounds. */
class Seed {
    value;
    text;
    constructor(value, text) {
        this.value = value;
        this.text = text;
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Loopback only: prompts and images never leave the machine through this provider. */
export function isLoopbackUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
    }
    // Request paths are appended to baseUrl as text, so a query or fragment would swallow them, and fetch refuses credentials.
    if (url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
        return false;
    }
    return url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
}
/** The plugin's config, or undefined when it can't serve: a missing or non-loopback `baseUrl`, or no models. */
export function resolveConfig(raw) {
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
    const ids = models.filter((model) => typeof model === 'string' && model.length > 0);
    if (ids.length === 0) {
        return undefined;
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), models: [...new Set(ids)] };
}
export function resolveSize(req) {
    let size = SIZES[0] ?? '1024x1024';
    if (req.size && SIZES.includes(req.size)) {
        size = req.size;
    }
    else if (req.aspectRatio && ASPECT_RATIOS[req.aspectRatio]) {
        size = ASPECT_RATIOS[req.aspectRatio] ?? size;
    }
    const [width, height] = size.split('x').map(Number);
    return { width: width ?? 1024, height: height ?? 1024 };
}
/** The bare model id; a provider-qualified ref (`local-images/<id>`) is accepted too. */
export function resolveModel(model, config) {
    const bare = model.startsWith(`${PROVIDER_ID}/`) ? model.slice(PROVIDER_ID.length + 1) : model;
    if (!config.models.includes(bare)) {
        throw new Error(`${PROVIDER_ID}: unknown model "${bare}"; configured: ${config.models.join(', ')}`);
    }
    return bare;
}
function parseResponse(body) {
    if (!isRecord(body) || typeof body.model !== 'string' || !Array.isArray(body.images)) {
        throw new Error(`${PROVIDER_ID}: the image server returned an unexpected response`);
    }
    const images = [];
    for (const image of body.images) {
        if (!isRecord(image) || typeof image.pngBase64 !== 'string' || !(image.seed instanceof Seed)) {
            throw new Error(`${PROVIDER_ID}: the image server returned an image without data or seed`);
        }
        images.push({ pngBase64: image.pngBase64, seed: image.seed });
    }
    if (images.length === 0) {
        throw new Error(`${PROVIDER_ID}: the image server returned no images`);
    }
    const timings = {};
    if (isRecord(body.timings)) {
        for (const key of ['waitSeconds', 'loadSeconds', 'generateSeconds']) {
            const value = body.timings[key];
            if (typeof value === 'number') {
                timings[key] = value;
            }
        }
    }
    return { model: body.model, images, timings };
}
/** One line naming what made the image, so the owner can see which model ran and how long it took. */
export function describe(model, seed, timings) {
    const parts = [model, `seed ${seed}`];
    const total = (timings.waitSeconds ?? 0) + (timings.loadSeconds ?? 0) + (timings.generateSeconds ?? 0);
    if (total > 0) {
        parts.push(`${total.toFixed(1)} s`);
    }
    return parts.join(' · ');
}
/** JSON.parse reviver; `context.source` is the value's raw text (Node 21+, TC39 JSON.parse source text access). */
function readSeed(key, value, context) {
    if (key === 'seed' && typeof value === 'number' && context?.source !== undefined) {
        return new Seed(value, context.source);
    }
    return value;
}
function describeFetchError(error, baseUrl, timeoutMs) {
    if (error instanceof Error && error.name === 'TimeoutError') {
        return `the image server did not answer within ${timeoutMs} ms`;
    }
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
    const code = cause && 'code' in cause && typeof cause.code === 'string' ? ` (${cause.code})` : '';
    const message = error instanceof Error ? error.message : String(error);
    return `could not reach the image server at ${baseUrl}: ${message}${code}`;
}
export async function generate(req, config) {
    const inputs = req.inputImages ?? [];
    if (inputs.length > MAX_INPUT_IMAGES) {
        throw new Error(`${PROVIDER_ID}: at most ${MAX_INPUT_IMAGES} reference image per request`);
    }
    const model = resolveModel(req.model, config);
    const { width, height } = resolveSize(req);
    const count = Math.min(Math.max(req.count ?? 1, 1), MAX_COUNT);
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let response;
    let text;
    try {
        response = await fetch(`${config.baseUrl}/v1/images`, {
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
            signal: AbortSignal.timeout(timeoutMs),
        });
        text = await response.text();
    }
    catch (error) {
        throw new Error(`${PROVIDER_ID}: ${describeFetchError(error, config.baseUrl, timeoutMs)}`, { cause: error });
    }
    if (!response.ok) {
        throw new Error(`${PROVIDER_ID}: the image server answered ${response.status}: ${text.slice(0, 300)}`);
    }
    let body;
    try {
        body = JSON.parse(text, readSeed);
    }
    catch (error) {
        throw new Error(`${PROVIDER_ID}: the image server returned invalid JSON`, { cause: error });
    }
    const parsed = parseResponse(body);
    const timings = parsed.timings ?? {};
    const images = parsed.images.map((image) => {
        const seed = Number.isSafeInteger(image.seed.value) ? image.seed.value : image.seed.text;
        const caption = describe(parsed.model, seed, timings);
        return {
            buffer: Buffer.from(image.pngBase64, 'base64'),
            mimeType: 'image/png',
            fileName: `${parsed.model}-${seed}.png`,
            metadata: { model: parsed.model, seed, timings, caption },
        };
    });
    return { images, model: parsed.model, metadata: { timings } };
}
export function createProvider(getConfig) {
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
