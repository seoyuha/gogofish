// GO GO FISH 카드 데이터 — 6학년 영어 11·12단원 (지도서 낱말·주요 표현 기준)
// 한 세트 = 같은 카드 4장. 4장을 모으면 '책(Book)' 1권 완성!
// 이미지를 넣고 싶으면 public/cards/<id>.png (또는 .jpg/.webp) 로 저장하면 자동으로 이모지 대신 그림이 나와요.

const U11 = [
  { id: 'hanbok',      en: 'hanbok',      ko: '한복',     kind: 'clothes',  emoji: '👘' },
  { id: 'gat',         en: 'gat',         ko: '갓',       kind: 'hat',      emoji: '🎩' },
  { id: 'kimchi',      en: 'kimchi',      ko: '김치',     kind: 'food',     emoji: '🥬' },
  { id: 'tteokbokki',  en: 'tteokbokki',  ko: '떡볶이',   kind: 'food',     emoji: '🍢' },
  { id: 'songpyeon',   en: 'songpyeon',   ko: '송편',     kind: 'food',     emoji: '🌙' },
  { id: 'gongginori',  en: 'gongginori',  ko: '공기놀이', kind: 'game',     emoji: '✊' },
  { id: 'tuho',        en: 'tuho',        ko: '투호',     kind: 'game',     emoji: '🏺' },
  { id: 'hanji',       en: 'hanji',       ko: '한지',     kind: 'paper',    emoji: '📜' },
  { id: 'fan',         en: 'fan',         ko: '부채',     kind: 'fan',      emoji: '🪭', say: 'the Korean fan' },
  { id: 'mask',        en: 'mask',        ko: '탈',       kind: 'mask',     emoji: '🎭', say: 'the Korean mask' },
  { id: 'yunnori',     en: 'yutnori',     ko: '윷놀이',   kind: 'game',     emoji: '🎲' },
  { id: 'norigae',     en: 'norigae',     ko: '노리개',   kind: 'ornament', emoji: '🎀' },
].map(c => ({ ...c, unit: 11 }));

// 12단원: 'forget' = Don't forget to ~.  /  'should' = We should ~.
// en = 카드에 적힌 낱말, say = 문장에 들어가는 말
const U12 = [
  { id: 'earth',       en: 'Earth',          say: 'save the Earth',            ko: '지구 지키기',        type: 'should', emoji: '🌍' },
  { id: 'recycle',     en: 'recycle',        say: 'recycle',                   ko: '재활용하기',         type: 'forget', emoji: '♻️' },
  { id: 'reuse',       en: 'reuse',          say: 'reuse',                     ko: '다시 쓰기',          type: 'forget', emoji: '👜' },
  { id: 'saveenergy',  en: 'save energy',    say: 'save energy',               ko: '에너지 아끼기',      type: 'should', emoji: '💡' },
  { id: 'savewater',   en: 'save water',     say: 'save water',                ko: '물 아끼기',          type: 'should', emoji: '🚰' },
  { id: 'planttrees',  en: 'plant trees',    say: 'plant trees',               ko: '나무 심기',          type: 'should', emoji: '🌳' },
  { id: 'animals',     en: 'protect animals', say: 'protect animals',          ko: '동물 보호하기',      type: 'should', emoji: '🐼' },
  { id: 'oceans',      en: 'clean oceans',   say: 'clean the oceans',          ko: '바다 깨끗하게 하기', type: 'should', emoji: '🐢' },
  { id: 'bike',        en: 'use a bike',     say: 'use a bike',                ko: '자전거 이용하기',    type: 'forget', emoji: '🚲' },
  { id: 'bus',         en: 'use public transportation', say: 'use public transportation', ko: '대중교통 이용하기', type: 'forget', emoji: '🚌' },
  { id: 'trash',       en: 'reduce trash',   say: 'reduce trash',              ko: '쓰레기 줄이기',      type: 'forget', emoji: '🗑️' },
].map(c => ({ ...c, unit: 12 }));

const KIND_KO = { food: '전통 음식', clothes: '전통 옷', hat: '전통 모자', paper: '전통 종이', game: '전통 놀이', fan: '전통 부채', mask: '전통 탈', ornament: '전통 장신구' };

