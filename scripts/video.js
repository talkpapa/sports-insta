/* video.js — 카드 3장을 세로 영상 하나로 잇는다. (ffmpeg)
 *
 *   node scripts/video.js --probe    이 컴퓨터에 ffmpeg 이 있는지 확인
 *   node scripts/video.js            _demo/ 의 카드로 시험 영상을 만든다
 *
 * ── 왜 영상인가 ──────────────────────────────────────────
 * 인스타에서 모르는 사람에게 퍼지는 창구는 릴스뿐이다. 낱장 카드는 이미
 * 팔로우한 사람에게만 보인다. 팔로워 0에서 시작하니 릴스여야 한다.
 *
 * ── 소리에 대해 ──────────────────────────────────────────
 * 인스타 API 로는 트렌딩 오디오를 붙일 수 없다. 붙는 것은 MP4 안에 든 소리뿐이다.
 * 그래서 assets/audio/ 에 자유 이용 음원을 넣어두면 그것을 깔고,
 * 없으면 무음 트랙을 넣는다 — 소리 트랙이 아예 없는 영상은 일부 기기에서
 * 재생이 어긋나므로, 무음이라도 넣어 두는 편이 안전하다.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { ROOT, config, log } = require('./lib/util.js');

const W = 1080, H = 1920, FPS = 30;

/** ffmpeg 을 부르고 끝날 때까지 기다린다 */
function run(args, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          /* ffmpeg 은 진행 상황도 stderr 로 쏟는다. 마지막 몇 줄만 보여준다. */
          const tail = String(stderr || err.message).trim().split('\n').slice(-6).join('\n');
          return reject(new Error(tail));
        }
        resolve(stderr);
      });
  });
}

/** ffmpeg 이 있는지 */
async function hasFfmpeg() {
  try { await run(['-version'], 10000); return true; } catch { return false; }
}

/** assets/audio/ 에서 음원 하나를 고른다. 없으면 null. */
function pickAudio(seed = 0) {
  const dir = path.join(ROOT, 'assets', 'audio');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => /\.(mp3|m4a|aac|wav)$/i.test(f)).sort();
  if (!files.length) return null;
  /* 날마다 다른 곡이 걸리게 한다. 같은 소리가 계속 나오면 금방 질린다. */
  return path.join(dir, files[Math.abs(seed) % files.length]);
}

/**
 * 카드 이미지들을 영상 하나로 잇는다.
 * @param {string[]} cardPaths  카드 PNG 경로 (순서대로)
 * @param {string} outPath      만들 MP4 경로
 * @param {object} opts         { secondsPerCard, secondsLastCard, fade, audio, motion }
 */
