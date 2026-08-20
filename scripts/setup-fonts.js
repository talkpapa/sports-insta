/* setup-fonts.js — 카드에 쓸 서체를 내려받는다.
 *
 * 서체 파일은 저장소에 넣지 않는다. 대신 로컬에서든 GitHub Actions 에서든
 * 쓰기 직전에 한 번 받아 assets/fonts/ 에 둔다. 이미 있으면 건너뛴다.
 * 전부 OFL(자유 라이선스)이라 상업 게시물에 써도 문제가 없다.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'fonts');

const FONTS = [
  /* 영문 제목 — 굵고 좁아 점수·팀명이 시원하게 들어간다 */
  { file: 'Anton-Regular.ttf',        url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf' },
  /* 한글 제목 — 포스터 메이커의 '굵은 고딕'과 같은 서체 */
  { file: 'BlackHanSans-Regular.ttf', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/blackhansans/BlackHanSans-Regular.ttf' },
  /* 본문·표 — 포스터 메이커가 쓰는 Pretendard. 한글과 숫자가 한 서체라
   * 순위표에서 팀명과 숫자의 높이가 어긋나지 않는다.
   * 가변 서체는 그리는 쪽에서 굵기 축이 먹지 않아 굵기별 정적 파일로 받는다. */
  { file: 'Pretendard-Bold.otf',      url: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Bold.otf' },
  { file: 'Pretendard-Medium.otf',    url: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Medium.otf' },
];

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of FONTS) {
    const dest = path.join(DIR, f.file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) { console.log(`  이미 있음 ${f.file}`); continue; }
    process.stdout.write(`  받는 중 ${f.file} ... `);
    const r = await fetch(f.url);
    if (!r.ok) throw new Error(`${f.file} 내려받기 실패 (HTTP ${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 10000) throw new Error(`${f.file} 가 너무 작습니다 — 주소가 바뀐 듯합니다`);
    fs.writeFileSync(dest, buf);
    console.log(`${(buf.length / 1024 / 1024).toFixed(1)}MB`);
  }
  console.log('서체 준비 완료');
}

main().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
