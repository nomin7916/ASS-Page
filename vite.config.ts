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
        // ⚠️ facadeModuleId로 찾지 말 것 — 앱만 여는 조각(계산기 등, 1-5)이 앱 조각의 모듈을 가져다 쓰면
        //    앱 조각은 대표 모듈 없는 조각이 된다(facadeModuleId = null). "App.tsx를 담은 조각"으로 찾는다.
        const has = (c: any, re: RegExp) => (c.moduleIds || Object.keys(c.modules || {})).some((id: string) => re.test(id))
        const app = chunks.find(c => has(c, /[\\/]src[\\/]App\.tsx$/))
        const entry = chunks.find(c => c.isEntry)
        if (!app || !entry) throw new Error('app-chunk-preload: 앱 조각 또는 진입 조각을 찾지 못했습니다')
        const closure = (start: string) => {
          const seen = new Set<string>(); const st = [start]
          while (st.length) { const f = st.pop()!; if (seen.has(f)) continue; seen.add(f); st.push(...(bundle[f]?.imports || [])) }
          return seen
        }
        // 별도 창이 앱 조각을 끌어오면 1-3의 효과(창은 앱 본체를 받지 않음)가 조용히 사라진다 → 빌드를 멈춘다.
        const wins = chunks.filter(c => has(c, /[\\/]src[\\/]components[\\/]\w+Window\.tsx$/))
        if (wins.length < 8) throw new Error(`app-chunk-preload: 별도 창 조각이 ${wins.length}개뿐입니다(8개여야 함)`)
        for (const w of wins) {
          if (w === app || closure(w.fileName).has(app.fileName)) throw new Error(`app-chunk-preload: 별도 창 조각 ${w.fileName}이 앱 조각을 끌어옵니다`)
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
