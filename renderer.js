const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const mm = require('music-metadata');
const packageJson = require('./package.json');
const crypto = require('crypto');

const selectLibraryBtn = document.getElementById('select-library-small');
const trackList = document.getElementById('track-list-small');
const trackCount = document.getElementById('track-count');
const libraryPath = document.getElementById('library-path-small');
const audio = new Audio();
let isExternalControl = false;

const playBtn = document.getElementById('play-btn-small');
const pauseBtn = document.getElementById('pause-btn-small');
const prevBtn = document.getElementById('prev-btn-small');
const nextBtn = document.getElementById('next-btn-small');
const repeatBtn = document.getElementById('repeat-btn-small');
const progressSlider = document.getElementById('progress-small');
const volumeSlider = document.getElementById('volume-small');
const currentTimeEl = document.getElementById('current-time-small');
const durationEl = document.getElementById('duration-small');
const trackTitle = document.getElementById('track-title-small');
const trackArtist = document.getElementById('track-artist-small');

const lpcPlayBtn = document.getElementById('lpc-play-btn');
const lpcProgress = document.getElementById('lpc-progress');
const lpcVolume = document.getElementById('lpc-volume');
const lpcCurrentTime = document.getElementById('lpc-current-time');
const lpcDuration = document.getElementById('lpc-duration');

const lyricsBtn = document.getElementById('lyrics-btn-small');
const lyricsModal = document.getElementById('lyrics-modal');
const lyricsTextarea = document.getElementById('lyrics-textarea');
const lyricsDisplay = document.getElementById('lyrics-display');
const lyricsSaveBtn = document.getElementById('lyrics-save-btn');
const lyricsLoadBtn = document.getElementById('lyrics-load-btn');
const lyricsFetchBtn = document.getElementById('lyrics-fetch-btn');
const lyricsCloseBtn = document.getElementById('lyrics-close-btn');
const lrcOffsetInput = document.getElementById('lrc-offset-input');
const lrcOffsetContainer = document.getElementById('lrc-offset-container');

const editPlaylistBtn = document.getElementById('edit-playlist-btn');
const searchInput = document.getElementById('track-search');

const config = require('./config');

let tracks = [];
let currentTrackIndex = 0;
let repeatMode = 'none';
let isPlaying = false;
let libraryFolder = '';
let currentLyricsTrack = null;
let originalTracks = [];
let isLyricsEditing = false;
let isPlaylistEditing = false;
let draggedItem = null;
let dropIndicator = null;
let scrollPosition = 0;
let insertAfterIndex = -1;

const CONFIG_DIR = path.join(os.homedir(), '.config', 'kute-player');
const LYRICS_DIR = path.join(CONFIG_DIR, 'txts');
const PLAYLIST_ORDER_FILE = path.join(CONFIG_DIR, 'playlist_order.json');
const MATUGEN_FILE = path.join(CONFIG_DIR, 'matugen', 'kute.json');
const OFFSETS_FILE = path.join(CONFIG_DIR, 'offsets.json');
const STATS_FILE = path.join(CONFIG_DIR, 'stats.json');

const editMetadataBtn = document.getElementById('edit-metadata-btn');
const metadataModal = document.getElementById('metadata-modal');
const metadataCoverPreview = document.getElementById('metadata-cover-preview');
const metadataCoverBtn = document.getElementById('metadata-cover-btn');
const metadataCoverInput = document.getElementById('metadata-cover-input');
const metadataTitle = document.getElementById('metadata-title');
const metadataArtist = document.getElementById('metadata-artist');
const metadataAlbum = document.getElementById('metadata-album');
const metadataSaveBtn = document.getElementById('metadata-save-btn');
const metadataCancelBtn = document.getElementById('metadata-cancel-btn');

const shortcutsBtn = document.getElementById('shortcuts-btn-small');
const shortcutsModal = document.getElementById('shortcuts-modal');
const shortcutsCloseBtn = document.getElementById('shortcuts-close-btn');

const settingsBtn = document.getElementById('settings-btn-small');
const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const discordRpcToggle = document.getElementById('discord-rpc-toggle');
const themeToggle = document.getElementById('theme-toggle');
const matugenToggle = document.getElementById('matugen-toggle');
const visualizerToggle = document.getElementById('visualizer-toggle');
const lrcToggle = document.getElementById('lrc-toggle');
const rpcRestartBtn = document.getElementById('rpc-restart-btn');
const systemInfoEl = document.getElementById('system-info');

const statsModal = document.getElementById('stats-modal');
const statsCloseBtn = document.getElementById('stats-close-btn');
const statsTotalTime = document.getElementById('stats-total-time-modal');
const statsList = document.getElementById('stats-list');

let discordRpcEnabled = true;
let currentTheme = 'dark';
let matugenEnabled = false;
let matugenColors = null;
let matugenWatcher = null;
let visualizerEnabled = true;
let lrcEnabled = true;

let currentCoverFile = null;
let systemName = 'Unknown System';

let audioCtx = null;
let analyser = null;
let dataArray = null;
let isVisualizerRunning = false;

if (!fs.existsSync(LYRICS_DIR)) fs.mkdirSync(LYRICS_DIR, { recursive: true });

let presenceStartTimestamp = null;
let lrcData = null;
let lastScrolledElement = null;
let lrcLines = [];
let lrcCache = new Map();

let lrcOffsets = {};
let currentLrcOffset = 0.25;
let offsetSaveTimeout = null;

