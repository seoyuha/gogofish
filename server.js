// GO GO FISH — 6학년 영어 11·12단원 고피시 게임 서버
// 학생: /    교사: /teacher
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const CARDS = require('./cards');

const PORT = process.env.PORT || 3000;
const SPEED = Number(process.env.GF_SPEED || 1); // 테스트용(평소에는 1)
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

const PUB = path.join(__dirname, 'public');
app.use(express.static(PUB));
app.get('/teacher', (req, res) => res.sendFile(path.join(PUB, 'teacher.html')));
app.get('/api/cards', (req, res) => {
  const images = {};
  try {
    for (const f of fs.readdirSync(path.join(PUB, 'cards'))) {
      const m = f.match(/^([a-z0-9_-]+)\.(png|jpe?g|webp|gif|svg)$/i);
      if (m && CARDS.ALL[m[1]]) images[m[1]] = 'cards/' + f;
    }
  } catch (e) { /* 폴더 없음 */ }
  res.json({ cards: CARDS.ALL, images });
});

// ───────── 설정값 ─────────
const T = {
  INTRO: 6000,      // 새 모둠 소개 화면
  ASK: 40000,       // 내 차례: 카드·친구 고르기 + 문장 고르기
  REPLY: 15000,     // 대답하기
  PAUSE: 2300,      // 결과 보여 주는 잠깐의 멈춤
  RESULT: 15000,    // 게임 끝 → 대기실까지
  GATHER_QUIET: 4000, // 대기실에 새로 들어오는 사람이 4초 동안 없으면 배정
  GATHER_MAX: 12000,  // 계속 들어와도 12초 안에는 배정
};
const AVATARS = ['🐟', '🐠', '🐡', '🐙', '🦀'];
const MAX_SAME_PREV = 2;
// ───────── 반 랭킹 점수 (여기서 바꾸면 돼요) ─────────
const SCORE = { book: 10, ask: 2, reply: 1, win: 5, play: 1 };
function addScore(room, p, n) {
  if (!p || !n) return;
  p.stats.score += n;
  if (room) room.gain[p.pid] = (room.gain[p.pid] || 0) + n;
}
function ranking(cls) {
  const list = [...cls.players.values()].filter(p => !p.bot)
    .sort((a, b) => b.stats.score - a.stats.score || b.stats.books - a.stats.books || b.stats.wins - a.stats.wins || a.name.localeCompare(b.name, 'ko', { numeric: true }));
  let rank = 0, prev = null;
  return list.map((p, i) => {
    const key = p.stats.score + '/' + p.stats.books + '/' + p.stats.wins;
    if (key !== prev) { rank = i + 1; prev = key; }
    return { pid: p.pid, name: p.name, rank, score: p.stats.score, books: p.stats.books, wins: p.stats.wins, games: p.stats.games, connected: p.connected };
  });
} // 전 방에서 같이 있던 친구는 새 방에 최대 2명까지(=3명 이상 모이지 않게)

const classes = new Map();
const tokens = new Map(); // token → player

function now() { return Date.now(); }
function rid() { return crypto.randomBytes(9).toString('base64url'); }
function normCode(c) { return String(c || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 12); }
function cleanName(n) { return String(n || '').replace(/[<>]/g, '').trim().slice(0, 12); }

function getClass(code) {
  code = normCode(code);
  if (!code) return null;
  let c = classes.get(code);
  if (!c) {
    c = {
      code,
      settings: { unit: '11', minutes: 7, auto: true },
      players: new Map(),
      rooms: new Map(),
      roomSeq: 0,
      gatherSince: 0,
      lastWaitChange: 0,
      lobbyMsg: 'few',
      history: [],
      botSeq: 0,
    };
    classes.set(code, c);
  }
  return c;
}

function newPlayer(cls, name, bot = false) {
  const p = {
    pid: rid(), token: rid() + rid(), name, code: cls.code, sid: null, connected: !bot, bot,
    state: 'waiting', roomId: null, prevRoomId: null, prevRoomNum: null, partners: {},
    waitingSince: now(), resultEnds: 0,
    stats: { games: 0, wins: 0, books: 0, asks: 0, askOk: 0, replies: 0, replyOk: 0, score: 0 },
  };
  cls.players.set(p.pid, p);
  tokens.set(p.token, p);
  cls.lastWaitChange = now();
  return p;
}

