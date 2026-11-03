# Security

## Reporting a vulnerability

Report it privately through GitHub's [private vulnerability reporting](https://github.com/splitleafhq/openclaw-local-images/security/advisories/new). That opens a draft advisory that only you and the maintainer can see. Don't open a public issue.

The link works only while private vulnerability reporting is enabled under Settings → Advanced Security. If the page isn't available, the setting is off. A public issue saying so, without describing what you found, is enough to get it turned on.

This is a solo project, so there's no response-time commitment.

## What's in scope

The plugin sends prompts to an image server and hands the images back to OpenClaw. In scope is anything that:
- **Sends a request off the machine:** any request to a host other than loopback, whatever the config says.
- **Mixes up models:** an image from a model other than the one the agent picked, or the default, without saying so.
- **Fails silently:** a server error or malformed response turned into an empty or fake success.

## What isn't

- **Someone who can already write to the OpenClaw config or run the image server.** They already control what gets generated.
- **What gets generated.** The plugin passes prompts through unchanged; content is the operator's and the agent's call.
