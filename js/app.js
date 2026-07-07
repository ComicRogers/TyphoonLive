/* ============================================================
 * app.js — 主入口
 *
 * 数据流:API 拉取 → TYPHOON 渲染地图 → PANEL 更新面板
 *         → SWITCHER 更新台风列表
 * 每 10 分钟自动刷新当前台风。
 * ============================================================ */

(() => {

  const REFRESH_MS = 10 * 60 * 1000;
  const $ = (id) => document.getElementById(id);

  let currentId = null;
  let refreshTimer = null;
  let usingDemo = false;

  /* ---------- 基础 UI 工具 ---------- */

  function toast(msg, ms = 3200) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function setStatus(text, cls = '') {
    const s = $('dataStatus');
    s.textContent = text;
    s.className = 'topbar-status ' + cls;
  }

  /* ---------- 图例 ---------- */

  function buildLegend(ty) {
    $('legendList').innerHTML = Object.values(TYPHOON.LEVEL)
      .map(lv => `<li><span class="swatch" style="background:${lv.color}"></span>${lv.name}</li>`)
      .join('');
    $('legendAgency').innerHTML = TYPHOON.agenciesOf(ty)
      .map(a => `<li><span class="swatch line" style="background:${a.color}"></span>${a.name}</li>`)
      .join('') || '<li style="color:var(--text-dim)">暂无预报数据</li>';
  }

  /* ---------- 台风加载 ---------- */

  async function loadTyphoon(id) {
    currentId = id;
    let ty;

    if (usingDemo) {
      ty = API.demoData();
    } else {
      try {
        setStatus('加载中…');
        ty = await API.fetchTyphoon(id);
        setStatus('实时数据', 'ok');
      } catch (e) {
        console.warn('台风详情获取失败:', e);
        toast('数据接口暂不可用,已切换到演示数据');
        usingDemo = true;
        ty = API.demoData();
        setStatus('演示模式', 'warn');
      }
    }

    if (!ty.points.length) {
      toast('该台风暂无路径数据');
      return;
    }

    const bounds = TYPHOON.render(ty);
    PANEL.show(ty);
    buildLegend(ty);
    MAP.fitTyphoon(bounds);
    if (ty.latest) SWITCHER.updateLevel(ty.id, TYPHOON.colorOf(ty.latest.level));
  }

  /* ---------- 启动流程 ---------- */

  async function bootstrap() {
    let list = [];
    try {
      setStatus('连接中…');
      list = await API.fetchList();
      setStatus('实时数据', 'ok');
    } catch (e) {
      console.warn('台风列表获取失败:', e);
      usingDemo = true;
      setStatus('演示模式', 'warn');
      toast('无法直连台风数据接口(可能受跨域限制),当前为演示数据。可在 js/api.js 配置代理接入实时数据。', 5000);
      const demo = API.demoData();
      list = [{ id: demo.id, name: demo.name, enName: demo.enName, isActive: true }];
    }

    SWITCHER.render(list);

    // 默认选中:优先活跃台风,其次最新编号
    const first = list.find(t => t.isActive) || list[list.length - 1];
    if (first) {
      SWITCHER.setActive(first.id);
      await loadTyphoon(first.id);
    } else {
      setStatus('无编号台风', 'ok');
    }
  }

  function startAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (currentId && !usingDemo && document.visibilityState === 'visible') {
        loadTyphoon(currentId);
      }
    }, REFRESH_MS);
  }

  /* ---------- 事件绑定 ---------- */

  function bindEvents() {
    // 台风切换
    SWITCHER.onSelect = (id) => loadTyphoon(id);

    // 地图点击路径点 → 面板联动
    TYPHOON.onPointClick = (p) => PANEL.showPoint(p);

    // 面板列表点选 → 地图联动
    PANEL.onPointSelect = (p) => MAP.flyTo([p.lat, p.lng]);

    // 回到台风视野(重新加载并 fitBounds)
    $('btnLocate').addEventListener('click', () => {
      if (currentId) loadTyphoon(currentId);
    });

    // 图例开关
    $('btnLegend').addEventListener('click', () => {
      const lg = $('legend');
      lg.hidden = !lg.hidden;
    });

    // 页面回到前台时刷新
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && currentId && !usingDemo) {
        loadTyphoon(currentId);
      }
    });
  }

  /* ---------- 启动 ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    MAP.init();
    PANEL.init();
    SWITCHER.init();
    bindEvents();
    bootstrap();
    startAutoRefresh();
  });
})();