function getSystemKey() {
    try {
        let machineId = '';
        try { machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch (e) {}
        if (!machineId) {
            const hostname = os.hostname();
            const username = os.userInfo().username;
            const net = os.networkInterfaces();
            let mac = '';
            for (const iface of Object.values(net)) {
                for (const addr of iface) {
                    if (addr.mac && addr.mac !== '00:00:00:00:00:00') { mac = addr.mac; break; }
                }
                if (mac) break;
            }
            const raw = `${hostname}:${username}:${mac}`;
            machineId = crypto.createHash('sha256').update(raw).digest('hex');
        }
        return crypto.createHash('sha256').update(machineId).digest();
    } catch (e) {
        const saltPath = path.join(CONFIG_DIR, '.salt');
        let salt;
        try { salt = fs.readFileSync(saltPath, 'utf8').trim(); } catch (e) {
            salt = crypto.randomBytes(32).toString('hex');
            fs.writeFileSync(saltPath, salt);
        }
        return crypto.createHash('sha256').update(salt).digest();
    }
}
const STATS_KEY = getSystemKey();

function signData(data) {
    const json = JSON.stringify(data);
    const hmac = crypto.createHmac('sha256', STATS_KEY);
    hmac.update(json);
    return hmac.digest('hex');
}

function loadStats() {
    try {
        if (!fs.existsSync(STATS_FILE)) return { totalListenSeconds: 0, trackTotalSeconds: {} };
        const raw = fs.readFileSync(STATS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.signature || !parsed.data) return { totalListenSeconds: 0, trackTotalSeconds: {} };
        const jsonData = JSON.stringify(parsed.data);
        const hmac = crypto.createHmac('sha256', STATS_KEY);
        hmac.update(jsonData);
        if (hmac.digest('hex') !== parsed.signature) {
            console.warn('Stats signature mismatch – resetting');
            return { totalListenSeconds: 0, trackTotalSeconds: {} };
        }
        return parsed.data;
    } catch (e) {
        return { totalListenSeconds: 0, trackTotalSeconds: {} };
    }
}

function saveStats(stats) {
    try {
        const data = {
            totalListenSeconds: stats.totalListenSeconds || 0,
            trackTotalSeconds: stats.trackTotalSeconds || {}
        };
        const jsonData = JSON.stringify(data);
        const hmac = crypto.createHmac('sha256', STATS_KEY);
        hmac.update(jsonData);
        const signature = hmac.digest('hex');
        fs.writeFileSync(STATS_FILE, JSON.stringify({ data, signature }, null, 2));
    } catch (e) { console.warn('Failed to save stats:', e); }
}

let stats = loadStats();

let currentTrackPath = null;
let currentTrackStartTime = 0;
let currentTrackAccumulated = 0;
let statsSaveTimer = null;

document.getElementById('stats-btn-small')?.addEventListener('click', openStatsModal);

function flushTrackStats(force = false) {
    if (!currentTrackPath || !isPlaying) return;
    const now = Date.now();
    const delta = (now - currentTrackStartTime) / 1000;
    if (delta > 0.5 || force) {
        currentTrackAccumulated += delta;
        stats.totalListenSeconds = (stats.totalListenSeconds || 0) + delta;
        if (!stats.trackTotalSeconds) stats.trackTotalSeconds = {};
        stats.trackTotalSeconds[currentTrackPath] = (stats.trackTotalSeconds[currentTrackPath] || 0) + delta;
        if (!statsSaveTimer) {
            statsSaveTimer = setTimeout(() => {
                saveStats(stats);
                statsSaveTimer = null;
                if (statsModal.classList.contains('show')) {
                    updateStatsModal();
                }
            }, 5000);
        }
        currentTrackStartTime = now;
        currentTrackAccumulated = 0;
    }
}

function resetTrackStats() {
    if (statsSaveTimer) { clearTimeout(statsSaveTimer); statsSaveTimer = null; }
    currentTrackPath = null;
    currentTrackStartTime = 0;
    currentTrackAccumulated = 0;
}

function updateStatsModal() {
    try {
        const totalSec = stats.totalListenSeconds || 0;
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        statsTotalTime.textContent = `${hours}h ${minutes}m`;

        statsList.innerHTML = '';
        const entries = Object.entries(stats.trackTotalSeconds || {});
        entries.sort((a, b) => b[1] - a[1]);

        if (entries.length === 0) {
            statsList.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No tracks played yet</div>';
            return;
        }

        entries.forEach(([path, seconds]) => {
            const track = tracks.find(t => t.path === path);
            const name = track ? track.name : path.split('/').pop();
            const artist = track && track.artist ? track.artist : '';
            const cover = track && track.cover ? track.cover : null;
            const duration = track ? track.duration : 0;
            const plays = duration > 0 ? Math.floor(seconds / duration) : 0;
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const timeStr = `${h}h ${m}m`;

            const div = document.createElement('div');
            div.className = 'stats-item';

            const coverDiv = document.createElement('div');
            coverDiv.className = 'stats-cover';
            if (cover) {
                const img = document.createElement('img');
                img.src = cover;
                img.alt = name;
                img.onerror = () => { coverDiv.innerHTML = '<i class="fas fa-music"></i>'; };
                coverDiv.appendChild(img);
            } else {
                coverDiv.innerHTML = '<i class="fas fa-music"></i>';
            }

            const infoDiv = document.createElement('div');
            infoDiv.className = 'stats-track-info';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'stats-track-name';
            nameSpan.textContent = name;
            nameSpan.title = name;
            const artistSpan = document.createElement('span');
            artistSpan.className = 'stats-track-artist';
            artistSpan.textContent = artist || 'Unknown';
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(artistSpan);

            const playsSpan = document.createElement('span');
            playsSpan.className = 'stats-plays';
            playsSpan.textContent = plays;

            const timeSpan = document.createElement('span');
            timeSpan.className = 'stats-time';
            timeSpan.textContent = timeStr;

            div.appendChild(coverDiv);
            div.appendChild(infoDiv);
            div.appendChild(playsSpan);
            div.appendChild(timeSpan);
            statsList.appendChild(div);
        });
    } catch (e) {
        console.error('Failed to update stats modal:', e);
        statsList.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Error loading stats</div>';
    }
}

function openStatsModal() {
    try {
        updateStatsModal();
    } catch (e) {
        console.error('Stats update error:', e);
    }
    statsModal.style.display = 'flex';
    setTimeout(() => {
        statsModal.classList.add('show');
    }, 10);
}

function closeStatsModal() {
    statsModal.classList.remove('show');
    setTimeout(() => {
        statsModal.style.display = 'none';
    }, 300);
}
statsCloseBtn.addEventListener('click', closeStatsModal);
statsModal.addEventListener('click', (e) => {
    if (e.target === statsModal) closeStatsModal();
});


function getOffsetForTrack(trackPath) {
    if (lrcOffsets[trackPath] !== undefined) return lrcOffsets[trackPath];
    return 0.25;
}

function saveOffsetForTrack(trackPath, offset) {
    lrcOffsets[trackPath] = offset;
    try { fs.writeFileSync(OFFSETS_FILE, JSON.stringify(lrcOffsets, null, 2)); } catch (e) {}
}

function updateLrcOffsetField() {
    if (!lrcOffsetContainer || !lrcOffsetInput) return;
    const isLRC = lyricsTextarea.dataset.isLRC === 'true' && lrcData && lrcData.length > 0;
    if (isLRC) {
        lrcOffsetContainer.style.visibility = 'visible';
        lrcOffsetContainer.style.opacity = '1';
        if (isLyricsEditing) {
            lrcOffsetInput.removeAttribute('readonly');
            lrcOffsetInput.style.opacity = '1';
            lrcOffsetInput.style.cursor = 'text';
        } else {
            lrcOffsetInput.setAttribute('readonly', true);
            lrcOffsetInput.style.opacity = '0.5';
            lrcOffsetInput.style.cursor = 'default';
        }
    } else {
        lrcOffsetContainer.style.visibility = 'hidden';
        lrcOffsetContainer.style.opacity = '0';
        lrcOffsetInput.setAttribute('readonly', true);
        lrcOffsetInput.style.opacity = '0.5';
    }
}

function updateLpcPlayButton() {
    if (!lpcPlayBtn) return;
    const icon = lpcPlayBtn.querySelector('i');
    icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
}

function syncLpcPanel() {
    if (!lpcProgress || !lpcCurrentTime || !lpcDuration) return;
    const p = (audio.currentTime / audio.duration) * 100 || 0;
    lpcProgress.value = p;
    lpcCurrentTime.textContent = formatTime(audio.currentTime);
    lpcDuration.textContent = formatTime(audio.duration);
    lpcVolume.value = audio.volume * 100;
    updateLpcPlayButton();
}

function getSystemInfo() {
    const platform = os.platform();
    if (platform === 'win32') return 'Windows ' + (os.release() || '');
    if (platform === 'darwin') return 'macOS ' + (os.release() || '');
    if (platform === 'linux') {
        try {
            const content = fs.readFileSync('/etc/os-release', 'utf8');
            const match = content.match(/^PRETTY_NAME=(.+)$/m);
            if (match) {
                let name = match[1].trim();
                if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
                    name = name.slice(1, -1);
                }
                return name;
            }
        } catch (e) {}
        return 'Linux';
    }
    return platform;
}

systemName = getSystemInfo();
if (systemInfoEl) systemInfoEl.textContent = systemName;

function updateDiscordPresence() {
    if (!discordRpcEnabled) { ipcRenderer.send('update-presence', null); return; }
    if (!isPlaying) { ipcRenderer.send('update-presence', null); return; }
    const track = tracks[currentTrackIndex];
    if (!track) return;
    const activity = {
        details: track.name,
        state: track.artist,
        type: 2,
        largeImageText: 'Kute Player on ' + systemName,
        startTimestamp: Math.floor(Date.now() / 1000 - audio.currentTime)
    };
    ipcRenderer.send('update-presence', activity);
}

function applyTheme(theme) {
    currentTheme = theme;
    const root = document.documentElement;
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
        root.style.setProperty('--bg-primary', '#f0f0f0');
        root.style.setProperty('--bg-secondary', '#ffffff');
        root.style.setProperty('--bg-header', '#e8e8e8');
        root.style.setProperty('--bg-player', 'rgba(245,245,245,0.95)');
        root.style.setProperty('--bg-library', 'rgba(240,240,240,0.95)');
        root.style.setProperty('--bg-status', '#e8e8e8');
        root.style.setProperty('--bg-track', 'rgba(0,0,0,0.02)');
        root.style.setProperty('--bg-track-hover', 'rgba(0,0,0,0.04)');
        root.style.setProperty('--bg-track-active', 'rgba(0,0,0,0.06)');
        root.style.setProperty('--bg-input', 'rgba(0,0,0,0.03)');
        root.style.setProperty('--bg-input-focus', 'rgba(0,0,0,0.05)');
        root.style.setProperty('--bg-slider', 'rgba(0,0,0,0.1)');
        root.style.setProperty('--bg-slider-thumb', '#222');
        root.style.setProperty('--bg-scrollbar', '#ccc');
        root.style.setProperty('--bg-scrollbar-hover', '#aaa');
        root.style.setProperty('--bg-modal', 'rgba(245,245,245,0.95)');
        root.style.setProperty('--bg-modal-overlay', 'rgba(0,0,0,0.2)');
        root.style.setProperty('--bg-switch-off', '#ccc');
        root.style.setProperty('--bg-switch-on', '#444');
        root.style.setProperty('--bg-btn', 'rgba(0,0,0,0.05)');
        root.style.setProperty('--bg-btn-hover', 'rgba(0,0,0,0.08)');
        root.style.setProperty('--border-color', 'rgba(0,0,0,0.08)');
        root.style.setProperty('--text-primary', '#222');
        root.style.setProperty('--text-secondary', '#555');
        root.style.setProperty('--text-muted', '#666');
        root.style.setProperty('--text-dim', '#999');
        root.style.setProperty('--text-light', '#444');
        root.style.setProperty('--text-on-switch', 'white');
        root.style.setProperty('--shadow', '0 6px 12px rgba(0,0,0,0.15)');
        root.style.setProperty('--notification-bg', '#e0e0e0');
        root.style.setProperty('--notification-text', '#222');
        root.style.setProperty('--notification-border', 'rgba(0,0,0,0.1)');
    } else {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
        root.style.setProperty('--bg-primary', '#0a0a0a');
        root.style.setProperty('--bg-secondary', '#0f0f0f');
        root.style.setProperty('--bg-header', '#0c0c0c');
        root.style.setProperty('--bg-player', 'rgba(15,15,15,0.9)');
        root.style.setProperty('--bg-library', 'rgba(10,10,10,0.9)');
        root.style.setProperty('--bg-status', '#0c0c0c');
        root.style.setProperty('--bg-track', 'rgba(255,255,255,0.02)');
        root.style.setProperty('--bg-track-hover', 'rgba(255,255,255,0.04)');
        root.style.setProperty('--bg-track-active', 'rgba(255,255,255,0.06)');
        root.style.setProperty('--bg-input', 'rgba(255,255,255,0.03)');
        root.style.setProperty('--bg-input-focus', 'rgba(255,255,255,0.05)');
        root.style.setProperty('--bg-slider', 'rgba(255,255,255,0.1)');
        root.style.setProperty('--bg-slider-thumb', '#c0c0c0');
        root.style.setProperty('--bg-scrollbar', '#5a5a5a');
        root.style.setProperty('--bg-scrollbar-hover', '#7a7a7a');
        root.style.setProperty('--bg-modal', 'rgba(20,20,20,0.95)');
        root.style.setProperty('--bg-modal-overlay', 'rgba(0,0,0,0.2)');
        root.style.setProperty('--bg-switch-off', '#555');
        root.style.setProperty('--bg-switch-on', 'white');
        root.style.setProperty('--bg-btn', 'rgba(255,255,255,0.03)');
        root.style.setProperty('--bg-btn-hover', 'rgba(255,255,255,0.06)');
        root.style.setProperty('--border-color', 'rgba(255,255,255,0.05)');
        root.style.setProperty('--text-primary', '#e0e0e0');
        root.style.setProperty('--text-secondary', '#b0b0b0');
        root.style.setProperty('--text-muted', '#8a8a8a');
        root.style.setProperty('--text-dim', '#777');
        root.style.setProperty('--text-light', '#ccc');
        root.style.setProperty('--text-on-switch', '#555');
        root.style.setProperty('--shadow', '0 6px 12px rgba(0,0,0,0.3)');
        root.style.setProperty('--notification-bg', '#2a2a2a');
        root.style.setProperty('--notification-text', '#e0e0e0');
        root.style.setProperty('--notification-border', 'rgba(255,255,255,0.1)');
    }
}

