import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Always 5173. Without strictPort, Vite silently moves to 5174, 5175, …
  // whenever an old dev server is still holding 5173, so the app's URL
  // changes from run to run (and each port has its own localStorage, so
  // you appear logged out). With it, a second `npm run dev` fails loudly
  // instead: stop the old one first.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
})
