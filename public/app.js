// APP.JS LOADED - This should appear in console
console.log('APP.JS FILE LOADED SUCCESSFULLY!');

const socket = io();

// Password Modal Elements
const settingsBtn = document.getElementById('settingsBtn');
const passwordModal = document.getElementById('passwordModal');
const passwordInput = document.getElementById('passwordInput');
const submitPassword = document.getElementById('submitPassword');
const closeModal = document.getElementById('closeModal');
const passwordError = document.getElementById('passwordError');
const currentPackDisplay = document.getElementById('currentPackDisplay');

// Settings Password (should be moved to server-side validation in production)
const SETTINGS_PASSWORD = '0000'; // TODO: Move to environment variable

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
  // Setup main app functionality
  setupApp();
});

function setupApp() {
  // Main app setup complete
}

// Load current pack settings
async function loadCurrentPack() {
  try {
    const response = await fetch('/api/pack-settings');
    const data = await response.json();
    if (data.currentPack) {
      updatePackDisplay(data.currentPack);
    }
  } catch (error) {
    // Failed to load pack settings
  }
}

// Update pack display
function updatePackDisplay(pack) {
  const packNames = {
    'uk-usa-german': 'UK / USA / German',
    'european': 'European',
    'teens': 'Teens'
  };
  
  const displayName = packNames[pack] || pack;
  currentPackDisplay.textContent = `Current Pack: ${displayName}`;
}

// Gradient Animation Background Control
class GradientBackground {
  constructor() {
    this.background = document.getElementById("gradientBackground");
    this.pointerCircle = this.background?.querySelector(".gradient-circle.pointer");
    
    // Configuration
    this.config = {
      gradientBackgroundStart: "rgb(10, 5, 20)",
      gradientBackgroundEnd: "rgb(5, 0, 10)",
      firstColor: "40, 20, 80",
      secondColor: "60, 30, 120",
      thirdColor: "80, 40, 140",
      fourthColor: "30, 15, 60",
      fifthColor: "20, 10, 40",
      pointerColor: "50, 25, 100",
      size: "80%",
      blendingValue: "hard-light",
      interactive: true
    };
    
    this.curX = 0;
    this.curY = 0;
    this.tgX = 0;
    this.tgY = 0;
    
    this.init();
  }

  init() {
    if (!this.background) return;
    
    // Set CSS variables
    this.setCSSVariables();
    
    // Setup mouse interaction
    if (this.config.interactive) {
      this.setupMouseInteraction();
    }
    
    // Performance optimizations
    this.optimizePerformance();
    
    // Start animation loop
    this.animate();
  }

  setCSSVariables() {
    const root = document.documentElement;
    root.style.setProperty("--gradient-background-start", this.config.gradientBackgroundStart);
    root.style.setProperty("--gradient-background-end", this.config.gradientBackgroundEnd);
    root.style.setProperty("--first-color", this.config.firstColor);
    root.style.setProperty("--second-color", this.config.secondColor);
    root.style.setProperty("--third-color", this.config.thirdColor);
    root.style.setProperty("--fourth-color", this.config.fourthColor);
    root.style.setProperty("--fifth-color", this.config.fifthColor);
    root.style.setProperty("--pointer-color", this.config.pointerColor);
    root.style.setProperty("--size", this.config.size);
    root.style.setProperty("--blending-value", this.config.blendingValue);
  }

  setupMouseInteraction() {
    if (!this.pointerCircle) return;
    
    const handleMouseMove = (event) => {
      const rect = this.background.getBoundingClientRect();
      this.tgX = event.clientX - rect.left;
      this.tgY = event.clientY - rect.top;
    };

    this.background.addEventListener("mousemove", handleMouseMove);
    
    // Touch support
    this.background.addEventListener("touchmove", (event) => {
      if (event.touches.length > 0) {
        const touch = event.touches[0];
        const rect = this.background.getBoundingClientRect();
        this.tgX = touch.clientX - rect.left;
        this.tgY = touch.clientY - rect.top;
      }
    });
  }

