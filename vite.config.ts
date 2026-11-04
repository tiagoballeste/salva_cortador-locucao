import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const single = process.env.SINGLE === '1'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
  test: {
    environment: 'node',
  },
} as never)
