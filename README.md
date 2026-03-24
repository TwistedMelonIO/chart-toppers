# Chart Toppers

A live gameshow scoring system by [Twisted Melon](https://twistedmelon.com), with real-time QLab integration via OSC.

Requires **Docker** and a **license key** to run.

---

## Quick Install

Make sure [Docker Desktop](https://www.docker.com/products/docker-desktop/) is running, then copy and paste into Terminal:

```bash
git clone https://github.com/TwistedMelonIO/chart-toppers.git && cd chart-toppers && ./install_license.sh
```

The script will guide you through:

1. Setting your **QLab audio folder** (drag and drop into Terminal)
2. Building and starting the Docker containers
3. Retrieving your **Machine ID** (copied to clipboard)
4. Entering your **license key** (or skip and add later)

For the full setup guide, see [INSTALL.md](INSTALL.md).

---

## Features

- Real-time scoring for two teams (Anthems and Icons)
- QLab 5 integration via OSC commands
- Visual team indicators with animated borders
- Activity logging with detailed event tracking
- Docker containerized deployment
- Socket.IO real-time updates
- Password-protected settings panel

## Usage

| | |
|---|---|
| **Web Dashboard** | http://localhost:3200 |
| **Settings Panel** | Click Settings on the dashboard (password: `8888`) |
| **OSC Input** | Port 53536 (UDP/TCP) from Bitfocus Companion |

### OSC Commands

| Command | Action |
|---|---|
| `/chart-toppers/playing/anthems` | Activate Anthems team |
| `/chart-toppers/playing/icons` | Activate Icons team |
| `/chart-toppers/stopPlaying/anthems` | Deactivate Anthems team |
| `/chart-toppers/stopPlaying/icons` | Deactivate Icons team |

## Docker Commands

| Task | Command |
|---|---|
| Rebuild after an update | `docker compose up -d --build` |
| Stop | `docker compose stop` |
| View logs | `docker compose logs -f chart-toppers` |

## Support

For license keys and technical support, contact [hello@twistedmelon.com](mailto:hello@twistedmelon.com).

---

*"Engineering the live experience." — Twisted Melon*