const ALL = {};
for (const c of [...U11, ...U12]) {
  c.say = c.say || c.en;
  if (c.unit === 11) {
    c.ask = `Do you know about ${c.say}?`;
    c.askKo = `${c.ko}에 대해 알고 있니?`;
    c.tag = KIND_KO[c.kind];
    c.yes = 'Yes, I do. Here you are.';
    c.no = "No, I don't. Go fish!";
  } else {
    c.ask = c.type === 'forget' ? `Don't forget to ${c.say}.` : `We should ${c.say}.`;
    c.askKo = '';
    c.tag = c.type === 'forget' ? "Don't forget to ~." : 'We should ~.';
    c.yes = 'Sure! Here you are.';
    c.no = 'Sorry. Go fish!';
  }
  ALL[c.id] = c;
}
// 12단원 우리말 뜻
const KO12 = {
  earth: '우리는 지구를 지켜야 해.', recycle: '재활용하는 것을 잊지 마.', reuse: '다시 쓰는 것을 잊지 마.',
  saveenergy: '우리는 에너지를 아껴야 해.', savewater: '우리는 물을 아껴야 해.', planttrees: '우리는 나무를 심어야 해.',
  animals: '우리는 동물을 보호해야 해.', oceans: '우리는 바다를 깨끗하게 해야 해.', bike: '자전거 이용하는 것을 잊지 마.',
  bus: '대중교통 이용하는 것을 잊지 마.', trash: '쓰레기 줄이는 것을 잊지 마.',
};
for (const id in KO12) ALL[id].askKo = KO12[id];

// 첫 낱말을 -ing로 (recycle→recycling, turn→turning)
function ing(vp) { return vp.replace(/^(\w+)/, w => (/e$/.test(w) && !/ee$/.test(w) ? w.slice(0, -1) : w) + 'ing'); }

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// 문장 고르기 보기 3개 (정답 1 + 헷갈리는 오답 2) — 지도서 유의점(should+동사원형, forget to+동사원형) 반영
function sentenceOptions(setId, poolIds) {
  const c = ALL[setId];
  const others = poolIds.filter(id => id !== setId && ALL[id].unit === c.unit && (c.unit === 11 || ALL[id].type === c.type));
  const other = ALL[others.length ? others[Math.floor(Math.random() * others.length)] : setId];
  let wrong;
  if (c.unit === 11) {
    wrong = shuffle([
      `Do you know ${c.say} about?`,
      `Do you knows about ${c.say}?`,
      `Are you know about ${c.say}?`,
      `How about ${c.say}?`,
      other.id !== c.id ? `Do you know about ${other.say}?` : `Do you know with ${c.say}?`,
      other.id !== c.id ? `Do you know about ${other.say}?` : `Do you know with ${c.say}?`,
    ]);
  } else if (c.type === 'forget') {
    wrong = shuffle([
      `Don't forget ${c.say}.`,
      `Don't forget to ${ing(c.say)}.`,
      `Don't forgets to ${c.say}.`,
      other.id !== c.id ? `Don't forget to ${other.say}.` : `Don't forget ${c.say}.`,
      other.id !== c.id ? `Don't forget to ${other.say}.` : `Don't forget ${c.say}.`,
    ]);
  } else {
    wrong = shuffle([
      `We should to ${c.say}.`,
      `We should ${ing(c.say)}.`,
      `We shoulds ${c.say}.`,
      other.id !== c.id ? `We should ${other.say}.` : `We should to ${c.say}.`,
      other.id !== c.id ? `We should ${other.say}.` : `We should to ${c.say}.`,
    ]);
  }
  const picks = [...new Set(wrong.filter(w => w !== c.ask))].slice(0, 2);
  const opts = shuffle([c.ask, ...picks]);
  return { options: opts, answer: opts.indexOf(c.ask) };
}

function setsForUnit(unit) {
  if (unit === '11') return U11.map(c => c.id);
  if (unit === '12') return U12.map(c => c.id);
  return [...U11, ...U12].map(c => c.id);
}

module.exports = { ALL, U11, U12, sentenceOptions, setsForUnit, shuffle };
