(() => {
  const els = {
    packSel: document.getElementById('packSel'),
    roundSel: document.getElementById('roundSel'),
    loadBtn: document.getElementById('loadBtn'),
    progressBox: document.getElementById('progressBox'),
    progressText: document.getElementById('progressText'),
    progressFill: document.getElementById('progressFill'),
    positionText: document.getElementById('positionText'),
    batchCard: document.getElementById('batchCard'),
    batchHeader: document.getElementById('batchHeader'),
    batchSubtitle: document.getElementById('batchSubtitle'),
    batchBody: document.getElementById('batchBody'),
    confirmBtn: document.getElementById('confirmBtn'),
    backBtn: document.getElementById('backBtn'),
    reloadBtn: document.getElementById('reloadBtn'),
    resetRoundBtn: document.getElementById('resetRoundBtn'),
    emptyHint: document.getElementById('emptyHint'),
    allDone: document.getElementById('allDone'),
  };

  let state = null;

  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  function renderPacks() {
    if (!state || !state.packs) return;
    const cur = state.packId;
    els.packSel.innerHTML = state.packs
      .map(p => `<option value="${escape(p.id)}"${p.id === cur ? ' selected' : ''}>${escape(p.name)}</option>`)
      .join('');
    if (state.round) els.roundSel.value = state.round;
  }

  function render() {
    if (!state) return;
    const hasSelection = !!(state.packId && state.round);
    const total = state.total || 0;
    const verifiedCount = state.verifiedCount || 0;
    const allDone = hasSelection && total > 0 && verifiedCount >= total;

    els.emptyHint.style.display = hasSelection ? 'none' : 'block';
    els.progressBox.style.display = hasSelection ? 'block' : 'none';
    els.batchCard.style.display = hasSelection && state.batch.length > 0 ? 'block' : 'none';
    els.allDone.style.display = allDone ? 'block' : 'none';

    if (!hasSelection) return;

    els.progressText.textContent = `${verifiedCount} / ${total} verified`;
    els.progressFill.style.width = total ? `${(verifiedCount / total) * 100}%` : '0%';
    els.positionText.textContent = total
      ? `Tracks ${state.start + 1}–${state.end} of ${total}`
      : 'No tracks for this round';

    const roundLabel = `Round ${state.round}`;
    const packName = state.packs.find(p => p.id === state.packId)?.name || state.packId;
    els.batchHeader.textContent = `${packName} — ${roundLabel}`;
    els.batchSubtitle.textContent = `Tracks ${state.start + 1}–${state.end}`;

    els.batchBody.innerHTML = state.batch.map(item => {
      const file = item.fileName || `${item.hookFile} / ${item.revealFile}`;
      return `<tr>
        <td class="cue">${escape(item.cue)}</td>
        <td class="title">${escape(item.band)} — ${escape(item.track)}</td>
        <td class="file">${escape(file)}</td>
      </tr>`;
    }).join('');

    els.confirmBtn.disabled = !state.batch.length || allDone;
    els.backBtn.disabled = !state.start;
    els.reloadBtn.disabled = !state.batch.length;
    els.resetRoundBtn.disabled = !hasSelection;
  }

  async function refresh() {
    const res = await fetch('/api/qa/state');
    state = await res.json();
    renderPacks();
    render();
  }

  async function postJson(url, body) {
    const opts = { method: 'POST' };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    state = await res.json();
    render();
    return state;
  }

  els.loadBtn.addEventListener('click', async () => {
    await postJson('/api/qa/select', { packId: els.packSel.value, round: els.roundSel.value });
  });
  els.confirmBtn.addEventListener('click', () => postJson('/api/qa/confirm'));
  els.backBtn.addEventListener('click', () => postJson('/api/qa/back'));
  els.reloadBtn.addEventListener('click', () => postJson('/api/qa/reload'));
  els.resetRoundBtn.addEventListener('click', async () => {
    if (!confirm('Reset verified state for this round and pack?')) return;
    await postJson('/api/qa/reset-round');
  });

  refresh();
})();