// ───────── 자동 모둠 배정 ─────────
// 규칙: 3~5명. 바로 전 방에서 함께였던 사람은 한 방에 최대 2명(3명 이상 다시 모이지 않음).
function scoreGroups(groups) {
  let placed = 0, viol = 0, repeat = 0, shape = 0;
  for (const g of groups) {
    placed += g.length;
    const byPrev = {};
    for (const p of g) if (p.prevRoomId) byPrev[p.prevRoomId] = (byPrev[p.prevRoomId] || 0) + 1;
    for (const k in byPrev) viol += Math.max(0, byPrev[k] - MAX_SAME_PREV);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) repeat += (g[i].partners[g[j].pid] || 0);
    shape += Math.abs(g.length - 4);
  }
  return { placed, viol, repeat, shape };
}

function better(a, b, allowViol) {
  if (!b) return true;
  if (!allowViol && a.viol > 0) return false;
  if (a.placed !== b.placed) return a.placed > b.placed;
  if (a.viol !== b.viol) return a.viol < b.viol;
  // 같이 해 본 횟수 + 모둠 크기(4명에 가까울수록 좋음)
  return a.repeat + a.shape * 3 < b.repeat + b.shape * 3;
}

function partition(list, allowViol) {
  const n = list.length;
  if (n < 3) return [];
  let best = null, bestGroups = [];
  const maxK = Math.floor(n / 3);
  for (let k = maxK; k >= 1; k--) {
    const take = Math.min(n, 5 * k);
    const sizes = Array.from({ length: k }, (_, i) => Math.floor(take / k) + (i < take % k ? 1 : 0));
    for (let attempt = 0; attempt < 80; attempt++) {
      // 같은 전 방 사람이 많은 순서로, 무작위 섞어서 배치
      const buckets = {};
      for (const p of CARDS.shuffle([...list])) (buckets[p.prevRoomId || ('new-' + p.pid)] ||= []).push(p);
      const order = Object.values(buckets).sort((a, b) => b.length - a.length + (Math.random() - 0.5) * 0.5).flat();
      // 오래 기다린 사람 우선: 살짝 앞으로
      const groups = sizes.map(() => []);
      const unplaced = [];
      for (const p of order) {
        let cand = [];
        for (let gi = 0; gi < k; gi++) {
          const g = groups[gi];
          if (g.length >= sizes[gi]) continue;
          const same = p.prevRoomId ? g.filter(q => q.prevRoomId === p.prevRoomId).length : 0;
          if (!allowViol && same >= MAX_SAME_PREV) continue;
          const rep = g.reduce((s, q) => s + (p.partners[q.pid] || 0), 0);
          cand.push({ gi, key: same * 1000 + rep * 10 + g.length + Math.random() });
        }
        if (!cand.length) { unplaced.push(p); continue; }
        cand.sort((a, b) => a.key - b.key);
        groups[cand[0].gi].push(p);
      }
      const ok = groups.filter(g => g.length >= 3);
      const s = scoreGroups(ok);
      if (better(s, best, allowViol)) { best = s; bestGroups = ok; }
    }
    if (best && best.placed === n && best.viol === 0 && best.repeat === 0) break;
  }
  return best ? bestGroups : [];
}

function isComing(cls) {
  // 지금 게임 중이거나 곧 대기실로 돌아올 학생이 있는지
  for (const p of cls.players.values()) if ((p.connected || p.bot) && p.state !== 'waiting') return true;
  return false;
}

function tryMatch(cls) {
  const waiting = [...cls.players.values()].filter(p => p.state === 'waiting' && (p.connected || p.bot));
  const coming = isComing(cls);
  if (!cls.settings.auto) { cls.lobbyMsg = 'paused'; return; }
  if (waiting.length < 3) {
    cls.gatherSince = 0;
    cls.lobbyMsg = coming ? 'others' : 'few';
    return;
  }
  const t = now();
  if (!cls.gatherSince) cls.gatherSince = t;
  const quiet = t - cls.lastWaitChange >= T.GATHER_QUIET / SPEED;
  const maxed = t - cls.gatherSince >= T.GATHER_MAX / SPEED;
  if (!quiet && !maxed) { cls.lobbyMsg = 'gather'; return; }

  // 다른 모둠이 아직 게임 중이면 규칙을 꼭 지키고, 더 올 사람이 없을 때만 최대한 섞어서 배정
  const groups = partition(waiting, !coming);
  if (!groups.length) { cls.lobbyMsg = 'mixing'; return; }
  for (const g of groups) createRoom(cls, g);
  cls.gatherSince = 0;
  const left = waiting.length - groups.reduce((s, g) => s + g.length, 0);
  cls.lobbyMsg = left ? 'mixing' : 'others';
  touch(cls);
}

