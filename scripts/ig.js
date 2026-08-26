/* ig.js — 인스타그램에 릴스를 올린다. (Instagram API with Instagram Login v23.0)
 *
 *   node scripts/ig.js status     계정·최근 게시·오늘 진행 상황
 *   node scripts/ig.js check      기록한 게시물이 실제로 계정에 있는지 대조
 *   node scripts/ig.js queue      다음 슬롯 하나를 게시한다 (자동 운전용)
 *   node scripts/ig.js refresh    토큰 60일 연장
 *
 * 원칙
 *  - 본인 계정에 올리는 것만 한다. 남의 계정 자동 좋아요·팔로우는 정책 위반이라
 *    계정이 정지된다. 이 파일에는 그런 기능이 아예 없다.
 *  - 게시는 API 로 삭제할 수 없다. 올리기 전에 스스로 멈출 이유를 먼저 찾는다.
 *  - 한 번 돌 때 한 편만 올린다. 몰아서 쏟으면 서로의 도달을 깎고 스팸으로 보인다.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, config, env, tzDate, loadState, saveState, sleep, log } = require('./lib/util.js');
const { nextSlot, pendingSlots, markDone } = require('./lib/queue.js');

const API = 'https://graph.instagram.com/v23.0';

function token() {
  const t = env().IG_TOKEN;
  if (!t) {
    log.fail('IG_TOKEN 이 없습니다.');
    console.error('   로컬: .env 파일에 IG_TOKEN=... 을 넣으십시오');
    console.error('   서버: 저장소 Settings → Secrets → Actions 에 IG_TOKEN 을 넣으십시오');
    process.exit(1);
  }
  return t;
}

async function api(pathname, params = {}, method = 'GET') {
  const TOKEN = token();
  const u = new URL(API + pathname);
  const opt = { method };
  if (method === 'GET') {
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    u.searchParams.set('access_token', TOKEN);
  } else {
    opt.body = new URLSearchParams({ ...params, access_token: TOKEN });
    opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  }
  const r = await fetch(u, opt);
  const j = await r.json();
  if (j.error) throw new Error(`${j.error.code || ''} ${j.error.message}`);
  return j;
}

/* ── 상태 보기 ───────────────────────────────────── */
async function cmdStatus() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 3;

  const me = await api('/me', { fields: 'username,account_type,media_count' });
  log.step(`계정 ${me.username} (${me.account_type}) · 게시물 ${me.media_count}개`);

  const st = loadState();
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  log.info(`오늘 ${today} · 게시 ${postedToday}/${perDay}편 · 남은 큐 ${pendingSlots(today).length}편`);

  const media = await api('/me/media', { fields: 'id,permalink,timestamp,media_type', limit: 1 });
  const last = media.data?.[0];
  if (last) {
    const h = (Date.now() - new Date(last.timestamp).getTime()) / 3600000;
    const gap = cfg.publish?.minGapHours ?? 1.5;
    log.info(`최근 게시 ${last.timestamp.slice(0, 16).replace('T', ' ')} (${h.toFixed(1)}시간 전, ${last.media_type})`);
    log.info(last.permalink);
    console.log(h < gap ? `  ⛔ ${gap}시간 규칙에 걸린다` : `  ✅ ${gap}시간 규칙 통과`);
  }
  if (st.token_expires_around) log.info(`토큰 만료 예상 ${st.token_expires_around}`);
}

/* ── 기록과 실제 계정을 대조한다 ────────────────────
 *
 * state.json 은 "우리 코드가 올렸다고 여기는 것"이지 "실제로 계정에 있는 것"이
 * 아니다. 게시 도중 워크플로가 죽거나, 올라간 뒤 인스타가 내렸거나, 사람이
 * 지웠으면 둘이 어긋난다. 무인으로 도는 파이프라인에서는 아무도 알아채지 못한다.
 *
 * 밖에서는 확인할 방법이 없다. 로그인하지 않고 릴스 주소를 열면 인스타가 껍데기만
 * 돌려주는데, 없는 주소도 똑같이 200 이고 크기까지 거의 같다. 그래서 계정에 묻는다.
 *
 *   node scripts/ig.js check        최근 7일
 *   node scripts/ig.js check 30     최근 30일
 */