function loadMatugenColors() {
    try {
        if (fs.existsSync(MATUGEN_FILE)) {
            const data = JSON.parse(fs.readFileSync(MATUGEN_FILE, 'utf8'));
            matugenColors = data;
            return true;
        }
    } catch (e) {}
    return false;
}

function isLightColor(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128;
}

function applyMatugenTheme() {
    if (!matugenEnabled || !matugenColors) return;
    const root = document.documentElement;
    const c = matugenColors;
    const isLight = isLightColor(c.background || '#121212');
    document.body.classList.remove('light-theme', 'dark-theme');
    const background = c.background || (isLight ? '#f5f5f5' : '#121212');
    const surface = c.surface || (isLight ? '#ffffff' : '#1e1e1e');
    const onBackground = c.onBackground || (isLight ? '#222' : '#e0e0e0');
    const onSurface = c.onSurface || (isLight ? '#222' : '#e0e0e0');
    const primary = c.primary || (isLight ? '#6200ee' : '#bb86fc');
    const secondary = c.secondary || '#03dac6';
    const surfaceVariant = c.surfaceVariant || (isLight ? '#e0e0e0' : '#444444');
    const outline = c.outline || (isLight ? '#aaaaaa' : '#888888');

    root.style.setProperty('--bg-primary', background);
    root.style.setProperty('--bg-secondary', surface);
    root.style.setProperty('--bg-header', surface);
    root.style.setProperty('--bg-player', surface);
    root.style.setProperty('--bg-library', surface);
    root.style.setProperty('--bg-status', surface);
    root.style.setProperty('--bg-track', isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)');
    root.style.setProperty('--bg-track-hover', isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)');
    root.style.setProperty('--bg-track-active', isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)');
    root.style.setProperty('--bg-input', isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)');
    root.style.setProperty('--bg-input-focus', isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)');
    root.style.setProperty('--bg-slider', isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)');
    root.style.setProperty('--bg-slider-thumb', isLight ? '#222' : '#c0c0c0');
    root.style.setProperty('--bg-scrollbar', isLight ? '#ccc' : '#5a5a5a');
    root.style.setProperty('--bg-scrollbar-hover', isLight ? '#aaa' : '#7a7a7a');
    root.style.setProperty('--bg-modal', surface);
    root.style.setProperty('--bg-modal-overlay', 'rgba(0,0,0,0.2)');
    root.style.setProperty('--bg-switch-off', surfaceVariant);
    root.style.setProperty('--bg-switch-on', primary);
    root.style.setProperty('--bg-btn', isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.03)');
    root.style.setProperty('--bg-btn-hover', isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)');
    root.style.setProperty('--border-color', isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)');
    root.style.setProperty('--text-primary', onBackground);
    root.style.setProperty('--text-secondary', isLight ? '#555' : '#b0b0b0');
    root.style.setProperty('--text-muted', isLight ? '#666' : '#8a8a8a');
    root.style.setProperty('--text-dim', isLight ? '#999' : '#777');
    root.style.setProperty('--text-light', isLight ? '#444' : '#ccc');
    root.style.setProperty('--text-on-switch', isLight ? 'white' : '#555');
    root.style.setProperty('--shadow', isLight ? '0 6px 12px rgba(0,0,0,0.15)' : '0 6px 12px rgba(0,0,0,0.3)');
    root.style.setProperty('--notification-bg', isLight ? '#e0e0e0' : '#2a2a2a');
    root.style.setProperty('--notification-text', isLight ? '#222' : '#e0e0e0');
    root.style.setProperty('--notification-border', isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)');
}

function watchMatugenFile() {
    if (matugenWatcher) {
        matugenWatcher.close();
        matugenWatcher = null;
    }
    const dir = path.dirname(MATUGEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    matugenWatcher = fs.watch(MATUGEN_FILE, (eventType) => {
        if (eventType === 'change' && matugenEnabled) {
            const hasColors = loadMatugenColors();
            if (hasColors) {
                applyMatugenTheme();
            } else {
                matugenEnabled = false;
                matugenToggle.checked = false;
                themeToggle.disabled = false;
                themeToggle.parentElement.parentElement.style.opacity = '1';
                themeToggle.parentElement.parentElement.style.pointerEvents = 'auto';
                applyTheme(currentTheme);
                showNotification('Matugen config invalid, disabling');
                const settings = config.loadSettings();
                settings.matugenEnabled = false;
                config.saveSettings(settings.volume, settings.libraryPath, settings.repeatMode, settings.discordRpcEnabled, settings.theme, false, visualizerEnabled, lrcEnabled);
            }
        }
    });
    matugenWatcher.on('error', () => {});
}

function updateMatugenState() {
    if (matugenEnabled) {
        const hasColors = loadMatugenColors();
        if (hasColors) {
            applyMatugenTheme();
            themeToggle.disabled = true;
            themeToggle.parentElement.parentElement.style.opacity = '0.5';
            themeToggle.parentElement.parentElement.style.pointerEvents = 'none';
        } else {
            matugenEnabled = false;
            matugenToggle.checked = false;
            themeToggle.disabled = false;
            themeToggle.parentElement.parentElement.style.opacity = '1';
            themeToggle.parentElement.parentElement.style.pointerEvents = 'auto';
            applyTheme(currentTheme);
            showNotification('Matugen config not found, disabling');
            const settings = config.loadSettings();
            settings.matugenEnabled = false;
            config.saveSettings(settings.volume, settings.libraryPath, settings.repeatMode, settings.discordRpcEnabled, settings.theme, false, visualizerEnabled, lrcEnabled);
        }
    } else {
        themeToggle.disabled = false;
        themeToggle.parentElement.parentElement.style.opacity = '1';
        themeToggle.parentElement.parentElement.style.pointerEvents = 'auto';
        applyTheme(currentTheme);
    }
}

document.getElementById('maximize-btn').addEventListener('click', () => ipcRenderer.send('maximize-window'));
document.getElementById('close-btn').addEventListener('click', () => ipcRenderer.send('close-window'));

selectLibraryBtn.addEventListener('click', async () => {
    try {
        const folderPath = await ipcRenderer.invoke('select-folder');
        if (folderPath) {
            libraryFolder = path.resolve(folderPath);
            libraryPath.textContent = path.basename(libraryFolder);
            loadTracksFromFolder(libraryFolder);
            config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, matugenEnabled, visualizerEnabled, lrcEnabled);
        }
    } catch (error) {
        showNotification('Error loading library');
    }
});

let isLoading = false;
let loadAbortController = null;

async function loadTracksFromFolder(folderPath) {
    if (isLoading) {
        if (loadAbortController) loadAbortController.abort();
    }
    isLoading = true;
    loadAbortController = new AbortController();
    const signal = loadAbortController.signal;

    try {
        const files = await fs.promises.readdir(folderPath);
        const trackPromises = [];
        for (const file of files) {
            if (file.toLowerCase().endsWith('.mp3')) {
                trackPromises.push(parseTrackFile(folderPath, file, signal));
            }
        }
        const batchSize = 10;
        tracks = [];
        for (let i = 0; i < trackPromises.length; i += batchSize) {
            if (signal.aborted) break;
            const batch = trackPromises.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(batch);
            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value) tracks.push(result.value);
            });
        }
        if (signal.aborted) return;
        loadPlaylistOrder();
        updateTrackList();
        trackCount.textContent = `${tracks.length} tracks`;
        saveOriginalTracks();
        if (tracks.length > 0) loadTrack(0, false);
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('[DEBUG] loadTracksFromFolder error:', error);
            showNotification('Failed to load tracks');
        }
    } finally {
        isLoading = false;
        loadAbortController = null;
    }
}

async function parseTrackFile(folderPath, filename, signal) {
    const filePath = path.join(folderPath, filename);
    try {
        const metadata = await mm.parseFile(filePath);
        if (signal.aborted) return null;
        let coverData = null;
        if (metadata.common?.picture?.length) {
            const picture = metadata.common.picture[0];
            let mimeType = 'image/jpeg';
            if (picture.format) {
                if (picture.format.startsWith('image/')) mimeType = picture.format;
                else if (picture.format.includes('jpeg') || picture.format.includes('jpg')) mimeType = 'image/jpeg';
                else if (picture.format.includes('png')) mimeType = 'image/png';
            }
            try {
                const blob = new Blob([picture.data], { type: mimeType });
                coverData = URL.createObjectURL(blob);
            } catch (err) { }
        }
        return {
            name: metadata.common.title || path.basename(filename, '.mp3'),
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            path: filePath,
            cover: coverData,
            duration: metadata.format.duration || 0
        };
    } catch (err) {
        return {
            name: path.basename(filename, '.mp3'),
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            path: filePath,
            cover: null,
            duration: 0
        };
    }
}

function updateTrackList() { refreshTrackList(); }

