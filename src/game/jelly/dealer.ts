// 出块：托盘里只来 2、4、8，更大的只能自己合出来。既不能有规律，也不能完全随机，借两个公开的做法：
// 1. Threes!（Sirvo）的牌堆：把一副固定比例的小牌洗乱，抽完再洗。短时间内各种数字的比例是稳的，
//    不会连来五个 2 也不会很久不来 8
// 2. 俄罗斯方块的 7-bag：从哪一侧进来也用洗牌袋，左右各两次，不会一直从同一边来
// 2 最多、4 其次、8 最少：一副 12 张里 6 张 2、4 张 4、2 张 8
const BASE_DECK = [2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 8, 8];
const SIDE_BAG = [-1, -1, 1, 1];
// 托盘里最大合到 64，再大就装不下了
export const TRAY_CAP = 64;

function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createDealer() {
  let deck: number[] = [];
  let sides: number[] = [];

  return {
    value(): number {
      if (!deck.length) deck = shuffle(BASE_DECK);
      return deck.pop()!;
    },
    side(): number {
      if (!sides.length) sides = shuffle(SIDE_BAG);
      return sides.pop()!;
    },
  };
}
