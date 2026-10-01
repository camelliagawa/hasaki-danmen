// src/ と vendor/ をまとめて単体HTML（オフライン動作）を生成する
//   使い方: node build.mjs  →  hasaki-danmen.html
import { readFileSync, writeFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const script = s => `<script>\n${s.replace(/<\/script/gi, '<\\/script')}\n</script>`;

// 最終更新日時（日本時間）を画面上部に表示
const buildDate = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16);

const html = read('./src/app.html').replace('__BUILD_DATE__', buildDate).replace('<!-- INLINE_SCRIPTS -->', () => [
  script(read('./vendor/plotly.min.js')),
  script(read('./src/core.js')),
  script(read('./src/app.js')),
].join('\n'));

writeFileSync(new URL('./hasaki-danmen.html', import.meta.url), html);
console.log('hasaki-danmen.html を生成しました');