function refreshTrackList() {
    if (tracks.length === 0) {
        trackList.innerHTML = `<div class="empty-state-small ${isPlaylistEditing ? 'editing' : ''}">
            <i class="fas fa-folder-open"></i><p>No music folder selected</p>
            <small>Click "Select" to choose your music library</small>
        </div>`;
        return;
    }
    const fragment = document.createDocumentFragment();
    tracks.forEach((track, index) => {
        const trackItem = document.createElement('div');
        trackItem.className = `track-item-small ${index === currentTrackIndex ? 'active' : ''}`;
        trackItem.dataset.index = index;
        trackItem.dataset.id = track.path;
        const coverDiv = document.createElement('div');
        coverDiv.className = 'track-cover-small';
        if (track.cover) {
            const img = document.createElement('img');
            img.src = track.cover;
            img.alt = track.name;
            img.onerror = () => {
                coverDiv.style.background = 'linear-gradient(135deg, #a78bfa 0%, #7c4dff 100%)';
                coverDiv.innerHTML = '<i class="fas fa-music"></i>';
            };
            coverDiv.appendChild(img);
        } else {
            const hash = track.name.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
            const hue = Math.abs(hash) % 360;
            coverDiv.style.background = `linear-gradient(135deg, hsl(${hue}, 75%, 60%), hsl(${hue + 40}, 75%, 40%))`;
            coverDiv.innerHTML = '<i class="fas fa-music"></i>';
        }
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'track-details-small';
        const nameDiv = document.createElement('div');
        nameDiv.className = 'track-name-small';
        nameDiv.textContent = track.name.length > 25 ? track.name.substring(0, 22) + '...' : track.name;
        const infoDiv = document.createElement('div');
        infoDiv.className = 'track-info-small-text';
        infoDiv.textContent = `${track.artist} • ${track.album || 'Unknown Album'}`;
        detailsDiv.appendChild(nameDiv);
        detailsDiv.appendChild(infoDiv);

        const vizCanvas = document.createElement('canvas');
        vizCanvas.className = 'visualizer-canvas';
        vizCanvas.width = 40;
        vizCanvas.height = 24;
        vizCanvas.style.width = '40px';
        vizCanvas.style.height = '24px';
        vizCanvas.style.marginLeft = 'auto';
        vizCanvas.dataset.trackIndex = index;

        trackItem.appendChild(coverDiv);
        trackItem.appendChild(detailsDiv);
        trackItem.appendChild(vizCanvas);
        fragment.appendChild(trackItem);
    });
    trackList.innerHTML = '';
    trackList.appendChild(fragment);
    if (scrollPosition > 0) {
        trackList.scrollTop = scrollPosition;
        scrollPosition = 0;
    }
    if (isPlaylistEditing) {
        setTimeout(() => setupDragAndDrop(), 20);
    }
    showVisualizerForCurrentTrack();
}

trackList.addEventListener('click', (e) => {
    const item = e.target.closest('.track-item-small');
    if (!item || isPlaylistEditing) return;
    const index = parseInt(item.dataset.index);
    loadTrack(index, true);
    if (!isPlaying) playTrack();
});

function showVisualizerForCurrentTrack() {
    const canvases = document.querySelectorAll('.visualizer-canvas');
    canvases.forEach((canvas) => {
        const idx = parseInt(canvas.dataset.trackIndex);
        if (idx === currentTrackIndex && isPlaying && visualizerEnabled) {
            canvas.classList.add('visible');
        } else {
            canvas.classList.remove('visible');
        }
    });
}

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        const source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
    }
}

function startVisualizer() {
    if (!visualizerEnabled) return;
    if (isVisualizerRunning) return;
    if (!audioCtx) initAudioContext();
    isVisualizerRunning = true;

    const canvas = document.querySelector(`.visualizer-canvas[data-track-index="${currentTrackIndex}"]`);
    if (!canvas) {
        isVisualizerRunning = false;
        return;
    }
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;
    const barWidth = 3;
    const gap = 1;
    const numBars = Math.floor(width / (barWidth + gap));
    const halfBars = Math.floor(numBars / 2);

    function draw() {
        if (!isVisualizerRunning || !isPlaying || !visualizerEnabled) {
            isVisualizerRunning = false;
            return;
        }
        analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, width, height);
        const step = Math.floor(dataArray.length / halfBars);
        const color = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#e0e0e0';
        for (let i = 0; i < halfBars; i++) {
            const value = dataArray[i * step] || 0;
            const percent = value / 255;
            const barHeight = Math.max(1, percent * centerY);
            const xLeft = (halfBars - 1 - i) * (barWidth + gap) + gap/2;
            const xRight = (halfBars + i) * (barWidth + gap) + gap/2;
            ctx.fillStyle = color;
            ctx.fillRect(xLeft, centerY - barHeight, barWidth, barHeight);
            ctx.fillRect(xLeft, centerY, barWidth, barHeight);
            ctx.fillRect(xRight, centerY - barHeight, barWidth, barHeight);
            ctx.fillRect(xRight, centerY, barWidth, barHeight);
        }
        requestAnimationFrame(draw);
    }
    draw();
}

function stopVisualizer() {
    isVisualizerRunning = false;
    const canvases = document.querySelectorAll('.visualizer-canvas');
    canvases.forEach(c => {
        c.classList.remove('visible');
        setTimeout(() => {
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, c.width, c.height);
        }, 300);
    });
}

function playTrack() {
    if (isVisualizerRunning) stopVisualizer();
    audio.play().then(() => {
        isPlaying = true;
        currentTrackStartTime = Date.now();
        updateDiscordPresence();
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'flex';
        isExternalControl = false;
        updatePlaybackState('playing');
        showVisualizerForCurrentTrack();
        if (!isVisualizerRunning && visualizerEnabled) {
            initAudioContext();
            startVisualizer();
        }
        updateLyrics();
        updateLpcPlayButton();
    }).catch(() => { showNotification('Playback failed'); });
}

function pauseTrack() {
    audio.pause();
    isPlaying = false;
    flushTrackStats(true);
    updateDiscordPresence();
    playBtn.style.display = 'flex';
    pauseBtn.style.display = 'none';
    isExternalControl = false;
    stopVisualizer();
    showVisualizerForCurrentTrack();
    updateLpcPlayButton();
}

function loadTrack(index, autoPlay = true) {
    if (!tracks[index]) return;
    if (currentTrackPath) flushTrackStats(true);
    currentTrackIndex = index;
    const track = tracks[index];
    currentLyricsTrack = track;
    currentTrackPath = track.path;
    currentTrackAccumulated = 0;
    if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
    audio.src = track.path;
    updateTrackInfo(index);
    updateAlbumArt(track.cover, track.name);
    updateActiveTrack(index);
    audio.addEventListener('loadedmetadata', () => {
        durationEl.textContent = formatTime(audio.duration);
        if (lyricsModal.style.display === 'flex') {
            lpcDuration.textContent = formatTime(audio.duration);
        }
    }, { once: true });
    if (autoPlay && isPlaying) {
        playTrack();
    } else {
        playBtn.style.display = 'flex';
        pauseBtn.style.display = 'none';
        stopVisualizer();
        showVisualizerForCurrentTrack();
    }
    updateMediaSession(track);
    updatePlaybackState(isPlaying ? 'playing' : 'paused');
    if (lyricsModal.style.display === 'flex') {
        lastScrolledElement = null;
        const offsetInput = document.getElementById('lrc-offset-input');
        if (offsetInput && currentLyricsTrack) {
            currentLrcOffset = getOffsetForTrack(currentLyricsTrack.path);
            offsetInput.value = currentLrcOffset;
        }
        openLyrics(track);
        syncLpcPanel();
    }
}

function updateTrackInfo(index) {
    const track = tracks[index];
    const truncate = (text, max) => text.length > max ? text.substring(0, max - 1) + '…' : text;
    trackTitle.textContent = truncate(track.name, 35);
    const artistDisplay = track.artist || 'Unknown Artist';
    const albumDisplay = track.album || 'Unknown Album';
    let info = artistDisplay + (albumDisplay ? ' • ' + albumDisplay : '');
    trackArtist.textContent = truncate(info, 45);
}

function updateAlbumArt(coverUrl, title) {
    const albumArt = document.getElementById('album-art-small');
    while (albumArt.firstChild) albumArt.firstChild.remove();
    if (coverUrl) {
        const img = document.createElement('img');
        img.src = coverUrl;
        img.alt = title;
        img.onload = () => { albumArt.style.background = 'none'; };
        img.onerror = () => showFallbackCover(albumArt, title);
        albumArt.appendChild(img);
    } else {
        showFallbackCover(albumArt, title);
    }
}

function showFallbackCover(element, title) {
    const hash = title.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
    const hue = Math.abs(hash) % 360;
    element.style.background = `linear-gradient(135deg, hsl(${hue}, 75%, 60%), hsl(${hue + 40}, 75%, 40%))`;
    const icon = document.createElement('i');
    icon.className = 'fas fa-music';
    element.appendChild(icon);
}

function updateActiveTrack(index) {
    document.querySelectorAll('.track-item-small').forEach((item, i) => item.classList.toggle('active', i === index));
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function nextTrack() {
    if (tracks.length === 0) return;
    let nextIndex = currentTrackIndex + 1;
    if (nextIndex >= tracks.length) {
        if (repeatMode === 'none') return;
        nextIndex = 0;
    }
    loadTrack(nextIndex, true);
    if (!isPlaying) playTrack();
}

function prevTrack() {
    if (tracks.length === 0) return;
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        if (isPlaying) playTrack();
        return;
    }
    let prevIndex = currentTrackIndex - 1;
    if (prevIndex < 0) {
        if (repeatMode === 'none') return;
        prevIndex = tracks.length - 1;
    }
    loadTrack(prevIndex, true);
    if (!isPlaying) playTrack();
}

function toggleRepeat() {
    const modes = ['none', 'all', 'one'];
    const idx = modes.indexOf(repeatMode);
    repeatMode = modes[(idx + 1) % modes.length];
    repeatBtn.classList.remove('repeat-one', 'repeat-all');
    if (repeatMode === 'one') {
        repeatBtn.classList.add('repeat-one');
        document.getElementById('repeat-status').textContent = 'repeat mode:  one';
    } else if (repeatMode === 'all') {
        repeatBtn.classList.add('repeat-all');
        document.getElementById('repeat-status').textContent = 'repeat mode:  all';
    } else {
        document.getElementById('repeat-status').textContent = 'repeat mode:  none';
    }
    config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, matugenEnabled, visualizerEnabled, lrcEnabled);
}

function showNotification(message, duration = 3000) {
    document.querySelectorAll('.temp-notification').forEach(n => n.remove());
    const notification = document.createElement('div');
    notification.className = 'temp-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.5s ease forwards';
        setTimeout(() => notification.remove(), 500);
    }, duration);
}

function showSaveNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'save-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2500);
}

