# openclaw-local-images

An OpenClaw plugin that generates and edits images through a local image server on loopback. You configure the models the server serves; the agent picks one per call.

## Install

```sh
openclaw plugins install <path-to-this-repo>
```

## Configure

```json5
{
  plugins: {
    entries: {
      "local-images": {
        config: {
          baseUrl: "http://127.0.0.1:7860",
          models: ["everyday", "realism"],
        },
      },
    },
  },
  agents: {
    defaults: {
      mediaModels: { image: { primary: "local-images/everyday" } },
    },
  },
}
```

| Key | What |
|---|---|
| `baseUrl` | The image server. Loopback only (`127.0.0.1`, `[::1]`, `localhost`); anything else leaves the provider unconfigured |
| `models` | Model ids the server serves; the first is the default |

The agent can override the model per call: `image_generate model=local-images/realism`.

## The server

Any server that speaks [the image server API](docs/server-api.md). The plugin only sends a model, a prompt, a size and a count, and returns the PNGs with model, seed and timings.

## Limits

- Editing: one reference image per request (`image_generate image=<path>`); the server decides how each model uses it.
- Sizes: 1024×1024, 832×1216, 1216×832, 768×1344, 1344×768; an aspect ratio maps to the nearest of these.

See [verification](docs/verification.md) for what's been checked against a live gateway.
