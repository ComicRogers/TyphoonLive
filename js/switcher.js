/* ============================================================
 * switcher.js — 多台风切换组件(顶部横滑 chips)
 *
 *   · 活跃台风排在前面并带强度色点
 *   · 点击 chip 触发 onSelect 回调加载对应台风
 * ============================================================ */

const SWITCHER = (() => {

  let container = null;
  let onSelect = null; // (tfbh) => void,由 app.js 注入
  let activeId = null;

  function render(list, typhoonLevels = {}) {
    container.innerHTML = '';

    if (!list.length) {
      const empty = document.createElement('span');
      empty.className = 'chip';
      empty.style.pointerEvents = 'none';
      empty.textContent = '当前无编号台风';
      container.appendChild(empty);
      return;
    }

    // 活跃台风优先
    const sorted = [...list].sort((a, b) => (b.isActive - a.isActive));

    sorted.forEach(t => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (t.id === activeId ? ' active' : '');
      chip.dataset.id = t.id;

      const lvColor = typhoonLevels[t.id] || (t.isActive ? '#4fd8eb' : 'rgba(125,147,168,.6)');
      chip.innerHTML = `<span class="dot" style="--lv-color:${lvColor}"></span>
        ${t.name}<small style="color:var(--text-dim);margin-left:2px">${t.id}</small>`;

      chip.addEventListener('click', () => {
        if (t.id === activeId) return;
        setActive(t.id);
        onSelect && onSelect(t.id);
      });
      container.appendChild(chip);
    });
  }

  function setActive(id) {
    activeId = id;
    container.querySelectorAll('.chip').forEach(c =>
      c.classList.toggle('active', c.dataset.id === id));
  }

  // 台风数据加载完后,用其最新强度更新 chip 色点
  function updateLevel(id, color) {
    const dot = container.querySelector(`.chip[data-id="${id}"] .dot`);
    if (dot) dot.style.setProperty('--lv-color', color);
  }

  function init() {
    container = document.getElementById('switcher');
  }

  return {
    init, render, setActive, updateLevel,
    set onSelect(fn) { onSelect = fn; },
  };
})();
