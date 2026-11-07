/* ==========================================================================
   core.js — 共享层
   档案（昵称 + 档案号）/ 后端接口 / 本地记录 / 音效 / 建档与档案弹窗
   用法：<script src="../shared/core.js"></script> → window.Core
   ========================================================================== */
(function(){
  'use strict';

  const $ = s => document.querySelector(s);

  /* ------------------------------------------------------------ 工具 */
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = t => Number(t).toFixed(2);
  const tagOf = id => '#' + String(id || '').slice(0, 3);

  const ID_RE = /^[0-9]{3}[A-Z0-9]{6}$/;
  const isId = v => ID_RE.test(String(v || '').toUpperCase());

  // 本地日期（不是 UTC），算连续打卡用
  const dayOf = iso => {
    const d = new Date(iso);
    if(isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  };

  function shortDate(iso){
    const d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    const p = x => String(x).padStart(2,'0');
    return `${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const PUBLIC_BASE = 'https://fishquito.site';
  function siteBase(){
    const h = location.hostname;
    if(location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1')
      return PUBLIC_BASE;
    return location.origin;
  }
  // 同步链接一律指向大厅：手机打开就接管档案，再自己挑游戏
  const syncLink = id => siteBase() + '/?id=' + encodeURIComponent(id);

  async function copyText(text){
    if(navigator.clipboard && window.isSecureContext){
      try{ await navigator.clipboard.writeText(text); return true; }catch(e){}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try{ ok = document.execCommand('copy'); }catch(e){}
    ta.remove();
    return ok;
  }

  /* ------------------------------------------------------------ 事件 */
  const listeners = {};
  function on(ev, fn){ (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, data){ for(const fn of listeners[ev] || []) { try{ fn(data); }catch(e){ console.error(e); } } }

  /* ------------------------------------------------------------ 档案 */
  const PROF_KEY        = 'focus.profile';
  const LEGACY_PROF_KEY = 'schulte.profile';

  function readProfile(){
    try{
      const raw = JSON.parse(localStorage.getItem(PROF_KEY) || 'null');
      if(raw && typeof raw.id === 'string' && ID_RE.test(raw.id)) return raw;
    }catch(e){}
    // 从旧键迁移，避免老用户掉登录
    try{
      const old = JSON.parse(localStorage.getItem(LEGACY_PROF_KEY) || 'null');
      if(old && typeof old.id === 'string' && ID_RE.test(old.id)){
        localStorage.setItem(PROF_KEY, JSON.stringify(old));
        localStorage.removeItem(LEGACY_PROF_KEY);
        return old;
      }
    }catch(e){}
    return null;
  }

  let profile = readProfile();

  function setProfile(p){
    profile = p;
    try{ localStorage.setItem(PROF_KEY, JSON.stringify(p)); }catch(e){}
    renderChip();
    emit('profile', p);
  }
  function clearProfile(){
    profile = null;
    try{ localStorage.removeItem(PROF_KEY); }catch(e){}
    renderChip();
    emit('profile', null);
  }

  // 所有带 data-core="chip" 的元素都变成档案入口
  function renderChip(){
    document.querySelectorAll('[data-core="chip"]').forEach(chip => {
      if(!profile){ chip.hidden = true; return; }
      chip.hidden = false;
      chip.innerHTML = esc(profile.name) + (profile.id ? `<em>${tagOf(profile.id)}</em>` : '');
    });
    emit('chip', profile);
  }

  /* ------------------------------------------------------------ 本地记录 */
  const RUNS_KEY        = 'focus.runs.v1';
  const LEGACY_RUNS_KEY = 'schulte.lb.v3';
  const RUNS_MAX        = 20;

  function readRuns(){
    try{ return JSON.parse(localStorage.getItem(RUNS_KEY)) || {}; }catch(e){ return {}; }
  }
  function writeRuns(all){
    try{ localStorage.setItem(RUNS_KEY, JSON.stringify(all)); }catch(e){}
  }

  // 旧结构 {"square|5|f": [...]} → {"schulte|square|5|f": [...]}
  (function migrateRuns(){
    try{
      if(localStorage.getItem(RUNS_KEY)) return;
      const old = JSON.parse(localStorage.getItem(LEGACY_RUNS_KEY) || 'null');
      if(!old || typeof old !== 'object') return;
      const next = {};
      for(const k of Object.keys(old)) if(Array.isArray(old[k])) next['schulte|' + k] = old[k];
      writeRuns(next);
      localStorage.removeItem(LEGACY_RUNS_KEY);
    }catch(e){}
  })();

  const keyOf = (game, board) => game + '|' + board;

  const runs = {
    of(game, board){ return readRuns()[keyOf(game, board)] || []; },
    best(game, board){                       // 用时最短
      let best = null;
      for(const r of runs.of(game, board)) if(!best || r.t < best.t) best = r;
      return best;
    },
    add(game, board, run){
      const all = readRuns();
      const k = keyOf(game, board);
      all[k] = [run].concat(all[k] || []).slice(0, RUNS_MAX);
      writeRuns(all);
    },
    clear(game, board){
      const all = readRuns();
      delete all[keyOf(game, board)];
      writeRuns(all);
    },
    // 大厅用：本机汇总；不传 game 就是全部游戏
    summary(game){
      const all = readRuns(), days = new Set();
      const prefix = game ? game + '|' : '';
      const out = { plays:0, bestScore:null, bestTime:null, last:null, streak:0 };
      for(const k of Object.keys(all)){
        if(k.indexOf(prefix) !== 0) continue;
        for(const r of all[k]){
          out.plays++;
          if(out.bestScore === null || r.s > out.bestScore) out.bestScore = r.s;
          if(out.bestTime === null || r.t < out.bestTime) out.bestTime = r.t;
          if(!out.last || r.d > out.last) out.last = r.d;
          const day = r.d && dayOf(r.d);
          if(day) days.add(day);
        }
      }
      out.streak = streakOf(days);
      return out;
    }
  };

  // 连续天数：从今天往回数，今天还没练就从昨天算起
  function streakOf(daySet){
    if(!daySet.size) return 0;
    const d = new Date();
    const key = x => x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0');
    if(!daySet.has(key(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while(daySet.has(key(d))){ n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ------------------------------------------------------------ 后端 */
  const NET = Object.assign({ base: '' }, window.FOCUS_NET || {}, window.SCHULTE_NET || {});
  let online = !!NET.base;
  const apiBase = () => NET.base || '';

  async function req(method, path, body){
    const opt = { method };
    if(body !== undefined){
      opt.headers = { 'Content-Type': 'application/json' };
      opt.body = JSON.stringify(body);
    }
    const res = await fetch(apiBase() + path, opt);
    let j = {};
    try{ j = await res.json(); }catch(e){}
    if(!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
    return j;
  }

  const api = {
    get online(){ return online; },
    register: name => req('POST', '/api/register', { name }),
    login:    id   => req('POST', '/api/login', { id }),
    rename:   (id, name) => req('PATCH', '/api/player', { id, name }),
    post(game, b, id, t, s){
      return req('POST', '/api/' + game + '/scores',
        { id, mode: b.mode, size: b.size, rev: b.rev, t, s });
    },
    top(game, b, limit){
      const q = new URLSearchParams({
        mode: b.mode, size: String(b.size), rev: b.rev ? '1' : '0', limit: String(limit || 20)
      });
      return req('GET', '/api/' + game + '/scores?' + q).then(j => j.items || []);
    },
    stats: game => req('GET', '/api/' + game + '/stats')
  };

  /* ------------------------------------------------------------ 音效 */
  let actx = null;
  let soundOn = true;
  try{ soundOn = localStorage.getItem('focus.sound') !== '0'; }catch(e){}

  function blip(freq, dur, type){
    if(!soundOn) return;
    try{
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = 0.045;
      o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.06));
      o.start(t); o.stop(t + (dur || 0.06) + 0.02);
    }catch(e){}
  }

  function fanfare(grade){
    const seq = grade === 'S' ? [784,988,1175,1568]
              : grade === 'A' ? [784,988,1175]
              : grade === 'B' ? [659,880]
              : grade === 'C' ? [523,659]
              : [196,165];
    seq.forEach((f, i) => setTimeout(() => blip(f, .13, 'sine'), i * 95));
  }

  const sfx = {
    blip, fanfare,
    get enabled(){ return soundOn; },
    set(on_){ soundOn = !!on_; try{ localStorage.setItem('focus.sound', soundOn ? '1' : '0'); }catch(e){} },
    toggle(){ sfx.set(!soundOn); return soundOn; }
  };

  /* ------------------------------------------------------------ 建档弹窗 */
  let gateDone = null;

  function injectMarkup(){
    const box = document.createElement('div');
    box.innerHTML = `
<div class="lbmodal" id="gate">
  <div class="lb-card gate-card">
    <div class="gate-logo">专注力训练馆</div>
    <p class="gate-sub" id="gateSub">起个名字就能上榜，不用注册</p>
    <input id="gateName" class="nameInput gate-input" maxlength="12" placeholder="你的昵称" spellcheck="false">
    <input id="gateId" class="nameInput gate-input" maxlength="9" placeholder="9 位档案号" spellcheck="false" hidden>
    <button class="btn gate-btn" id="gateGo">开始</button>
    <div class="gate-msg" id="gateMsg"></div>
    <button class="linkbtn" id="gateSwitch">已有档案？用档案号登录</button>
  </div>
</div>

<div class="lbmodal" id="me">
  <div class="lb-card">
    <div class="lb-head"><h2>我的档案</h2><button class="iconbtn" id="meClose">✕</button></div>
    <div class="me-top"><span class="me-name" id="meName">—</span><span class="me-tag" id="meTag"></span></div>
    <div class="me-row"><span class="me-lbl">档案号</span><code id="meId">—</code><button class="toggle" id="meCopyId">复制</button></div>
    <div class="me-warn" id="meWarn">档案号是唯一登录凭据，请妥善保存</div>
    <div class="me-help" id="meHelp">若想找回，请联系管理员 <button type="button" class="copy-mail" id="meMail">fishquito7@163.com</button></div>
    <div class="me-note" id="meNote">换设备时把下面的链接发到手机，或直接打开，就能接管这份档案。</div>
    <div class="me-link" id="meLink">—</div>
    <div class="me-actions">
      <button class="toggle" id="meCopyLink">复制同步链接</button>
      <button class="toggle" id="meRename">改昵称</button>
      <button class="toggle" id="meOut">退出</button>
    </div>
    <div class="me-rename" id="meRenameBox" hidden>
      <input id="meRenameInput" class="nameInput" maxlength="12" spellcheck="false" placeholder="新昵称">
      <button class="toggle on" id="meRenameOk">保存</button>
    </div>
  </div>
</div>

<div class="lbmodal" id="lb">
  <div class="lb-card">
    <div class="lb-head"><h2 id="lbTitle">排行榜</h2><button class="iconbtn" id="lbClose" title="关闭">✕</button></div>
    <div class="lb-groups" id="lbTabs"></div>
    <div class="lb-sub"><span id="lbSubtitle">—</span><button class="toggle" id="lbRev" hidden>倒序</button></div>
    <div class="seg lb-scope" id="lbScope" hidden>
      <button data-v="local" class="on">我的记录</button>
      <button data-v="global">全球</button>
    </div>
    <div class="lb-list" id="lbList"></div>
    <div class="lb-foot">
      <span id="lbFootNote">我的记录 · 最近 20 次</span>
      <button class="toggle" id="lbClear">清空本项</button>
    </div>
  </div>
</div>`;
    while(box.firstElementChild) document.body.appendChild(box.firstElementChild);
  }

  let gateMode = 'name';

  function gateSetMode(mode){
    gateMode = mode;
    const isName = mode === 'name';
    $('#gateSub').textContent = isName ? '起个名字就能上榜，不用注册' : '输入你的 9 位档案号';
    $('#gateName').hidden = !isName;
    $('#gateId').hidden = isName;
    $('#gateGo').textContent = isName ? '开始' : '登录';
    $('#gateSwitch').textContent = isName ? '已有档案？用档案号登录' : '没有档案？返回起名字';
    $('#gateMsg').textContent = '';
    try{ (isName ? $('#gateName') : $('#gateId')).focus(); }catch(e){}
  }

  function gateMsg(text, ok){
    const el = $('#gateMsg');
    el.textContent = text || '';
    el.style.color = ok ? 'var(--acc2)' : 'var(--bad)';
  }

  const gate = {
    open(cb){
      gateDone = cb || null;
      $('#gate').classList.add('show');
      gateSetMode('name');
      setTimeout(() => { try{ $('#gateName').focus(); }catch(e){} }, 200);
    },
    close(){ $('#gate').classList.remove('show'); },
    msg: gateMsg,
    get isOpen(){ return $('#gate').classList.contains('show'); }
  };

  function bindGate(){
    $('#gateSwitch').addEventListener('click', () => gateSetMode(gateMode === 'name' ? 'id' : 'name'));

    $('#gateId').addEventListener('input', function(){
      this.value = this.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 9);
    });

    $('#gateName').addEventListener('keydown', e => { if(e.key === 'Enter') $('#gateGo').click(); });
    $('#gateId').addEventListener('keydown', e => { if(e.key === 'Enter') $('#gateGo').click(); });

    $('#gateGo').addEventListener('click', async function(){
      const btn = this;

      if(gateMode === 'id'){
        const id = $('#gateId').value.trim().toUpperCase();
        if(!ID_RE.test(id)) return gateMsg('档案号是 9 位：前 3 位数字 + 后 6 位字母数字');
        if(!online) return gateMsg('没连上服务器，稍后再试');
        btn.disabled = true; btn.textContent = '登录中…';
        try{
          const p = await api.login(id);
          setProfile({ id: p.id, name: p.name });
          gate.close();
          const cb = gateDone; gateDone = null; if(cb) cb(profile);
        }catch(e){
          gateMsg(e.message === 'not found' ? '没有这个档案号' : ('登录失败：' + e.message));
        }
        btn.disabled = false; btn.textContent = '登录';
        return;
      }

      const name = $('#gateName').value.trim().slice(0, 12);
      if(!name) return gateMsg('起个名字吧');

      if(!online){                                   // 离线：只建一个本机档案
        setProfile({ id:'', name });
        gate.close();
        const cb = gateDone; gateDone = null; if(cb) cb(profile);
        return;
      }

      btn.disabled = true; btn.textContent = '创建中…';
      try{
        const p = await api.register(name);
        setProfile({ id: p.id, name: p.name });
        gate.close();
        const cb = gateDone; gateDone = null; if(cb) cb(profile);
      }catch(e){
        gateMsg('创建失败：' + e.message);
      }
      btn.disabled = false; btn.textContent = '开始';
    });
  }

  /* ------------------------------------------------------------ 我的档案弹窗 */
  function openMe(){
    if(!profile) return;
    $('#meName').textContent = profile.name;
    $('#meTag').textContent = profile.id ? tagOf(profile.id) : '（本机）';
    $('#meId').textContent = profile.id || '—— 离线 ——';
    $('#meRenameBox').hidden = true;
    const link = profile.id ? syncLink(profile.id) : '';
    $('#meLink').textContent = link || '离线档案没有同步链接，连上服务器并重新建档后才有';
    $('#meWarn').hidden = !profile.id;
    $('#meHelp').hidden = !profile.id;
    $('#meNote').textContent = profile.id
      ? '把下面的链接发到手机（或直接在手机上打开），就能接管这份档案。谁拿到链接谁就能用你的档案。'
      : '当前是离线档案，成绩只存在这台设备上。';
    $('#me').classList.add('show');
  }
  const closeMe = () => $('#me').classList.remove('show');

  const me = { open: openMe, close: closeMe };

  function bindMe(){
    $('#meClose').addEventListener('click', closeMe);
    $('#me').addEventListener('click', e => { if(e.target === $('#me')) closeMe(); });

    $('#meMail').addEventListener('click', function(){
      const btn = this;
      copyText('fishquito7@163.com').then(ok => {
        btn.textContent = ok ? '已复制' : '请长按选中';
        btn.classList.toggle('copied', ok);
        setTimeout(() => { btn.textContent = 'fishquito7@163.com'; btn.classList.remove('copied'); }, 1400);
      });
    });

    $('#meCopyId').addEventListener('click', function(){
      if(!profile || !profile.id) return;
      const btn = this;
      copyText(profile.id).then(() => {
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = '复制'; }, 1200);
      });
    });

    $('#meCopyLink').addEventListener('click', function(){
      if(!profile || !profile.id) return;
      const btn = this;
      copyText(syncLink(profile.id)).then(() => {
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = '复制同步链接'; }, 1200);
      });
    });

    $('#meRename').addEventListener('click', function(){
      $('#meRenameBox').hidden = false;
      $('#meRenameInput').value = profile ? profile.name : '';
      $('#meRenameInput').focus();
    });

    $('#meRenameOk').addEventListener('click', async function(){
      const name = $('#meRenameInput').value.trim().slice(0, 12);
      if(!name || !profile) return;
      if(profile.id && online){
        try{ await api.rename(profile.id, name); }
        catch(e){ this.textContent = '失败'; setTimeout(() => { this.textContent = '保存'; }, 1200); return; }
      }
      setProfile({ id: profile.id, name });
      $('#meName').textContent = name;
      $('#meRenameBox').hidden = true;
    });

    $('#meOut').addEventListener('click', function(){
      clearProfile();
      closeMe();
      gate.open();
    });
  }

  /* ------------------------------------------------------------ 评级 */
  const GRADE_CUT = [['S',100],['A',80],['B',65],['C',50],['D',0]];
  function grade(score){
    for(const g of GRADE_CUT) if(score >= g[1]) return g[0];
    return 'D';
  }

  /* ------------------------------------------------------------ 舞台遮罩 */
  let cdSeq = 0;
  const ui = {
    veil(){ return document.querySelector('.veil'); },
    overlay(html){
      const v = ui.veil(); if(!v) return;
      v.hidden = false; v.classList.add('show'); v.innerHTML = html;
    },
    hide(){
      const v = ui.veil(); if(!v) return;
      v.classList.remove('show'); v.hidden = true; v.innerHTML = '';
    },
    // 3-2-1-GO，返回取消函数
    countdown(cb){
      const id = ++cdSeq;
      const seq = ['3','2','1','GO'];
      let i = 0;
      const step = () => {
        if(id !== cdSeq) return;
        if(i >= seq.length){ ui.hide(); cb(); return; }
        const label = seq[i++];
        ui.overlay(`<div class="cd">${label}</div>`);
        blip(label === 'GO' ? 940 : 500, label === 'GO' ? 0.12 : 0.07, 'sine');
        setTimeout(step, label === 'GO' ? 260 : 400);
      };
      step();
      return () => { if(cdSeq === id) cdSeq++; };
    }
  };

  /* ------------------------------------------------------------ 顶栏 */
  function mountTopbar(opt){
    const app = document.querySelector('.app');
    if(!app) return;

    const el = document.createElement('div');
    el.className = 'topbar';
    el.innerHTML =
      `<a class="back" href="../" title="返回大厅" aria-label="返回大厅">` +
        `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">` +
        `<path d="M10 2.5 4.5 8l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.9" ` +
        `stroke-linecap="round" stroke-linejoin="round"></path></svg></a>` +
      `<div class="brand"><h1>${esc(opt.title)}</h1><span>${esc(opt.sub || '')}</span></div>` +
      `<div class="tbtools">` +
        `<button class="chip" data-core="chip" hidden></button>` +
        `<button class="iconbtn" data-core="btn-lb" title="排行榜">🏆</button>` +
        `<button class="iconbtn" data-core="btn-sound" title="音效开关"></button>` +
      `</div>`;
    app.insertBefore(el, app.firstChild);

    el.querySelector('[data-core="chip"]').addEventListener('click', () => openMe());

    const sBtn = el.querySelector('[data-core="btn-sound"]');
    const paintSound = () => { sBtn.textContent = soundOn ? '🔊' : '🔇'; };
    sBtn.addEventListener('click', () => { const on = sfx.toggle(); paintSound(); if(on) blip(660, .06); });
    paintSound();

    const lBtn = el.querySelector('[data-core="btn-lb"]');
    if(opt.onLB) lBtn.addEventListener('click', opt.onLB);
    else lBtn.hidden = true;

    renderChip();
  }

  /* ------------------------------------------------------------ 排行榜 */
  const lbState = { cfg: null, vals: {}, scope: 'local' };
  const boardKeyOf = b => b.mode + '|' + b.size + '|' + (b.rev ? 'r' : 'f');

  function lbBoard(){ return lbState.cfg.board(lbState.vals); }

  function lbTabs(){
    const cfg = lbState.cfg;
    $('#lbTitle').textContent = cfg.title || '排行榜';
    $('#lbTabs').innerHTML = cfg.groups.map(g => `
      <div class="seg" data-g="${esc(g.key)}">
        ${g.items.map(it => {
          const v = String(it.v);
          return `<button data-v="${esc(v)}" class="${String(lbState.vals[g.key]) === v ? 'on' : ''}">${esc(it.label)}</button>`;
        }).join('')}
      </div>`).join('');
    $('#lbRev').hidden = !cfg.rev;
    $('#lbRev').classList.toggle('on', !!(cfg.rev && lbState.vals.rev));
  }

  function lbRender(){
    const cfg = lbState.cfg;
    const b = lbBoard();
    const box = $('#lbList');

    $('#lbSubtitle').textContent = cfg.subtitle ? cfg.subtitle(lbState.vals, b) : '';
    $('#lbScope').hidden = !online;
    document.querySelectorAll('#lbScope button').forEach(x => x.classList.toggle('on', x.dataset.v === lbState.scope));
    $('#lbFootNote').textContent = lbState.scope === 'global' ? '全球榜 · 前 20 名（每人一条）' : '我的记录 · 最近 20 次';
    $('#lbClear').style.display = lbState.scope === 'global' ? 'none' : '';

    if(lbState.scope === 'global' && online){
      box.innerHTML = `<div class="lb-empty">加载中…</div>`;
      api.top(cfg.game, b, 20).then(rows => {
        if(!rows.length){ box.innerHTML = `<div class="lb-empty">全球榜还没有成绩<br>你可以做第一个</div>`; return; }
        const myId = profile && profile.id;
        box.innerHTML = rows.map((r, i) => {
          const me = myId && r.id === myId;
          return `<div class="lb-row g${me ? ' me' : ''}">${cfg.globalRow(r, i, me)}</div>`;
        }).join('');
      }).catch(e => {
        box.innerHTML = `<div class="lb-empty">加载失败：${esc(e.message)}<br>
          <span style="font-size:11px">检查后端是否可达</span></div>`;
      });
      return;
    }

    const arr = runs.of(cfg.game, boardKeyOf(b));
    if(!arr.length){ box.innerHTML = `<div class="lb-empty">还没有记录<br>先跑一局</div>`; return; }
    const best = cfg.best(arr);
    box.innerHTML = arr.map(r => `<div class="lb-row">${cfg.localRow(r, r === best)}</div>`).join('');
  }

  function lbOpen(cfg){
    lbState.cfg = cfg;
    lbState.vals = { rev: !!cfg.rev };
    cfg.groups.forEach(g => { lbState.vals[g.key] = String(g.value); });
    lbTabs();
    lbRender();
    $('#lb').classList.add('show');
  }
  function lbClose(){ $('#lb').classList.remove('show'); }

  function bindLB(){
    $('#lbClose').addEventListener('click', lbClose);
    $('#lb').addEventListener('click', e => { if(e.target === $('#lb')) lbClose(); });

    $('#lbTabs').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if(!btn) return;
      lbState.vals[btn.closest('.seg').dataset.g] = btn.dataset.v;
      lbTabs(); lbRender();
    });
    $('#lbRev').addEventListener('click', () => {
      lbState.vals.rev = !lbState.vals.rev;
      lbTabs(); lbRender();
    });
    $('#lbScope').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if(!btn) return;
      lbState.scope = btn.dataset.v;
      lbRender();
    });
    $('#lbClear').addEventListener('click', () => {
      runs.clear(lbState.cfg.game, boardKeyOf(lbBoard()));
      lbRender(); blip(300, .08, 'square');
    });

    document.addEventListener('keydown', e => {
      if(e.key !== 'Escape') return;
      lbClose(); closeMe();
    });
  }

  /* ------------------------------------------------------------ 启动 */
  function init(){
    injectMarkup();
    bindGate();
    bindMe();
    bindLB();

    document.querySelectorAll('[data-core="chip"]').forEach(chip => {
      chip.addEventListener('click', () => openMe());
    });
    renderChip();
  }

  const ready = (async function boot(){
    // 1. 后端探测：同源 /api/health 有响应才算在线
    if(!online && location.protocol !== 'file:'){
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      try{
        const r = await fetch(location.origin + '/api/health', { signal: ctrl.signal });
        if(r.ok){ const j = await r.json(); if(j && j.ok) online = true; }
      }catch(e){}
      finally{ clearTimeout(timer); }
    }

    // 2. 带档案号的链接：自动接管，然后把地址栏里的 id 抹掉
    const m = location.search.match(/[?&]id=([0-9A-Za-z]{9})/);
    const link = { tried:false, ok:false, error:null };
    if(m){
      link.tried = true;
      if(!online){
        link.error = 'offline';
      }else{
        try{
          const p = await api.login(m[1].toUpperCase());
          setProfile({ id: p.id, name: p.name });
          link.ok = true;
          history.replaceState(null, '', location.pathname + location.hash);
        }catch(e){
          link.error = e.message;
        }
      }
    }

    return { online, link };
  })();

  const lb = { open: lbOpen, close: lbClose };

  window.Core = {
    ready,
    util: { $, esc, fmt, tagOf, shortDate, siteBase, syncLink, copyText, isId, dayOf },
    api, runs, sfx, gate, me, lb, ui, on, emit, renderChip, mountTopbar,
    grade, GRADE_CUT, boardKeyOf,
    saveProfile: setProfile,
    clearProfile,
    get online(){ return online; },
    get profile(){ return profile; }
  };

  init();
})();
