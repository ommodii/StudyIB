/* ==========================================================================
   Atom Note-Taking System Engine
   ========================================================================== */

(function() {
    let fs = null;
    let path = null;
    try {
        fs = require('fs');
        path = require('path');
    } catch (e) {
        console.warn("Node filesystem modules not available. Using offline memory storage for Atom.");
    }

    // --- State & Config ---
    const NOTES_DIR = (path && typeof process !== 'undefined' && process.cwd) ? path.join(process.cwd(), 'Content', 'Atom_Notes') : 'Content/Atom_Notes';
    let notebooks = [];
    let activeNotebook = null;
    let activeTool = 'pen'; // 'pan', 'pen', 'highlighter', 'eraser', 'text'
    let strokeColor = '#E11D48'; // Rose default
    let strokeWidth = 3;
    let undoStack = [];
    let redoStack = [];
    
    // --- Platform-Safe Storage Wrapper ---
    const isCapacitor = typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;

    async function ensureStorageDirectory() {
        if (isCapacitor) {
            const { Filesystem } = window.Capacitor.Plugins;
            // Try stat first — if the directory already exists we skip mkdir entirely,
            // which avoids the OS-PLUG-FILE-0010 "already exists" error that fills
            // the Xcode console on every subsequent launch.
            try {
                await Filesystem.stat({
                    path: 'Atom_Notes',
                    directory: 'DOCUMENTS'
                });
                // stat succeeded → directory exists, nothing to do
            } catch (_statErr) {
                // stat failed → directory doesn't exist yet, create it
                try {
                    await Filesystem.mkdir({
                        path: 'Atom_Notes',
                        directory: 'DOCUMENTS',
                        recursive: true
                    });
                } catch (mkdirErr) {
                    // Ignore "already exists" race condition; log anything else
                    if (!String(mkdirErr).includes('0010') && !String(mkdirErr).includes('already exists')) {
                        console.warn('[atom] mkdir warning:', mkdirErr);
                    }
                }
            }
        } else if (fs && NOTES_DIR) {
            try {
                if (!fs.existsSync(NOTES_DIR)) {
                    fs.mkdirSync(NOTES_DIR, { recursive: true });
                }
            } catch (err) {
                console.error('Failed to create desktop directory:', err);
            }
        }
    }


    async function writeNotebookToDisk(notebook) {
        if (isCapacitor) {
            const { Filesystem } = window.Capacitor.Plugins;
            try {
                await Filesystem.writeFile({
                    path: `Atom_Notes/${notebook.id}.json`,
                    data: JSON.stringify(notebook, null, 2),
                    directory: 'DOCUMENTS',
                    encoding: 'utf8'
                });
            } catch (e) {
                console.warn('[atom] Capacitor save warning:', e);
            }
        } else if (fs && NOTES_DIR) {
            try {
                const filepath = path.join(NOTES_DIR, `${notebook.id}.json`);
                fs.writeFileSync(filepath, JSON.stringify(notebook, null, 2), 'utf8');
            } catch (err) {
                console.error("Desktop save failed:", err);
            }
        }
    }

    async function deleteNotebookFromDisk(id) {
        if (isCapacitor) {
            const { Filesystem } = window.Capacitor.Plugins;
            try {
                await Filesystem.deleteFile({
                    path: `Atom_Notes/${id}.json`,
                    directory: 'DOCUMENTS'
                });
            } catch (e) {
                console.warn('[atom] Capacitor delete warning:', e);
            }
        } else if (fs && NOTES_DIR) {
            try {
                const filepath = path.join(NOTES_DIR, `${id}.json`);
                if (fs.existsSync(filepath)) {
                    fs.unlinkSync(filepath);
                }
            } catch (err) {
                console.error("Desktop delete failed:", err);
            }
        }
    }

    async function loadNotebooksFromDisk() {
        let loaded = [];
        if (isCapacitor) {
            const { Filesystem } = window.Capacitor.Plugins;
            try {
                await ensureStorageDirectory();
                const result = await Filesystem.readdir({
                    path: 'Atom_Notes',
                    directory: 'DOCUMENTS'
                });
                
                const files = result.files || [];
                for (let file of files) {
                    const filename = file.name;
                    if (filename.endsWith('.json')) {
                        const fileData = await Filesystem.readFile({
                            path: `Atom_Notes/${filename}`,
                            directory: 'DOCUMENTS',
                            encoding: 'utf8'
                        });
                        const notebook = JSON.parse(fileData.data);
                        loaded.push(notebook);
                    }
                }
            } catch (e) {
                console.warn('[atom] Capacitor load warning:', e);
            }
        } else if (fs && NOTES_DIR) {
            try {
                await ensureStorageDirectory();
                const files = fs.readdirSync(NOTES_DIR);
                files.forEach(file => {
                    if (file.endsWith('.json')) {
                        const data = fs.readFileSync(path.join(NOTES_DIR, file), 'utf8');
                        const notebook = JSON.parse(data);
                        loaded.push(notebook);
                    }
                });
            } catch (err) {
                console.error("Desktop load failed:", err);
            }
        }
        return loaded;
    }

    // Ensure storage directory is created asynchronously
    ensureStorageDirectory();

    let isDiskLoaded = false;

    // Load saved notebooks on start
    function loadNotebooks() {
        // First sync instantly with localStorage cache so the UI works immediately
        const memoryData = localStorage.getItem('atom_notebooks');
        if (memoryData) {
            try {
                notebooks = JSON.parse(memoryData);
            } catch (e) {
                console.error("Failed to parse localStorage notebooks:", e);
                notebooks = [];
            }
        }

        // Only load from disk ONCE on startup to prevent infinite rendering loops
        if (isDiskLoaded) {
            return;
        }

        isDiskLoaded = true;

        // Then asynchronously fetch from disk and merge/update
        loadNotebooksFromDisk().then(diskNotebooks => {
            if (diskNotebooks.length > 0) {
                let hasChanges = false;
                // Merge disk notebooks into memory, keeping the most recent modifications
                diskNotebooks.forEach(diskNotebook => {
                    const idx = notebooks.findIndex(n => n.id === diskNotebook.id);
                    if (idx !== -1) {
                        const diskMod = new Date(diskNotebook.lastModified);
                        const memMod = new Date(notebooks[idx].lastModified);
                        if (diskMod > memMod) {
                            notebooks[idx] = diskNotebook;
                            hasChanges = true;
                        }
                    } else {
                        notebooks.push(diskNotebook);
                        hasChanges = true;
                    }
                });
                
                if (hasChanges) {
                    // Save merged list to localStorage cache
                    localStorage.setItem('atom_notebooks', JSON.stringify(notebooks));
                    
                    // Re-render dashboard if the current view is active
                    const dashboardView = document.getElementById('atomDashboardView');
                    if (dashboardView && !dashboardView.classList.contains('hidden')) {
                        renderDashboard();
                    }
                }
            }
        });
    }

    function saveNotebook(notebook) {
        notebook.lastModified = new Date().toISOString();
        
        // 1. Sync instantly with in-memory array & localStorage
        const idx = notebooks.findIndex(n => n.id === notebook.id);
        if (idx !== -1) notebooks[idx] = notebook;
        else notebooks.push(notebook);
        localStorage.setItem('atom_notebooks', JSON.stringify(notebooks));
        
        // 2. Fire-and-forget async write to disk
        writeNotebookToDisk(notebook);
    }

    function deleteNotebook(id) {
        // 1. Sync instantly with in-memory array & localStorage
        notebooks = notebooks.filter(n => n.id !== id);
        localStorage.setItem('atom_notebooks', JSON.stringify(notebooks));
        renderDashboard();
        
        // 2. Fire-and-forget async delete from disk
        deleteNotebookFromDisk(id);
    }

    // --- DOM Elements Initialization ---
    window.AtomWorkspace = {
        init() {
            loadNotebooks();
            this.bindEvents();
            renderDashboard();
        },

        bindEvents() {
            // New Notebook modal trigger
            const newBtn = document.getElementById('atomNewBtn');
            if (newBtn) {
                newBtn.addEventListener('click', () => openNewNotebookModal());
            }

            // Close workspace
            const backBtn = document.getElementById('atomBackBtn');
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    if (activeNotebook) {
                        this.closeEditor();
                    } else {
                        // Exit Atom completely, return to Subject Dashboard
                        document.getElementById('atomWorkspace').classList.add('hidden');
                        document.getElementById('mainContentArea').classList.remove('hidden');
                    }
                });
            }

            // Toolbar tools
            document.querySelectorAll('.atom-toolbar-btn[data-tool]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('.atom-toolbar-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    const target = e.currentTarget;
                    target.classList.add('active');
                    activeTool = target.getAttribute('data-tool');
                    updateCanvasCursors();
                });
            });

            // Color selection
            document.querySelectorAll('.atom-color-dot').forEach(dot => {
                dot.addEventListener('click', (e) => {
                    document.querySelectorAll('.atom-color-dot').forEach(d => d.classList.remove('active'));
                    const target = e.currentTarget;
                    target.classList.add('active');
                    strokeColor = target.getAttribute('data-color');
                });
            });

            // Size slider
            const slider = document.getElementById('atomStrokeSlider');
            if (slider) {
                slider.addEventListener('input', (e) => {
                    strokeWidth = parseInt(e.target.value);
                });
            }

            // Add Page floating button
            const addPageBtn = document.getElementById('atomAddPageBtn');
            if (addPageBtn) {
                addPageBtn.addEventListener('click', () => {
                    if (activeNotebook) {
                        addNewPage(activeNotebook, 'grid-paper');
                    }
                });
            }

            // Save actions
            const saveBtn = document.getElementById('atomSaveBtn');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    if (activeNotebook) {
                        saveNotebook(activeNotebook);
                        // Visual save indicator flashing green
                        const originalColor = saveBtn.style.color;
                        saveBtn.style.color = '#10B981';
                        setTimeout(() => {
                            saveBtn.style.color = originalColor;
                        }, 1000);
                    }
                });
            }

            // Undo/Redo buttons
            const undoBtn = document.getElementById('atomUndoBtn');
            if (undoBtn) {
                undoBtn.addEventListener('click', () => triggerUndo());
            }

            // Bind Keyboard Shortcuts globally
            const handleShortcuts = (e) => {
                // Check if Atom Editor view is currently visible
                const editorView = document.getElementById('atomEditorView');
                if (!editorView || editorView.classList.contains('hidden')) return;

                // Skip shortcuts if user is typing in a text input field or edit box
                if (document.activeElement && (
                    document.activeElement.tagName === 'INPUT' || 
                    document.activeElement.tagName === 'TEXTAREA' || 
                    document.activeElement.classList.contains('atom-text-annotation')
                )) {
                    if (e.key === 'Escape') {
                        document.activeElement.blur();
                    }
                    return;
                }

                // Save: Cmd+S / Ctrl+S
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    if (saveBtn) saveBtn.click();
                    return;
                }

                // Undo: Cmd+Z / Ctrl+Z
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    if (undoBtn) undoBtn.click();
                    return;
                }

                // Select Tools: 1-5 or P, H, E, T, V
                const toolMapping = {
                    '1': 'pen', 'p': 'pen',
                    '2': 'highlighter', 'h': 'highlighter',
                    '3': 'eraser', 'e': 'eraser',
                    '4': 'text', 't': 'text',
                    '5': 'pan', 'v': 'pan'
                };
                const key = e.key.toLowerCase();
                if (toolMapping[key]) {
                    e.preventDefault();
                    const btn = document.querySelector(`.atom-toolbar-btn[data-tool="${toolMapping[key]}"]`);
                    if (btn) btn.click();
                    return;
                }

                // Escape to Save & Close Notebook
                if (e.key === 'Escape') {
                    e.preventDefault();
                    const backBtn = document.getElementById('atomBackBtn');
                    if (backBtn) backBtn.click();
                }
            };
            window.addEventListener('keydown', handleShortcuts);
        },

        launchWithPDF(pdfPath, title) {
            // Always create a fresh notebook entry for this PDF launch, or find existing
            let notebook = notebooks.find(n => n.pdfPath === pdfPath);
            if (!notebook) {
                notebook = {
                    id: 'notebook_' + Date.now(),
                    title: title || 'Atom Paper Note',
                    pdfPath: pdfPath,
                    lastModified: new Date().toISOString(),
                    pages: [] // pages will be created in initializeEditor from the PDF
                };
                saveNotebook(notebook);
            } else {
                // Force-reload pages from the PDF in case they're stale/blank
                notebook.pages = [];
                saveNotebook(notebook);
            }
            this.openNotebook(notebook);
        },

        openNotebook(notebook) {
            activeNotebook = notebook;
            document.getElementById('atomDashboardView').classList.add('hidden');
            document.getElementById('atomEditorView').classList.remove('hidden');
            document.getElementById('atomBackBtn').innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" style="margin-right: 6px; vertical-align: middle;"><polyline points="15 18 9 12 15 6"></polyline></svg>
                <span>Save & Close</span>
            `;
            
            // Build Editor workspace
            initializeEditor(notebook);
        },

        closeEditor() {
            if (activeNotebook) {
                saveNotebook(activeNotebook);
            }
            activeNotebook = null;
            document.getElementById('atomEditorView').classList.add('hidden');
            document.getElementById('atomDashboardView').classList.remove('hidden');
            document.getElementById('atomBackBtn').innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" style="margin-right: 6px; vertical-align: middle;"><polyline points="15 18 9 12 15 6"></polyline></svg>
                <span>Dashboard</span>
            `;
            loadNotebooks();
            renderDashboard();
        }
    };

    // Draw a miniature notebook card preview dynamically
    function drawNotebookPreview(canvas, notebook) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width = 180;
        const height = canvas.height = 240;

        // Background color
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);

        const page1 = notebook.pages && notebook.pages[0];
        if (!page1) return;

        // Draw paper style background
        if (page1.isPdfPage) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(8, 8, width - 16, height - 16);
            
            // Draw subtle placeholder lines to represent PDF content initially
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(16, 24, width - 32, 6);
            ctx.fillRect(16, 36, (width - 32) * 0.85, 4);
            ctx.fillRect(16, 44, (width - 32) * 0.7, 4);
            ctx.fillRect(16, 56, (width - 32) * 0.9, 4);
            ctx.fillRect(16, 68, (width - 32) * 0.6, 4);
            
            // Render strokes scaled on top of PDF
            const scale = (width - 16) / 816;
            drawStrokesScaled(ctx, page1.strokes, scale, 8, 8);
        } else {
            // Draw blank notebook templates
            if (page1.styleClass === 'grid-paper') {
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(8, 8, width - 16, height - 16);
                
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)';
                ctx.lineWidth = 0.5;
                for (let x = 16; x < width - 8; x += 8) {
                    ctx.beginPath();
                    ctx.moveTo(x, 8);
                    ctx.lineTo(x, height - 8);
                    ctx.stroke();
                }
                for (let y = 16; y < height - 8; y += 8) {
                    ctx.beginPath();
                    ctx.moveTo(8, y);
                    ctx.lineTo(width - 8, y);
                    ctx.stroke();
                }
            } else if (page1.styleClass === 'ruled-paper') {
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(8, 8, width - 16, height - 16);
                
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)';
                ctx.lineWidth = 0.5;
                for (let y = 20; y < height - 8; y += 10) {
                    ctx.beginPath();
                    ctx.moveTo(8, y);
                    ctx.lineTo(width - 8, y);
                    ctx.stroke();
                }
                // Pink margin line
                ctx.strokeStyle = 'rgba(244, 63, 94, 0.2)';
                ctx.beginPath();
                ctx.moveTo(20, 8);
                ctx.lineTo(20, height - 8);
                ctx.stroke();
            } else {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(8, 8, width - 16, height - 16);
            }
            
            // Draw strokes scaled
            const scale = (width - 16) / 816; // scaled from standard editor dimensions
            drawStrokesScaled(ctx, page1.strokes, scale, 8, 8);
        }
    }

    function drawStrokesScaled(ctx, strokes, scale, offsetX, offsetY) {
        if (!strokes) return;
        strokes.forEach(stroke => {
            if (stroke.points.length < 1) return;
            ctx.beginPath();
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = Math.max(0.5, stroke.width * scale * 0.5);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.5 : 1.0;
            
            // Map coordinates relative to A4 / Letter width (divided by 2 because stored strokes coordinates are doubled)
            const mapX = (ptX) => offsetX + (ptX / 2) * scale;
            const mapY = (ptY) => offsetY + (ptY / 2) * scale;

            ctx.moveTo(mapX(stroke.points[0].x), mapY(stroke.points[0].y));
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(mapX(stroke.points[i].x), mapY(stroke.points[i].y));
            }
            ctx.stroke();
        });
        ctx.globalAlpha = 1.0;
    }

    async function drawPageThumbnail(canvas, page, idx) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width = 120;
        const height = canvas.height = 160;

        // Background color
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);

        if (page.isPdfPage) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(4, 4, width - 8, height - 8);
            
            // Draw subtle placeholder lines to represent PDF content
            ctx.fillStyle = '#f1f5f9';
            for (let y = 16; y < height - 16; y += 12) {
                const lineW = (width - 24) * 0.8;
                ctx.fillRect(12, y, lineW, 4);
            }
            
            // Render strokes scaled
            const scale = (width - 8) / 816;
            drawStrokesScaled(ctx, page.strokes, scale, 4, 4);
        } else {
            // Draw blank templates
            if (page.styleClass === 'grid-paper') {
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, 0, width, height);
                
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)';
                ctx.lineWidth = 0.5;
                for (let x = 8; x < width; x += 8) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, height);
                    ctx.stroke();
                }
                for (let y = 8; y < height; y += 8) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(width, y);
                    ctx.stroke();
                }
            } else if (page.styleClass === 'ruled-paper') {
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, 0, width, height);
                
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)';
                ctx.lineWidth = 0.5;
                for (let y = 12; y < height; y += 10) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(width, y);
                    ctx.stroke();
                }
                // Pink margin line
                ctx.strokeStyle = 'rgba(244, 63, 94, 0.2)';
                ctx.beginPath();
                ctx.moveTo(15, 0);
                ctx.lineTo(15, height);
                ctx.stroke();
            } else {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
            }
        }

        // Draw drawing layer strokes scaled (divided by 2 because stored coords are doubled)
        const scale = width / 816;
        drawStrokesScaled(ctx, page.strokes, scale, 0, 0);
    }


    // --- Dashboard Renderer ---
    function renderDashboard() {
        const grid = document.getElementById('atomGrid');
        if (!grid) return;
        
        loadNotebooks();
        
        if (notebooks.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; margin-top: 4rem; text-align: center;">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" style="margin-bottom: 1rem; color: var(--text-muted);"><circle cx="12" cy="12" r="3"></circle><line x1="3" y1="12" x2="21" y2="12"></line><line x1="12" y1="3" x2="12" y2="21"></line><path d="M16.24 7.76l-8.48 8.48"></path><path d="M7.76 7.76l8.48 8.48"></path></svg>
                    <h3>No Notes Yet</h3>
                    <p style="color: var(--text-muted); max-width: 320px; margin: 0.5rem auto 0;">Create a new blank notebook or open any past paper in Atom to start sketching!</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = notebooks.map(notebook => {
            const date = new Date(notebook.lastModified).toLocaleDateString();
            const badge = notebook.pdfPath ? 'Exam Paper' : 'Blank Notes';
            return `
                <div class="notebook-card" data-id="${notebook.id}">
                    <button class="notebook-card-delete-btn" data-id="${notebook.id}" title="Delete Permanently">×</button>
                    <div class="notebook-preview-area" style="position: relative; background: #0f172a; height: 160px; overflow: hidden; border-radius: 6px; display: flex; justify-content: center; align-items: center; border: 1px solid var(--border-light);">
                        <canvas class="notebook-card-canvas" id="canvas_${notebook.id}" style="width: 100%; height: 100%; object-fit: contain;"></canvas>
                    </div>
                    <div class="notebook-info">
                        <div class="notebook-title">${notebook.title}</div>
                        <div class="notebook-meta">
                            <span>Modified: ${date}</span>
                            <span class="notebook-badge">${badge}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Render card previews onto canvases
        notebooks.forEach(notebook => {
            const canvas = document.getElementById(`canvas_${notebook.id}`);
            if (canvas) {
                drawNotebookPreview(canvas, notebook);
            }
        });

        // Bind clicks to notebooks
        grid.querySelectorAll('.notebook-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('notebook-card-delete-btn')) {
                    e.stopPropagation();
                    const id = e.target.getAttribute('data-id');
                    if (confirm("Are you sure you want to delete this notebook permanently?")) {
                        deleteNotebook(id);
                    }
                    return;
                }
                const id = card.getAttribute('data-id');
                const notebook = notebooks.find(n => n.id === id);
                if (notebook) window.AtomWorkspace.openNotebook(notebook);
            });
        });
    }

    // --- New Notebook Modal Dialog ---
    function openNewNotebookModal() {
        const modal = document.createElement('div');
        modal.className = 'atom-modal-overlay';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 420px; animation: modalSlide 0.2s cubic-bezier(0.4, 0, 0.2, 1);">
                <div class="modal-header">
                    <h3 style="display: flex; align-items: center; gap: 8px;">
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" style="vertical-align: middle;"><circle cx="12" cy="12" r="3"></circle><line x1="3" y1="12" x2="21" y2="12"></line><line x1="12" y1="3" x2="12" y2="21"></line><path d="M16.24 7.76l-8.48 8.48"></path><path d="M7.76 7.76l8.48 8.48"></path></svg>
                        <span>Create New Notebook</span>
                    </h3>
                    <button class="close-btn" id="closeNewModalBtn">×</button>
                </div>
                <div class="modal-body" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem;">
                    <div class="mock-config-group">
                        <label class="mock-config-label">Notebook Name</label>
                        <input type="text" id="notebookTitleInput" class="mock-paper-btn" style="width: 100%; border: 1px solid var(--border-light); background: var(--bg-elevated); outline: none; padding: 0.6rem 1rem; border-radius: var(--radius-md); color: var(--text-primary);" placeholder="My Physics Notes" value="Untitled Notebook">
                    </div>
                    <div class="mock-config-group">
                        <label class="mock-config-label">Paper Template Style</label>
                        <select id="notebookPaperStyleInput" class="mock-paper-btn" style="width: 100%; padding: 0.6rem; background: var(--bg-elevated); border: 1px solid var(--border-light); color: var(--text-primary); border-radius: var(--radius-md);">
                            <option value="grid-paper">Graph / Grid Paper</option>
                            <option value="ruled-paper">Ruled Lines Paper</option>
                            <option value="solid-paper">Solid Blank Paper</option>
                        </select>
                    </div>
                    <button class="primary-btn" id="confirmCreateNotebookBtn" style="width: 100%; padding: 0.75rem; font-weight: 700; border-radius: var(--radius-md); background: var(--accent);">Create & Open Editor</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#closeNewModalBtn').addEventListener('click', () => modal.remove());
        modal.querySelector('#confirmCreateNotebookBtn').addEventListener('click', () => {
            const title = modal.querySelector('#notebookTitleInput').value.trim() || 'Untitled Notebook';
            const style = modal.querySelector('#notebookPaperStyleInput').value;
            modal.remove();

            const notebook = {
                id: 'notebook_' + Date.now(),
                title: title,
                pdfPath: null,
                lastModified: new Date().toISOString(),
                pages: [
                    {
                        pageNumber: 1,
                        isPdfPage: false,
                        styleClass: style,
                        strokes: [],
                        texts: []
                    }
                ]
            };
            saveNotebook(notebook);
            window.AtomWorkspace.openNotebook(notebook);
        });
    }

    // --- Notebook Editor Engine ---
    let currentPdfDoc = null;

    async function initializeEditor(notebook) {
        const viewport = document.getElementById('atomViewport');
        const list = document.getElementById('atomThumbnailsList');
        if (!viewport || !list) return;

        viewport.innerHTML = '<div style="color: var(--text-muted); font-size: var(--text-sm);">Loading Atom canvas layer...</div>';
        list.innerHTML = '';
        currentPdfDoc = null;
        undoStack = [];
        redoStack = [];

        // If it's a PDF templates paper, load and parse it using pdfjs
        if (notebook.pdfPath) {
            try {
                const resolvedPdfPath = window.resolveStudyIBContentUrl
                    ? window.resolveStudyIBContentUrl(notebook.pdfPath)
                    : notebook.pdfPath;
                const loadingTask = pdfjsLib.getDocument(resolvedPdfPath);
                currentPdfDoc = await loadingTask.promise;
                
                // If pages array is empty or contains no PDF pages, initialize them
                const hasPdfPages = notebook.pages.some(p => p.isPdfPage);
                if (notebook.pages.length === 0 || !hasPdfPages) {
                    notebook.pages = [];
                    for (let i = 1; i <= currentPdfDoc.numPages; i++) {
                        notebook.pages.push({
                            pageNumber: i,
                            isPdfPage: true,
                            pdfPageIdx: i,
                            styleClass: 'solid-paper',
                            strokes: [],
                            texts: []
                        });
                    }
                    saveNotebook(notebook);
                }
            } catch (err) {
                console.error("Failed to load template PDF document:", err);
                alert("Failed to load PDF in Atom:\n" + err.message);
            }
        }

        await renderEditorPages(notebook);
    }

    async function renderEditorPages(notebook) {
        const viewport = document.getElementById('atomViewport');
        const list = document.getElementById('atomThumbnailsList');
        if (!viewport || !list) return;

        viewport.innerHTML = '';
        list.innerHTML = '';

        for (let index = 0; index < notebook.pages.length; index++) {
            const page = notebook.pages[index];
            const idx = index + 1;
            
            let pageWidth = 816;   // standard US Letter / A4 approx at 96 DPI
            let pageHeight = 1056;

            if (page.isPdfPage && currentPdfDoc) {
                try {
                    const pdfPage = await currentPdfDoc.getPage(page.pdfPageIdx);
                    const baseVP = pdfPage.getViewport({ scale: 1 });
                    // Fit to our default width, preserving aspect ratio
                    const fitScale = pageWidth / baseVP.width;
                    pageWidth = Math.round(baseVP.width * fitScale);
                    pageHeight = Math.round(baseVP.height * fitScale);
                } catch (err) {
                    console.error("Failed to get pdf page size:", err);
                }
            }

            // 1. Create page container card
            const card = document.createElement('div');
            card.className = `atom-page-card ${page.styleClass}`;
            card.id = `atomPageCard_${idx}`;
            card.setAttribute('data-page-index', index);
            card.style.width = `${pageWidth}px`;
            card.style.height = `${pageHeight}px`;

            // 2. Render layer for PDF page template
            if (page.isPdfPage && currentPdfDoc) {
                const pdfCanvas = document.createElement('canvas');
                pdfCanvas.className = 'atom-pdf-render-layer';
                card.appendChild(pdfCanvas);
                // Fire-and-forget — canvas is in DOM and will paint when ready
                renderPDFTemplatePage(page.pdfPageIdx, pdfCanvas, pageWidth, pageHeight);
            }

            // 3. Overlaid drawing canvas
            const annotCanvas = document.createElement('canvas');
            annotCanvas.className = 'atom-annotation-layer';
            annotCanvas.width = pageWidth * 2; // 2x coordinate scaling for retina-like precision
            annotCanvas.height = pageHeight * 2;
            annotCanvas.style.width = `${pageWidth}px`;
            annotCanvas.style.height = `${pageHeight}px`;
            card.appendChild(annotCanvas);

            // 4. Overlaid text box overlay layer
            const textOverlay = document.createElement('div');
            textOverlay.style.position = 'absolute';
            textOverlay.style.top = '0';
            textOverlay.style.left = '0';
            textOverlay.style.width = '100%';
            textOverlay.style.height = '100%';
            textOverlay.style.zIndex = '3';
            textOverlay.style.pointerEvents = 'none'; // Click-through so pen still draws
            textOverlay.className = 'atom-text-overlay-layer';
            card.appendChild(textOverlay);

            // Render existing text boxes
            if (page.texts) {
                page.texts.forEach(item => {
                    spawnTextNode(textOverlay, page, item);
                });
            }

            // 5. Page meta actions
            const meta = document.createElement('div');
            meta.className = 'atom-page-meta';
            meta.innerHTML = `
                <span>Page ${idx} of ${notebook.pages.length}</span>
                <button class="atom-page-delete-btn" data-idx="${index}">Delete Page</button>
            `;
            card.appendChild(meta);
            
            meta.querySelector('.atom-page-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (notebook.pages.length === 1) {
                    alert("A notebook must contain at least one page!");
                    return;
                }
                if (confirm(`Are you sure you want to delete Page ${idx}?`)) {
                    notebook.pages.splice(index, 1);
                    // Reindex remaining pages
                    notebook.pages.forEach((p, i) => p.pageNumber = i + 1);
                    saveNotebook(notebook);
                    initializeEditor(notebook);
                }
            });

            viewport.appendChild(card);

            // 6. Hook stroke vector drawing handlers
            attachDrawingHandlers(annotCanvas, page);

            // 7. Add Left sidebar thumbnail items
            const thumb = document.createElement('div');
            thumb.className = 'thumbnail-card';
            thumb.setAttribute('data-target-idx', index);
            thumb.innerHTML = `
                <div class="thumbnail-canvas-container" style="background:#0f172a; display:flex; justify-content:center; align-items:center; overflow:hidden;">
                    <canvas class="thumbnail-page-canvas" id="thumb_canvas_${idx}" style="width:100%; height:100%; object-fit:contain; pointer-events:none;"></canvas>
                </div>
                <div class="thumbnail-num">${idx}</div>
            `;
            thumb.addEventListener('click', () => {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                document.querySelectorAll('.thumbnail-card').forEach(t => t.classList.remove('active'));
                thumb.classList.add('active');
            });
            list.appendChild(thumb);
            
            // Render actual page content onto thumbnail canvas
            const thumbCanvas = thumb.querySelector(`.thumbnail-page-canvas`);
            drawPageThumbnail(thumbCanvas, page, idx);

            // Draw vector strokes initially onto annotation canvas
            redrawPageStrokes(annotCanvas, page);
        }

        // Add page card intersection observer to track active page inside thumbnail view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const idx = entry.target.getAttribute('data-page-index');
                    document.querySelectorAll('.thumbnail-card').forEach((tc, i) => {
                        if (i == idx) tc.classList.add('active');
                        else tc.classList.remove('active');
                    });
                    document.querySelectorAll('.atom-page-card').forEach((pc, i) => {
                        if (i == idx) pc.classList.add('active-page');
                        else pc.classList.remove('active-page');
                    });
                }
            });
        }, { root: viewport, threshold: 0.4 });

        viewport.querySelectorAll('.atom-page-card').forEach(card => observer.observe(card));
    }

    // Render PDF page templates onto background canvas
    async function renderPDFTemplatePage(pageIdx, canvas, containerWidth, containerHeight) {
        if (!currentPdfDoc) return;
        try {
            // Ensure pdfjsLib worker is set
            if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }

            const pdfPage = await currentPdfDoc.getPage(pageIdx);
            const pixelRatio = window.devicePixelRatio || 1;

            // Scale so the PDF page fits exactly inside the container at pixelRatio resolution
            const baseViewport = pdfPage.getViewport({ scale: 1 });
            const scale = (containerWidth / baseViewport.width) * pixelRatio;
            const scaledViewport = pdfPage.getViewport({ scale });

            // Canvas pixel dimensions must exactly match the scaled viewport
            canvas.width = Math.round(scaledViewport.width);
            canvas.height = Math.round(scaledViewport.height);
            canvas.style.width = `${containerWidth}px`;
            canvas.style.height = `${containerHeight}px`;
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.zIndex = '1';

            const renderContext = {
                canvasContext: canvas.getContext('2d'),
                viewport: scaledViewport
            };
            await pdfPage.render(renderContext).promise;
        } catch (err) {
            console.error(`Failed to render PDF page ${pageIdx} onto template canvas:`, err);
        }
    }

    // --- Vector Drawing & Eraser Core ---
    function attachDrawingHandlers(canvas, pageData) {
        const ctx = canvas.getContext('2d');
        let activeStroke = null;
        let isDrawing = false;

        const getCoords = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
            // Map coordinates relative to standard coordinate width/height of this page
            const x = ((clientX - rect.left) / rect.width) * canvas.width;
            const y = ((clientY - rect.top) / rect.height) * canvas.height;
            return { x, y };
        };

        canvas.addEventListener('mousedown', (e) => {
            if (activeTool === 'pan') return;
            const coords = getCoords(e);

            if (activeTool === 'text') {
                const textOverlay = canvas.parentElement.querySelector('.atom-text-overlay-layer');
                const relativeX = (e.clientX - canvas.getBoundingClientRect().left);
                const relativeY = (e.clientY - canvas.getBoundingClientRect().top);
                const item = { text: '', x: relativeX, y: relativeY, fontSize: 16 };
                pageData.texts.push(item);
                spawnTextNode(textOverlay, pageData, item, true);
                return;
            }

            if (activeTool === 'eraser') {
                eraseStrokesAtCoords(coords.x, coords.y, pageData, canvas);
                return;
            }

            isDrawing = true;
            activeStroke = {
                color: strokeColor,
                width: strokeWidth * (activeTool === 'highlighter' ? 4 : 1),
                isHighlight: activeTool === 'highlighter',
                points: [{ x: coords.x, y: coords.y }]
            };

            // Save history for Undo
            saveUndoState(pageData);

            ctx.beginPath();
            ctx.moveTo(coords.x, coords.y);
            
            // Set styles
            configureCtxStyles(ctx, activeStroke);
        });

        canvas.addEventListener('mousemove', (e) => {
            const coords = getCoords(e);

            if (activeTool === 'eraser' && (e.buttons === 1)) {
                eraseStrokesAtCoords(coords.x, coords.y, pageData, canvas);
                return;
            }

            if (!isDrawing || !activeStroke) return;

            activeStroke.points.push({ x: coords.x, y: coords.y });

            // Draw line segment
            ctx.lineTo(coords.x, coords.y);
            ctx.stroke();
        });

        const finishStroke = () => {
            if (isDrawing && activeStroke) {
                pageData.strokes.push(activeStroke);
                activeStroke = null;
                isDrawing = false;
                saveNotebook(activeNotebook);

                // Redraw thumbnail
                const pageIdx = activeNotebook.pages.indexOf(pageData) + 1;
                const thumbCanvas = document.getElementById(`thumb_canvas_${pageIdx}`);
                if (thumbCanvas) drawPageThumbnail(thumbCanvas, pageData, pageIdx);
            }
        };

        canvas.addEventListener('mouseup', finishStroke);
        canvas.addEventListener('mouseleave', finishStroke);

        // --- Touch Listeners for Apple Pencil / Finger Draw on iOS ---
        canvas.addEventListener('touchstart', (e) => {
            if (activeTool === 'pan') return;
            e.preventDefault(); // Stop scrolling/bouncing on iOS while sketching
            const coords = getCoords(e);

            if (activeTool === 'text') {
                const textOverlay = canvas.parentElement.querySelector('.atom-text-overlay-layer');
                const clientX = e.touches[0].clientX;
                const clientY = e.touches[0].clientY;
                const relativeX = (clientX - canvas.getBoundingClientRect().left);
                const relativeY = (clientY - canvas.getBoundingClientRect().top);
                const item = { text: '', x: relativeX, y: relativeY, fontSize: 16 };
                pageData.texts.push(item);
                spawnTextNode(textOverlay, pageData, item, true);
                return;
            }

            if (activeTool === 'eraser') {
                eraseStrokesAtCoords(coords.x, coords.y, pageData, canvas);
                return;
            }

            isDrawing = true;
            activeStroke = {
                color: strokeColor,
                width: strokeWidth * (activeTool === 'highlighter' ? 4 : 1),
                isHighlight: activeTool === 'highlighter',
                points: [{ x: coords.x, y: coords.y }]
            };

            saveUndoState(pageData);

            ctx.beginPath();
            ctx.moveTo(coords.x, coords.y);
            configureCtxStyles(ctx, activeStroke);
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            if (activeTool === 'pan') return;
            e.preventDefault();
            const coords = getCoords(e);

            if (activeTool === 'eraser') {
                eraseStrokesAtCoords(coords.x, coords.y, pageData, canvas);
                return;
            }

            if (!isDrawing || !activeStroke) return;

            activeStroke.points.push({ x: coords.x, y: coords.y });
            ctx.lineTo(coords.x, coords.y);
            ctx.stroke();
        }, { passive: false });

        canvas.addEventListener('touchend', (e) => {
            if (activeTool === 'pan') return;
            e.preventDefault();
            finishStroke();
        }, { passive: false });

        canvas.addEventListener('touchcancel', (e) => {
            if (activeTool === 'pan') return;
            finishStroke();
        });
    }

    function configureCtxStyles(ctx, stroke) {
        if (stroke.isHighlight) {
            ctx.globalCompositeOperation = 'multiply';
            ctx.strokeStyle = stroke.color.startsWith('#') ? hexToRgbA(stroke.color, 0.45) : stroke.color;
            ctx.lineCap = 'square';
            ctx.lineJoin = 'miter';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = stroke.color;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        }
        ctx.lineWidth = stroke.width;
    }

    function hexToRgbA(hex, opacity) {
        let c;
        if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
            c = hex.substring(1).split('');
            if (c.length == 3) {
                c = [c[0], c[0], c[1], c[1], c[2], c[2]];
            }
            c = '0x' + c.join('');
            return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + opacity + ')';
        }
        return hex;
    }

    function redrawPageStrokes(canvas, pageData) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        pageData.strokes.forEach(stroke => {
            if (stroke.points.length < 1) return;
            ctx.beginPath();
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            
            configureCtxStyles(ctx, stroke);

            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
        });
    }

    // Vector Eraser stroke proximity detector
    function eraseStrokesAtCoords(x, y, pageData, canvas) {
        const threshold = 35; // px distance threshold
        let erased = false;

        const newStrokes = pageData.strokes.filter(stroke => {
            // Check if click/hover is close to any coordinate point in the stroke vector
            const isNear = stroke.points.some(pt => {
                const dist = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
                return dist < threshold;
            });
            if (isNear) {
                erased = true;
                // Add undo state before erasing
                saveUndoState(pageData);
                return false;
            }
            return true;
        });

        if (erased) {
            pageData.strokes = newStrokes;
            redrawPageStrokes(canvas, pageData);
            saveNotebook(activeNotebook);

            // Redraw thumbnail
            const pageIdx = activeNotebook.pages.indexOf(pageData) + 1;
            const thumbCanvas = document.getElementById(`thumb_canvas_${pageIdx}`);
            if (thumbCanvas) drawPageThumbnail(thumbCanvas, pageData, pageIdx);
        }
    }

    // --- Overlay Text Boxes Generator ---
    function spawnTextNode(overlay, pageData, item, focusOnCreation = false) {
        const box = document.createElement('div');
        box.className = 'atom-text-annotation';
        box.contentEditable = true;
        box.style.left = `${item.x}px`;
        box.style.top = `${item.y}px`;
        box.style.fontSize = `${item.fontSize}px`;
        box.style.pointerEvents = 'auto'; // Re-enable pointer events for typing
        box.innerHTML = item.text;
        
        overlay.appendChild(box);

        if (focusOnCreation) {
            box.focus();
        }

        // Save text back into structure on blur or typing
        const syncText = () => {
            item.text = box.innerHTML;
            saveNotebook(activeNotebook);
        };

        box.addEventListener('blur', () => {
            syncText();
            // Clean up text box if left completely empty
            if (box.textContent.trim() === '') {
                box.remove();
                pageData.texts = pageData.texts.filter(t => t !== item);
                saveNotebook(activeNotebook);
            }
        });

        box.addEventListener('input', syncText);
    }

    // Add new page to notebook card arrays
    function addNewPage(notebook, styleClass) {
        const nextNum = notebook.pages.length + 1;
        notebook.pages.push({
            pageNumber: nextNum,
            isPdfPage: false,
            styleClass: styleClass || 'grid-paper',
            strokes: [],
            texts: []
        });
        saveNotebook(notebook);
        renderEditorPages(notebook);

        // Scroll immediately to newly created page
        setTimeout(() => {
            const card = document.getElementById(`atomPageCard_${nextNum}`);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }

    // --- Cursor Layout Management ---
    function updateCanvasCursors() {
        document.querySelectorAll('.atom-annotation-layer').forEach(canvas => {
            canvas.className = 'atom-annotation-layer';
            if (activeTool === 'pan') canvas.classList.add('cursor-pan');
            if (activeTool === 'text') canvas.classList.add('cursor-text');
        });
    }

    // --- Vector Undo Stack ---
    function saveUndoState(pageData) {
        // Deep copy strokes
        const strokesCopy = JSON.parse(JSON.stringify(pageData.strokes));
        undoStack.push({
            page: pageData,
            strokes: strokesCopy
        });
        if (undoStack.length > 30) undoStack.shift();
    }

    function triggerUndo() {
        if (undoStack.length === 0) return;
        const state = undoStack.pop();
        
        // Restore strokes
        state.page.strokes = state.strokes;
        
        // Find canvas element and redraw
        document.querySelectorAll('.atom-page-card').forEach((card, index) => {
            if (activeNotebook.pages[index] === state.page) {
                const canvas = card.querySelector('.atom-annotation-layer');
                if (canvas) redrawPageStrokes(canvas, state.page);

                // Redraw thumbnail
                const pageIdx = index + 1;
                const thumbCanvas = document.getElementById(`thumb_canvas_${pageIdx}`);
                if (thumbCanvas) drawPageThumbnail(thumbCanvas, state.page, pageIdx);
            }
        });
        saveNotebook(activeNotebook);
    }
})();
