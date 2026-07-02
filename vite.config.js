import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// vite-plugin-cesium copies Cesium's static assets (incl. Assets/Textures/NaturalEarthII)
// and wires up CESIUM_BASE_URL so buildModuleUrl(...) resolves at runtime.
export default defineConfig({
  plugins: [react(), cesium()],
});
