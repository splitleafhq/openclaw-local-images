# Changelog

## Unreleased

- Ships compiled `dist/`: an install runs npm without scripts, so it can't build one. `openclaw.runtimeExtensions` points at `./dist/index.js`, which OpenClaw loads from a copy or a load path. CI checks `dist/` matches a fresh build.
- Editing: one reference image per request is sent to the server as `inputImage` (base64 and MIME type); more than one is refused before any request.

- Image provider for a local image server on loopback: several configured models, the first as default, picked per call; PNG output with model, seed and timings in each image's metadata. Editing is off.
