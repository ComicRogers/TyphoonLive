/* ============================================================
 * api.js — 台风数据获取与解析
 *
 * 数据源:中国台风网体系的公开接口(浙江省水利厅台风路径系统)
 *   列表:https://typhoon.slt.zj.gov.cn/Api/TyphoonList/{year}
 *   详情:https://typhoon.slt.zj.gov.cn/Api/TyphoonInfo/{tfbh}
 *
 * 注意:浏览器直连该接口可能受 CORS 限制。若请求失败,自动降级为
 * 内置演示数据,并提示用户可通过代理(见 PROXY 配置)接入实时数据。
 * ============================================================ */

const API = (() => {

  const BASE = 'https://typhoon.slt.zj.gov.cn/Api';

  // 若部署了自己的 CORS 代理,填在这里,例如:
  // const PROXY = 'https://your-worker.example.workers.dev/?url=';
  const PROXY = '';

  const url = (path) => PROXY ? PROXY + encodeURIComponent(BASE + path) : BASE + path;

  async function getJSON(path, timeout = 8000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url(path), { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- 数据规范化 ---------- */

  // 强度中文 → 等级 key
  function levelKey(strong) {
    const s = String(strong || '');
    if (s.includes('超强')) return 'SuperTY';
    if (s.includes('强台风')) return 'STY';
    if (s.includes('强热带')) return 'STS';
    if (s.includes('台风')) return 'TY';
    if (s.includes('风暴')) return 'TS';
    return 'TD';
  }

  // 风圈字段 "300|280|200|260" → {ne,se,sw,nw}(单位 km)
  function parseRadius(raw) {
    if (!raw) return null;
    const parts = String(raw).split('|').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return null;
    const [ne, se, sw, nw] = parts;
    if (ne + se + sw + nw <= 0) return null;
    return { ne, se, sw, nw };
  }

  // 单个路径点规范化
  function normPoint(p) {
    return {
      time: p.time || p.TIME || '',
      lat: +p.lat || +p.LAT,
      lng: +p.lng || +p.LNG,
      strong: p.strong || p.STRONG || '热带低压',
      level: levelKey(p.strong || p.STRONG),
      power: +p.power || +p.POWER || null,       // 风力(级)
      speed: +p.speed || +p.SPEED || null,       // 最大风速 m/s
      pressure: +p.pressure || +p.PRESSURE || null,
      moveSpeed: +p.movespeed || +p.MOVESPEED || null,
      moveDir: p.movedirection || p.MOVEDIRECTION || '',
      r7: parseRadius(p.radius7 || p.RADIUS7),
      r10: parseRadius(p.radius10 || p.RADIUS10),
      r12: parseRadius(p.radius12 || p.RADIUS12),
      forecasts: (p.forecast || p.FORECAST || []).map(f => ({
        agency: f.tm || f.TM || '预报',
        points: (f.forecastpoints || f.FORECASTPOINTS || []).map(fp => ({
          time: fp.time || fp.TIME || '',
          lat: +fp.lat || +fp.LAT,
          lng: +fp.lng || +fp.LNG,
          strong: fp.strong || fp.STRONG || '',
          level: levelKey(fp.strong || fp.STRONG),
          power: +fp.power || +fp.POWER || null,
          speed: +fp.speed || +fp.SPEED || null,
          pressure: +fp.pressure || +fp.PRESSURE || null,
        })),
      })),
    };
  }

  function normTyphoon(info) {
    const points = (info.points || info.POINTS || []).map(normPoint)
      .filter(p => isFinite(p.lat) && isFinite(p.lng));
    return {
      id: String(info.tfbh || info.TFBH || info.tfid || ''),
      name: info.name || info.NAME || '未命名',
      enName: info.enname || info.ENNAME || '',
      isActive: (info.isactive ?? info.ISACTIVE ?? '1') == '1',
      points,
      latest: points[points.length - 1] || null,
    };
  }

  /* ---------- 对外接口 ---------- */

  // 拉取某年台风列表(默认当前年份),返回 [{id,name,enName,isActive}]
  async function fetchList(year = new Date().getFullYear()) {
    const raw = await getJSON('/TyphoonList/' + year);
    return (raw || []).map(t => ({
      id: String(t.tfbh || t.TFBH || t.tfid || ''),
      name: t.name || t.NAME || '未命名',
      enName: t.enname || t.ENNAME || '',
      isActive: (t.isactive ?? t.ISACTIVE ?? '0') == '1',
    })).filter(t => t.id);
  }

  // 拉取单个台风完整路径
  async function fetchTyphoon(tfbh) {
    const raw = await getJSON('/TyphoonInfo/' + tfbh);
    return normTyphoon(raw || {});
  }

  /* ---------- 演示数据(接口不可达时兜底) ----------
   * 一条自西北太平洋生成、逼近台湾海峡的示例路径,
   * 数据结构与真实接口解析结果完全一致,便于开发调试。 */

  function demoData() {
    const mk = (time, lat, lng, strong, power, speed, pressure, ms, md, r7) => normPoint({
      time, lat, lng, strong, power, speed, pressure,
      movespeed: ms, movedirection: md, radius7: r7,
    });

    const pts = [
      mk('2026-07-01 08:00', 12.8, 138.2, '热带低压', 7, 15, 1002, 20, '西北', null),
      mk('2026-07-01 20:00', 13.6, 136.5, '热带低压', 7, 16, 1000, 22, '西北', null),
      mk('2026-07-02 08:00', 14.5, 134.6, '热带风暴', 8, 20, 995, 22, '西北', '180|160|150|170'),
      mk('2026-07-02 20:00', 15.5, 132.8, '热带风暴', 9, 23, 990, 20, '西北', '200|180|160|190'),
      mk('2026-07-03 08:00', 16.6, 131.0, '强热带风暴', 10, 28, 982, 18, '西北', '220|200|180|210'),
      mk('2026-07-03 20:00', 17.6, 129.3, '强热带风暴', 11, 30, 978, 18, '西北', '240|220|190|220'),
      mk('2026-07-04 08:00', 18.7, 127.7, '台风', 12, 35, 965, 17, '西北', '260|240|200|240'),
      mk('2026-07-04 20:00', 19.8, 126.2, '台风', 13, 40, 955, 16, '西北', '280|260|220|260'),
      mk('2026-07-05 08:00', 20.9, 124.9, '强台风', 14, 45, 945, 15, '西北', '300|280|240|280'),
      mk('2026-07-05 20:00', 21.9, 123.7, '强台风', 15, 48, 935, 15, '西北', '320|300|250|300'),
      mk('2026-07-06 08:00', 22.8, 122.6, '超强台风', 16, 52, 925, 14, '西北', '340|320|260|320'),
    ];

    // 给最新点挂两家机构的预报路径
    pts[pts.length - 1].forecasts = [
      {
        agency: '中央气象台',
        points: [
          { time: '2026-07-06 20:00', lat: 23.6, lng: 121.5, strong: '超强台风', level: 'SuperTY', power: 16, speed: 52, pressure: 925 },
          { time: '2026-07-07 08:00', lat: 24.4, lng: 120.3, strong: '强台风', level: 'STY', power: 14, speed: 45, pressure: 945 },
          { time: '2026-07-07 20:00', lat: 25.3, lng: 119.0, strong: '台风', level: 'TY', power: 12, speed: 35, pressure: 965 },
          { time: '2026-07-08 08:00', lat: 26.4, lng: 117.8, strong: '强热带风暴', level: 'STS', power: 10, speed: 28, pressure: 982 },
        ],
      },
      {
        agency: '日本气象厅',
        points: [
          { time: '2026-07-06 20:00', lat: 23.5, lng: 121.7, strong: '超强台风', level: 'SuperTY', power: 16, speed: 51, pressure: 927 },
          { time: '2026-07-07 08:00', lat: 24.6, lng: 120.7, strong: '强台风', level: 'STY', power: 14, speed: 44, pressure: 948 },
          { time: '2026-07-07 20:00', lat: 25.8, lng: 119.6, strong: '台风', level: 'TY', power: 12, speed: 34, pressure: 968 },
        ],
      },
    ];

    return {
      id: 'DEMO2604',
      name: '演示台风',
      enName: 'DEMO',
      isActive: true,
      points: pts,
      latest: pts[pts.length - 1],
    };
  }

  return { fetchList, fetchTyphoon, demoData, levelKey };
})();
