import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://grazerbook.com/ — the apex, so assets are
  // root-relative. This was '/SuchomskiFarm/' while the site lived at
  // csuchomski.github.io/SuchomskiFarm/, where every asset needed the
  // repo-name prefix.
  //
  // The two changes are a pair: `public/CNAME` is what tells Pages the site
  // answers to grazerbook.com, and it has to be in the published artifact
  // because this repo deploys `app/dist` through Actions rather than from a
  // branch. Change the base without the CNAME and the domain serves nothing;
  // change the CNAME without the base and every asset 404s.
  base: '/',
})