// ───────── 방 & 게임 ─────────
function createRoom(cls, group) {
  const num = ++cls.roomSeq;
  const room = {
    id: cls.code + '-' + num + '-' + rid().slice(0, 4), num, code: cls.code,
    order: CARDS.shuffle(group.map(p => p.pid)),
    avatars: {}, unit: cls.settings.unit, minutes: cls.settings.minutes,
    status: 'intro', introEnds: now() + T.INTRO, endsAt: 0,
    sets: [], deck: [], hands: {}, books: {}, turnIdx: 0, phase: 'intro', phaseEnds: 0,
    pending: null, events: [], seq: 0, timer: null, gain: {},
    fromPrev: Object.fromEntries(group.map(p => [p.pid, p.prevRoomNum || null])),
  };
  room.order.forEach((pid, i) => { room.avatars[pid] = AVATARS[i % AVATARS.length]; });
  for (const p of group) { p.state = 'matched'; p.roomId = room.id; }
  cls.rooms.set(room.id, room);
  room.timer = setTimeout(() => startGame(cls, room), T.INTRO / SPEED);
  touch(cls);
}

function pickSets(unit, n) {
  // 11단원이면 11단원 카드만, 12단원이면 12단원 카드만
  const count = n <= 3 ? 9 : n === 4 ? 10 : 11;
  const pool = CARDS.setsForUnit(unit === '12' ? '12' : '11');
  return CARDS.shuffle([...pool]).slice(0, Math.min(count, pool.length));
}

function startGame(cls, room) {
  if (room.status !== 'intro') return;
  const n = room.order.length;
  room.sets = pickSets(room.unit, n);
  room.deck = CARDS.shuffle(room.sets.flatMap(s => [s, s, s, s]));
  const deal = n <= 3 ? 7 : 5;
  for (const pid of room.order) {
    room.hands[pid] = room.deck.splice(0, deal);
    room.books[pid] = [];
    const p = cls.players.get(pid);
    if (p) p.state = 'playing';
  }
  room.status = 'playing';
  room.endsAt = now() + room.minutes * 60000 / SPEED;
  addEvent(room, { t: 'start' });
  for (const pid of room.order) for (const s of new Set(room.hands[pid])) checkBook(cls, room, pid, s);
  room.turnIdx = 0;
  startTurn(cls, room);
}

function addEvent(room, e) { e.seq = ++room.seq; e.at = now(); room.events.push(e); if (room.events.length > 30) room.events.shift(); }
function cur(room) { return room.order[room.turnIdx]; }
function isAuto(cls, pid) { const p = cls.players.get(pid); return !p || p.bot || !p.connected; }
function setTimer(room, ms, fn) { clearTimeout(room.timer); room.timer = setTimeout(fn, ms / SPEED); }
function countIn(hand, s) { return hand.reduce((k, x) => k + (x === s ? 1 : 0), 0); }
function totalBooks(room) { return Object.values(room.books).reduce((s, b) => s + b.length, 0); }

function checkBook(cls, room, pid, s) {
  const hand = room.hands[pid];
  if (countIn(hand, s) >= 4) {
    room.hands[pid] = hand.filter(x => x !== s);
    room.books[pid].push(s);
    const p = cls.players.get(pid); if (p) { p.stats.books++; addScore(room, p, SCORE.book); }
    addEvent(room, { t: 'book', who: pid, set: s });
    return true;
  }
  return false;
}

function gameOver(room) {
  if (totalBooks(room) >= room.sets.length) return true;
  if (room.deck.length === 0 && room.order.every(pid => room.hands[pid].length === 0)) return true;
  return false;
}

function startTurn(cls, room, sameTurn = false) {
  if (room.status !== 'playing') return;
  if (gameOver(room) || now() >= room.endsAt) return endGame(cls, room);
  // 손에 카드가 없으면 연못에서 1장 가져오고, 연못도 비었으면 다음 사람
  let guard = 0;
  while (room.hands[cur(room)].length === 0) {
    if (room.deck.length) {
      const pid = cur(room);
      const card = room.deck.shift();
      room.hands[pid].push(card);
      addEvent(room, { t: 'refill', who: pid });
      break;
    }
    room.turnIdx = (room.turnIdx + 1) % room.order.length;
    if (++guard > room.order.length) return endGame(cls, room);
  }
  const pid = cur(room);
  room.phase = 'ask';
  room.pending = { asker: pid };
  room.phaseEnds = now() + T.ASK;
  if (!sameTurn) addEvent(room, { t: 'turn', who: pid });
  const p = cls.players.get(pid);
  if (p && p.bot) setTimer(room, 1500 + Math.random() * 1500, () => botAsk(cls, room, pid));
  else if (isAuto(cls, pid)) setTimer(room, 4000, () => autoPass(cls, room, pid, 'away'));
  else setTimer(room, T.ASK, () => autoPass(cls, room, pid, 'timeout'));
  touch(cls);
}

