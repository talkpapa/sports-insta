/* watchdog.js — GitHub 예약 실행이 안 걸린 날을 사람 대신 알아채고 깨운다.
 *
 *   node scripts/watchdog.js            확인만 하고 필요하면 깨운다
 *   node scripts/watchdog.js --dry      확인만 하고 아무것도 깨우지 않는다
 *
 * ── 왜 필요한가 ─────────────────────────────────────────
 * GitHub 의 예약 실행(cron)은 약속이 아니라 "여유가 있으면 돌려주겠다"는 것이다.
 * 실제로 겪은 것:
 *   8월 27일 — 하루 종일 어떤 워크플로도 안 돌았다. 0편.
 *   8월 28일 — 세 자리 중 한 자리가 통째로 건너뛰어졌다. 2편.
 * 워크플로는 전부 active 였고 수동 실행은 즉시 됐다. 설정 문제가 아니라
 * GitHub 쪽 사정이라, cron 시각을 아무리 손봐도 고쳐지지 않는다.
 *
 * 반면 이 PC 의 작업 스케줄러는 매일 정확히 돈다. 그래서 이쪽을 감시자로 쓴다.
 *
 * ── 왜 이렇게 해도 안전한가 ─────────────────────────────
 * 게시 워크플로는 여러 번 깨워도 넘치지 않는다. 이미 있는 안전장치가 막는다.
 *   · 하루 한도(perDay)를 넘으면 중단
 *   · 같은 슬롯을 두 번 올리지 않는다
 *   · 직전 게시와 minGapHours 안이면 중단
 *   · verify 가 통과해야만 게시한다
 * 그래서 감시자는 판단을 최소로만 한다 — "오늘 몫이 남았는가"만 보고 깨운다.
 * 진짜 판단은 서버가 한다.
 *
 * ── 토큰 ────────────────────────────────────────────────
 * GitHub 토큰을 따로 저장하지 않는다. git 이 이미 윈도 자격 증명 관리자에
 * 갖고 있는 것을 실행할 때 꺼내 쓰고 바로 버린다.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const { ROOT, config, tzDate, loadState, log } = require('./lib/util.js');
const { nextPendingDay, pendingSlots } = require('./lib/queue.js');

const DRY = process.argv.includes('--dry');
const REPO = 'talkpapa/sports-insta';

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 120000, ...opts });
}

/** 윈도 자격 증명 관리자에서 GitHub 토큰을 꺼낸다. 못 꺼내면 빈 문자열. */
function githubToken() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
      input: 'protocol=https\nhost=github.com\n\n',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const m = out.match(/^password=(.+)$/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

/** 워크플로 하나를 깨운다 */
async function dispatch(token, file) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (r.status !== 204) throw new Error(`${file} 깨우기 실패 — HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
}

async function main() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 3;
  const minGap = cfg.publish?.minGapHours ?? 1.5;

  /* 서버가 커밋해 둔 최신 상태를 받아온다. 이걸 안 하면 어제 기록을 보고 판단한다. */
  try { git(['pull', '--rebase', '--autostash', '-q', 'origin', 'main']); }
  catch (e) { log.warn('git pull 실패 — 있는 것으로 판단합니다: ' + String(e.message).split('\n')[0]); }

  const st = loadState();
  const postedToday = (st.posted_log || []).filter(p => p.date === today && !p.deleted).length;
  const pend = nextPendingDay(today);

  log.step(`감시 · ${today} · 게시 ${postedToday}/${perDay}편 · 남은 큐 ${pend.files.length}편`);

  const todo = [];

  /* ① 오늘 릴스를 아직 안 만들었으면 빌드를 깨운다.
   *    빌드에도 "이미 만들어 뒀으면 그대로 둔다"는 장치가 있어 두 번 돌아도 안전하다. */
  if (!pendingSlots(today).length && postedToday < perDay) {
    todo.push({ file: 'build.yml', why: `오늘 큐가 없습니다` });
  }

  /* ② 올릴 것이 남아 있고 간격도 찼으면 게시를 깨운다. */
  if (pend.files.length && postedToday < perDay) {
    const last = (st.posted_log || []).filter(p => !p.deleted).slice(-1)[0];
    const hours = last ? (Date.now() - new Date(last.at).getTime()) / 3600000 : 99;
    if (hours >= minGap) {
      todo.push({ file: 'post.yml', why: `남은 ${pend.files.length}편 · 직전 게시 ${hours.toFixed(1)}시간 전` });
    } else {
      log.info(`직전 게시가 ${hours.toFixed(1)}시간 전입니다 (${minGap}시간 규칙) — 기다립니다.`);
    }
  }

  if (!todo.length) {
    log.ok('할 일 없음 — 서버가 알아서 하고 있습니다.');
    return;
  }

  if (DRY) {
    todo.forEach(t => log.info(`[--dry] ${t.file} 을 깨울 상황입니다 — ${t.why}`));
    return;
  }

  const token = githubToken();
  if (!token) {
    log.fail('GitHub 토큰을 못 찾았습니다. 이 PC 에서 한 번이라도 git push 를 하셨는지 확인하십시오.');
    process.exit(1);
  }

  for (const t of todo) {
    await dispatch(token, t.file);
    log.ok(`${t.file} 깨웠습니다 — ${t.why}`);
  }
}

if (require.main === module) {
  main().catch(e => { log.fail(e.message); process.exit(1); });
}

module.exports = { githubToken };