  animate() {
    // Smooth mouse following animation
    this.curX += (this.tgX - this.curX) / 20;
    this.curY += (this.tgY - this.curY) / 20;
    
    if (this.pointerCircle) {
      this.pointerCircle.style.transform = `translate(${Math.round(this.curX)}px, ${Math.round(this.curY)}px)`;
    }
    
    requestAnimationFrame(() => this.animate());
  }

  optimizePerformance() {
    // Detect Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isSafari) {
      this.background?.classList.add("safari");
    }
    
    // Mobile optimization
    if (window.innerWidth <= 768) {
      this.background?.classList.add("mobile-optimized");
    }
    
    // Pause animations when tab is not visible
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.background?.classList.add("paused");
      } else {
        this.background?.classList.remove("paused");
      }
    });
  }

  // Public methods to update configuration
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.setCSSVariables();
  }
}

// Initialize gradient background
const gradientBg = new GradientBackground();

// Dynamic Footer Information
function updateFooterInfo() {
  const oscInfo = document.querySelector(".osc-info");
  if (!oscInfo) return;

  // Get actual configuration from server (you could fetch this from an API endpoint)
  // For now, we'll use the known configuration
  const config = {
    OSC_LISTEN_PORT: 53535,
    QLAB_HOST: "localhost",
    QLAB_PORT: 53000
  };

  oscInfo.innerHTML = `
    <span>OSC In: <code>UDP :${config.OSC_LISTEN_PORT}</code></span>
    <span>OSC Out: <code>${config.QLAB_HOST} :${config.QLAB_PORT}</code></span>
    <span>Status: <code id="connectionStatus">Connected</code></span>
  `;
}

// Update footer on load and connection changes
updateFooterInfo();

// Update connection status dynamically
socket.on("connect", () => {
  statusIndicator.className = "status-indicator";
  statusIndicator.innerHTML = '<span class="dot"></span> Connected';
  const statusElement = document.getElementById("connectionStatus");
  if (statusElement) {
    statusElement.textContent = "Connected";
    statusElement.style.color = "var(--correct)";
  }
});

socket.on("disconnect", () => {
  statusIndicator.className = "status-indicator disconnected";
  statusIndicator.innerHTML = '<span class="dot"></span> Disconnected';
  const statusElement = document.getElementById("connectionStatus");
  if (statusElement) {
    statusElement.textContent = "Disconnected";
    statusElement.style.color = "var(--danger)";
  }
});

socket.on("stateUpdate", (state) => {
  TEAM_IDS.forEach((teamId) => {
    if (state[teamId]) {
      updateTeamUI(teamId, state[teamId]);
    }
  });
});

// Handle team reset events to clear tracking
socket.on("teamReset", (teamId) => {
  if (previousCorrectAnswers[teamId] !== undefined) {
    previousCorrectAnswers[teamId] = 0;
  }
});

// Handle team playing status for animated border
socket.on("teamPlaying", (teamId) => {
  console.log(`[CLIENT] Received teamPlaying event for ${teamId}`);
  // Remove playing class from all team panels
  document.querySelectorAll('.team-panel').forEach(panel => {
    panel.classList.remove('playing');
  });
  
  // Add playing class to the specific team panel
  const teamPanel = document.querySelector(`.team-${teamId}`);
  if (teamPanel) {
    teamPanel.classList.add('playing');
    console.log(`[CLIENT] Added playing class to .team-${teamId}`);
  } else {
    console.error(`[CLIENT] Could not find .team-${teamId} element`);
  }
});

// Handle team stop playing status
socket.on("teamStopPlaying", (teamId) => {
  console.log(`[CLIENT] Received teamStopPlaying event for ${teamId}`);
  // Remove playing class from the specific team panel
  const teamPanel = document.querySelector(`.team-${teamId}`);
  if (teamPanel) {
    teamPanel.classList.remove('playing');
    console.log(`[CLIENT] Removed playing class from .team-${teamId}`);
  } else {
    console.error(`[CLIENT] Could not find .team-${teamId} element`);
  }
});

// Button handlers via data attributes
document.querySelectorAll("[data-action=correct]").forEach((btn) => {
  btn.addEventListener("click", () => {
    socket.emit("correct", btn.dataset.team);
  });
});

