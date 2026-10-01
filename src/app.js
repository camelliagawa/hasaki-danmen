// 刃先断面ツール: 画面処理
(function () {
  'use strict';
  const C = window.HasakiCore;
  const $ = id => document.getElementById(id);
  const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#4b5563', '#65a30d'];
  const SIDE_JP = { R: '右面', L: '左面' };

  const state = {
    sets: [],             // {id, name, color, visible, R: file|null, L: file|null}
    selectedId: null,     // 刃先確認グラフに表示するファイル
    scale: 5,
    range: 0,
    nextId: 1,
    pickTarget: null,     // クリックでファイル選択したときの投入先 {setId, side}
  };

  function addSet(name) {
    const used = new Set(state.sets.map(s => s.color));
    const color = COLORS.find(c => !used.has(c)) || COLORS[state.sets.length % COLORS.length];
    const set = { id: state.nextId++, name: name || `セット${state.sets.length + 1}`, color, visible: true, R: null, L: null, dz: 0, rot: 0,
      dash: name === '研磨前' ? 'dash' : 'solid' };   // 線の種類（両面共通）
    state.sets.push(set);
    return set;
  }
  addSet('研磨前');
  addSet('研磨後');

  const allFiles = () => state.sets.flatMap(s => [s.R, s.L].filter(Boolean));
  const findFile = id => allFiles().find(f => f.id === id);
  const setOf = f => state.sets.find(s => s.R === f || s.L === f);

  // ---------- 読込 ----------

  async function readFile(f) {
    const buf = await f.arrayBuffer();
    const prof = C.parseProfile(C.decodeText(buf));
    const g = C.guessSideAndKey(f.name, prof.meta);
    const t = Date.parse(prof.meta.DateTime || '');
    const file = {
      id: state.nextId++, name: f.name, prof, key: g.key, side: g.side,
      reverseX: false, time: Number.isFinite(t) ? t : null,
    };
    Object.assign(file, C.guessZ(g.side, prof.meta));
    detect(file);
    return file;
  }

  async function readAll(fileList) {
    const out = [], errors = [];
    for (const f of fileList) {
      try { out.push(await readFile(f)); } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    if (errors.length) alert('読み込めなかったファイルがあります\n' + errors.join('\n'));
    return out;
  }

  function place(set, side, file) {
    file.side = side;
    Object.assign(file, C.guessZ(side, file.prof.meta));
    set[side] = file;
    state.selectedId = file.id;
  }

  // 投入先の決定
  //   target.side あり: その枠へ（1ファイル目のみ）
  //   target.setId のみ: そのセットへ右左を自動振り分け
  //   target なし（枠の外）: 測定日時→ファイル名順に、空いているセットへ順に詰める
  async function loadFiles(fileList, target) {
    const files = await readAll(fileList);
    if (!files.length) return;
    const set = target && state.sets.find(s => s.id === target.setId);
    if (set && target.side && files.length === 1) {
      place(set, target.side, files[0]);
    } else if (set) {
      // 面が判定できず重なった場合はもう一方の面へ。3ファイル目以降は他の空き枠へ
      const used = new Set();
      for (const f of files) {
        const other = f.side === 'R' ? 'L' : 'R';
        const side = !used.has(f.side) ? f.side : !used.has(other) ? other : null;
        if (side) { used.add(side); place(set, side, f); } else placeAnywhere(f);
      }
    } else {
      files.sort((a, b) => (a.time ?? 0) - (b.time ?? 0) || a.name.localeCompare(b.name, 'ja', { numeric: true }));
      for (const f of files) placeAnywhere(f);
    }
    refreshAll();
  }

  function placeAnywhere(f) {
    let set = state.sets.find(s => !s[f.side]);
    if (!set) set = addSet();
    place(set, f.side, f);
  }

  function detect(file) {
    const { x, z } = file.prof;
    const angleDeg = parseFloat($('detAngle').value) || 40;
    let r;
    if (file.reverseX) {
      // 刃先→峰の測定: 反転して検出し、元の X に戻す
      const n = x.length;
      const rx = new Float64Array(n), rz = new Float64Array(n);
      for (let i = 0; i < n; i++) { rx[i] = -x[n - 1 - i]; rz[i] = z[n - 1 - i]; }
      r = C.detectTip(rx, rz, { angleDeg });
      r = { x: -r.x, found: r.found };
    } else {
      r = C.detectTip(x, z, { angleDeg });
    }
    file.tipX = file.autoTipX = r.x;
    file.found = r.found;
  }

  // ---------- グラフの表記（表示/非表示・文言）----------
  //   item: {label, text?, show?, num?}  text を持つ項目は文言を編集可、show を持つ項目は表示切替可
  const LABEL_DEFS = {
    section: {
      title: { label: 'タイトル', show: false, text: '包丁断面' },
      x: { label: 'X軸の名前', show: true, text: '刃先からの位置 X [mm]（峰側 ← → 刃先）' },
      y: { label: 'Y軸の名前', show: true, text: 'Z [mm]（上: 右面 / 下: 左面）' },
      legend: { label: '凡例', show: true },
      note: { label: '拡大表示の注記（{倍率}は倍率）', show: true, text: '厚み方向 ×{倍率} 拡大表示' },
      tick: { label: '目盛の数値', show: true },
      xr: { label: 'X軸の数値', axis: { min: '', max: '', dtick: '', digits: '' } },
      yr: { label: 'Y軸の数値', axis: { min: '', max: '', dtick: '0.5', digits: '' } },
      font: { label: '文字サイズ', num: 12 },
    },
    thick: {
      title: { label: 'タイトル', show: false, text: '厚み曲線' },
      x: { label: 'X軸の名前', show: true, text: '刃先からの距離 [mm]' },
      y: { label: 'Y軸の名前', show: true, text: '厚み [mm]' },
      legend: { label: '凡例', show: true },
      tick: { label: '目盛の数値', show: true },
      xr: { label: 'X軸の数値', axis: { min: '', max: '', dtick: '', digits: '' } },
      yr: { label: 'Y軸の数値', axis: { min: '', max: '', dtick: '', digits: '' } },
      font: { label: '文字サイズ', num: 12 },
    },
    diff: {
      title: { label: 'タイトル', show: false, text: '厚みの変化' },
      x: { label: 'X軸の名前', show: true, text: '刃先からの距離 [mm]' },
      y: { label: 'Y軸の名前', show: true, text: '厚みの差 [µm]' },
      legend: { label: '凡例', show: true },
      series: { label: '凡例の文言（{セット名} {基準}）', text: '{セット名} − {基準}' },
      tick: { label: '目盛の数値', show: true },
      xr: { label: 'X軸の数値', axis: { min: '', max: '', dtick: '', digits: '' } },
      yr: { label: 'Y軸の数値', axis: { min: '', max: '', dtick: '', digits: '' } },
      font: { label: '文字サイズ', num: 12 },
    },
  };
  const LABEL_KEY = 'hasaki-danmen-labels';
  const labels = JSON.parse(JSON.stringify(LABEL_DEFS));
  try {
    const saved = JSON.parse(localStorage.getItem(LABEL_KEY) || '{}');
    for (const g in labels) for (const k in labels[g]) if (saved[g] && saved[g][k]) {
      const ax = labels[g][k].axis;
      Object.assign(labels[g][k], saved[g][k]);
      if (ax) labels[g][k].axis = Object.assign({}, ax, saved[g][k].axis);
    }
  } catch (e) { /* 保存領域が使えない環境では既定値 */ }
  function saveLabels() { try { localStorage.setItem(LABEL_KEY, JSON.stringify(labels)); } catch (e) { /* 無視 */ } }

  const lblText = (g, k) => { const it = labels[g][k]; return it.show === false ? '' : it.text; };

  // 表記設定をレイアウトに反映
  function applyLabels(g, layout) {
    const L = labels[g];
    const t = lblText(g, 'title');
    layout.title = t ? { text: t, x: 0.5, xanchor: 'center' } : undefined;
    layout.margin = Object.assign({}, layout.margin, { t: t ? 40 + L.font.num : 10 });
    layout.xaxis.title = { text: lblText(g, 'x') };
    layout.yaxis.title = { text: lblText(g, 'y') };
    layout.xaxis.showticklabels = layout.yaxis.showticklabels = L.tick.show !== false;
    layout.showlegend = L.legend.show !== false;
    layout.font = { size: L.font.num };
    // 軸の数値（空欄は自動）。対数軸の最小・最大は実数で指定（目盛間隔は対数軸では無視）
    for (const [k, axName] of [['xr', 'xaxis'], ['yr', 'yaxis']]) {
      const a = L[k] && L[k].axis, ax = layout[axName];
      if (!a || !ax) continue;
      const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      const log = ax.type === 'log';
      const conv = v => v === null ? null : log ? (v > 0 ? Math.log10(v) : null) : v;
      const mn = conv(num(a.min)), mx = conv(num(a.max));
      if (mn !== null || mx !== null) {
        const cur = ax.range;
        if (mn !== null && mx !== null) ax.range = [mn, mx];
        else if (cur) ax.range = [mn !== null ? mn : cur[0], mx !== null ? mx : cur[1]];
        if (ax.range) ax.autorange = false;
      }
      const dt = num(a.dtick);
      if (dt && dt > 0 && !log) { ax.tickmode = 'linear'; ax.tick0 = 0; ax.dtick = dt; }
      const dg = num(a.digits);
      if (dg !== null && dg >= 0) ax.tickformat = log ? `.${Math.round(dg)}~f` : `.${Math.round(dg)}f`;
    }
    return layout;
  }

  function renderLabelPanel(g) {
    const el = $('lbl_' + g);
    el.innerHTML = Object.entries(labels[g]).map(([k, it]) => `
      <div class="ctrl" data-k="${k}">
        ${'show' in it ? `<input type="checkbox" class="lshow" ${it.show ? 'checked' : ''} title="表示する">` : '<span style="width:13px;display:inline-block"></span>'}
        <label style="min-width:150px">${esc(it.label)}</label>
        ${'text' in it ? `<input type="text" class="ltext" value="${esc(it.text)}" style="flex:1;min-width:160px">` : ''}
        ${'num' in it ? `<input type="number" class="lnum" value="${it.num}" min="6" max="40" step="1" style="width:60px"> px` : ''}
        ${'axis' in it ? [['min', '最小'], ['max', '最大'], ['dtick', '間隔'], ['digits', '小数桁']].map(([f, t]) =>
          `<span class="muted">${t}</span><input type="text" class="lax" data-f="${f}" value="${esc(it.axis[f])}" placeholder="自動" style="width:58px">`).join('') : ''}
      </div>`).join('') + '<div class="ctrl"><button class="small lreset">初期値に戻す</button><span class="muted">設定はこのブラウザに保存されます。軸の数値は空欄で自動（単位はグラフの軸と同じ）</span></div>';
    el.querySelectorAll('[data-k]').forEach(row => {
      const it = labels[g][row.dataset.k];
      const on = () => { saveLabels(); refreshPlots(); };
      const cb = row.querySelector('.lshow'), tx = row.querySelector('.ltext'), nm = row.querySelector('.lnum');
      if (cb) cb.onchange = () => { it.show = cb.checked; on(); };
      if (tx) tx.oninput = () => { it.text = tx.value; on(); };
      if (nm) nm.onchange = () => { const v = parseFloat(nm.value); if (Number.isFinite(v)) { it.num = v; on(); } };
      row.querySelectorAll('.lax').forEach(inp => inp.onchange = () => { it.axis[inp.dataset.f] = inp.value.trim(); on(); });
    });
    el.querySelector('.lreset').onclick = () => {
      labels[g] = JSON.parse(JSON.stringify(LABEL_DEFS[g]));
      saveLabels(); renderLabelPanel(g); refreshPlots();
    };
  }
  ['section', 'thick', 'diff'].forEach(g => {
    renderLabelPanel(g);
    $('lblBtn_' + g).onclick = () => { $('lbl_' + g).hidden = !$('lbl_' + g).hidden; };
  });

  // ---------- 合成 ----------

  function sections() {
    const level = $('levelOn').checked ? (parseFloat($('levelLen').value) || 0) : 0;
    for (const s of state.sets) {
      // 既定: 測定座標の上下間隔を保持（先端の厚みを残す）。片面のみ・旧方式は各面の刃先を原点へ
      const pair = $('alignMode').value === 'abs' && s.R && s.L ? C.alignPair(s.R, s.L) : null;
      const R = pair ? pair.R : s.R && C.alignSide(s.R.prof, s.R.tipX, s.R.invertZ, s.R.reverseX);
      const L = pair ? pair.L : s.L && C.alignSide(s.L.prof, s.L.tipX, s.L.invertZ, s.L.reverseX);
      s.sec0 = C.buildSection(R, L, level);
      // 傾き補正（原点まわりの回転）→ Z方向の平行移動（セットごと）
      const a = s.rot * Math.PI / 180;
      const rot = p => p && a ? C.rotate(p, a) : p;
      s.sec = Object.assign({}, s.sec0, { R: C.shiftZ(rot(s.sec0.R), s.dz), L: C.shiftZ(rot(s.sec0.L), s.dz) });
    }
    return state.sets;
  }

  const complete = s => s.visible && s.sec && s.sec.R && s.sec.L;
  const baseSet = () => state.sets.find(s => s.sec0 && s.sec0.R && s.sec0.L) || state.sets.find(s => s.sec0 && (s.sec0.R || s.sec0.L));

  function matchRange() {
    const a = parseFloat($('matchFrom').value), b = parseFloat($('matchTo').value);
    return [Math.min(a, b) || 0, Math.max(a, b) || 0];
  }

  // 基準セットに対する一致度（現在の移動量での残差）と、最適な移動量
  function matchInfo(s) {
    const base = baseSet();
    if (!base || base === s || !s.sec0 || !base.sec) return null;
    const [a, b] = matchRange();
    const best = $('matchTilt').checked ? C.matchZTilt(base.sec, s.sec0, a, b) : Object.assign({ angle: s.rot * Math.PI / 180 }, C.matchZ(base.sec, rotSec(s), a, b));
    const cur = C.matchZ(base.sec, s.sec, a, b);
    return { best, cur, base };
  }

  // 傾きのみ適用した断面（Z移動前）
  function rotSec(s) {
    const a = s.rot * Math.PI / 180;
    return { R: s.sec0.R && (a ? C.rotate(s.sec0.R, a) : s.sec0.R), L: s.sec0.L && (a ? C.rotate(s.sec0.L, a) : s.sec0.L) };
  }

  function autoMatch(s) {
    const m = matchInfo(s);
    if (m && Number.isFinite(m.best.dz)) { s.dz = m.best.dz; s.rot = m.best.angle * 180 / Math.PI; }
  }

  function distances() {
    return $('distInput').value.split(/[,\s、，]+/).map(parseFloat).filter(v => Number.isFinite(v) && v >= 0);
  }

  // ---------- 描画 ----------

  const plotCfg = { responsive: true, displaylogo: false, scrollZoom: true,
    toImageButtonOptions: { format: 'png', scale: 2 },
    modeBarButtonsToRemove: ['select2d', 'lasso2d'] };

  function refreshAll() {
    sections();
    renderSets();
    renderFileList();
    refreshPlots();
  }

  function refreshPlots() {
    const ss = sections();
    renderSection(ss);
    renderThickness(ss);
    renderTipPlot();
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function fmtTime(f) { return f.prof.meta.DateTime ? esc(f.prof.meta.DateTime) : ''; }

  // 先端の上下間隔が不自然（負 or 5mm超）なら警告
  function gapWarn(s) {
    if ($('alignMode').value !== 'abs' || !s.sec0 || !s.sec0.R || !s.sec0.L) return '';
    const t = C.thicknessAt(s.sec0, 0);
    if (!Number.isFinite(t) || (t > -0.005 && t < 5)) return '';
    return `<div class="warn" style="color:var(--warn);font-size:12px">先端の厚みが ${t.toFixed(3)} mm と不自然です。「刃先位置の調整」欄の Z反転・Z補正 を確認してください。</div>`;
  }

  function zRow(s) {
    if (!s.sec0 || !(s.sec0.R || s.sec0.L)) return '';
    const base = baseSet();
    const m = matchInfo(s);
    const info = s === base ? '<span class="muted">Z合わせの基準</span>'
      : m && Number.isFinite(m.cur.dz) ? `<span class="muted" title="指定区間での基準セットとの残差（RMS）">ずれ ${(m.cur.rms * 1000).toFixed(1)} µm（平均 ${(-m.cur.dz * 1000).toFixed(1)} µm）</span>` : '';
    return `<div class="ctrl" style="margin:6px 0 0">
      <label>Z移動</label>
      <button class="small" data-z="minus">−</button>
      <input type="number" class="dz" step="0.1" value="${(s.dz * 1000).toFixed(1)}" style="width:80px">
      <button class="small" data-z="plus">＋</button><span class="muted">µm</span>
      ${s === base ? '' : '<button class="small" data-z="auto" title="刃先から指定区間で基準セットに重なるよう自動で移動">自動合わせ</button>'}
      <label style="margin-left:6px">傾き</label>
      <input type="number" class="rot" step="0.001" value="${s.rot.toFixed(4)}" style="width:80px"><span class="muted">°</span>
      <button class="small" data-z="zero" title="Z移動と傾きを0に戻す">リセット</button>
      ${info}</div>`;
  }

  function renderSets() {
    const el = $('setList');
    el.innerHTML = state.sets.map(s => {
      const warn = s.R && s.L && s.R.key !== s.L.key
        ? `<div class="warn" style="color:var(--warn);font-size:12px">右面と左面のファイル名が異なります（${esc(s.R.key)} / ${esc(s.L.key)}）</div>` : '';
      const slot = side => {
        const f = s[side];
        return `<div class="slot ${f ? 'filled' : ''}" data-set="${s.id}" data-side="${side}" title="クリックでファイル選択／ドロップで入れ替え">
          <b>${SIDE_JP[side]}${f ? '<button class="small clr" title="このファイルを外す">×</button>' : ''}</b>${f ? `${esc(f.name)}<div class="muted">${fmtTime(f)}</div>` : '<span class="empty-msg">ここにドロップ<br>またはクリック</span>'}</div>`;
      };
      return `<div class="set" data-set="${s.id}" style="--c:${s.color}">
        <div class="head">
          <input type="checkbox" class="vis" ${s.visible ? 'checked' : ''} title="表示">
          <input type="color" class="col" value="${s.color}" style="width:26px;height:20px;padding:0;border:none" title="色">
          <select class="dash" title="線の種類（右面・左面共通）">${[['solid', '実線'], ['dash', '破線'], ['dot', '点線'], ['dashdot', '一点鎖線']]
            .map(([v, t]) => `<option value="${v}" ${s.dash === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <input type="text" class="name" value="${esc(s.name)}" title="セット名（凡例に表示）">
          <button class="small" data-act="swap" title="右面と左面を入れ替え">左右入替</button>
          ${state.sets.indexOf(s) > 0 ? '<button class="small" data-act="up" title="ファイル（とZ移動・傾き）を上のセットと入れ替え。セット名・色はそのまま">⇅上と入替</button>' : ''}
          <button class="small" data-act="clear" title="ファイルを外して枠を空にする（枠は残る）">空にする</button>
          ${state.sets.length > 2 ? '<button class="small" data-act="del" title="このセットの枠ごと削除">セット削除</button>' : ''}
        </div>
        <div class="slots">${slot('R')}${slot('L')}</div>${warn}${gapWarn(s)}
        ${zRow(s)}
      </div>`;
    }).join('');

    el.querySelectorAll('.set').forEach(div => {
      const s = state.sets.find(v => v.id === +div.dataset.set);
      div.querySelector('.vis').onchange = e => { s.visible = e.target.checked; refreshPlots(); };
      div.querySelector('.dash').onchange = e => { s.dash = e.target.value; refreshPlots(); };
      div.querySelector('.col').oninput = e => { s.color = e.target.value; div.style.setProperty('--c', s.color); refreshPlots(); };
      div.querySelector('.name').onchange = e => { s.name = e.target.value.trim() || s.name; refreshAll(); };
      div.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => {
        const i = state.sets.indexOf(s);
        if (b.dataset.act === 'swap') {
          const r = s.R, l = s.L;
          s.R = s.L = null;
          if (l) place(s, 'R', l);
          if (r) place(s, 'L', r);
        } else if (b.dataset.act === 'up' && i > 0) {
          // 中身だけ入れ替え（名前・色・表示は枠に残す）
          const o = state.sets[i - 1];
          for (const k of ['R', 'L', 'dz', 'rot']) [o[k], s[k]] = [s[k], o[k]];
        } else if (b.dataset.act === 'clear') {
          s.R = s.L = null; s.dz = 0; s.rot = 0;
          if (!findFile(state.selectedId)) state.selectedId = allFiles()[0] ? allFiles()[0].id : null;
        } else if (b.dataset.act === 'del') {
          if ((s.R || s.L) && !confirm(`「${s.name}」を削除しますか？`)) return;
          state.sets.splice(i, 1);
          if (!findFile(state.selectedId)) state.selectedId = allFiles()[0] ? allFiles()[0].id : null;
        }
        refreshAll();
      });
      const dzIn = div.querySelector('.dz');
      const rotIn = div.querySelector('.rot');
      if (rotIn) rotIn.onchange = e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { s.rot = v; refreshAll(); } };
      if (dzIn) dzIn.onchange = e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { s.dz = v / 1000; refreshAll(); } };
      div.querySelectorAll('button[data-z]').forEach(b => b.onclick = () => {
        const step = parseFloat($('nudgeStep').value);
        if (b.dataset.z === 'minus') s.dz -= step;
        else if (b.dataset.z === 'plus') s.dz += step;
        else if (b.dataset.z === 'zero') { s.dz = 0; s.rot = 0; }
        else if (b.dataset.z === 'auto') autoMatch(s);
        refreshAll();
      });
      div.querySelectorAll('.slot .clr').forEach(b => b.onclick = e => {
        e.stopPropagation();
        s[b.closest('.slot').dataset.side] = null;
        if (!findFile(state.selectedId)) state.selectedId = allFiles()[0] ? allFiles()[0].id : null;
        refreshAll();
      });
      div.querySelectorAll('.slot').forEach(sl => sl.onclick = () => {
        state.pickTarget = { setId: s.id, side: sl.dataset.side };
        $('fileInput').click();
      });
    });
  }

  function renderFileList() {
    const el = $('fileList');
    const rows = state.sets.flatMap(s => ['R', 'L'].filter(side => s[side]).map(side => ({ s, f: s[side] })));
    if (!rows.length) { el.innerHTML = '<div class="muted">未読込</div>'; return; }
    el.innerHTML = rows.map(({ s, f }) => `
      <div class="file ${f.id === state.selectedId ? 'sel' : ''}" data-id="${f.id}" style="border-left:5px solid ${s.color}">
        <div class="row"><span class="name">${esc(s.name)} ${SIDE_JP[f.side]}</span><span class="muted">${esc(f.name)}</span><span style="flex:1"></span>
          <button class="small" data-act="sel">確認</button><button class="small" data-act="del">外す</button></div>
        <div class="row">
          <label class="muted">刃先X</label>
          <button class="small" data-act="minus">−</button>
          <input type="number" class="tip" step="0.0001" value="${f.tipX.toFixed(4)}">
          <button class="small" data-act="plus">＋</button> <span class="muted">mm</span>
          <button class="small" data-act="auto">自動</button>
          <label class="muted"><input type="checkbox" class="inv" ${f.invertZ ? 'checked' : ''}>Z反転</label>
          <label class="muted" title="刃先側から峰側へ測定したデータの場合にチェック"><input type="checkbox" class="rev" ${f.reverseX ? 'checked' : ''}>刃先→峰</label>
          <label class="muted" title="上下面の間隔（厚み）を正しくするためのZ補正。逆向き触針で座標系が反転されずに保存されたファイルは自動で ${C.REVERSE_Z_OFFSET} mm">Z補正</label>
          <input type="number" class="zoff" step="0.001" value="${(f.zOffset || 0).toFixed(3)}" style="width:80px"><span class="muted">mm</span>
        </div>
        <div class="muted">${f.tipX === f.autoTipX ? '自動検出値' : `手動調整（自動: ${f.autoTipX.toFixed(4)}, 差 ${((f.tipX - f.autoTipX) * 1000).toFixed(1)} µm）`}
          ／ ${f.prof.x.length.toLocaleString()} 点, X ${f.prof.x[0].toFixed(3)}〜${f.prof.x[f.prof.x.length - 1].toFixed(3)} mm</div>
        ${f.found ? '' : '<div class="warn">刃先の急変点が見つからず、データ終端を刃先にしています。手動で調整してください。</div>'}
      </div>`).join('');

    el.querySelectorAll('.file').forEach(div => {
      const f = findFile(+div.dataset.id);
      const q = s => div.querySelector(s);
      q('.inv').onchange = e => { f.invertZ = e.target.checked; refreshAll(); };
      q('.zoff').onchange = e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { f.zOffset = v; refreshAll(); } };
      q('.rev').onchange = e => { f.reverseX = e.target.checked; detect(f); refreshAll(); };
      q('.tip').onchange = e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setTip(f, v); };
      div.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => {
        const step = parseFloat($('nudgeStep').value);
        switch (b.dataset.act) {
          case 'sel': state.selectedId = f.id; refreshAll(); break;
          case 'del': {
            const s = setOf(f);
            s[f.side] = null;
            if (state.selectedId === f.id) state.selectedId = allFiles()[0] ? allFiles()[0].id : null;
            refreshAll(); break;
          }
          case 'minus': setTip(f, f.tipX - step); break;
          case 'plus': setTip(f, f.tipX + step); break;
          case 'auto': detect(f); refreshAll(); break;
        }
      });
    });
  }

  function setTip(f, v) {
    const x = f.prof.x;
    f.tipX = Math.min(Math.max(v, x[0]), x[x.length - 1]);
    state.selectedId = f.id;
    refreshAll();
  }

  const p0 = p => p && p.x.length > 0;

  function sectionTraces(ss) {
    const traces = [];
    for (const s of ss) {
      if (!s.visible) continue;
      for (const side of ['R', 'L']) {
        const p = s.sec[side];
        if (!p) continue;
        // 破線を正しく描くため SVG 描画（scatter）。点数は間引き、刃先近傍 0.3mm は全点
        const d = C.decimate(p, 6000, 0.3);
        traces.push({
          type: 'scatter', mode: 'lines', x: d.x, y: d.z,
          // 凡例はセットごとに1項目（右面のみ表示、左面は同じグループでまとめて表示切替）
          name: s.name, legendgroup: String(s.id), showlegend: side === 'R' || !p0(s.sec.R),
          line: { color: s.color, width: s.dash === 'solid' ? 1.5 : 2, dash: s.dash },
          hovertemplate: `${esc(s.name)} ${SIDE_JP[side]}<br>X=%{x:.4f} mm<br>Z=%{y:.4f} mm<extra></extra>`,
        });
      }
    }
    // 先端の端面（右面の先端と左面の先端を結ぶ線）
    for (const s of ss) {
      if (!s.visible || !s.sec.R || !s.sec.L) continue;
      const r = s.sec.R, l = s.sec.L, nr = r.x.length - 1, nl = l.x.length - 1;
      const t = r.z[nr] - l.z[nl];
      traces.push({ type: 'scatter', mode: 'lines', x: [r.x[nr], l.x[nl]], y: [r.z[nr], l.z[nl]], showlegend: false,
        legendgroup: String(s.id), line: { color: s.color, width: 1.5, dash: s.dash === 'solid' ? 'dot' : s.dash },
        hovertemplate: `${esc(s.name)} 先端厚さ ${(t * 1000).toFixed(1)} µm<extra></extra>` });
    }
    traces.push({ type: 'scatter', mode: 'markers', x: [0], y: [0], name: '刃先', showlegend: false,
      marker: { color: '#000', size: 7, symbol: 'x' }, hovertemplate: '刃先 (0, 0)<extra></extra>' });
    return traces;
  }

  function renderSection(ss) {
    const el = $('plotSection');
    const vis = ss.filter(s => s.visible && (s.sec.R || s.sec.L));
    if (!vis.length) { Plotly.purge(el); el.innerHTML = '<div class="empty">ファイルを読み込むとここに断面が表示されます</div>'; return; }
    if (el.querySelector('.empty')) el.innerHTML = '';

    let xmin = 0, zmin = 0, zmax = 0;
    for (const s of vis) for (const p of [s.sec.R, s.sec.L]) if (p && p.x.length) xmin = Math.min(xmin, p.x[0]);
    const R = state.range > 0 ? state.range : -xmin;
    for (const s of vis) for (const p of [s.sec.R, s.sec.L]) if (p) {
      for (let i = 0; i < p.x.length; i++) if (p.x[i] >= -R) { zmin = Math.min(zmin, p.z[i]); zmax = Math.max(zmax, p.z[i]); }
    }
    const padX = R * 0.04;
    const padZ = Math.max((zmax - zmin) * 0.1, R * 0.002);
    const layout = {
      margin: { l: 70, r: 20, t: 10, b: 50 },
      xaxis: { range: [-R - padX, padX], zeroline: true, zerolinecolor: '#999', exponentformat: 'none' },
      yaxis: { range: [zmin - padZ, zmax + padZ], zeroline: true, zerolinecolor: '#999', exponentformat: 'none' },
      legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0 },
      hovermode: 'closest', dragmode: 'zoom',
    };
    if (state.scale > 0) {
      layout.yaxis.scaleanchor = 'x';
      layout.yaxis.scaleratio = state.scale;
      layout.yaxis.constrain = 'domain';
      layout.xaxis.constrain = 'domain';
    }
    applyLabels('section', layout);
    const note = lblText('section', 'note');
    if (state.scale !== 1 && state.scale > 0 && note) {
      layout.annotations = [{ text: esc(note.replace(/\{倍率\}/g, state.scale)), xref: 'paper', yref: 'paper', x: 1, y: 0, xanchor: 'right', yanchor: 'bottom', showarrow: false, font: { color: '#b45309' } }];
    }
    Plotly.react(el, sectionTraces(ss), layout, plotCfg);
  }

  // 厚み曲線用のサンプル距離（対数 or 等間隔）
  function sampleD(maxD, log) {
    const N = 600, ds = [];
    for (let i = 0; i <= N; i++) ds.push(log ? Math.pow(10, -3 + (Math.log10(maxD) + 3) * i / N) : maxD * i / N);
    return ds;
  }
  const maxDist = s => Math.min(-s.sec.R.x[0], -s.sec.L.x[0]);

  function renderThickness(ss) {
    const table = $('thickTable');
    const ds = distances();
    const pairs = ss.filter(complete);
    const base = pairs[0];
    if (!pairs.length) {
      table.innerHTML = '<div class="muted">右面と左面がそろったセットがありません</div>';
      Plotly.purge($('plotThick')); Plotly.purge($('plotDiff')); $('diffCard').hidden = true;
      return;
    }
    const sw = s => `<span class="swatch" style="background:${s.color}"></span> ${esc(s.name)}`;
    let h = '<table><tr><th class="num">距離 [mm]</th>' + pairs.map(s =>
      `<th class="num">${sw(s)}<br>厚み [mm]</th><th class="num">刃角 [°]</th>` +
      (s !== base ? `<th class="num">差 [µm]<br><span class="muted">対 ${esc(base.name)}</span></th>` : '')).join('') + '</tr>';
    for (const d of ds) {
      const tb = C.thicknessAt(base.sec, d);
      h += `<tr><td class="num">${d === 0 ? '0（先端）' : d}</td>` + pairs.map(s => {
        const t = C.thicknessAt(s.sec, d), a = C.includedAngle(s.sec, d);
        const diff = (t - tb) * 1000;
        return `<td class="num">${Number.isFinite(t) ? t.toFixed(4) : '—'}</td><td class="num">${Number.isFinite(a) ? a.toFixed(2) : '—'}</td>` +
          (s !== base ? `<td class="num" style="color:${diff < 0 ? '#b91c1c' : '#15803d'}">${Number.isFinite(diff) ? (diff > 0 ? '+' : '') + diff.toFixed(1) : '—'}</td>` : '');
      }).join('') + '</tr>';
    }
    table.innerHTML = h + '</table>';

    const log = $('thickLog').checked;
    const xaxis = { type: log ? 'log' : 'linear', exponentformat: 'none' };
    const common = { margin: { l: 70, r: 20, t: 10, b: 50 }, legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0 }, hovermode: 'x unified' };

    const traces = pairs.map(s => {
      const xs = [], ys = [];
      for (const d of sampleD(maxDist(s), log)) {
        const t = C.thicknessAt(s.sec, d);
        if (Number.isFinite(t)) { xs.push(d); ys.push(t); }
      }
      return { type: 'scatter', mode: 'lines', x: xs, y: ys, name: s.name, line: { color: s.color, width: 2 },
        hovertemplate: `${esc(s.name)} %{y:.4f} mm<extra></extra>` };
    });
    Plotly.react($('plotThick'), traces, applyLabels('thick', Object.assign({}, common, {
      xaxis: Object.assign({}, xaxis), yaxis: { type: log ? 'log' : 'linear', exponentformat: 'none' },
    })), plotCfg);

    // 基準セットとの差
    const others = pairs.slice(1);
    $('diffCard').hidden = !others.length;
    if (!others.length) { Plotly.purge($('plotDiff')); return; }
    const dtraces = others.map(s => {
      const xs = [], ys = [];
      for (const d of sampleD(Math.min(maxDist(s), maxDist(base)), log)) {
        const v = (C.thicknessAt(s.sec, d) - C.thicknessAt(base.sec, d)) * 1000;
        if (Number.isFinite(v)) { xs.push(d); ys.push(v); }
      }
      return { type: 'scatter', mode: 'lines', x: xs, y: ys, name: labels.diff.series.text.replace(/\{セット名\}/g, s.name).replace(/\{基準\}/g, base.name), line: { color: s.color, width: 2 },
        hovertemplate: `${esc(s.name)} − ${esc(base.name)}: %{y:.1f} µm<extra></extra>` };
    });
    Plotly.react($('plotDiff'), dtraces, applyLabels('diff', Object.assign({}, common, {
      xaxis: Object.assign({}, xaxis), yaxis: { zeroline: true, zerolinecolor: '#666', exponentformat: 'none' },
    })), plotCfg);
  }

  function renderTipPlot() {
    const el = $('plotTip');
    const f = findFile(state.selectedId);
    if (!f) { Plotly.purge(el); $('tipInfo').textContent = '「刃先位置の調整」欄の「確認」を押すと表示。グラフ上をクリックするとその位置を刃先に設定します。'; return; }
    const s = setOf(f);
    const W = parseFloat($('tipWin').value);
    const { x, z } = f.prof;
    const xs = [], zs = [];
    for (let i = 0; i < x.length; i++) if (x[i] >= f.tipX - W && x[i] <= f.tipX + W) { xs.push(x[i]); zs.push(z[i]); }
    const zt = C.interp(x, z, f.tipX);
    $('tipInfo').textContent = `${s.name} ${SIDE_JP[f.side]}（${f.name}）刃先 X = ${f.tipX.toFixed(4)} mm, Z = ${zt.toFixed(4)} mm ／ グラフをクリックでその位置を刃先に設定`;
    Plotly.react(el, [
      { type: 'scattergl', mode: 'lines', x: xs, y: zs, name: '生データ', line: { color: '#374151', width: 1 },
        hovertemplate: 'X=%{x:.4f}<br>Z=%{y:.5f}<extra></extra>' },
      { type: 'scatter', mode: 'markers', x: [f.tipX], y: [zt], name: '刃先', marker: { color: '#dc2626', size: 10, symbol: 'x' } },
      { type: 'scatter', mode: 'markers', x: [f.autoTipX], y: [C.interp(x, z, f.autoTipX)], name: '自動検出', marker: { color: '#2563eb', size: 9, symbol: 'circle-open' } },
    ], {
      margin: { l: 80, r: 20, t: 10, b: 50 },
      xaxis: { title: { text: '測定 X [mm]' }, exponentformat: 'none' },
      yaxis: { title: { text: '測定 Z [mm]' }, exponentformat: 'none' },
      shapes: [{ type: 'line', x0: f.tipX, x1: f.tipX, yref: 'paper', y0: 0, y1: 1, line: { color: '#dc2626', width: 1, dash: 'dot' } }],
      hovermode: 'x', showlegend: true, legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0 },
    }, plotCfg);
    if (!el._tipClickBound) {
      el._tipClickBound = true;
      el.on('plotly_click', ev => {
        const cur = findFile(state.selectedId);
        if (cur && ev.points && ev.points.length) setTip(cur, ev.points[0].x);
      });
    }
  }

  // ---------- 出力 ----------

  function download(name, text) {
    const blob = new Blob(['﻿' + text], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function safe(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_'); }

  function baseName() {
    const f = allFiles()[0];
    const key = f ? f.key + '_' : '';
    return safe(key + state.sets.filter(s => s.visible && (s.R || s.L)).map(s => s.name).join('_') || 'danmen');
  }

  $('pngSection').onclick = () => Plotly.downloadImage($('plotSection'), { format: 'png', scale: 2, filename: baseName() + '_断面' });
  $('pngThick').onclick = () => Plotly.downloadImage($('plotThick'), { format: 'png', scale: 2, filename: baseName() + '_厚み' });
  $('pngDiff').onclick = () => Plotly.downloadImage($('plotDiff'), { format: 'png', scale: 2, filename: baseName() + '_厚み差' });

  $('csvTable').onclick = () => {
    const pairs = sections().filter(complete);
    if (!pairs.length) return alert('右面と左面がそろったセットがありません');
    const base = pairs[0];
    const rows = [['距離[mm]', ...pairs.flatMap(s => [`${s.name} 厚み[mm]`, `${s.name} 刃角[°]`, ...(s !== base ? [`${s.name} 差[µm](対${base.name})`] : [])])]];
    for (const d of distances()) {
      const tb = C.thicknessAt(base.sec, d);
      rows.push([d, ...pairs.flatMap(s => {
        const t = C.thicknessAt(s.sec, d);
        const f = (v, k) => Number.isFinite(v) ? v.toFixed(k) : '';
        return [f(t, 5), f(C.includedAngle(s.sec, d), 3), ...(s !== base ? [f((t - tb) * 1000, 2)] : [])];
      })]);
    }
    download(baseName() + '_厚み表.csv', rows.map(r => r.join(',')).join('\r\n'));
  };

  // 全セットを1ファイルに（X を共通の列として横に並べる）
  $('csvData').onclick = () => {
    const ss = sections().filter(s => s.visible && (s.sec.R || s.sec.L));
    if (!ss.length) return alert('データがありません');
    const pitch = parseFloat($('csvPitch').value) || 0.001;
    const maxD = Math.max(...ss.flatMap(s => [s.sec.R ? -s.sec.R.x[0] : 0, s.sec.L ? -s.sec.L.x[0] : 0]));
    const head = ['X[mm]', ...ss.flatMap(s => [`${s.name} 右面Z[mm]`, `${s.name} 左面Z[mm]`, `${s.name} 厚み[mm]`])];
    const lines = [head.join(',')];
    const fmt = v => Number.isFinite(v) ? v.toFixed(6) : '';
    const n = Math.floor(maxD / pitch + 1e-9);
    for (let i = n; i >= 0; i--) {
      const u = -i * pitch;
      const cols = [u.toFixed(6)];
      for (const s of ss) {
        const r = s.sec.R ? C.interp(s.sec.R.x, s.sec.R.z, u) : NaN;
        const l = s.sec.L ? C.interp(s.sec.L.x, s.sec.L.z, u) : NaN;
        cols.push(fmt(r), fmt(l), fmt(r - l));
      }
      lines.push(cols.join(','));
    }
    download(baseName() + '_合成断面.csv', lines.join('\r\n'));
  };

  // ---------- ドラッグ＆ドロップ ----------

  const fi = $('fileInput');
  fi.onchange = () => { const t = state.pickTarget; state.pickTarget = null; loadFiles([...fi.files], t); fi.value = ''; };

  function dropTarget(el) {
    const slot = el.closest && el.closest('.slot');
    if (slot) return { el: slot, setId: +slot.dataset.set, side: slot.dataset.side };
    const set = el.closest && el.closest('.set');
    if (set) return { el: set, setId: +set.dataset.set };
    return null;
  }
  let dragDepth = 0, overEl = null;
  function setOver(el) {
    if (overEl === el) return;
    if (overEl) overEl.classList.remove('over');
    overEl = el;
    if (overEl) overEl.classList.add('over');
  }
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); setOver(null); } });
  window.addEventListener('dragover', e => { e.preventDefault(); const t = dropTarget(e.target); setOver(t ? t.el : null); });
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); setOver(null);
    if (e.dataTransfer && e.dataTransfer.files.length) loadFiles([...e.dataTransfer.files], dropTarget(e.target));
  });

  // ---------- その他のイベント ----------

  function toggleGroup(groupId, attr, setter) {
    $(groupId).querySelectorAll('button').forEach(b => b.onclick = () => {
      $(groupId).querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
      setter(parseFloat(b.dataset[attr]));
      renderSection(sections());
    });
  }
  toggleGroup('scaleBtns', 's', v => state.scale = v);
  toggleGroup('rangeBtns', 'r', v => {
    state.range = v;
    // 表示範囲ボタンを押したら、断面グラフのX軸の最小・最大の手入力は解除
    const a = labels.section.xr.axis;
    if (a.min || a.max) { a.min = a.max = ''; saveLabels(); renderLabelPanel('section'); }
  });

  $('addSet').onclick = () => { addSet(); refreshAll(); };
  $('clearAll').onclick = () => {
    if (!confirm('読み込んだファイルを全て削除し、セットを初期状態に戻しますか？')) return;
    state.sets = []; addSet('研磨前'); addSet('研磨後'); state.selectedId = null; refreshAll();
  };
  $('redetectAll').onclick = () => { allFiles().forEach(detect); refreshAll(); };
  $('levelOn').onchange = refreshAll;
  $('autoMatchAll').onclick = () => { sections(); state.sets.forEach(s => { if (s !== baseSet()) autoMatch(s); }); refreshAll(); };
  $('matchFrom').onchange = refreshAll;
  $('matchTo').onchange = refreshAll;
  $('matchTilt').onchange = refreshAll;
  $('alignMode').onchange = refreshAll;
  $('levelLen').onchange = refreshAll;
  $('distInput').onchange = () => renderThickness(sections());
  $('thickLog').onchange = () => renderThickness(sections());
  $('tipWin').onchange = renderTipPlot;

  refreshAll();
})();
