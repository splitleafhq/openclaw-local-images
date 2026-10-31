import { strict as assert } from 'node:assert';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { type PluginHost, registerLocalImages } from '../src/index.ts';
import { type Config, type ImageGenerationProvider, createProvider, describe, generate, isLoopbackUrl, resolveConfig, resolveModel, resolveSize } from '../src/provider.ts';

type Request = Parameters<ImageGenerationProvider['generateImage']>[0];
type Handler = (body: Record<string, unknown>, res: ServerResponse) => void;

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const servers: Server[] = [];
after(() => Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve)))));

async function imageServer(handler: Handler): Promise<{ baseUrl: string; bodies: Record<string, unknown>[] }> {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      const body: Record<string, unknown> = JSON.parse(raw);
      bodies.push(body);
      handler(body, res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, bodies };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function ok(model: string, count: number) {
  return {
    model,
    images: Array.from({ length: count }, (_, i) => ({ pngBase64: PNG.toString('base64'), seed: 40 + i })),
    timings: { waitSeconds: 0.5, loadSeconds: 4, generateSeconds: 1.5 },
  };
}

function request(overrides: Partial<Request> = {}): Request {
  return { provider: 'local-images', model: 'everyday', prompt: 'a red fox in snow', cfg: {}, ...overrides };
}

const config = (baseUrl: string): Config => ({ baseUrl, models: ['everyday', 'realism'] });

test('a non-loopback baseUrl leaves the provider unconfigured, so prompts never leave the machine', () => {
  assert.equal(resolveConfig({ baseUrl: 'http://192.168.1.20:7860', models: ['everyday'] }), undefined);
  assert.equal(resolveConfig({ baseUrl: 'https://images.example.com', models: ['everyday'] }), undefined);
  assert.equal(resolveConfig({ baseUrl: 'file:///tmp/x', models: ['everyday'] }), undefined);
  assert.equal(isLoopbackUrl('http://127.0.0.1.example.com:80'), false);
  assert.equal(isLoopbackUrl('http://[::1]:7860'), true);
});

test('a loopback baseUrl with a query, fragment or credentials leaves the provider unconfigured, since every request to it would break', () => {
  for (const baseUrl of ['http://127.0.0.1:7860?x=1', 'http://127.0.0.1:7860?', 'http://127.0.0.1:7860#top', 'http://u:p@127.0.0.1:7860', 'http://u@127.0.0.1:7860']) {
    assert.equal(resolveConfig({ baseUrl, models: ['everyday'] }), undefined, baseUrl);
  }
  assert.equal(isLoopbackUrl('http://127.0.0.1:7860/api'), true);
});

test('config without models is unconfigured; duplicates and a trailing slash are dropped', () => {
  assert.equal(resolveConfig({ baseUrl: 'http://127.0.0.1:7860', models: [] }), undefined);
  assert.equal(resolveConfig({ baseUrl: 'http://127.0.0.1:7860' }), undefined);
  assert.deepEqual(resolveConfig({ baseUrl: 'http://127.0.0.1:7860/', models: ['a', 'a', '', 'b'] }), {
    baseUrl: 'http://127.0.0.1:7860',
    models: ['a', 'b'],
  });
});

test('an unknown model fails before any request reaches the server', async () => {
  const server = await imageServer((body, res) => json(res, 200, ok(String(body.model), 1)));
  await assert.rejects(generate(request({ model: 'missing' }), config(server.baseUrl)), /unknown model "missing"/);
  assert.equal(server.bodies.length, 0);
});

test('a provider-qualified model ref picks the same model', () => {
  assert.equal(resolveModel('local-images/realism', config('http://127.0.0.1:1')), 'realism');
});

test('an aspect ratio maps to its size, and an unsupported size falls back to square', () => {
  assert.deepEqual(resolveSize({ aspectRatio: '16:9' }), { width: 1344, height: 768 });
  assert.deepEqual(resolveSize({ size: '832x1216' }), { width: 832, height: 1216 });
  assert.deepEqual(resolveSize({ size: '4096x4096' }), { width: 1024, height: 1024 });
});

test('generate sends the picked model and returns PNGs naming model, seed and time', async () => {
  const server = await imageServer((body, res) => json(res, 200, ok(String(body.model), Number(body.count))));
  const result = await generate(request({ model: 'realism', count: 2, aspectRatio: '2:3' }), config(server.baseUrl));
  assert.deepEqual(server.bodies[0], { model: 'realism', prompt: 'a red fox in snow', width: 832, height: 1216, count: 2 });
  assert.equal(result.model, 'realism');
  assert.equal(result.images.length, 2);
  assert.deepEqual(result.images[0]?.buffer, PNG);
  assert.equal(result.images[0]?.mimeType, 'image/png');
  assert.equal(result.images[1]?.fileName, 'realism-41.png');
  assert.equal(result.images[0]?.metadata?.caption, 'realism · seed 40 · 6.0 s');
});

test('a seed above 2^53 keeps every digit in the caption, file name and metadata', async () => {
  const server = await imageServer((_body, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(`{"model":"everyday","images":[{"pngBase64":"${PNG.toString('base64')}","seed":18446744073709551615}]}`);
  });
  const result = await generate(request(), config(server.baseUrl));
  assert.equal(result.images[0]?.fileName, 'everyday-18446744073709551615.png');
  assert.equal(result.images[0]?.metadata?.seed, '18446744073709551615');
  assert.equal(result.images[0]?.metadata?.caption, 'everyday · seed 18446744073709551615');
});

test('a seed sent as a JSON string is refused like any malformed seed', async () => {
  const server = await imageServer((_body, res) => json(res, 200, { model: 'everyday', images: [{ pngBase64: PNG.toString('base64'), seed: '7' }] }));
  await assert.rejects(generate(request(), config(server.baseUrl)), /without data or seed/);
});

test('an unreachable server fails with the provider prefix and the connection error', async () => {
  const closed = await imageServer(() => {});
  const port = new URL(closed.baseUrl).port;
  await new Promise((resolve) => servers.pop()?.close(resolve));
  await assert.rejects(generate(request(), config(`http://127.0.0.1:${port}`)), /^Error: local-images: could not reach the image server.*ECONNREFUSED/);
});

test('a server that never answers fails with the provider prefix and the timeout', async () => {
  const pending: ServerResponse[] = [];
  const server = await imageServer((_body, res) => pending.push(res));
  await assert.rejects(generate(request({ timeoutMs: 50 }), config(server.baseUrl)), /^Error: local-images: the image server did not answer within 50 ms/);
  for (const res of pending) {
    res.end();
  }
});

test('more images than the provider allows are capped at four', async () => {
  const server = await imageServer((body, res) => json(res, 200, ok(String(body.model), Number(body.count))));
  await generate(request({ count: 9 }), config(server.baseUrl));
  assert.equal(server.bodies[0]?.count, 4);
});

test('a server error reaches the agent with its status and message', async () => {
  const server = await imageServer((_body, res) => json(res, 503, { error: 'model loading failed' }));
  await assert.rejects(generate(request(), config(server.baseUrl)), /answered 503: .*model loading failed/);
});

test('a response without image data is an error, not an empty success', async () => {
  const server = await imageServer((_body, res) => json(res, 200, { model: 'everyday', images: [{ seed: 1 }] }));
  await assert.rejects(generate(request(), config(server.baseUrl)), /without data or seed/);
  const empty = await imageServer((_body, res) => json(res, 200, { model: 'everyday', images: [] }));
  await assert.rejects(generate(request(), config(empty.baseUrl)), /no images/);
});

test('an edit request sends its reference image to the server as base64', async () => {
  const server = await imageServer((body, res) => json(res, 200, ok(String(body.model), 1)));
  await generate(request({ inputImages: [{ buffer: PNG, mimeType: 'image/png' }] }), config(server.baseUrl));
  assert.deepEqual(server.bodies[0]?.inputImage, { base64: PNG.toString('base64'), mimeType: 'image/png' });
});

test('a plain generate request carries no reference image', async () => {
  const server = await imageServer((body, res) => json(res, 200, ok(String(body.model), 1)));
  await generate(request(), config(server.baseUrl));
  assert.equal('inputImage' in (server.bodies[0] ?? {}), false);
});

test('more than one reference image is refused before any request', async () => {
  const server = await imageServer((body, res) => json(res, 200, ok(String(body.model), 1)));
  const img = { buffer: PNG, mimeType: 'image/png' };
  await assert.rejects(generate(request({ inputImages: [img, img] }), config(server.baseUrl)), /at most 1 reference image/);
  assert.equal(server.bodies.length, 0);
});

test('the caption leaves out the time when the server reports none', () => {
  assert.equal(describe('everyday', 7, {}), 'everyday · seed 7');
});

test('register lists the configured models with the first as default', () => {
  const registered: ImageGenerationProvider[] = [];
  const api: PluginHost = {
    pluginConfig: { baseUrl: 'http://127.0.0.1:7860', models: ['everyday', 'realism'] },
    registerImageGenerationProvider: (provider) => registered.push(provider),
  };
  registerLocalImages(api);
  assert.equal(registered[0]?.defaultModel, 'everyday');
  assert.deepEqual(registered[0]?.models, ['everyday', 'realism']);
  assert.equal(registered[0]?.capabilities.edit.enabled, true);
  assert.equal(registered[0]?.capabilities.edit.maxInputImages, 1);
  assert.equal(registered[0]?.isConfigured?.({}), true);
});

test('register warns and reports unconfigured when the config is missing', async () => {
  const warnings: string[] = [];
  const registered: ImageGenerationProvider[] = [];
  registerLocalImages({ logger: { warn: (m: string) => warnings.push(m) }, registerImageGenerationProvider: (p) => registered.push(p) });
  assert.match(warnings[0] ?? '', /not configured/);
  assert.equal(registered[0]?.isConfigured?.({}), false);
  await assert.rejects(registered[0]?.generateImage(request()) ?? Promise.resolve(), /not configured/);
});

test('createProvider reads the config at call time, so a config change needs no re-register', async () => {
  const server = await imageServer((body, res) => json(res, 200, ok(String(body.model), 1)));
  const state: { config?: Config } = {};
  const provider = createProvider(() => state.config);
  await assert.rejects(provider.generateImage(request()), /not configured/);
  state.config = config(server.baseUrl);
  const result = await provider.generateImage(request());
  assert.equal(result.images.length, 1);
});
