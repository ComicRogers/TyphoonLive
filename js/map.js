/* ============================================================
 * map.js — 地图初始化与基础图层
 *
 * 底图策略:
 *   1. 配置了天地图 key(TIANDITU_KEY)时,加载天地图矢量 + 注记;
 *   2. 未配置时,使用 Carto 暗色底图(免 key,与整体暗色风格一致)。
 *
 * 同时绘制西北太平洋 24 / 48 小时警戒线(中国台风网经典要素)。
 * ============================================================ */

const MAP = (() => {

  // 在 https://console.tianditu.gov.cn/ 申请浏览器端 key 后填入
  const TIANDITU_KEY = '';

  let map = null;

  // 官方 24 小时警戒线坐标
  const LINE_24H = [
    [34, 127], [22, 127], [18, 119], [11, 119], [4.5, 113], [0, 105],
  ];
  // 官方 48 小时警戒线坐标
  const LINE_48H = [
    [34, 132], [15, 132], [0, 120], [0, 105],
  ];

  function baseLayers() {
    if (TIANDITU_KEY) {
      const tdt = (layer) => L.tileLayer(
        `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
        `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles` +
        `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_KEY}`,
        { subdomains: '01234567', maxZoom: 18, attribution: '© 天地图' }
      );
      return [tdt('vec'), tdt('cva')]; // 矢量底图 + 中文注记
    }
    // 免 key 暗色底图
    return [L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 18, attribution: '© OpenStreetMap © CARTO' }
    )];
  }

  function drawWarningLines() {
    const common = { interactive: false, weight: 1.6, opacity: .8 };

    L.polyline(LINE_24H, { ...common, color: '#ff5a4e', dashArray: '8 5' }).addTo(map);
    L.polyline(LINE_48H, { ...common, color: '#f7d038', dashArray: '8 5' }).addTo(map);

    const label = (latlng, text, color) => L.marker(latlng, {
      interactive: false,
      icon: L.divIcon({
        className: '',
        html: `<div style="color:${color};font-size:11px;white-space:nowrap;
               text-shadow:0 1px 3px rgba(0,0,0,.8);transform:translate(-50%,-50%)">${text}</div>`,
      }),
    }).addTo(map);

    label([30, 127], '24小时警戒线', '#ff5a4e');
    label([30, 132], '48小时警戒线', '#f7d038');
  }

  function init() {
    map = L.map('map', {
      center: [22, 128],           // 西北太平洋台风活跃区
      zoom: window.innerWidth < 768 ? 4 : 5,
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
    });
    baseLayers().forEach(l => l.addTo(map));
    drawWarningLines();
    return map;
  }

  // 将视野收敛到台风整体路径(含预报),并给底部面板留出空间
  function fitTyphoon(bounds) {
    if (!bounds || !bounds.isValid()) return;
    const mobile = window.innerWidth < 768;
    map.fitBounds(bounds, {
      paddingTopLeft: [30, mobile ? 110 : 80],
      paddingBottomRight: [30, mobile ? 200 : 60],
      maxZoom: 7,
    });
  }

  function flyTo(latlng, zoom = 7) {
    map.flyTo(latlng, Math.max(map.getZoom(), zoom), { duration: .8 });
  }

  return {
    init,
    fitTyphoon,
    flyTo,
    get instance() { return map; },
  };
})();