function nextTurn(cls, room) {
  room.turnIdx = (room.turnIdx + 1) % room.order.length;
  startTurn(cls, room);
}

function pauseThen(cls, room, fn) {
  room.phase = 'wait';
  room.phaseEnds = now() + T.PAUSE;
  touch(cls);
  setTimer(room, T.PAUSE, fn);
}

// 시간이 지나거나 자리에 없을 때: 연못에서 1장 가져가고 차례 넘김
function autoPass(cls, room, pid, why) {
  if (room.status !== 'playing' || cur(room) !== pid || !['ask', 'say'].includes(room.phase)) return;
  addEvent(room, { t: why === 'away' ? 'away' : 'timeout', who: pid });
  if (room.deck.length) {
    const card = room.deck.shift();
    room.hands[pid].push(card);
    addEvent(room, { t: 'fish', who: pid, lucky: false });
    checkBook(cls, room, pid, card);
  }
  pauseThen(cls, room, () => nextTurn(cls, room));
}

function targetsFor(room, pid) { return room.order.filter(q => q !== pid && room.hands[q].length > 0); }

function doAsk(cls, room, pid, target, set) {
  if (room.status !== 'playing' || room.phase !== 'ask' || cur(room) !== pid) return 'not-your-turn';
  if (!room.hands[pid].includes(set)) return 'no-card';
  if (!targetsFor(room, pid).includes(target)) {
    if (targetsFor(room, pid).length === 0) { // 물어볼 친구가 없으면 바로 낚시
      return goFish(cls, room, pid, set), null;
    }
    return 'bad-target';
  }
  const q = CARDS.sentenceOptions(set, room.sets);
  room.phase = 'say';
  room.pending = { asker: pid, target, set, options: q.options, answer: q.answer };
  touch(cls);
  const p = cls.players.get(pid);
  if (p && p.bot) setTimer(room, 1200 + Math.random() * 1200, () => doSay(cls, room, pid, Math.random() < 0.85 ? q.answer : (q.answer + 1) % 3));
  else setTimer(room, Math.max(8000, room.phaseEnds - now()), () => autoPass(cls, room, pid, 'timeout'));
  return null;
}

function doCancel(cls, room, pid) {
  if (room.phase !== 'say' || cur(room) !== pid) return;
  room.phase = 'ask';
  room.pending = { asker: pid };
  setTimer(room, Math.max(5000, room.phaseEnds - now()), () => autoPass(cls, room, pid, 'timeout'));
  touch(cls);
}

function doSay(cls, room, pid, idx) {
  if (room.status !== 'playing' || room.phase !== 'say' || cur(room) !== pid) return;
  const pd = room.pending;
  const card = CARDS.ALL[pd.set];
  const p = cls.players.get(pid);
  const ok = idx === pd.answer;
  if (p) { p.stats.asks++; if (ok) { p.stats.askOk++; addScore(room, p, SCORE.ask); } }
  if (!ok) {
    addEvent(room, { t: 'wrong', who: pid, to: pd.target, set: pd.set, chosen: pd.options[idx] || '', correct: card.ask });
    // 문장을 틀리면 친구에게 받을 수 없어요 → 연못에서 1장 가져가고 차례 끝
    if (room.deck.length) {
      const c = room.deck.shift();
      room.hands[pid].push(c);
      checkBook(cls, room, pid, c);
    }
    room.pending = { asker: pid, target: pd.target, set: pd.set };
    room.phase = 'wait';
    room.phaseEnds = now() + T.PAUSE + 1500;
    touch(cls);
    setTimer(room, T.PAUSE + 1500, () => nextTurn(cls, room));
    return;
  }
  addEvent(room, { t: 'ask', who: pid, to: pd.target, set: pd.set, text: card.ask, ko: card.askKo });
  room.phase = 'reply';
  room.phaseEnds = now() + T.REPLY;
  room.pending = { asker: pid, target: pd.target, set: pd.set, yes: card.yes, no: card.no };
  const tp = cls.players.get(pd.target);
  const has = countIn(room.hands[pd.target], pd.set) > 0;
  if (tp && tp.bot) setTimer(room, 1500 + Math.random() * 1500, () => doReply(cls, room, pd.target, Math.random() < 0.9 ? (has ? 0 : 1) : (has ? 1 : 0)));
  else if (isAuto(cls, pd.target)) setTimer(room, 2500, () => doReply(cls, room, pd.target, has ? 0 : 1, true));
  else setTimer(room, T.REPLY, () => doReply(cls, room, pd.target, has ? 0 : 1, true));
  touch(cls);
}

