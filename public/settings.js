// Settings page JavaScript
class SettingsPage {
  constructor() {
    this.activityData = [];
    this.filteredData = [];
    this.init();
  }

  init() {
    this.setupGradientBackground();
    this.setupEventListeners();
    this.loadActivityData();
    this.loadPackSettings();
    this.loadAudioPath();
  }

  setupGradientBackground() {
    // Reuse the gradient background from main app
    this.gradientBg = new GradientBackground();
  }

  setupEventListeners() {
    const teamFilter = document.getElementById('teamFilter');
    const typeFilter = document.getElementById('typeFilter');
    const dateFilter = document.getElementById('dateFilter');
    const savePackBtn = document.getElementById('savePackBtn');
    const exportBtn = document.getElementById('exportBtn');
    const resetBtn = document.getElementById('resetBtn');

    if (teamFilter) {
      teamFilter.addEventListener('change', () => this.applyFilters());
    }
    if (typeFilter) {
      typeFilter.addEventListener('change', () => this.applyFilters());
    }
    if (dateFilter) {
      dateFilter.addEventListener('change', () => this.applyFilters());
    }
    if (savePackBtn) {
      savePackBtn.addEventListener('click', () => this.savePackSettings());
    }

    const saveAudioPathBtn = document.getElementById('saveAudioPathBtn');
    if (saveAudioPathBtn) {
      saveAudioPathBtn.addEventListener('click', () => this.saveAudioPath());
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportLogs());
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.showResetModal());
    }

    // Setup modal event listeners
    this.setupModalListeners();
  }

  setupModalListeners() {
    const modal = document.getElementById('resetModal');
    const modalClose = document.getElementById('modalClose');
    const modalCancel = document.getElementById('modalCancel');
    const modalConfirm = document.getElementById('modalConfirm');
    const passwordInput = document.getElementById('passwordInput');

    // Close modal events
    if (modalClose) {
      modalClose.addEventListener('click', () => this.hideResetModal());
    }
    if (modalCancel) {
      modalCancel.addEventListener('click', () => this.hideResetModal());
    }

    // Confirm reset event
    if (modalConfirm) {
      modalConfirm.addEventListener('click', () => this.resetActivityLogs());
    }

    // Close on overlay click
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hideResetModal();
        }
      });
    }

    // Enter key to submit
    if (passwordInput) {
      passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.resetActivityLogs();
        }
      });
    }

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        this.hideResetModal();
      }
    });
  }

  showResetModal() {
    const modal = document.getElementById('resetModal');
    const passwordInput = document.getElementById('passwordInput');
    const passwordError = document.getElementById('passwordError');
    
    // Reset form
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.focus();
    }
    if (passwordError) {
      passwordError.style.display = 'none';
    }
    
    // Show modal
    if (modal) {
      modal.classList.add('active');
    }
  }

  hideResetModal() {
    const modal = document.getElementById('resetModal');
    const passwordInput = document.getElementById('passwordInput');
    const passwordError = document.getElementById('passwordError');
    
    // Hide modal
    if (modal) {
      modal.classList.remove('active');
    }
    
    // Reset form
    if (passwordInput) {
      passwordInput.value = '';
    }
    if (passwordError) {
      passwordError.style.display = 'none';
    }
  }

  async resetActivityLogs() {
    const passwordInput = document.getElementById('passwordInput');
    const passwordError = document.getElementById('passwordError');
    const modalConfirm = document.getElementById('modalConfirm');
    
    const password = passwordInput ? passwordInput.value : '';
    
    if (!password) {
      if (passwordError) {
        passwordError.textContent = 'Please enter a password';
        passwordError.style.display = 'block';
      }
      return;
    }

    // Disable confirm button during request
    if (modalConfirm) {
      modalConfirm.disabled = true;
      modalConfirm.textContent = 'Resetting...';
    }

    try {
      const response = await fetch('/api/activity/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Success - hide modal and refresh data
        this.hideResetModal();
        this.loadActivityData(); // Refresh the activity log
        
        // Show success feedback
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
          const originalText = resetBtn.innerHTML;
          resetBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Reset Complete
          `;
          resetBtn.style.borderColor = 'var(--correct)';
          resetBtn.style.color = 'var(--correct)';
          
          setTimeout(() => {
            resetBtn.innerHTML = originalText;
            resetBtn.style.borderColor = '';
            resetBtn.style.color = '';
          }, 2000);
        }
      } else {
        // Error - show error message
        if (passwordError) {
          passwordError.textContent = result.message || 'Failed to reset logs';
          passwordError.style.display = 'block';
        }
      }
    } catch (error) {
      console.error('Error resetting activity logs:', error);
      if (passwordError) {
        passwordError.textContent = 'Network error. Please try again.';
        passwordError.style.display = 'block';
      }
    } finally {
      // Re-enable confirm button
      if (modalConfirm) {
        modalConfirm.disabled = false;
        modalConfirm.textContent = 'Reset Logs';
      }
    }
  }

  async loadActivityData() {
    try {
      const response = await fetch('/api/activity');
      if (response.ok) {
        const data = await response.json();
        this.activityData = data;
        this.applyFilters();
        this.updateStatistics();
      } else {
        console.error('Failed to load activity data');
        this.showEmptyState();
      }
    } catch (error) {
      console.error('Error loading activity data:', error);
      this.showEmptyState();
    }
  }

  applyFilters() {
    const teamFilter = document.getElementById('teamFilter').value;
    const typeFilter = document.getElementById('typeFilter').value;
    const dateFilter = document.getElementById('dateFilter').value;

    // Filter by date
    const now = new Date();
    const daysBack = parseInt(dateFilter);
    const cutoffDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));

    this.filteredData = this.activityData.filter(entry => {
      const entryDate = new Date(entry.timestamp);
      
      // Date filter
      if (entryDate < cutoffDate) return false;
      
      // Team filter
      if (teamFilter !== 'all' && entry.team !== teamFilter) return false;
      
      // Type filter
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
      
      return true;
    });

    this.renderActivityTable();
  }

  updateStatistics() {
    const stats = {
      totalCorrectAnswers: 0,
      totalResets: 0,
      totalStops: 0,
      totalPlayingStarted: 0,
      totalPlayingStopped: 0,
      totalGames: 0
    };

    // Calculate statistics from today only
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    
    this.activityData.forEach(entry => {
      const entryDate = new Date(entry.timestamp);
      if (entryDate >= today) {
        switch (entry.type) {
          case 'correct':
            stats.totalCorrectAnswers++;
            break;
          case 'reset':
            stats.totalResets++;
            // Count a "game" when both teams are reset
            if (entry.details.includes('all teams')) {
              stats.totalGames++;
            }
            break;
          case 'stop':
            stats.totalStops++;
            break;
          case 'playing':
            stats.totalPlayingStarted++;
            break;
          case 'stopPlaying':
            stats.totalPlayingStopped++;
            break;
        }
      }
    });

    // Update UI
    document.getElementById('totalCorrectAnswers').textContent = stats.totalCorrectAnswers;
    document.getElementById('totalResets').textContent = stats.totalResets;
    document.getElementById('totalStops').textContent = stats.totalStops;
    document.getElementById('totalGames').textContent = stats.totalGames;
    
    // Add OSC statistics if elements exist
    const playingStartedEl = document.getElementById('totalPlayingStarted');
    const playingStoppedEl = document.getElementById('totalPlayingStopped');
    
    if (playingStartedEl) playingStartedEl.textContent = stats.totalPlayingStarted;
    if (playingStoppedEl) playingStoppedEl.textContent = stats.totalPlayingStopped;
  }

  renderActivityTable() {
    const tbody = document.getElementById('activityTableBody');

    if (!this.filteredData || this.filteredData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-activity">
            No activity found for the selected filters
          </td>
        </tr>
      `;
      return;
    }

    const sorted = this.filteredData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const display = sorted.slice(0, 10);
    const hasMore = sorted.length > 10;

    let html = display.map(entry => this.createActivityRow(entry)).join('');

    if (hasMore) {
      html += `
        <tr>
          <td colspan="5" style="text-align: center; padding: 1.25rem;">
            <button id="viewAllLogsBtn" style="background: transparent; border: 1px solid var(--accent); color: var(--accent); padding: 0.6rem 1.5rem; border-radius: 8px; cursor: pointer; font-family: 'Outfit', sans-serif; font-weight: 600; font-size: 0.85rem; transition: all 0.3s ease;">
              View All ${sorted.length} Entries
            </button>
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = html;

    // Bind view all button
    if (hasMore) {
      const viewAllBtn = document.getElementById('viewAllLogsBtn');
      if (viewAllBtn) {
        viewAllBtn.addEventListener('click', () => {
          tbody.innerHTML = sorted.map(entry => this.createActivityRow(entry)).join('');
        });
      }
    }
  }

  createActivityRow(entry) {
    const date = new Date(entry.timestamp);
    const formattedDate = date.toLocaleDateString();
    const formattedTime = date.toLocaleTimeString();

    const teamName = entry.team === 'anthems' ? 'Team Anthems' : 
                   entry.team === 'icons' ? 'Team Icons' : 
                   entry.team === 'all' ? 'All Teams' : 'System';

    return `
      <tr>
        <td>${formattedDate} ${formattedTime}</td>
        <td>${teamName}</td>
        <td><span class="activity-type ${entry.type}">${entry.type}</span></td>
        <td>${entry.details}</td>
        <td>${entry.source}</td>
      </tr>
    `;
  }

  showEmptyState() {
    const tbody = document.getElementById('activityTableBody');
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-activity">
          Unable to load activity data. Please check server connection.
        </td>
      </tr>
    `;
  }

  async loadAudioPath() {
    try {
      const res = await fetch('/api/audio-path');
      const data = await res.json();
      const input = document.getElementById('audioBasePath');
      if (input && data.audioBasePath) {
        input.value = data.audioBasePath;
      }
    } catch (e) {
      console.error('Failed to load audio path:', e);
    }
  }

  async saveAudioPath() {
    const input = document.getElementById('audioBasePath');
    const status = document.getElementById('audioPathStatus');
    const btn = document.getElementById('saveAudioPathBtn');
    if (!input) return;

    btn.disabled = true;
    btn.textContent = 'Saving...';
    status.textContent = '';

    try {
      const res = await fetch('/api/audio-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBasePath: input.value.trim() })
      });
      const data = await res.json();
      if (data.success) {
        status.textContent = 'Path saved and cues retargeted.';
        status.style.color = '#4ade80';
      } else {
        status.textContent = data.error || 'Failed to save.';
        status.style.color = '#f87171';
      }
    } catch (e) {
      status.textContent = 'Failed to save path.';
      status.style.color = '#f87171';
    }

    btn.disabled = false;
    btn.textContent = 'Save Path';
    setTimeout(() => { status.textContent = ''; }, 5000);
  }

  async loadPackSettings() {
    try {
      const response = await fetch('/api/pack-settings');
      if (response.ok) {
        const settings = await response.json();
        this.updatePackUI(settings);
      } else {
        // Use default settings if none exist
        this.updatePackUI({
          currentPack: 'uk-usa-german',
          lastChanged: null
        });
      }
    } catch (error) {
      console.error('Error loading pack settings:', error);
      // Use default settings on error
      this.updatePackUI({
        currentPack: 'uk-usa-german',
        lastChanged: null
      });
    }
  }

  updatePackUI(settings) {
    const packSelect = document.getElementById('packSelect');
    const currentPackDisplay = document.getElementById('currentPackDisplay');
    const packLastChanged = document.getElementById('packLastChanged');

    if (packSelect) {
      packSelect.value = settings.currentPack || 'uk-usa-german';
    }
    if (currentPackDisplay) {
      const packNames = {
        'uk-usa-german': 'Pack 1: UK / USA / Germany',
        'european': 'Pack 2: Europe Med',
        'teens': 'Pack 3: Teens'
      };
      currentPackDisplay.textContent = packNames[settings.currentPack] || 'Pack 1: UK / USA / Germany';
    }
    if (packLastChanged) {
      if (settings.lastChanged) {
        const date = new Date(settings.lastChanged);
        packLastChanged.textContent = date.toLocaleString();
      } else {
        packLastChanged.textContent = 'Never';
      }
    }
  }

  async exportLogs() {
    const exportBtn = document.getElementById('exportBtn');
    if (!exportBtn) return;

    // Show loading state
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      Exporting...
    `;
    exportBtn.disabled = true;

    try {
      // Get current filter values
      const teamFilter = document.getElementById('teamFilter')?.value || 'all';
      const typeFilter = document.getElementById('typeFilter')?.value || 'all';
      const dateFilter = document.getElementById('dateFilter')?.value || '60';

      // Fetch all activity data
      const response = await fetch('/api/activity');
      if (!response.ok) throw new Error('Failed to fetch activity data');
      
      const allData = await response.json();
      
      // Apply current filters
      const now = new Date();
      const daysBack = parseInt(dateFilter);
      const cutoffDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));
      
      const filteredData = allData.filter(entry => {
        const entryDate = new Date(entry.timestamp);
        if (entryDate < cutoffDate) return false;
        if (teamFilter !== 'all' && entry.team !== teamFilter) return false;
        if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
        return true;
      });

      if (filteredData.length === 0) {
        alert('No activity data to export for the selected filters.');
        exportBtn.innerHTML = originalText;
        exportBtn.disabled = false;
        return;
      }

      // Format data as text
      let textContent = 'CHART TOPPERS - ACTIVITY LOG\n';
      textContent += '===========================\n\n';
      textContent += `Export Date: ${new Date().toLocaleString()}\n`;
      textContent += `Filters: Team=${teamFilter}, Type=${typeFilter}, Days=${dateFilter}\n`;
      textContent += `Total Entries: ${filteredData.length}\n\n`;
      textContent += 'TIMESTAMP                | TEAM         | TYPE     | DETAILS\n';
      textContent += '-------------------------|--------------|----------|----------------------------------------\n';

      filteredData
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach(entry => {
          const date = new Date(entry.timestamp);
          const dateStr = date.toLocaleString().padEnd(24);
          const teamName = (entry.team === 'anthems' ? 'Team Anthems' : 
                           entry.team === 'icons' ? 'Team Icons' : 
                           entry.team === 'all' ? 'All Teams' : entry.team).padEnd(12);
          const typeStr = entry.type.toUpperCase().padEnd(8);
          textContent += `${dateStr}| ${teamName} | ${typeStr} | ${entry.details}\n`;
        });

      // Create and download file
      const blob = new Blob([textContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chart-toppers-activity-log-${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Show success
      exportBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Exported!
      `;
      setTimeout(() => {
        exportBtn.innerHTML = originalText;
        exportBtn.disabled = false;
      }, 2000);

    } catch (error) {
      console.error('Error exporting logs:', error);
      exportBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Error
      `;
      setTimeout(() => {
        exportBtn.innerHTML = originalText;
        exportBtn.disabled = false;
      }, 2000);
    }
  }

  async savePackSettings() {
    const packSelect = document.getElementById('packSelect');
    const savePackBtn = document.getElementById('savePackBtn');
    
    if (!packSelect) return;

    const newPack = packSelect.value;
    
    // Disable button during save
    if (savePackBtn) {
      savePackBtn.disabled = true;
      savePackBtn.textContent = 'Saving...';
    }

    try {
      const response = await fetch('/api/pack-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentPack: newPack,
          lastChanged: new Date().toISOString()
        })
      });

      if (response.ok) {
        const settings = await response.json();
        this.updatePackUI(settings);
        
        // Log the pack change
        console.log(`Pack changed to: ${newPack}`);
        
        // Show success feedback
        if (savePackBtn) {
          savePackBtn.textContent = 'Saved!';
          setTimeout(() => {
            savePackBtn.textContent = 'Save Pack';
            savePackBtn.disabled = false;
          }, 2000);
        }
      } else {
        throw new Error('Failed to save pack settings');
      }
    } catch (error) {
      console.error('Error saving pack settings:', error);
      
      // Show error feedback
      if (savePackBtn) {
        savePackBtn.textContent = 'Error';
        setTimeout(() => {
          savePackBtn.textContent = 'Save Pack';
          savePackBtn.disabled = false;
        }, 2000);
      }
    }
  }
}

// Gradient Background Class (copied from app.js)
class GradientBackground {
  constructor() {
    this.background = document.getElementById("gradientBackground");
    this.pointerCircle = this.background?.querySelector(".gradient-circle.pointer");
    
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
    
    this.setCSSVariables();
    
    if (this.config.interactive) {
      this.setupMouseInteraction();
    }
    
    this.optimizePerformance();
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
    this.curX += (this.tgX - this.curX) / 20;
    this.curY += (this.tgY - this.curY) / 20;
    
    if (this.pointerCircle) {
      this.pointerCircle.style.transform = `translate(${Math.round(this.curX)}px, ${Math.round(this.curY)}px)`;
    }
    
    requestAnimationFrame(() => this.animate());
  }

  optimizePerformance() {
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isSafari) {
      this.background?.classList.add("safari");
    }
    
    if (window.innerWidth <= 768) {
      this.background?.classList.add("mobile-optimized");
    }
    
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.background?.classList.add("paused");
      } else {
        this.background?.classList.remove("paused");
      }
    });
  }
}

// Initialize settings page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SettingsPage();
});
