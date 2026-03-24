# Chart Toppers — Installation Guide

Chart Toppers is a live gameshow scoring system by Twisted Melon. This guide covers installation, licensing, and first-run configuration.

---

## Prerequisites

Before you begin, ensure the following are installed and available on your Mac:

- **macOS** — required for QLab integration
- **Docker Desktop** — [download at docker.com](https://www.docker.com/products/docker-desktop/)
- **QLab 5 or later** — must be running on the same machine
- **Node.js** is not required locally — the app runs entirely inside Docker

---

## Installation

### 1. Clone and Run

Copy and paste this into Terminal:

```bash
cd ~ && git clone https://github.com/TwistedMelonIO/chart-toppers.git && cd chart-toppers && ./install_license.sh
```

The script will walk you through the full setup:

1. **QLab Audio Folder** — drag your QLab audio folder into the Terminal window when prompted. The script updates `docker-compose.yml` automatically. On subsequent runs it shows the current path and lets you press Enter to keep it.
2. **Docker Build** — builds and starts the Docker containers
3. **Machine ID** — retrieves your unique Machine ID and copies it to your clipboard

### 2. Obtain Your License Key

Send your Machine ID to [hello@twistedmelon.com](mailto:hello@twistedmelon.com) to request a license key.

Chart Toppers will not run without a valid license key tied to your machine.

### 3. Apply the License Key

Once you receive your license key, run the install script again:

```bash
./install_license.sh
```

When prompted, paste your license key and press Enter. The script will validate the key and restart the application with the license applied.

### 4. Open the Web Interface

Once running, open a browser and go to:

```
http://localhost:3200
```

---

## Reinstall / Update

### Quick update (keeps your settings)

From inside the `chart-toppers` folder:

```bash
git pull && docker compose up -d --build
```

Your audio folder path and license key are preserved.

### Full clean reinstall

Removes everything and starts fresh. You will need to set your audio folder and license key again.

```bash
cd ~ && rm -rf chart-toppers && git clone https://github.com/TwistedMelonIO/chart-toppers.git && cd chart-toppers && ./install_license.sh
```

---

## What the Install Script Does

For reference, here is what `install_license.sh` handles automatically:

- Checks that Docker Desktop is running
- Prompts for your QLab audio folder (drag and drop) and updates `docker-compose.yml`
- Builds and starts the `chart-toppers` and `osc-bridge` Docker services
- Retrieves the Machine ID from the running container
- Optionally accepts and validates a license key
- Restarts the containers with the license applied

---

## After Installation

### Settings Panel

Click **Settings** on the dashboard to access configuration options.

The settings password is: `8888`

### OSC Integration with QLab

Chart Toppers communicates with QLab 5 over OSC. Ensure QLab is configured to listen on **port 53000**.

The following OSC commands are used:

| Command | Action |
|---|---|
| `/chart-toppers/playing/anthems` | Activate Anthems team |
| `/chart-toppers/playing/icons` | Activate Icons team |
| `/chart-toppers/stopPlaying/anthems` | Deactivate Anthems team |
| `/chart-toppers/stopPlaying/icons` | Deactivate Icons team |

OSC input from Bitfocus Companion is accepted on **port 53536** (UDP/TCP).

### Ongoing Commands

| Task | Command |
|---|---|
| Rebuild after an update | `docker compose up -d --build` |
| Stop the app | `docker compose stop` |
| View live logs | `docker compose logs -f chart-toppers` |

---

## Uninstall

To completely remove Chart Toppers from a machine, run from inside the project folder:

```bash
./uninstall.sh
```

This removes all Docker containers, images, volumes (including license and activity logs), and the project folder itself. You will be asked to type `YES` to confirm.

---

## Troubleshooting

**Docker is not running**
Start Docker Desktop and wait for it to fully load before running the install script.

**Cannot retrieve Machine ID**
The container may still be starting up. Wait 15–20 seconds and run the script again.

**License key is invalid**
Confirm the license key was issued for this machine. Machine IDs are hardware-specific — a key from another machine will not work.

**QLab is not receiving OSC commands**
Open QLab and verify it is set to listen for OSC on port 53000. Check that no firewall is blocking local UDP traffic.

**Docker "mounts denied" error**
Docker cannot access your QLab audio folder. This happens with iCloud Drive or other restricted paths. Either copy the audio folder to a simpler location (e.g. `~/Desktop/qlab-audio`) and re-run the script, or add the folder in Docker Desktop under Settings > Resources > File Sharing.

**Port 3200 is already in use**
Another service may be running on port 3200. Stop that service or check the port assignment in `docker-compose.yml`.

---

## Support

For license keys and technical support, contact:

[hello@twistedmelon.com](mailto:hello@twistedmelon.com)

---

*Engineering the live experience. — Twisted Melon*
