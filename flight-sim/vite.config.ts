/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesium';

export default defineConfig({
  // Expone CESIUM_ION_TOKEN y GOOGLE_MAPS_KEY sin prefijo VITE_.
  envPrefix: ['VITE_', 'CESIUM_', 'GOOGLE_'],
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  plugins: [
    viteStaticCopy({
      targets: [
        // stripBase: 4 quita "node_modules/cesium/Build/Cesium" del destino
        ...['ThirdParty', 'Workers', 'Assets', 'Widgets'].map((dir) => ({
          src: `${cesiumSource}/${dir}`,
          dest: cesiumBaseUrl,
          rename: { stripBase: 4 },
        })),
      ],
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
