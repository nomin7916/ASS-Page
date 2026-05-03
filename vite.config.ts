import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'cors-proxy',
      configureServer(server) {
        server.middlewares.use('/api/proxy', async (req, res) => {
          const urlParam = new URL(req.url!, 'http://localhost').searchParams.get('url');
          if (!urlParam) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'url param required' }));
            return;
          }
          try {
            const response = await fetch(urlParam, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://m.stock.naver.com/',
              },
            });
            const text = await response.text();
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = response.status;
            res.end(text);
          } catch (e) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      },
    },
  ],
})
