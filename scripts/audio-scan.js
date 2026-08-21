/* audio-scan.js — 곡마다 "가사가 가장 적은 구간"을 찾아 적어둔다.
 *
 *   node scripts/audio-scan.js
 *
 * 결과는 assets/audio/segments.json 에 저장되고, video.js 가 그것을 읽어
 * 그 자리에서 소리를 시작한다.
 *
 * ── 어떻게 찾는가 ────────────────────────────────────────
 * 노래를 부르는 목소리는 거의 언제나 가운데에 놓인다 (좌우 채널에 똑같이).
 * 반주는 좌우로 넓게 퍼진다. 그래서 두 가지를 재서 견준다.
 *
 *   가운데(mid)  = (L+R)/2   — 목소리가 여기 몰린다
 *   양옆(side)   = (L−R)/2   — 목소리는 여기서 거의 사라진다
 *
 * 둘 다 사람 목소리가 들어 있는 300~3400Hz 만 남기고 잰다. 베이스와 킥드럼은
 * 300Hz 아래라 이 단계에서 빠지므로, 가운데에 있어도 목소리로 오해되지 않는다.
 *
 *   노래하는 구간 → 가운데가 양옆보다 훨씬 크다
 *   반주만 있는 구간 → 둘이 비슷하다
 *
 * 이 차이를 1초 단위로 재서, 차이가 가장 작은 구간을 고른다.
 *
 * ── 한계 ─────────────────────────────────────────────────
 * 이것은 소리의 세기를 견주는 것이지 가사를 알아듣는 것이 아니다.
 * 가운데에 놓인 신디사이저나 리드기타는 목소리처럼 보일 수 있고,
 * 좌우로 벌려 녹음한 코러스는 놓칠 수 있다. 곡에 반주만 나오는 구간이
 * 아예 없으면, "그나마 가장 적은" 자리가 뽑힐 뿐이다.
 * 그래서 곡마다 점수를 같이 남긴다 — 점수가 높으면 사람이 들어봐야 한다.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { ROOT, config, log } = require('./lib/util.js');

const DIR = path.join(ROOT, 'assets', 'audio');
const OUT = path.join(DIR, 'segments.json');

/* 사람 목소리가 실리는 대역. 이 바깥은 견줘도 뜻이 없다. */
const LO = 300, HI = 3400;

/** ffmpeg 을 부르고 stderr 를 통째로 돌려준다 (ametadata 가 여기로 찍는다) */
function run(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(err) : resolve(String(stderr || '') + String(stdout || ''))));
  });
}

function probeSeconds(file) {
  return new Promise(resolve => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1', file], { timeout: 20000 },
      (err, stdout) => resolve(err ? 0 : Number(String(stdout).trim()) || 0));
  });
}

/**
 * 한 채널 조합의 세기를 1초 단위로 잰다.
 * @param {string} pan  ffmpeg pan 식. mid 또는 side 를 만든다.
 * @returns {Promise<number[]>} 초마다의 dB. 소리가 없으면 -90.
 */
async function levels(file, pan) {
  const out = await run(['-v', 'error', '-i', file, '-af',
    `${pan},highpass=f=${LO},lowpass=f=${HI},astats=metadata=1:reset=1,` +
    'ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-']);

  /* frame 줄에서 시각을, 그 다음 줄에서 세기를 읽는다 */
  const sec = [];
  let t = 0;
  for (const line of out.split('\n')) {
    const m = line.match(/pts_time:([0-9.]+)/);
    if (m) { t = Number(m[1]); continue; }
    const v = line.match(/RMS_level=(-?[0-9.]+|-inf)/);
    if (!v) continue;
    const db = v[1] === '-inf' ? -90 : Number(v[1]);
    const i = Math.floor(t);
    (sec[i] || (sec[i] = [])).push(db);
  }
  /* dB 는 로그라 그냥 더하면 안 된다. 세기로 되돌려 평균 내고 다시 dB 로. */
  return sec.map(list => {
    if (!list || !list.length) return -90;
    const p = list.reduce((a, d) => a + Math.pow(10, d / 10), 0) / list.length;
    return Math.max(-90, 10 * Math.log10(p));
  });
}

/**
 * 곡 하나에서 가장 반주다운 구간을 찾는다.
 * @returns {{start:number, score:number, best:number, worst:number}}
 */
