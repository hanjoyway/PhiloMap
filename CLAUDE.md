# PhiloMap — 世界哲学可视化时间线

## 项目目标

做一个交互式哲学史可视化网站：横轴为时间（约 600 BCE → 现代），纵向用 swimlane 按地区或流派分层，展示哲学家及其思想脉络。

## 风格

- Histomap 风格：水平色带/swimlane，随时间流动
- 可缩放、可交互（hover 看详情、点击展开）
- 极简学术风格

## 技术方案

- **D3.js** 作为核心可视化库
- 静态网站，可部署到 GitHub Pages
- 数据用 JSON 管理（哲学家、流派、时间、地区、影响关系）

## 参考项目

| 项目 | 链接 | 说明 |
|------|------|------|
| MChamberlin/histomap | https://github.com/MChamberlin/histomap | D3.js Histomap 复刻，最佳起点 |
| cmchap/Histomap | https://github.com/cmchap/Histomap | 另一个 D3.js Histomap |
| HamdanDev/HistoMap | https://github.com/HamdanDev/HistoMap | 地图 + 时间滑块，全栈 web app |
| Parthenon Graphics 海报 | https://www.parthenon-graphics.com/product-page/timeline-of-western-philosophy | 44 英寸 swimlane 哲学海报，布局参考 |
| Önduygu 哲学史 | https://www.denizcemonduygu.com/philo/browse/ | 思想关系网络，数据参考 |

## Swimlane 分层建议

按地区/文明：
- 古希腊 / 罗马
- 中世纪欧洲（经院哲学）
- 伊斯兰世界
- 中国（先秦诸子 → 宋明理学 → 近现代）
- 印度
- 近现代西方（理性主义、经验主义、德国唯心论、分析哲学、大陆哲学 ...）

## 数据结构草案

```json
{
  "id": "kant",
  "name": "Immanuel Kant",
  "name_zh": "康德",
  "born": 1724,
  "died": 1804,
  "region": "europe-modern",
  "school": ["German Idealism", "Transcendental Idealism"],
  "influenced_by": ["hume", "leibniz", "rousseau"],
  "influenced": ["fichte", "hegel", "schopenhauer"],
  "key_works": ["Critique of Pure Reason", "Critique of Practical Reason"],
  "summary": "..."
}
```

## 当前进度

v0.1 已完成并部署：
- 线上地址：https://hanjoyway.github.io/PhiloMap/
- GitHub repo：https://github.com/hanjoyway/PhiloMap
- 7 swimlanes, 89 philosophers, D3.js zoom/pan, hover tooltip, influence lines, detail panel, EN/ZH toggle
- 静态站通过 GitHub Actions 自动部署到 GitHub Pages

## 下一步（可选增强）

1. 扩充数据集（更多哲学家、更细的流派分类）
2. 搜索/筛选功能（按名字、学派、地区过滤）
3. 视觉优化（swimlane 宽度动态化、更精细的配色）
4. 移动端适配
5. 哲学流派色带（Histomap 风格的连续色块）
