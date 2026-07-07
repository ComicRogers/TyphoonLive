/* ============================================================
 * news.js — 台风相关新闻(中国大陆直连方案)
 *
 * 三级数据源,按优先级依次尝试:
 *   1. 天行数据(配置 TIANAPI_KEY 后启用):关键词精准搜索,
 *      大陆 CDN + 完整 CORS 支持。在 https://www.tianapi.com
 *      免费注册,申领「综合新闻」接口 key(每日 100 次免费额度)。
 *   2. 新浪滚动新闻(默认,免 key):JSONP 调用不受跨域限制,
 *      大陆直连。拉取国内/社会频道最新各 50 条,按台风名 /
 *      "台风"关键词在前端过滤排序。
 *   3. 快捷入口兜底:两个源都无结果时,提供按台风名生成的
 *      权威资讯入口。
 * ============================================================ */

const NEWS = (() => {

  // 天行数据「综合新闻」接口 key,填入后启用精准搜索(推荐)
  const TIANAPI_KEY = '';

  /* ---------- JSONP 工具(绕过 CORS,大陆环境最稳) ---------- */
  function jsonp(url, timeout = 8000) {
    return new Promise((resolve, reject) => {
      // 注意:新浪接口拒绝下划线开头的回调名("callback illegal character")
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
      return (data.result?.newslist || []).map(n => ({
        title: n.title,
        url: n.url,
        source: n.source || '',
        time: (n.ctime || '').slice(5, 16),
        icon: '📰',
        intro: n.description || '',
      })).filter(n => n.title && n.url);
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

    // 相关性排序:标题含台风名 > 含"台风" > 简介含"台风"
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
        icon: '🌀',
        intro: it.intro || '',
      }));
    return hits;
  }

  /* ---------- 源 3:快捷入口兜底 ---------- */
  function quickLinks(name) {
    const q = encodeURIComponent('台风 ' + name);
    return [
      { icon: '📰', title: `百度新闻:台风“${name}”最新报道`,
        source: '新闻聚合搜索', url: `https://www.baidu.com/s?tn=news&wd=${q}` },
      { icon: '💬', title: `微博话题:#台风${name}#`,
        source: '实时讨论与现场图', url: `https://s.weibo.com/weibo?q=${encodeURIComponent('#台风' + name + '#')}` },
      { icon: '🌀', title: '中央气象台 · 台风网',
        source: '官方预报与预警发布', url: 'http://typhoon.nmc.cn/web.html' },
      { icon: '⛅', title: '中国天气网 · 台风专题',
        source: '影响分析与防御指南', url: 'https://www.weather.com.cn/' },
    ];
  }

  // 对外:返回 { mode: 'feed' | 'links', items: [...] }
  async function get(name) {
    if (TIANAPI_KEY) {
      try {
        const items = await fromTianapi(name);
        if (items.length) return { mode: 'feed', items };
      } catch (e) { console.warn('天行数据获取失败:', e); }
    }
    try {
      const items = await fromSina(name);
      if (items.length) return { mode: 'feed', items };
    } catch (e) { console.warn('新浪新闻获取失败:', e); }

    return { mode: 'links', items: quickLinks(name) };
  }

  return { get };
})();