function doReply(cls, room, pid, choice, auto = false) {
  if (room.status !== 'playing' || room.phase !== 'reply' || room.pending.target !== pid) return;
  const pd = room.pending;
  const card = CARDS.ALL[pd.set];
  const n = countIn(room.hands[pid], pd.set);
  const truth = n > 0 ? 0 : 1;
  const ok = choice === truth;
  const p = cls.players.get(pid);
  if (p && !auto) { p.stats.replies++; if (ok) { p.stats.replyOk++; addScore(room, p, SCORE.reply); } }
  addEvent(room, { t: 'reply', who: pid, to: pd.asker, set: pd.set, text: truth === 0 ? card.yes : card.no, ok, auto, said: choice === 0 ? card.yes : card.no });
  if (n > 0) {
    room.hands[pid] = room.hands[pid].filter(x => x !== pd.set);
    for (let i = 0; i < n; i++) room.hands[pd.asker].push(pd.set);
    addEvent(room, { t: 'give', who: pid, to: pd.asker, set: pd.set, n });
    checkBook(cls, room, pd.asker, pd.set);
    pauseThen(cls, room, () => startTurn(cls, room, true)); // 받았으면 한 번 더!
  } else {
    goFish(cls, room, pd.asker, pd.set);
  }
}

function goFish(cls, room, pid, wanted) {
  if (!room.deck.length) {
    addEvent(room, { t: 'fish', who: pid, empty: true });
    return pauseThen(cls, room, () => nextTurn(cls, room));
  }
  const c = room.deck.shift();
  room.hands[pid].push(c);
  const lucky = c === wanted;
  addEvent(room, { t: 'fish', who: pid, lucky, set: lucky ? c : undefined, got: c });
  checkBook(cls, room, pid, c);
  pauseThen(cls, room, () => (lucky ? startTurn(cls, room, true) : nextTurn(cls, room)));
}

function botAsk(cls, room, pid) {
  if (room.phase !== 'ask' || cur(room) !== pid) return;
  const hand = room.hands[pid];
  const counts = {};
  for (const s of hand) counts[s] = (counts[s] || 0) + 1;
  const sets = Object.keys(counts).sort((a, b) => counts[b] - counts[a] + Math.random() - 0.5);
  const ts = targetsFor(room, pid);
  if (!ts.length) return goFish(cls, room, pid, sets[0]);
  doAsk(cls, room, pid, ts[Math.floor(Math.random() * ts.length)], sets[0]);
}

function endGame(cls, room) {
  if (room.status === 'done') return;
  clearTimeout(room.timer);
  room.status = 'done';
  room.phase = 'done';
  const max = Math.max(...room.order.map(pid => room.books[pid]?.length || 0));
  room.winners = max > 0 ? room.order.filter(pid => (room.books[pid]?.length || 0) === max) : [];
  room.resultEnds = now() + T.RESULT;
  addEvent(room, { t: 'end' });
  const members = room.order.map(pid => cls.players.get(pid)).filter(Boolean);
  for (const p of members) {
    if (p.roomId !== room.id) continue;
    p.stats.games++; addScore(room, p, SCORE.play);
    if (room.winners.includes(p.pid)) { p.stats.wins++; addScore(room, p, SCORE.win); }
    for (const q of members) if (q !== p) p.partners[q.pid] = (p.partners[q.pid] || 0) + 1;
    p.state = 'result';
    p.prevRoomId = room.id;
    p.prevRoomNum = room.num;
    p.resultEnds = room.resultEnds;
  }
  cls.history.unshift({
    num: room.num, at: now(),
    dur: Math.max(0, now() - (room.endsAt - room.minutes * 60000 / SPEED)) * SPEED,
    players: room.order.map(pid => ({ name: cls.players.get(pid)?.name || '?', avatar: room.avatars[pid], books: room.books[pid]?.length || 0, win: room.winners.includes(pid) })),
  });
  cls.history = cls.history.slice(0, 40);
  setTimeout(() => {
    for (const p of members) if (p.roomId === room.id && p.state === 'result') toWaiting(cls, p);
    cls.rooms.delete(room.id);
    touch(cls);
  }, T.RESULT / SPEED);
  touch(cls);
}

