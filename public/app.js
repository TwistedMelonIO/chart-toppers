// Chart Toppers - Main Application JavaScript
// Optimized for production - all debug code removed

document.addEventListener('DOMContentLoaded', function() {
  // Cache DOM elements for performance
  const elements = {
    anthems: {
      earned: document.getElementById('anthems-earnedTime-main'),
      progress: document.getElementById('anthems-progressFill'),
      history: document.getElementById('anthems-historyList')
    },
    icons: {
      earned: document.getElementById('icons-earnedTime-main'),
      progress: document.getElementById('icons-progressFill'),
      history: document.getElementById('icons-historyList')
    },
    settings: {
      btn: document.getElementById('settingsBtn'),
      modal: document.getElementById('passwordModal'),
      input: document.getElementById('passwordInput'),
      submit: document.getElementById('submitPassword'),
      close: document.getElementById('closeModal'),
      error: document.getElementById('passwordError')
    },
    iosAlert: {
      overlay: document.getElementById('iosResetAlert'),
      title: document.getElementById('iosAlertTitle'),
      message: document.getElementById('iosAlertMessage'),
      cancel: document.getElementById('iosAlertCancel'),
      confirm: document.getElementById('iosAlertConfirm')
    },
    resetAll: document.getElementById('btnResetAll'),
    connectionStatus: document.getElementById('connectionStatus')
  };

  // Validate required elements exist
  if (!elements.anthems.earned || !elements.icons.earned) {
    console.error('Required DOM elements not found');
    return;
  }

  // ── License System ──────────────────────────────────────
  async function checkLicenseStatus() {
    console.log('checkLicenseStatus called');
    try {
      console.log('Fetching license status...');
      const res = await fetch('/api/license_status');
      const data = await res.json();
      console.log('License status data:', data);
      updateLicenseGate(data);
      updateLicenseFooter(data);
    } catch (e) {
      console.error('License check failed:', e);
    }
  }

  function updateLicenseGate(data) {
    const gate = document.getElementById('license-gate');
    const machineIdEl = document.getElementById('gate-machine-id');
    const errorEl = document.getElementById('gate-error');

    if (data.machine_id) machineIdEl.textContent = data.machine_id;

    if (data.valid) {
      gate.classList.add('hidden');
    } else {
      gate.classList.remove('hidden');
      errorEl.textContent = data.error || 'License is not valid';
    }
  }

  function updateLicenseFooter(data) {
    const statusEl = document.getElementById('footer-license-status');
    const licenseeEl = document.getElementById('footer-licensee');
    const expiryEl = document.getElementById('footer-license-expiry');

    if (data.valid) {
      statusEl.querySelector('span').textContent = 'Valid License';
      statusEl.className = 'footer-license-item';
      licenseeEl.querySelector('span').textContent = data.licensee || 'Licensed User';
      licenseeEl.className = 'footer-license-item';
      expiryEl.querySelector('span').textContent = data.expiration
        ? new Date(data.expiration).toLocaleDateString()
        : 'No expiry';
      expiryEl.className = 'footer-license-item';
    } else {
      statusEl.querySelector('span').textContent = 'Invalid License';
      statusEl.className = 'footer-license-item invalid';
      licenseeEl.querySelector('span').textContent = 'N/A';
      licenseeEl.className = 'footer-license-item invalid';
      expiryEl.querySelector('span').textContent = data.error || 'License invalid';
      expiryEl.className = 'footer-license-item invalid';
    }
  }

  // Click-to-copy with fallback for all browsers
  function copyMachineId() {
    const mid = document.getElementById('gate-machine-id').textContent;
    if (!mid || mid === 'Loading...') return;

    const hint = document.getElementById('gate-copy-hint');
    performCopy(mid);
    
    // Show feedback on hint
    if (hint) {
      const originalText = hint.textContent;
      hint.textContent = 'Copied!';
      setTimeout(() => {
        hint.textContent = originalText;
      }, 2000);
    }
  }

  
  // Check license immediately and then every 30 seconds
  console.log('Starting license check...');
  checkLicenseStatus();
  setInterval(checkLicenseStatus, 30000);

  // Pack display name mapping
  const packNames = {
    'uk-usa-german': 'UK / USA / German',
    'european': 'European',
    'teens': 'Teens'
  };

  // Fetch current pack on page load
  const packDisplay = document.getElementById('currentPackDisplay');
  fetch('/api/pack-settings')
    .then(res => res.json())
    .then(data => {
      if (packDisplay && data.currentPack) {
        packDisplay.textContent = 'Current Pack: ' + (packNames[data.currentPack] || data.currentPack);
      }
    })
    .catch(() => {});

  // Initialize Socket.IO connection
  const socket = io();
  let resetCallback = null;
  let statePollInterval = null;
  const STATE_POLL_INTERVAL_MS = 5000;

  setConnectionStatus('connecting', 'Connecting to server…');

  // Socket.IO event handlers
  socket.on('connect', () => {
    setConnectionStatus('connected', 'Connected to control server');
    stopStatePolling();
    fetchStateSnapshot();
  });

  socket.on('disconnect', () => {
    setConnectionStatus('disconnected', 'Connection lost. Attempting to reconnect…');
    startStatePolling();
  });

  socket.on('stateUpdate', (state) => {
    updateTeamsFromState(state);
  });

  socket.on('packChanged', (newPack) => {
    if (packDisplay) {
      packDisplay.textContent = 'Current Pack: ' + (packNames[newPack] || newPack);
    }
  });

  socket.on('connect_error', () => {
    setConnectionStatus('disconnected', 'Unable to reach server. Retrying…');
    startStatePolling();
  });

  socket.on('teamReset', (teamId) => {
    if (elements[teamId] && elements[teamId].history) {
      elements[teamId].history.innerHTML = '<p class="empty-state">Waiting for first correct answer...</p>';
    }
  });

  function updateTeamsFromState(state) {
    if (!state) return;
    updateTeamUI('anthems', state.anthems);
    updateTeamUI('icons', state.icons);
  }

  // Team UI update function
  function updateTeamUI(teamId, team) {
    if (!team || !elements[teamId]) return;

    const teamElements = elements[teamId];
    
    // Update earned time
    if (teamElements.earned) {
      const currentText = teamElements.earned.textContent || "0";
      const currentValue = parseInt(currentText) || 0;
      animateValue(teamElements.earned, currentValue, team.earnedTime, 400);
    }

    // Update progress bar
    if (teamElements.progress && team.maxTime) {
      const pct = Math.min((team.earnedTime / team.maxTime) * 100, 100);
      teamElements.progress.style.width = pct + "%";
      teamElements.progress.style.display = 'block';
      
      // Update progress bar colors
      teamElements.progress.classList.remove("warning", "critical", "success");
      if (pct >= 80) {
        teamElements.progress.classList.add("success");
      } else if (pct >= 50) {
        teamElements.progress.classList.add("warning");
      }
    }

    // Update history
    if (teamElements.history) {
      updateHistory(teamElements.history, team.history);
    }
  }

  function setConnectionStatus(status, message) {
    const statusPill = elements.connectionStatus;
    if (!statusPill) return;

    statusPill.classList.remove('connected', 'disconnected');
    if (status === 'connected') {
      statusPill.classList.add('connected');
    } else if (status === 'disconnected') {
      statusPill.classList.add('disconnected');
    }

    const messageEl = statusPill.querySelector('.message');
    if (messageEl) {
      messageEl.textContent = message;
    }
  }

  function startStatePolling() {
    if (statePollInterval) return;
    statePollInterval = setInterval(fetchStateSnapshot, STATE_POLL_INTERVAL_MS);
  }

  function stopStatePolling() {
    if (!statePollInterval) return;
    clearInterval(statePollInterval);
    statePollInterval = null;
  }

  function fetchStateSnapshot() {
    fetch('/api/state')
      .then(res => res.json())
      .then(state => updateTeamsFromState(state))
      .catch(() => {});
  }

  // History update function
  function updateHistory(el, history) {
    if (!history || history.length === 0) {
      el.innerHTML = '<p class="empty-state">Waiting for first correct answer...</p>';
      return;
    }

    const recentHistory = history.slice().reverse().slice(0, 5);
    el.innerHTML = recentHistory.map(entry => {
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      return `
        <div class="history-entry">
          <span class="entry-num">#${entry.answer}</span>
          <span class="entry-detail">+5 seconds earned</span>
          <span class="entry-time">${timestamp}</span>
        </div>
      `;
    }).join("");
  }

  // Animation function for smooth number transitions
  function animateValue(el, start, end, duration) {
    if (start === end) return;
    const range = end - start;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + range * eased);
      el.textContent = current;
      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }

  // iOS Alert functionality
  function showIOSAlert(title, message, onConfirm) {
    if (!elements.iosAlert.overlay) return;
    
    elements.iosAlert.title.textContent = title;
    elements.iosAlert.message.textContent = message;
    resetCallback = onConfirm;
    elements.iosAlert.overlay.classList.add('active');
  }

  function hideIOSAlert() {
    if (elements.iosAlert.overlay) {
      elements.iosAlert.overlay.classList.remove('active');
    }
    resetCallback = null;
  }

  // iOS Alert event listeners
  if (elements.iosAlert.cancel) {
    elements.iosAlert.cancel.addEventListener('click', hideIOSAlert);
  }

  if (elements.iosAlert.confirm) {
    elements.iosAlert.confirm.addEventListener('click', () => {
      if (resetCallback) resetCallback();
      hideIOSAlert();
    });
  }

  if (elements.iosAlert.overlay) {
    elements.iosAlert.overlay.addEventListener('click', (e) => {
      if (e.target === elements.iosAlert.overlay) {
        hideIOSAlert();
      }
    });
  }

  // Settings modal functionality
  const SETTINGS_PASSWORD = '8888';

  function showPasswordModal() {
    if (!elements.settings.modal) return;
    
    elements.settings.modal.classList.add('active');
    elements.settings.input.value = '';
    elements.settings.error.style.display = 'none';
    elements.settings.input.focus();
  }

  function hidePasswordModal() {
    if (elements.settings.modal) {
      elements.settings.modal.classList.remove('active');
    }
    elements.settings.input.value = '';
    elements.settings.error.style.display = 'none';
  }

  function checkPassword() {
    const password = elements.settings.input.value;
    if (password === SETTINGS_PASSWORD) {
      hidePasswordModal();
      window.location.href = '/settings.html';
    } else {
      elements.settings.error.style.display = 'block';
      elements.settings.input.classList.add('error');
      setTimeout(() => {
        elements.settings.input.classList.remove('error');
      }, 500);
    }
  }

  // Settings event listeners
  if (elements.settings.btn) {
    elements.settings.btn.addEventListener('click', showPasswordModal);
  }

  if (elements.settings.close) {
    elements.settings.close.addEventListener('click', hidePasswordModal);
  }

  if (elements.settings.submit) {
    elements.settings.submit.addEventListener('click', checkPassword);
  }

  if (elements.settings.input) {
    elements.settings.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        checkPassword();
      }
    });
  }

  if (elements.settings.modal) {
    elements.settings.modal.addEventListener('click', (e) => {
      if (e.target === elements.settings.modal) {
        hidePasswordModal();
      }
    });
  }

  // Button event listeners
  document.querySelectorAll("[data-action=correct]").forEach(btn => {
    btn.addEventListener("click", () => {
      socket.emit("correct", btn.dataset.team);
    });
  });

  document.querySelectorAll("[data-action=reset]").forEach(btn => {
    btn.addEventListener("click", () => {
      const teamName = btn.dataset.team === "anthems" ? "Team Anthems" : "Team Icons";
      showIOSAlert(
        `Reset ${teamName}?`,
        `This will clear all scores and history for ${teamName}.`,
        () => socket.emit("reset", btn.dataset.team)
      );
    });
  });

  if (elements.resetAll) {
    elements.resetAll.addEventListener("click", () => {
      showIOSAlert(
        "Reset ALL teams?",
        "This will clear all scores and history for both teams.",
        () => socket.emit("reset")
      );
    });
  }
});