function saveOriginalTracks() { originalTracks = [...tracks]; }
function filterTracks(searchText) {
    if (!searchText.trim()) tracks = [...originalTracks];
    else {
        const query = searchText.toLowerCase();
        tracks = originalTracks.filter(t => t.name.toLowerCase().includes(query) || t.artist.toLowerCase().includes(query) || t.album.toLowerCase().includes(query));
    }
    refreshTrackList();
}
searchInput.addEventListener('input', e => filterTracks(e.target.value));

function parseLRC(content) {
    const lines = content.split('\n');
    const parsed = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    for (const line of lines) {
        const match = line.match(timeRegex);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const millis = parseInt(match[3].padEnd(3, '0'));
            const time = minutes * 60 + seconds + millis / 1000;
            const text = line.replace(/\[.*?\]/, '').trim();
            if (text) parsed.push({ time, text });
        }
    }
    return parsed;
}

function renderLRC(linesArray) {
    lrcLines = [];
    lyricsDisplay.innerHTML = '';
    linesArray.forEach(item => {
        const span = document.createElement('span');
        span.textContent = item.text;
        span.className = 'lrc-line';
        span.dataset.time = item.time;
        lyricsDisplay.appendChild(span);
        lrcLines.push(span);
    });
}

function updateLyrics() {
    if (!lrcData || lyricsDisplay.style.display === 'none') return;
    if (!isPlaying) return;

    const currentTime = audio.currentTime;
    const offset = currentLyricsTrack ? getOffsetForTrack(currentLyricsTrack.path) : 0.25;
    const adjustedTime = currentTime + offset;
    let activeIndex = -1;
    for (let i = 0; i < lrcData.length; i++) {
        if (lrcData[i].time <= adjustedTime) activeIndex = i;
        else break;
    }

    lrcLines.forEach((line, idx) => {
        line.classList.toggle('active', idx === activeIndex);
    });

    if (activeIndex >= 0 && lrcLines[activeIndex]) {
        const targetElement = lrcLines[activeIndex];
        if (lastScrolledElement !== targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            lastScrolledElement = targetElement;
        }
    }
}

function stopLyricsUpdate() {
    lastScrolledElement = null;
    lrcLines.forEach(el => el.classList.remove('active'));
}

async function fetchLRCFromInternet(trackName, artistName) {
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        if (data.syncedLyrics) return data.syncedLyrics;
        return null;
    } catch {
        return null;
    }
}

async function openLyrics(track) {
    if (!track) return;
    currentLyricsTrack = track;
    lastScrolledElement = null;

    const lrcPath = path.join(LYRICS_DIR, `${track.name}.lrc`);
    const txtPath = path.join(LYRICS_DIR, `${track.name}.txt`);

    let content = '';
    let isLRC = false;

    if (lrcEnabled) {
        if (fs.existsSync(lrcPath)) {
            content = fs.readFileSync(lrcPath, 'utf-8');
            isLRC = true;
        }
    }
    if (!isLRC && fs.existsSync(txtPath)) {
        content = fs.readFileSync(txtPath, 'utf-8');
        isLRC = false;
    }

    lyricsTextarea.value = content;
    lyricsTextarea.dataset.isLRC = isLRC ? 'true' : 'false';
    lyricsFetchBtn.style.display = lrcEnabled ? 'flex' : 'none';

    if (isLRC) {
        currentLrcOffset = getOffsetForTrack(track.path);
        lrcOffsetInput.value = currentLrcOffset;
    }

    if (isLRC && content.trim()) {
        if (lrcCache.has(track.path)) {
            lrcData = lrcCache.get(track.path);
        } else {
            lrcData = parseLRC(content);
            lrcCache.set(track.path, lrcData);
        }
        renderLRC(lrcData);
        lyricsDisplay.style.display = 'block';
        lyricsTextarea.style.display = 'none';
        updateLyrics();
    } else {
        lrcData = null;
        lyricsDisplay.style.display = 'none';
        lyricsTextarea.style.display = 'block';
        stopLyricsUpdate();
    }

    isLyricsEditing = false;
    lyricsTextarea.readOnly = true;
    lyricsTextarea.style.cursor = 'default';
    lyricsSaveBtn.innerHTML = '<i class="fas fa-edit"></i>';

    updateLrcOffsetField();

    lyricsModal.style.display = 'flex';
    setTimeout(() => lyricsModal.classList.add('show'), 10);
    syncLpcPanel();
}

function closeLyrics() {
    if (offsetSaveTimeout) {
        clearTimeout(offsetSaveTimeout);
        offsetSaveTimeout = null;
    }
    if (isLyricsEditing) {
        isLyricsEditing = false;
        lyricsTextarea.readOnly = true;
        lyricsTextarea.style.cursor = 'default';
        lyricsSaveBtn.innerHTML = '<i class="fas fa-edit"></i>';
        const track = currentLyricsTrack;
        if (track) {
            const lrcPath = path.join(LYRICS_DIR, `${track.name}.lrc`);
            const txtPath = path.join(LYRICS_DIR, `${track.name}.txt`);
            if (lrcEnabled && fs.existsSync(lrcPath)) {
                lyricsTextarea.value = fs.readFileSync(lrcPath, 'utf-8');
            } else if (fs.existsSync(txtPath)) {
                lyricsTextarea.value = fs.readFileSync(txtPath, 'utf-8');
            }
        }
    }
    lyricsModal.classList.remove('show');
    stopLyricsUpdate();
    setTimeout(() => {
        lyricsModal.style.display = 'none';
        lyricsDisplay.innerHTML = '';
        lrcData = null;
        lrcLines = [];
        lastScrolledElement = null;
        if (lrcOffsetContainer) {
            lrcOffsetContainer.style.visibility = 'hidden';
            lrcOffsetContainer.style.opacity = '0';
        }
    }, 300);
}

lyricsBtn.addEventListener('click', () => {
    if (tracks[currentTrackIndex]) openLyrics(tracks[currentTrackIndex]);
    else showNotification('No track loaded');
});

lyricsFetchBtn.addEventListener('click', async () => {
    if (!lrcEnabled) { showNotification('LRC support is disabled in settings'); return; }
    if (!currentLyricsTrack) { showNotification('No track loaded'); return; }
    const track = currentLyricsTrack;
    const lrc = await fetchLRCFromInternet(track.name, track.artist);
    if (lrc) {
        const lrcPath = path.join(LYRICS_DIR, `${track.name}.lrc`);
        try {
            fs.writeFileSync(lrcPath, lrc, 'utf-8');
            lrcCache.delete(track.path);
            openLyrics(track);
            showNotification('Synced lyrics downloaded and saved');
        } catch (err) { showNotification('Error saving lyrics file'); }
    } else {
        showNotification('No synced lyrics found for this track');
    }
});

lyricsLoadBtn.addEventListener('click', async () => {
    if (!currentLyricsTrack) return;
    const result = await ipcRenderer.invoke('select-file', {
        title: 'Select lyrics file',
        filters: [{ name: 'Text Files', extensions: ['txt', 'lrc'] }, { name: 'All Files', extensions: ['*'] }],
        properties: ['openFile']
    });
    if (result.filePaths && result.filePaths[0]) {
        try {
            const content = fs.readFileSync(result.filePaths[0], 'utf-8');
            const ext = path.extname(result.filePaths[0]).toLowerCase();
            const isLRC = ext === '.lrc';
            const savePath = path.join(LYRICS_DIR, `${currentLyricsTrack.name}${ext}`);
            fs.writeFileSync(savePath, content, 'utf-8');
            lrcCache.delete(currentLyricsTrack.path);
            openLyrics(currentLyricsTrack);
            showNotification('Lyrics loaded and saved');
        } catch (e) { showNotification('Error loading file'); }
    }
});

lyricsSaveBtn.addEventListener('click', () => {
    if (!currentLyricsTrack) return;
    if (isLyricsEditing) {
        const newContent = lyricsTextarea.value;
        const isLRC = lyricsTextarea.dataset.isLRC === 'true';
        const ext = isLRC ? '.lrc' : '.txt';
        const filePath = path.join(LYRICS_DIR, `${currentLyricsTrack.name}${ext}`);
        try {
            fs.writeFileSync(filePath, newContent, 'utf-8');
            lrcCache.delete(currentLyricsTrack.path);
            showNotification('Lyrics saved');
            isLyricsEditing = false;
            lyricsTextarea.readOnly = true;
            lyricsTextarea.style.cursor = 'default';
            lyricsSaveBtn.innerHTML = '<i class="fas fa-edit"></i>';
            updateLrcOffsetField();
            openLyrics(currentLyricsTrack);
        } catch (err) { showNotification('Error saving lyrics'); }
    } else {
        isLyricsEditing = true;
        lyricsTextarea.readOnly = false;
        lyricsTextarea.style.cursor = 'text';
        lyricsTextarea.focus();
        if (lyricsDisplay.style.display === 'block') {
            lyricsDisplay.style.display = 'none';
            lyricsTextarea.style.display = 'block';
            stopLyricsUpdate();
        }
        lyricsSaveBtn.innerHTML = '<i class="fas fa-save"></i>';
        updateLrcOffsetField();
        showNotification('Edit mode enabled', 2000);
    }
});

lyricsCloseBtn.addEventListener('click', closeLyrics);
lyricsModal.addEventListener('click', (e) => {
    if (e.target === lyricsModal) closeLyrics();
});

lrcOffsetInput.addEventListener('input', (e) => {
    if (!currentLyricsTrack) return;
    clearTimeout(offsetSaveTimeout);
    offsetSaveTimeout = setTimeout(() => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
            currentLrcOffset = val;
            saveOffsetForTrack(currentLyricsTrack.path, val);
            if (isPlaying && lrcData) updateLyrics();
        } else {
            e.target.value = currentLrcOffset;
        }
    }, 300);
});

