// utils/lemma.js - 英语词形还原（原形候选）
// 用途：点读查词时把 improving / studies / knives 等变形词还原为词典里的原形；
//       抽题打分时也用它做命中判断（替代原先粗暴的 stem）。
// 策略：返回「候选原形数组」按置信度排序，调用方依次查词典，命中即停。

const IRREGULAR = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have', haves: 'have',
  does: 'do', did: 'do', done: 'do', doing: 'do',
  goes: 'go', went: 'go', gone: 'go', going: 'go',
  made: 'make', making: 'make',
  took: 'take', taken: 'take',
  came: 'come', coming: 'come',
  saw: 'see', seen: 'see', seeing: 'see',
  got: 'get', gotten: 'get', getting: 'get',
  said: 'say', saying: 'say',
  told: 'tell',
  found: 'find',
  gave: 'give', given: 'give',
  wrote: 'write', written: 'write', writing: 'write',
  built: 'build',
  kept: 'keep',
  held: 'hold',
  meant: 'mean',
  paid: 'pay',
  ran: 'run', running: 'run',
  began: 'begin', begun: 'begin', beginning: 'begin',
  chosen: 'choose', chose: 'choose',
  driven: 'drive', drove: 'drive', driving: 'drive',
  eaten: 'eat', ate: 'eat',
  fallen: 'fall', fell: 'fall',
  flown: 'fly', flew: 'fly',
  forgotten: 'forget', forgot: 'forget', forgetting: 'forget',
  hidden: 'hide', hid: 'hide',
  known: 'know', knew: 'know',
  laid: 'lay',
  led: 'lead',
  left: 'leave', leaving: 'leave',
  lost: 'lose', losing: 'lose',
  put: 'put', putting: 'put',
  read: 'read',
  risen: 'rise', rose: 'rise',
  sent: 'send',
  set: 'set', setting: 'set',
  shown: 'show', showed: 'show',
  shut: 'shut', shutting: 'shut',
  spoken: 'speak', spoke: 'speak', speaking: 'speak',
  spent: 'spend',
  stood: 'stand',
  threw: 'throw', thrown: 'throw',
  understood: 'understand',
  worn: 'wear', wore: 'wear',
  won: 'win', winning: 'win',
  cut: 'cut', cutting: 'cut',
  brought: 'bring',
  bought: 'buy',
  taught: 'teach',
  thought: 'think',
  caught: 'catch',
  fought: 'fight',
  slept: 'sleep',
  swept: 'sweep',
  dealt: 'deal',
  felt: 'feel',
  knelt: 'kneel',
  smelt: 'smell',
  swam: 'swim', swum: 'swim', swimming: 'swim',
  sang: 'sing', sung: 'sing',
  rang: 'ring', rung: 'ring',
  sank: 'sink', sunk: 'sink',
  drank: 'drink', drunk: 'drink',
  blew: 'blow', blown: 'blow',
  grew: 'grow', grown: 'grow',
  drew: 'draw', drawn: 'draw',
  broke: 'break', broken: 'break', breaking: 'break',
  spoke: 'speak',
  stole: 'steal', stolen: 'steal',
  froze: 'freeze', frozen: 'freeze', freezing: 'freeze',
  woke: 'wake', woken: 'wake', waking: 'wake',
  better: 'good', best: 'good',
  worse: 'bad', worst: 'bad',
  further: 'far', furthest: 'far', farther: 'far', farthest: 'far',
  older: 'old', oldest: 'old', elder: 'old', eldest: 'old',
  children: 'child',
  people: 'person', peoples: 'person',
  men: 'man', women: 'woman',
  feet: 'foot', teeth: 'tooth', geese: 'goose',
  mice: 'mouse', lice: 'louse',
  lives: 'life', knives: 'knife', wives: 'wife',
  leaves: 'leaf', wolves: 'wolf', shelves: 'shelf',
  halves: 'half', calves: 'calf',
  thieves: 'thief', loaves: 'loaf',
  ourselves: 'ourselves', themselves: 'themselves', yourselves: 'yourselves'
};

const CONSONANTS = 'bcdfghjklmnpqrstvwxyz';

function push(out, w, cand) {
  if (cand && cand !== w && cand.length >= 2 && out.indexOf(cand) < 0) out.push(cand);
}

