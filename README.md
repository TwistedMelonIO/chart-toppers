# 🎵 Chart Toppers - QLab Scoring System

A professional web-based scoring system for Chart Toppers game shows, integrated with QLab via OSC commands.

## ✨ Features

### 🎮 Game Management
- **Real-time scoring** for two teams (Anthems & Icons)
- **QLab integration** via OSC commands
- **Visual team indicators** with animated borders
- **Activity logging** with detailed event tracking

### 🎨 Visual Design
- **Modern dark theme** with Chart Toppers branding
- **Animated team borders** (blue → gold when active)
- **Responsive design** for all screen sizes
- **Professional gradient backgrounds**

### 🔧 Technical Features
- **Docker containerized** deployment
- **Socket.IO real-time** updates
- **Persistent data storage** for activity logs
- **Password-protected** settings panel

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- QLab (for OSC integration)

### Installation
```bash
# Clone the repository
git clone <repository-url>
cd chart-toppers

# Start the application
docker-compose up --build -d

# Access the web interface
open http://localhost:3000
```

## 🎮 Usage

### OSC Commands (Port 53536)
```
/chart-toppers/playing/anthems     # Activate Anthems team
/chart-toppers/playing/icons        # Activate Icons team
/chart-toppers/stopPlaying/anthems  # Deactivate Anthems team
/chart-toppers/stopPlaying/icons     # Deactivate Icons team
```

### Web Interface
- **Main Dashboard**: http://localhost:3000
- **Settings Panel**: Click "Settings" (password: 0000)
- **Activity Log**: View detailed game history in settings

### Team Management
- **Visual Indicators**: Teams glow gold when active
- **Exclusive Activation**: Only one team active at a time
- **Real-time Updates**: Instant visual feedback

## 🔧 Configuration

### Environment Variables
```yaml
environment:
  - WEB_PORT=3000
  - OSC_LISTEN_PORT=53536
  - MAX_TIME=100
  - POINTS_PER_CORRECT=5
  - QLAB_CUE_ANTHEMS=ANTHEMS
  - QLAB_CUE_ICONS=ICONS
  - BRIDGE_URL=http://osc-bridge:3001
```

### QLab Setup
1. Configure QLab to listen on port 53000
2. Set up cue names: ANTHEMS, ICONS
3. Send OSC commands to trigger team animations

## 📊 Activity Tracking

### Logged Events
- ✅ **Correct answers** with timestamps
- 🔄 **Team resets** and game states
- 🛑 **Stop commands** and pauses
- 🎵 **Playing status** changes (OSC)
- ⚙️ **System events** and configuration changes

### Activity Types
- `correct` - Green badge
- `reset` - Red badge
- `stop` - Yellow badge
- `playing` - Gold badge (OSC)
- `stopPlaying` - Blue badge (OSC)
- `system` - Purple badge

## 🔐 Security

### Password Protection
- **Settings Panel**: Protected with password (0000)
- **API Endpoints**: Input validation and sanitization
- **No Debug Code**: Production-ready with clean console

### Security Notes
- Password should be moved to environment variables in production
- All API inputs are validated
- No sensitive data exposed in client-side code

## 🐳 Docker Deployment

### Services
- **chart-toppers**: Main application (Node.js)
- **osc-bridge**: OSC communication bridge

### Volumes
- **chart-toppers-data**: Persistent storage for logs and settings

### Ports
- **3000**: Web interface
- **53536**: OSC input (UDP/TCP)

## 📁 Project Structure

```
chart-toppers/
├── public/                 # Static web files
│   ├── index.html         # Main dashboard
│   ├── settings.html      # Settings panel
│   ├── styles.css         # Styling
│   ├── app.js            # Main application logic
│   └── settings.js       # Settings functionality
├── src/
│   └── server.js          # Node.js backend
├── bridge/                # OSC bridge service
├── data/                  # Persistent storage
├── docker-compose.yml     # Docker configuration
├── Dockerfile            # Container build
└── package.json          # Node.js dependencies
```

## 🎯 OSC Integration

### Supported Commands
| Command | Action | Visual Effect |
|---------|--------|---------------|
| `/chart-toppers/playing/anthems` | Activate Anthems | Gold border + glow |
| `/chart-toppers/playing/icons` | Activate Icons | Gold border + glow |
| `/chart-toppers/stopPlaying/anthems` | Deactivate Anthems | Blue border |
| `/chart-toppers/stopPlaying/icons` | Deactivate Icons | Blue border |

### Visual Feedback
- **Inactive State**: Subtle blue borders
- **Active State**: Gold glowing borders
- **Smooth Transitions**: 0.5s color changes
- **Exclusive Activation**: Only one team active

## 🛠️ Development

### Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Testing
```bash
# Run test suite
npm test

# Integration tests
npm run test:integration
```

## 📝 License

Chart Toppers Scoring System - Twisted Melon Ltd.

## 🤝 Support

For technical support or questions:
- Check the activity logs in the settings panel
- Verify OSC command format and port configuration
- Ensure Docker containers are running properly

---

**Version**: 1.0.0  
**Last Updated**: 2025  
**Compatible**: QLab 4+, Docker 20+