async function cmdCheck() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const days = Math.max(1, Math.min(90, Number(process.argv[3]) || 7));
  const since = tzDate(-(days - 1), tz);

  const me = await api('/me', { fields: 'username,account_type,media_count' });
  log.step(`${me.username} · 게시물 ${me.media_count}개 · 최근 ${days}일 대조`);

  /* 계정에 실제로 있는 것 */
  const live = new Map();
  let next = null;
  for (let page = 0; page < 5; page++) {
    const j = next
      ? await (await fetch(next)).json()
      : await api('/me/media', { fields: 'id,permalink,timestamp,media_type', limit: 50 });
    for (const m of j.data || []) live.set(String(m.id), m);
    next = j.paging?.next;
    if (!next) break;
  }

  /* 우리가 올렸다고 기록해 둔 것.
   *
   * 사람이 인스타에서 지운 것은 빼고 본다. 기록에서 지우지는 않는다 — 무엇이
   * 언제 나갔는지는 남아 있어야 한다. 다만 지운 줄 아는 것을 매일 밤 빨간 ❌ 로
   * 띄우면 그 표시가 무뎌지고, 정작 진짜로 어긋난 날을 지나치게 된다. */
  const st = loadState();
  const inWindow = (st.posted_log || []).filter(p => (p.date || '') >= since);
  const removed = inWindow.filter(p => p.deleted);
  const mine = inWindow.filter(p => !p.deleted);

  let ok = 0;
  const missing = [];
  for (const p of mine) {
    const hit = live.get(String(p.media_id));
    if (hit) {
      ok++;
      log.ok(`${p.date} 슬롯${p.slot} · ${hit.media_type} · ${hit.permalink}`);
    } else {
      missing.push(p);
      log.fail(`${p.date} 슬롯${p.slot} · 계정에 없습니다 — ${p.permalink}`);
    }
  }

  /* 계정에는 있는데 기록에 없는 것 — 손으로 올렸거나 옛 판이 올린 것 */
  const known = new Set(inWindow.map(p => String(p.media_id)));
  const extra = [...live.values()]
    .filter(m => m.timestamp.slice(0, 10) >= since && !known.has(m.id));

  /* 만들어 두고 아무도 안 가져간 큐가 남아 있는가.
   *
   * 게시가 검사에 걸리면 그 편만 건너뛰고 워크플로는 초록불로 끝난다. 한 편을
   * 거르는 것 자체는 옳지만, 같은 이유로 매번 걸리면 큐가 영영 안 빠지는데도
   * 아무도 모른다. 실제로 캡션 검사의 오탐 하나 때문에 두 편이 하루를 통째로
   * 흘려보냈다. 어제 것이 아직 남아 있으면 그건 이미 놓친 것이다. */
  const qRoot = path.join(ROOT, 'queue');
  const stale = [];
  if (fs.existsSync(qRoot)) {
    for (const d of fs.readdirSync(qRoot)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= tzDate(0, tz)) continue;
      const left = fs.readdirSync(path.join(qRoot, d)).filter(f => f.endsWith('.md'));
      if (left.length) stale.push(`${d} ${left.length}편`);
    }
  }

  console.log('');
  if (removed.length) log.info(`지운 것 ${removed.length}편은 세지 않았습니다`);
  if (stale.length) {
    log.fail(`나가지 못하고 남은 큐: ${stale.join(', ')}`);
    console.log('     게시 로그에서 검사에 걸린 항목을 보십시오.');
  }
  log.step(`기록 ${mine.length}편 중 ${ok}편 확인` + (missing.length ? ` · ${missing.length}편 없음` : ''));
  if (extra.length) {
    log.warn(`기록에 없는 게시물 ${extra.length}개`);
    extra.forEach(m => console.log(`     ${m.timestamp.slice(0, 16).replace('T', ' ')} · ${m.permalink}`));
  }
  if (missing.length || stale.length) process.exit(1);
}

/* ── 컨테이너가 다 익을 때까지 기다린다 ──────────────
 * 영상은 사진과 달리 인스타가 받아서 인코딩까지 해야 한다. 오래 걸린다.
 * 사진은 몇 초면 끝나지만 영상은 1분 넘게 걸리는 일이 흔하다. */
async function waitFinished(id, what) {
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const s = await api(`/${id}`, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR') throw new Error(`${what} 실패: ${s.status || ''}`);
    if (i % 10 === 9) log.info(`${what} 처리 중… (${(i + 1) * 3}초)`);
  }
  throw new Error(`${what} 이 3분 안에 끝나지 않았습니다 (영상 규격을 확인하십시오)`);
}

