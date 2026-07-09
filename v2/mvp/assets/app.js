const DATA = JSON.parse(document.getElementById('cards-data').textContent);
const CARDS = DATA.cards;

// MVP：作答只存内存，刷新/重新打开即全新状态
let answers = {};

// v2：资产类状态持久化（保存/画像），作答仍不落盘
const store = {
  read(key, fb) { try { const v = JSON.parse(localStorage.getItem('kcf.' + key)); return v === null || v === undefined ? fb : v; } catch { return fb; } },
  write(key, val) { try { localStorage.setItem('kcf.' + key, JSON.stringify(val)); } catch { /* 隐私模式等场景下静默降级为内存态 */ } }
};
const saved = store.read('saved', {});       // id -> {at}
const portrait = store.read('portrait', {}); // id -> {key, note, at}
const follows = store.read('follows', {});   // id -> {at, special}
const persistSaved = () => store.write('saved', saved);
const persistPortrait = () => store.write('portrait', portrait);
const persistFollows = () => store.write('follows', follows);

const $ = (sel, el) => (el || document).querySelector(sel);
const screen = $('#screen');
const feedView = $('#view-feed');
const detailView = $('#view-detail');
const profileView = $('#view-profile');

const fmt = n => n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function relTime(ts) {
  const d = Date.now() - ts;
  if (d < 60e3) return '刚刚';
  if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
  if (d < 86400e3) return Math.floor(d / 3600e3) + ' 小时前';
  return Math.floor(d / 86400e3) + ' 天前';
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
document.querySelectorAll('[data-toast]').forEach(b =>
  b.addEventListener('click', () => toast(b.dataset.toast)));

/* ---------- views & tabbar ---------- */
const topicsView = $('#view-topics');

function showView(el, keepScroll) {
  [feedView, detailView, profileView, topicsView].forEach(v => v.classList.toggle('active', v === el));
  if (!keepScroll) screen.scrollTop = 0;
}
function setTabbar(which) {
  $('#tab-home').classList.toggle('on', which === 'home');
  $('#tab-topics').classList.toggle('on', which === 'topics');
  $('#tab-me').classList.toggle('on', which === 'me');
}
$('#tab-home').addEventListener('click', () => { renderFeed(); showView(feedView); setTabbar('home'); });
$('#tab-topics').addEventListener('click', () => { renderTopics(); showView(topicsView); setTabbar('topics'); });
$('#tab-me').addEventListener('click', () => { renderProfile(); showView(profileView); setTabbar('me'); });

/* ---------- feed（推荐 / 关注 双模式） ---------- */
let feedMode = 'rec';

$('#tab-rec').addEventListener('click', () => { feedMode = 'rec'; renderFeedHead(); renderFeed(); });
$('#tab-follow').addEventListener('click', () => { feedMode = 'follow'; renderFeedHead(); renderFeed(); });
function renderFeedHead() {
  $('#tab-rec').classList.toggle('on', feedMode === 'rec');
  $('#tab-follow').classList.toggle('on', feedMode === 'follow');
}

const UPDATE_KIND = { answer_update: '答案更新', hot_comment: '热评', dist_shift: '分布变化' };

function followItemHtml(x) {
  const ups = (window.KCF_SOCIAL && window.KCF_SOCIAL[x.id] && window.KCF_SOCIAL[x.id].updates) || [];
  const done = answers[x.id];
  return `
  <article class="qcard f-item" data-id="${x.id}">
    <div class="f-row">
      <h2>${esc(x.card.title)}</h2>
      <button class="f-star ${x.special ? 'on' : ''}" data-id="${x.id}" aria-label="特别关注">
        <svg width="17" height="17" viewBox="0 0 15 15" fill="${x.special ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M7.5 1.8l1.7 3.5 3.9.6-2.8 2.7.7 3.9-3.5-1.9-3.5 1.9.7-3.9-2.8-2.7 3.9-.6z"/></svg>
      </button>
    </div>
    ${ups.map(u => `<div class="f-up"><span class="f-up-k">${UPDATE_KIND[u.kind] || '更新'}</span>${esc(u.text)}</div>`).join('')}
    <div class="meta">
      <span class="chip">${x.card.type}</span>
      <span>关注于 ${relTime(x.at)}</span>
      ${done ? `<span class="done">已选 ${done}</span>` : ''}
    </div>
  </article>`;
}

function renderFollowList(list) {
  const items = Object.entries(follows)
    .map(([id, v]) => ({ id, ...v, card: CARDS.find(c => c.id === id) }))
    .filter(x => x.card)
    .sort((a, b) => b.at - a.at);
  if (!items.length) {
    list.innerHTML = '<div class="feed-empty">还没有关注的问题<br><small>进入题目，点「关注问题」，答案与评论的更新会聚合在这里</small></div>';
    return;
  }
  const special = items.filter(x => x.special);
  const normal = items.filter(x => !x.special);
  list.innerHTML = `
    ${special.length ? '<div class="f-sec">特别关注</div>' + special.map(followItemHtml).join('') : ''}
    ${normal.length ? '<div class="f-sec">关注的问题</div>' + normal.map(followItemHtml).join('') : ''}
  `;
  list.querySelectorAll('.f-item').forEach(el =>
    el.addEventListener('click', () => openDetail(el.dataset.id)));
  list.querySelectorAll('.f-star').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const f = follows[b.dataset.id];
      f.special = !f.special;
      persistFollows();
      renderFeed();
      toast(f.special ? '已特别关注，更新置顶展示' : '已取消特别关注');
    }));
}

