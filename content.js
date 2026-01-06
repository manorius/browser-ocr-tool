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

// Z-Index Constants for layering
const Z_INDEX_PANEL = 2147483647; // Max possible
const Z_INDEX_MARQUEE = 2147483645; 
const Z_INDEX_OVERLAY = 2147483640;

async function init() {
    const res = await chrome.storage.local.get(['panelEnabled', 'geminiApiKey']);
    isEnabled = !!res.panelEnabled;
    apiKey = res.geminiApiKey || '';
    if (isEnabled) createFloatingPanel();
}

init();

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
        if (floatingPanel) floatingPanel.style.display = 'none';
        removeMarquee();
        exitMarqueeMode();
    }
}

function createFloatingPanel() {
    const existing = document.getElementById('browser-ocr-panel');
    if (existing) {
        floatingPanel = existing;
        floatingPanel.style.display = 'flex';
        return;
    }

    floatingPanel = document.createElement('div');
    floatingPanel.id = 'browser-ocr-panel';
    floatingPanel.style.cssText = `
        position: fixed; top: 30px; right: 30px; width: 320px;
        background: #ffffff; border-radius: 12px; 
        box-shadow: 0 12px 40px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.1);
        z-index: ${Z_INDEX_PANEL}; display: flex; flex-direction: column; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        color: #202124;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 12px 16px; background: #1a1a1a; cursor: move;
        display: flex; justify-content: space-between; align-items: center;
        color: #ffffff; font-weight: 600; font-size: 13px;
        letter-spacing: 0.5px; text-transform: uppercase;
    `;
    
    const titleSpan = document.createElement('span');
    titleSpan.innerText = 'Browser OCR Tool';
    
    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = '&#10005;';
    closeBtn.style.cssText = `
        cursor: pointer; font-size: 14px; padding: 4px; line-height: 1;
        transition: opacity 0.2s;
    `;
    closeBtn.onmouseover = () => closeBtn.style.opacity = '0.7';
    closeBtn.onmouseout = () => closeBtn.style.opacity = '1';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        chrome.storage.local.set({ panelEnabled: false });
    };

    header.appendChild(titleSpan);
    header.appendChild(closeBtn);
    
    const controls = document.createElement('div');
    controls.style.cssText = `
        padding: 14px; display: flex; gap: 12px; 
        background: #fdfdfd; border-bottom: 1px solid #eee;
    `;
    
    const crossBtn = createBtn('✛', 'Toggle Marquee Tool', '#1a73e8');
    const scanBtn = createBtn('📸', 'Extract Text from Selection', '#188038');
    const eraseBtn = createBtn('🧽', 'Clear Selection', '#d93025');
    
    const textArea = document.createElement('textarea');
    textArea.placeholder = "1. Use ✛ to draw a box\n2. Position it as needed\n3. Click 📸 to extract text";
    textArea.style.cssText = `
        width: 100%; height: 200px; padding: 16px; border: none; outline: none;
        resize: vertical; font-size: 13px; box-sizing: border-box; line-height: 1.6;
        background: #fff; color: #202124; font-family: inherit;
    `;

    controls.appendChild(crossBtn);
    controls.appendChild(scanBtn);
    controls.appendChild(eraseBtn);
    floatingPanel.appendChild(header);
    floatingPanel.appendChild(controls);
    floatingPanel.appendChild(textArea);
    document.body.appendChild(floatingPanel);

    crossBtn.onclick = (e) => { e.preventDefault(); toggleMarqueeMode(); };
    scanBtn.onclick = (e) => { e.preventDefault(); processSelection(); };
    eraseBtn.onclick = (e) => { e.preventDefault(); removeMarquee(); };
    
    makeDraggable(floatingPanel, header);
}

function createBtn(text, title, activeColor) {
    const btn = document.createElement('button');
    btn.innerText = text;
    btn.title = title;
    btn.style.cssText = `
        flex: 1; height: 42px; border: 1px solid #dadce0; background: #fff;
        cursor: pointer; border-radius: 8px; display: flex; align-items: center;
        justify-content: center; font-size: 20px; transition: all 0.2s ease;
        color: #3c4043; box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    `;
    btn.onmouseover = () => {
        btn.style.borderColor = activeColor;
        btn.style.color = activeColor;
        btn.style.background = `${activeColor}08`;
        btn.style.transform = 'translateY(-1px)';
        btn.style.boxShadow = `0 4px 8px ${activeColor}20`;
    };
    btn.onmouseout = () => {
        btn.style.borderColor = '#dadce0';
        btn.style.color = '#3c4043';
        btn.style.background = '#fff';
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
    };
    return btn;
}

// --- MARQUEE LOGIC ---

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
        z-index: ${Z_INDEX_OVERLAY}; background: rgba(0,0,0,0.15);
    `;
    document.body.appendChild(overlayEl);

    overlayEl.onmousedown = (e) => {
        if (e.button !== 0) return;
        // Check if user clicked the floating panel (unlikely due to z-index but safe)
        if (floatingPanel && floatingPanel.contains(e.target)) return;

        isDrawing = true;
        startX = e.clientX; startY = e.clientY;
        removeMarquee();
        marqueeEl = document.createElement('div');
        marqueeEl.style.cssText = `
            position: fixed; border: 2px dashed #d93025; pointer-events: auto;
            z-index: ${Z_INDEX_MARQUEE}; cursor: move; background: rgba(217, 48, 37, 0.1);
            box-shadow: 0 0 0 9999px rgba(0,0,0,0.3);
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
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
}

function removeMarquee() {
    if (marqueeEl) marqueeEl.remove();
    marqueeEl = null;
    marqueeRect = { x: 0, y: 0, w: 0, h: 0 };
}

// --- OCR PROCESSING ---

async function processSelection() {
    if (!marqueeEl || marqueeRect.w < 5 || marqueeRect.h < 5) {
        updateText("Please draw a selection area first using the ✛ tool.");
        return;
    }
    
    if (!apiKey) {
        updateText("API Key missing. Please set it in the extension settings.");
        return;
    }

    updateText("Processing... Please wait.");

    chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' }, async (response) => {
        if (!response || !response.dataUrl) {
            updateText("Error capturing page. Try refreshing.");
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
    if (floatingPanel) {
        const ta = floatingPanel.querySelector('textarea');
        ta.value = msg;
        ta.scrollTop = ta.scrollHeight;
    }
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
                { text: "Extract all visible text from this image segment precisely. Return only the text found. If there is no text in the image describe what is in the image in a few words" },
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