function toWaiting(cls, p) {
  if (p.state === 'waiting') return;
  p.state = 'waiting';
  p.roomId = null;
  p.waitingSince = now();
  cls.lastWaitChange = now();
  touch(cls);
}

function removeFromRoom(cls, room, pid) {
  if (!room || room.status === 'done') return;
  const idx = room.order.indexOf(pid);
  if (idx < 0) return;
  if (room.status === 'playing') {
    room.deck = CARDS.shuffle([...room.deck, ...room.hands[pid]]);
    const wasTurn = cur(room) === pid || (room.pending && room.pending.target === pid);
    room.order.splice(idx, 1);
    delete room.hands[pid];
    if (room.turnIdx > idx) room.turnIdx--;
    room.turnIdx %= Math.max(1, room.order.length);
    if (room.order.length < 2) return endGame(cls, room);
    if (wasTurn) startTurn(cls, room);
  } else {
    room.order.splice(idx, 1);
    if (room.order.length < 2) {
      clearTimeout(room.timer);
      for (const q of room.order) { const p = cls.players.get(q); if (p) toWaiting(cls, p); }
      cls.rooms.delete(room.id);
    }
  }
}

// ───────── 화면 데이터 ─────────
function roomOf(cls, p) { return p.roomId ? cls.rooms.get(p.roomId) : null; }

function viewFor(cls, p) {
  const base = {
    me: { pid: p.pid, name: p.name, stats: p.stats, rank: 0, total: 0 },
    top: [], scoreRules: SCORE,
    code: cls.code, unit: cls.settings.unit, serverNow: now(),
  };
  const rk = cls.rankCache || ranking(cls);
  const mine = rk.find(r => r.pid === p.pid);
  if (mine) { base.me.rank = mine.rank; base.me.total = rk.length; }
  base.top = rk.filter(r => r.rank <= 5).slice(0, 5).map(r => ({ name: r.name, rank: r.rank, score: r.score, books: r.books, me: r.pid === p.pid }));
  const room = roomOf(cls, p);
  if (p.state === 'waiting' || !room) {
    const waiting = [...cls.players.values()].filter(q => q.state === 'waiting' && (q.connected || q.bot));
    return {
      ...base, screen: 'lobby',
      lobby: {
        names: waiting.map(q => q.name), msg: cls.lobbyMsg,
        playing: [...cls.rooms.values()].filter(r => r.status !== 'done').length,
        gatherEnds: cls.gatherSince ? Math.min(cls.lastWaitChange + T.GATHER_QUIET, cls.gatherSince + T.GATHER_MAX) : 0,
        prevNum: p.prevRoomNum,
        small: [...cls.players.values()].filter(q => q.connected || q.bot).length < 6,
      },
    };
  }
  const players = room.order.map(pid => {
    const q = cls.players.get(pid);
    return {
      pid, name: q?.name || '?', avatar: room.avatars[pid], count: (room.hands[pid] || []).length,
      books: room.books[pid] || [], connected: !!(q && (q.connected || q.bot)), bot: !!q?.bot,
      fromPrev: !!(p.prevRoomId && q && q !== p && q.prevRoomId === p.prevRoomId),
    };
  });
  const v = {
    ...base,
    screen: p.state === 'matched' ? 'intro' : p.state === 'result' ? 'result' : 'game',
    room: {
      num: room.num, status: room.status, phase: room.phase, turn: room.status === 'playing' ? cur(room) : null,
      deck: room.deck.length, endsAt: room.endsAt, phaseEnds: room.phaseEnds, introEnds: room.introEnds,
      resultEnds: room.resultEnds || 0, players, gain: room.gain,
      // 낚시로 뽑은 카드(got)는 본인에게만 보여요
      events: room.events.slice(-12).map(e => (e.got && e.who !== p.pid ? { ...e, got: undefined } : e)),
      sets: room.sets,
      totalSets: room.sets.length, winners: room.winners || [], unit: room.unit,
      pending: room.pending ? { asker: room.pending.asker, target: room.pending.target || null, set: room.phase === 'say' ? null : room.pending.set || null } : null,
    },
  };
  const hand = room.hands[p.pid] || [];
  const counts = {};
  for (const s of hand) counts[s] = (counts[s] || 0) + 1;
  v.hand = Object.keys(counts).map(s => ({ set: s, n: counts[s] })).sort((a, b) => b.n - a.n || a.set.localeCompare(b.set));
  if (room.phase === 'say' && room.pending.asker === p.pid) {
    v.say = { set: room.pending.set, target: room.pending.target, options: room.pending.options };
  }
  if (room.phase === 'reply' && room.pending.target === p.pid) {
    v.reply = { set: room.pending.set, asker: room.pending.asker, options: [room.pending.yes, room.pending.no], ends: room.phaseEnds };
  }
  return v;
}

