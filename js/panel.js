/* ============================================================
 * panel.js — 底部信息面板(bottom sheet)
 *
 *   · 三种状态:collapsed(只露头部)/ normal / expanded
 *   · 手势:拖拽把手或点击切换
 *   · 展开区:强度变化曲线 + 「路径点 / 相关资讯」两个标签页
 *   · stat 卡片点击可展开完整文字(burst)
 * ============================================================ */

const PANEL = (() => {

  const $ = (id) => document.getElementById(id);
  let el, currentTyphoon = null;
  let onPointSelect = null; // 列表点选回调,由 app.js 注入

  const fmt = (v, dash = '—') => (v === null || v === undefined || v === '' || Number.isNaN(v)) ? dash : v;

  /* ---------- 状态切换 ---------- */
  let stateChangedAt = 0; // 记录状态切换时间,用于拦截随后的"幽灵点击"

  function setState(state) { // 'collapsed' | 'normal' | 'expanded'
    stateChangedAt = Date.now();
    el.classList.toggle('collapsed', state === 'collapsed');
    el.classList.toggle('expanded', state === 'expanded');
  }
  function getState() {
    if (el.classList.contains('collapsed')) return 'collapsed';
    if (el.classList.contains('expanded')) return 'expanded';
    return 'normal';
  }
  function cycle(dir) { // dir: 1 向上展开, -1 向下收起
    const order = ['collapsed', 'normal', 'expanded'];
    const i = order.indexOf(getState());
    setState(order[Math.min(2, Math.max(0, i + dir))]);
  }

  /* ---------- 拖拽手势 ---------- */
  function bindGesture() {
    const handle = $('panelHandle');
    let startY = null;

    const start = (y) => { startY = y; };
    const end = (y) => {
      if (startY === null) return;
      const dy = y - startY;
      if (Math.abs(dy) < 24) cycle(getState() === 'expanded' ? -1 : 1); // 视为点击
      else cycle(dy < 0 ? 1 : -1);
      startY = null;
    };

    handle.addEventListener('touchstart', e => start(e.touches[0].clientY), { passive: true });
    // touchend 必须 preventDefault:否则面板上滑后,浏览器会在原触点
    // 补发一次合成 click,正好落在滑上来的新闻链接上导致误跳转
    handle.addEventListener('touchend', e => {
      e.preventDefault();
      end(e.changedTouches[0].clientY);
    }, { passive: false });
    handle.addEventListener('mousedown',  e => start(e.clientY));
    window.addEventListener('mouseup',    e => startY !== null && end(e.clientY));
  }

  /* ---------- 标签页 ---------- */
  function bindTabs() {
    el.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        el.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        el.querySelectorAll('.tab-page').forEach(pg =>
          pg.hidden = pg.dataset.page !== tab.dataset.tab);
      });
    });
  }

  /* ---------- 强度变化曲线(最大风速 sparkline) ---------- */
  function renderSpark(ty) {
    const box = $('sparkline');
    const pts = ty.points.filter(p => p.speed !== null);
    if (pts.length < 2) { box.innerHTML = ''; return; }

    const W = 320, H = 56, PAD = 6;
    const speeds = pts.map(p => p.speed);
    const min = Math.min(...speeds), max = Math.max(...speeds);
    const x = (i) => PAD + i * (W - PAD * 2) / (pts.length - 1);
    const y = (v) => max === min ? H / 2 : H - PAD - (v - min) * (H - PAD * 2) / (max - min);

    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.speed).toFixed(1)}`).join('');
    const dots = pts.map((p, i) =>
      `<circle cx="${x(i).toFixed(1)}" cy="${y(p.speed).toFixed(1)}" r="2.4"
        fill="${TYPHOON.colorOf(p.level)}"/>`).join('');

    box.innerHTML = `
      <div class="spark-head">
        <span>强度变化 · 最大风速</span>
        <span class="spark-range">${min}–${max} m/s</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${path}" fill="none" stroke="rgba(232,241,248,.35)" stroke-width="1.5"/>
        ${dots}
      </svg>`;
  }

  /* ---------- 渲染 ---------- */
  function showPoint(p) {
    const lvColor = TYPHOON.colorOf(p.level);
    const badge = $('tyBadge');
    badge.textContent = p.strong;
    badge.style.setProperty('--lv-color', lvColor);
    badge.style.background = lvColor;

    $('tyTime').textContent = p.time;
    $('stPressure').textContent = fmt(p.pressure);
    $('stSpeed').textContent = fmt(p.speed);
    $('stPower').textContent = fmt(p.power);
    $('stMove').textContent = `${fmt(p.moveDir, '')} ${fmt(p.moveSpeed)}`.trim() || '—';
    $('stPos').textContent = `${p.lat.toFixed(1)}°N ${p.lng.toFixed(1)}°E`;
    $('stR7').textContent = p.r7 ? `${p.r7.ne}/${p.r7.se}/${p.r7.sw}/${p.r7.nw}` : '—';

    // 列表高亮
    document.querySelectorAll('.track-list li').forEach(li =>
      li.classList.toggle('current', li.dataset.time === p.time));
  }

  function renderList(ty) {
    const list = $('trackList');
    list.innerHTML = '';
    // 最新在前
    [...ty.points].reverse().forEach(p => {
      const li = document.createElement('li');
      li.dataset.time = p.time;
      li.innerHTML = `
        <span class="t-dot" style="background:${TYPHOON.colorOf(p.level)}"></span>
        <span class="t-time">${p.time.slice(5, 16)}</span>
        <span class="t-lv">${p.strong}</span>
        <span class="t-val">${fmt(p.speed)}m/s ${fmt(p.pressure)}hPa</span>`;
      li.addEventListener('click', () => {
        showPoint(p);
        onPointSelect && onPointSelect(p);
      });
      list.appendChild(li);
    });
  }

  // 新闻区渲染,由 app.js 拉取数据后调用
  function renderNews(result) {
    const box = $('newsList');
    if (!result || !result.items.length) {
      box.innerHTML = '<li class="news-empty">暂无相关资讯</li>';
      return;
    }
    const hint = result.mode === 'links'
      ? '<li class="news-hint">按台风名生成的资讯入口,点击查看详情</li>' : '';
    box.innerHTML = hint + result.items.map((n, i) => {
      const color = n.color || '#94a3b8';
      return `
      <li class="news-item">
        <span class="news-dot" style="background:${color}"></span>
        <div class="news-card" data-idx="${i}" data-url="${n.url.replace(/"/g, '&quot;')}">
          <div class="news-card-top">
            <span class="news-source" style="color:${color}">${n.source}</span>
            <span class="news-reltime">${n.rel || n.time || ''}</span>
          </div>
          <div class="news-card-main">
            <span class="news-icon">${n.icon || '📰'}</span>
            <span class="news-body">
              <span class="news-title">${n.title}</span>
              ${n.intro ? `<span class="news-intro">${n.intro}</span>` : ''}
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

  function show(ty) {
    currentTyphoon = ty;
    $('tyName').textContent = ty.name;
    $('tyEnName').textContent = ty.enName ? `${ty.enName} · 编号 ${ty.id}` : `编号 ${ty.id}`;
    renderList(ty);
    renderSpark(ty);
    if (ty.latest) showPoint(ty.latest);
    setState('normal');
  }

  /* ---------- 点击 stat 卡片展开文字 ---------- */
  function bindStatClick() {
    const panel = $('panel');
    panel.addEventListener('click', (e) => {
      const stat = e.target.closest('.stat');
      if (!stat) return;
      e.stopPropagation();
      const wasBurst = stat.classList.contains('burst');
      // 收起所有已展开的
      panel.querySelectorAll('.stat.burst').forEach(s => s.classList.remove('burst'));
      // 切换当前
      if (!wasBurst) stat.classList.add('burst');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#panel')) {
        panel.querySelectorAll('.stat.burst').forEach(s => s.classList.remove('burst'));
      }
    });
  }

  function init() {
    el = $('panel');
    bindGesture();
    bindStatClick();
    bindTabs();
    bindNewsClick();

    // 第二道防线:面板刚完成收起/展开的瞬间(450ms 内),
    // 拦截落在新闻列表上的点击,避免任何形式的误触跳转
    $('newsList').addEventListener('click', (e) => {
      if (Date.now() - stateChangedAt < 450) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    setState('normal');
  }

  return {
    init, show, showPoint, renderNews,
    set onPointSelect(fn) { onPointSelect = fn; },
  };
})();