lrcOffsetInput.addEventListener('change', (e) => {
    if (!currentLyricsTrack) return;
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
        currentLrcOffset = val;
        saveOffsetForTrack(currentLyricsTrack.path, val);
        if (isPlaying && lrcData) updateLyrics();
    } else {
        e.target.value = currentLrcOffset;
    }
});

lpcPlayBtn.addEventListener('click', () => {
    if (isPlaying) pauseTrack();
    else playTrack();
    updateLpcPlayButton();
});

lpcProgress.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(audio.duration)) {
        audio.currentTime = (val / 100) * audio.duration;
        lpcCurrentTime.textContent = formatTime(audio.currentTime);
    }
});

lpcVolume.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    audio.volume = val / 100;
    volumeSlider.value = val;
    config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, matugenEnabled, visualizerEnabled, lrcEnabled);
});

try {
    if (fs.existsSync(OFFSETS_FILE)) lrcOffsets = JSON.parse(fs.readFileSync(OFFSETS_FILE, 'utf-8'));
} catch (e) { lrcOffsets = {}; }

function initPlaylistEditing() {
    editPlaylistBtn.addEventListener('click', togglePlaylistEditMode);
}

function togglePlaylistEditMode() {
    if (!tracks.length) { showNotification('No tracks to edit'); return; }
    isPlaylistEditing = !isPlaylistEditing;
    if (isPlaylistEditing) enterEditMode();
    else exitEditMode();
}

function enterEditMode() {
    editPlaylistBtn.classList.add('active');
    editPlaylistBtn.innerHTML = '<i class="fas fa-save"></i> <span class="btn-text">Save</span>';
    document.querySelector('.search-wrapper').classList.add('editing');
    tracks = [...originalTracks];
    refreshTrackList();
    showNotification('Edit mode: Drag tracks to reorder', 2000);
}

function exitEditMode() {
    editPlaylistBtn.classList.remove('active');
    editPlaylistBtn.innerHTML = '<i class="fas fa-edit"></i> <span class="btn-text">Edit</span>';
    document.querySelector('.search-wrapper').classList.remove('editing');
    const items = document.querySelectorAll('.track-item-small');
    items.forEach(item => {
        item.classList.remove('editable');
        item.removeAttribute('draggable');
        item.style.transition = 'all 0.2s ease';
    });
    savePlaylistOrder();
    originalTracks = [...tracks];
    setTimeout(() => {
        refreshTrackList();
        showSaveNotification('Playlist order saved!');
    }, 200);
}

function setupDragAndDrop() {
    const items = document.querySelectorAll('.track-item-small');
    items.forEach(item => {
        item.classList.add('editable');
        item.setAttribute('draggable', 'true');
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragleave', handleDragLeave);
    });
    trackList.addEventListener('dragover', handleContainerDragOver);
    trackList.addEventListener('drop', handleContainerDrop);
    trackList.addEventListener('dragleave', handleContainerDragLeave);
    if (dropIndicator) dropIndicator.remove();
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
    trackList.appendChild(dropIndicator);
}

function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.index);
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!draggedItem || this === draggedItem) return;
    document.querySelectorAll('.track-item-small').forEach(i => i.classList.remove('drop-zone-above', 'drop-zone-below'));
    const rect = this.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < rect.height / 2) {
        this.classList.add('drop-zone-above');
        insertAfterIndex = parseInt(this.dataset.index) - 1;
    } else {
        this.classList.add('drop-zone-below');
        insertAfterIndex = parseInt(this.dataset.index);
    }
}
function handleDrop(e) {
    e.preventDefault();
    if (!draggedItem || this === draggedItem) return;
    const fromIndex = parseInt(draggedItem.dataset.index);
    let toIndex = parseInt(this.dataset.index);
    const rect = this.getBoundingClientRect();
    if (e.clientY - rect.top >= rect.height / 2) toIndex++;
    if (fromIndex < toIndex) toIndex--;
    if (fromIndex === toIndex) { resetDragState(); return; }
    const [moved] = tracks.splice(fromIndex, 1);
    tracks.splice(toIndex, 0, moved);
    updateCurrentTrackIndex(fromIndex, toIndex);
    refreshTrackList();
    resetDragState();
}
function handleDragEnd(e) { resetDragState(); }
function handleDragLeave(e) { this.classList.remove('drop-zone-above', 'drop-zone-below'); }

function handleContainerDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!draggedItem) return;
    const containerRect = trackList.getBoundingClientRect();
    const y = e.clientY - containerRect.top;
    const trackItems = document.querySelectorAll('.track-item-small');
    if (trackItems.length === 0) {
        showDropIndicatorAtPosition(0);
        insertAfterIndex = -1;
        return;
    }
    let targetIndex = -1;
    let position = 'below';
    for (let i = 0; i < trackItems.length; i++) {
        const item = trackItems[i];
        const rect = item.getBoundingClientRect();
        const itemTop = rect.top - containerRect.top;
        const itemBottom = itemTop + rect.height;
        if (y >= itemTop && y <= itemBottom) {
            if (y - itemTop < rect.height / 2) {
                targetIndex = i;
                position = 'above';
            } else {
                targetIndex = i;
                position = 'below';
            }
            break;
        }
        if (i < trackItems.length - 1) {
            const nextItem = trackItems[i + 1];
            const nextTop = nextItem.getBoundingClientRect().top - containerRect.top;
            if (y > itemBottom && y < nextTop) {
                targetIndex = i;
                position = 'below';
                break;
            }
        }
    }
    if (targetIndex === -1 && y > trackItems[trackItems.length - 1].getBoundingClientRect().bottom - containerRect.top) {
        targetIndex = trackItems.length - 1;
        position = 'below';
    }
    if (targetIndex === -1 && y < trackItems[0].getBoundingClientRect().top - containerRect.top) {
        targetIndex = -1;
        position = 'above';
    }
    if (targetIndex === -1) {
        showDropIndicatorAtPosition(0);
        insertAfterIndex = -1;
    } else if (position === 'above') {
        showDropIndicatorAtPosition(targetIndex);
        insertAfterIndex = targetIndex - 1;
    } else {
        showDropIndicatorAtPosition(targetIndex + 1);
        insertAfterIndex = targetIndex;
    }
}
function handleContainerDrop(e) {
    e.preventDefault();
    if (!draggedItem) return;
    const fromIndex = parseInt(draggedItem.dataset.index);
    let insertIndex = insertAfterIndex === -1 ? 0 : insertAfterIndex + 1;
    if (fromIndex < insertIndex) insertIndex--;
    if (fromIndex !== insertIndex) {
        const [moved] = tracks.splice(fromIndex, 1);
        tracks.splice(insertIndex, 0, moved);
        updateCurrentTrackIndex(fromIndex, insertIndex);
        refreshTrackList();
    }
    resetDragState();
}
function handleContainerDragLeave(e) {
    if (!trackList.contains(e.relatedTarget)) {
        hideDropIndicator();
        insertAfterIndex = -1;
    }
}
function showDropIndicatorAtPosition(position) {
    if (!dropIndicator) return;
    const trackItems = document.querySelectorAll('.track-item-small');
    let top = 0;
    if (position === 0) top = 0;
    else if (position >= trackItems.length) {
        if (trackItems.length > 0) {
            const last = trackItems[trackItems.length - 1];
            top = last.offsetTop + last.offsetHeight;
        } else top = 0;
    } else {
        const prev = trackItems[position - 1];
        top = prev.offsetTop + prev.offsetHeight;
    }
    dropIndicator.style.top = `${top}px`;
    dropIndicator.classList.add('visible');
}
function hideDropIndicator() {
    if (dropIndicator) dropIndicator.classList.remove('visible');
}

function updateCurrentTrackIndex(from, to) {
    if (currentTrackIndex === from) currentTrackIndex = to;
    else if (currentTrackIndex > from && currentTrackIndex <= to) currentTrackIndex--;
    else if (currentTrackIndex < from && currentTrackIndex >= to) currentTrackIndex++;
}

function resetDragState() {
    document.querySelectorAll('.track-item-small').forEach(i => i.classList.remove('dragging', 'drop-zone-above', 'drop-zone-below'));
    hideDropIndicator();
    draggedItem = null;
    insertAfterIndex = -1;
}

function savePlaylistOrder() {
    try {
        const order = tracks.map(t => t.path);
        fs.writeFileSync(PLAYLIST_ORDER_FILE, JSON.stringify({ playlistOrder: order, lastModified: new Date().toISOString(), libraryPath: libraryFolder, trackCount: tracks.length }, null, 2));
    } catch (e) {}
}
function loadPlaylistOrder() {
    try {
        if (fs.existsSync(PLAYLIST_ORDER_FILE)) {
            const data = JSON.parse(fs.readFileSync(PLAYLIST_ORDER_FILE, 'utf-8'));
            if (data.playlistOrder?.length && data.libraryPath === libraryFolder) {
                const map = new Map(tracks.map(t => [t.path, t]));
                const sorted = [], rest = [];
                data.playlistOrder.forEach(p => { if (map.has(p)) { sorted.push(map.get(p)); map.delete(p); } });
                tracks.forEach(t => { if (map.has(t.path)) rest.push(t); });
                tracks = [...sorted, ...rest];
            }
        }
    } catch (e) {}
}

function openShortcuts() {
    shortcutsModal.style.display = 'flex';
    setTimeout(() => shortcutsModal.classList.add('show'), 10);
}
function closeShortcuts() {
    shortcutsModal.classList.remove('show');
    setTimeout(() => { shortcutsModal.style.display = 'none'; }, 300);
}
shortcutsBtn.addEventListener('click', openShortcuts);
shortcutsCloseBtn.addEventListener('click', closeShortcuts);
shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) closeShortcuts();
});

function openSettingsModal() {
    settingsModal.style.display = 'flex';
    setTimeout(() => settingsModal.classList.add('show'), 10);
}
function closeSettingsModal() {
    settingsModal.classList.remove('show');
    setTimeout(() => { settingsModal.style.display = 'none'; }, 300);
}
settingsBtn.addEventListener('click', openSettingsModal);
settingsCloseBtn.addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
});

