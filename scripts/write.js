/* write.js — 뉴스 한 건을 릴스 원고로 바꾼다. (Google Gemini)
 *
 *   node scripts/write.js --demo     가짜 뉴스로 시험
 *   node scripts/write.js --models   내 키로 쓸 수 있는 모델 목록
 *
 * 헤드라인 3장, 캡션, 해시태그, 사진 검색어를 한 번에 받는다.
 *
 * ── 왜 기사를 옮기지 않는가 ──────────────────────────────
 * 기사 문장은 남의 글이다. 그대로 옮기면 저작권 문제고, 조금 바꿔 써도 마찬가지다.
 * 그래서 RSS 로 받은 제목과 두어 줄 요약만 보고 "무슨 일이 있었나"를 파악한 뒤,
 * 문장은 처음부터 새로 쓰게 한다. 사실은 남의 것이 아니지만 문장은 남의 것이다.
 *
 * ── 왜 SDK 를 안 쓰는가 ──────────────────────────────────
 * 호출이 한 군데뿐이라 fetch 로 충분하다. 꾸러미를 하나 더 얹으면
 * 그것이 바뀔 때마다 파이프라인이 흔들린다. 의존성은 적을수록 오래 간다.
 */
const { config, env, getJSON, log } = require('./lib/util.js');

const API = 'https://generativelanguage.googleapis.com/v1beta';

/* 모델은 자주 바뀐다. config 에서 고칠 수 있게 하고, 기본값은 무료 등급에서
 * 가장 흔히 열려 있는 flash 계열로 둔다. 안 되면 --models 로 확인해 고치면 된다. */
const DEFAULT_MODEL = 'gemini-2.5-flash';

/* 받아올 형태를 못 박는다. 무인 파이프라인이라 답 모양이 흔들리면 뒤가 다 무너진다. */
const SCHEMA = {
  type: 'object',
  properties: {
    skip: { type: 'boolean', description: '카드뉴스로 만들면 안 되는 소재이거나 내용이 너무 빈약하면 true' },
    skip_reason: { type: 'string', description: 'skip 이 true 일 때의 이유. 아니면 빈 문자열' },
    tag: { type: 'string', description: '카드 오른쪽 위 라벨. 영어 대문자 1~3단어. 이적 계정이므로 이적 관련으로. 예: TRANSFER EXPLAINED, DEAL BREAKDOWN, FEE STRUCTURE, TALKS STALLED, RUMOUR CHECK' },
    slides: {
      type: 'array',
      description:
        '정확히 3장이며 세 장의 역할이 서로 다르다. ' +
        '1장 = 눈길을 잡는 큰 제목. ' +
        '2장 = 상황을 깔아주고 던지는 질문. ' +
        '3장 = 그 질문에 대한 구체적인 답.',
      items: {
        type: 'object',
        properties: {
          headline: { type: 'string', description: '카드에 아주 크게 들어가는 영어 문구. 1장 2~5단어, 2장은 물음표로 끝나는 4~8단어, 3장 2~5단어. 마침표 없이' },
          subhead:  { type: 'string', description: '헤드라인 아래 받쳐주는 영어. 1장 12단어 이내 한 줄, 2장 20단어 이내(질문의 배경), 3장 35~55단어(질문에 대한 자세한 답, 2~3문장)' },
        },
        required: ['headline', 'subhead'],
      },
    },
    caption: { type: 'string', description: '인스타 캡션. 첫 줄은 125자 안의 훅. 이모지로 시작하는 3문단으로, 카드가 못 담은 배경과 숫자를 더 풀어 쓴다(나중에 다시 보려고 저장할 만한 내용이어야 한다). 마지막에 질문 한 줄. 해시태그는 넣지 않는다' },
    hashtags: { type: 'array', description: '10~15개. # 없이 낱말만. 영어. 이적 관련(transfernews, transferwindow 등)과 등장하는 구단·선수를 섞는다', items: { type: 'string' } },
    photo_query: { type: 'string', description: '무료 스톡 사진 검색어. 영어 2~4단어. 실존 인물·구단 로고가 아니라 축구 장면. 예: empty football stadium, football boots grass' },
    alt_text: { type: 'string', description: '접근성용 대체 텍스트. 사진에 무엇이 보이는지 영어 한 문장' },
  },
  required: ['skip', 'skip_reason', 'tag', 'slides', 'caption', 'hashtags', 'photo_query', 'alt_text'],
};