async function makeVideo(cardPaths, outPath, opts = {}) {
  if (!cardPaths.length) throw new Error('카드가 없습니다.');

  const per   = Math.max(2.5, Number(opts.secondsPerCard) || 4);
  const fade  = Math.min(0.8, Math.max(0, Number(opts.fade ?? 0.5)));
  const motion = opts.motion !== false;
  const n = cardPaths.length;

  /* 마지막 카드는 더 오래 둘 수 있다.
   * 앞 두 장은 제목과 질문이라 한눈에 읽히지만, 마지막 장에는 두세 문장짜리 답이
   * 들어간다. 같은 시간을 주면 다 못 읽고 넘어간다. */
  const last = Math.max(per, Number(opts.secondsLastCard) || per);
  const durs = cardPaths.map((_, i) => (i === n - 1 ? last : per));

  /* 총 길이 — 카드가 이어질 때 겹치는 만큼(fade) 짧아진다.
   * 인스타 릴스는 3초 이상이어야 한다. */
  const total = durs.reduce((a, b) => a + b, 0) - fade * (n - 1);
  if (total < 3) throw new Error(`영상이 너무 짧습니다 (${total.toFixed(1)}초). 카드당 시간을 늘리십시오.`);

  const args = ['-y'];
  cardPaths.forEach((p, i) => args.push('-loop', '1', '-t', String(durs[i]), '-i', p));

  const audio = opts.audio || null;
  if (audio) args.push('-stream_loop', '-1', '-i', audio);      // 짧은 곡이면 이어 붙여 채운다
  else args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=44100:cl=stereo');

  /* ── 화면 만들기 ──
   * 카드는 이미 1080×1920 이라 크기는 맞다. 다만 가만히 있는 그림이 12초 이어지면
   * 손가락이 먼저 넘어간다. 그래서 아주 천천히 밀어 넣는 확대를 준다.
   * zoompan 은 프레임 단위로 도므로 d 에 프레임 수를 넣는다. */
  const parts = [];
  for (let i = 0; i < n; i++) {
    const frames = Math.round(durs[i] * FPS);
    /* 오래 머무는 카드는 더 천천히 당긴다 — 같은 속도로 두면 끝에서 너무 커진다. */
    const step = (0.08 / frames).toFixed(6);
    const zoom = motion
      /* 1.0 에서 1.08 까지. 이보다 크면 글자가 화면 밖으로 밀린다. */
      ? `,zoompan=z='min(zoom+${step},1.08)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`
      : `,fps=${FPS}`;
    parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1${zoom},format=yuv420p[v${i}]`);
  }

  /* 카드 사이를 겹쳐 넘긴다. 툭 끊기면 아마추어로 보인다. */
  let prev = 'v0';
  let elapsed = 0;
  for (let i = 1; i < n; i++) {
    /* 앞 카드들이 실제로 머문 시간에서, 이미 겹친 만큼을 뺀 자리에서 넘긴다.
     * 카드마다 길이가 다르므로 곱셈이 아니라 누적으로 계산해야 한다. */
    elapsed += durs[i - 1];
    const offset = elapsed - fade * i;
    const out = i === n - 1 ? 'vout' : `x${i}`;
    parts.push(`[${prev}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}[${out}]`);
    prev = out;
  }
  if (n === 1) parts.push('[v0]null[vout]');

  /* 소리는 앞뒤를 부드럽게 —  갑자기 시작하고 뚝 끊기면 귀에 거슬린다. */
  const aIdx = n;
  parts.push(`[${aIdx}:a]atrim=0:${total.toFixed(3)},asetpts=N/SR/TB,afade=t=in:st=0:d=0.4,afade=t=out:st=${(total - 0.6).toFixed(3)}:d=0.6[aout]`);

  args.push(
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-t', total.toFixed(3),
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-movflags', '+faststart',                 // 첫 프레임이 빨리 뜬다
    outPath,
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await run(args);

  const size = fs.statSync(outPath).size;
  return { path: outPath, seconds: total, bytes: size, hasAudio: Boolean(audio) };
}

/* ── 직접 실행 ─────────────────────────────────────── */
if (require.main === module) {
  (async () => {
    if (process.argv.includes('--probe')) {
      const ok = await hasFfmpeg();
      log.step(ok ? 'ffmpeg 있음 — 영상을 만들 수 있습니다.' : 'ffmpeg 없음');
      if (!ok) {
        console.log('');
        console.log('  이 컴퓨터에는 없어도 됩니다. 영상은 GitHub 서버에서 만들어지고,');
        console.log('  거기에는 ffmpeg 이 기본으로 깔려 있습니다.');
        console.log('');
        console.log('  로컬에서도 시험하고 싶으시면:  winget install Gyan.FFmpeg');
      }
      const a = pickAudio();
      log.info(a ? `음원: ${path.basename(a)}` : '음원 없음 — 무음으로 만듭니다 (assets/audio/ 에 넣으면 깔립니다)');
      return;
    }

    if (!await hasFfmpeg()) {
      log.fail('ffmpeg 이 없습니다. "node scripts/video.js --probe" 를 보십시오.');
      process.exit(1);
    }

    const demo = path.join(ROOT, '_demo');
    const cards = fs.existsSync(demo)
      ? fs.readdirSync(demo).filter(f => /^\d+\.png$/.test(f)).sort().map(f => path.join(demo, f))
      : [];
    if (!cards.length) { log.fail('_demo/ 에 카드가 없습니다. 먼저 "node scripts/render.js" 를 돌리십시오.'); process.exit(2); }

    const cfg = config();
    log.step(`영상 만드는 중 · 카드 ${cards.length}장`);
    const r = await makeVideo(cards, path.join(demo, 'reel.mp4'), {
      secondsPerCard: cfg.video?.secondsPerCard,
      secondsLastCard: cfg.video?.secondsLastCard,
      fade: cfg.video?.fade,
      motion: cfg.video?.motion,
      audio: pickAudio(),
    });
    log.ok(`_demo/reel.mp4 · ${r.seconds.toFixed(1)}초 · ${(r.bytes / 1024 / 1024).toFixed(1)}MB · 소리 ${r.hasAudio ? '있음' : '무음'}`);
  })().catch(e => { log.fail(e.message); process.exit(1); });
}

module.exports = { makeVideo, hasFfmpeg, pickAudio, W, H, FPS };
