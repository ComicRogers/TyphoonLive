/* ============================================================
 * news.js — 台风相关新闻
 *
 * 两种模式:
 *   1. feed:配置了 NEWS_PROXY(CORS 代理)时,抓取 Google News
 *      中文 RSS 中该台风的最新报道,渲染真实新闻列表;
 *   2. links(默认):浏览器无法跨域抓取新闻时,提供按台风名
 *      生成的权威资讯快捷入口(百度新闻、微博话题、中央气象台等)。
 * ============================================================ */

const NEWS = (() => {

  // 与 api.js 的 PROXY 同理,填入你的 CORS 代理即可启用真实新闻抓取
  // 例:const NEWS_PROXY = 'https://your-worker.example.workers.dev/?url=';
  const NEWS_PROXY = '';

  async function fetchFeed(name) {
    const rss = 'https://news.google.com/rss/search?q=' +
      encodeURIComponent(`台风 ${name}`) + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans';

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(NEWS_PROXY + encodeURIComponent(rss), { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
      return [...xml.querySelectorAll('item')].slice(0, 6).map(item => ({
        title: item.querySelector('title')?.textContent || '',
        url: item.querySelector('link')?.textContent || '#',
        source: item.querySelector('source')?.textContent || '',
        time: (item.querySelector('pubDate')?.textContent || '').slice(0, 22),
      })).filter(n => n.title);
    } finally {
      clearTimeout(timer);
    }
  }

  // 兜底:按台风名生成权威资讯入口
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
    if (NEWS_PROXY) {
      try {
        const items = await fetchFeed(name);
        if (items.length) return { mode: 'feed', items };
      } catch (e) {
        console.warn('新闻抓取失败,使用快捷入口:', e);
      }
    }
    return { mode: 'links', items: quickLinks(name) };
  }

  return { get };
})();
