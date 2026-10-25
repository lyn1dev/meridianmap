import { defineConfig } from "vite";

export default defineConfig({
    base: "./",
    build: {
        target: "esnext",
        outDir: "../common/build/web",
        sourcemap: true,
    },
    // local development: map data from the live map
    server: {
        proxy: {
            "/tiles": { target: "https://map.meridianmc.xyz", changeOrigin: true },
            "/images/icon/registered": { target: "https://map.meridianmc.xyz", changeOrigin: true },
        },
    },
});