document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const pageId = tab.dataset.tab;
        const pagesWrapper = document.querySelector('.settings-pages');
        if (pageId === 'general') {
            pagesWrapper.classList.remove('shifted');
            pagesWrapper.style.transform = 'translateX(0%)';
        } else if (pageId === 'visualizer') {
            pagesWrapper.classList.add('shifted');
            pagesWrapper.style.transform = 'translateX(-50%)';
        }
    });
});

discordRpcToggle.addEventListener('change', (e) => {
    discordRpcEnabled = e.target.checked;
    config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, matugenEnabled, visualizerEnabled, lrcEnabled);
    if (!discordRpcEnabled) ipcRenderer.send('update-presence', null);
    else if (isPlaying && tracks[currentTrackIndex]) updateDiscordPresence();
});

rpcRestartBtn.addEventListener('click', () => {
    ipcRenderer.send('rpc-reconnect');
    showNotification('RPC reconnecting...');
});

ipcRenderer.on('rpc-reconnected', () => {
    updateDiscordPresence();
    if (!audio.paused && tracks.length > 0) {
        audio.pause();
        audio.play();
    }
});

themeToggle.addEventListener('change', (e) => {
    if (matugenEnabled) return;
    const newTheme = e.target.checked ? 'light' : 'dark';
    applyTheme(newTheme);
    config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, newTheme, matugenEnabled, visualizerEnabled, lrcEnabled);
});

matugenToggle.addEventListener('change', (e) => {
    if (os.platform() === 'win32') {
        showNotification('Matugen is not supported on Windows');
        e.target.checked = false;
        return;
    }
    matugenEnabled = e.target.checked;
    if (matugenEnabled) {
        const hasColors = loadMatugenColors();
        if (!hasColors) {
            showNotification('Matugen config not found, disabling');
            matugenEnabled = false;
            matugenToggle.checked = false;
            themeToggle.disabled = false;
            themeToggle.parentElement.parentElement.style.opacity = '1';
            themeToggle.parentElement.parentElement.style.pointerEvents = 'auto';
            config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, false, visualizerEnabled, lrcEnabled);
            return;
        }
        applyMatugenTheme();
        themeToggle.disabled = true;
        themeToggle.parentElement.parentElement.style.opacity = '0.5';
        themeToggle.parentElement.parentElement.style.pointerEvents = 'none';
        config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, true, visualizerEnabled, lrcEnabled);
    } else {
        themeToggle.disabled = false;
        themeToggle.parentElement.parentElement.style.opacity = '1';
        themeToggle.parentElement.parentElement.style.pointerEvents = 'auto';
        applyTheme(currentTheme);
        config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, false, visualizerEnabled, lrcEnabled);
    }
});

visualizerToggle.addEventListener('change', (e) => {
    visualizerEnabled = e.target.checked;
    config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, matugenEnabled, visualizerEnabled, lrcEnabled);
    if (!visualizerEnabled) {
        stopVisualizer();
        document.querySelectorAll('.visualizer-canvas').forEach(c => c.classList.remove('visible'));
    } else {
        if (isPlaying) {
            showVisualizerForCurrentTrack();
            if (!isVisualizerRunning) {
                initAudioContext();
                startVisualizer();
            }
        }
    }
});

lrcToggle.addEventListener('change', (e) => {
    lrcEnabled = e.target.checked;
    config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, matugenEnabled, visualizerEnabled, lrcEnabled);
    if (lyricsModal.style.display === 'flex' && currentLyricsTrack) openLyrics(currentLyricsTrack);
});

document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.code === 'KeyW') { e.preventDefault(); return; }
    if (e.ctrlKey && e.code === 'KeyQ') { e.preventDefault(); return; }

    const isLyricsOpen = lyricsModal.style.display === 'flex';
    const isMetadataOpen = metadataModal.classList.contains('show');
    const isShortcutsOpen = shortcutsModal.classList.contains('show');
    const isSettingsOpen = settingsModal.classList.contains('show');
    const isStatsOpen = statsModal.classList.contains('show');

    if (e.key === 'Escape') {
        if (document.activeElement === document.getElementById('track-search')) {
            document.getElementById('track-search').value = '';
            document.getElementById('track-search').blur();
            filterTracks('');
            e.preventDefault();
            return;
        }
        if (isSettingsOpen) closeSettingsModal();
        else if (isShortcutsOpen) closeShortcuts();
        else if (isLyricsOpen) closeLyrics();
        else if (isMetadataOpen) closeMetadataModal();
        else if (isStatsOpen) closeStatsModal();
        return;
    }

    if (e.ctrlKey && e.code === 'KeyF' && !isSettingsOpen && !isShortcutsOpen && !isLyricsOpen && !isMetadataOpen && !isStatsOpen) {
        e.preventDefault();
        const searchInput = document.getElementById('track-search');
        if (searchInput) { searchInput.focus(); searchInput.select(); }
        return;
    }

    if (e.ctrlKey && e.code === 'KeyS') {
        if (isMetadataOpen) { e.preventDefault(); metadataSaveBtn.click(); return; }
        if (isLyricsOpen) { e.preventDefault(); lyricsSaveBtn.click(); return; }
    }

    if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!isNaN(audio.duration)) {
            audio.currentTime = Math.max(0, audio.currentTime - 5);
            showNotification(`-5 sec`, 800);
        }
        return;
    }
    if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault();
        if (!isNaN(audio.duration)) {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
            showNotification(`+5 sec`, 800);
        }
        return;
    }

    if (e.key === 'ArrowUp' && !isSettingsOpen && !isShortcutsOpen && !isLyricsOpen && !isMetadataOpen && !isStatsOpen) {
        e.preventDefault(); prevTrack(); return;
    }
    if (e.key === 'ArrowDown' && !isSettingsOpen && !isShortcutsOpen && !isLyricsOpen && !isMetadataOpen && !isStatsOpen) {
        e.preventDefault(); nextTrack(); return;
    }

    if (e.key === 'ArrowRight' && !isSettingsOpen && !isShortcutsOpen && !isLyricsOpen && !isMetadataOpen && !isStatsOpen) {
        e.preventDefault();
        let newVol = Math.min(100, audio.volume * 100 + 5);
        audio.volume = newVol / 100;
        volumeSlider.value = newVol;
        config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, matugenEnabled, visualizerEnabled, lrcEnabled);
        showNotification(`Volume: ${Math.round(newVol)}%`, 800);
        return;
    }
    if (e.key === 'ArrowLeft' && !isSettingsOpen && !isShortcutsOpen && !isLyricsOpen && !isMetadataOpen && !isStatsOpen) {
        e.preventDefault();
        let newVol = Math.max(0, audio.volume * 100 - 5);
        audio.volume = newVol / 100;
        volumeSlider.value = newVol;
        config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, matugenEnabled, visualizerEnabled, lrcEnabled);
        showNotification(`Volume: ${Math.round(newVol)}%`, 800);
        return;
    }

    if (e.ctrlKey && e.shiftKey && e.code === 'KeyE') {
        e.preventDefault();
        if (tracks.length) togglePlaylistEditMode();
        return;
    }

    if (e.ctrlKey && e.code === 'Slash') {
        e.preventDefault();
        if (isShortcutsOpen) closeShortcuts();
        else if (!isSettingsOpen && !isLyricsOpen && !isMetadataOpen) openShortcuts();
        return;
    }

    if (e.ctrlKey && e.code === 'KeyY') {
        e.preventDefault();
        if (isStatsOpen) closeStatsModal();
        else if (!isShortcutsOpen && !isLyricsOpen && !isMetadataOpen && !isStatsOpen) openStatsModal();
        return;
    }

    if (e.ctrlKey && e.code === 'KeyE') {
        e.preventDefault();
        if (isSettingsOpen) closeSettingsModal();
        else if (!isShortcutsOpen && !isLyricsOpen && !isMetadataOpen && !isStatsOpen) openSettingsModal();
        return;
    }

    if (e.ctrlKey && e.code === 'KeyX') {
        e.preventDefault();
        if (isMetadataOpen) closeMetadataModal();
        else if (!isSettingsOpen && !isShortcutsOpen && !isStatsOpen && !isLyricsOpen && tracks[currentTrackIndex]) openMetadataModal();
        return;
    }

    if (e.ctrlKey && e.code === 'KeyD') {
        e.preventDefault();
        if (isLyricsOpen) closeLyrics();
        else if (!isSettingsOpen && !isShortcutsOpen && !isStatsOpen && !isMetadataOpen && tracks[currentTrackIndex]) openLyrics(tracks[currentTrackIndex]);
        return;
    }

    if (e.ctrlKey && e.code === 'KeyT') {
        e.preventDefault();
        const lib = document.querySelector('.library-section');
        if (lib) lib.classList.toggle('collapsed');
        return;
    }

    if (e.ctrlKey && e.code === 'KeyO') {
        e.preventDefault();
        if (!isSettingsOpen && !isShortcutsOpen && !isLyricsOpen && !isMetadataOpen && !isStatsOpen) selectLibraryBtn.click();
        return;
    }

    if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        isPlaying ? pauseTrack() : playTrack();
    }
});

playBtn.addEventListener('click', playTrack);
pauseBtn.addEventListener('click', pauseTrack);
nextBtn.addEventListener('click', nextTrack);
prevBtn.addEventListener('click', prevTrack);
repeatBtn.addEventListener('click', toggleRepeat);

