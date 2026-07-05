#!/usr/bin/env python3
"""扫 loweve.css 顶层规则块 → 每个类名在 web/src 哪些文件出现 → 给出归属建议。
用法：python3 scripts/refactor/css_usage.py [--css web/src/styles/loweve.css]

本文件相对任务给出的起点实现做了两处小改动（详见 css-usage-report.txt 头部说明，
以及该报告尾部「❓ 项人工复核」章节里对每个受影响类名的具体结论）：

1. 提取类名前先去掉 CSS 注释 / url(...) / 引号字符串，避免把非选择器的巧合文本
   当成类名收进来。实测两处：注释里当例子写的 ".X__title"，以及 poster 占位图
   data-URI 里 "http://www.w3.org/2000/svg" 中的 ".org"/".w3" —— 这三个词起点
   实现会误判成 loweve.css 定义的类名，进而在后面的使用扫描里产生虚假的 ❓ 行。

2. 使用扫描的"类名边界"判断从起点实现的白名单标点
   ( [\\'"\\s:.] 开头 / [\\'"\\s.{[(] 结尾 ) 改成通用的"非标识符字符"边界
   ( (?<![\\w-])cls(?![\\w-]) )。白名单标点漏掉了几种真实存在的写法：
     - Vue `:class="{ dragging: isX }"` 这种不加引号的对象键——类名后面
       紧跟的是冒号，不在起点实现的收尾字符集合里；
     - 组件自己 <style scoped> 块里 `.cls:hover{}` / `.cls::before{}` /
       `.cls, .other{}` 这类类名后面直接跟伪类/伪元素/逗号的写法。
   新边界仍然保留"不能是更长标识符的子串"这条核心约束（避免 .btn 命中
   .btn-group、.tag 命中 hashtag 之类的变量名），只是把"合法边界字符"从一份
   手工枚举的标点白名单放宽成"任意非字母数字下划线连字符的字符"，能覆盖上面
   两种起点实现会漏掉的写法。
   这仍然是纯文本匹配，两类情况它管不了、必须人工复核：
     a) 类名与 JS/TS 里同名变量/属性偶然撞词（如 .year/.label/.count 这种
        常见英文单词），扫描会把它算作"使用"，但那处命中可能和 CSS 类完全无关；
     b) 类名是运行时用字符串拼接生成的（如 `` `is-${state}` ``），源码里根本
        没有这个类名的字面量子串，扫描会漏判成 ❓。
   报告尾部的人工复核就是专门处理这两类。
"""
import argparse, os, re, collections

ap = argparse.ArgumentParser()
ap.add_argument('--css', default='web/src/styles/loweve.css')
args = ap.parse_args()

css_raw = open(args.css, encoding='utf-8').read()

# 去掉注释 / url(...) / 引号字符串，防止里面的巧合文本被当成类名提取出来
# （标记的类名提取到此为止，后面 usage 扫描用的是各源文件的原始文本，不受影响）
css = re.sub(r'/\*.*?\*/', ' ', css_raw, flags=re.S)
css = re.sub(r'url\([^)]*\)', ' ', css)
css = re.sub(r'"[^"]*"|\'[^\']*\'', ' ', css)
class_tokens = sorted(set(re.findall(r'\.([a-zA-Z][\w-]*)', css)))

SRC = 'web/src'
files = []
for root, _dirs, names in os.walk(SRC):
    for n in names:
        if n.endswith(('.vue', '.ts')) and 'styles' not in root:
            files.append(os.path.join(root, n))

usage = collections.defaultdict(set)
for f in files:
    text = open(f, encoding='utf-8').read()
    for cls in class_tokens:
        # 边界：前后不能是 [\w-]（字母/数字/下划线/连字符），否则会把
        # .btn 命中进 .btn-group 之类的子串误判成使用。除此之外不限制
        # 具体是什么字符——引号、冒号、反引号、逗号、伪类冒号都算合法边界，
        # 这样才能覆盖 `{ dragging: x }` / `.cls:hover` 这类起点实现漏掉的写法。
        if re.search(r'(?<![\w-])' + re.escape(cls) + r'(?![\w-])', text):
            usage[cls].add(os.path.relpath(f, SRC))

verdicts = {}
for cls in class_tokens:
    users = sorted(usage.get(cls, ()))
    if not users:
        verdicts[cls] = '❓死样式?'
    elif len(users) == 1:
        verdicts[cls] = '→ scoped'
    else:
        verdicts[cls] = '→ primitives'

n_primitives = sum(1 for v in verdicts.values() if v == '→ primitives')
n_scoped = sum(1 for v in verdicts.values() if v == '→ scoped')
n_unknown = sum(1 for v in verdicts.values() if v.startswith('❓'))
print(f'# 共 {len(class_tokens)} 个类名  |  primitives(多文件) {n_primitives}  '
      f'scoped(单文件) {n_scoped}  ❓(未匹配到任何文件) {n_unknown}')
print()

print(f'{"类名":<28} {"文件数":<4} 建议            使用处')
for cls in class_tokens:
    users = sorted(usage.get(cls, ()))
    verdict = verdicts[cls]
    print(f'.{cls:<27} {len(users):<4} {verdict:<24} {", ".join(users[:4])}')
