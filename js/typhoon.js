/* ============================================================
 * typhoon.js — 台风路径在地图上的渲染
 *
 *   · 实况轨迹:分段实线,颜色随该段强度变化
 *   · 路径点:强度色圆点,点击联动信息面板
 *   · 预报路径:各机构不同颜色的虚线 + 空心点
 *   · 风圈:七/十/十二级风圈四象限多边形
 *   · 台风眼:CSS 旋转的螺旋图标 + 脉冲光环
 * ============================================================ */

const TYPHOON = (() => {

  // 强度色标(与 style.css 中的 CSS 变量保持一致)
  const LEVEL = {
    TD:      { color: '#30d54c', name: '热带低压' },
    TS:      { color: '#2f7bff', name: '热带风暴' },
    STS:     { color: '#f7d038', name: '强热带风暴' },
    TY:      { color: '#ff9c33', name: '台风' },
    STY:     { color: '#f450d8', name: '强台风' },
    SuperTY: { color: '#ff3b30', name: '超强台风' },
  };

  // 预报机构配色
  const AGENCY_COLORS = ['#4fd8eb', '#b48bff', '#7dd87d', '#ff9c9c', '#e8d27d'];

  let layer = null;          // 当前台风所有图层的容器
  let onPointClick = null;   // 点击路径点回调,由 app.js 注入

  const colorOf = (lv) => (LEVEL[lv] || LEVEL.TD).color;

  /* ---------- 风圈:四象限扇形多边形 ---------- */
  // radii: {ne,se,sw,nw} 单位 km;按方位角 0-360° 采样
  function windCircle(center, radii, color) {
    const [lat, lng] = center;
    const kmLat = 1 / 110.574;
    const kmLng = 1 / (111.32 * Math.cos(lat * Math.PI / 180));
    const rAt = (deg) => deg < 90 ? radii.ne : deg < 180 ? radii.se : deg < 270 ? radii.sw : radii.nw;

    const pts = [];
    for (let deg = 0; deg <= 360; deg += 6) {
      const r = rAt(deg % 360);
      const rad = deg * Math.PI / 180;
      pts.push([lat + r * Math.cos(rad) * kmLat, lng + r * Math.sin(rad) * kmLng]);
    }
    return L.polygon(pts, {
      color, weight: 1, opacity: .7,
      fillColor: color, fillOpacity: .12,
      interactive: false,
    });
  }

  /* ---------- 台风眼图标 ---------- */
  function eyeIcon(color) {
    return L.divIcon({
      className: 'ty-eye',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      html: `<svg viewBox="0 0 24 24" width="34" height="34" style="color:${color}">
        <path d="M12 2c4 0 7.5 2.5 9 6-2-1.5-4.5-2-6.5-1.2A5 5 0 1 1 7 15.5c-1 2-.7 4.6.8 6.3C4.2 20.4 2 16.5 2 12 2 6.5 6.5 2 12 2z"
              fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="2" fill="currentColor"/>
      </svg>`,
    });
  }

  function tipHTML(p, extra = '') {
    return `${extra}<span class="tip-lv" style="color:${colorOf(p.level)}">${p.strong}</span><br>
      ${p.time}<br>
      风速 <b>${p.speed ?? '—'}</b> m/s · 气压 <b>${p.pressure ?? '—'}</b> hPa`;
  }

  /* ---------- 主渲染 ---------- */
  function render(ty) {
    clear();
    const map = MAP.instance;
    layer = L.layerGroup().addTo(map);
    const bounds = L.latLngBounds([]);

    const pts = ty.points;
    if (!pts.length) return bounds;

    // 1) 实况轨迹:相邻两点一段,颜色取后一点强度
    for (let i = 1; i < pts.length; i++) {
      L.polyline(
        [[pts[i - 1].lat, pts[i - 1].lng], [pts[i].lat, pts[i].lng]],
        { color: colorOf(pts[i].level), weight: 2.5, opacity: .9, interactive: false }
      ).addTo(layer);
    }

    // 2) 路径点
    pts.forEach((p, i) => {
      bounds.extend([p.lat, p.lng]);
      const isLast = i === pts.length - 1;
      if (isLast) return; // 最新点用台风眼图标单独画

      L.circleMarker([p.lat, p.lng], {
        radius: 4.5,
        color: '#0a1420',
        weight: 1,
        fillColor: colorOf(p.level),
        fillOpacity: 1,
      })
        .bindTooltip(tipHTML(p), { className: 'ty-tip', direction: 'top', offset: [0, -6] })
        .on('click', () => onPointClick && onPointClick(p, i))
        .addTo(layer);
    });

    // 3) 最新位置:风圈 + 台风眼
    const cur = ty.latest;
    if (cur) {
      if (cur.r7)  windCircle([cur.lat, cur.lng], cur.r7,  '#f7d038').addTo(layer);
      if (cur.r10) windCircle([cur.lat, cur.lng], cur.r10, '#ff9c33').addTo(layer);
      if (cur.r12) windCircle([cur.lat, cur.lng], cur.r12, '#ff3b30').addTo(layer);

      L.marker([cur.lat, cur.lng], { icon: eyeIcon(colorOf(cur.level)), zIndexOffset: 500 })
        .bindTooltip(tipHTML(cur, '<b>当前位置</b><br>'), { className: 'ty-tip', direction: 'top', offset: [0, -18] })
        .on('click', () => onPointClick && onPointClick(cur, pts.length - 1))
        .addTo(layer);
    }

    // 4) 预报路径(挂在最新点上)
    const forecasts = (cur && cur.forecasts) || [];
    forecasts.forEach((fc, idx) => {
      if (!fc.points.length) return;
      const color = AGENCY_COLORS[idx % AGENCY_COLORS.length];
      const line = [[cur.lat, cur.lng], ...fc.points.map(fp => [fp.lat, fp.lng])];

      L.polyline(line, {
        color, weight: 2, opacity: .85, dashArray: '6 6', interactive: false,
      }).addTo(layer);

      fc.points.forEach(fp => {
        bounds.extend([fp.lat, fp.lng]);
        L.circleMarker([fp.lat, fp.lng], {
          radius: 4, color, weight: 1.5,
          fillColor: '#0a1420', fillOpacity: 1,
        })
          .bindTooltip(tipHTML(fp, `<b>${fc.agency}</b> 预报<br>`), { className: 'ty-tip', direction: 'top', offset: [0, -6] })
          .addTo(layer);
      });
    });

    return bounds;
  }

  function clear() {
    if (layer) { layer.remove(); layer = null; }
  }

  function agenciesOf(ty) {
    return ((ty.latest && ty.latest.forecasts) || [])
      .map((fc, i) => ({ name: fc.agency, color: AGENCY_COLORS[i % AGENCY_COLORS.length] }));
  }

  return {
    render, clear, LEVEL, colorOf, agenciesOf,
    set onPointClick(fn) { onPointClick = fn; },
  };
})();