async function scan(file, windowSec) {
  const mid = await levels(file, 'pan=mono|c0=0.5*c0+0.5*c1');
  const side = await levels(file, 'pan=mono|c0=0.5*c0-0.5*c1');
  const n = Math.min(mid.length, side.length);
  if (n < windowSec + 2) return null;

  /* 초마다의 "목소리다움"과 "전체 세기" */
  const voice = [];
  const loud = [];
  for (let i = 0; i < n; i++) {
    const L = 10 * Math.log10(Math.pow(10, mid[i] / 10) + Math.pow(10, side[i] / 10));
    loud.push(L);
    /* 통째로 조용한 자리는 뽑히면 안 된다 — 무음 구간이 점수는 가장 좋게 나온다. */
    voice.push(L < -45 ? 999 : mid[i] - side[i]);
  }

  /* 이 곡이 보통 얼마나 큰가. 뒤에서 "유난히 조용한 자리"를 가려내는 기준이 된다. */
  const sorted = loud.filter(v => v > -45).slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : -20;

  const avgDb = (from, len) => {
    let p = 0;
    for (let i = from; i < from + len; i++) p += Math.pow(10, (loud[i] ?? -90) / 10);
    return 10 * Math.log10(p / len);
  };

  /* 창을 밀어 가며 가장 좋은 자리를 찾는다.
   * 맨 끝 8초는 아예 보지 않는다 — 곡이 끝나며 사라지는 자리가 잡히기 쉽다. */
  const limit = Math.max(0, n - windowSec - 8);
  const half = Math.floor(windowSec / 2);

  /* 페이드아웃과 유난히 조용한 자리는 벌점이 아니라 조건으로 걸러낸다.
   *
   * 처음에는 점수에 더하는 벌점으로 만들었는데, 벌점이 목소리 점수를 눌러버려
   * 오히려 노래가 또렷한 자리가 뽑혔다 (한 곡은 4.2dB → 7.8dB 로 나빠졌다).
   * 쓸 만한 자리만 남긴 다음, 그 안에서는 오로지 목소리가 적은 쪽을 고른다. */
  const MAX_DROP = 4;      // 창 앞뒤로 이만큼 넘게 줄면 페이드아웃으로 본다
  const MAX_BELOW = 8;     // 곡 평소 세기보다 이만큼 넘게 조용하면 버린다

  let start = 0, best = Infinity, bestVoice = 0, picked = false;
  let sum = 0;
  for (let i = 0; i < windowSec; i++) sum += voice[i];

  /* 조건에 맞는 자리가 하나도 없을 수 있다 (통째로 페이드인 곡 등).
   * 그때를 위해 조건 없이 고른 자리도 같이 들고 간다. */
  let loose = 0, looseBest = Infinity;

  for (let i = 0; i <= limit; i++) {
    if (i > 0) sum += voice[i + windowSec - 1] - voice[i - 1];
    const v = sum / windowSec;

    if (v < looseBest) { looseBest = v; loose = i; }

    const drop = avgDb(i, half) - avgDb(i + windowSec - half, half);
    const below = median - avgDb(i, windowSec);
    if (drop > MAX_DROP || below > MAX_BELOW) continue;

    if (v < best) { best = v; start = i; bestVoice = v; picked = true; }
  }

  if (!picked) { start = loose; bestVoice = looseBest; }

  const all = voice.filter(v => v !== 999);
  const worst = all.length ? Math.max(...all) : 0;
  return {
    start,
    score: Number(bestVoice.toFixed(1)),      // 목소리다움만. 판단은 이 숫자로 한다
    worst: Number(worst.toFixed(1)),
  };
}

async function main() {
  const cfg = config();
  const per = Number(cfg.video?.secondsPerCard) || 5;
  const lastCard = Number(cfg.video?.secondsLastCard) || per;
  const fade = Number(cfg.video?.fade ?? 0.5);
  /* 영상 길이만큼만 있으면 된다. 카드 3장 기준. */
  const need = Math.ceil(per * 2 + lastCard - fade * 2);

  if (!fs.existsSync(DIR)) { log.fail('assets/audio/ 가 없습니다.'); process.exit(1); }
  const files = fs.readdirSync(DIR).filter(f => /\.(mp3|m4a|aac|wav)$/i.test(f)).sort();
  if (!files.length) { log.fail('음원이 없습니다.'); process.exit(1); }

  log.step(`가사 없는 구간 찾기 · ${files.length}곡 · ${need}초씩`);

  const out = {};
  let failed = 0;
  for (const f of files) {
    const full = path.join(DIR, f);
    const dur = await probeSeconds(full);
    let r = null;
    try {
      r = await scan(full, need);
      if (!r) log.warn(`${f} — 건너뜀 (${Math.round(dur)}초라 ${need}초를 못 뽑습니다)`);
    } catch (e) {
      log.warn(`${f} — 분석 실패: ${e.message.split('\n')[0]}`);
      failed++;
    }
    if (!r) continue;
    out[f] = { start: r.start, score: r.score };

    /* 점수는 "가운데가 양옆보다 몇 dB 큰가". 낮을수록 반주에 가깝다. */
    const mark = r.score < 3 ? '✅ 반주' : r.score < 6 ? '△ 옅은 노래' : '⚠ 노래 있음';
    log.info(`${f.padEnd(30)} ${String(r.start).padStart(3)}초부터 · ${String(r.score).padStart(5)}dB ${mark}` +
      `  (곡 전체 최고 ${r.worst}dB, 길이 ${Math.round(dur)}초)`);
  }

  /* 한 곡도 못 읽었으면 덮어쓰지 않는다 — ffmpeg 이 없어서 전부 실패한 것을
   * "가사 없는 구간이 없다"로 기록해 버리면 다음 빌드가 조용히 엉뚱하게 돈다. */
  if (!Object.keys(out).length) {
    log.fail(`한 곡도 분석하지 못했습니다 (실패 ${failed}건). segments.json 을 그대로 둡니다.`);
    if (failed) log.info('ffmpeg 이 PATH 에 있는지 확인하십시오.');
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  log.ok(`assets/audio/segments.json 에 ${Object.keys(out).length}곡 저장`);
  console.log('');
  console.log('  ⚠ 표시가 붙은 곡은 반주만 나오는 구간이 없다는 뜻입니다.');
  console.log('  숫자는 세기를 견준 것이지 가사를 알아들은 것이 아니므로,');
  console.log('  실제로 들어보시고 이상하면 그 곡은 폴더에서 빼십시오.');
}

if (require.main === module) {
  main().catch(e => { log.fail(e.message); process.exit(1); });
}

module.exports = { scan, levels };
