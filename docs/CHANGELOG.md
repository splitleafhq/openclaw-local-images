# Changelog

## Unreleased

- A loopback `baseUrl` with a query, fragment or credentials leaves the provider unconfigured instead of breaking every request.
- A seed above 2^53 − 1 keeps its exact digits in the caption, file name and metadata (as a decimal string).
- A server that is down or doesn't answer in time fails with a `local-images:` error naming the cause, not a bare `fetch failed` or `TimeoutError`.
- An image whose `pngBase64` is empty or doesn't decode to a PNG is an error; it used to come back as a successful empty or mislabelled `image/png`.
- Ships compiled `dist/`: an install runs npm without scripts, so it can't build one. `openclaw.runtimeExtensions` points at `./dist/index.js`, which OpenClaw loads from a copy or a load path. CI checks `dist/` matches a fresh build.
- Editing: one reference image per request is sent to the server as `inputImage` (base64 and MIME type); more than one is refused before any request.

- Image provider for a local image server on loopback: several configured models, the first as default, picked per call; PNG output with model, seed and timings in each image's metadata. Editing is off.
