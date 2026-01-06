// --- STATE MANAGEMENT ---
let isEnabled = false;
let apiKey = '';
let isMarqueeMode = false;
let isDrawing = false;
let isDraggingMarquee = false;
let marqueeRect = { x: 0, y: 0, w: 0, h: 0 };
let startX, startY;
let dragStartX, dragStartY;

// --- UI ELEMENTS ---
let floatingPanel = null;
let marqueeEl = null;
let overlayEl = null;

// Initialize on load
async function init() {
    const res = await chrome.storage.local.get(['panelEnabled', 'geminiApiKey']);
    isEnabled = !!res.panelEnabled;
    apiKey = res.geminiApiKey || '';
    
    if (isEnabled) {
        createFloatingPanel();
    }
}

init();

// Listen for storage changes to handle immediate UI toggling
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.panelEnabled) {
            isEnabled = changes.panelEnabled.newValue;
            handleToggle();
        }
        if (changes.geminiApiKey) {
            apiKey = changes.geminiApiKey.newValue;
        }
    }
});

function handleToggle() {
    if (isEnabled) {
        if (!floatingPanel) {
            createFloatingPanel();
        } else {
            floatingPanel.style.display = 'flex';
        }
    } else {
        if (floatingPanel) {
            floatingPanel.style.display = 'none';
        }
        removeMarquee();
        exitMarqueeMode();
    }
}

function createFloatingPanel() {
    const existing = document.getElementById('gemini-ocr-panel');
    if (existing) {
        floatingPanel = existing;
        floatingPanel.style.display = 'flex';
        return;
    }

    floatingPanel = document.createElement('div');
    floatingPanel.id = 'gemini-ocr-panel';
    floatingPanel.style.cssText = `
        position: fixed; top: 20px; right: 20px; width: 300px;
        background: white; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.15);
        z-index: 2147483647; display: flex; flex-direction: column; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
        border: 1px solid rgba(0,0,0,0.1);
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 10px 14px; background: #f8f9fa; cursor: move;
        display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #eee; font-weight: 600; font-size: 14px; color: #333;
        user-select: none;
    `;
    header.innerHTML = `<span>Gemini OCR Tool</span>`;
    
    const controls = document.createElement('div');
    controls.style.cssText = `padding: 12px; display: flex; gap: 12px; border-bottom: 1px solid #f5f5f5; background: #fff;`;
    
    const crossBtn = createBtn('✛', 'Draw Marquee');
    const eraseBtn = createBtn('⎼', 'Erase Selection');
    
    const textArea = document.createElement('textarea');
    textArea.placeholder = "Resulting text will appear here...";
    textArea.style.cssText = `
        width: 100%; height: 180px; padding: 12px; border: none; outline: none;
        resize: vertical; font-size: 13px; box-sizing: border-box; line-height: 1.5;
        background: #fff; color: #444;
    `;

    controls.appendChild(crossBtn);
    controls.appendChild(eraseBtn);
    floatingPanel.appendChild(header);
    floatingPanel.appendChild(controls);
    floatingPanel.appendChild(textArea);
    document.body.appendChild(floatingPanel);

    crossBtn.onclick = (e) => { e.preventDefault(); toggleMarqueeMode(); };
    eraseBtn.onclick = (e) => { e.preventDefault(); removeMarquee(); };
    makeDraggable(floatingPanel, header);
}

function createBtn(text, title) {
    const btn = document.createElement('button');
    btn.innerText = text;
    btn.title = title;
    btn.style.cssText = `
        width: 36px; height: 36px; border: 1px solid #eee; background: #fdfdfd;
        cursor: pointer; border-radius: 8px; display: flex; align-items: center;
        justify-content: center; font-size: 18px; transition: all 0.2s ease;
    `;
    return btn;
}

function toggleMarqueeMode() {
    isMarqueeMode = !isMarqueeMode;
    if (isMarqueeMode) {
        document.body.style.cursor = 'crosshair';
        createOverlay();
    } else {
        exitMarqueeMode();
    }
}

