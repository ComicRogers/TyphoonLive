/* ============================================================
 * switcher.js — 多台风切换组件(顶部文字链接)
 *
 *   每个台风标签左侧有强度色圆点,激活时填实。
 *   活跃台风排在前面并带强度色点。
 *   点击触发 onSelect 回调加载对应台风。
 * ============================================================ */

const SWITCHER = (() => {

  let container = null;
  let onSelect = null;
  let activeId = null;

  function render(list, typhoonLevels = {}) {
    container.innerHTML = '';

    if (!list.length) {
      const span = document.createElement('span');
      span.style.cssText = 'font-size:13px;color:var(--c-ink4);pointer-events:none;';
      span.textContent = '当前无编号台风';
      container.appendChild(span);
      return;
    }

    const sorted = [...list].sort((a, b) => (b.isActive - a.isActive));

    sorted.forEach((t, i) => {
      const btn = document.createElement('button');
      if (t.id === activeId) btn.classList.add('active');
      btn.dataset.id = t.id;

      const lvColor = typhoonLevels[t.id] || (t.isActive ? 'rgba(0,0,0,.4)' : 'var(--c-ink4)');

      const dot = document.createElement('span');
      dot.className = 'switcher-dot';
      dot.style.color = lvColor;
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(t.name));

      btn.addEventListener('click', () => {
        if (t.id === activeId) return;
        setActive(t.id);
        if (onSelect) onSelect(t.id);
      });

      container.appendChild(btn);

      // 分隔符
      if (i < sorted.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '·';
        container.appendChild(sep);
      }
    });
  }

  function setActive(id) {
    activeId = id;
    container.querySelectorAll('button').forEach(btn => {
      const isActive = btn.dataset.id === id;
      btn.classList.toggle('active', isActive);
      const dot = btn.querySelector('.switcher-dot');
      if (dot && isActive) dot.style.backgroundColor = dot.style.color;
      else if (dot) dot.style.backgroundColor = 'transparent';
    });
  }

  function updateLevel(id, color) {
    const btn = container.querySelector('button[data-id="' + id + '"]');
    if (!btn) return;
    const dot = btn.querySelector('.switcher-dot');
    if (dot) {
      dot.style.color = color;
      if (btn.classList.contains('active')) dot.style.backgroundColor = color;
    }
  }

  function init() {
    container = document.getElementById('switcher');
  }

  return {
    init, render, setActive, updateLevel,
    set onSelect(fn) { onSelect = fn; },
  };
})();