document.querySelectorAll("[data-action=reset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (confirm(`Reset ${btn.dataset.team === "anthems" ? "Team Anthems" : "Team Icons"}?`)) {
      socket.emit("reset", btn.dataset.team);
    }
  });
});

btnResetAll.addEventListener("click", () => {
  if (confirm("Reset ALL teams? This will clear all scores.")) {
    socket.emit("reset");
  }
});

// Track previous correct answer counts to determine when to flash
const previousCorrectAnswers = {
  anthems: 0,
  icons: 0
};

// Update a single team's UI
function updateTeamUI(teamId, team) {
  const earnedMainEl = document.getElementById(`${teamId}-earnedTime-main`);
  const progressEl = document.getElementById(`${teamId}-progressFill`);
  const historyEl = document.getElementById(`${teamId}-historyList`);
  const primaryCard = earnedMainEl.closest(".score-card.primary");

  // Check if this team just got a new correct answer
  const justGotCorrectAnswer = team.correctAnswers > (previousCorrectAnswers[teamId] || 0);
  
  // Update the previous count
  previousCorrectAnswers[teamId] = team.correctAnswers;

  // Animate earned time in main card
  animateValue(earnedMainEl, parseInt(earnedMainEl.textContent), team.earnedTime, 400);

  // Progress bar - show earned time as percentage of max possible
  const maxPossibleTime = team.maxTime; // Maximum possible earned time
  const pct = Math.min((team.earnedTime / maxPossibleTime) * 100, 100);
  progressEl.style.width = pct + "%";

  progressEl.classList.remove("warning", "critical");
  // Change colors based on earned time progress
  if (pct >= 80) {
    progressEl.classList.add("success");
  } else if (pct >= 50) {
    progressEl.classList.add("warning");
  }

  // Flash effect only when this team just got a correct answer
  if (justGotCorrectAnswer) {
    primaryCard.classList.remove("flash");
    void primaryCard.offsetWidth;
    primaryCard.classList.add("flash");
  }

  // History
  renderHistory(historyEl, team.history);
}

function renderHistory(el, history) {
  if (!history || history.length === 0) {
    el.innerHTML = '<p class="empty-state">Waiting for first correct answer...</p>';
    return;
  }

  el.innerHTML = history
    .slice()
    .reverse()
    .map(
      (entry) => {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        return `
    <div class="history-entry">
      <span class="entry-num">#${entry.answer}</span>
      <span class="entry-detail">+5 seconds earned</span>
      <span class="entry-time">${timestamp}</span>
    </div>
  `;
      }
    )
    .join("");
}

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

// Settings and Password Modal Functionality
function showPasswordModal() {
  passwordModal.classList.add('active');
  passwordInput.value = '';
  passwordError.style.display = 'none';
  passwordInput.focus();
}

function hidePasswordModal() {
  passwordModal.classList.remove('active');
  passwordInput.value = '';
  passwordError.style.display = 'none';
}

function checkPassword() {
  const password = passwordInput.value;
  if (password === SETTINGS_PASSWORD) {
    hidePasswordModal();
    window.location.href = '/settings.html';
  } else {
    passwordError.style.display = 'block';
    passwordInput.classList.add('error');
    setTimeout(() => {
      passwordInput.classList.remove('error');
    }, 500);
  }
}

// Event listeners for settings modal
if (settingsBtn) {
  settingsBtn.addEventListener('click', showPasswordModal);
}

if (closeModal) {
  closeModal.addEventListener('click', hidePasswordModal);
}

if (submitPassword) {
  submitPassword.addEventListener('click', checkPassword);
}

// Listen for real-time pack changes from server
socket.on("packChanged", (pack) => {
  updatePackDisplay(pack);
});

// Load current pack on page load
loadCurrentPack();

// Password input Enter key support
if (passwordInput) {
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      checkPassword();
    }
  });
}

// Close modal when clicking outside
if (passwordModal) {
  passwordModal.addEventListener('click', (e) => {
    if (e.target === passwordModal) {
      hidePasswordModal();
    }
  });
}
