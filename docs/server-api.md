# Image server API

The plugin talks to one HTTP server on loopback. Any runtime can sit behind it (MLX, Draw Things, PyTorch); the server owns loading, unloading and the per-image log.

## `POST /v1/images`

Request (JSON):

| Field | Type | Notes |
|---|---|---|
| `model` | string | One of the plugin's configured `models` |
| `prompt` | string | Passed through unchanged |
| `width`, `height` | integer | One of the sizes in `src/provider.ts` (`SIZES`) |
| `count` | integer | 1–4 |
| `inputImage` | object, optional | `{ "base64": string, "mimeType": string }`: a reference image to edit or build from (a sketch, an earlier result). The server decides what the model does with it (edit, or refine at a set strength) |

Response `200` (JSON):

| Field | Type | Notes |
|---|---|---|
| `model` | string | The model that ran |
| `images` | array | `{ "pngBase64": string, "seed": number }`, at least one |
| `timings` | object, optional | `waitSeconds` (queued behind another image), `loadSeconds` (cold load or model swap), `generateSeconds` |

Response `429` (JSON `{ "reason": "busy", "error": string }`, header `Retry-After` in seconds): a heavy model was requested while any other image request is queued or rendering. Heavy models run only alone. `Retry-After` is the heavy model's typical render time. `error` names a light model to use instead.

Response `413` (JSON `{ "reason": "too_large", "error": string }`): the request body is over 25 MB. The server refuses it without reading it.

Any other status is an error; the plugin passes the status and the first 300 characters of the body to the agent.

## Expected server behaviour

- Load a model on its first request and keep it warm; unload after an idle timeout the server sets.
- Generate one request at a time; later requests wait (`waitSeconds`).
- Log each image: model, seed, the three timings, and anything else the operator needs to judge contention.
