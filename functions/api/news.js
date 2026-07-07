/* ============================================================
 * functions/api/news.js — 台风新闻聚合 (Cloudflare Pages Functions)
 *
 * 调用方式: GET /api/news?name=台风名&key=TIANAPI_KEY(可选)
 *
 * 服务端并行拉取多个新闻源,合并/去重/排序后返回。
 * 解决纯前端方案中 CORS / JSONP 不稳定的问题。
 * ============================================================ */

// ---------- 工具函数 ----------

function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(+ts * 1000);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseRSSItems(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const desc = (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || '';
    const pubDate = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    if (title && link) {
      items.push({
        title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        url: link.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        intro: desc.replace(/<[^>]*>/g, '').replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 300),
        pubDate,
      });
    }
  }
  return items;
}

function tsFromPubDate(str) {
  if (!str) return 0;
  const d = new Date(str);
  return isNaN(d) ? 0 : Math.floor(d / 1000);
}

// ---------- 数据源 ----------

async function fetchTianapi(name, key) {
  const url = 'https://apis.tianapi.com/generalnews/index?key=' + key +
    '&word=' + encodeURIComponent('台风 ' + name) + '&num=10';
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.code !== 200) return [];
  return (data.result?.newslist || []).map((n) => ({
    title: n.title,
    url: n.url,
    intro: n.description || '',
    source: n.source || '综合新闻',
    time: fmtTs(n.ctime ? new Date(n.ctime).getTime() / 1000 : 0),
    ts: n.ctime ? Math.floor(new Date(n.ctime).getTime() / 1000) : 0,
    icon: '\u{1F4F0}',
    color: '#e53e3e',
  }));
}

async function fetchSina(name) {
  const LIDS = [2510, 2669, 2511];
  const promises = LIDS.flatMap((lid) =>
    [1, 2].map((page) =>
      fetch(
        'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=' +
          lid +
          '&num=50&page=' +
          page
      )
        .then((r) => r.json())
        .catch(() => null)
    )
  );
  const results = await Promise.allSettled(promises);

  const seen = new Set();
  const all = [];
  results.forEach((r) => {
    if (r.status !== 'fulfilled' || !r.value?.result?.data) return;
    r.value.result.data.forEach((it) => {
      if (it.url && !seen.has(it.url)) {
        seen.add(it.url);
        all.push(it);
      }
    });
  });

  return all
    .filter((it) => {
      const t = (it.title || '').toLowerCase(),
        intro = (it.intro || '').toLowerCase();
      const kw = name.toLowerCase();
      return (
        t.includes(kw) ||
        t.includes('台风') ||
        intro.includes(kw) ||
        intro.includes('台风')
      );
    })
    .sort((a, b) => (+b.ctime || 0) - (+a.ctime || 0))
    .slice(0, 8)
    .map((it) => ({
      title: it.title,
      url: it.url,
      intro: it.intro || '',
      source: it.media_name || '新浪新闻',
      time: fmtTs(it.ctime || 0),
      ts: +it.ctime || 0,
      icon: '\u{1F300}',
      color: '#f59e0b',
    }));
}

async function fetchRSSFeeds(name) {
  const feeds = [
    {
      url: 'http://www.chinanews.com.cn/rss/scroll-news.xml',
      label: '中国新闻网',
      color: '#3b82f6',
    },
    {
      url: 'http://www.xinhuanet.com/politics/xhll.xml',
      label: '新华网',
      color: '#ef4444',
    },
  ];

  const results = await Promise.allSettled(
    feeds.map((f) =>
      fetch(f.url)
        .then((r) => r.text())
        .then((xml) => ({ label: f.label, color: f.color, items: parseRSSItems(xml) }))
        .catch(() => null)
    )
  );

  const items = [];
  results.forEach((r) => {
    if (r.status !== 'fulfilled' || !r.value) return;
    const { label, color, items: feedItems } = r.value;
    feedItems.forEach((it) => {
      const t = (it.title || '').toLowerCase();
      if (t.includes(name.toLowerCase()) || t.includes('台风')) {
        items.push({
          title: it.title,
          url: it.url,
          intro: it.intro || '',
          source: label,
          time: fmtTs(tsFromPubDate(it.pubDate)),
          ts: tsFromPubDate(it.pubDate),
          icon: '\u{1F4E1}',
          color: color,
        });
      }
    });
  });

  return items;
}

// ---------- 主入口 ----------

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  const name = url.searchParams.get('name');
  if (!name) {
    return new Response(JSON.stringify({ error: '缺少台风名称参数 ?name=' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const tianKey = url.searchParams.get('key') || env.TIANAPI_KEY || '';

  // 并行拉取所有源
  const fetchers = [];
  if (tianKey) {
    fetchers.push(fetchTianapi(name, tianKey).catch(() => []));
  }
  fetchers.push(fetchSina(name).catch(() => []));
  fetchers.push(fetchRSSFeeds(name).catch(() => []));

  const results = await Promise.all(fetchers);
  const allItems = results.flat();

  // 去重(按 URL)
  const seen = new Set();
  const unique = allItems.filter((it) => {
    if (seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });

  // 相关性排序
  const scored = unique.map((it) => {
    const t = it.title || '', intro = it.intro || '';
    let s = 0;
    if (t.includes(name)) s = 3;
    else if (t.includes('台风')) s = 2;
    if (intro.includes(name)) s = Math.max(s, 1);
    if (intro.includes('台风')) s = Math.max(s, 1);
    return { ...it, score: s };
  });

  scored.sort((a, b) => b.score - a.score || b.ts - a.ts);

  const relevant = scored.filter((it) => it.score > 0).slice(0, 15);

  return new Response(JSON.stringify({ items: relevant }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=120',
    },
  });
}
