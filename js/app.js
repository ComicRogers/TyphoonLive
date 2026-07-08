/* ============================================================
 * app.js — 主入口
 *
 * 数据流:API 拉取 → TYPHOON 渲染地图 → PANEL 更新面板
 *         → SWITCHER 更新台风列表
 * 每 10 分钟自动刷新当前台风。
 *
 * 雷达 / 云图图层(本文件下方 NMC LAYERS 部分):
 *   NMC 图片为等经纬(plate carrée)投影、文件名时间戳为 UTC。
 *   直接贴到 Leaflet(Web Mercator)会产生最多 2~3° 的南北错位,
 *   故通过 canvas 逐行重投影到 Mercator 后再叠加;
 *   雷达同时按官方 14 色 dBZ 色标做"仅保留回波"抠图,
 *   去掉底图、边框、图例与南海诸岛插框;云图裁掉标题带并做边缘羽化。
 *   经验证的地理范围(与真实海岸线拟合,残差 < 0.3°):
 *     雷达:72.985–133.224°E, 13.686–54.962°N
 *     云图:100–150°E, −5–45°N(裁标题后上边界 42.326°N)
 * ============================================================ */

(() => {

  const REFRESH_MS = 10 * 60 * 1000;
  const $ = (id) => document.getElementById(id);

  let currentId = null;
  let refreshTimer = null;
  let usingDemo = false;

  /* ================================================================
   * NMC LAYERS — 雷达拼图 / 动态云图
   * ================================================================ */

  const LAYER = {
    // 全国雷达拼图(组合反射率)· 6 分钟一帧 · 产品代号 SLDAS3
    radar: {
      url: (ymd, ts) =>
        `https://image.nmc.cn/product/${ymd}/RDCP/medium/SEVP_AOC_RDCP_SLDAS3_ECREF_ACHN_L88_PI_${ts}00000.PNG`,
      // 源图等经纬范围(拟合值)
      geo: { latTop: 54.962, latBot: 13.686, lngL: 72.985, lngR: 133.224 },
      opacity: .85,
      zIndex: 210,
      stepMin: 6,
      lookbackSteps: 15,
      refreshMin: 6,
      process: processRadar,
    },
    // 西北太平洋区域红外云图 · 整点一帧
    cloud: {
      url: (ymd, ts) =>
        `https://image.nmc.cn/product/${ymd}/WXSP/medium/SEVP_NSMC_WXSP_ASC_EIR_ACWP_LNO_PY_${ts}00000.png`,
      // 源图 100–150E / 45..-5N;裁掉顶部 46px 标题带后上边界 42.326N
      geo: { latTop: 45 - 46 * (50 / 860), latBot: -5, lngL: 100, lngR: 150 },
      cropTop: 46,
      feather: 26,
      opacity: .62,
      zIndex: 200,
      stepMin: 60,
      frames: 6,
      lookbackSteps: 12,
      animMs: 650,
      process: processCloud,
    },
  };

  // 官方 dBZ 色标(直接采样自产品图例,5→70 dBZ 共 14 档)
  const RADAR_PALETTE = [
    [65, 157, 241], [100, 231, 235], [109, 250, 61], [0, 216, 0], [1, 144, 0],
    [255, 255, 0], [231, 192, 0], [255, 144, 0], [255, 0, 0], [214, 0, 0],
    [192, 0, 0], [255, 0, 240], [150, 0, 180], [173, 144, 240],
  ];
  // 与河流浅蓝 / 注记青色易混的两档(青、淡紫)用更严的判定阈值
  const RADAR_STRICT = new Set([1, 13]);
  const TH_NORMAL = 50 * 50, TH_STRICT = 30 * 30;

  /* ---------- Mercator 工具 ---------- */
  const D2R = Math.PI / 180;
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
  const imerc = (m) => (2 * Math.atan(Math.exp(m)) - Math.PI / 2) / D2R;

  /* ---------- 等经纬 → Mercator 逐行重投影 ----------
   * 经度方向两者线性一致,只需按行重采样纬度;行间线性混合。 */
  function warpRows(srcData, W, Hs, latTop, latBot) {
    const out = new Uint8ClampedArray(W * Hs * 4);
    const mT = merc(latTop), mB = merc(latBot);
    const rowBytes = W * 4;
    for (let yd = 0; yd < Hs; yd++) {
      const lat = imerc(mT + (yd + .5) / Hs * (mB - mT));
      let sy = (latTop - lat) / (latTop - latBot) * Hs - .5;
      if (sy < 0) sy = 0; if (sy > Hs - 1) sy = Hs - 1;
      const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, Hs - 1);
      const f = sy - y0, g = 1 - f;
      const o = yd * rowBytes, a = y0 * rowBytes, b = y1 * rowBytes;
      for (let i = 0; i < rowBytes; i++) {
        out[o + i] = srcData[a + i] * g + srcData[b + i] * f;
      }
    }
    return out;
  }

  /* ---------- 雷达:抠出回波 + 重投影 ---------- */
  function processRadar(img, cfg) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const id = cx.getImageData(0, 0, W, H);
    const d = id.data;

    // 图例框 / 南海诸岛插框(源图像素坐标,按 825×739 基准等比换算)
    const kx = W / 825, ky = H / 739;
    const LEGEND_Y = 666 * ky, LEGEND_X = 165 * kx;
    const INSET_Y = 459 * ky, INSET_X = 162 * kx;

    const pal = RADAR_PALETTE, np = pal.length;
    for (let y = 0; y < H; y++) {
      const inLegendRow = y >= LEGEND_Y, inInsetRow = y >= INSET_Y;
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        if ((inLegendRow && x >= LEGEND_X) || (inInsetRow && x < INSET_X)) {
          d[p + 3] = 0; continue;
        }
        let best = 0, bestD = Infinity;
        for (let ci = 0; ci < np; ci++) {
          const dr = d[p] - pal[ci][0], dg = d[p + 1] - pal[ci][1], db = d[p + 2] - pal[ci][2];
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestD) { bestD = dist; best = ci; }
        }
        const th = RADAR_STRICT.has(best) ? TH_STRICT : TH_NORMAL;
        if (bestD > th) { d[p + 3] = 0; }
      }
    }

    const warped = warpRows(new Uint8ClampedArray(d.buffer), W, H, cfg.geo.latTop, cfg.geo.latBot);
    cv.width = W; cv.height = H;
    cx.putImageData(new ImageData(warped, W, H), 0, 0);
    return cv.toDataURL('image/png');
  }

  /* ---------- 云图:裁标题 + 边缘羽化 + 重投影 ---------- */
  function processCloud(img, cfg) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const crop = cfg.cropTop || 0, feather = cfg.feather || 0;
    const srcH = H - crop;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = srcH;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, crop, W, srcH, 0, 0, W, srcH);
    const id = cx.getImageData(0, 0, W, srcH);
    const d = id.data;

    // 边缘羽化:上下左右 feather px 渐变 alpha
    if (feather > 0) {
      for (let y = 0; y < srcH; y++) {
        const topFade = y < feather ? y / feather : 1;
        const botFade = y > srcH - 1 - feather ? (srcH - 1 - y) / feather : 1;
        for (let x = 0; x < W; x++) {
          const leftFade = x < feather ? x / feather : 1;
          const rightFade = x > W - 1 - feather ? (W - 1 - x) / feather : 1;
          const fade = Math.min(topFade, botFade, leftFade, rightFade);
          if (fade < 1) {
            const p = (y * W + x) * 4;
            d[p + 3] = Math.round(d[p + 3] * fade);
          }
        }
      }
    }

    const warped = warpRows(new Uint8ClampedArray(d.buffer), W, srcH, cfg.geo.latTop, cfg.geo.latBot);
    cv.width = W; cv.height = srcH;
    cx.putImageData(new ImageData(warped, W, srcH), 0, 0);
    return cv.toDataURL('image/png');
  }

  /* ---------- 帧探测(NMC 有 10~15 分钟出图延迟) ---------- */

  function pad2(n) { return String(n).padStart(2, '0'); }
  const ymdUTC = (d) => `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`;
  const tsUTC = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;

  function floorToStep(d, stepMin) {
    const t = new Date(d.getTime());
    t.setUTCSeconds(0, 0);
    t.setUTCMinutes(Math.floor(t.getUTCMinutes() / stepMin) * stepMin);
    return t;
  }

  // 加载图片(带 CORS),成功返回 img,失败返回 null
  function loadImage(url, timeout = 10000) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => finish(null), timeout);
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = url;
    });
  }

  // 从当前 UTC 向前逐帧探测,处理后返回 dataURL 列表(旧→新),最多 want 帧
  async function collectProcessed(cfg, want) {
    const base = floorToStep(new Date(), cfg.stepMin);
    const frames = [];
    for (let i = 0; i < cfg.lookbackSteps && frames.length < want; i++) {
      const t = new Date(base.getTime() - i * cfg.stepMin * 60000);
      const img = await loadImage(cfg.url(ymdUTC(t), tsUTC(t)));
      if (!img) continue;
      try {
        frames.push(cfg.process(img, cfg));
      } catch (e) {
        // canvas 被污染(CORS 异常)时降级:直接用原图 + 修正后的地理范围
        console.warn('图层像素处理失败,降级为原图叠加:', e);
        frames.push(img.src);
      }
    }
    return frames.reverse();
  }

  const layerBounds = (cfg) =>
    [[cfg.geo.latBot, cfg.geo.lngL], [cfg.geo.latTop, cfg.geo.lngR]];

  /* ---------- 图层状态 ---------- */

  let radarOverlay = null, radarTimer = null, radarLoading = false;
  let cloudOverlay = null, cloudTimer = null, cloudLoading = false;
  let cloudFrames = [], cloudIdx = 0;
  let menuOpen = false;

  /* ---------- 雷达开关 ---------- */

  async function loadRadar() {
    const cfg = LAYER.radar;
    const frames = await collectProcessed(cfg, 1);
    if (!frames.length) return false;
    const next = L.imageOverlay(frames[0], layerBounds(cfg),
      { opacity: cfg.opacity, zIndex: cfg.zIndex }).addTo(MAP.instance);
    if (radarOverlay) MAP.instance.removeLayer(radarOverlay);
    radarOverlay = next;
    return true;
  }

  async function toggleRadar() {
    if (radarLoading) return;
    if (radarOverlay || radarTimer) {
      if (radarOverlay) { MAP.instance.removeLayer(radarOverlay); radarOverlay = null; }
      clearInterval(radarTimer); radarTimer = null;
      $('btnRadar').classList.remove('active');
      return;
    }
    radarLoading = true;
    $('btnRadar').classList.add('active', 'loading');
    const ok = await loadRadar();
    $('btnRadar').classList.remove('loading');
    radarLoading = false;
    if (!ok) {
      $('btnRadar').classList.remove('active');
      toast('雷达拼图数据暂不可用');
      return;
    }
    radarTimer = setInterval(() => { if (radarOverlay) loadRadar(); },
      LAYER.radar.refreshMin * 60 * 1000);
  }

  /* ---------- 云图开关 ---------- */

  function stopCloudAnim() {
    if (cloudTimer) { clearInterval(cloudTimer); cloudTimer = null; }
    if (cloudOverlay) { MAP.instance.removeLayer(cloudOverlay); cloudOverlay = null; }
    cloudFrames = []; cloudIdx = 0;
  }

  async function startCloudAnim() {
    const cfg = LAYER.cloud;
    const frames = await collectProcessed(cfg, cfg.frames);
    if (!frames.length) { toast('云图数据暂不可用'); return false; }

    cloudFrames = frames; cloudIdx = 0;
    cloudOverlay = L.imageOverlay(frames[0], layerBounds(cfg),
      { opacity: cfg.opacity, zIndex: cfg.zIndex }).addTo(MAP.instance);

    if (frames.length > 1) {
      cloudTimer = setInterval(() => {
        cloudIdx = (cloudIdx + 1) % cloudFrames.length;
        cloudOverlay.setUrl(cloudFrames[cloudIdx]);
      }, cfg.animMs);
    }
    return true;
  }

  async function toggleCloud() {
    if (cloudLoading) return;
    if (cloudOverlay) {
      stopCloudAnim();
      $('btnCloud').classList.remove('active');
      return;
    }
    cloudLoading = true;
    $('btnCloud').classList.add('active', 'loading');
    const ok = await startCloudAnim();
    $('btnCloud').classList.remove('loading');
    cloudLoading = false;
    if (!ok) $('btnCloud').classList.remove('active');
  }

  /* ================================================================
   * 基础 UI
   * ================================================================ */

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
    s.className = 'site-status ' + cls;
  }

  function buildLegend(ty) {
    $('legendList').innerHTML = Object.values(TYPHOON.LEVEL)
      .map(lv => `<li><span class="swatch" style="background:${lv.color}"></span>${lv.name}</li>`)
      .join('');
    $('legendAgency').innerHTML = TYPHOON.agenciesOf(ty)
      .map(a => `<li><span class="swatch line" style="background:${a.color}"></span>${a.name}</li>`)
      .join('') || '<li style="color:var(--text-dim)">暂无预报数据</li>';
  }

  /* ---------- 菜单 ---------- */

  function toggleMenu() {
    menuOpen = !menuOpen;
    $('ctlDropdown').hidden = !menuOpen;
    $('btnMenu').classList.toggle('open', menuOpen);
    $('btnMenu').setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
  }

  function closeMenu() {
    menuOpen = false;
    $('ctlDropdown').hidden = true;
    $('btnMenu').classList.remove('open');
    $('btnMenu').setAttribute('aria-expanded', 'false');
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

    NEWS.get(ty.name).then(r => {
      if (currentId === id) PANEL.renderNews(r);
    });
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
    SWITCHER.onSelect = (id) => loadTyphoon(id);
    TYPHOON.onPointClick = (p) => PANEL.showPoint(p);
    PANEL.onPointSelect = (p) => {
      MAP.flyTo([p.lat, p.lng]);
      TYPHOON.highlight(p.lat, p.lng);
    };

    $('btnMenu').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    $('btnLocate').addEventListener('click', () => { if (currentId) loadTyphoon(currentId); });
    $('btnLegend').addEventListener('click', () => { const lg = $('legend'); lg.hidden = !lg.hidden; });
    $('btnRadar').addEventListener('click', () => toggleRadar());
    $('btnCloud').addEventListener('click', () => toggleCloud());

    document.addEventListener('click', (e) => {
      if (menuOpen && !$('mapControls').contains(e.target)) closeMenu();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && currentId && !usingDemo) {
        loadTyphoon(currentId);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    MAP.init();
    PANEL.init();
    SWITCHER.init();
    bindEvents();
    bootstrap();
    startAutoRefresh();
  });
})();