function exitMarqueeMode() {
    isMarqueeMode = false;
    document.body.style.cursor = 'default';
    if (overlayEl) overlayEl.remove();
}

function createOverlay() {
    if (overlayEl) overlayEl.remove();
    overlayEl = document.createElement('div');
    overlayEl.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        z-index: 2147483646; background: rgba(0,0,0,0.01);
    `;
    document.body.appendChild(overlayEl);

    overlayEl.onmousedown = (e) => {
        if (e.button !== 0) return;
        isDrawing = true;
        startX = e.clientX;
        startY = e.clientY;
        removeMarquee();
        marqueeEl = document.createElement('div');
        marqueeEl.style.cssText = `
            position: fixed; border: 2px dashed red; pointer-events: auto;
            z-index: 2147483647; cursor: move; background: rgba(255, 0, 0, 0.05);
        `;
        document.body.appendChild(marqueeEl);
        marqueeEl.onmousedown = startDraggingMarquee;
    };

    window.onmousemove = (e) => {
        if (!isDrawing) return;
        marqueeRect.x = Math.min(startX, e.clientX);
        marqueeRect.y = Math.min(startY, e.clientY);
        marqueeRect.w = Math.abs(e.clientX - startX);
        marqueeRect.h = Math.abs(e.clientY - startY);
        updateMarqueeStyles();
    };

    window.onmouseup = () => {
        if (isDrawing) {
            isDrawing = false;
            exitMarqueeMode();
            if (marqueeRect.w > 5 && marqueeRect.h > 5) processSelection();
        }
    };
}

function updateMarqueeStyles() {
    if (!marqueeEl) return;
    marqueeEl.style.left = marqueeRect.x + 'px';
    marqueeEl.style.top = marqueeRect.y + 'px';
    marqueeEl.style.width = marqueeRect.w + 'px';
    marqueeEl.style.height = marqueeRect.h + 'px';
}

function startDraggingMarquee(e) {
    if (isMarqueeMode) return;
    e.stopPropagation();
    isDraggingMarquee = true;
    dragStartX = e.clientX - marqueeRect.x;
    dragStartY = e.clientY - marqueeRect.y;

    const onMove = (me) => {
        marqueeRect.x = me.clientX - dragStartX;
        marqueeRect.y = me.clientY - dragStartY;
        updateMarqueeStyles();
    };

    const onUp = () => {
        isDraggingMarquee = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        processSelection();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
}

function removeMarquee() {
    if (marqueeEl) marqueeEl.remove();
    marqueeEl = null;
    marqueeRect = { x: 0, y: 0, w: 0, h: 0 };
}

async function processSelection() {
    if (!apiKey) {
        updateText("Error: Please set your Gemini API key.");
        return;
    }
    updateText("Processing area...");
    chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' }, async (response) => {
        if (!response || !response.dataUrl) {
            updateText("Error: Could not capture tab.");
            return;
        }
        try {
            const croppedBase64 = await cropImage(response.dataUrl, marqueeRect);
            const text = await callGemini(croppedBase64);
            updateText(text);
        } catch (err) {
            updateText("Error: " + err.message);
        }
    });
}

function updateText(msg) {
    if (floatingPanel) floatingPanel.querySelector('textarea').value = msg;
}

async function cropImage(dataUrl, rect) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.w * dpr;
            canvas.height = rect.h * dpr;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr, 0, 0, rect.w * dpr, rect.h * dpr);
            resolve(canvas.toDataURL('image/png').split(',')[1]);
        };
        img.src = dataUrl;
    });
}

async function callGemini(base64Image) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{
            parts: [
                { text: "Extract all visible text from this image segment exactly as it appears." },
                { inlineData: { mimeType: "image/png", data: base64Image } }
            ]
        }]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No text detected.";
}

function makeDraggable(el, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = (e) => {
        pos3 = e.clientX; pos4 = e.clientY;
        document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
        document.onmousemove = (e) => {
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
        };
    };
}