// Chart Toppers — Stage Host View
// 3-column: Score | Answer | Score

document.addEventListener('DOMContentLoaded', function() {
  const socket = io();
  let currentRound = 0;
  let loadedAnswers = []; // all answers for current genre

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
  }

  function showR3List(answers) {
    els.answerCentre.classList.remove('waiting');
    els.answerLabel.textContent = 'Answers';
    els.answerTrack.innerHTML = answers.map((a, i) =>
      `${i + 1}. ${a.artist} - ${a.track}`
    ).join('<br>');
    els.answerArtist.textContent = '';
    els.answerMeta.textContent = '';
  }

  function clearAnswer() {
    els.answerTrack.textContent = '';
    els.answerArtist.textContent = '';
    els.answerMeta.textContent = '';
    els.answerLabel.textContent = 'Answers';
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
      clearAnswer();
      return;
    }
    loadedAnswers = data.answers;
    if (currentRound === 3) {
      showR3List(loadedAnswers);
    } else {
      // Clear answer display — wait for currentTrack to show specific answer
      clearAnswer();
    }
  });

  // Current track — server emits on genre load (first answer) and after each correct answer
  // R3: ignore — the full list is already displayed
  socket.on('currentTrack', (data) => {
    if (currentRound === 3) return;
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