const SYSTEM = `You write Instagram carousel scripts for a football transfer account.

Every post is about the football transfer market: deals, fees, contracts, loans,
negotiations. Turn a news headline and short summary into a three-card story a
reader finishes in about 18 seconds.

YOUR JOB IS TO EXPLAIN, NOT TO REPORT.

A reader can get "Club A signed Player B" anywhere, from the club itself, faster than
from us. What they cannot get quickly is WHY it happened and what it means. So never
stop at the event. Every post must answer a "why" or a "how":

  - why this club needs this player right now
  - why the fee is that number, and how it is structured
  - why the selling club agreed, or refused
  - why the deal collapsed, stalled, or suddenly moved
  - what it unlocks next — who leaves, who arrives, what budget is freed

If the source contains no explanation anywhere in it, set skip=true. A card that only
restates the headline is worth nothing.

The three cards have different jobs. Do not write three variations of the same thing.

  Card 1 — THE HOOK.
    headline: the single most striking fact, 2-5 words, huge display type.
    subhead:  one short line that frames it. Under 12 words.

  Card 2 — THE QUESTION.
    headline: a "why" or "how" question ending in "?", 4-8 words. It must be the
              question a reader would actually ask after card 1. Strongly prefer
              openings like "Why", "How", "What made", "Who pays". Never ask a
              yes/no question, and never ask something the source cannot answer.
    subhead:  the setup the question needs — the situation behind it. Under 20 words.

  Card 3 — THE ANSWER.
    headline: the reason in 2-5 words. Blunt and concrete.
    subhead:  the explanation, 35-55 words across 2-3 full sentences. Give the
              mechanics: the numbers, the contract situation, the squad gap it fills,
              what happens next. A reader who saw only this card should come away
              understanding something they did not know before.

Card 2's question must be genuinely answered by card 3. Never end on "time will tell"
or "we'll find out soon" — that is the opposite of the job.

Hard rules:
- Write everything from scratch. Never copy or lightly reword the source's sentences.
- State only what the source supports. If a detail isn't in the input, leave it out.
  Never invent scores, quotes, dates, transfer fees, or medical details.
- Separate fact from rumour. Transfer coverage is full of unconfirmed reports. If the
  source says "sources say", "reportedly", "is understood to", "linked with" or similar,
  your cards must carry the same hedge — "reports say", "according to sources". Never
  upgrade a rumour into a completed deal. Getting this wrong destroys the account's
  credibility faster than anything else.
- If the source is thin, write a shorter, plainer story rather than padding it with invention.
- Set skip=true for deaths, serious injuries with lasting harm, crime, lawsuits, or
  anything where a punchy card would read as callous. Also skip if the input is too
  thin to explain anything honestly.
- photo_query must be chosen from this exact list, and nothing else:
    "empty football stadium"    "football pitch"        "football boots grass"
    "soccer ball grass"         "football stadium seats" "goal net close up"
    "football training ground"
  These are the only queries the free photo libraries reliably answer. Anything else —
  "stadium tunnel", "empty locker room", "corner flag close up" — returns nothing and
  the whole story gets dropped. Pick whichever of the seven best suits the story.
  Never name a person, team, or logo.

Style:
- Card headlines are display type: short, no period, strong nouns and verbs.
- The caption's first line decides whether anyone reads on. Make it the specific
  surprising thing, not a category label.
- Plain, confident English. No hype words like SHOCKING or "you won't believe".
- Write for someone who already follows football. Use the real vocabulary —
  release clause, add-ons, sell-on fee, amortisation, free agent, buy-back —
  and explain a term only when the story turns on it.`;

function apiKey() {
  const key = env().GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY 가 없습니다.\n' +
      '   https://aistudio.google.com/apikey 에서 무료로 받아\n' +
      '   .env 파일 또는 저장소 시크릿에 넣으십시오.');
  }
  return key;
}

