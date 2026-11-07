import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3210, strictPort: true },
  ssr: {
    // native / Node-only modules stay external in the server bundle
    external: ["better-sqlite3", "@node-rs/argon2"],
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    // React Compiler: automatic memoisation of components and hooks
    babel({ presets: [reactCompilerPreset()] }),
  ],
})