// 返回候选原形数组（按置信度降序）
export function lemmaCandidates(w) {
  const out = [];
  if (!w) return out;
  const s = String(w).toLowerCase().replace(/[’‘`]/g, "'");
  if (!s) return out;

  if (IRREGULAR[s]) { push(out, s, IRREGULAR[s]); return out; }
  if (s.length < 4) return out; // 过短的词不做规则还原（is/as/at/bus 等）

  // -ies / -ied : studies -> study, carried -> carry
  if (/ies$/.test(s)) { push(out, s, s.slice(0, -3) + 'y'); push(out, s, s.slice(0, -1)); }
  if (/ied$/.test(s)) { push(out, s, s.slice(0, -3) + 'y'); push(out, s, s.slice(0, -1)); }
  // -ves : knives -> knife / knifefe 容错
  if (/ves$/.test(s)) { push(out, s, s.slice(0, -3) + 'f'); push(out, s, s.slice(0, -3) + 'fe'); }

  // -ing
  if (/ing$/.test(s)) {
    const base = s.slice(0, -3);
    push(out, s, base + 'e');   // making -> make, living -> live, using -> use
    push(out, s, base);         // working -> work, being -> be
    if (base.length >= 2 && CONSONANTS.indexOf(base[base.length - 1]) >= 0 &&
        base[base.length - 1] === base[base.length - 2]) {
      push(out, s, base.slice(0, -1)); // running -> run, sitting -> sit
    }
    if (/[^aeiou]ying$/.test(s)) push(out, s, s.slice(0, -4) + 'ie'); // lying -> lie
    if (/cking$/.test(s)) push(out, s, s.slice(0, -5) + 'ke');        // panicking -> panic
    if (/ing$/.test(s) && /(?:[^aeiou])ing$/.test(s) === false) push(out, s, base);
  }

  // -ed
  if (/ed$/.test(s)) {
    const base = s.slice(0, -2);
    push(out, s, base + 'e');   // lived -> live, used -> use
    push(out, s, base);         // worked -> work, played -> play
    if (base.length >= 2 && CONSONANTS.indexOf(base[base.length - 1]) >= 0 &&
        base[base.length - 1] === base[base.length - 2]) {
      push(out, s, base.slice(0, -1)); // stopped -> stop, planned -> plan
    }
    if (/ied$/.test(s)) push(out, s, s.slice(0, -3) + 'y'); // carried -> carry
  }

  // -er / -est / -ers / -ests
  if (/(?:er|est|ers|ests)$/.test(s)) {
    const m = /(?:ests|est|ers|er)$/.exec(s);
    if (m) {
      const suffix = m[0];
      const base = s.slice(0, s.length - suffix.length);
      const plural = /s$/.test(suffix);
      const cand1 = base;
      const cand2 = base + 'e';         // larger -> large
      const cand3 = plural ? base : base;
      if (/ier|iest|iers|iests$/.test(s)) {
        const yBase = s.replace(/iers?$|iests?$/, 'y'); // happier -> happy
        push(out, s, yBase);
      }
      push(out, s, cand2);
      push(out, s, cand1);
      if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
        const dbl = base.slice(0, -1);  // bigger -> big
        push(out, s, dbl);
        if (plural) push(out, s, dbl);
      }
      void cand3;
    }
  }

  // -ly
  if (/ly$/.test(s)) {
    push(out, s, s.slice(0, -2));        // quickly -> quick
    if (/[^aeiou]ly$/.test(s)) push(out, s, s.slice(0, -2) + 'le'); // possibly -> possible, simply -> simple
    push(out, s, s.slice(0, -2) + 'e');  // nicely -> nice
    if (/ily$/.test(s)) push(out, s, s.replace(/ily$/, 'y')); // happily -> happy
    if (/ally$/.test(s)) push(out, s, s.slice(0, -4) + 'al'); // basically -> basic
  }

  // -s（放最后，最不可靠；bus/gas/is/this 由"直接查词典优先"规避）
  if (/s$/.test(s) && !/ss$/.test(s)) {
    const bare = s.slice(0, -1);
    if (bare.length >= 3) push(out, s, bare);            // books -> book（避免 bus -> bu）
    if (/(?:ches|shes|xes|zes|oes)$/.test(s)) push(out, s, s.slice(0, -2));
    if (/ies$/.test(s)) push(out, s, s.slice(0, -3) + 'y');
  }

  return out;
}

// 取置信度最高的候选；无候选则返回原词
export function lemma(w) {
  const c = lemmaCandidates(w);
  return c.length ? c[0] : String(w || '').toLowerCase();
}
