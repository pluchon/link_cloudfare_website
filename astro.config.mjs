import { defineConfig } from 'astro/config';
import { remarkMermaid } from './src/plugins/remark-mermaid.mjs';

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
  markdown: {
    // mermaid 代码块要在 Shiki 之前被换掉，否则源码会被拆成着色 span
    remarkPlugins: [remarkMermaid],
    shikiConfig: {
      // css-variables 主题让代码高亮跟着站点色板走，深浅色自动切换
      theme: 'css-variables',
      wrap: false,
    },
  },
});
