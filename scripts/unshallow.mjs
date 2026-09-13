// 构建前把浅克隆补成完整历史。
//
// 文章日期是从 git 历史推出来的（见 src/loaders/plain-markdown.ts）。
// Cloudflare Pages 构建时只做浅克隆，历史里只有最新一次提交，
// 于是每篇文章查到的「最后改动」都是这次推送——线上日期全部变成推送当天，
// 本地却一切正常，因为本地是完整仓库。
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let shallow;
try {
  shallow = git(['rev-parse', '--is-shallow-repository']);
} catch (error) {
  // 不在 git 仓库里（比如直接上传的产物目录）：没有历史可补，日期会退回文件 mtime
  console.warn('[unshallow] 不是 git 仓库，跳过：', error.stderr?.toString().trim() || error.message);
  process.exit(0);
}

if (shallow !== 'true') {
  console.log('[unshallow] 完整仓库，无需补历史');
  process.exit(0);
}

try {
  git(['fetch', '--unshallow', '--quiet']);
  console.log('[unshallow] 已补全 git 历史');
} catch (error) {
  // 补不上就让构建失败：带着错误日期上线，比这次不部署更难发现
  console.error('[unshallow] 补全 git 历史失败，文章日期会全部错成最新提交时间：');
  console.error(error.stderr?.toString().trim() || error.message);
  process.exit(1);
}
