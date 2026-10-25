# Verification

What has been checked, and how. Anything not yet seen on a live gateway is marked unverified.

| Claim | Source | Status |
|---|---|---|
| A plugin registers an image provider with `api.registerImageGenerationProvider` and declares it in `contracts.imageGenerationProviders` | openclaw 2026.10.5 `docs/plugins/architecture.md`, `docs/plugins/manifest/capabilities.md` | Docs; unverified live |
| The agent picks a model per call with `image_generate model=<provider>/<model>` | openclaw 2026.10.5 `docs/tools/image-generation.md` (`model` parameter) | Docs; unverified live |
| `action=list` shows the provider's `models` | same page, "Inspect at runtime" | Docs; unverified live |
| The completion reply shows the image's `metadata.caption` (model, seed, time) | not documented | Unverified; the server log is the record either way |
| `openclaw/plugin-sdk/image-generation` ships no type declarations, so types come from the registrar | openclaw 2026.10.3 `dist/plugin-sdk/` (no `image-generation.d.ts`) | Checked |
