/* ============================================================
 * panel.js — 底部信息面板(bottom sheet)
 *
 *   · 三种状态:collapsed(只露头部)/ normal / expanded(含路径列表)
 *   · 手势:拖拽把手或点击切换
 *   · 展示:名称、编号、强度徽章、六项核心指标、历史路径列表
 * ============================================================ */

const PANEL = (() => {

  const $ = (id) => document.getElementById(id);
  let el, currentTyphoon = null;
  let onPointSelect = null; // 列表点选回调,由 app.js 注入

  const fmt = (v, dash = '—') => (v === null || v === undefined || v === '' || Number.isNaN(v)) ? dash : v;

  /* ---------- 状态切换 ---------- */
  function setState(state) { // 'collapsed' | 'normal' | 'expanded'
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
    handle.addEventListener('touchend',   e => end(e.changedTouches[0].clientY));
    handle.addEventListener('mousedown',  e => start(e.clientY));
    window.addEventListener('mouseup',    e => startY !== null && end(e.clientY));
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

  function show(ty) {
    currentTyphoon = ty;
    $('tyName').textContent = ty.name;
    $('tyEnName').textContent = ty.enName ? `${ty.enName} · 编号 ${ty.id}` : `编号 ${ty.id}`;
    renderList(ty);
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
    setState('normal');
  }

  return {
    init, show, showPoint,
    set onPointSelect(fn) { onPointSelect = fn; },
  };
})();
