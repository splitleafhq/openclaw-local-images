import { type OpenClawPluginApi, definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { PROVIDER_ID, createProvider, resolveConfig } from './provider.ts';

/** The parts of OpenClaw's plugin API the provider uses. `register` passes OpenClaw's own, and tests pass a stand-in. */
export interface PluginHost {
  pluginConfig?: OpenClawPluginApi['pluginConfig'];
  logger?: Partial<Pick<OpenClawPluginApi['logger'], 'warn'>>;
  registerImageGenerationProvider: OpenClawPluginApi['registerImageGenerationProvider'];
}

export function registerLocalImages(api: PluginHost): void {
  const config = resolveConfig(api.pluginConfig);
  if (!config) {
    api.logger?.warn?.(`${PROVIDER_ID}: not configured; set baseUrl (loopback) and at least one model`);
  }
  api.registerImageGenerationProvider(createProvider(() => resolveConfig(api.pluginConfig)));
}

export default definePluginEntry({
  id: PROVIDER_ID,
  name: 'Local Images',
  description: 'Image generation through a local image server on loopback, with several models the agent picks per call.',
  register: registerLocalImages,
});
