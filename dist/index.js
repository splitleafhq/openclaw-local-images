import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { PROVIDER_ID, createProvider, resolveConfig } from './provider.js';
export function registerLocalImages(api) {
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
