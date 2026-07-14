# Chat Desktop Application

## Setup Instructions

### 1. Install Dependencies
```bash
.\install.bat
```

### 2. Run the App
```bash
npm start
```

### 3. Build .exe File
```bash
.\build.bat
```

## Features

- **Server URL**: http://10.40.10.125:8001
- **Full Screen Support**: Press F11
- **Zoom Controls**: Ctrl+Plus, Ctrl+Minus, Ctrl+0
- **Reload**: Ctrl+R
- **External Links**: Open in default browser
- **Windows Installer**: Creates distributable .exe

## Requirements

- Node.js installed
- Django server running on http://10.40.10.125:8001

## Output

After building, the installer will be in:
```
dist\IT Support Setup 1.0.14.exe
```

## Usage

1. Make sure Django server is running on 10.40.10.125:8001
2. Run the desktop app
3. Login and use the chat application
