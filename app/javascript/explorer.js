// Artscry: random Magic card illustrations from Scryfall.
// The Rails server remembers, per user, which illustrations were seen and which were rated (1 to 3 hearts).
'use strict';

const API = 'https://api.scryfall.com/cards/search';
const PAGE = 175;            // size of a Scryfall results page
const BASE_QUERY = 'cmc>=0'; // "all cards" when the filter is empty
const AHEAD = 8;             // illustrations preloaded ahead in one-by-one mode
const PER_PAGE = 6;          // illustrations picked at random from each loaded page
const SMALL = 4;             // up to 4 pages: load the whole selection and shuffle it all
const TARGET = 42;           // target pool size (about 7 different pages)
const MIN_MIX = 5;           // only draw once the pool mixes at least 5 pages
const MAX_INFLIGHT = 3;      // pages loaded in parallel
const PKEY = 'artscry:prefs';
const LEGACY_FKEY = 'pioche-magic:favoris'; // favorites from the old prototype (localStorage), imported once
const STALE = { kind: 'stale' };
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.2-4.4-9.3-9C1.2 8.1 3.2 4.5 6.7 4.5c2.2 0 3.9 1.3 5.3 3.2 1.4-1.9 3.1-3.2 5.3-3.2 3.5 0 5.5 3.6 4 7-2.1 4.6-9.3 9-9.3 9z"/></svg>';
const LEVEL_NAMES = ['', 'Like', 'Love', 'Obsessed'];
const hearts = (n) => '♥'.repeat(n);

const PRESETS = [
  ['All', ''],
  ['Landscapes', 't:land'],
  ['Legendary places', 't:legendary t:land'],
  ['Creatures', 't:creature'],
  ['Characters', 't:legendary t:creature'],
  ['Dragons', 't:dragon'],
  ['Angels & demons', '(t:angel or t:demon)'],
  ['Undead', '(t:zombie or t:skeleton or t:spirit or t:vampire)'],
  ['Artifacts', 't:artifact -t:creature'],
  ['Spells in action', '(t:instant or t:sorcery)'],
  ['Planes (Planechase)', '(t:plane or t:phenomenon)', true],
  ['Tokens', 't:token', true],
];

