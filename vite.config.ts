import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 앱 탭(`?…Window=1`이 없는 주소)은 index.html에서 앱 조각을 미리 받는다(성능 개선 1-3).
// 앱 본체를 필요할 때 받기로 바꾸면 "진입 조각 실행 → 앱 조각 요청"으로 한 단계 늦어지는데, 이 줄이 그 대기를 없앤다.
// 별도 창은 건너뛴다 — 창 주소의 파라미터는 전부 `…Window=1` 꼴이다(main.tsx *_WINDOW_BOOT).
function appChunkPreload() {
  return {
    name: 'app-chunk-preload',
    apply: 'build' as const,
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string, ctx: any) {
        const bundle = ctx.bundle
        if (!bundle) return html
        const chunks: any[] = Object.values(bundle).filter((c: any) => c.type === 'chunk')
        const app = chunks.find(c => c.facadeModuleId && /[\\/]src[\\/]App\.tsx$/.test(c.facadeModuleId))
        const entry = chunks.find(c => c.isEntry)
        if (!app || !entry) throw new Error('app-chunk-preload: 앱 조각 또는 진입 조각을 찾지 못했습니다')
        const closure = (start: string) => {
          const seen = new Set<string>(); const st = [start]
          while (st.length) { const f = st.pop()!; if (seen.has(f)) continue; seen.add(f); st.push(...(bundle[f]?.imports || [])) }
          return seen
        }
        const have = closure(entry.fileName)
        const files = [...closure(app.fileName)].filter(f => !have.has(f)).map(f => '/' + f)
        const code = `(function(){if(/[?&]\\w+Window=1(?:&|$)/.test(location.search))return;${JSON.stringify(files)}.forEach(function(h){var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';l.href=h;document.head.appendChild(l)})})()`
        return html.replace('</head>', `  <script>${code}</script>\n  </head>`)
      },
    },
  }
}

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // React·아이콘은 한 조각으로 묶는다 — 묶지 않으면 아이콘마다 1KB 안팎 조각이 수십 개 생긴다.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
        },
      },
    },
  },
  plugins: [
    react(),
    appChunkPreload(),
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
