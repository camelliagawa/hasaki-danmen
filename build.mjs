// src/ と vendor/ をまとめて単体HTML（オフライン動作）を生成する
//   使い方: node build.mjs  →  hasaki-danmen.html
import { readFileSync, writeFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const script = s => `<script>\n${s.replace(/<\/script/gi, '<\\/script')}\n</script>`;

const html = read('./src/app.html').replace('<!-- INLINE_SCRIPTS -->', () => [
  script(read('./vendor/plotly.min.js')),
  script(read('./src/core.js')),
  script(read('./src/app.js')),
].join('\n'));

writeFileSync(new URL('./hasaki-danmen.html', import.meta.url), html);
console.log('hasaki-danmen.html を生成しました');