function boot() {
  const $ = (id) => document.getElementById(id);
  if (!$('single')) return; // sign-in pages: nothing to do

  const el = {
    q: $('q'), form: $('searchForm'), presets: $('presets'),
    topicsMenu: $('topicsMenu'), topicLabel: $('topicLabel'), optMenu: $('optMenu'), optDot: $('optDot'),
    modeOne: $('modeOne'), modeGrid: $('modeGrid'), fmtArt: $('fmtArt'), fmtCard: $('fmtCard'),
    favBtn: $('favBtn'), favCount: $('favCount'), extras: $('extrasBtn'), noUb: $('noUbBtn'), hideSeen: $('hideSeenBtn'),
    main: $('main'), single: $('single'), art: $('art'), hitPrev: $('hitPrev'), hitNext: $('hitNext'),
    grid: $('grid'), message: $('message'), loader: $('loader'),
    name: $('name'), meta: $('meta'), actions: $('actions'), rateOne: $('rateOne'),
    lnkScry: $('lnkScry'), lnkArt: $('lnkArt'), count: $('count'),
    favPanel: $('favPanel'), favGrid: $('favGrid'), favEmpty: $('favEmpty'), favTabs: $('favTabs'),
    favCopy: $('favCopy'), favClose: $('favClose'), toast: $('toast'),
    accBtn: $('accBtn'), seenCount: $('seenCount'), accPanel: $('accPanel'), accClose: $('accClose'),
    accSeen: $('accSeen'),
    setBtn: $('setBtn'), setChip: $('setChip'), setPanel: $('setPanel'), setSearch: $('setSearch'), setClose: $('setClose'),
    setTypes: $('setTypes'), setList: $('setList'), setEmpty: $('setEmpty'), accFavs: $('accFavs'), seenReset: $('seenReset'),
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const S = {
    q: '', gen: 0, renderId: 0,
    total: 0, nPages: 0, pages: [], pool: [], seen: new Set(), inflight: new Set(), recent: [],
    take: PER_PAGE, cycleAdded: 0, recycles: 0,
    history: [], pos: 0, mode: 'one', fmt: 'art', gridN: 24, extras: false, noUB: true, hideSeen: true,
    favLevel: 0,
    set: null, // selected set: { code, name, icon } or null
  };

  /* ---------- Serveur (Rails) ---------- */
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
  async function server(method, path, body, opts = {}) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf() },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      keepalive: !!opts.keepalive,
    });
    if (res.status === 401) { location.href = '/session/new'; throw new Error('unauthorized'); }
    if (!res.ok) throw new Error('Server error ' + res.status);
    return res.status === 204 ? null : res.json();
  }

  // Illustrations already seen (across all sessions) and rated ones, keyed by illustration id.
  const everSeen = new Set();
  const ratings = new Map();

  // Views are sent in batches rather than one request per illustration.
  const seenQueue = new Set();
  let seenTimer;
  function markSeen(cards) {
    let added = false;
    for (const c of cards) {
      if (!c || everSeen.has(c.ill)) continue;
      everSeen.add(c.ill);
      seenQueue.add(c.ill);
      added = true;
    }
    if (!added) return;
    syncCounts();
    clearTimeout(seenTimer);
    seenTimer = setTimeout(flushSeen, 1500);
  }
  function flushSeen(keepalive = false) {
    clearTimeout(seenTimer);
    if (!seenQueue.size) return Promise.resolve();
    const ids = [...seenQueue].slice(0, 500);
    ids.forEach((i) => seenQueue.delete(i));
    const p = server('POST', '/api/seen', { ids }, { keepalive })
      .catch(() => { ids.forEach((i) => seenQueue.add(i)); seenTimer = setTimeout(flushSeen, 10000); });
    if (seenQueue.size) seenTimer = setTimeout(flushSeen, 300);
    return p;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSeen(true); });
  addEventListener('pagehide', () => flushSeen(true));

  /* ---------- Outils ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  const fmtNum = (n) => n.toLocaleString('en-US');

  // Scryfall asks for ~100 ms between requests: space out the starts without waiting for responses.
  let nextSlot = 0;
  async function api(url) {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + 110;
    if (at > now) await sleep(at - now);
    let res;
    try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
    catch (e) { throw Object.assign(new Error('network'), { kind: 'network' }); }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error((body && body.details) || ('Error ' + res.status)), { kind: 'http', status: res.status });
    return body;
  }
  // Adds the crossover (Universes Beyond) exclusion to the query.
  // Parentheses keep an "or" in the filter from letting some cards through.
  // With a set selected, the search is restricted to it ("e:code"), crossovers are allowed
  // (you picked the set on purpose) and extras are included so every card of the set shows up.
  function buildQuery(q) {
    const wrap = (x) => (/\bor\b/i.test(x) ? `(${x})` : x);
    if (S.set) return `e:${S.set.code}` + (q ? ' ' + wrap(q) : '');
    let s = q || BASE_QUERY;
    if (S.noUB) s = wrap(s) + ' not:universesbeyond';
    return s;
  }
  const withExtras = () => S.extras || !!S.set;
  const pageUrl = (q, n) => `${API}?q=${encodeURIComponent(buildQuery(q))}&unique=art&order=name&page=${n}${withExtras() ? '&include_extras=true' : ''}`;

  function norm(raw) {
    const faces = raw.card_faces || [];
    const face = raw.image_uris ? raw : faces.find((f) => f.image_uris);
    const iu = face && face.image_uris;
    if (!iu || !iu.art_crop) return null;
    return {
      id: raw.id,
      ill: String(face.illustration_id || raw.illustration_id || raw.id),
      name: face.name || raw.name,
      artist: face.artist || raw.artist || 'Unknown artist',
      set: raw.set_name || '',
      year: (raw.released_at || '').slice(0, 4),
      art: iu.art_crop,
      normal: iu.normal || iu.large || iu.art_crop,
      large: iu.large || iu.normal || iu.art_crop,
      uri: raw.scryfall_uri,
    };
  }
  const srcOf = (c, ctx) => (S.fmt === 'art' ? c.art : (ctx === 'one' ? c.large : c.normal));

  /* ---------- Random draw ---------- */
  // Scryfall returns results in pages of 175 sorted by name, so each page is an alphabetical slice
  // ("Wall of…"). For a real shuffle we keep only a few random illustrations from each page, load
  // several pages in parallel, and only draw a card once the pool mixes enough different pages.
  // Illustrations seen during a previous visit are filtered out right here.
  function addCards(list, pg) {
    const fresh = [];
    for (const raw of list || []) {
      const c = norm(raw);
      if (!c || S.seen.has(c.ill)) continue;
      if (S.hideSeen && everSeen.has(c.ill)) continue;
      fresh.push(c);
    }
    shuffle(fresh);
    const kept = fresh.slice(0, S.take);
    for (const c of kept) { c.pg = pg; S.seen.add(c.ill); S.pool.push(c); }
    S.cycleAdded += kept.length;
  }

  // Starts loading the next page of the draw (pages come in random order).
  function loadPage() {
    const n = S.pages.pop();
    if (n == null) return;
    const g = S.gen;
    const set = S.inflight;
    const p = api(pageUrl(S.q, n))
      .then((j) => { if (g === S.gen) addCards(j.data, n); })
      .catch((e) => {
        if (g !== S.gen) return;
        if (e.kind === 'network') { S.pages.push(n); throw e; }
        // any other error on a single page: move on to the next one
      })
      .finally(() => set.delete(p));
    p.catch(() => {});
    set.add(p);
  }

  // Keeps the pool full, with at most MAX_INFLIGHT pages loading at once.
  function topUp() {
    while (S.pages.length && S.inflight.size < MAX_INFLIGHT
      && S.pool.length + S.inflight.size * S.take < TARGET) loadPage();
  }

  const pagesIn = (pool) => new Set(pool.map((c) => c.pg)).size;

  async function draw() {
    const g = S.gen;
    for (;;) {
      const more = S.pages.length > 0 || S.inflight.size > 0;
      if (S.pool.length && (!more || pagesIn(S.pool) >= Math.min(MIN_MIX, S.nPages))) break;
      if (!more) {
        if (!S.nPages) throw { kind: 'empty' };
        // Every page has been used: start a new round in a new order.
        // If a full round brought nothing new, everything has been seen.
        if (!S.cycleAdded) {
          if (S.recycles >= 1) throw { kind: S.hideSeen && S.total ? 'allSeen' : 'empty' };
          S.recycles++;
          S.seen.clear();
        }
        S.cycleAdded = 0;
        S.pages = shuffle(range(1, S.nPages));
      }
      topUp();
      if (!S.inflight.size) loadPage();
      await Promise.race(S.inflight);
      if (g !== S.gen) throw STALE;
    }
    S.recycles = 0;
    // Random pick, avoiding the pages of the last three draws.
    let i = -1;
    for (let t = 0; t < 16; t++) {
      const j = Math.floor(Math.random() * S.pool.length);
      if (!S.recent.includes(S.pool[j].pg)) { i = j; break; }
    }
    if (i < 0) i = Math.floor(Math.random() * S.pool.length);
    const c = S.pool[i];
    S.pool[i] = S.pool[S.pool.length - 1];
    S.pool.pop();
    S.recent.push(c.pg);
    if (S.recent.length > 3) S.recent.shift();
    topUp();
    return c;
  }

  // Fills the history up to k cards. If the selection runs out, keep what we have.
  async function ensure(k, { partial = false } = {}) {
    const g = S.gen;
    while (S.history.length < k) {
      let c;
      try { c = await draw(); }
      catch (e) { if (partial && e && e.kind === 'allSeen' && S.history.length > S.pos) return; throw e; }
      if (g !== S.gen) throw STALE;
      S.history.push(c);
    }
  }

  const cache = new Map();
  function preload(url) {
    if (!url || cache.has(url)) return;
    const im = new Image();
    im.decoding = 'async';
    im.src = url;
    cache.set(url, im);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
  }
  function isReady(url) { const im = cache.get(url); return !!(im && im.complete && im.naturalWidth); }

  /* ---------- Hearts ---------- */
  const levelOf = (c) => (c && ratings.has(c.ill) ? ratings.get(c.ill).level : 0);

  // Three heart buttons; hovering the n-th one lights up the first n.
  function buildRate(box, getCard) {
    box.replaceChildren();
    for (let n = 1; n <= 3; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.n = n;
      b.innerHTML = HEART;
      b.title = `${LEVEL_NAMES[n]} (${hearts(n)})`;
      b.setAttribute('aria-label', `${n} heart${n > 1 ? 's' : ''}: ${LEVEL_NAMES[n]}`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = getCard();
        if (c) setLevel(c, levelOf(c) === n ? 0 : n);
      });
      b.addEventListener('mouseenter', () => {
        box.classList.add('preview');
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('hov', +x.dataset.n <= n));
      });
      box.append(b);
    }
    box.addEventListener('mouseleave', () => box.classList.remove('preview'));
  }
  function paintRate(box, level) {
    box.querySelectorAll('button').forEach((x) => {
      const on = +x.dataset.n <= level;
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', String(+x.dataset.n === level));
    });
    box.classList.toggle('rated', level > 0);
  }

  async function setLevel(c, level) {
    const before = ratings.get(c.ill);
    if (level) ratings.set(c.ill, { ...c, level });
    else ratings.delete(c.ill);
    if (level) markSeen([c]);
    syncFav();
    toast(level ? `${hearts(level)} ${LEVEL_NAMES[level]}` : 'Removed from favorites');
    try {
      if (level) {
        const { pg, ...card } = c;
        await server('PUT', `/api/ratings/${encodeURIComponent(c.ill)}`, { level, card });
      } else {
        await server('DELETE', `/api/ratings/${encodeURIComponent(c.ill)}`);
      }
    } catch (e) {
      if (before) ratings.set(c.ill, before); else ratings.delete(c.ill);
      syncFav();
      toast('Could not save, please try again');
    }
  }

  /* ---------- Rendering ---------- */
  let loaderTimer;
  function loading(on, delay = 140) {
    clearTimeout(loaderTimer);
    if (on) loaderTimer = setTimeout(() => { el.loader.hidden = false; }, delay);
    else el.loader.hidden = true;
  }

  function clearInfo() {
    el.name.textContent = '';
    el.meta.textContent = '';
    el.actions.hidden = true;
  }

  function showMessage(parts) {
    const p = document.createElement('p');
    for (const x of parts) {
      if (typeof x === 'string') p.append(x);
      else { const c = document.createElement('code'); c.textContent = x.code; p.append(c); }
    }
    el.message.replaceChildren(p);
    el.message.hidden = false;
    el.single.hidden = true;
    el.grid.hidden = true;
  }

  function fail(e, g) {
    if (!e || e === STALE || e.kind === 'stale' || g !== S.gen) return;
    loading(false);
    clearInfo();
    el.count.textContent = '';
    if (e.kind === 'network') {
      showMessage(['Could not reach Scryfall. Check your connection, then hit ', { code: 'Draw' }, ' again.']);
    } else if (e.kind === 'allSeen' && S.set) {
      showMessage([`You have seen all ${fmtNum(S.total)} illustrations of ${S.set.name}${S.q ? ' matching this filter' : ''}! Pick another set, or choose `, { code: 'All cards' }, ' in ', { code: 'Sets' }, ' to see them again.']);
    } else if (e.kind === 'allSeen') {
      showMessage([`You have seen all ${fmtNum(S.total)} illustrations in this selection! Pick another filter, turn off `, { code: 'Hide seen' }, ' or clear your history from ', { code: 'Seen' }, '.']);
    } else if (e.kind === 'empty' || e.status === 404) {
      showMessage(['No illustration matches ', { code: S.q || 'all' }, '. Try for example ', { code: 'art:forest' }, ', ', { code: 't:dragon' }, ' or ', { code: 'artist:"John Avon"' }, '.']);
    } else {
      showMessage(['Scryfall did not understand this filter: ', e.message || 'unknown error', ' (syntax at scryfall.com/docs/syntax)']);
    }
  }

  function updateCount() {
    if (!S.total) { el.count.textContent = ''; return; }
    const total = fmtNum(S.total);
    el.count.textContent = S.mode === 'one'
      ? `Draw #${fmtNum(S.pos + 1)} · ${total} illustrations in this selection`
      : `Sheet ${fmtNum(Math.floor(S.pos / S.gridN) + 1)} · ${total} illustrations in this selection`;
  }

  function showInfo(c) {
    el.name.textContent = c.name;
    const strong = document.createElement('strong');
    strong.textContent = c.artist;
    el.meta.replaceChildren('Illustrated by ', strong, c.set ? ` · ${c.set}${c.year ? ' (' + c.year + ')' : ''}` : '');
    el.lnkScry.href = c.uri;
    el.lnkArt.href = 'https://www.artstation.com/search?sort_by=relevance&query=' + encodeURIComponent(c.artist);
    el.actions.hidden = false;
    syncRateOne();
  }

  async function renderOne() {
    const r = ++S.renderId;
    const g = S.gen;
    el.message.hidden = true;
    el.grid.hidden = true;
    el.single.hidden = false;
    if (!S.history[S.pos]) {
      loading(true);
      try { await ensure(S.pos + 1); } catch (e) { fail(e, g); return; }
      if (r !== S.renderId) return;
    }
    const c = S.history[S.pos];
    const url = srcOf(c, 'one');
    if (el.art.dataset.url !== url) {
      el.art.dataset.url = url;
      loading(!isReady(url));
      el.art.src = url;
    } else {
      loading(false);
    }
    el.art.alt = `${c.name}, illustrated by ${c.artist}`;
    showInfo(c);
    updateCount();
    markSeen([c]);
    ensure(S.pos + AHEAD + 1, { partial: true }).then(() => {
      if (g !== S.gen) return;
      for (let i = S.pos + 1; i <= S.pos + AHEAD; i++) if (S.history[i]) preload(srcOf(S.history[i], 'one'));
    }).catch(() => {});
  }

  function gridSize() {
    const w = el.main.clientWidth - 32;
    const h = el.main.clientHeight - 32;
    const ratio = S.fmt === 'art' ? 626 / 457 : 488 / 680;
    const gap = 10;
    const cols = Math.max(2, Math.round(w / (S.fmt === 'art' ? 270 : 190)));
    const tileW = (w - gap * (cols - 1)) / cols;
    const rows = Math.max(2, Math.floor((h + gap) / (tileW / ratio + gap)));
    return { cols, n: cols * rows };
  }

  function tile(c, onOpen) {
    const fig = document.createElement('figure');
    fig.className = 'tile';
    fig.dataset.ill = c.ill;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'open';
    open.setAttribute('aria-label', `Enlarge ${c.name}, illustrated by ${c.artist}`);
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.addEventListener('error', () => fig.classList.add('broken'), { once: true });
    img.src = srcOf(c, 'grid');
    open.append(img);
    open.addEventListener('click', onOpen);
    const cap = document.createElement('figcaption');
    const b = document.createElement('b');
    b.textContent = c.name;
    cap.append(b, document.createElement('br'), c.artist);
    const rate = document.createElement('div');
    rate.className = 'rate';
    rate.setAttribute('role', 'group');
    rate.setAttribute('aria-label', `Rating: ${c.name}`);
    buildRate(rate, () => c);
    paintRate(rate, levelOf(c));
    fig.append(open, cap, rate);
    return fig;
  }

  async function renderGrid() {
    const r = ++S.renderId;
    const g = S.gen;
    el.message.hidden = true;
    el.single.hidden = true;
    el.grid.hidden = false;
    const { cols, n } = gridSize();
    S.gridN = n;
    el.grid.style.setProperty('--cols', cols);
    if (S.history.length < S.pos + n) {
      loading(true);
      try { await ensure(S.pos + n, { partial: true }); } catch (e) { fail(e, g); return; }
      if (r !== S.renderId) return;
    }
    loading(false);
    const shown = S.history.slice(S.pos, S.pos + n);
    const frag = document.createDocumentFragment();
    shown.forEach((c, i) => {
      const idx = S.pos + i;
      frag.append(tile(c, () => { S.pos = idx; setMode('one'); }));
    });
    el.grid.replaceChildren(frag);
    el.grid.scrollTop = 0;
    el.name.textContent = `Sheet ${fmtNum(Math.floor(S.pos / n) + 1)}`;
    el.meta.textContent = `${shown.length} illustrations · click an image to enlarge it`;
    el.actions.hidden = true;
    updateCount();
    markSeen(shown);
    ensure(S.pos + 2 * n, { partial: true }).then(() => {
      if (g !== S.gen) return;
      S.history.slice(S.pos + n, S.pos + 2 * n).forEach((c) => preload(srcOf(c, 'grid')));
    }).catch(() => {});
  }

  function render() { if (S.mode === 'grid') renderGrid(); else renderOne(); }

  function step(d) {
    if (!S.nPages || !el.message.hidden) return;
    if (S.mode === 'one') {
      const t = Math.max(0, S.pos + d);
      if (t === S.pos) return;
      S.pos = t;
      renderOne();
    } else {
      const t = d > 0 ? S.pos + S.gridN : Math.max(0, S.pos - S.gridN);
      if (t === S.pos) return;
      S.pos = t;
      renderGrid();
    }
  }

  /* ---------- Starting a selection ---------- */
  async function start(raw) {
    const q = (raw || '').trim();
    const g = ++S.gen;
    S.renderId++;
    Object.assign(S, { q, total: 0, nPages: 0, pages: [], pool: [], seen: new Set(), inflight: new Set(), recent: [], recycles: 0, history: [], pos: 0, take: PER_PAGE, cycleAdded: 0 });
    el.q.value = q;
    syncPresets();
    savePrefs();
    el.message.hidden = true;
    el.grid.replaceChildren();
    el.art.removeAttribute('src');
    el.art.dataset.url = '';
    el.single.hidden = S.mode !== 'one';
    el.grid.hidden = S.mode !== 'grid';
    clearInfo();
    el.count.textContent = '';
    loading(true, 0);
    try {
      const j = await api(pageUrl(q, 1));
      if (g !== S.gen) return;
      S.total = j.total_cards || (j.data || []).length;
      S.nPages = Math.max(1, Math.ceil(S.total / PAGE));
      if (S.nPages <= SMALL) {
        // Small selection: load everything and shuffle it all.
        S.take = Infinity;
        addCards(j.data, 1);
        S.pages = shuffle(range(2, S.nPages));
        while (S.pages.length) loadPage();
        await Promise.all(S.inflight);
        if (g !== S.gen) return;
      } else {
        // Large selection: page 1 is just the start of the alphabet, so it goes back into the draw.
        // Random pages then load in parallel.
        S.take = PER_PAGE;
        S.pages = shuffle(range(1, S.nPages));
        topUp();
      }
      if (g !== S.gen) return;
      render();
    } catch (e) {
      fail(e, g);
    }
  }

  /* ---------- Modes ---------- */
  function applyModeUI() {
    el.modeOne.setAttribute('aria-pressed', String(S.mode === 'one'));
    el.modeGrid.setAttribute('aria-pressed', String(S.mode === 'grid'));
    document.body.classList.toggle('is-grid', S.mode === 'grid');
  }
  function applyFmtUI() {
    el.fmtArt.setAttribute('aria-pressed', String(S.fmt === 'art'));
    el.fmtCard.setAttribute('aria-pressed', String(S.fmt === 'card'));
    document.body.classList.toggle('fmt-card', S.fmt === 'card');
  }
  function applyFilterUI() {
    el.extras.setAttribute('aria-pressed', String(S.extras));
    el.noUb.setAttribute('aria-pressed', String(S.noUB));
    el.hideSeen.setAttribute('aria-pressed', String(S.hideSeen));
    // A dot on the options button when a filter is not at its default value.
    el.optDot.hidden = S.hideSeen && S.noUB && !S.extras;
    el.setChip.hidden = !S.set;
    if (S.set) {
      const x = document.createElement('span');
      x.className = 'x';
      x.setAttribute('aria-hidden', 'true');
      x.textContent = '×';
      el.setChip.replaceChildren(iconEl(S.set.icon), S.set.name, x);
      el.setChip.setAttribute('aria-label', `Set: ${S.set.name}. Click to remove.`);
    }
  }
  function savePrefs() { store.set(PKEY, { q: S.q, mode: S.mode, fmt: S.fmt, extras: S.extras, noUB: S.noUB, hideSeen: S.hideSeen, set: S.set }); }
  function setExtras(on) { S.extras = on; applyFilterUI(); start(S.q); }
  function setNoUb(on) { S.noUB = on; applyFilterUI(); start(S.q); }
  function setHideSeen(on) { S.hideSeen = on; applyFilterUI(); start(S.q); }
  function setMode(m) {
    S.mode = m;
    applyModeUI();
    savePrefs();
    if (S.nPages && el.message.hidden) render();
  }
  function setFmt(f) {
    S.fmt = f;
    applyFmtUI();
    savePrefs();
    el.art.dataset.url = '';
    if (S.nPages && el.message.hidden) render();
  }

  function buildPresets() {
    for (const [label, q, needsExtras] of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.dataset.q = q;
      b.title = q || 'All cards';
      b.addEventListener('click', () => {
        if (needsExtras && !S.extras) { S.extras = true; applyFilterUI(); }
        el.topicsMenu.open = false;
        start(q);
      });
      el.presets.append(b);
    }
  }
  function syncPresets() {
    let label = 'Topics';
    el.presets.querySelectorAll('.chip').forEach((b) => {
      const on = b.dataset.q === S.q;
      b.setAttribute('aria-pressed', String(on));
      if (on && S.q) label = b.textContent;
    });
    el.topicLabel.textContent = label;
  }

  /* ---------- Favorites ---------- */
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1400);
  }

  function syncRateOne() {
    const c = S.mode === 'one' ? S.history[S.pos] : null;
    paintRate(el.rateOne, levelOf(c));
  }

  function syncCounts() {
    el.favCount.textContent = fmtNum(ratings.size);
    el.accFavs.textContent = fmtNum(ratings.size);
    el.seenCount.textContent = fmtNum(everSeen.size);
    el.accSeen.textContent = fmtNum(everSeen.size);
  }

  function syncFav() {
    syncCounts();
    syncRateOne();
    el.grid.querySelectorAll('.tile').forEach((t) => paintRate(t.querySelector('.rate'), ratings.get(t.dataset.ill)?.level || 0));
    if (!el.favPanel.hidden) renderFavPanel();
  }

  const favList = () => [...ratings.values()].filter((c) => !S.favLevel || c.level === S.favLevel);

  function renderFavTabs() {
    const counts = [ratings.size, 0, 0, 0];
    for (const c of ratings.values()) counts[c.level]++;
    el.favTabs.replaceChildren(...[0, 1, 2, 3].map((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-pressed', String(S.favLevel === n));
      if (n) {
        const h = document.createElement('span');
        h.className = 'hearts-txt';
        h.textContent = hearts(n);
        b.append(h, ' ' + LEVEL_NAMES[n]);
      } else {
        b.append('All');
      }
      const k = document.createElement('span');
      k.className = 'n';
      k.textContent = fmtNum(counts[n]);
      b.append(k);
      b.addEventListener('click', () => { S.favLevel = n; renderFavPanel(); });
      return b;
    }));
  }

  function renderFavPanel() {
    renderFavTabs();
    const list = favList();
    el.favEmpty.hidden = list.length > 0;
    el.favEmpty.textContent = ratings.size
      ? `No ${hearts(S.favLevel)} illustrations yet.`
      : 'No favorites yet. While browsing, press 1, 2 or 3 (or click the hearts) to keep an illustration here.';
    el.favCopy.disabled = !list.length;
    el.favGrid.replaceChildren(...list.map((c) => tile(c, () => openFav(c))));
  }

  function openFav(c) {
    closePanels();
    if (S.mode === 'one' && S.history.length) { S.history.splice(S.pos + 1, 0, c); S.pos++; }
    else { S.history.splice(S.pos, 0, c); }
    if (!S.nPages) return;
    setMode('one');
  }

  function openFavPanel() { renderFavPanel(); el.favPanel.hidden = false; el.favClose.focus(); }
  function openAccPanel() { syncCounts(); resetArm(); el.accPanel.hidden = false; el.accClose.focus(); }
  function closePanels() {
    const opener = !el.favPanel.hidden ? el.favBtn : !el.accPanel.hidden ? el.accBtn : !el.setPanel.hidden ? el.setBtn : null;
    el.favPanel.hidden = true;
    el.accPanel.hidden = true;
    el.setPanel.hidden = true;
    if (opener) opener.focus();
  }
  const panelOpen = () => !el.favPanel.hidden || !el.accPanel.hidden || !el.setPanel.hidden;

  /* ---------- Sets ---------- */
  const SET_TYPES = [
    ['all', 'All', null],
    ['main', 'Expansions & core', ['expansion', 'core']],
    ['masters', 'Masters & remasters', ['masters', 'eternal', 'draft_innovation']],
    ['commander', 'Commander', ['commander']],
    ['other', 'Other', null],
  ];
  const KNOWN_TYPES = new Set(SET_TYPES.flatMap(([, , t]) => t || []));
  let sets = [];
  let setType = 'main';
  let openSet = null;

  function setMatchesType(x) {
    if (setType === 'all') return true;
    if (setType === 'other') return !KNOWN_TYPES.has(x.type);
    return SET_TYPES.find(([k]) => k === setType)[2].includes(x.type);
  }

  function iconEl(url) {
    const i = document.createElement('span');
    i.className = 'set-icon';
    i.setAttribute('aria-hidden', 'true');
    if (url) i.style.setProperty('--icon', `url("${url}")`);
    return i;
  }

  function renderSetTypes() {
    el.setTypes.replaceChildren(...SET_TYPES.map(([k, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(setType === k));
      b.addEventListener('click', () => { setType = k; renderSetTypes(); renderSetList(); });
      return b;
    }));
  }

  function renderSetList() {
    const needle = el.setSearch.value.trim().toLowerCase();
    const list = sets.filter((x) => (needle
      ? x.name.toLowerCase().includes(needle) || x.code.toLowerCase() === needle
      : setMatchesType(x)));
    el.setEmpty.hidden = list.length > 0;
    el.setEmpty.textContent = sets.length ? 'No set matches this search.' : 'The set catalog is empty. Run bin/rails catalog:import on the server.';
    el.setList.replaceChildren(...list.map(setRow));
  }

  function setRow(x) {
    const li = document.createElement('li');
    li.className = 'set-row';
    li.classList.toggle('open', openSet === x.code);
    li.classList.toggle('current', S.set?.code === x.code);
    li.classList.toggle('done', x.total > 0 && x.seen >= x.total);

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'set-main';
    main.setAttribute('aria-expanded', String(openSet === x.code));

    const info = document.createElement('span');
    info.className = 'set-info';
    const name = document.createElement('div');
    name.className = 'set-name';
    name.textContent = x.name;
    const sub = document.createElement('div');
    sub.className = 'set-sub';
    sub.textContent = [x.code.toUpperCase(), x.year, x.type.replace(/_/g, ' ')].filter(Boolean).join(' · ');
    info.append(name, sub);

    const prog = document.createElement('span');
    prog.className = 'set-progress';
    const bar = document.createElement('span');
    bar.className = 'set-bar';
    const fill = document.createElement('i');
    fill.style.width = `${x.total ? Math.min(100, (100 * x.seen) / x.total) : 0}%`;
    bar.append(fill);
    const label = document.createElement('span');
    label.textContent = `${fmtNum(x.seen)} / ${fmtNum(x.total)} seen`;
    prog.append(bar, label);

    const favs = document.createElement('span');
    favs.className = 'set-favs' + (x.favs ? '' : ' zero');
    favs.textContent = `♥ ${fmtNum(x.favs)}`;
    favs.title = `${x.favs} favorite${x.favs === 1 ? '' : 's'} in this set`;

    main.append(iconEl(x.icon), info, prog, favs);
    main.addEventListener('click', () => { openSet = openSet === x.code ? null : x.code; renderSetList(); });
    li.append(main);

    if (openSet === x.code) {
      const actions = document.createElement('div');
      actions.className = 'set-actions';
      const unseen = Math.max(0, x.total - x.seen);
      const mk = (text, cls, hide) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ghost' + (cls ? ' ' + cls : '');
        b.textContent = text;
        b.addEventListener('click', () => chooseSet(x, hide));
        return b;
      };
      const onlyNew = mk(`Unseen only (${fmtNum(unseen)})`, 'primary', true);
      onlyNew.disabled = unseen === 0;
      actions.append(onlyNew, mk(`All cards (${fmtNum(x.total)})`, '', false));
      li.append(actions);
    }
    return li;
  }

  function chooseSet(x, hideSeen) {
    S.set = { code: x.code, name: x.name, icon: x.icon };
    S.hideSeen = hideSeen;
    applyFilterUI();
    closePanels();
    start(S.q);
  }

  function clearSet() {
    S.set = null;
    applyFilterUI();
    start(S.q);
  }

  async function openSetPanel() {
    el.setPanel.hidden = false;
    renderSetTypes();
    el.setSearch.focus();
    if (!sets.length) { el.setEmpty.hidden = false; el.setEmpty.textContent = 'Loading sets…'; }
    await flushSeen();
    try {
      sets = await server('GET', '/api/sets');
    } catch (e) {
      if (!sets.length) { el.setEmpty.textContent = 'Could not load sets.'; return; }
    }
    if (S.set) openSet = S.set.code;
    renderSetList();
    if (S.set) el.setList.querySelector('.set-row.current')?.scrollIntoView({ block: 'center' });
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  // "Clear seen history" needs a confirmation (second click).
  let armed = false;
  let armTimer;
  function resetArm() { armed = false; clearTimeout(armTimer); el.seenReset.textContent = 'Clear seen history'; }

  // Favorites from the old prototype (localStorage): imported once, with one heart.
  async function importLegacyFavs() {
    const old = store.get(LEGACY_FKEY, null);
    if (!Array.isArray(old) || !old.length) return;
    let n = 0;
    for (const c of old) {
      if (!c || !c.ill || ratings.has(c.ill)) continue;
      try {
        const { pg, ...card } = c;
        await server('PUT', `/api/ratings/${encodeURIComponent(c.ill)}`, { level: 1, card });
        ratings.set(c.ill, { ...card, level: 1 });
        everSeen.add(c.ill);
        n++;
      } catch (e) { return; } // retry on the next visit
    }
    try { localStorage.removeItem(LEGACY_FKEY); } catch (e) { /* ignore */ }
    if (n) { syncFav(); toast(`${n} old favorite${n > 1 ? 's' : ''} imported (♥)`); }
  }

  /* ---------- Events ---------- */
  el.form.addEventListener('submit', (e) => { e.preventDefault(); el.q.blur(); start(el.q.value); });
  el.modeOne.addEventListener('click', () => setMode('one'));
  el.modeGrid.addEventListener('click', () => setMode('grid'));
  el.fmtArt.addEventListener('click', () => setFmt('art'));
  el.fmtCard.addEventListener('click', () => setFmt('card'));
  el.extras.addEventListener('click', () => setExtras(!S.extras));
  el.noUb.addEventListener('click', () => setNoUb(!S.noUB));
  el.hideSeen.addEventListener('click', () => setHideSeen(!S.hideSeen));
  el.hitPrev.addEventListener('click', () => step(-1));
  el.hitNext.addEventListener('click', () => step(1));
  buildRate(el.rateOne, () => (S.mode === 'one' ? S.history[S.pos] : null));
  el.favBtn.addEventListener('click', openFavPanel);
  el.accBtn.addEventListener('click', () => { closeMenus(); openAccPanel(); });
  el.favClose.addEventListener('click', closePanels);
  el.accClose.addEventListener('click', closePanels);
  el.setBtn.addEventListener('click', openSetPanel);
  el.setClose.addEventListener('click', closePanels);
  el.setChip.addEventListener('click', clearSet);
  el.setSearch.addEventListener('input', () => { openSet = null; renderSetList(); });
  el.favCopy.addEventListener('click', async () => {
    const list = favList();
    const text = list.map((f) => `${hearts(f.level)} ${f.name} — ${f.artist}${f.set ? ' (' + f.set + (f.year ? ', ' + f.year : '') + ')' : ''} ${f.uri}`).join('\n');
    const ok = await copyText(text);
    toast(ok ? `List copied (${list.length})` : 'Copy is not available in this browser');
  });
  el.seenReset.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      el.seenReset.textContent = `Confirm: forget ${fmtNum(everSeen.size)} illustrations`;
      armTimer = setTimeout(resetArm, 4000);
      return;
    }
    resetArm();
    try {
      seenQueue.clear();
      await server('DELETE', '/api/seen');
      everSeen.clear();
      syncCounts();
      toast('Seen history cleared');
      closePanels();
      start(S.q);
    } catch (e) {
      toast('Failed, please try again');
    }
  });

  // Drop-down menus: only one open at a time, closed by an outside click or Escape.
  const menus = [el.topicsMenu, el.optMenu];
  const closeMenus = (except) => menus.forEach((m) => { if (m !== except) m.open = false; });
  const menuOpen = () => menus.some((m) => m.open);
  menus.forEach((m) => m.addEventListener('toggle', () => { if (m.open) closeMenus(m); }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });

  let touchX = null;
  el.single.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  el.single.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) { e.preventDefault(); step(dx < 0 ? 1 : -1); }
  });

  el.art.addEventListener('load', () => loading(false));
  el.art.addEventListener('error', () => {
    if (!el.art.getAttribute('src')) return;
    loading(false);
    el.meta.append(' · image indisponible');
  });

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, select');
    if (e.key === 'Escape') {
      if (menuOpen()) { closeMenus(); return; }
      if (panelOpen()) closePanels();
      else if (typing) e.target.blur();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (panelOpen() || menuOpen()) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      step(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (k === 'g') {
      setMode(S.mode === 'one' ? 'grid' : 'one');
    } else if (k === 'c') {
      setFmt(S.fmt === 'art' ? 'card' : 'art');
    } else if (/^[0-3]$/.test(e.key) && S.mode === 'one') {
      const c = S.history[S.pos];
      const n = +e.key;
      if (c) setLevel(c, n && levelOf(c) === n ? 0 : n);
    } else if (k === 'o' && S.mode === 'one') {
      const c = S.history[S.pos];
      if (c) window.open(c.uri, '_blank', 'noopener');
    } else if (e.key === '/') {
      e.preventDefault();
      el.q.focus();
      el.q.select();
    }
  });

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (S.mode === 'grid' && S.nPages && !el.grid.hidden && gridSize().n !== S.gridN) renderGrid();
    }, 160);
  });

  /* ---------- Startup ---------- */
  const prefs = store.get(PKEY, {}) || {};
  S.mode = prefs.mode === 'grid' ? 'grid' : 'one';
  S.fmt = prefs.fmt === 'card' ? 'card' : 'art';
  S.extras = prefs.extras === true;
  S.noUB = prefs.noUB !== false;
  S.hideSeen = prefs.hideSeen !== false;
  S.set = prefs.set && typeof prefs.set.code === 'string' ? prefs.set : null;
  applyModeUI();
  applyFmtUI();
  applyFilterUI();
  buildPresets();

  (async () => {
    loading(true, 0);
    try {
      const st = await server('GET', '/api/state');
      for (const i of st.seen) everSeen.add(i);
      for (const c of st.ratings) ratings.set(c.ill, c);
    } catch (e) {
      toast('Could not load your history');
    }
    syncFav();
    start(typeof prefs.q === 'string' ? prefs.q : '');
    importLegacyFavs();
  })();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
