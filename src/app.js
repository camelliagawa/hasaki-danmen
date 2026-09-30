// 刃先断面ツール: 画面処理
(function () {
  'use strict';
  const C = window.HasakiCore;
  const $ = id => document.getElementById(id);
  const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#4b5563', '#65a30d'];

  const state = {
    files: [],            // {id, name, prof, key, side, invertZ, reverseX, tipX, autoTipX, found}
    knifeOpts: {},        // key -> {color, visible}
    selectedId: null,
    scale: 1,
    range: 0,
    nextId: 1,
  };

  // ---------- 読込 ----------

  async function loadFiles(fileList) {
    const errors = [];
    for (const f of fileList) {
      try {
        const buf = await f.arrayBuffer();
        const prof = C.parseProfile(C.decodeText(buf));
        const g = C.guessSideAndKey(f.name, prof.meta);
        const file = {
          id: state.nextId++, name: f.name, prof, key: g.key, side: g.side,
          invertZ: C.guessInvertZ(g.side, prof.meta), reverseX: false,
        };
        detect(file);
        state.files.push(file);
        if (!state.selectedId) state.selectedId = file.id;
      } catch (e) {
        errors.push(`${f.name}: ${e.message}`);
      }
    }
    if (errors.length) alert('読み込めなかったファイルがあります\n' + errors.join('\n'));
    refreshAll();
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

  // ---------- 合成 ----------

  function knives() {
    const map = new Map();
    for (const f of state.files) {
      if (!map.has(f.key)) map.set(f.key, { key: f.key, R: null, L: null, dup: false });
      const k = map.get(f.key);
      if (k[f.side]) k.dup = true; else k[f.side] = f;
    }
    let ci = 0;
    for (const k of map.values()) {
      if (!state.knifeOpts[k.key]) {
        const used = new Set(Object.values(state.knifeOpts).map(o => o.color));
        let c = COLORS.find(c => !used.has(c)) || COLORS[ci % COLORS.length];
        state.knifeOpts[k.key] = { color: c, visible: true };
      }
      ci++;
      k.opt = state.knifeOpts[k.key];
      const R = k.R && C.alignSide(k.R.prof, k.R.tipX, k.R.invertZ, k.R.reverseX);
      const L = k.L && C.alignSide(k.L.prof, k.L.tipX, k.L.invertZ, k.L.reverseX);
      const level = $('levelOn').checked ? (parseFloat($('levelLen').value) || 0) : 0;
      k.sec = C.buildSection(R, L, level);
    }
    return [...map.values()];
  }

  function distances() {
    return $('distInput').value.split(/[,\s、，]+/).map(parseFloat).filter(v => Number.isFinite(v) && v > 0);
  }

  // ---------- 描画 ----------

  const plotCfg = { responsive: true, displaylogo: false, scrollZoom: true,
    toImageButtonOptions: { format: 'png', scale: 2 },
    modeBarButtonsToRemove: ['select2d', 'lasso2d'] };

  function refreshAll() {
    renderFileList();
    const ks = knives();
    renderKnifeList(ks);
    renderSection(ks);
    renderThickness(ks);
    renderTipPlot();
  }

  function refreshPlots() {
    const ks = knives();
    renderKnifeList(ks);
    renderSection(ks);
    renderThickness(ks);
    renderTipPlot();
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function renderKnifeList(ks) {
    const el = $('knifeList');
    if (!ks.length) { el.innerHTML = '<div class="muted">未読込</div>'; return; }
    el.innerHTML = '<table><tr><th>表示</th><th>色</th><th>包丁名</th><th>右面</th><th>左面</th></tr>' + ks.map(k => `
      <tr><td><input type="checkbox" data-k="${esc(k.key)}" class="kvis" ${k.opt.visible ? 'checked' : ''}></td>
      <td><input type="color" data-k="${esc(k.key)}" class="kcol" value="${k.opt.color}" style="width:28px;height:20px;padding:0;border:none"></td>
      <td>${esc(k.key)}${k.dup ? ' <span class="warn" style="color:var(--warn)">同じ面が重複</span>' : ''}</td>
      <td>${k.R ? '✓' : '<span style="color:var(--warn)">なし</span>'}</td>
      <td>${k.L ? '✓' : '<span style="color:var(--warn)">なし</span>'}</td></tr>`).join('') + '</table>';
    el.querySelectorAll('.kvis').forEach(cb => cb.onchange = () => { state.knifeOpts[cb.dataset.k].visible = cb.checked; refreshPlots(); });
    el.querySelectorAll('.kcol').forEach(cb => cb.oninput = () => { state.knifeOpts[cb.dataset.k].color = cb.value; refreshPlots(); });
  }

  function renderFileList() {
    const el = $('fileList');
    if (!state.files.length) { el.innerHTML = ''; return; }
    el.innerHTML = state.files.map(f => `
      <div class="file ${f.id === state.selectedId ? 'sel' : ''}" data-id="${f.id}">
        <div class="row"><span class="name">${esc(f.name)}</span><span class="sp" style="flex:1"></span>
          <button class="small" data-act="sel">確認</button><button class="small" data-act="del">削除</button></div>
        <div class="row">
          <label class="muted">包丁名</label><input type="text" class="key" value="${esc(f.key)}">
          <label class="muted">面</label><select class="side"><option value="R" ${f.side === 'R' ? 'selected' : ''}>右面</option><option value="L" ${f.side === 'L' ? 'selected' : ''}>左面</option></select>
          <label class="muted"><input type="checkbox" class="inv" ${f.invertZ ? 'checked' : ''}>Z反転</label>
          <label class="muted" title="刃先側から峰側へ測定したデータの場合にチェック"><input type="checkbox" class="rev" ${f.reverseX ? 'checked' : ''}>刃先→峰</label>
        </div>
        <div class="row">
          <label class="muted">刃先X</label>
          <button class="small" data-act="minus">−</button>
          <input type="number" class="tip" step="0.0001" value="${f.tipX.toFixed(4)}">
          <button class="small" data-act="plus">＋</button> <span class="muted">mm</span>
          <button class="small" data-act="auto">自動</button>
          <span class="muted">${f.tipX === f.autoTipX ? '(自動検出)' : `(自動: ${f.autoTipX.toFixed(4)}, 差 ${((f.tipX - f.autoTipX) * 1000).toFixed(1)} µm)`}</span>
        </div>
        ${f.found ? '' : '<div class="warn">刃先の急変点が見つからず、データ終端を刃先にしています。手動で調整してください。</div>'}
        <div class="muted">${f.prof.x.length.toLocaleString()} 点, X ${f.prof.x[0].toFixed(3)}〜${f.prof.x[f.prof.x.length - 1].toFixed(3)} mm${f.prof.meta.DateTime ? ' / 測定 ' + esc(f.prof.meta.DateTime) : ''}</div>
      </div>`).join('');

    el.querySelectorAll('.file').forEach(div => {
      const f = state.files.find(v => v.id === +div.dataset.id);
      const q = s => div.querySelector(s);
      q('.key').onchange = e => { f.key = e.target.value.trim() || f.key; refreshAll(); };
      q('.side').onchange = e => { f.side = e.target.value; refreshAll(); };
      q('.inv').onchange = e => { f.invertZ = e.target.checked; refreshPlots(); };
      q('.rev').onchange = e => { f.reverseX = e.target.checked; detect(f); refreshAll(); };
      q('.tip').onchange = e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setTip(f, v); };
      div.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => {
        const step = parseFloat($('nudgeStep').value);
        switch (b.dataset.act) {
          case 'sel': state.selectedId = f.id; refreshAll(); break;
          case 'del':
            state.files = state.files.filter(v => v !== f);
            if (state.selectedId === f.id) state.selectedId = state.files[0] ? state.files[0].id : null;
            refreshAll(); break;
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

  function sectionTraces(ks) {
    const traces = [];
    for (const k of ks) {
      if (!k.opt.visible) continue;
      for (const side of ['R', 'L']) {
        const p = k.sec[side];
        if (!p) continue;
        const d = C.decimate(p, 20000, 0.3);
        traces.push({
          type: 'scattergl', mode: 'lines', x: d.x, y: d.z,
          name: `${k.key} ${side === 'R' ? '右面' : '左面'}`, legendgroup: k.key,
          line: { color: k.opt.color, width: 1.5, dash: side === 'L' ? 'dash' : 'solid' },
          hovertemplate: `${esc(k.key)} ${side === 'R' ? '右面' : '左面'}<br>X=%{x:.4f} mm<br>Z=%{y:.4f} mm<extra></extra>`,
        });
      }
    }
    traces.push({ type: 'scatter', mode: 'markers', x: [0], y: [0], name: '刃先', showlegend: false,
      marker: { color: '#000', size: 7, symbol: 'x' }, hovertemplate: '刃先 (0, 0)<extra></extra>' });
    return traces;
  }

  function renderSection(ks) {
    const el = $('plotSection');
    const vis = ks.filter(k => k.opt.visible && (k.sec.R || k.sec.L));
    if (!vis.length) { Plotly.purge(el); el.innerHTML = '<div class="empty">ファイルを読み込むとここに断面が表示されます</div>'; return; }
    if (el.querySelector('.empty')) el.innerHTML = '';

    let xmin = 0, zmin = 0, zmax = 0;
    for (const k of vis) for (const p of [k.sec.R, k.sec.L]) if (p && p.x.length) {
      xmin = Math.min(xmin, p.x[0]);
    }
    const R = state.range > 0 ? state.range : -xmin;
    for (const k of vis) for (const p of [k.sec.R, k.sec.L]) if (p) {
      for (let i = 0; i < p.x.length; i++) if (p.x[i] >= -R) { zmin = Math.min(zmin, p.z[i]); zmax = Math.max(zmax, p.z[i]); }
    }
    const padX = R * 0.04;
    const padZ = Math.max((zmax - zmin) * 0.1, R * 0.002);
    const layout = {
      margin: { l: 70, r: 20, t: 10, b: 50 },
      xaxis: { title: { text: '刃先からの位置 X [mm]（峰側 ← → 刃先）' }, range: [-R - padX, padX], zeroline: true, zerolinecolor: '#999', exponentformat: 'none' },
      yaxis: { title: { text: 'Z [mm]（上: 右面 / 下: 左面）' }, range: [zmin - padZ, zmax + padZ], zeroline: true, zerolinecolor: '#999', exponentformat: 'none' },
      legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0 },
      hovermode: 'closest', dragmode: 'zoom', uirevision: null,
    };
    if (state.scale > 0) {
      layout.yaxis.scaleanchor = 'x';
      layout.yaxis.scaleratio = state.scale;
      layout.yaxis.constrain = 'domain';
      layout.xaxis.constrain = 'domain';
    }
    if (state.scale !== 1 && state.scale > 0) {
      layout.annotations = [{ text: `厚み方向 ×${state.scale} 拡大表示`, xref: 'paper', yref: 'paper', x: 1, y: 0, xanchor: 'right', yanchor: 'bottom', showarrow: false, font: { color: '#b45309' } }];
    }
    Plotly.react(el, sectionTraces(ks), layout, plotCfg);
  }

  function renderThickness(ks) {
    const table = $('thickTable');
    const ds = distances();
    const pairs = ks.filter(k => k.opt.visible && k.sec.R && k.sec.L);
    if (!pairs.length) {
      table.innerHTML = '<div class="muted">右面と左面がそろった包丁がありません</div>';
      Plotly.purge($('plotThick'));
      return;
    }
    let h = '<table><tr><th class="num">距離 [mm]</th>' + pairs.map(k =>
      `<th class="num"><span class="swatch" style="background:${k.opt.color}"></span> ${esc(k.key)}<br>厚み [mm]</th><th class="num">刃角 [°]</th>`).join('') + '</tr>';
    for (const d of ds) {
      h += `<tr><td class="num">${d}</td>` + pairs.map(k => {
        const t = C.thicknessAt(k.sec, d), a = C.includedAngle(k.sec, d);
        return `<td class="num">${Number.isFinite(t) ? t.toFixed(4) : '—'}</td><td class="num">${Number.isFinite(a) ? a.toFixed(2) : '—'}</td>`;
      }).join('') + '</tr>';
    }
    table.innerHTML = h + '</table>';

    const log = $('thickLog').checked;
    const traces = pairs.map(k => {
      const maxD = Math.min(-k.sec.R.x[0], -k.sec.L.x[0]);
      const xs = [], ys = [];
      const N = 600;
      for (let i = 0; i <= N; i++) {
        const d = log ? Math.pow(10, Math.log10(0.001) + (Math.log10(maxD) - Math.log10(0.001)) * i / N) : maxD * i / N;
        const t = C.thicknessAt(k.sec, d);
        if (Number.isFinite(t)) { xs.push(d); ys.push(t); }
      }
      return { type: 'scatter', mode: 'lines', x: xs, y: ys, name: k.key, line: { color: k.opt.color, width: 2 },
        hovertemplate: `${esc(k.key)}<br>距離 %{x:.4f} mm<br>厚み %{y:.4f} mm<extra></extra>` };
    });
    Plotly.react($('plotThick'), traces, {
      margin: { l: 70, r: 20, t: 10, b: 50 },
      xaxis: { title: { text: '刃先からの距離 [mm]' }, type: log ? 'log' : 'linear', exponentformat: 'none' },
      yaxis: { title: { text: '厚み [mm]' }, type: log ? 'log' : 'linear', exponentformat: 'none' },
      legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0 }, hovermode: 'x unified',
    }, plotCfg);
  }

  function renderTipPlot() {
    const el = $('plotTip');
    const f = state.files.find(v => v.id === state.selectedId);
    if (!f) { Plotly.purge(el); $('tipInfo').textContent = 'ファイル欄の「確認」を押すと表示。グラフ上をクリックするとその位置を刃先に設定します。'; return; }
    const W = parseFloat($('tipWin').value);
    const { x, z } = f.prof;
    const xs = [], zs = [];
    for (let i = 0; i < x.length; i++) if (x[i] >= f.tipX - W && x[i] <= f.tipX + W) { xs.push(x[i]); zs.push(z[i]); }
    const zt = C.interp(x, z, f.tipX);
    $('tipInfo').textContent = `${f.name}（${f.side === 'R' ? '右面' : '左面'}）刃先 X = ${f.tipX.toFixed(4)} mm, Z = ${zt.toFixed(4)} mm ／ グラフをクリックでその位置を刃先に設定`;
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
        const cur = state.files.find(v => v.id === state.selectedId);
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

  function baseName() {
    const ks = knives().filter(k => k.opt.visible);
    return ks.map(k => k.key).join('_') || 'danmen';
  }

  $('pngSection').onclick = () => Plotly.downloadImage($('plotSection'), { format: 'png', scale: 2, filename: baseName() + '_断面' });
  $('pngThick').onclick = () => Plotly.downloadImage($('plotThick'), { format: 'png', scale: 2, filename: baseName() + '_厚み' });

  $('csvTable').onclick = () => {
    const pairs = knives().filter(k => k.opt.visible && k.sec.R && k.sec.L);
    if (!pairs.length) return alert('右面と左面がそろった包丁がありません');
    const rows = [['距離[mm]', ...pairs.flatMap(k => [`${k.key} 厚み[mm]`, `${k.key} 刃角[°]`])]];
    for (const d of distances()) rows.push([d, ...pairs.flatMap(k => [C.thicknessAt(k.sec, d).toFixed(5), C.includedAngle(k.sec, d).toFixed(3)])]);
    download(baseName() + '_厚み表.csv', rows.map(r => r.join(',')).join('\r\n'));
  };

  $('csvData').onclick = () => {
    const ks = knives().filter(k => k.opt.visible && (k.sec.R || k.sec.L));
    if (!ks.length) return alert('データがありません');
    const pitch = parseFloat($('csvPitch').value) || 0.001;
    for (const k of ks) {
      const maxD = Math.max(k.sec.R ? -k.sec.R.x[0] : 0, k.sec.L ? -k.sec.L.x[0] : 0);
      const lines = ['X[mm],右面Z[mm],左面Z[mm],厚み[mm]'];
      const n = Math.floor(maxD / pitch + 1e-9);
      for (let i = n; i >= 0; i--) {
        const u = -i * pitch;
        const r = k.sec.R ? C.interp(k.sec.R.x, k.sec.R.z, u) : NaN;
        const l = k.sec.L ? C.interp(k.sec.L.x, k.sec.L.z, u) : NaN;
        const f = v => Number.isFinite(v) ? v.toFixed(6) : '';
        lines.push([u.toFixed(6), f(r), f(l), f(r - l)].join(','));
      }
      download(`${k.key}_合成断面.csv`, lines.join('\r\n'));
    }
  };

  // ---------- イベント ----------

  const dz = $('dropzone'), fi = $('fileInput');
  dz.onclick = () => fi.click();
  fi.onchange = () => { loadFiles([...fi.files]); fi.value = ''; };
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files.length) loadFiles([...e.dataTransfer.files]);
  });

  function toggleGroup(groupId, attr, setter) {
    $(groupId).querySelectorAll('button').forEach(b => b.onclick = () => {
      $(groupId).querySelectorAll('button').forEach(o => o.classList.toggle('on', o === b));
      setter(parseFloat(b.dataset[attr]));
      renderSection(knives());
    });
  }
  toggleGroup('scaleBtns', 's', v => state.scale = v);
  toggleGroup('rangeBtns', 'r', v => state.range = v);

  $('clearAll').onclick = () => { if (confirm('読み込んだファイルを全て削除しますか？')) { state.files = []; state.knifeOpts = {}; state.selectedId = null; refreshAll(); } };
  $('redetectAll').onclick = () => { state.files.forEach(detect); refreshAll(); };
  $('levelOn').onchange = refreshPlots;
  $('levelLen').onchange = refreshPlots;
  $('distInput').onchange = () => renderThickness(knives());
  $('thickLog').onchange = () => renderThickness(knives());
  $('tipWin').onchange = renderTipPlot;
})();
