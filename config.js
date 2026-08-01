const fs = require('fs');
const path = require('path');
const os = require('os');
const { version } = require('./package.json');

function getConfigPath() {
    return path.join(os.homedir(), '.config', 'kute-player');
}

const CONFIG_DIR = getConfigPath();
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

function loadSettings() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return {
                volume: 80,
                libraryPath: '',
                repeatMode: 'none',
                discordRpcEnabled: true,
                theme: 'dark',
                matugenEnabled: false,
                visualizerEnabled: true
            };
        }
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        const settings = JSON.parse(data);
        if (settings.repeatMode === undefined) settings.repeatMode = 'none';
        if (settings.discordRpcEnabled === undefined) settings.discordRpcEnabled = true;
        if (settings.theme === undefined) settings.theme = 'dark';
        if (settings.matugenEnabled === undefined) settings.matugenEnabled = false;
        if (settings.visualizerEnabled === undefined) settings.visualizerEnabled = true;
        return settings;
    } catch (error) {
        return {
            volume: 80,
            libraryPath: '',
            repeatMode: 'none',
            discordRpcEnabled: true,
            theme: 'dark',
            matugenEnabled: false,
            visualizerEnabled: true
        };
    }
}

let saveTimer = null;
function saveSettings(volume, libraryPath, repeatMode, discordRpcEnabled, theme, matugenEnabled, visualizerEnabled) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            if (!fs.existsSync(CONFIG_DIR)) {
                fs.mkdirSync(CONFIG_DIR, { recursive: true });
            }
            const settings = {
                volume: volume,
                libraryPath: libraryPath || '',
                repeatMode: repeatMode || 'none',
                discordRpcEnabled: discordRpcEnabled,
                theme: theme || 'dark',
                matugenEnabled: matugenEnabled !== undefined ? matugenEnabled : false,
                visualizerEnabled: visualizerEnabled !== undefined ? visualizerEnabled : true,
                version: version
            };
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2));
        } catch (error) { }
    }, 300);
}

module.exports = { loadSettings, saveSettings };