# Chart Toppers

A live gameshow scoring system by [Twisted Melon](https://twistedmelon.com), with real-time QLab integration via OSC.

Requires **Docker Desktop** and a **license key** to run.

---

## Install (New Machine)

**Prerequisites:** Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and make sure it's running.

**One command — copy and paste into Terminal:**

```bash
cd ~ && git clone https://github.com/TwistedMelonIO/chart-toppers.git && cd chart-toppers && ./install_license.sh
```

The installer handles everything automatically:

1. Installs **Homebrew** (if not present)
2. Installs **Python 3.12** (if not present)
3. Detects your **hardware ID**
4. Sets your **QLab audio folder** (drag and drop)
5. Builds and starts **Docker containers**
6. Sets up the **QLab Buzzer** (background service)
7. Opens **Accessibility permissions** (required for buzzers)
8. Retrieves your **Machine ID** and activates your **license**

After install, everything starts automatically on login.

## Daily Use

| Task | Command |
|---|---|
| **Start everything** | `cd ~/chart-toppers && ./start.sh` |
| **Stop everything** | `cd ~/chart-toppers && ./stop.sh` |
| **Dashboard** | http://localhost:3200 |
| **Settings** | Click Settings on dashboard (password: `8888`) |

## Update

```bash
cd ~/chart-toppers && git pull && ./start.sh
```

## All-in-One Updater (Chart Toppers + WIIAM + Docforge)

If the machine runs more than one Twisted Melon Docker app, this single command will:

1. Pull the latest GitHub release of **Chart Toppers**, **Win It In A Minute**, and **Docforge**
2. Rebuild each Docker stack (license, Machine ID, and settings are preserved)
3. (Re)install the **buzzer LaunchAgent** so it points at the current Chart Toppers install and starts on every login

**Prerequisites:** `git`, `docker` (Docker Desktop running), and access to the private TwistedMelonIO repos. On a fresh Mac, install the Xcode Command Line Tools first (`xcode-select --install`).

**First time on a new machine:**

```bash
mkdir -p ~/TwistedMelon
git clone https://github.com/TwistedMelonIO/chart-toppers.git ~/TwistedMelon/chart-toppers
~/TwistedMelon/chart-toppers/scripts/update-dockers.sh
```

The first `git clone` will prompt for GitHub credentials — the same account is used to clone WIIAM and Docforge.

**Every time after that:**

```bash
cd ~/TwistedMelon/chart-toppers && git pull && ./scripts/update-dockers.sh
```

**Update only one project:**

```bash
~/TwistedMelon/chart-toppers/scripts/update-dockers.sh chart       # only Chart Toppers
~/TwistedMelon/chart-toppers/scripts/update-dockers.sh wim         # only Win It In A Minute
~/TwistedMelon/chart-toppers/scripts/update-dockers.sh docforge    # only Docforge
```

After the chart-toppers update, watch `tail -f /tmp/qlab-buzzer.log` to confirm the buzzer service has reconnected.

## Full Clean Reinstall

```bash
cd ~ && rm -rf chart-toppers && git clone https://github.com/TwistedMelonIO/chart-toppers.git && cd chart-toppers && ./install_license.sh
```

---

## Features

- Real-time scoring for two teams (Anthems and Icons)
- Golden Record power-up (one-time 2x boost per team)
- QLab 5 integration via OSC commands
- USB buzzer support (works when QLab isn't focused)
- Buzzer connection status in dashboard
- Round 4 track play control with replay prevention
- Activity logging with detailed event tracking
- Docker containerized deployment
- Socket.IO real-time updates

## OSC Commands (Bitfocus Companion)

| Command | Action |
|---|---|
| `/chart-toppers/correct/anthems` | Register correct answer for Anthems |
| `/chart-toppers/correct/icons` | Register correct answer for Icons |
| `/chart-toppers/golden-record/anthems` | Activate Golden Record for Anthems |
| `/chart-toppers/golden-record/icons` | Activate Golden Record for Icons |
| `/chart-toppers/r4/1` to `/r4/4` | Play Round 4 track (one-shot) |
| `/chart-toppers/playing/anthems` | Activate Anthems team |
| `/chart-toppers/playing/icons` | Activate Icons team |
| `/chart-toppers/stopPlaying/anthems` | Deactivate Anthems team |
| `/chart-toppers/stopPlaying/icons` | Deactivate Icons team |
| `/chart-toppers/reset/anthems` | Reset Anthems team |
| `/chart-toppers/reset/icons` | Reset Icons team |
| `/chart-toppers/reset` | Reset all teams |
| `/chart-toppers/round/1` to `/round/4` | Set active round |

## Buzzer Keys

| Key | Action | QLab Cue |
|---|---|---|
| `1` | Icon Buzzer | `IBUZZ` |
| `2` | Anthem Buzzer | `ABUZZ` |

Edit `buzzer/config.json` to change key mappings.

## Uninstall

```bash
cd ~/chart-toppers && ./uninstall.sh
```

You will be asked to type `YES` to confirm.

## Support

For license keys and technical support, contact [hello@twistedmelon.com](mailto:hello@twistedmelon.com).

---

*"Engineering the live experience." — Twisted Melon*
