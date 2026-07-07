/* ============================================================
 * typhoon.js — 台风路径在地图上的渲染
 *
 *   · 实况轨迹:分段实线,颜色随该段强度变化
 *   · 路径点:强度色圆点,点击联动信息面板 + 高亮圆环
 *   · 当前位置:点击弹出信息卡(含参考位置、未来趋势)
 *   · 预报路径:各机构不同颜色的虚线 + 空心点
 *   · 风圈:七/十/十二级风圈四象限多边形
 * ============================================================ */

const TYPHOON = (() => {

  // 强度色标(与 style.css 中的 CSS 变量保持一致)
  const LEVEL = {
    TD:      { color: '#30d54c', name: '热带低压', rank: 0 },
    TS:      { color: '#2f7bff', name: '热带风暴', rank: 1 },
    STS:     { color: '#f7d038', name: '强热带风暴', rank: 2 },
    TY:      { color: '#ff9c33', name: '台风', rank: 3 },
    STY:     { color: '#f450d8', name: '强台风', rank: 4 },
    SuperTY: { color: '#ff3b30', name: '超强台风', rank: 5 },
  };

  // 预报机构配色
  const AGENCY_COLORS = ['#4fd8eb', '#b48bff', '#7dd87d', '#ff9c9c', '#e8d27d'];

  // 参考城市(用于计算"参考位置")
  const REF_CITIES = [
    { name: '台湾基隆市', lat: 25.13, lng: 121.74 },
    { name: '台湾高雄市', lat: 22.62, lng: 120.31 },
    { name: '台湾花莲市', lat: 23.98, lng: 121.60 },
    { name: '上海市',     lat: 31.23, lng: 121.47 },
    { name: '浙江温州市', lat: 28.00, lng: 120.70 },
    { name: '浙江宁波市', lat: 29.87, lng: 121.54 },
    { name: '福建福州市', lat: 26.07, lng: 119.30 },
    { name: '福建厦门市', lat: 24.48, lng: 118.09 },
    { name: '广东汕头市', lat: 23.35, lng: 116.68 },
    { name: '广东湛江市', lat: 21.27, lng: 110.36 },
    { name: '香港',       lat: 22.32, lng: 114.17 },
    { name: '海南海口市', lat: 20.04, lng: 110.34 },
    { name: '海南三亚市', lat: 18.25, lng: 109.51 },
    { name: '山东青岛市', lat: 36.07, lng: 120.38 },
    { name: '辽宁大连市', lat: 38.91, lng: 121.61 },
    { name: '日本那霸市', lat: 26.21, lng: 127.68 },
    { name: '日本东京',   lat: 35.68, lng: 139.69 },
    { name: '韩国首尔',   lat: 37.57, lng: 126.98 },
    { name: '菲律宾马尼拉', lat: 14.60, lng: 120.98 },
    { name: '美国关岛',   lat: 13.44, lng: 144.79 },
  ];

  const DIR16 = ['北', '北偏东', '东北', '东偏北', '东', '东偏南', '东南', '南偏东',
                 '南', '南偏西', '西南', '西偏南', '西', '西偏北', '西北', '北偏西'];

  let layer = null;          // 当前台风所有图层的容器
  let hiRing = null;         // 选中点高亮圆环
  let onPointClick = null;   // 点击路径点回调,由 app.js 注入

  const colorOf = (lv) => (LEVEL[lv] || LEVEL.TD).color;
  const rankOf = (lv) => (LEVEL[lv] || LEVEL.TD).rank;

  /* ---------- 地理计算 ---------- */

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // 从 from 看 to 的方位(16 方位中文)
  function bearingDir(fromLat, fromLng, toLat, toLng) {
    const rad = Math.PI / 180;
    const dLng = (toLng - fromLng) * rad;
    const y = Math.sin(dLng) * Math.cos(toLat * rad);
    const x = Math.cos(fromLat * rad) * Math.sin(toLat * rad) -
      Math.sin(fromLat * rad) * Math.cos(toLat * rad) * Math.cos(dLng);
    const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return DIR16[Math.round(deg / 22.5) % 16];
  }

  // 参考位置:"距离台湾基隆市东偏南方向约1980公里"
  function refPosition(p) {
    let best = null, bestD = Infinity;
    REF_CITIES.forEach(c => {
      const d = haversineKm(c.lat, c.lng, p.lat, p.lng);
      if (d < bestD) { bestD = d; best = c; }
    });
    if (!best) return '—';
    const dir = bearingDir(best.lat, best.lng, p.lat, p.lng);
    const dist = bestD >= 100 ? Math.round(bestD / 10) * 10 : Math.round(bestD);
    return `距离${best.name}${dir}方向约${dist}公里`;
  }

  // 未来趋势:结合移向移速 + 预报强度变化
  function futureTrend(ty) {
    const cur = ty.latest;
    if (!cur) return '—';

    const dir = cur.moveDir || '';
    const spd = cur.moveSpeed ? `以每小时${cur.moveSpeed}公里左右的速度` : '';
    const move = dir ? `将${spd}向${dir}方向移动` : (spd ? `将${spd}移动` : '');

    // 取第一家机构预报的最后一个点,与当前强度比较
    let trend = '';
    const fc = (cur.forecasts || [])[0];
    if (fc && fc.points.length) {
      const lastLv = rankOf(fc.points[fc.points.length - 1].level);
      const diff = lastLv - rankOf(cur.level);
      trend = diff > 0 ? '强度逐渐增强' : diff < 0 ? '强度逐渐减弱' : '强度变化不大';
    }

    const parts = [move, trend].filter(Boolean).join(',');
    return parts ? `“${ty.name}”${parts}` : '暂无趋势研判';
  }

  /* ---------- 当前位置信息卡(popup) ---------- */

  function fmtCardTime(t) {
    // "2026-07-07 11:00:00" → "07月07日11时"
    const m = String(t).match(/\d{4}-(\d{2})-(\d{2})[ T](\d{2})/);
    return m ? `${m[1]}月${m[2]}日${m[3]}时` : t;
  }

  function currentCard(ty) {
    const p = ty.latest;
    const lvName = (LEVEL[p.level] || LEVEL.TD).name;
    const row = (label, value) => `
      <div class="pp-row"><label>${label}:</label><span>${value}</span></div>`;

    return `
      <div class="pp-card">
        <div class="pp-title">【${ty.name}】 ${fmtCardTime(p.time)}</div>
        ${row('中心位置', `东经${p.lng.toFixed(1)}° 北纬${p.lat.toFixed(1)}°`)}
        ${row('风速风力', `${p.speed ?? '—'}米/秒,${p.power ?? '—'}级(${lvName})`)}
        ${row('中心气压', `${p.pressure ?? '—'}百帕`)}
        ${row('参考位置', refPosition(p))}
        ${row('未来趋势', futureTrend(ty))}
      </div>`;
  }

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

  /* ---------- 选中点高亮 ---------- */
  function highlight(lat, lng) {
    if (hiRing) { hiRing.remove(); hiRing = null; }
    if (!layer) return;
    hiRing = L.circleMarker([lat, lng], {
      radius: 9, color: '#ffffff', weight: 2,
      fill: false, opacity: .95, interactive: false,
    }).addTo(layer);
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
        .on('click', () => {
          highlight(p.lat, p.lng);
          onPointClick && onPointClick(p, i);
        })
        .addTo(layer);
    });

    // 3) 最新位置:风圈 + 台风眼(点击弹出信息卡)
    const cur = ty.latest;
    if (cur) {
      if (cur.r7)  windCircle([cur.lat, cur.lng], cur.r7,  '#f7d038').addTo(layer);
      if (cur.r10) windCircle([cur.lat, cur.lng], cur.r10, '#ff9c33').addTo(layer);
      if (cur.r12) windCircle([cur.lat, cur.lng], cur.r12, '#ff3b30').addTo(layer);

      L.marker([cur.lat, cur.lng], { icon: eyeIcon(colorOf(cur.level)), zIndexOffset: 500 })
        .bindPopup(currentCard(ty), {
          className: 'ty-popup',
          maxWidth: 300,
          minWidth: 250,
          autoPanPaddingTopLeft: [20, 120],
          autoPanPaddingBottomRight: [20, 160],
          closeButton: true,
        })
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
    hiRing = null;
    if (layer) { layer.remove(); layer = null; }
  }

  function agenciesOf(ty) {
    return ((ty.latest && ty.latest.forecasts) || [])
      .map((fc, i) => ({ name: fc.agency, color: AGENCY_COLORS[i % AGENCY_COLORS.length] }));
  }

  return {
    render, clear, highlight, LEVEL, colorOf, agenciesOf,
    set onPointClick(fn) { onPointClick = fn; },
  };
})();
