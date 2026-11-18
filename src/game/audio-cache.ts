// 游戏音频的下载和缓存（鹈鹕骑车、星海漫游共用）。
// 下载过的音频存进浏览器的 Cache Storage（2026-11-14 用户要「下载好的资源刷新后也留存，避免重复下」），按这一版音频的 version 分一格，
// 换了一版音频旧的那一格整个删掉。浏览器自己的 HTTP 缓存也能留，但它说清就清，这里是明明白白存一份

export interface AudioCache {
  // 缓存里有就直接拿，没有就边下边报进度（0 到 1），下完存进缓存；读不到返回 null
  download(url: string, progress?: (part: number) => void): Promise<ArrayBuffer | null>;
  // 把这个游戏旧版本的音频缓存清掉
  dropOld(): Promise<void>;
}

// prefix 是这个游戏的缓存名前缀（例如 'pelican-audio-'），version 是 audio.json 里这一版的生成时刻
export function createAudioCache(prefix: string, version: string): AudioCache {
  const name = `${prefix}${version}`;

  async function open(): Promise<Cache | null> {
    try {
      if (!('caches' in window)) return null;
      return await caches.open(name);
    } catch {
      // 无痕模式、存储被禁用时打不开，就只走网络
      return null;
    }
  }

  return {
    async download(url, progress) {
      try {
        const cache = await open();
        const hit = await cache?.match(url);
        if (hit) {
          progress?.(1);
          return await hit.arrayBuffer();
        }
        const response = await fetch(url);
        if (!response.ok) return null;
        const total = Number(response.headers.get('content-length')) || 0;
        let data: ArrayBuffer;
        if (response.body && total > 0 && progress) {
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            got += value.length;
            progress(Math.min(1, got / total));
          }
          const joined = new Uint8Array(got);
          let at = 0;
          for (const chunk of chunks) {
            joined.set(chunk, at);
            at += chunk.length;
          }
          data = joined.buffer;
        } else {
          data = await response.arrayBuffer();
        }
        progress?.(1);
        try {
          await cache?.put(url, new Response(data.slice(0), { headers: { 'content-type': 'audio/mpeg' } }));
        } catch {
          // 存不进去（空间不够之类）就下次再下
        }
        return data;
      } catch {
        // 读不到（图床连不上、断网）就没有声音，不影响玩
        return null;
      }
    },
    async dropOld() {
      try {
        if (!('caches' in window)) return;
        for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== name) await caches.delete(key);
      } catch {
        // 清不掉也不影响玩
      }
    },
  };
}