function teacherView(cls) {
  const t = now();
  const players = [...cls.players.values()];
  return {
    code: cls.code, settings: cls.settings, serverNow: t, lobbyMsg: cls.lobbyMsg,
    waiting: players.filter(p => p.state === 'waiting').map(p => ({
      pid: p.pid, name: p.name, prev: p.prevRoomNum, wait: Math.round((t - p.waitingSince) / 1000), connected: p.connected || p.bot, bot: p.bot,
    })),
    rooms: [...cls.rooms.values()].map(r => ({
      id: r.id, num: r.num, status: r.status, deck: r.deck.length, endsAt: r.endsAt, totalSets: r.sets.length || '-', unit: r.unit,
      turn: r.status === 'playing' ? cur(r) : null,
      players: r.order.map(pid => {
        const p = cls.players.get(pid);
        return { pid, name: p?.name || '?', avatar: r.avatars[pid], count: (r.hands[pid] || []).length, books: (r.books[pid] || []).length, connected: !!(p && (p.connected || p.bot)), prev: r.fromPrev[pid] || null };
      }),
    })),
    students: players.map(p => ({ pid: p.pid, name: p.name, state: p.state, connected: p.connected || p.bot, bot: p.bot, ...p.stats })),
    ranking: cls.rankCache || ranking(cls), scoreRules: SCORE,
    history: cls.history.slice(0, 20),
  };
}

// 같은 반 화면 갱신(묶어서 한 번에)
const dirty = new Set();
function touch(cls) {
  if (dirty.has(cls)) return;
  dirty.add(cls);
  setImmediate(() => {
    dirty.delete(cls);
    cls.rankCache = ranking(cls);
    for (const p of cls.players.values()) {
      if (p.connected && p.sid) io.to(p.sid).emit('view', viewFor(cls, p));
    }
    io.to('teacher:' + cls.code).emit('tview', teacherView(cls));
  });
}

// 1초마다: 자동 배정, 시간 종료 확인
setInterval(() => {
  for (const cls of classes.values()) {
    tryMatch(cls);
    for (const room of cls.rooms.values()) {
      if (room.status === 'playing' && now() >= room.endsAt) endGame(cls, room);
    }
    if (cls.players.size || cls.rooms.size) touch(cls);
  }
}, Math.max(50, 1000 / SPEED));

