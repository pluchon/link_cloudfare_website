import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.nuonuoya.cn',
  output: 'static',
  trailingSlash: 'ignore',
  markdown: {
    shikiConfig: {
      // css-variables 主题让代码高亮跟着站点色板走，深浅色自动切换
      theme: 'css-variables',
      wrap: false,
    },
  },
});
