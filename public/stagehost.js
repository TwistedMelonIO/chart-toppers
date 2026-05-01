// Chart Toppers — Stage Host View
// 3-column: Score | Answer | Score

document.addEventListener('DOMContentLoaded', function() {
  const socket = io();
  let currentRound = 0;
  let loadedAnswers = []; // all answers for current genre
  let lastAnswersRound = null; // round that produced loadedAnswers (server-authoritative)
  let isShowingR3List = false; // re-fit on resize while the list is visible

  const els = {
    iconsScore: document.getElementById('icons-score'),
    iconsUnit: document.getElementById('icons-unit'),
    iconsGr: document.getElementById('icons-gr'),
    iconsPanel: document.querySelector('.sh-icons'),
    anthemsScore: document.getElementById('anthems-score'),
    anthemsUnit: document.getElementById('anthems-unit'),
    anthemsGr: document.getElementById('anthems-gr'),
    anthemsPanel: document.querySelector('.sh-anthems'),
    answerCentre: document.querySelector('.sh-answer-centre'),
    answerLabel: document.getElementById('answer-label'),
    answerTrack: document.getElementById('answer-track'),
    answerArtist: document.getElementById('answer-artist'),
    answerMeta: document.getElementById('answer-meta'),
  };

  function animateValue(el, from, to, duration) {
    if (from === to) { el.textContent = to; return; }
    const start = performance.now();
    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      el.textContent = Math.round(from + (to - from) * t);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function updateScore(teamId, team) {
    if (!team) return;
    const scoreEl = teamId === 'icons' ? els.iconsScore : els.anthemsScore;
    const unitEl = teamId === 'icons' ? els.iconsUnit : els.anthemsUnit;
    const grEl = teamId === 'icons' ? els.iconsGr : els.anthemsGr;

    const displayValue = (currentRound === 4) ? (team.points || 0) : team.earnedTime;
    const currentValue = parseInt(scoreEl.textContent) || 0;
    animateValue(scoreEl, currentValue, displayValue, 400);
    unitEl.textContent = (currentRound === 4) ? 'points' : 'seconds';

    grEl.className = 'sh-gr';
    if (team.goldenRecordArmed) {
      grEl.textContent = 'GR Armed';
      grEl.classList.add('armed');
    } else if (team.goldenRecordUsed) {
      grEl.textContent = 'GR Used';
      grEl.classList.add('used');
    } else {
      grEl.textContent = 'GR Available';
      grEl.classList.add('available');
    }
  }

  function showAnswer(track, artist, label, meta) {
    els.answerCentre.classList.remove('waiting');
    els.answerLabel.textContent = label || 'Current Track';
    els.answerTrack.innerHTML = track;
    els.answerArtist.textContent = artist;
    els.answerMeta.textContent = meta || '';
    // Drop any inline font-size / nowrap left over from a prior R3 list view.
    els.answerTrack.style.fontSize = '';
    els.answerTrack.style.whiteSpace = '';
    isShowingR3List = false;
  }

  // Re-fit on any layout change while the R3 list is visible — covers
  // browser resize, iPad rotation, returning from background (where Safari
  // may have changed the inner viewport), and font-loading reflows.
  let resizeRaf = null;
  function scheduleRefit() {
    if (!isShowingR3List) return;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => requestAnimationFrame(() => fitAnswerTrack()));
  }
  window.addEventListener('resize', scheduleRefit);
  window.addEventListener('orientationchange', scheduleRefit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefit();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleRefit);
  }

  function showR3List(answers) {
    els.answerCentre.classList.remove('waiting');
    els.answerLabel.textContent = 'Answers';
    // R3 mashups: prefer the server-composed displayText (matches R3SCORES
    // cue notes — "Band1 - Track1 & Band2 - Track2"). Fall back to plain
    // artist - track for older payloads.
    els.answerTrack.innerHTML = answers.map((a, i) => {
      if (a.displayText) return `${i + 1}. ${a.displayText}`;
      return `${i + 1}. ${a.artist} - ${a.track}`;
    }).join('<br>');
    els.answerArtist.textContent = '';
    els.answerMeta.textContent = '';
    // Force each mashup answer onto a single line and let the fit function
    // shrink the font until both width and height constraints are satisfied.
    els.answerTrack.style.whiteSpace = 'nowrap';
    isShowingR3List = true;
    requestAnimationFrame(() => requestAnimationFrame(() => fitAnswerTrack()));
  }

  // Find the largest font-size (in px) where the rendered list fits inside
  // .sh-answer-centre (the only ancestor with overflow:hidden — answer-body
  // has flex:1 with no overflow constraint, so it expands to fit children).
  function fitAnswerTrack(maxPx = 112, minPx = 22) {
    const el = els.answerTrack;
    const body = el.parentElement; // .sh-answer-body
    const centre = els.answerCentre; // .sh-answer-centre (overflow:hidden)
    if (!body || !centre) return;

    // Reset any prior inline tweaks before measuring so the search starts clean.
    el.style.whiteSpace = 'nowrap';

    // Available vertical space inside .sh-answer-centre after subtracting the
    // round-pills topbar and its margin/padding. Track-track must fit within
    // body.clientHeight, but body grows; so we compute body's max allowed
    // height as centre.clientHeight - non-body siblings (the topbar) - centre's
    // own vertical padding.
    const cs = getComputedStyle(centre);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBot = parseFloat(cs.paddingBottom) || 0;
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padRight = parseFloat(cs.paddingRight) || 0;
    let nonBody = 0;
    for (const child of centre.children) {
      if (child !== body) nonBody += child.offsetHeight;
    }
    const maxBodyHeight = centre.clientHeight - padTop - padBot - nonBody;
    const maxWidth = centre.clientWidth - padLeft - padRight;
    if (maxBodyHeight <= 0 || maxWidth <= 0) return;

    const fits = (px) => {
      el.style.fontSize = px + 'px';
      let total = 0;
      for (const child of body.children) total += child.offsetHeight;
      // With white-space:nowrap, scrollWidth is the natural unwrapped width.
      // Compare against the centre's content-box width — track.clientWidth
      // would itself grow with content and yield a meaningless check.
      return total <= maxBodyHeight && el.scrollWidth <= maxWidth + 1;
    };

    if (fits(maxPx)) return;

    let lo = minPx, hi = maxPx, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fits(mid)) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (best == null) {
      // Even the minimum nowrap size overflows the column — drop nowrap and
      // let lines wrap, then re-search for a size that fits vertically.
      el.style.whiteSpace = 'normal';
      let lo2 = minPx, hi2 = maxPx, best2 = minPx;
      const fitsHeight = (px) => {
        el.style.fontSize = px + 'px';
        let total = 0;
        for (const child of body.children) total += child.offsetHeight;
        return total <= maxBodyHeight;
      };
      while (lo2 <= hi2) {
        const mid = (lo2 + hi2) >> 1;
        if (fitsHeight(mid)) { best2 = mid; lo2 = mid + 1; } else { hi2 = mid - 1; }
      }
      el.style.fontSize = best2 + 'px';
    } else {
      el.style.fontSize = best + 'px';
    }
  }

  function clearAnswer() {
    els.answerTrack.textContent = '';
    els.answerArtist.textContent = '';
    els.answerMeta.textContent = '';
    els.answerLabel.textContent = 'Answers';
    els.answerTrack.style.fontSize = '';
  }

  // Start blank
  clearAnswer();

  // State update
  socket.on('stateUpdate', (state) => {
    if (!state) return;
    updateScore('icons', state.icons);
    updateScore('anthems', state.anthems);
  });

  // Round update
  socket.on('roundUpdate', (data) => {
    if (!data) return;
    currentRound = data.currentRound || 0;
    document.querySelectorAll('.sh-round-pill').forEach(pill => {
      const r = parseInt(pill.dataset.round);
      pill.classList.remove('active', 'completed');
      if (r === data.currentRound) pill.classList.add('active');
      else if (data.completedRounds && data.completedRounds.includes(r)) pill.classList.add('completed');
    });
  });

  // Genre loaded — store all answers; R3 shows full list immediately
  socket.on('answersUpdate', (data) => {
    if (!data || !data.answers || data.answers.length === 0) {
      loadedAnswers = [];
      lastAnswersRound = null;
      clearAnswer();
      return;
    }
    loadedAnswers = data.answers;
    lastAnswersRound = String(data.round || '');
    // Trust the payload's round so the list view fires even when the iPad
    // hasn't entered R3 in the show yet (e.g. QA tool loads).
    if (currentRound === 3 || lastAnswersRound === '3') {
      showR3List(loadedAnswers);
    } else {
      // Clear answer display — wait for currentTrack to show specific answer
      clearAnswer();
    }
  });

  // Current track — server emits on genre load (first answer) and after each correct answer
  // R3: ignore — the full list is already displayed (covers both real R3
  // gameplay and QA-tool R3 loads where currentRound may still be 0).
  socket.on('currentTrack', (data) => {
    if (currentRound === 3 || lastAnswersRound === '3') return;
    if (!data || !data.trackNumber) return;
    const idx = data.trackNumber - 1;
    if (loadedAnswers[idx]) {
      const a = loadedAnswers[idx];
      const total = data.total || loadedAnswers.length;
      showAnswer(a.track, a.artist, 'Answers', `Answer ${data.trackNumber} of ${total}`);
    }
  });

  // Team playing glow
  socket.on('triggerPlaying', (teamId) => {
    els.iconsPanel.classList.remove('playing');
    els.anthemsPanel.classList.remove('playing');
    (teamId === 'icons' ? els.iconsPanel : els.anthemsPanel).classList.add('playing');
  });

  socket.on('triggerStop', (teamId) => {
    (teamId === 'icons' ? els.iconsPanel : els.anthemsPanel).classList.remove('playing');
  });

  socket.on('teamPlaying', (teamId) => {
    els.iconsPanel.classList.remove('playing');
    els.anthemsPanel.classList.remove('playing');
    (teamId === 'icons' ? els.iconsPanel : els.anthemsPanel).classList.add('playing');
  });

  socket.on('teamStopPlaying', (teamId) => {
    (teamId === 'icons' ? els.iconsPanel : els.anthemsPanel).classList.remove('playing');
  });

  // Golden record
  socket.on('goldenRecordActivated', (teamId) => {
    const grEl = teamId === 'icons' ? els.iconsGr : els.anthemsGr;
    grEl.textContent = 'GR Armed';
    grEl.className = 'sh-gr armed';
  });

  // Reset — clear answer
  socket.on('teamReset', () => {
    loadedAnswers = [];
    clearAnswer();
  });

  // Round change — clear answer
  socket.on('clearAnswer', () => {
    loadedAnswers = [];
    clearAnswer();
  });

  // Fetch initial state
  fetch('/api/state')
    .then(r => r.json())
    .then(state => {
      updateScore('icons', state.icons);
      updateScore('anthems', state.anthems);
    })
    .catch(() => {});

  // Fetch initial round
  fetch('/api/round')
    .then(r => r.json())
    .then(data => {
      if (data.round) {
        currentRound = data.round.currentRound || 0;
        document.querySelectorAll('.sh-round-pill').forEach(pill => {
          const r = parseInt(pill.dataset.round);
          pill.classList.remove('active', 'completed');
          if (r === data.round.currentRound) pill.classList.add('active');
          else if (data.round.completedRounds && data.round.completedRounds.includes(r)) pill.classList.add('completed');
        });
      }
    })
    .catch(() => {});
});