function renderFeed() {
  const list = $('#feed-list');
  if (feedMode === 'follow') { renderFollowList(list); return; }
  list.innerHTML = CARDS.map(c => {
    const done = answers[c.id];
    const preview = c.options.map(o => `<b>${o.key}</b> ${esc(o.text)}`).join('　');
    return `
    <article class="qcard" data-id="${c.id}">
      <h2>${esc(c.title)}</h2>
      <div class="opts-preview">${preview}</div>
      <div class="meta">
        <span class="chip">${c.type}</span>
        <span>${fmt(c.stats.chosen)} 人已选 · ${fmt(c.stats.follow)} 关注</span>
        ${done ? `<span class="done"><svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7l3 3 6-7"/></svg>已选 ${done}</span>` : ''}
      </div>
    </article>`;
  }).join('');
  list.querySelectorAll('.qcard').forEach(el =>
    el.addEventListener('click', () => openDetail(el.dataset.id)));
}

/* ---------- detail ---------- */
let currentId = null;

function openDetail(id) {
  currentId = id;
  const c = CARDS.find(x => x.id === id);
  detailView.innerHTML = `
    <div class="nav">
      <button class="back" aria-label="返回" id="btn-back">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#121212" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4.5 7 11l6.5 6.5"/></svg>
      </button>
      <span class="nav-title">买车决策</span>
      <span class="spacer">
        <svg width="19" height="19" viewBox="0 0 19 19" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="4" cy="9.5" r="1.6"/><circle cx="9.5" cy="9.5" r="1.6"/><circle cx="15" cy="9.5" r="1.6"/></svg>
      </span>
    </div>
    <div class="detail-body">
      <div class="chip-row"><span class="chip">${esc(c.domain)}</span><span class="chip">${c.type}</span></div>
      <h1>${esc(c.title)}</h1>
      <div class="meta"><span>${fmt(c.stats.chosen)} 人已选 · ${fmt(c.stats.follow)} 人关注了本题</span></div>
    </div>
    <div class="section" id="sec-options"></div>
    <div id="reveal-zone"></div>
    <div class="detail-pad"></div>
  `;
  $('#btn-back').addEventListener('click', backToFeed);
  const picked = answers[id];
  if (picked) renderResult(c, picked, false);
  else renderChoosing(c);
  showView(detailView);
  setTabbar('home');
}

function backToFeed() {
  renderFeed();
  showView(feedView, true);
  setTabbar('home');
}

function renderChoosing(c) {
  const sec = $('#sec-options');
  sec.innerHTML = `
    <div class="section-label">做出你的判断 <small>选择后揭示平台答案与分布</small></div>
    ${c.options.map(o => `
      <button class="opt-btn" data-key="${o.key}">
        <span class="opt-key">${o.key}</span>
        <span>${esc(o.text)}</span>
      </button>`).join('')}
  `;
  sec.querySelectorAll('.opt-btn').forEach(b =>
    b.addEventListener('click', () => {
      answers[c.id] = b.dataset.key;
      renderResult(c, b.dataset.key, true);
    }));
}

function renderResult(c, picked, animate) {
  const sec = $('#sec-options');
  sec.innerHTML = `
    <div class="section-label">选择分布 <button class="redo-btn" id="btn-redo">↺ 重新选择</button></div>
    <div class="seg" id="seg">
      <button class="on" data-mode="all">整体</button>
      <button data-mode="tiers">按用户分层</button>
    </div>
    ${c.options.map(o => `
      <div class="opt-res ${o.key === picked ? 'mine' : ''}">
        ${o.key === picked ? '<span class="mine-tag">你的选择</span>' : ''}
        <div class="row1"><span class="k">${o.key}</span><span>${esc(o.text)}</span><span class="pct">${o.pct}%</span></div>
        <div class="bar"><i data-w="${o.pct}"></i></div>
        <div class="tier-wrap">
          ${[['普通用户', o.tiers.normal], ['高价值', o.tiers.high], ['超高价值', o.tiers.super]].map(([label, v]) => `
            <div class="tier-row">
              <span class="t-label">${label}</span>
              <div class="bar"><i data-w="${v}" style="width:${v}%"></i></div>
              <span class="t-pct">${v}%</span>
            </div>`).join('')}
        </div>
      </div>`).join('')}
    <div class="dist-note">高价值用户 = 在该领域获得高认同的用户（演示数据）</div>
    ${expertsHtml(c)}
  `;

  // animate overall bars
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sec.querySelectorAll('.opt-res > .bar > i').forEach(i => { i.style.width = i.dataset.w + '%'; });
  }));

  // undo the answer, back to choosing
  $('#btn-redo').addEventListener('click', () => {
    delete answers[c.id];
    $('#reveal-zone').innerHTML = '';
    renderChoosing(c);
    screen.scrollTop = 0;
  });

  // tier toggle
  $('#seg', sec).querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => {
      $('#seg', sec).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      const show = b.dataset.mode === 'tiers';
      sec.querySelectorAll('.tier-wrap').forEach(w => w.classList.toggle('show', show));
    }));

  renderReveal(c, picked, animate);
}

/* ---------- 高手怎么选：高价值用户样本（示意数据） ---------- */
function expertsHtml(c) {
  const ex = (window.KCF_SOCIAL && window.KCF_SOCIAL[c.id] && window.KCF_SOCIAL[c.id].experts) || [];
  if (!ex.length) return '';
  return `
    <div class="experts">
      <div class="experts-head">高手怎么选 <small>高价值用户样本 · 示意数据</small></div>
      ${ex.map(x => `
        <div class="exp">
          <div class="exp-head">
            <span class="exp-name">${esc(x.name)}</span>
            <span class="exp-tag">${esc(x.tag)}</span>
            <span class="exp-tier ${x.tier}">${x.tier === 'super' ? '超高价值' : '高价值'}</span>
            <span class="exp-pick">选 ${esc(x.pick)}</span>
          </div>
          <p class="exp-line">${esc(x.line)}</p>
        </div>`).join('')}
    </div>`;
}

function renderReveal(c, picked, animate) {
  const zone = $('#reveal-zone');
  const d = i => animate ? `reveal d${i}` : '';
  zone.innerHTML = `
    <div class="section ${d(1)}">
      <div class="section-label">平台答案 <small>每个选项的成立条件与盲区</small></div>
      ${c.options.map(o => `
        <div class="ans ${o.key === picked ? 'open' : ''}">
          <button class="ans-head">
            <span class="k">${o.key}</span>
            <span>${esc(o.text)}</span>
            <svg class="caret" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5 7 9.5l4-4"/></svg>
          </button>
          <div class="ans-body">
            <p class="why"><span class="sign">✓</span><b>为什么有人选它：</b>${esc(o.reason)}</p>
            <p class="blind"><span class="sign">!</span><b>它忽略了：</b>${esc(o.blindspot)}</p>
          </div>
        </div>`).join('')}
    </div>
    <div class="section ${d(2)}">
      <div class="section-label">核心维度 <small>这道题真正在比什么</small></div>
      <div class="dims">${c.dims.map(t => `<span class="dim">${esc(t)}</span>`).join('')}</div>
    </div>
    <div class="section ${d(3)}">
      <div class="section-label">评论区 <small>与平台答案分层</small></div>
      <div class="cmt-input" id="cmt-input"></div>
      <div class="cmt-filter" id="cmt-filter">
        <button class="on" data-f="all">全部</button>
        <button data-f="same">同维度</button>
        <button data-f="new">新维度</button>
      </div>
      <div id="cmt-list"></div>
    </div>
    <div class="section ${d(4)}">
      <div class="actions" id="act-row"></div>
      <div class="pp" id="pp" hidden></div>
    </div>
    <div class="next-wrap ${d(4)}">
      <button class="next-btn" id="btn-next">${nextLabel()}</button>
    </div>
  `;
  zone.querySelectorAll('.ans-head').forEach(h =>
    h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
  renderActions(c, picked);
  cmtMode = 'all';
  renderComments(c, picked);
  bindCommentFilter(c, picked);
  renderCommentInput(c, picked);
  $('#btn-next').addEventListener('click', () => {
    const nxt = nextUnanswered();
    if (nxt) openDetail(nxt.id);
    else backToFeed();
  });
}

/* ---------- 评论区：与平台答案分层，评论带维度标注 ---------- */
const myComments = {}; // 本次会话发布的评论，不落盘
let cmtMode = 'all';

function commentsOf(c) {
  const mock = (window.KCF_SOCIAL && window.KCF_SOCIAL[c.id] && window.KCF_SOCIAL[c.id].comments) || [];
  return [...(myComments[c.id] || []), ...mock];
}

function renderComments(c, picked) {
  const listEl = $('#cmt-list');
  const items = commentsOf(c).filter(x => cmtMode === 'all' || x.dimType === cmtMode);
  listEl.innerHTML = items.length ? items.map(x => `
    <div class="cmt${x.mine ? ' mine' : ''}">
      <div class="cmt-head">
        <span class="cmt-user">${esc(x.user)}</span>
        <span class="cmt-pick">选 ${esc(x.pick)}</span>
        <span class="cmt-dim ${x.dimType}">${x.dimType === 'same' ? '同维度' : '新维度'}</span>
      </div>
      <p class="cmt-text">${esc(x.text)}</p>
      <button class="cmt-like" data-n="${x.likes}">
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 7.5v4a1 1 0 0 0 1 1h1V6.5h-1a1 1 0 0 0-1 1zM4.5 12.5h6.2a1.5 1.5 0 0 0 1.5-1.2l.8-3.6A1.5 1.5 0 0 0 11.5 5.9H8.8V3.2A1.4 1.4 0 0 0 7.4 1.8c-.2 1.9-1 3.4-2.9 4.4z" stroke-linejoin="round"/></svg>
        <span>${x.likes}</span>
      </button>
    </div>`).join('') : '<div class="empty">这个筛选下还没有评论</div>';
  listEl.querySelectorAll('.cmt-like').forEach(b =>
    b.addEventListener('click', () => {
      const liked = b.classList.toggle('liked');
      b.querySelector('span').textContent = Number(b.dataset.n) + (liked ? 1 : 0);
    }));
}

function bindCommentFilter(c, picked) {
  const bar = $('#cmt-filter');
  bar.querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      cmtMode = b.dataset.f;
      renderComments(c, picked);
    }));
}

function renderCommentInput(c, picked) {
  const box = $('#cmt-input');
  box.innerHTML = `
    <div class="cmt-dims">
      <button class="dim-chip" data-type="same">同维度</button>
      <button class="dim-chip" data-type="new">新维度</button>
    </div>
    <div class="cmt-row">
      <input id="cmt-text" maxlength="120" placeholder="标一个类型，写一条短评">
      <button id="cmt-send">发布</button>
    </div>
    <div class="dist-note">同维度 = 顺着题卡核心维度说；新维度 = 补题卡没提的角度。演示：发布仅本次会话可见</div>
  `;
  let dimSel = null;
  box.querySelectorAll('.dim-chip').forEach(ch =>
    ch.addEventListener('click', () => {
      box.querySelectorAll('.dim-chip').forEach(x => x.classList.toggle('on', x === ch));
      dimSel = ch.dataset.type;
    }));
  $('#cmt-send').addEventListener('click', () => {
    const text = $('#cmt-text').value.trim();
    if (!dimSel) { toast('先标一下：同维度还是新维度'); return; }
    if (!text) { toast('评论还没写呢'); return; }
    (myComments[c.id] = myComments[c.id] || []).unshift({ user: '我', dimType: dimSel, dim: '', pick: picked, text, likes: 0, mine: true });
    $('#cmt-text').value = '';
    renderComments(c, picked);
    toast('已发布（演示：仅本次会话可见）');
  });
}

/* ---------- actions: 保存 / 画像 / 分享 / 关注 ---------- */
function renderActions(c, picked) {
  const row = $('#act-row');
  const isSaved = !!saved[c.id];
  const inPortrait = !!portrait[c.id];
  const isFollowed = !!follows[c.id];
  row.innerHTML = `
    <button id="act-save" class="${isSaved ? 'on' : ''}">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4"><path d="M3.5 2h8a1 1 0 0 1 1 1v10.2L7.5 10 2.5 13.2V3a1 1 0 0 1 1-1z" stroke-linejoin="round"/></svg>
      ${isSaved ? '已保存' : '私密保存'}
    </button>
    <button id="act-portrait" class="${inPortrait ? 'on' : ''}">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="5" r="2.6"/><path d="M1.8 13c.5-2.4 2.3-3.7 4.2-3.7 1 0 1.9.3 2.7.9" stroke-linecap="round"/><path d="M11.5 8.5v5M9 11h5" stroke-linecap="round"/></svg>
      ${inPortrait ? '已入画像' : '存入画像'}
    </button>
    <button id="act-share">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5.5 7.5 12 3M5.5 8.5 12 12.5" stroke-linecap="round"/><circle cx="3.5" cy="8" r="2"/><circle cx="12.5" cy="3" r="2"/><circle cx="12.5" cy="12.5" r="2"/></svg>
      分享
    </button>
    <button id="act-follow" class="${isFollowed ? 'on' : ''}">
      ${isFollowed
        ? '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8l3.5 3.5L12.5 4"/></svg>已关注'
        : '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M7.5 3v9M3 7.5h9"/></svg>关注问题'}
    </button>
  `;
  $('#act-save').addEventListener('click', () => {
    if (saved[c.id]) { delete saved[c.id]; toast('已取消保存'); }
    else { saved[c.id] = { at: Date.now() }; toast('已私密保存，仅自己可见'); }
    persistSaved();
    renderActions(c, picked);
  });
  $('#act-portrait').addEventListener('click', () => togglePortraitPanel(c, picked));
  $('#act-share').addEventListener('click', () => openShare(c, picked));
  $('#act-follow').addEventListener('click', () => {
    if (follows[c.id]) { delete follows[c.id]; toast('已取消关注'); }
    else { follows[c.id] = { at: Date.now(), special: false }; toast('已关注本题，更新会出现在「关注」页'); }
    persistFollows();
    renderActions(c, picked);
  });
}

function togglePortraitPanel(c, picked) {
  const pp = $('#pp');
  if (!pp.hidden) { pp.hidden = true; return; }
  const item = portrait[c.id];
  pp.innerHTML = `
    <textarea id="pp-note" maxlength="80" placeholder="补一句你的判断理由（可选，80 字内）">${item && item.note ? esc(item.note) : ''}</textarea>
    <div class="pp-row">
      <button class="pp-save" id="pp-save">${item ? '更新画像' : '存入画像'}</button>
      ${item ? '<button class="pp-remove" id="pp-remove">移出画像</button>' : ''}
    </div>
    <div class="pp-hint">将出现在「我的」页判断资产区，沉淀你的公开判断记录（演示：仅存本机）</div>
  `;
  pp.hidden = false;
  $('#pp-save').addEventListener('click', () => {
    portrait[c.id] = { key: picked, note: $('#pp-note').value.trim(), at: Date.now() };
    persistPortrait();
    pp.hidden = true;
    renderActions(c, picked);
    toast('已存入个人画像');
  });
  if (item) $('#pp-remove').addEventListener('click', () => {
    delete portrait[c.id];
    persistPortrait();
    pp.hidden = true;
    renderActions(c, picked);
    toast('已移出画像');
  });
}

/* ---------- 图文分享卡（canvas 生成） ---------- */
function shareCanvas(c, picked) {
  const W = 750, PAD = 52, MAXH = 2400;
  const mine = c.options.find(o => o.key === picked);
  const cv = document.createElement('canvas');
  cv.width = W * 2; cv.height = MAXH * 2;
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);
  ctx.textBaseline = 'top';
  const F = (w, s) => `${w} ${s}px -apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif`;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, MAXH);

  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  function countLines(text, maxW, font) {
    ctx.font = font;
    const chars = [...text];
    let line = '', n = 0;
    for (const ch of chars) {
      if (ctx.measureText(line + ch).width > maxW && line) { n++; line = ch; }
      else line += ch;
    }
    return line ? n + 1 : n;
  }

  function wrap(text, x, y, maxW, lh, font, color, maxLines) {
    ctx.font = font; ctx.fillStyle = color;
    const chars = [...text];
    let line = '', lines = 0;
    for (let i = 0; i < chars.length; i++) {
      if (ctx.measureText(line + chars[i]).width > maxW && line) {
        lines++;
        if (maxLines && lines === maxLines) { ctx.fillText(line.slice(0, -1) + '…', x, y); return y + lh; }
        ctx.fillText(line, x, y); y += lh; line = chars[i];
      } else line += chars[i];
    }
    if (line) { ctx.fillText(line, x, y); y += lh; }
    return y;
  }

  let y = PAD;
  // 品牌行
  ctx.font = F(600, 26); ctx.fillStyle = '#056DE8';
  ctx.fillText('知识选择题 · ' + c.domain, PAD, y);
  ctx.font = F(400, 22); ctx.fillStyle = '#999999';
  const tag = '演示数据';
  ctx.fillText(tag, W - PAD - ctx.measureText(tag).width, y + 3);
  y += 26 + 34;

  // 题目
  y = wrap(c.title, PAD, y, W - PAD * 2, 56, F(700, 38), '#121212');
  y += 22;

  // 我的选择框
  const boxTextW = W - PAD * 2 - 48;
  const choiceText = picked + ' · ' + mine.text;
  const boxH = 24 + 24 + 14 + countLines(choiceText, boxTextW, F(600, 32)) * 46 + 20;
  rr(PAD, y, W - PAD * 2, boxH, 16);
  ctx.fillStyle = '#F0F6FE'; ctx.fill();
  ctx.strokeStyle = '#056DE8'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = F(600, 24); ctx.fillStyle = '#056DE8';
  ctx.fillText('我的选择', PAD + 24, y + 24);
  wrap(choiceText, PAD + 24, y + 24 + 24 + 14, boxTextW, 46, F(600, 32), '#121212');
  y += boxH + 34;

  // 分布
  ctx.font = F(600, 26); ctx.fillStyle = '#646464';
  ctx.fillText('选择分布', PAD, y);
  y += 26 + 20;
  for (const o of c.options) {
    const isMine = o.key === picked;
    const pctText = o.pct + '%';
    ctx.font = F(650, 26); ctx.fillStyle = isMine ? '#056DE8' : '#121212';
    const pctW = ctx.measureText(pctText).width;
    ctx.fillText(pctText, W - PAD - pctW, y);
    ctx.font = F(isMine ? 600 : 400, 26);
    let rowText = o.key + ' ' + o.text;
    const rowMax = W - PAD * 2 - pctW - 20;
    while (ctx.measureText(rowText).width > rowMax && rowText.length > 2) rowText = rowText.slice(0, -1);
    if (rowText !== o.key + ' ' + o.text) rowText = rowText.slice(0, -1) + '…';
    ctx.fillText(rowText, PAD, y);
    y += 38;
    rr(PAD, y, W - PAD * 2, 12, 6);
    ctx.fillStyle = '#F0F0F0'; ctx.fill();
    const bw = Math.max(12, (W - PAD * 2) * o.pct / 100);
    rr(PAD, y, bw, 12, 6);
    ctx.fillStyle = isMine ? '#056DE8' : '#D9E8FB'; ctx.fill();
    y += 12 + 24;
  }
  y += 8;

  // 分隔线
  ctx.fillStyle = '#F0F0F0';
  ctx.fillRect(PAD, y, W - PAD * 2, 1);
  y += 32;

  // 平台答案（我的选项）
  ctx.font = F(600, 26); ctx.fillStyle = '#121212';
  ctx.fillText('平台答案 · 为什么有人选 ' + picked, PAD, y);
  y += 26 + 18;
  y = wrap(mine.reason, PAD, y, W - PAD * 2, 42, F(400, 26), '#121212', 8);
  y += 16;
  y = wrap('它忽略了：' + mine.blindspot, PAD, y, W - PAD * 2, 40, F(400, 25), '#B26A00', 5);
  y += 40;

  // 页脚
  ctx.textAlign = 'center';
  ctx.font = F(400, 22); ctx.fillStyle = '#999999';
  ctx.fillText('先选择，后揭示 · 每个选项都有成立条件与盲区', W / 2, y);
  y += 36;
  ctx.font = F(400, 20); ctx.fillStyle = '#BBBBBB';
  ctx.fillText('knowledge-choice-feed 演示', W / 2, y);
  ctx.textAlign = 'left';
  y += 20 + PAD;

  // 裁掉多余高度
  const out = document.createElement('canvas');
  out.width = W * 2; out.height = Math.min(y, MAXH) * 2;
  out.getContext('2d').drawImage(cv, 0, 0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function openShare(c, picked) {
  const url = shareCanvas(c, picked).toDataURL('image/png');
  const mask = document.createElement('div');
  mask.className = 'share-mask';
  mask.innerHTML = `
    <div class="share-pop">
      <img class="share-img" src="${url}" alt="判断分享卡">
      <div class="share-btns">
        <a class="share-dl" href="${url}" download="判断卡-${c.id}.png">保存图片</a>
        <button class="share-close">关闭</button>
      </div>
    </div>
  `;
  $('.phone').appendChild(mask);
  mask.addEventListener('click', e => {
    if (e.target === mask || e.target.classList.contains('share-close')) mask.remove();
  });
  mask.querySelector('.share-dl').addEventListener('click', () => toast('图片已保存到下载'));
}

/* ---------- 我的（画像 / 记录 / 保存） ---------- */
function renderProfile() {
  const withCard = (obj) => Object.entries(obj)
    .map(([id, v]) => ({ id, ...v, card: CARDS.find(c => c.id === id) }))
    .filter(x => x.card)
    .sort((a, b) => b.at - a.at);
  const pItems = withCard(portrait);
  const sItems = withCard(saved);
  const aIds = Object.keys(answers);
  const optText = (card, key) => { const o = card.options.find(x => x.key === key); return o ? o.text : key; };

  profileView.innerHTML = `
    <div class="profile-head">
      <span class="avatar"><svg width="26" height="26" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="7.5" r="3.5"/><path d="M4 19c.8-3.6 3.7-5.5 7-5.5s6.2 1.9 7 5.5"/></svg></span>
      <div class="who"><b>演示账号</b><small>画像与保存仅存本机 · 演示数据</small></div>
    </div>
    <div class="pstats">
      <div><b>${aIds.length}</b><span>本次已答</span></div>
      <div><b>${pItems.length}</b><span>判断资产</span></div>
      <div><b>${sItems.length}</b><span>私密保存</span></div>
      <div><b>${Object.keys(follows).length}</b><span>关注问题</span></div>
    </div>
    <div class="section">
      <div class="section-label">判断资产 <small>公开主页将展示（示意）</small></div>
      ${pItems.length ? pItems.map(x => `
        <div class="p-item" data-id="${x.id}">
          <h3>${esc(x.card.title)}</h3>
          <div class="p-meta"><span class="chip">选了 ${x.key}</span><span>${esc(optText(x.card, x.key))}</span><span>· ${relTime(x.at)}</span></div>
          ${x.note ? `<div class="p-note">${esc(x.note)}</div>` : ''}
        </div>`).join('') : '<div class="empty">答完题点「存入画像」，把选择和理由沉淀成可展示的判断资产</div>'}
    </div>
    <div class="section">
      <div class="section-label">本次选择记录 <small>作答不持久化，刷新即清空</small></div>
      ${aIds.length ? aIds.map(id => {
        const card = CARDS.find(c => c.id === id);
        return `
        <div class="p-item" data-id="${id}">
          <h3>${esc(card.title)}</h3>
          <div class="p-meta"><span class="chip">已选 ${answers[id]}</span><span>${esc(optText(card, answers[id]))}</span></div>
        </div>`;
      }).join('') : '<div class="empty">本次会话还没有作答</div>'}
    </div>
    <div class="section">
      <div class="section-label">私密保存 <small>仅自己可见</small></div>
      ${sItems.length ? sItems.map(x => `
        <div class="p-item" data-id="${x.id}">
          <h3>${esc(x.card.title)}</h3>
          <div class="p-meta"><svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="6.5" width="9" height="6" rx="1"/><path d="M5 6.5V5a2.5 2.5 0 0 1 5 0v1.5"/></svg><span>${relTime(x.at)}</span></div>
        </div>`).join('') : '<div class="empty">在题目揭示页点「私密保存」，收藏只有自己能看到</div>'}
    </div>
    <div class="detail-pad"></div>
  `;
  profileView.querySelectorAll('.p-item').forEach(el =>
    el.addEventListener('click', () => openDetail(el.dataset.id)));
}

/* ---------- 主题讨论（轻量版） ---------- */
const myPosts = []; // 本次会话发布的帖子，不落盘
const TOPIC_NAME = DATA.category || '买车决策';

function postHtml(p) {
  return `
  <div class="t-post${p.mine ? ' mine' : ''}">
    <div class="cmt-head">
      <span class="cmt-user">${esc(p.user)}</span>
      <span class="t-tag t-${p.tag}">${esc(p.tag)}</span>
    </div>
    <p class="cmt-text">${esc(p.text)}</p>
    <div class="t-foot">
      <button class="cmt-like" data-n="${p.likes}">
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 7.5v4a1 1 0 0 0 1 1h1V6.5h-1a1 1 0 0 0-1 1zM4.5 12.5h6.2a1.5 1.5 0 0 0 1.5-1.2l.8-3.6A1.5 1.5 0 0 0 11.5 5.9H8.8V3.2A1.4 1.4 0 0 0 7.4 1.8c-.2 1.9-1 3.4-2.9 4.4z" stroke-linejoin="round"/></svg>
        <span>${p.likes}</span>
      </button>
      <span class="t-replies">
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3.5h11v7H7l-3 2.5v-2.5H2z" stroke-linejoin="round"/></svg>
        ${p.replies} 回复
      </span>
    </div>
  </div>`;
}

function renderTopics() {
  const topic = (window.KCF_TOPICS && window.KCF_TOPICS[TOPIC_NAME]) || { intro: '', joined: 0, posts: [] };
  const posts = [...myPosts, ...topic.posts];
  topicsView.innerHTML = `
    <div class="topic-head">
      <div class="topic-name"># ${esc(TOPIC_NAME)}</div>
      <div class="topic-intro">${esc(topic.intro)}</div>
      <div class="topic-meta">${fmt(topic.joined)} 人在讨论 · 演示数据</div>
    </div>
    <div class="section">
      <div class="cmt-row">
        <input id="post-text" maxlength="200" placeholder="聊聊题目之外的观察、经验或求助">
        <button id="post-send">发布</button>
      </div>
      <div class="dist-note">演示：发帖仅本次会话可见，不做审核流</div>
    </div>
    <div class="section" id="topic-posts">
      <div class="section-label">讨论 <small>不围绕单题的自由发帖</small></div>
      ${posts.map(postHtml).join('')}
    </div>
    <div class="detail-pad"></div>
  `;
  topicsView.querySelectorAll('.cmt-like').forEach(b =>
    b.addEventListener('click', () => {
      const liked = b.classList.toggle('liked');
      b.querySelector('span').textContent = Number(b.dataset.n) + (liked ? 1 : 0);
    }));
  $('#post-send').addEventListener('click', () => {
    const text = $('#post-text').value.trim();
    if (!text) { toast('帖子还没写呢'); return; }
    myPosts.unshift({ user: '我', tag: '发帖', text, likes: 0, replies: 0, mine: true });
    renderTopics();
    toast('已发布（演示：仅本次会话可见）');
  });
}

function nextUnanswered() {
  const idx = CARDS.findIndex(x => x.id === currentId);
  for (let i = 1; i <= CARDS.length; i++) {
    const c = CARDS[(idx + i) % CARDS.length];
    if (!answers[c.id]) return c;
  }
  return null;
}
function nextLabel() {
  return nextUnanswered() ? '下一题' : '已答完全部题目 · 回到首页';
}

renderFeed();