/** 이 키로 쓸 수 있는 모델을 물어본다. 모델 이름이 바뀌었을 때 확인용. */
async function listModels() {
  const j = await getJSON(`${API}/models`, { headers: { 'x-goog-api-key': apiKey() } });
  return (j.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => ({
      id: (m.name || '').replace(/^models\//, ''),
      display: m.displayName || '',
      inputLimit: m.inputTokenLimit || 0,
    }));
}

/**
 * 뉴스 한 건 → 릴스 원고
 * @param {{title:string, summary:string, source:string}} item
 */
async function writeScript(item) {
  const cfg = config();

  /* 무료 등급 한도는 모델마다 따로 걸린다 (하루 20건씩).
   * 그래서 하나가 막히면 다음 모델로 넘어간다 — 모델 넷을 쓰면
   * 사실상 하루 80건이 된다. 품질이 좋은 순서로 늘어놓는다. */
  const models = [
    cfg.write?.model || DEFAULT_MODEL,
    ...(cfg.write?.fallbacks || []),
  ].filter((m, i, a) => m && a.indexOf(m) === i);

  let lastErr;
  for (const model of models) {
    try { return await askModel(model, item); }
    catch (e) {
      lastErr = e;
      /* 하루 한도에 걸린 것이면 다음 모델로. 그 밖의 오류는 모델을 바꿔도 같으므로 멈춘다. */
      if (!/일일 한도|429/.test(e.message)) throw e;
      log.warn(`${model} 한도 소진 — 다음 모델로`);
    }
  }
  throw lastErr;
}

async function askModel(model, item) {
  /* 본문이 있으면 같이 넘긴다. 요약만으로는 "왜 그런가"가 담기지 않아서,
   * 설명형으로 바꾼 뒤 여섯 건 중 넷이 "설명할 재료가 없다"며 건너뛰어졌다.
   * 본문은 사실을 파악하는 데만 쓰고, 문장은 여전히 처음부터 새로 쓴다. */
  const input = [
    `Source: ${item.source}`,
    `Headline: ${item.title}`,
    item.summary ? `Summary: ${item.summary}` : '',
    item.body ? `\nFull article (facts only — never reuse its sentences):\n${item.body}` : '',
  ].filter(Boolean).join('\n');

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: input }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      maxOutputTokens: 4000,
    },
  };

  /* ── 몇 번 다시 해본다 ────────────────────────────────
   * Gemini 는 503(과부하)과 429(한도)를 심심찮게 낸다. 무인으로 도는
   * 파이프라인에서 한 번 실패했다고 그 소재를 버리면 하루치가 반토막 난다.
   * 실제로 시험할 때 세 건 중 두 건이 503 이었다.
   * 잘못된 요청(4xx)은 다시 해도 같으므로 바로 포기한다. */
  let r, lastDetail = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(s => setTimeout(s, 2000 * attempt));   // 2초, 4초, 6초

    r = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(body),
    });
    if (r.ok) break;

    lastDetail = await r.text();
    /* 429 는 두 종류다. 분당 한도는 잠깐 기다리면 풀리지만,
     * 하루 한도는 기다려도 안 풀린다. 후자면 재시도가 시간 낭비이므로
     * 바로 표시를 남기고 빠져나가 다음 모델로 넘어가게 한다. */
    const perDay = /PerDay|per day/i.test(lastDetail);
    if (perDay) { lastDetail = '일일 한도 소진 ' + lastDetail; break; }
    const retryable = r.status === 429 || r.status >= 500;
    if (!retryable) break;
    log.info(`Gemini ${r.status} — 다시 시도 (${attempt + 1}/3)`);
  }

  if (!r.ok) {
    /* 모델 이름이 바뀌는 일이 잦다. 그때 무슨 일인지 바로 알 수 있게 안내를 붙인다. */
    const hint = r.status === 404
      ? `\n   모델 "${model}" 을 못 찾았습니다. "node scripts/write.js --models" 로 목록을 보고\n   config.json 의 write.model 을 고치십시오.`
      : /일일 한도/.test(lastDetail)
        ? '\n   이 모델의 하루 무료 한도를 다 썼습니다.'
      : r.status === 429
        ? '\n   무료 등급 한도에 걸렸습니다. 잠시 뒤 다시 시도하십시오.'
        : r.status >= 500
          ? '\n   Gemini 쪽 일시 장애입니다. 세 번 다시 해봤지만 계속 실패했습니다.'
          : '';
    throw new Error(`Gemini HTTP ${r.status}${hint}\n   ${lastDetail.slice(0, 300)}`);
  }

  const j = await r.json();
  const cand = j.candidates?.[0];

  if (!cand) throw new Error('응답에 후보가 없습니다 — ' + JSON.stringify(j).slice(0, 200));
  if (cand.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) {
    throw new Error(`모델이 생성을 멈췄습니다 (${cand.finishReason})`);
  }

  const text = (cand.content?.parts || []).map(p => p.text).filter(Boolean).join('');
  if (!text) throw new Error('응답에 본문이 없습니다.');

  let plan;
  try { plan = JSON.parse(text); }
  catch { throw new Error('JSON 을 읽지 못했습니다 — ' + text.slice(0, 200)); }

  /* 형태는 스키마가 잡아주지만 내용이 비는 것은 못 잡는다. 여기서 한 번 더 본다. */
  if (!plan.skip) {
    if (!Array.isArray(plan.slides) || plan.slides.length !== 3) {
      throw new Error(`슬라이드가 3장이 아닙니다 (${plan.slides?.length ?? 0}장)`);
    }
    if (plan.slides.some(s => !s.headline?.trim())) throw new Error('빈 헤드라인이 있습니다.');

    /* 세 장의 역할이 지켜졌는지 본다. 모델이 가끔 세 장을 비슷하게 써 놓는다.
     * 물음표가 없으면 질문 카드가 아니고, 3장이 짧으면 답이 아니라 또 다른 제목이다. */
    const q = plan.slides[1];
    if (!/\?/.test(q.headline)) q.headline = q.headline.replace(/[.!]*$/, '') + '?';
    const a = plan.slides[2];
    const answerWords = String(a.subhead || '').trim().split(/\s+/).filter(Boolean).length;
    if (answerWords < 20) throw new Error(`3장 답이 너무 짧습니다 (${answerWords}단어) — 이 소재는 넘깁니다`);
    if (!plan.caption?.trim()) throw new Error('캡션이 비었습니다.');
    if (!plan.photo_query?.trim()) throw new Error('사진 검색어가 비었습니다.');
  }

  plan._model = model;
  plan._usage = j.usageMetadata || {};
  return plan;
}

