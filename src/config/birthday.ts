// 生日小屋（/birthday/）的贺卡文案。改名字、年龄或祝福语只动这里；
// 标题书法字是 OSS 上的透明底图片（站点不加载 Web 字体），名字变了需要重新生成那张图。
export interface BirthdayRow {
  label: string;
  value: string;
}

export interface BirthdayCard {
  name: string;
  age: number;
  /** 生日当天（YYYY-MM-DD，按 Asia/Taipei） */
  date: string;
  rows: BirthdayRow[];
  wish: string;
  /** 书法标题图的替代文本 */
  titleAlt: string;
}

export const birthday: BirthdayCard = {
  name: 'Hong',
  age: 21,
  date: '2026-11-28',
  rows: [
    { label: '日常', value: '感受大自然，慢慢走走' },
    { label: '喜欢', value: '热茶，雨天，一碗热汤面' },
    { label: '此刻', value: '正在冥想，放空一会儿' },
  ],
  wish: 'Hong，愿你一直好奇，也一直自在。人生不必赶路，想做的事慢慢做，喜欢的人和风景，都会在路上遇到。',
  titleAlt: '生日快乐 Hong',
};
