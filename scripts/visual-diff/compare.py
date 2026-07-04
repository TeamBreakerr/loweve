#!/usr/bin/env python3
"""像素级对比两个截图目录。用法：compare.py <baseline_dir> <candidate_dir> <diff_out_dir>

判定策略（诚实容忍，不是放水）：
- 完全一致 → ✓
- 每通道差值 ≤TOL_MAX_DELTA 且全图差异像素 ≤TOL_MAX_PX → 判为 swiftshader 跨会话光栅噪声，⚠ 放行。
  依据：修完图片解码竞争后，残余不稳定只剩矢量抗锯齿边缘的 ±1 LSB 浮点舍入（肉眼不可
  见，繁忙页面散布可达几十像素），发生在任意两次独立加载/会话之间；基线和验证各是一次
  采样，各带 ±1 → 相互比较的合成上界是每通道 2。会话内「连续三张字节一致」约束不了它。
  这是光栅器内部的非确定性，不在我们能修的层。
- 其余任何差异 → ✗ exit 1。真实的 CSS 回归不可能落在容忍区里：几何移动 1px 会在边缘
  产生几十~几百级差值；颜色令牌哪怕只变 1~2 LSB 也会波及成千上万像素（被数量上限拦住）。
  已知盲区（接受并记录在案）：仅作用于 ≤TOL_MAX_PX 个像素、且幅度恰好 ≤2 LSB 的颜色
  变化——行为保持重构不会产生这种改动。"""
import os, sys
from PIL import Image, ImageChops

TOL_MAX_DELTA = 2   # 容忍的每通道最大差值：基线与验证各自带 ±1 LSB 采样噪声，合成上界为 2
TOL_MAX_PX = 256    # 容忍的噪声像素数上限（实测单次加载散布可达几十像素，两侧样本取并集再留余量）

def main():
    base_dir, cand_dir, diff_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(diff_dir, exist_ok=True)
    base = sorted(f for f in os.listdir(base_dir) if f.endswith('.png'))
    cand = sorted(f for f in os.listdir(cand_dir) if f.endswith('.png'))
    failed = []
    tolerated = 0
    if base != cand:
        print('✗ 文件集不一致：', set(base) ^ set(cand))
        failed.append('<fileset>')
    for name in [n for n in base if n in cand]:
        a = Image.open(os.path.join(base_dir, name)).convert('RGB')
        b = Image.open(os.path.join(cand_dir, name)).convert('RGB')
        if a.size != b.size:
            print(f'✗ {name}: 尺寸不同 {a.size} vs {b.size}')
            failed.append(name); continue
        diff = ImageChops.difference(a, b)
        bbox = diff.getbbox()
        if bbox is None:
            print(f'  ✓ {name}')
            continue
        max_delta = max(diff.getextrema(), key=lambda ch: ch[1])[1]
        n_px = sum(1 for p in diff.getdata() if p != (0, 0, 0))
        if max_delta <= TOL_MAX_DELTA and n_px <= TOL_MAX_PX:
            print(f'  ⚠ {name}: 容忍 {n_px} 像素 LSB 光栅噪声（≤{max_delta}/通道，bbox={bbox}）')
            tolerated += 1
            continue
        mask = diff.convert('L').point(lambda v: 255 if v else 0)
        overlay = Image.new('RGB', a.size, (255, 40, 40))
        vis = Image.composite(overlay, b.point(lambda v: v // 3), mask)
        out = os.path.join(diff_dir, name)
        vis.save(out)
        print(f'✗ {name}: {n_px} 像素差异，max_delta={max_delta}，bbox={bbox} → {out}')
        failed.append(name)
    if failed:
        print(f'\n❌ {len(failed)} 处差异，禁止提交'); sys.exit(1)
    tail = f'（{tolerated} 张含 LSB 噪声，已按策略容忍）' if tolerated else ''
    print(f'\n✅ 全部通过{tail}')

if __name__ == '__main__':
    main()