/* ── 게시 ────────────────────────────────────────── */
async function publishReel(meta, caption) {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  /* 기록에 남길 날짜는 큐가 속한 날. 안 주면 오늘. */
  const today = meta.day || tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 3;
  const minGap = cfg.publish?.minGapHours ?? 1.5;
  const st = loadState();

  /* 안전장치 ① 오늘 몫을 다 썼으면 중단 */
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  if (postedToday >= perDay) {
    log.fail(`오늘 이미 ${postedToday}편 올렸습니다 (한도 ${perDay}편). 중단합니다.`);
    process.exit(1);
  }

  /* 안전장치 ② 같은 슬롯을 두 번 올리지 않는다 */
  if ((st.posted_log || []).some(p => p.date === today && p.slot === meta.slot)) {
    log.fail(`슬롯 ${meta.slot} 은 이미 올라갔습니다. 중단합니다.`);
    process.exit(1);
  }

  /* 안전장치 ③ 직전 게시와 너무 붙어 있으면 중단 */
  const recent = await api('/me/media', { fields: 'timestamp', limit: 1 });
  const last = recent.data?.[0];
  if (last) {
    const h = (Date.now() - new Date(last.timestamp).getTime()) / 3600000;
    if (h < minGap) {
      log.fail(`최근 게시가 ${h.toFixed(1)}시간 전입니다 (${minGap}시간 규칙). 중단합니다.`);
      process.exit(1);
    }
  }

  log.step(`릴스 게시 · 슬롯 ${meta.slot} · ${meta.seconds}초 · 캡션 ${caption.length}자`);

  /* ① 컨테이너 만들기 */
  const params = {
    media_type: 'REELS',
    video_url: meta.video,
    caption,
    share_to_feed: 'true',        // 피드에도 보이게 — 도달이 늘어난다
  };
  if (meta.cover) params.cover_url = meta.cover;

  const c = await api('/me/media', params, 'POST');
  log.info(`컨테이너 ${c.id} — 인스타가 영상을 받아 인코딩하는 중`);

  /* ② 다 익을 때까지 */
  await waitFinished(c.id, '영상');

  /* ③ 발행 */
  const pub = await api('/me/media_publish', { creation_id: c.id }, 'POST');
  const info = await api(`/${pub.id}`, { fields: 'permalink' });
  log.ok(`게시 완료 ${info.permalink}`);

  st.posted_log = st.posted_log || [];
  st.posted_log.push({
    date: today, slot: meta.slot,
    media_id: pub.id, permalink: info.permalink,
    seconds: Number(meta.seconds || 0),
    source: meta.source || '',
    title: meta.source_title || '',
    at: new Date().toISOString(),
  });
  saveState(st);
  return info.permalink;
}

/* ── 오늘 큐에서 다음 한 편 ───────────────────────── */
async function cmdQueue() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 3;

  const st = loadState();
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  if (postedToday >= perDay) { log.info(`오늘 ${postedToday}/${perDay}편 완료 — 게시 생략.`); return; }

  /* 오늘 것이 없으면 어제 것까지 본다 (자정을 넘겨 도는 날이 있다) */
  const s = nextSlot(today, tzDate(-1, tz));
  if (!s) { log.info(`남은 큐가 없습니다 — 게시 생략.`); return; }
  if (!s.meta.video || !s.caption) throw new Error(`슬롯 ${s.slot} 에 영상 또는 캡션이 없습니다.`);
  if (s.day !== today) log.info(`${s.day} 에서 넘어온 슬롯 ${s.slot} 을 올립니다.`);

  /* 게시 기록은 큐가 속한 날짜로 남긴다. 자정을 넘겨 나간 어제 몫을 오늘로 세면
   * 오늘 몫이 한 칸 줄고, 빌드의 슬롯 번호도 어긋난다. */
  await publishReel({ ...s.meta, slot: s.slot, day: s.day }, s.caption);

  markDone(s.day, s.file);
  log.ok(`queue/_done/${s.day}/${s.slot}.md 로 옮겼습니다.`);
  log.info(`남은 큐 ${pendingSlots(s.day).length}편`);
}

/* ── 토큰 연장 ───────────────────────────────────── */
async function cmdRefresh() {
  const fs = require('fs');
  const path = require('path');
  const { ROOT } = require('./lib/util.js');

  const r = await fetch(`${API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token()}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);

  const days = Math.round((j.expires_in || 0) / 86400);
  const until = new Date(Date.now() + (j.expires_in || 0) * 1000).toISOString().slice(0, 10);

  const st = loadState();
  st.token_expires_around = until;
  saveState(st);

  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath) && !process.env.IG_TOKEN) {
    const cur = fs.readFileSync(envPath, 'utf8');
    fs.writeFileSync(envPath, cur.match(/^IG_TOKEN=/m)
      ? cur.replace(/^IG_TOKEN=.*$/m, 'IG_TOKEN=' + j.access_token)
      : cur.trimEnd() + '\nIG_TOKEN=' + j.access_token + '\n', 'utf8');
    log.ok(`.env 갱신 · 만료 예상 ${until} (${days}일 후)`);
  } else {
    log.ok(`토큰 연장됨 · 만료 예상 ${until} (${days}일 후)`);
    log.warn('서버는 시크릿을 자동으로 못 바꿉니다. 아래 토큰을 IG_TOKEN 시크릿에 넣으십시오:');
    console.log('\n' + j.access_token + '\n');
  }
}

/* ── 실행 ────────────────────────────────────────── */
const cmd = process.argv[2];
const run = { status: cmdStatus, check: cmdCheck, queue: cmdQueue, refresh: cmdRefresh }[cmd];
if (!run) {
  console.log('사용법: node scripts/ig.js <status|check|queue|refresh>');
  process.exit(1);
}
run().catch(e => { log.fail(e.message); process.exit(1); });
