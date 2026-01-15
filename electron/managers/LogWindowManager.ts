import { BrowserWindow, ipcMain, app } from 'electron';
import path from 'path';

export class LogWindowManager {
    private static logWindow: BrowserWindow | null = null;
    private static messageBuffer: { message: string, type: string }[] = [];
    private static isReady = false;

    constructor() {
        this.registerListeners();
    }

    private registerListeners() {
        ipcMain.on('log-window-minimize', () => {
            if (LogWindowManager.logWindow && !LogWindowManager.logWindow.isDestroyed()) {
                LogWindowManager.logWindow.minimize();
            }
        });

        ipcMain.on('log-window-close', () => {
            if (LogWindowManager.logWindow && !LogWindowManager.logWindow.isDestroyed()) {
                LogWindowManager.logWindow.close();
            }
        });

        // Frontend signals it is ready to receive logs
        ipcMain.on('log-window-ready', () => {
            LogWindowManager.isReady = true;
            LogWindowManager.flushBuffer();
        });
    }

    static create() {
        if (LogWindowManager.logWindow && !LogWindowManager.logWindow.isDestroyed()) {
            LogWindowManager.logWindow.focus();
            return;
        }

        LogWindowManager.isReady = false; // Reset ready state

        LogWindowManager.logWindow = new BrowserWindow({
            width: 900,
            height: 600,
            backgroundColor: '#111',
            title: 'Game Output',
            frame: false, // Frameless
            autoHideMenuBar: true,
            icon: path.join(__dirname, '../public/favicon.ico'),
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        const logHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        background: #000; 
                        color: #ddd; 
                        font-family: 'Consolas', monospace; 
                        margin: 0; 
                        overflow: hidden; 
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        border: 1px solid #333;
                        box-sizing: border-box;
                    }

                    /* TitleBar CSS */
                    .titlebar {
                        height: 38px;
                        background: rgba(20, 20, 20, 0.98);
                        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 0 12px;
                        -webkit-app-region: drag;
                        user-select: none;
                    }
                    .title { font-size: 12px; font-weight: 600; color: #888; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
                    .controls { display: flex; gap: 4px; -webkit-app-region: no-drag; }
                    .btn {
                        width: 32px; height: 26px; border: none; background: transparent; color: #666;
                        display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 6px;
                    }
                    .btn:hover { background: rgba(255, 255, 255, 0.08); color: white; }
                    .btn.close:hover { background: #e81123; }
                    
                    /* Log Area */
                    #logs {
                        flex: 1;
                        overflow-y: auto;
                        padding: 16px;
                        font-size: 13px;
                    }
                    .log-line { margin-bottom: 4px; white-space: pre-wrap; word-break: break-all; }
                    .err { color: #ff5555; }
                    .info { color: #55ff55; }
                    
                    /* Scrollbar */
                    ::-webkit-scrollbar { width: 8px; }
                    ::-webkit-scrollbar-track { background: #111; }
                    ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
                    ::-webkit-scrollbar-thumb:hover { background: #555; }
                </style>
            </head>
            <body>
                <div class="titlebar">
                    <div class="title">Game Output</div>
                    <div class="controls">
                        <button class="btn" id="minBtn">
                            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1"/></svg>
                        </button>
                        <button class="btn close" id="closeBtn">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                                <path d="M1 0L0 1L4 5L0 9L1 10L5 6L9 10L10 9L6 5L10 1L9 0L5 4L1 0Z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div id="logs"></div>
                <script>
                    const { ipcRenderer } = require('electron');
                    const container = document.getElementById('logs');
                    
                    // Window controls
                    document.getElementById('minBtn').onclick = () => ipcRenderer.send('log-window-minimize');
                    document.getElementById('closeBtn').onclick = () => ipcRenderer.send('log-window-close');

                    // Log messages
                    ipcRenderer.on('game:log', (e, data) => {
                        const div = document.createElement('div');
                        div.className = 'log-line ' + (data.type === 'stderr' ? 'err' : (data.type === 'info' ? 'info' : ''));
                        div.textContent = data.message;
                        container.appendChild(div);
                        container.scrollTop = container.scrollHeight;
                    });
                    
                    // Signal ready to receive logs
                    ipcRenderer.send('log-window-ready');
                </script>
            </body>
            </html>
        `;

        LogWindowManager.logWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(logHtml)}`);

        LogWindowManager.logWindow.on('closed', () => {
            LogWindowManager.logWindow = null;
            LogWindowManager.isReady = false;
        });
    }

    static send(message: string, type: 'stdout' | 'stderr' | 'info' = 'stdout') {
        if (LogWindowManager.logWindow && !LogWindowManager.logWindow.isDestroyed() && LogWindowManager.isReady) {
            LogWindowManager.logWindow.webContents.send('game:log', { message, type });
        } else {
            LogWindowManager.messageBuffer.push({ message, type });
        }
    }

    static flushBuffer() {
        if (!LogWindowManager.logWindow || LogWindowManager.logWindow.isDestroyed()) return;

        while (LogWindowManager.messageBuffer.length > 0) {
            const item = LogWindowManager.messageBuffer.shift();
            if (item) {
                LogWindowManager.logWindow.webContents.send('game:log', item);
            }
        }
    }

    static close() {
        if (LogWindowManager.logWindow && !LogWindowManager.logWindow.isDestroyed()) {
            LogWindowManager.logWindow.close();
        }
    }
}
