import { defineConfig } from 'astro/config';
import { remarkMermaid } from './src/plugins/remark-mermaid.mjs';
import { remarkFigure } from './src/plugins/remark-figure.mjs';
import { remarkEmbed } from './src/plugins/remark-embed.mjs';

export default defineConfig({
  site: 'https://www.nuonuoya.cn',
  output: 'static',
  // 这条工具栏只在本地出现，不会进构建产物；这里顺手关掉
  devToolbar: { enabled: false },
  trailingSlash: 'ignore',
  // 默认的 localhost 在 Windows 上只绑 IPv6 的 ::1，浏览器走 127.0.0.1 会被拒；
  // 显式绑 IPv4。只影响本地 dev / preview，不影响构建产物
  server: {
    host: '127.0.0.1',
    port: 4321,
  },
  // 本地 dev 按页面懒发现 three/addons 子模块时会触发 Vite 重新预构建并返回 504 Outdated Optimize Dep，
  // 把全站用到的 three 与 addons 提前放进预构建清单，避免切到 /door/ 或游戏页时脚本中断黑屏
  vite: {
    optimizeDeps: {
      include: [
        'three',
        'three/addons/controls/OrbitControls.js',
        'three/addons/postprocessing/EffectComposer.js',
        'three/addons/postprocessing/OutputPass.js',
        'three/addons/postprocessing/RenderPass.js',
        'three/addons/postprocessing/ShaderPass.js',
        'three/addons/postprocessing/UnrealBloomPass.js',
        'three/addons/utils/BufferGeometryUtils.js',
      ],
    },
  },
  markdown: {
    // mermaid 代码块要在 Shiki 之前被换掉，否则源码会被拆成着色 span
    remarkPlugins: [remarkMermaid, remarkEmbed, remarkFigure],
    shikiConfig: {
      // css-variables 主题让代码高亮跟着站点色板走，深浅色自动切换
      theme: 'css-variables',
      wrap: false,
    },
  },
});
