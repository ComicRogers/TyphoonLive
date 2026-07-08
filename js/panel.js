/* ============================================================
 * panel.js — 信息浮层 + 底部路径/资讯列表
 *
 *   信息区悬浮在地图左下角,展示台风核心数据。
 *   底部区域包含「历史路径」和「相关资讯」两个标签页。
 * ============================================================ */

const PANEL = (() => {

  const $ = (id) => document.getElementById(id);
  let onPointSelect = null;
  let currentTab = 'track';

  const fmt = (v, dash = '—') => (v === null || v === undefined || v === '' || Number.isNaN(v)) ? dash : v;

  /* ---------- 信息浮层渲染 ---------- */

  function renderDataGrid(p, lvColor) {
    const rows = [
      { label: '中心气压', value: fmt(p.pressure) + ' hPa' },
      { label: '风力等级', value: fmt(p.power) + '级' },
    ];
    if (p.moveDir || p.moveSpeed) {
      rows.push({ label: '移动', value: [fmt(p.moveDir, ''), fmt(p.moveSpeed, '') + ' km/h'].filter(Boolean).join(' ') || '—' });
    }
    rows.push({ label: '中心位置', value: p.lat != null ? p.lat.toFixed(1) + '°N ' + p.lng.toFixed(1) + '°E' : '—' });
    return rows.map(r =>
      '<span class="data-label">' + r.label + '</span><span class="data-value">' + r.value + '</span>'
    ).join('');
  }

  function renderWindBars(p, lvColor) {
    if (!p.r7) return '';
    const maxR = 500;
    let html = '';
    html += '<div class="wind-bar-row">';
    html += '<span class="wind-bar-label">七级风圈</span>';
    html += '<span class="wind-bar-track"><span class="wind-bar-fill" style="width:' + Math.min(100, Math.max(p.r7.ne, p.r7.se, p.r7.sw, p.r7.nw) / maxR * 100) + '%;background:' + lvColor + ';opacity:.2;"></span></span>';
    html += '<span class="wind-bar-value">' + Math.max(p.r7.ne, p.r7.se, p.r7.sw, p.r7.nw) + ' km</span>';
    html += '</div>';
    if (p.r10) {
      html += '<div class="wind-bar-row">';
      html += '<span class="wind-bar-label">十级风圈</span>';
      html += '<span class="wind-bar-track"><span class="wind-bar-fill" style="width:' + Math.min(100, Math.max(p.r10.ne, p.r10.se, p.r10.sw, p.r10.nw) / maxR * 100) + '%;background:' + lvColor + ';opacity:.32;"></span></span>';
      html += '<span class="wind-bar-value">' + Math.max(p.r10.ne, p.r10.se, p.r10.sw, p.r10.nw) + ' km</span>';
      html += '</div>';
    }
    return html;
  }

  function showPoint(p) {
    const lvColor = TYPHOON.colorOf(p.level);

    $('tyBadge').textContent = p.strong;
    $('tyBadge').style.color = lvColor;
    $('stSpeed').textContent = fmt(p.speed);
    $('tyTime').textContent = '观测时间 ' + (p.time || '—');

    $('dataGrid').innerHTML = renderDataGrid(p, lvColor);
    $('windBars').innerHTML = renderWindBars(p, lvColor);

    // 列表高亮
    document.querySelectorAll('.track-list li').forEach(li =>
      li.classList.toggle('current', li.dataset.time === p.time));
  }

  /* ---------- 历史路径列表 ---------- */

  function renderList(ty) {
    const list = $('trackList');
    list.innerHTML = '';
    [...ty.points].reverse().forEach(p => {
      const li = document.createElement('li');
      li.dataset.time = p.time;
      const lvColor = TYPHOON.colorOf(p.level);
      li.innerHTML =
        '<span class="track-dot" style="background:' + lvColor + ';"></span>' +
        '<span class="track-time">' + (p.time || '').slice(5, 16) + '</span>' +
        '<span class="track-lv">' + p.strong + '</span>' +
        '<span class="track-val">' + fmt(p.speed) + 'm/s ' + fmt(p.pressure) + 'hPa</span>';
      li.addEventListener('click', () => {
        showPoint(p);
        if (onPointSelect) onPointSelect(p);
      });
      list.appendChild(li);
    });
  }

  /* ---------- 标签页 ---------- */

  function bindTabs() {
    document.querySelectorAll('.bottom-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.bottom-tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
        const page = tab.dataset.tab;
        currentTab = page;
        $('trackList').hidden = page !== 'track';
        $('newsList').hidden = page !== 'news';
      });
    });
  }

  /* ---------- 资讯渲染 ---------- */

  function renderNews(result) {
    const box = $('newsList');
    if (!result || !result.items.length) {
      box.innerHTML = '<li class="news-empty">暂无相关资讯</li>';
      return;
    }
    const hint = result.mode === 'links'
      ? '<li class="news-hint">按台风名生成的资讯入口,点击查看详情</li>' : '';
    box.innerHTML = hint + result.items.map((n, i) => {
      const color = n.color || 'var(--c-ink3)';
      return `
      <li class="news-item">
        <span class="news-dot" style="background:${color}"></span>
        <div class="news-card" data-idx="${i}" data-url="${n.url.replace(/"/g, '&quot;')}">
          <div class="news-card-top">
            <span class="news-source" style="color:${color}">${n.source}</span>
            <span class="news-reltime">${n.rel || n.time || ''}</span>
          </div>
          <div class="news-card-main">
            <span class="news-icon">${n.icon || ''}</span>
            <span class="news-body">
              <span class="news-title">${n.title}</span>
              ${n.intro ? '<span class="news-intro">' + n.intro + '</span>' : ''}
            </span>
            <span class="news-arrow">›</span>
          </div>
        </div>
        <div class="news-detail" hidden>
          <p class="news-detail-text">${n.intro || n.title}</p>
          <div class="news-detail-meta">
            <span>${n.source}${n.time ? ' · ' + n.time : ''}</span>
            <a class="news-action" href="${n.url}" target="_blank" rel="noopener">阅读全文 →</a>
          </div>
        </div>
      </li>`;
    }).join('');
  }

  function bindNewsClick() {
    const list = $('newsList');
    list.addEventListener('click', (e) => {
      if (e.target.closest('.news-action')) return;
      const card = e.target.closest('.news-card');
      if (!card) return;

      const allCards = list.querySelectorAll('.news-card.expanded');
      allCards.forEach(c => {
        if (c !== card) {
          c.classList.remove('expanded');
          const otherDetail = c.parentElement.querySelector('.news-detail');
          if (otherDetail) otherDetail.hidden = true;
        }
      });

      const isExpanded = card.classList.toggle('expanded');
      const detail = card.parentElement.querySelector('.news-detail');
      if (detail) detail.hidden = !isExpanded;
    });
  }

  /* ---------- 展开/收起 ---------- */

  function bindToggle() {
    const overlay = $('infoOverlay');
    const toggle = $('overlayToggle');
    const nameRow = overlay.querySelector('.typhoon-name-row');

    function expand() {
      overlay.classList.add('expanded');
      toggle.setAttribute('title', '收起详情');
      toggle.setAttribute('aria-label', '收起详情');
    }
    function collapse() {
      overlay.classList.remove('expanded');
      toggle.setAttribute('title', '展开详情');
      toggle.setAttribute('aria-label', '展开详情');
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.classList.contains('expanded') ? collapse() : expand();
    });

    nameRow.addEventListener('click', () => {
      if (!overlay.classList.contains('expanded')) expand();
    });

    // 首屏默认展开
    expand();
  }

  /* ---------- 主入口 ---------- */

  function show(ty) {
    $('tyName').textContent = ty.name;
    $('tyEnName').textContent = ty.enName ? ty.enName + ' · 编号 ' + ty.id : '编号 ' + ty.id;
    renderList(ty);
    if (ty.latest) showPoint(ty.latest);
  }

  function init() {
    bindTabs();
    bindNewsClick();
    bindToggle();
  }

  return {
    init, show, showPoint, renderNews,
    set onPointSelect(fn) { onPointSelect = fn; },
  };
})();