audio.addEventListener('play', () => {
    if (!isExternalControl) {
        isPlaying = true;
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'flex';
        updateLpcPlayButton();
        currentTrackStartTime = Date.now();
    }
});
audio.addEventListener('pause', () => {
    if (!isExternalControl) {
        isPlaying = false;
        flushTrackStats(true);
        playBtn.style.display = 'flex';
        pauseBtn.style.display = 'none';
        updateLpcPlayButton();
    }
});
audio.addEventListener('ended', () => {
    flushTrackStats(true);
    if (repeatMode === 'one') { audio.currentTime = 0; playTrack(); }
    else if (repeatMode === 'all') nextTrack();
    else { isPlaying = false; playBtn.style.display = 'flex'; pauseBtn.style.display = 'none'; }
});

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => { isExternalControl = true; playTrack(); });
    navigator.mediaSession.setActionHandler('pause', () => { isExternalControl = true; pauseTrack(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { isExternalControl = true; prevTrack(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { isExternalControl = true; nextTrack(); });
}

audio.addEventListener('timeupdate', () => {
    const p = (audio.currentTime / audio.duration) * 100 || 0;
    progressSlider.value = p;
    currentTimeEl.textContent = formatTime(audio.currentTime);
    updateLyrics();
    if (lyricsModal.style.display === 'flex') {
        lpcProgress.value = p;
        lpcCurrentTime.textContent = formatTime(audio.currentTime);
        lpcDuration.textContent = formatTime(audio.duration);
    }
    if (isPlaying && currentTrackPath) {
        flushTrackStats(false);
    }
});

progressSlider.addEventListener('input', e => {
    audio.currentTime = (e.target.value / 100) * audio.duration;
    if (isPlaying) updateDiscordPresence();
});
volumeSlider.addEventListener('input', e => { audio.volume = e.target.value / 100; config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme, matugenEnabled, visualizerEnabled, lrcEnabled); });

function updateSizes() {
    const w = window.innerWidth;
    const art = document.getElementById('album-art-small');
    let size, fontSize;
    if (w > 550) { size = 180; fontSize = 44; }
    else { size = 140; fontSize = 36; }
    art.style.width = `${size}px`;
    art.style.height = `${size}px`;
    art.style.fontSize = `${fontSize}px`;
}

function openMetadataModal() {
    if (!tracks[currentTrackIndex]) { showNotification('No track selected'); return; }
    const track = tracks[currentTrackIndex];
    metadataTitle.value = track.name;
    metadataArtist.value = track.artist;
    metadataAlbum.value = track.album || '';
    updateCoverPreview(track.cover);
    currentCoverFile = null;
    metadataModal.style.display = 'block';
    setTimeout(() => metadataModal.classList.add('show'), 10);
}
function updateCoverPreview(coverUrl) {
    while (metadataCoverPreview.firstChild) metadataCoverPreview.firstChild.remove();
    if (coverUrl) {
        const img = document.createElement('img');
        img.src = coverUrl;
        img.alt = 'Cover';
        metadataCoverPreview.appendChild(img);
    } else {
        const icon = document.createElement('i');
        icon.className = 'fas fa-music';
        metadataCoverPreview.appendChild(icon);
    }
}
function closeMetadataModal() {
    metadataModal.classList.remove('show');
    metadataModal.classList.add('closing');
    setTimeout(() => { metadataModal.style.display = 'none'; metadataModal.classList.remove('closing'); }, 300);
}
function handleCoverInput(e) {
    const file = e.target.files[0];
    if (file) {
        currentCoverFile = file;
        updateCoverPreview(URL.createObjectURL(file));
        showNotification('Cover selected');
    }
}
async function saveMetadata() {
    if (!tracks[currentTrackIndex]) return;
    const track = tracks[currentTrackIndex];
    const newTitle = metadataTitle.value.trim();
    const newArtist = metadataArtist.value.trim();
    const newAlbum = metadataAlbum.value.trim();
    if (!newTitle) { showNotification('Title cannot be empty'); return; }
    try {
        const NodeID3 = require('node-id3');
        const existingTags = NodeID3.read(track.path) || {};
        const tags = {
            title: newTitle,
            artist: newArtist,
            album: newAlbum || null
        };
        if (currentCoverFile) {
            const reader = new FileReader();
            const coverBuffer = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(Buffer.from(reader.result));
                reader.onerror = reject;
                reader.readAsArrayBuffer(currentCoverFile);
            });
            tags.image = {
                mime: currentCoverFile.type,
                type: { id: 3 },
                description: 'Cover',
                imageBuffer: coverBuffer
            };
        } else {
            if (existingTags.image) tags.image = existingTags.image;
        }
        const success = NodeID3.write(tags, track.path);
        if (success) {
            track.name = newTitle;
            track.artist = newArtist;
            track.album = newAlbum || null;
            if (currentCoverFile) {
                if (track.cover?.startsWith('blob:')) URL.revokeObjectURL(track.cover);
                track.cover = URL.createObjectURL(currentCoverFile);
            }
            const idx = originalTracks.findIndex(t => t.path === track.path);
            if (idx !== -1) originalTracks[idx] = { ...track };
            updateTrackInfo(currentTrackIndex);
            updateAlbumArt(track.cover, track.name);
            refreshTrackList();
            showNotification('Metadata saved successfully');
            closeMetadataModal();
        } else {
            showNotification('Failed to write tags');
        }
    } catch (e) {
        showNotification('Error saving metadata: ' + e.message);
    }
}

function updateMediaSession(track) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: track.artist,
            album: track.album,
            artwork: track.cover ? [{ src: track.cover, sizes: '512x512', type: 'image/jpeg' }] : []
        });
    }
}
function updatePlaybackState(state) {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
}

const grip = document.getElementById('libraryGrip');
const librarySection = document.querySelector('.library-section');
if (grip && librarySection) {
    grip.addEventListener('click', () => librarySection.classList.toggle('collapsed'));
}

document.addEventListener('DOMContentLoaded', () => {
    const saved = config.loadSettings();
    if (saved.volume >= 0 && saved.volume <= 100) { audio.volume = saved.volume / 100; volumeSlider.value = saved.volume; }
    if (saved.repeatMode && ['none', 'all', 'one'].includes(saved.repeatMode)) {
        repeatMode = saved.repeatMode;
        repeatBtn.classList.remove('repeat-one', 'repeat-all');
        if (repeatMode === 'one') repeatBtn.classList.add('repeat-one');
        else if (repeatMode === 'all') repeatBtn.classList.add('repeat-all');
        document.getElementById('repeat-status').textContent = repeatMode === 'one' ? 'repeat mode: one' : repeatMode === 'all' ? 'repeat mode: all' : 'repeat mode: none';
    }
    if (saved.discordRpcEnabled !== undefined) {
        discordRpcEnabled = saved.discordRpcEnabled;
        if (discordRpcToggle) discordRpcToggle.checked = discordRpcEnabled;
    } else {
        discordRpcEnabled = true;
        if (discordRpcToggle) discordRpcToggle.checked = true;
    }
    if (saved.theme) {
        currentTheme = saved.theme;
        applyTheme(currentTheme);
        if (themeToggle) themeToggle.checked = (currentTheme === 'light');
    } else {
        applyTheme('dark');
        if (themeToggle) themeToggle.checked = false;
    }
    if (saved.matugenEnabled !== undefined) {
        matugenEnabled = saved.matugenEnabled;
        if (matugenToggle) matugenToggle.checked = matugenEnabled;
    } else {
        matugenEnabled = false;
        if (matugenToggle) matugenToggle.checked = false;
    }
    if (saved.visualizerEnabled !== undefined) {
        visualizerEnabled = saved.visualizerEnabled;
        if (visualizerToggle) visualizerToggle.checked = visualizerEnabled;
    } else {
        visualizerEnabled = true;
        if (visualizerToggle) visualizerToggle.checked = true;
    }
    if (saved.lrcEnabled !== undefined) {
        lrcEnabled = saved.lrcEnabled;
        if (lrcToggle) lrcToggle.checked = lrcEnabled;
    } else {
        lrcEnabled = true;
        if (lrcToggle) lrcToggle.checked = true;
    }
    if (fs.existsSync(OFFSETS_FILE)) {
        try { lrcOffsets = JSON.parse(fs.readFileSync(OFFSETS_FILE, 'utf-8')); } catch (e) { lrcOffsets = {}; }
    }
    if (os.platform() === 'win32') {
        matugenToggle.disabled = true;
        matugenToggle.parentElement.parentElement.style.opacity = '0.5';
        matugenToggle.parentElement.parentElement.style.pointerEvents = 'none';
        if (matugenEnabled) {
            matugenEnabled = false;
            matugenToggle.checked = false;
        }
    }
    watchMatugenFile();
    updateMatugenState();
    if (saved.libraryPath && fs.existsSync(saved.libraryPath)) {
        libraryFolder = saved.libraryPath;
        libraryPath.textContent = path.basename(libraryFolder);
        loadTracksFromFolder(libraryFolder);
    } else if (saved.libraryPath) {
        libraryPath.textContent = 'Path not found';
    }
    initPlaylistEditing();
    updateSizes();
    const versionSpan = document.getElementById('settings-version');
    if (versionSpan) versionSpan.textContent = `v${packageJson.version}`;
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => playTrack());
        navigator.mediaSession.setActionHandler('pause', () => pauseTrack());
        navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
        navigator.mediaSession.setActionHandler('stop', () => { pauseTrack(); });
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            if (!isNaN(audio.duration)) audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 5));
        });
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            if (!isNaN(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + (details.seekOffset || 5));
        });
    }
    if (!visualizerEnabled) {
        stopVisualizer();
        document.querySelectorAll('.visualizer-canvas').forEach(c => c.classList.remove('visible'));
    }
});

editMetadataBtn.addEventListener('click', openMetadataModal);
metadataCoverBtn.addEventListener('click', () => metadataCoverInput.click());
metadataCoverInput.addEventListener('change', handleCoverInput);
metadataSaveBtn.addEventListener('click', saveMetadata);
metadataCancelBtn.addEventListener('click', closeMetadataModal);
window.addEventListener('click', e => { if (e.target === metadataModal) closeMetadataModal(); });
window.addEventListener('resize', updateSizes);
window.addEventListener('beforeunload', () => {
    if (currentTrackPath && isPlaying) flushTrackStats(true);
    saveStats(stats);
    tracks.forEach(t => { if (t.cover && t.cover.startsWith('blob:')) URL.revokeObjectURL(t.cover); });
    if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
});