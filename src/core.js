// 刃先断面ツール: 計算ロジック（DOM非依存。Node.jsからもテスト可能）
(function (root) {
  'use strict';

  // ---------- ファイル読込 ----------

  // ArrayBuffer → 文字列（UTF-16 LE/BE・UTF-8 を BOM と NUL バイトの並びで判定）
  function decodeText(buf) {
    const b = new Uint8Array(buf);
    let enc = 'utf-8';
    if (b[0] === 0xff && b[1] === 0xfe) enc = 'utf-16le';
    else if (b[0] === 0xfe && b[1] === 0xff) enc = 'utf-16be';
    else if (b.length > 3 && b[1] === 0 && b[3] === 0) enc = 'utf-16le';
    else if (b.length > 3 && b[0] === 0 && b[2] === 0) enc = 'utf-16be';
    return new TextDecoder(enc).decode(b);
  }

  // Talysurf 形式テキスト（X<TAB>Z<TAB>キー<TAB>値…）を解析
  function parseProfile(text) {
    const lines = text.split(/\r?\n/);
    const xs = [], zs = [];
    const meta = {};
    for (const line of lines) {
      if (!line) continue;
      const p = line.split('\t');
      const x = parseFloat(p[0]), z = parseFloat(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      xs.push(x); zs.push(z);
      if (p.length > 3 && p[2] && p[2].trim()) {
        const key = p[2].trim();
        if (!(key in meta)) meta[key] = p.slice(3).map(s => s.trim()).filter(Boolean).join(' ');
      }
    }
    if (xs.length < 10) throw new Error('数値データ（X, Z）が見つかりません');
    let x = Float64Array.from(xs), z = Float64Array.from(zs);
    // X が減少方向に並んでいる場合は昇順に並べ替える
    if (x[0] > x[x.length - 1]) { x = x.reverse(); z = z.reverse(); }
    return { x, z, meta };
  }

  // ファイル名から 右/左 と 包丁名（ペアのキー）を推定
  // 例: no14_r50_001 → side 'R', key 'no14_50'
  function guessSideAndKey(filename, meta) {
    let base = filename.replace(/\.[^.]+$/, '');
    let side = null;
    const m = base.match(/(^|[_\-\s])([rRlL])(?=\d|[_\-\s]|$)/);
    if (m) {
      side = m[2].toUpperCase();
      base = base.slice(0, m.index) + m[1] + base.slice(m.index + m[0].length);
    }
    if (!side && meta) {
      if (meta.ContactDirection === 'ZNegative') side = 'R';
      else if (meta.ContactDirection === 'ZPositive') side = 'L';
    }
    const key = base.replace(/[_\-\s]\d{3,}$/, '').replace(/[_\-\s]+$/, '').replace(/^[_\-\s]+/, '').replace(/__+/g, '_') || base;
    return { side: side || 'R', key };
  }

  // 左面（下から測定・触針逆向き）は Z の符号が反転しているのが既定
  function guessInvertZ(side, meta) {
    if (meta && meta.ContactDirection === 'ZPositive') return true;
    if (meta && meta.ContactDirection === 'ZNegative') return false;
    return side === 'L';
  }

  // ---------- 刃先検出 ----------

  // 窓幅 w 点の最小二乗傾きを i=0..n-w で計算（累積和で O(n)）
  function windowSlopes(x, z, w) {
    const n = x.length;
    const x0 = x[0];
    const Sx = new Float64Array(n + 1), Sz = new Float64Array(n + 1);
    const Sxx = new Float64Array(n + 1), Sxz = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const xi = x[i] - x0, zi = z[i] - z[0];
      Sx[i + 1] = Sx[i] + xi; Sz[i + 1] = Sz[i] + zi;
      Sxx[i + 1] = Sxx[i] + xi * xi; Sxz[i + 1] = Sxz[i] + xi * zi;
    }
    const m = n - w;
    const s = new Float64Array(Math.max(m, 0));
    for (let i = 0; i < m; i++) {
      const sx = Sx[i + w] - Sx[i], sz = Sz[i + w] - Sz[i];
      const sxx = Sxx[i + w] - Sxx[i], sxz = Sxz[i + w] - Sxz[i];
      const d = w * sxx - sx * sx;
      s[i] = d !== 0 ? (w * sxz - sx * sz) / d : 0;
    }
    return s;
  }

  function median(arr) {
    const a = Array.from(arr).sort((p, q) => p - q);
    return a.length ? a[a.length >> 1] : 0;
  }

  // 刃先（触針が刃先から落ちる直前の角）の X を返す
  //   峰側から刃先側へ測定し、刃先を越えると傾きが急変する前提
  //   opts.window: 傾き計算の窓幅[mm], opts.angleDeg: 急変とみなす角度差[°]
  function detectTip(x, z, opts) {
    opts = Object.assign({ window: 0.01, angleDeg: 40 }, opts);
    const n = x.length;
    const dx = (x[n - 1] - x[0]) / (n - 1);
    const w = Math.max(5, Math.round(opts.window / dx));
    const s = windowSlopes(x, z, w);
    if (s.length < 3 * w) return { x: x[n - 1], index: n - 1, found: false };

    // 基準傾き: 前半 60% の中央値
    const baseSample = [];
    const step = Math.max(1, Math.floor((s.length * 0.6) / 2000));
    for (let i = 0; i < s.length * 0.6; i += step) baseSample.push(s[i]);
    const base = Math.atan(median(baseSample));
    const thr = opts.angleDeg * Math.PI / 180;
    const dev = i => Math.abs(Math.atan(s[i]) - base);

    let hit = -1;
    for (let i = 0; i < s.length - w; i++) {
      // 窓の後ろ半分・1窓先も急変していれば「落下」と判定（ノイズ除け）
      if (dev(i) > thr && dev(Math.min(i + (w >> 1), s.length - 1)) > thr && dev(Math.min(i + w, s.length - 1)) > thr) { hit = i; break; }
    }
    if (hit < 0) return { x: x[n - 1], index: n - 1, found: false };

    // 角の位置を精密化: 区間両端を結ぶ弦から最も離れた点（ニー検出）
    const a = Math.max(0, hit - 2 * w), b = Math.min(n - 1, hit + 2 * w);
    const ux = x[b] - x[a], uz = z[b] - z[a];
    const len = Math.hypot(ux, uz) || 1;
    let best = a, bestD = -1;
    for (let i = a; i <= b; i++) {
      const d = Math.abs((x[i] - x[a]) * uz - (z[i] - z[a]) * ux) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    return { x: x[best], index: best, found: true };
  }

  // ---------- 断面の合成 ----------

  function lowerBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // 単調増加の x に対する線形補間（範囲外は NaN）
  function interp(x, z, v) {
    const n = x.length;
    if (!n || v < x[0] || v > x[n - 1]) return NaN;
    const i = lowerBound(x, v);
    if (i === 0) return z[0];
    const t = (v - x[i - 1]) / (x[i] - x[i - 1]);
    return z[i - 1] + t * (z[i] - z[i - 1]);
  }

  // 片面プロファイルを「刃先=原点、刃先より先を削除、峰側が負のX」に変換
  //   invertZ: Z 符号反転, reverseX: 測定方向が刃先→峰の場合 true
  function alignSide(prof, tipX, invertZ, reverseX) {
    const { x, z } = prof;
    const zt = interp(x, z, tipX);
    const out = [];
    for (let i = 0; i < x.length; i++) {
      let u = x[i] - tipX;
      if (reverseX) u = -u;
      if (u > 0) continue;
      let v = z[i] - zt;
      if (invertZ) v = -v;
      out.push(u, v);
    }
    const m = out.length / 2;
    const ax = new Float64Array(m), az = new Float64Array(m);
    for (let i = 0; i < m; i++) { ax[i] = out[2 * i]; az[i] = out[2 * i + 1]; }
    if (reverseX) { ax.reverse(); az.reverse(); }
    return { x: ax, z: az };
  }

  // 刃先から距離 [d0, d1] の区間で直線近似した傾き
  function fitSlope(p, d0, d1) {
    let n = 0, sx = 0, sz = 0, sxx = 0, sxz = 0;
    const i0 = lowerBound(p.x, -d1), i1 = lowerBound(p.x, -d0);
    for (let i = i0; i < i1 && i < p.x.length; i++) {
      const u = p.x[i], v = p.z[i];
      n++; sx += u; sz += v; sxx += u * u; sxz += u * v;
    }
    const d = n * sxx - sx * sx;
    return n > 2 && d !== 0 ? (n * sxz - sx * sz) / d : NaN;
  }

  function rotate(p, ang) {
    if (!ang) return p;
    const c = Math.cos(ang), s = Math.sin(ang);
    const n = p.x.length;
    const pts = new Array(n);
    for (let i = 0; i < n; i++) pts[i] = [p.x[i] * c - p.z[i] * s, p.x[i] * s + p.z[i] * c];
    pts.sort((a, b) => a[0] - b[0]);
    const x = new Float64Array(n), z = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = pts[i][0]; z[i] = pts[i][1]; }
    return { x, z };
  }

  // 右面(R)・左面(L)を合成。level: 中心線を水平にする近似区間 [mm]（0 で回転なし）
  function buildSection(R, L, level) {
    let ang = 0;
    if (level > 0 && R && L) {
      const sr = fitSlope(R, 0, level), sl = fitSlope(L, 0, level);
      if (Number.isFinite(sr) && Number.isFinite(sl)) ang = -(Math.atan(sr) + Math.atan(sl)) / 2;
    }
    return { R: R && rotate(R, ang), L: L && rotate(L, ang), angle: ang };
  }

  // 刃先から距離 d の厚み（右面Z − 左面Z）
  function thicknessAt(sec, d) {
    if (!sec.R || !sec.L) return NaN;
    return interp(sec.R.x, sec.R.z, -d) - interp(sec.L.x, sec.L.z, -d);
  }

  // 0〜d 区間の直線近似による刃角（両面のなす角）[°]
  function includedAngle(sec, d) {
    if (!sec.R || !sec.L) return NaN;
    const sr = fitSlope(sec.R, 0, d), sl = fitSlope(sec.L, 0, d);
    return (Math.atan(sl) - Math.atan(sr)) * 180 / Math.PI;
  }

  // 表示用の間引き: 刃先近傍 (|x| <= keep) は全点、それ以外は最大 maxPts 点程度に
  function decimate(p, maxPts, keep) {
    const n = p.x.length;
    const stride = Math.max(1, Math.ceil(n / maxPts));
    const xs = [], zs = [];
    for (let i = 0; i < n; i++) {
      if (i % stride === 0 || i === n - 1 || p.x[i] >= -keep) { xs.push(p.x[i]); zs.push(p.z[i]); }
    }
    return { x: xs, z: zs };
  }

  root.HasakiCore = {
    decodeText, parseProfile, guessSideAndKey, guessInvertZ, detectTip,
    alignSide, buildSection, thicknessAt, includedAngle, interp, decimate, fitSlope,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
