import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://csuchomski.github.io/SuchomskiFarm/ — assets need
  // the repo-name subpath prefix rather than root-relative paths.
  base: '/SuchomskiFarm/',
})