/* ── 직접 실행 ─────────────────────────────────────── */
if (require.main === module) {
  (async () => {
    if (process.argv.includes('--models')) {
      log.step('이 키로 쓸 수 있는 모델');
      const list = await listModels();
      list.forEach(m => console.log(`  ${m.id.padEnd(34)} ${m.display}`));
      log.info(`${list.length}개`);
      return;
    }

    const { collectNews } = require('./news.js');
    let item;
    if (process.argv.includes('--demo')) {
      item = {
        source: 'Demo',
        title: 'Alcaraz to make US Open comeback after wrist injury',
        summary: 'Carlos Alcaraz will return from a wrist injury at the US Open as he seeks to defend his title.',
      };
    } else {
      const news = await collectNews(1);
      if (!news.length) { log.fail('뉴스를 못 받았습니다.'); process.exit(2); }
      item = news[0];
    }

    log.step(`원고 작성 · ${item.title}`);
    const plan = await writeScript(item);
    if (plan.skip) { log.warn(`건너뜀 — ${plan.skip_reason}`); return; }

    console.log('');
    console.log('태그  :', plan.tag);
    plan.slides.forEach((s, i) => {
      console.log(`카드${i + 1} : ${s.headline}`);
      console.log(`        ${s.subhead}`);
    });
    console.log('사진  :', plan.photo_query);
    console.log('');
    console.log('─'.repeat(52));
    console.log(plan.caption);
    console.log('─'.repeat(52));
    console.log('#' + plan.hashtags.join(' #'));
    console.log('');
    log.info(`모델 ${plan._model} · 토큰 ${plan._usage.totalTokenCount ?? '?'}`);
  })().catch(e => { log.fail(e.message); process.exit(1); });
}

module.exports = { writeScript, listModels, SCHEMA, DEFAULT_MODEL };