// ───────── 소켓 ─────────
io.on('connection', (socket) => {
  socket.on('join', ({ code, name, token } = {}, cb = () => {}) => {
    const cls = getClass(code);
    name = cleanName(name);
    if (!cls) return cb({ error: '반 코드를 입력해 주세요.' });
    let p = token && tokens.get(token);
    if (p && p.code !== cls.code) p = null;
    if (!p) {
      if (!name) return cb({ error: '이름을 입력해 주세요.' });
      const same = [...cls.players.values()].find(q => q.name === name && !q.bot);
      if (same && same.connected) return cb({ error: '같은 이름이 이미 있어요. 번호를 붙여 주세요. (예: 12 김민준)' });
      p = same || newPlayer(cls, name);
    }
    if (p.sid && p.sid !== socket.id) io.to(p.sid).emit('kicked', '다른 기기에서 같은 이름으로 들어왔어요.');
    p.sid = socket.id;
    p.connected = true;
    socket.data = { pid: p.pid, code: cls.code };
    if (p.state === 'waiting') cls.lastWaitChange = now();
    cb({ ok: true, token: p.token, pid: p.pid, code: cls.code, name: p.name });
    touch(cls);
  });

  const ctx = () => {
    const { pid, code } = socket.data || {};
    const cls = code && classes.get(code);
    const p = cls && cls.players.get(pid);
    if (!p || p.sid !== socket.id) return null;
    return { cls, p, room: roomOf(cls, p) };
  };

  socket.on('ask', ({ target, set } = {}, cb = () => {}) => {
    const c = ctx(); if (!c || !c.room) return cb({ error: 'no-room' });
    cb({ error: doAsk(c.cls, c.room, c.p.pid, target, set) });
  });
  socket.on('cancel', () => { const c = ctx(); if (c && c.room) doCancel(c.cls, c.room, c.p.pid); });
  socket.on('say', ({ idx } = {}) => { const c = ctx(); if (c && c.room) doSay(c.cls, c.room, c.p.pid, Number(idx)); });
  socket.on('reply', ({ choice } = {}) => { const c = ctx(); if (c && c.room) doReply(c.cls, c.room, c.p.pid, Number(choice)); });
  socket.on('toLobby', () => { const c = ctx(); if (c && c.p.state === 'result') toWaiting(c.cls, c.p); });
  socket.on('logout', () => {
    const c = ctx(); if (!c) return;
    if (c.room) removeFromRoom(c.cls, c.room, c.p.pid);
    c.cls.players.delete(c.p.pid); tokens.delete(c.p.token);
    socket.data = {};
    touch(c.cls);
  });

  socket.on('disconnect', () => {
    const c = ctx(); if (!c) return;
    c.p.connected = false;
    c.p.sid = null;
    // 내 차례였다면 자동 진행
    const room = c.room;
    if (room && room.status === 'playing') {
      if (cur(room) === c.p.pid && room.phase === 'ask') setTimer(room, 4000, () => autoPass(c.cls, room, c.p.pid, 'away'));
      if (room.phase === 'reply' && room.pending.target === c.p.pid) {
        const has = countIn(room.hands[c.p.pid], room.pending.set) > 0;
        setTimer(room, 2500, () => doReply(c.cls, room, c.p.pid, has ? 0 : 1, true));
      }
    }
    touch(c.cls);
  });

  // ── 교사 ──
  socket.on('tjoin', ({ code } = {}, cb = () => {}) => {
    const cls = getClass(code);
    if (!cls) return cb({ error: '반 코드를 입력해 주세요.' });
    socket.join('teacher:' + cls.code);
    socket.data = { teacher: cls.code };
    cb({ ok: true, code: cls.code });
    socket.emit('tview', teacherView(cls));
  });
  const tcls = () => socket.data && socket.data.teacher && classes.get(socket.data.teacher);
  socket.on('tset', (s = {}) => {
    const cls = tcls(); if (!cls) return;
    if (['11', '12'].includes(s.unit)) cls.settings.unit = s.unit;
    if ([3, 5, 7, 10, 15].includes(Number(s.minutes))) cls.settings.minutes = Number(s.minutes);
    if (typeof s.auto === 'boolean') cls.settings.auto = s.auto;
    touch(cls);
  });
  socket.on('tbots', ({ n } = {}) => {
    const cls = tcls(); if (!cls) return;
    n = Math.max(1, Math.min(30, Number(n) || 3));
    for (let i = 0; i < n; i++) newPlayer(cls, '🤖 연습봇' + (++cls.botSeq), true);
    touch(cls);
  });
  socket.on('tremoveBots', () => {
    const cls = tcls(); if (!cls) return;
    for (const p of [...cls.players.values()]) if (p.bot) {
      const r = roomOf(cls, p); if (r) removeFromRoom(cls, r, p.pid);
      cls.players.delete(p.pid); tokens.delete(p.token);
    }
    touch(cls);
  });
  socket.on('tend', ({ id } = {}) => {
    const cls = tcls(); const r = cls && cls.rooms.get(id); if (!r) return;
    if (r.status === 'intro') { // 아직 시작 전이면 그냥 대기실로
      clearTimeout(r.timer);
      for (const pid of r.order) { const p = cls.players.get(pid); if (p) toWaiting(cls, p); }
      cls.rooms.delete(r.id); touch(cls);
    } else endGame(cls, r);
  });
  socket.on('tkick', ({ pid } = {}) => {
    const cls = tcls(); const p = cls && cls.players.get(pid); if (!p) return;
    const r = roomOf(cls, p); if (r) removeFromRoom(cls, r, p.pid);
    if (p.sid) io.to(p.sid).emit('kicked', '선생님이 내보냈어요. 다시 들어올 수 있어요.');
    cls.players.delete(p.pid); tokens.delete(p.token);
    touch(cls);
  });
  socket.on('tresetScores', () => {
    const cls = tcls(); if (!cls) return;
    for (const p of cls.players.values()) Object.assign(p.stats, { games: 0, wins: 0, books: 0, asks: 0, askOk: 0, replies: 0, replyOk: 0, score: 0 });
    cls.history = [];
    touch(cls);
  });
  socket.on('tendAll', () => {
    const cls = tcls(); if (!cls) return;
    cls.settings.auto = false;
    for (const r of cls.rooms.values()) if (r.status === 'playing') endGame(cls, r);
    touch(cls);
  });
});

server.listen(PORT, () => console.log(`GO GO FISH 서버 실행 중 → http://localhost:${PORT}  (교사: /teacher)`));

module.exports = { partition, scoreGroups };
