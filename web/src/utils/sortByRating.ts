// 「按评分」排序：自己打过分的排前面（按我的分降序），没打分的排后面（按站点评分降序），
// 同分按添加顺序倒序。两档不混排——站点 9.4 的未打分作品不会插到我打 9 分的作品前面。
type Rated = { id: number; rating?: number | null };

export function sortByRating<T extends Rated>(list: T[], siteRating: (item: T) => number | null | undefined): T[] {
  const key = (item: T): [number, number] =>
    item.rating ? [1, item.rating] : [0, siteRating(item) ?? -1];
  return [...list].sort((a, b) => {
    const [tierA, scoreA] = key(a);
    const [tierB, scoreB] = key(b);
    return (tierB - tierA) || (scoreB - scoreA) || (b.id - a.id);
  });
}
