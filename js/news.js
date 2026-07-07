/* ============================================================
 * news.js — 台风相关新闻
 *
 * 四级数据源,按优先级依次尝试:
 *   1. /api/news (Vercel Serverless 服务端聚合):
 *      天行数据 + 新浪 + RSS,服务端拉取无 CORS 问题。
 *      部署到 Vercel 后自动生效,本地开发时自动降级。
 *   2. 天行数据(配置 TIANAPI_KEY 后启用):关键词精准搜索,
 *      大陆 CDN + 完整 CORS 支持。在 https://www.tianapi.com
 *      免费注册,申领「综合新闻」接口 key(每日 100 次免费额度)。
 *   3. 新浪滚动新闻(默认,免 key):JSONP 调用不受跨域限制,
 *      大陆直连。拉取国内/社会频道最新各 50 条,按台风名 /
 *      "台风"关键词在前端过滤排序。
 *   4. 快捷入口兜底:以上源都无结果时,提供按台风名生成的
 *      权威资讯入口。
 * ============================================================ */

const NEWS = (() => {

  // 天行数据「综合新闻」接口 key,填入后启用精准搜索(推荐)
  const TIANAPI_KEY = '';

  /* ---------- 相对时间工具 ---------- */
  function relTime(ts) {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts * 1000;
    if (diff < 0) return '';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + '分钟前';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + '小时前';
    const days = Math.floor(hours / 24);
    if (days < 30) return days + '天前';
    return fmtTime(ts);
  }

  /* ---------- JSONP 工具(绕过 CORS,大陆环境最稳) ---------- */
  function jsonp(url, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const cb = 'tyNewsCb' + Date.now() + Math.floor(Math.random() * 1e4);
      const script = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('jsonp 超时')); }, timeout);

      function cleanup() {
        clearTimeout(timer);
        delete window[cb];
        script.remove();
      }
      window[cb] = (data) => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('jsonp 加载失败')); };
      script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(script);
    });
  }

  const fmtTime = (unixSec) => {
    const d = new Date(+unixSec * 1000);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /* ---------- 源 0: /api/news 服务端聚合 ---------- */
  async function fromAPI(name) {
    const url = '/api/news?name=' + encodeURIComponent(name);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error('API 返回 ' + res.status);
      const data = await res.json();
      if (!data.items || !data.items.length) throw new Error('API 无结果');
      return {
        mode: 'feed',
        items: data.items.map(n => ({
          ...n,
          rel: relTime(n.ts),
        })),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- 源 1:天行数据关键词搜索 ---------- */
  async function fromTianapi(name) {
    const url = 'https://apis.tianapi.com/generalnews/index?key=' + TIANAPI_KEY +
      '&word=' + encodeURIComponent('台风 ' + name) + '&num=10';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      const data = await res.json();
      if (data.code !== 200) throw new Error(data.msg || 'tianapi code ' + data.code);
      return (data.result?.newslist || []).map(n => {
        const ts = n.ctime ? Math.floor(new Date(n.ctime).getTime() / 1000) : 0;
        return {
          title: n.title,
          url: n.url,
          source: n.source || '',
          time: fmtTime(ts),
          ts: ts,
          rel: relTime(ts),
          icon: '📰',
          color: '#e53e3e',
          intro: n.description || '',
        };
      }).filter(n => n.title && n.url);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- 源 2:新浪滚动新闻(JSONP 免 key) ---------- */
  async function fromSina(name) {
    // 国内、社会、国际 3 个频道 × 2 页,并行拉取约 300 条
    const LIDS = [2510, 2669, 2511];
    const reqs = [];
    LIDS.forEach(lid => [1, 2].forEach(page => reqs.push(jsonp(
      `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&num=50&page=${page}&t=${Date.now()}`
    ))));
    const results = await Promise.allSettled(reqs);

    const all = [];
    const seen = new Set();
    results.forEach(r => {
      if (r.status !== 'fulfilled') return;
      (r.value?.result?.data || []).forEach(it => {
        if (it.url && !seen.has(it.url)) { seen.add(it.url); all.push(it); }
      });
    });
    if (!all.length) throw new Error('新浪滚动新闻无返回');

    const score = (it) => {
      const t = it.title || '', intro = it.intro || '';
      if (name && t.includes(name)) return 3;
      if (t.includes('台风')) return 2;
      if ((name && intro.includes(name)) || intro.includes('台风')) return 1;
      return 0;
    };
    const hits = all.map(it => [score(it), it])
      .filter(([s]) => s > 0)
      .sort((a, b) => b[0] - a[0] || (+b[1].ctime || 0) - (+a[1].ctime || 0))
      .slice(0, 8)
      .map(([, it]) => ({
        title: it.title,
        url: it.url,
        source: it.media_name || '新浪新闻',
        time: fmtTime(it.ctime),
        ts: +it.ctime || 0,
        rel: relTime(+it.ctime || 0),
        icon: '🌀',
        color: '#f59e0b',
        intro: it.intro || '',
      }));
    return hits;
  }

  /* ---------- 源 3:快捷入口兜底 ---------- */
  function quickLinks(name) {
    const q = encodeURIComponent('台风 ' + name);
    return [
      { icon: '📰', title: `百度新闻:台风"${name}"最新报道`,
        source: '新闻聚合搜索', url: `https://www.baidu.com/s?tn=news&wd=${q}`, color: '#3b82f6' },
      { icon: '💬', title: `微博话题:#台风${name}#`,
        source: '实时讨论与现场图', url: `https://s.weibo.com/weibo?q=${encodeURIComponent('#台风' + name + '#')}`,
        color: '#ef4444' },
      { icon: '🌀', title: '中央气象台 · 台风网',
        source: '官方预报与预警发布', url: 'http://typhoon.nmc.cn/web.html', color: '#0ea5e9' },
      { icon: '⛅', title: '中国天气网 · 台风专题',
        source: '影响分析与防御指南', url: 'https://www.weather.com.cn/', color: '#10b981' },
    ];
  }

  async function get(name) {
    // 优先:服务器聚合 API
    try {
      const r = await fromAPI(name);
      if (r && r.items.length) return r;
    } catch (e) { console.warn('API 聚合获取失败,降级到直连:', e.message); }

    // 降级 1:天行数据
    if (TIANAPI_KEY) {
      try {
        const items = await fromTianapi(name);
        if (items.length) return { mode: 'feed', items };
      } catch (e) { console.warn('天行数据获取失败:', e); }
    }

    // 降级 2:新浪滚动新闻
    try {
      const items = await fromSina(name);
      if (items.length) return { mode: 'feed', items };
    } catch (e) { console.warn('新浪新闻获取失败:', e); }

    // 降级 3:快捷入口
    return { mode: 'links', items: quickLinks(name) };
  }

  return { get };
})();
