# 台风路径 · 实时追踪

纯 HTML/CSS/JS 的台风实时路径查看网站,移动端优先、桌面端自适应,无需构建工具。

## 功能

- 实况轨迹:分段实线,颜色随强度变化(六级官方色标)
- 路径点:点击查看该时刻风速 / 气压 / 强度,与底部面板联动
- 预报路径:多机构(中央气象台、日本气象厅等)不同颜色虚线
- 风圈:七 / 十 / 十二级风圈四象限多边形
- 24 / 48 小时警戒线
- 多台风切换(顶部横滑 chips,活跃台风优先)
- 底部信息面板:可拖拽收起 / 展开,展开后含完整历史路径列表
- 每 10 分钟自动刷新,页面回到前台时也会刷新

## 运行

静态站点,任选其一:

```bash
# 本地预览
python3 -m http.server 8080
# 然后访问 http://localhost:8080

# 或直接部署到 GitHub Pages / Vercel / Nginx 等任意静态托管
```

## 数据源

默认调用中国台风网体系的公开接口(浙江省水利厅台风路径系统):

- 列表:`https://typhoon.slt.zj.gov.cn/Api/TyphoonList/{年份}`
- 详情:`https://typhoon.slt.zj.gov.cn/Api/TyphoonInfo/{台风编号}`

若浏览器直连受 CORS 限制(部分网络环境下会发生),应用会自动降级为内置演示数据并在状态栏显示"演示模式"。接入实时数据的两种方式:

1. **CORS 代理**:在 `js/api.js` 顶部的 `PROXY` 填入你的代理地址(如 Cloudflare Worker):
   ```js
   const PROXY = 'https://your-worker.example.workers.dev/?url=';
   ```
2. **同源反代**:部署到 Nginx 时把 `/Api` 反代到数据源,并将 `js/api.js` 的 `BASE` 改为 `'/Api'`。

## 地图底图

默认使用免 key 的 Carto 暗色底图。如需天地图,在 [天地图控制台](https://console.tianditu.gov.cn/) 申请浏览器端 key,填入 `js/map.js` 的 `TIANDITU_KEY` 即可自动切换为天地图矢量图 + 中文注记。

## 文件结构

```
typhoon/
├── index.html          # 入口页面
├── css/style.css       # 移动端优先的响应式样式
└── js/
    ├── api.js          # 数据获取与解析(含演示数据兜底)
    ├── map.js          # 地图初始化、底图、警戒线
    ├── typhoon.js      # 轨迹 / 路径点 / 风圈 / 预报线渲染
    ├── panel.js        # 底部信息面板(bottom sheet)
    ├── switcher.js     # 多台风切换 chips
    └── app.js          # 主入口,协调各模块 + 自动刷新
```
