document.addEventListener('DOMContentLoaded', () => {
    // Shared read-only dataset access for standalone browser tools such as the worksheet generator.
    window.StudyIBTopicQuestionData = topicQuestionPracticeData;
    // --- Node Filesystem Integration ---
    let fs = null;
    let path = null;
    try {
        fs = require('fs');
        path = require('path');
    } catch (e) {
        console.warn("Node filesystem modules not available. Using offline static mocks.");
    }

    // --- State ---
    let currentSubject = 'physics';
    window.currentStudyIBSubject = currentSubject;
    let currentMode = 'topics'; // 'topics' or 'papers' or 'practice' or 'textbooks'
    let activeCategory = null; // Either a Topic name or a Year or a Textbook name
    let timerInterval = null;
    let timerSeconds = 0;
    let isTimerRunning = false;
    let currentPdfUrl = '';
    let currentMsUrl = '';
    let practiceFilter = 'all'; // 'all', 'P1', 'P2'
    let userAccentColor = localStorage.getItem('color') || 'indigo'; // Preserve Physics custom accent
    let completedQuestions = JSON.parse(localStorage.getItem('science_qbank_completed_questions') || '[]');
    let activeView = 'home'; // 'home' or 'subject'

    // Mobile navigation uses real browser history so the OS/browser Back gesture works.
    const isMobileUI = () => window.matchMedia('(max-width: 768px)').matches;
    let handlingMobileHistoryPop = false;

    function pushMobileHistoryState(view) {
        if (!isMobileUI() || handlingMobileHistoryPop) return;
        if (history.state && history.state.studyIBView === view) return;
        history.pushState({ ...(history.state || {}), studyIBView: view }, '', window.location.href);
    }

    if (!history.state || !history.state.studyIBView) {
        history.replaceState({ ...(history.state || {}), studyIBView: 'list' }, '', window.location.href);
    }

    window.StudyIBMobileNavigation = {
        enter(view) {
            pushMobileHistoryState(view);
        },
        back() {
            if (!isMobileUI() || !history.state || history.state.studyIBView === 'list') return false;
            history.back();
            return true;
        }
    };

    // --- PDF Scroll and Zoom State Restorer ---
    let pdfScrollPositions = JSON.parse(localStorage.getItem('science_qbank_pdf_scroll_positions') || '{}');

    // --- SRS (Spaced Repetition System) State ---
    let srsData = JSON.parse(localStorage.getItem('science_qbank_srs_data') || '{}');
    // Structure: { [filepath]: { difficulty, lastReviewed, nextReview, interval, reviewCount } }

    // Cramming-optimized SRS intervals (in hours)
    const SRS_INTERVALS = {
        easy:   [48, 96, 192, 384, 768],     // 2d → 4d → 8d → 16d → 32d
        medium: [24, 72, 168, 336],           // 1d → 3d → 7d → 14d
        hard:   [4, 24, 48, 72, 120, 168]     // 4h → 1d → 2d → 3d → 5d → 7d
    };

    // --- Mock Exam State ---
    let mockState = {
        active: false,
        questions: [],
        currentIndex: 0,
        completedCount: 0,
        timeRemaining: 0,
        totalTime: 0,
        timerInterval: null,
        paperType: 'P1'
        ,clientEventId: null
        ,startedAt: null
    };

    // IB HL Topic Priority Weights (higher = more questions drawn)
    const IB_HL_TOPIC_WEIGHTS = {
        'A.2 Forces and Momentum': 5,
        'A.1 Kinematics': 5,
        'A.3 Work, Energy and Power': 5,
        'D.2 Electric and Magnetic Fields': 5,
        'D.1 Gravitational Fields': 4,
        'E.3 Radioactive Decay': 4,
        'C.3 Wave Phenomena': 4,
        'A.4 Rigid Body Mechanics': 3,
        'A.5 Galilean and Special Relativity': 3,
        'B.1 Thermal Energy Transfers': 3,
        'B.2 Greenhouse Effect': 2,
        'B.3 Gas Laws': 3,
        'B.4 Thermodynamics': 3,
        'B.5 Current and Circuits': 3,
        'C.1 Simple Harmonic Motion': 3,
        'C.2 Wave Model': 2,
        'C.4 Standing Waves and Resonance': 2,
        'C.5 Doppler Effect': 2,
        'D.3 Motion in Electromagnetic Fields': 3,
        'D.4 Induction': 2,
        'E.1 Structure of the Atom': 3,
        'E.2 Quantum Physics': 3,
        'E.4 Fission': 3,
        'E.5 Fusion and Stars': 3
    };
    // Default weight for topics not in the map
    const DEFAULT_TOPIC_WEIGHT = 2;

    // Challenge state variables
    let blitzState = {
        active: false,
        questions: [],
        currentIndex: 0,
        completedCount: 0,
        timeRemaining: 180,
        timerInterval: null
    };
    let activeDailyChallengeFile = null;

    const subjectConfigs = {
        physics: {
            label: 'Physics HL',
            icon: 'physics',
            sidebarId: 'sidebarSubPhysics',
            syllabus: () => topicQuestionSyllabusData.physics,
            papers: () => fullPapersData,
            practice: () => topicQuestionPracticeData.physics
        },
        chemistry: {
            label: 'Chemistry HL',
            icon: 'chemistry',
            sidebarId: 'sidebarSubChem',
            syllabus: () => topicQuestionSyllabusData.chemistry,
            papers: () => chemistryFullPapersData,
            practice: () => topicQuestionPracticeData.chemistry
        },
        biology: {
            label: 'Biology HL',
            icon: 'biology',
            sidebarId: 'sidebarSubBiology',
            syllabus: () => topicQuestionSyllabusData.biology,
            papers: () => biologyFullPapersData,
            practice: () => topicQuestionPracticeData.biology
        },
        math: {
            label: 'Math AA HL',
            icon: 'math',
            sidebarId: 'sidebarSubMath',
            syllabus: () => topicQuestionSyllabusData.math,
            papers: () => mathFullPapersData,
            practice: () => topicQuestionPracticeData.math
        },
        math_ai: {
            label: 'Math AI HL',
            icon: 'math_ai',
            sidebarId: 'sidebarSubMathAi',
            syllabus: () => topicQuestionSyllabusData.math_ai,
            papers: () => additionalSubjectFullPapersData.math_ai,
            practice: () => topicQuestionPracticeData.math_ai
        },
        economics: {
            label: 'Economics HL',
            icon: 'economics',
            sidebarId: 'sidebarSubEconomics',
            syllabus: () => topicQuestionSyllabusData.economics,
            papers: () => additionalSubjectFullPapersData.economics,
            practice: () => topicQuestionPracticeData.economics
        },
        business: {
            label: 'Business Management HL',
            icon: 'business',
            sidebarId: 'sidebarSubBusiness',
            syllabus: () => topicQuestionSyllabusData.business,
            papers: () => additionalSubjectFullPapersData.business,
            practice: () => topicQuestionPracticeData.business
        }
    };

    const TOPIC_QUESTION_PROGRESS_KEY = 'science_qbank_topic_question_progress';
    const topicQuestionIndex = new Map();
    const topicQuestionSubjects = {};

    Object.entries(subjectConfigs).forEach(([subjectId, config]) => {
        const subjectQuestionIds = new Set();
        const practiceData = config.practice() || {};

        Object.values(practiceData).forEach(subtopics => {
            Object.values(subtopics || {}).forEach(questions => {
                (questions || []).forEach(question => {
                    const filepath = question.filepath || question.qp_path;
                    if (!filepath) return;
                    subjectQuestionIds.add(filepath);
                    if (!topicQuestionIndex.has(filepath)) {
                        topicQuestionIndex.set(filepath, { ...question, subject: subjectId });
                    }
                });
            });
        });

        topicQuestionSubjects[subjectId] = subjectQuestionIds;
    });

    function loadTopicQuestionProgress() {
        let savedProgress = null;
        try {
            savedProgress = JSON.parse(localStorage.getItem(TOPIC_QUESTION_PROGRESS_KEY) || 'null');
        } catch (error) {
            console.warn('Unable to read topic-question progress; rebuilding it from valid legacy entries.', error);
        }

        const candidates = [
            ...(Array.isArray(savedProgress && savedProgress.completed) ? savedProgress.completed : []),
            ...completedQuestions
        ];
        const completed = [...new Set(candidates.filter(filepath => topicQuestionIndex.has(filepath)))];
        const progress = {
            datasetVersion: topicQuestionBankMetadata.version,
            completed,
            migratedAt: savedProgress && savedProgress.datasetVersion === topicQuestionBankMetadata.version
                ? savedProgress.migratedAt
                : new Date().toISOString()
        };

        localStorage.setItem(TOPIC_QUESTION_PROGRESS_KEY, JSON.stringify(progress));
        return new Set(completed);
    }

    const completedTopicQuestions = loadTopicQuestionProgress();

    window.addEventListener('studyib:account-snapshot', event => {
        const cloudQuestions = event.detail?.snapshot?.question_progress || [];
        completedTopicQuestions.clear();
        cloudQuestions.filter(item => item.completed_at && topicQuestionIndex.has(item.question_id)).forEach(item => completedTopicQuestions.add(item.question_id));
        saveTopicQuestionProgress();
        if (activeView === 'home') renderDashboard();
    });

    function saveTopicQuestionProgress() {
        let migratedAt = new Date().toISOString();
        try {
            migratedAt = JSON.parse(localStorage.getItem(TOPIC_QUESTION_PROGRESS_KEY) || '{}').migratedAt || migratedAt;
        } catch (error) {
            console.warn('Unable to preserve the topic-question migration timestamp.', error);
        }
        localStorage.setItem(TOPIC_QUESTION_PROGRESS_KEY, JSON.stringify({
            datasetVersion: topicQuestionBankMetadata.version,
            completed: [...completedTopicQuestions],
            migratedAt,
            updatedAt: new Date().toISOString()
        }));
    }

    function isCurrentTopicQuestion(filepath) {
        return topicQuestionIndex.has(filepath);
    }

    function getQuestionReward(filepath) {
        const question = topicQuestionIndex.get(filepath);
        const isPaperOne = question
            ? question.paper_type === 'P1'
            : filepath.toLowerCase().includes('paper_1') || filepath.toLowerCase().includes('paper 1');
        return isPaperOne
            ? { xp: 10, completedReason: 'Solved Paper 1 question', removedReason: 'Uncompleted Paper 1 question' }
            : { xp: 50, completedReason: 'Completed structured question', removedReason: 'Uncompleted structured question' };
    }

    function setStoredQuestionCompletion(filepath, completed) {
        if (isCurrentTopicQuestion(filepath)) {
            if (completed) completedTopicQuestions.add(filepath);
            else completedTopicQuestions.delete(filepath);
            saveTopicQuestionProgress();
            if (window.studyIBAccount?.signedIn) {
                const subject = topicQuestionIndex.get(filepath)?.subject || currentSubject;
                window.studyIBAccount.setQuestionCompletion(filepath, subject, completed)
                    .catch(error => showNotification(error.message || 'Progress will sync when you are back online.', 'error'));
            }
            return;
        }

        const index = completedQuestions.indexOf(filepath);
        if (completed && index === -1) completedQuestions.push(filepath);
        if (!completed && index > -1) completedQuestions.splice(index, 1);
        localStorage.setItem('science_qbank_completed_questions', JSON.stringify(completedQuestions));
    }

    function getSubjectConfig(subjectId = currentSubject) {
        return subjectConfigs[subjectId] || subjectConfigs.physics;
    }

    // Helpers to get subject-specific data
    function getSyllabusData() {
        return getSubjectConfig().syllabus();
    }

    function getFullPapersData() {
        return getSubjectConfig().papers();
    }

    function getPracticeData() {
        return getSubjectConfig().practice();
    }

    function getSubjectLabel() {
        return getSubjectConfig().label;
    }

    function subjectHasQuestionLevelContent() {
        return Object.keys(getPracticeData()).length > 0;
    }
    
    // --- DOM Elements ---
    const htmlRoot = document.documentElement;
    const navMenu = document.getElementById('navMenu');
    const papersGrid = document.getElementById('papersGrid');
    const currentCategoryTitle = document.getElementById('currentCategoryTitle');
    const categoryStats = document.getElementById('categoryStats');
    const searchInput = document.getElementById('searchInput');
    const modeBtns = document.querySelectorAll('.mode-btn');

    function showContentHeader() {
        const header = document.querySelector('.content-header');
        if (header) header.style.display = '';
        papersGrid.classList.remove('no-grid');
        if (mainContentArea) mainContentArea.classList.remove('mobile-home-view');
    }
    function hideContentHeader() {
        const header = document.querySelector('.content-header');
        if (header) header.style.display = 'none';
        papersGrid.classList.add('no-grid');
        if (mainContentArea) mainContentArea.classList.add('mobile-home-view');
    }

    function navigateSubjectBack() {
        activeCategory = null;
        if (activeView === 'subject') {
            renderDashboard();
        } else {
            renderDojoHome();
        }
    }

    function renderSubjectModeBar(activeMode) {
        const bar = document.getElementById('subjectModeBar');
        if (!bar) return;
        const selectedMode = activeMode === 'papers' ? 'papers' : activeMode === 'topics' ? 'topics' : 'syllabus';
        bar.innerHTML = `
            <button type="button" class="subject-back-btn" id="subjectBackBtn" aria-label="Back to subject overview">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg>
                <span>Back</span>
            </button>
            <div class="workspace-logo subject-mode-logo" title="${getSubjectLabel()}">
                ${getWorkspaceIcon(getSubjectConfig().icon)}
                <span>${getSubjectLabel()}</span>
            </div>
            <nav class="workspace-menu" aria-label="Subject tools">
                <button type="button" class="workspace-nav-item${selectedMode === 'syllabus' ? ' is-active' : ''}" data-subject-mode="syllabus" ${selectedMode === 'syllabus' ? 'aria-current="page"' : ''}>${getWorkspaceIcon('syllabus')}<span>Syllabus</span></button>
                <button type="button" class="workspace-nav-item${selectedMode === 'topics' ? ' is-active' : ''}" data-subject-mode="topics" ${selectedMode === 'topics' ? 'aria-current="page"' : ''}>${getWorkspaceIcon('topics')}<span>Topical</span></button>
                <button type="button" class="workspace-nav-item${selectedMode === 'papers' ? ' is-active' : ''}" data-subject-mode="papers" ${selectedMode === 'papers' ? 'aria-current="page"' : ''}>${getWorkspaceIcon('papers')}<span>Papers</span></button>
            </nav>
        `;
        document.getElementById('subjectBackBtn')?.addEventListener('click', navigateSubjectBack);
        bar.querySelector('[data-subject-mode="syllabus"]')?.addEventListener('click', renderDashboard);
        bar.querySelector('[data-subject-mode="topics"]')?.addEventListener('click', () => {
            switchMode('topics');
            renderTopicsList();
        });
        bar.querySelector('[data-subject-mode="papers"]')?.addEventListener('click', () => {
            switchMode('papers');
            renderPapersList();
        });
    }

    function sortCategories(keys) {
        return keys.sort((a, b) => {
            const aSpecial = a.toLowerCase().includes('option') || a.toLowerCase().includes('skill') || a.toLowerCase().includes('paper 3');
            const bSpecial = b.toLowerCase().includes('option') || b.toLowerCase().includes('skill') || b.toLowerCase().includes('paper 3');
            if (aSpecial && !bSpecial) return 1;
            if (!aSpecial && bSpecial) return -1;
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });
    }
    
    // Viewer
    const mainContentArea = document.getElementById('mainContentArea');
    const pdfIframe = document.getElementById('pdfIframe');
    const viewerTitle = document.getElementById('viewerTitle');
    const closeViewerBtn = document.getElementById('closeViewerBtn');
    const mobileViewerBackBtn = document.getElementById('mobileViewerBackBtn');
    const launchAtomBtn = document.getElementById('launchAtomBtn');
    const markschemeToggle = document.getElementById('markschemeToggle');
    const completeToggle = document.getElementById('completeToggle');
    const pdfContainer = document.getElementById('pdfContainer');
    const zoomDisplay = document.getElementById('zoomDisplay');
    let currentPdfDoc = null;
    let currentScale = 1.25;
    let preferredPdfScale = 1.25;
    let lastSuccessfulPdfScale = 1.25;
    let viewerResizeTimer = null;
    let currentRenderId = 0;
    const activePdfRenderTasks = new Set();
    let pdfPageObserver = null;
    
    let lastListViewState = null;
    function saveListViewState() {
        lastListViewState = {
            activeView: activeView,
            activeCategory: activeCategory,
            currentMode: currentMode,
            isReviewQueue: (currentCategoryTitle && currentCategoryTitle.textContent === 'Review Queue')
        };
    }
    
    // Settings
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const colorBtns = document.querySelectorAll('.color-btn');
    
    // Timer
    const examTimer = document.getElementById('examTimer');
    const timerDisplay = document.getElementById('timerDisplay');
    const timerInput = document.getElementById('timerInput');
    const startTimerBtn = document.getElementById('startTimerBtn');
    const timerPlayPause = document.getElementById('timerPlayPause');
    const timerStop = document.getElementById('timerStop');

    // --- Boot ---
    loadPreferences();
    initDojoLayout();
    renderDojoHome();

    // --- AOS Init ---
    if (typeof AOS !== 'undefined') {
        AOS.init({ duration: 400, easing: 'ease-out-cubic', once: true, offset: 30 });
    }
    function refreshAOS() {
        if (typeof AOS !== 'undefined') AOS.refresh();
    }

    // --- Preferences (Settings) ---
    function loadPreferences() {
        const color = localStorage.getItem('color') || 'indigo';
        userAccentColor = color;

        const appearance = localStorage.getItem('theme') || 'dark';
        const resolvedTheme = appearance === 'system'
            ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
            : appearance;
        htmlRoot.setAttribute('data-theme', resolvedTheme === 'light' ? 'light' : 'dark');
        htmlRoot.setAttribute('data-appearance', appearance);
        htmlRoot.setAttribute('data-color', currentSubject);
        
        colorBtns.forEach(btn => {
            const isActive = btn.getAttribute('data-color') === color;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', String(isActive));
        });
    }

    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.getAttribute('data-color');
            if (currentSubject === 'physics') {
                htmlRoot.setAttribute('data-color', color);
                localStorage.setItem('color', color);
                userAccentColor = color;
            } else {
                // Preserve the user's preferred custom accent for Physics while
                // keeping the current subject's identity colour active.
                localStorage.setItem('color', color);
                userAccentColor = color;
            }
            colorBtns.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-checked', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-checked', 'true');
        });
    });

    if (settingsBtn && settingsModal) settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
    if (closeSettingsBtn && settingsModal) closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    if (settingsModal) settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) settingsModal.classList.add('hidden');
    });

    // Shared keyboard and focus handling for every static application dialog.
    const dialogReturnFocus = new WeakMap();
    const applicationDialogs = [...document.querySelectorAll('[role="dialog"]')];
    const getDialogControls = dialog => [...dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter(control => !control.closest('.hidden'));

    applicationDialogs.forEach(dialog => {
        new MutationObserver(() => {
            if (!dialog.classList.contains('hidden')) {
                dialogReturnFocus.set(dialog, document.activeElement);
                requestAnimationFrame(() => getDialogControls(dialog)[0]?.focus());
            } else {
                const returnTarget = dialogReturnFocus.get(dialog);
                if (returnTarget instanceof HTMLElement && returnTarget.isConnected) returnTarget.focus();
            }
        }).observe(dialog, { attributes: true, attributeFilter: ['class'] });
    });

    document.addEventListener('keydown', event => {
        const openDialog = [...applicationDialogs].reverse().find(dialog => !dialog.classList.contains('hidden'));
        if (!openDialog) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            const closeControl = openDialog.querySelector(
                '[aria-label^="Close"], #closeMockResultsBtn, #closeNewModalBtn'
            );
            if (closeControl) closeControl.click();
            return;
        }

        if (event.key === 'Tab') {
            const controls = getDialogControls(openDialog);
            if (controls.length === 0) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    // --- Mode Switcher ---
    const paperFilter = document.getElementById('paperFilter');
    
    function renderPaperFilter() {
        if (!paperFilter) return;
        const isIB = Object.hasOwn(subjectConfigs, currentSubject);
        let html = '<button type="button" class="filter-btn active" data-filter="all">All</button>';
        
        if (isIB) {
            html += `
                <button type="button" class="filter-btn" data-filter="P1">Paper 1</button>
                <button type="button" class="filter-btn" data-filter="P2">Paper 2</button>
                <button type="button" class="filter-btn" data-filter="P3">Paper 3</button>
            `;
        } else {
            html += `
                <button type="button" class="filter-btn" data-filter="P1">Paper 1</button>
                <button type="button" class="filter-btn" data-filter="P2">Paper 2</button>
                <button type="button" class="filter-btn" data-filter="P4">Paper 4</button>
                <button type="button" class="filter-btn" data-filter="P5">Paper 5</button>
            `;
        }
        
        paperFilter.innerHTML = html;
        
        // Re-attach event listeners to the dynamically created filter buttons
        const filterBtns = paperFilter.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                practiceFilter = btn.getAttribute('data-filter');
                if (currentMode === 'practice' && activeCategory) {
                    renderPracticeCategory(activeCategory);
                }
            });
        });
    }
    
    // Initial render of paper filter buttons
    renderPaperFilter();
    
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.getAttribute('data-mode');
            activeCategory = null; // Reset category selection
            if (searchInput) searchInput.value = ''; // Clear search
            
            // Show/hide paper filter
            if (currentMode === 'practice') {
                paperFilter.classList.remove('hidden');
            } else {
                paperFilter.classList.add('hidden');
            }
            
            initNavigation();
        });
    });

    // --- Breadcrumb Trail Helper ---
    function updateBreadcrumbs(crumbs) {
        const container = document.getElementById('breadcrumb');
        if (!container) return;
        
        let html = `<button type="button" class="breadcrumb-item" data-crumb="dashboard">Dashboard</button>`;
        crumbs.forEach((crumb, idx) => {
            html += ` <svg class="breadcrumb-separator" viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg> `;
            if (idx === crumbs.length - 1) {
                html += `<span class="breadcrumb-current" aria-current="page">${crumb}</span>`;
            } else {
                html += `<button type="button" class="breadcrumb-item" data-crumb="${idx}">${crumb}</button>`;
            }
        });
        container.innerHTML = html;
        
        container.querySelectorAll('[data-crumb]').forEach(el => {
            el.addEventListener('click', () => {
                const val = el.getAttribute('data-crumb');
                if (val === 'dashboard') {
                    activeCategory = null;
                    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
                    const dashNav = document.querySelector('.dashboard-nav-item');
                    if (dashNav) dashNav.classList.add('active');
                    renderDashboard();
                }
            });
        });
    }

    // --- Completed Status Helpers ---
    function isQuestionCompleted(filepath) {
        return isCurrentTopicQuestion(filepath)
            ? completedTopicQuestions.has(filepath)
            : completedQuestions.includes(filepath);
    }
    
    function toggleQuestionCompletion(filepath, subcat = '', isBoss = false) {
        const wasCompleted = isQuestionCompleted(filepath);
        const reward = getQuestionReward(filepath);
        setStoredQuestionCompletion(filepath, !wasCompleted);

        if (wasCompleted) {
            // Deduct XP and DP Points!
            if (window.gamification) {
                if (isBoss) {
                    window.gamification.undefeatBoss(filepath, subcat || "Topic");
                } else {
                    window.gamification.revokeReward(`question:${filepath}`, reward.removedReason);
                }
            }
            // Remove SRS entry
            delete srsData[filepath];
            saveSrsData();
            hideSrsRating();
        } else {
            // Gamification reward triggers
            if (window.gamification) {
                if (isBoss) {
                    window.gamification.defeatBoss(filepath, subcat || "Topic");
                } else {
                    window.gamification.awardRewardOnce(`question:${filepath}`, reward.xp, 0, reward.completedReason);
                }
            }
            // Show SRS difficulty rating prompt
            showSrsRating(filepath);
        }
        
        // Intercept Daily Challenge completion
        if (activeDailyChallengeFile === filepath && isQuestionCompleted(filepath)) {
            const today = new Date();
            const dateStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
            const dailyKey = `completedDailyChallenge_${currentSubject}_${dateStr}`;
            if (localStorage.getItem(dailyKey) !== 'true') {
                localStorage.setItem(dailyKey, 'true');
                if (window.gamification) {
                    window.gamification.awardRewardOnce(`daily:${currentSubject}:${dateStr}`, 50, 15, "Daily Challenge completed!");
                }
                showNotification("🎯 Daily Challenge completed! Earned +50 XP and +15 DP Points!", "success");
                activeDailyChallengeFile = null;
            }
        }
        
        updateCompleteButtonUI(filepath);
        
        if (activeCategory) {
            if (currentMode === 'topics') renderTopicCategory(activeCategory);
            else if (currentMode === 'practice') renderPracticeCategory(activeCategory);
        } else {
            renderDashboard();
        }
    }
    
    function updateCompleteButtonUI(filepath) {
        if (!completeToggle) return;
        if (isQuestionCompleted(filepath)) {
            completeToggle.classList.add('active');
            completeToggle.querySelector('.complete-text').textContent = 'Completed ✓';
        } else {
            completeToggle.classList.remove('active');
            completeToggle.querySelector('.complete-text').textContent = 'Mark as Complete';
        }
    }

    // --- SRS Engine ---
    function saveSrsData() {
        localStorage.setItem('science_qbank_srs_data', JSON.stringify(srsData));
    }

    function showSrsRating(filepath) {
        const group = document.getElementById('srsRatingGroup');
        if (!group) return;
        group.classList.remove('hidden');
        
        // Reset active states
        group.querySelectorAll('.srs-rating-btn').forEach(btn => btn.classList.remove('active'));
        
        // If already rated, highlight current
        if (srsData[filepath]) {
            const current = group.querySelector(`[data-difficulty="${srsData[filepath].difficulty}"]`);
            if (current) current.classList.add('active');
        }

        // Attach one-shot listeners
        group.querySelectorAll('.srs-rating-btn').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => {
                const difficulty = newBtn.getAttribute('data-difficulty');
                rateSrsQuestion(filepath, difficulty);
                group.querySelectorAll('.srs-rating-btn').forEach(b => b.classList.remove('active'));
                newBtn.classList.add('active');
                setTimeout(() => group.classList.add('hidden'), 600);
            });
        });
    }

    function hideSrsRating() {
        const group = document.getElementById('srsRatingGroup');
        if (group) group.classList.add('hidden');
    }

    function rateSrsQuestion(filepath, difficulty) {
        const now = Date.now();
        const existing = srsData[filepath];
        let reviewCount = existing ? existing.reviewCount + 1 : 0;
        const intervals = SRS_INTERVALS[difficulty];
        const intervalIndex = Math.min(reviewCount, intervals.length - 1);
        const intervalHours = intervals[intervalIndex];
        const nextReview = now + (intervalHours * 60 * 60 * 1000);

        srsData[filepath] = {
            difficulty,
            lastReviewed: now,
            nextReview,
            interval: intervalHours,
            reviewCount
        };
        saveSrsData();

        const labels = { easy: '😌 Easy', medium: '🤔 Medium', hard: '😰 Hard' };
        const timeLabels = intervalHours < 24 ? `${intervalHours}h` : `${Math.round(intervalHours/24)}d`;
        showNotification(`${labels[difficulty]} — Next review in ${timeLabels}`, 'info');
    }

    function getDueReviewQuestions() {
        const now = Date.now();
        const due = [];
        for (const [filepath, entry] of Object.entries(srsData)) {
            if (isCurrentTopicQuestion(filepath) && entry.nextReview <= now) {
                due.push({ filepath, ...entry });
            }
        }
        // Sort by most overdue first
        due.sort((a, b) => a.nextReview - b.nextReview);
        return due;
    }

    // --- Navigation Logic ---
    function initNavigation() {
        updateSidebarActiveState();
        if (currentMode === 'topics') {
            renderTopicNavigation();
        } else if (currentMode === 'papers') {
            renderPapersNavigation();
        } else if (currentMode === 'practice') {
            renderPracticeNavigation();
        }
    }

    function initDojoLayout() {
        const sidebarHome = document.getElementById('sidebarHome');
        const sidebarMock = document.getElementById('sidebarMock');
        const sidebarWorksheet = document.getElementById('sidebarWorksheet');
        const sidebarReviews = document.getElementById('sidebarReviews');
        const sidebarAtom = document.getElementById('sidebarAtom');

        if (sidebarHome) {
            sidebarHome.addEventListener('click', () => {
                activeView = 'home';
                renderDojoHome();
            });
        }
        
        const subjectLinks = Object.entries(subjectConfigs).map(([id, config]) => ({
            el: document.getElementById(config.sidebarId),
            id
        }));

        subjectLinks.forEach(link => {
            if (link.el) {
                link.el.addEventListener('click', () => {
                    openSubject(link.id);
                });
            }
        });

        if (sidebarMock) {
            sidebarMock.addEventListener('click', () => {
                openMockGeneratorModal();
            });
        }

        if (sidebarWorksheet) {
            sidebarWorksheet.addEventListener('click', () => {
                window.StudyIBWorksheet?.open?.();
            });
        }

        if (sidebarReviews) {
            sidebarReviews.addEventListener('click', () => {
                closePdfViewer();
                const atomWorkspace = document.getElementById('atomWorkspace');
                const mainContent = document.getElementById('mainContentArea');
                if (atomWorkspace) atomWorkspace.classList.add('hidden');
                if (mainContent) mainContent.classList.remove('hidden');

                activeView = 'subject';
                if (!currentSubject) currentSubject = 'physics';
                renderReviewQueue();
                updateSidebarActiveState();
            });
        }

        if (sidebarAtom) {
            sidebarAtom.addEventListener('click', () => {
                closePdfViewer();
                const atomWorkspace = document.getElementById('atomWorkspace');
                const mainContent = document.getElementById('mainContentArea');
                if (mainContent) mainContent.classList.add('hidden');
                if (atomWorkspace) atomWorkspace.classList.remove('hidden');

                if (window.AtomWorkspace) {
                    window.AtomWorkspace.closeEditor();
                }

                document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => link.classList.remove('active'));
                sidebarAtom.classList.add('active');
                pushMobileHistoryState('atom');
            });
        }
    }

    function updateSidebarActiveState() {
        const navLinks = document.querySelectorAll('.sidebar-nav .nav-link');
        navLinks.forEach(link => link.classList.remove('active'));

        if (activeView === 'home') {
            const homeLink = document.getElementById('sidebarHome');
            if (homeLink) homeLink.classList.add('active');
        } else if (activeView === 'subject') {
            const activeLink = document.getElementById(getSubjectConfig().sidebarId);
            if (activeLink) activeLink.classList.add('active');
        }
    }

    function openSubject(subjectId) {
        closePdfViewer();
        const atomWorkspace = document.getElementById('atomWorkspace');
        const mainContent = document.getElementById('mainContentArea');
        if (atomWorkspace) atomWorkspace.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');

        currentSubject = subjectId;
        window.currentStudyIBSubject = currentSubject;
        activeView = 'subject';
        currentMode = 'topics';
        activeCategory = null;
        if (searchInput) searchInput.value = '';
        practiceFilter = 'all';

        const subjectLabel = getSubjectLabel();
        const brandName = document.getElementById('brandName');
        if (brandName) brandName.textContent = subjectLabel;

        htmlRoot.setAttribute('data-color', currentSubject);

        showContentHeader();
        renderPaperFilter();
        updateSidebarActiveState();
        const hasSyllabus = Object.keys(getSyllabusData() || {}).length > 0;
        if (hasSyllabus || subjectHasQuestionLevelContent()) {
            renderDashboard();
        } else {
            currentMode = 'papers';
            initNavigation();
            renderPapersList();
        }
    }

    function renderDojoHome() {
        closePdfViewer();
        const atomWorkspace = document.getElementById('atomWorkspace');
        const mainContent = document.getElementById('mainContentArea');
        if (atomWorkspace) atomWorkspace.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');

        hideContentHeader();
        activeView = 'home';
        updateSidebarActiveState();

        let savedGamification = {};
        try {
            savedGamification = JSON.parse(localStorage.getItem('science_qbank_gamification_state') || '{}');
        } catch (error) {
            console.warn('Unable to read saved gamification state.', error);
        }
        const gamificationState = window.gamification ? window.gamification.state : savedGamification;
        const streak = Number(gamificationState.streak) || 0;
        const xp = Number(gamificationState.xp) || 0;
        const dp = Number(gamificationState.dpPoints) || 0;

        const buildSubjectProgress = (id, label, data, papers) => {
            const questionIds = topicQuestionSubjects[id] || new Set();
            let topicCount = 0;
            let nextTopic = '';
            let nextCategory = '';
            const searchEntries = [];

            sortCategories(Object.keys(data || {})).forEach(category => {
                const subtopics = data[category] || {};
                Object.entries(subtopics || {}).forEach(([subtopic, files]) => {
                    topicCount += 1;
                    searchEntries.push({ subject: id, subjectLabel: label, category, title: subtopic });
                    (files || []).forEach(file => {
                        const filepath = file.filepath || file.qp_path;
                        if (!filepath) return;
                        if (!isQuestionCompleted(filepath) && !nextTopic) {
                            nextTopic = subtopic;
                            nextCategory = category;
                        }
                    });
                });
            });

            const paperEntries = Object.values(papers || {}).flatMap(sessions => Object.values(sessions || {}).flat());
            const isPaperLibrary = questionIds.size === 0 && paperEntries.length > 0;
            const completed = isPaperLibrary
                ? paperEntries.filter(entry => isQuestionCompleted(entry.qp_path)).length
                : [...questionIds].filter(filepath => completedTopicQuestions.has(filepath)).length;
            const total = isPaperLibrary ? paperEntries.length : questionIds.size;
            const collectionCount = isPaperLibrary ? Object.keys(papers || {}).length : topicCount;
            return {
                id,
                label: label.replace(/\s+(HL|SL)$/i, ''),
                topicCount: collectionCount,
                total,
                completed,
                percent: total > 0 ? Math.round((completed / total) * 100) : 0,
                isPaperLibrary,
                nextTopic,
                nextCategory,
                searchEntries
            };
        };

        const subjectProgress = Object.entries(subjectConfigs).map(([id, config]) =>
            buildSubjectProgress(id, config.label, config.practice(), config.papers())
        );
        const dashboardSearchEntries = subjectProgress.flatMap(subject => subject.searchEntries);

        let dojoHomeHTML = `
            <div class="dojo-top-row app-toolbar">
                <div class="dojo-search-container">
                    <input class="input" type="search" id="dojoSearchInput" placeholder="Search resources…" autocomplete="off" aria-label="Search topics and questions">
                    <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <div class="dojo-search-results hidden" id="dojoSearchResults"></div>
                </div>
                <div class="dojo-user-metrics">
                    <div class="dojo-metric" data-metric="streak" title="Daily streak">
                        <span class="dojo-metric-icon">${getWorkspaceIcon('streak')}</span>
                        <strong id="dojoStreakVal">${streak}</strong>
                    </div>
                    <div class="dojo-metric" data-metric="xp" title="XP earned">
                        <span class="dojo-metric-icon">${getWorkspaceIcon('xp')}</span>
                        <strong id="dojoXpVal">${xp} XP</strong>
                    </div>
                    <div class="dojo-metric" data-metric="dp" title="DP balance">
                        <span class="dojo-metric-icon">${getWorkspaceIcon('dp')}</span>
                        <strong id="dojoDpVal">${dp}</strong>
                    </div>
                </div>
            </div>

            <div class="dojo-dashboard-content">
                <section class="dashboard-subjects-section" aria-labelledby="dashboardSubjectsTitle">
                    <div class="dashboard-subjects-heading">
                        <div>
                            <span class="dashboard-eyebrow">IB subject library</span>
                            <h1 id="dashboardSubjectsTitle">Choose a subject</h1>
                        </div>
                        <span class="dashboard-dataset-status">${topicQuestionBankMetadata.question_count.toLocaleString()} current questions</span>
                    </div>

                    <div class="dashboard-subject-card-grid">
                        ${subjectProgress.map(subject => `
                            <button type="button" class="dashboard-subject-card card" data-dashboard-subject="${subject.id}" aria-label="Open ${subject.label}, ${subject.completed} of ${subject.total} ${subject.isPaperLibrary ? 'papers' : 'questions'} complete">
                                <div class="dashboard-subject-graphic ${subject.id}" aria-hidden="true">
                                    ${getWorkspaceIcon(subject.id)}
                                </div>
                                <div class="dashboard-subject-card-header">
                                    <div>
                                        <span class="dashboard-eyebrow">IB subject</span>
                                        <h2>${subject.label}</h2>
                                    </div>
                                    <span class="dashboard-subject-arrow">${getWorkspaceIcon('arrow')}</span>
                                </div>
                                <div class="dashboard-subject-metrics">
                                    <div><strong>${subject.topicCount.toLocaleString()}</strong><span>${subject.isPaperLibrary ? 'Years' : 'Topics'}</span></div>
                                    <div><strong>${subject.total.toLocaleString()}</strong><span>${subject.isPaperLibrary ? 'Papers' : 'Questions'}</span></div>
                                    <div><strong>${subject.completed.toLocaleString()}</strong><span>Completed</span></div>
                                </div>
                                <div class="dashboard-subject-progress-summary">
                                    <span>${subject.percent}% complete</span>
                                    <span>${subject.completed.toLocaleString()} / ${subject.total.toLocaleString()}</span>
                                </div>
                                <div class="dashboard-progress-track progress" aria-hidden="true">
                                    <span class="progress-bar" style="width:${subject.percent}%"></span>
                                </div>
                            </button>
                        `).join('')}
                    </div>
                </section>
            </div>
        `;

        papersGrid.innerHTML = dojoHomeHTML;

        document.querySelectorAll('[data-dashboard-subject]').forEach(card => {
            card.addEventListener('click', () => openSubject(card.dataset.dashboardSubject));
        });

        const openDashboardTopic = (subject, category, subtopic) => {
            openSubject(subject);
            switchMode('practice');
            renderPracticeCategory(`${category}|||${subtopic}`);
        };

        // Bind global search input inside the home panel
        const dojoSearchInput = document.getElementById('dojoSearchInput');
        const dojoSearchResults = document.getElementById('dojoSearchResults');
        if (dojoSearchInput && dojoSearchResults) {
            let visibleSearchMatches = [];

            const selectSearchResult = (index) => {
                const match = visibleSearchMatches[index];
                if (!match) return;
                openDashboardTopic(match.subject, match.category, match.title);
            };

            dojoSearchInput.addEventListener('input', () => {
                const term = dojoSearchInput.value.toLowerCase().trim();
                if (term.length < 2) {
                    visibleSearchMatches = [];
                    dojoSearchResults.classList.add('hidden');
                    dojoSearchResults.innerHTML = '';
                    return;
                }

                visibleSearchMatches = dashboardSearchEntries.filter(entry => {
                    const searchable = `${entry.title} ${entry.category} ${entry.subjectLabel}`.toLowerCase();
                    return searchable.includes(term);
                }).slice(0, 6);

                if (visibleSearchMatches.length === 0) {
                    dojoSearchResults.innerHTML = '<div class="dojo-search-empty">No matching topics</div>';
                } else {
                    dojoSearchResults.innerHTML = visibleSearchMatches.map((entry, index) => `
                        <button type="button" data-search-index="${index}">
                            <span>${entry.title}</span>
                            <small>${entry.subjectLabel} · ${entry.category}</small>
                        </button>
                    `).join('');
                }
                dojoSearchResults.classList.remove('hidden');

                dojoSearchResults.querySelectorAll('button[data-search-index]').forEach(button => {
                    button.addEventListener('click', () => selectSearchResult(Number(button.dataset.searchIndex)));
                });
            });

            dojoSearchInput.addEventListener('keydown', event => {
                if (event.key === 'Enter' && visibleSearchMatches.length > 0) {
                    event.preventDefault();
                    selectSearchResult(0);
                }
            });
        }
    }

    function renderTopicNavigation() {
        const categories = sortCategories(Object.keys(getSyllabusData()));
        let navHTML = `<button type="button" class="nav-item dashboard-nav-item active" data-dashboard="true">
            <svg class="nav-inline-icon" aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Dashboard
        </button>`;
        if (categories.length > 0) {
            navHTML += `<div class="nav-group">
                <div class="nav-group-title nav-group-title-spaced">Topics</div>
                ${categories.map(key => `<button type="button" class="nav-item" data-category="${key}">${key}</button>`).join('')}
            </div>`;
        }
        if (navMenu) navMenu.innerHTML = navHTML;
        
        attachNavListeners(renderTopicCategory);
        renderDashboard();
    }

    function renderPapersNavigation() {
        const years = Object.keys(getFullPapersData()).sort((a, b) => b - a); // Newest first
        let navHTML = `<button type="button" class="nav-item dashboard-nav-item active" data-dashboard="true">
            <svg class="nav-inline-icon" aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Dashboard
        </button>`;
        if (years.length > 0) {
            navHTML += `<div class="nav-group">
                <div class="nav-group-title nav-group-title-spaced">Years</div>
                ${years.map(year => `<button type="button" class="nav-item" data-category="${year}">${year}</button>`).join('')}
            </div>`;
        }
        
        // Add Save My Exams Mocks and Topics groups
        navHTML += `<div class="nav-group">
            <div class="nav-group-title nav-group-title-spaced">Mock & Topic Papers</div>
            <button type="button" class="nav-item" data-category="Save My Exams Mocks">
                <svg class="nav-inline-icon" aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
                Mock Exams & Predictions
            </button>
            <button type="button" class="nav-item" data-category="Save My Exams Topics">
                <svg class="nav-inline-icon" aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 20V4H20v16H6.5z"></path></svg>
                Topic-Sorted Papers
            </button>
        </div>`;
        
        if (navMenu) navMenu.innerHTML = navHTML;
        
        attachNavListeners(renderPaperCategory);
        renderDashboard();
    }

    function renderPracticeNavigation() {
        const categories = sortCategories(Object.keys(getPracticeData()));
        let navHTML = `<button type="button" class="nav-item dashboard-nav-item active" data-dashboard="true">
            <svg class="nav-inline-icon" aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Dashboard
        </button>`;
        for (const category of categories) {
            const subtopics = sortCategories(Object.keys(getPracticeData()[category]));
            const totalQs = subtopics.reduce((sum, st) => sum + getPracticeData()[category][st].length, 0);
            navHTML += `<div class="nav-group">
                <div class="nav-group-title nav-group-title-spaced">${category} <span class="nav-count">${totalQs}</span></div>
                ${subtopics.map(st => {
                    const count = getPracticeData()[category][st].length;
                    return `<button type="button" class="nav-item" data-category="${category}|||${st}">${st} <span class="nav-count">${count}</span></button>`;
                }).join('')}
            </div>`;
        }
        if (navMenu) navMenu.innerHTML = navHTML;
        
        attachNavListeners(renderPracticeCategory);
        renderDashboard();
    }

    function attachNavListeners(renderFunction) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const target = e.currentTarget;
                document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
                target.classList.add('active');
                
                if (target.getAttribute('data-dashboard')) {
                    activeCategory = null;
                    renderDashboard();
                } else {
                    activeCategory = target.getAttribute('data-category');
                    renderFunction(activeCategory);
                }
            });
        });
    }

    // --- Grid Rendering ---
    function getPdfIcon() {
        return `<div class="pdf-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
        </div>`;
    }

    function getWorkspaceIcon(name) {
        const icons = {
            physics: '<circle cx="12" cy="12" r="1.6" fill="currentColor"></circle><ellipse cx="12" cy="12" rx="9" ry="3.5"></ellipse><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)"></ellipse><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)"></ellipse>',
            chemistry: '<path d="M9 3h6"></path><path d="M10 3v6.2l-5 8.3A2.3 2.3 0 0 0 7 21h10a2.3 2.3 0 0 0 2-3.5l-5-8.3V3"></path><path d="M8 15h8"></path>',
            biology: '<path d="M7 3c0 6 10 6 10 12 0 3-2 5-5 6"></path><path d="M17 3c0 6-10 6-10 12 0 3 2 5 5 6"></path><path d="M8.5 6h7M7.5 10h9M7.5 14h9M8.5 18h7"></path>',
            math: '<path d="M18 4H7l5 8-5 8h11"></path><path d="M15 8h4M15 16h4"></path>',
            math_ai: '<path d="M4 19V5"></path><path d="M4 19h16"></path><path d="m7 15 4-5 3 2 4-6"></path><circle cx="7" cy="15" r="1"></circle><circle cx="11" cy="10" r="1"></circle><circle cx="14" cy="12" r="1"></circle><circle cx="18" cy="6" r="1"></circle>',
            economics: '<path d="M4 19V5"></path><path d="M4 19h16"></path><path d="m7 15 3-3 3 2 5-7"></path><path d="M15 7h3v3"></path>',
            business: '<rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M3 12h18"></path><path d="M10 12v2h4v-2"></path>',
            syllabus: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22z"></path><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22z"></path>',
            topics: '<path d="m12 2 9 5-9 5-9-5z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 17 9 5 9-5"></path>',
            papers: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8M8 17h8"></path>',
            mock: '<rect x="3" y="3" width="18" height="18" rx="4"></rect><path d="m8 12 2.5 2.5L16.5 8.5"></path>',
            reviews: '<path d="M6 3h12a2 2 0 0 1 2 2v16l-8-4-8 4V5a2 2 0 0 1 2-2z"></path><path d="m9 9 2 2 4-4"></path>',
            daily: '<path d="m13 2-8 12h7l-1 8 8-12h-7z"></path>',
            streak: '<path d="M12 22c4 0 7-2.7 7-6.4 0-2.4-1.2-4.7-3.6-6.9.1 2-1 3.2-2.2 3.9.3-3.8-1.8-7.5-5.1-10.6.2 3.5-3.1 5.8-3.1 10.7C5 18 8 22 12 22z"></path><path d="M9.5 18.5c0-1.8 1-3.1 2.6-4.4.1 1.4.8 2.2 1.5 2.9.5.5.9 1.1.9 1.9"></path>',
            xp: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2z"></path><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z"></path><path d="m5 14 .6 1.9 1.9.6-1.9.6L5 19l-.6-1.9-1.9-.6 1.9-.6z"></path>',
            dp: '<path d="m12 3 8 6-8 12L4 9z"></path><path d="m4 9 8 3 8-3M9 4l3 8 3-8"></path>',
            target: '<circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"></path>',
            arrow: '<path d="M5 12h14"></path><path d="m14 7 5 5-5 5"></path>'
        };
        return `<svg class="workspace-nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
    }

    function renderDashboard() {
        hideContentHeader();
        currentCategoryTitle.textContent = "Workspace";
        categoryStats.textContent = "";
        updateBreadcrumbs([]);

        const subjectLabel = getSubjectLabel();
        const subjectIcon = getSubjectConfig().icon;
        const syllabusData = getSyllabusData();
        const categories = sortCategories(Object.keys(syllabusData));
        const hasQuestionLevelContent = subjectHasQuestionLevelContent();

        let homescreenHTML = `
            <!-- Top Nav Bar (Stationary) -->
            <div class="workspace-top-nav">
                <div class="workspace-nav-leading">
                    <button type="button" class="subject-back-btn" id="homeBackBtn" aria-label="Back to all subjects">
                        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg>
                        <span>Back</span>
                    </button>
                    <div class="workspace-logo" title="${subjectLabel}">
                        ${getWorkspaceIcon(subjectIcon)}
                        <span>${subjectLabel}</span>
                    </div>
                </div>
                <nav class="workspace-menu" aria-label="Subject tools">
                    <button type="button" class="workspace-nav-item is-active" id="homeNavSyllabus" aria-current="page" aria-label="Syllabus themes" title="Syllabus themes">
                        ${getWorkspaceIcon('syllabus')}<span>Syllabus</span>
                    </button>
                    <button type="button" class="workspace-nav-item" id="homeNavTopics" aria-label="Topical papers" title="Topical papers">
                        ${getWorkspaceIcon('topics')}<span>Topical</span>
                    </button>
                    <button type="button" class="workspace-nav-item" id="homeNavPapers" aria-label="Past papers" title="Past papers">
                        ${getWorkspaceIcon('papers')}<span>Papers</span>
                    </button>
                    ${hasQuestionLevelContent ? `
                        <button type="button" class="workspace-nav-item" id="homeNavMock" aria-label="Mock simulator" title="Mock simulator">
                            ${getWorkspaceIcon('mock')}<span>Mock</span>
                        </button>
                    ` : ''}
                    <button type="button" class="workspace-nav-item" id="homeNavReviews" aria-label="Review queue" title="Review queue">
                        ${getWorkspaceIcon('reviews')}<span>Review</span>
                    </button>
                </nav>
                ${hasQuestionLevelContent ? `
                    <button type="button" class="workspace-cta-btn" id="homeCtaBtn" aria-label="Problem of the day" title="Problem of the day">
                        ${getWorkspaceIcon('daily')}
                        <span>Daily problem</span>
                    </button>
                ` : ''}
            </div>

            <div class="workspace-scroll-container">
                <!-- Syllabus Themes -->
                ${categories.map((category, catIdx) => {
                    const subcategories = syllabusData[category] || {};
                    return `
                        <div class="scroll-slide theme-slide" id="theme-${catIdx}">
                            <div class="theme-slide-header">
                                <h2>${category}</h2>
                            </div>
                            <div class="theme-cards-grid">
                                ${Object.entries(subcategories).map(([subcat, files]) => {
                                    const practiceQuestions = (getPracticeData()[category] && getPracticeData()[category][subcat]) || [];
                                    const statItems = hasQuestionLevelContent
                                        ? [...new Map(practiceQuestions.map(question => [question.filepath || question.qp_path, question])).values()]
                                        : files;
                                    const totalCount = statItems.length;
                                    const doneCount = statItems.filter(f => isQuestionCompleted(f.filepath || f.qp_path)).length;
                                    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
                                    
                                    return `
                                        <button type="button" class="theme-subcat-card card card-interactive" data-category="${category}" data-subcat="${subcat}" aria-label="Open ${subcat}, ${pct}% complete">
                                            <div class="card-progress-ring">
                                                <svg viewBox="0 0 36 36" class="progress-ring-svg">
                                                    <circle class="ring-bg" cx="18" cy="18" r="15.915" fill="transparent" stroke-width="2.5"></circle>
                                                    <circle class="ring-fill" cx="18" cy="18" r="15.915" fill="transparent" stroke="var(--accent)" stroke-width="2.5" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="25"></circle>
                                                </svg>
                                                <span class="ring-text">${pct}%</span>
                                            </div>
                                            <div class="card-meta">
                                                <h3>${subcat}</h3>
                                                <p>${totalCount} questions • ${doneCount} completed</p>
                                            </div>
                                            <div class="card-arrow">↗</div>
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        papersGrid.innerHTML = homescreenHTML;
        refreshAOS();

        // Bind top menu click events
        document.getElementById('homeBackBtn').addEventListener('click', renderDojoHome);

        document.getElementById('homeNavSyllabus').addEventListener('click', () => {
            const firstThemeSlide = document.getElementById('theme-0');
            if (firstThemeSlide) {
                firstThemeSlide.scrollIntoView({ behavior: 'smooth' });
            }
        });

        document.getElementById('homeNavTopics').addEventListener('click', () => {
            switchMode('topics');
            renderTopicsList();
        });

        document.getElementById('homeNavPapers').addEventListener('click', () => {
            switchMode('papers');
            renderPapersList();
        });

        const mockNav = document.getElementById('homeNavMock');
        if (mockNav) {
            mockNav.addEventListener('click', () => {
                openMockGeneratorModal();
            });
        }

        document.getElementById('homeNavReviews').addEventListener('click', () => {
            renderReviewQueue();
        });

        // CTA button launches Problem of the Day
        const homeCtaBtn = document.getElementById('homeCtaBtn');
        if (homeCtaBtn) homeCtaBtn.addEventListener('click', launchDailyChallenge);

        // Bind subcategory card clicks
        document.querySelectorAll('.theme-subcat-card').forEach(card => {
            card.addEventListener('click', () => {
                const category = card.getAttribute('data-category');
                const subcat = card.getAttribute('data-subcat');
                if (hasQuestionLevelContent) {
                    switchMode('practice');
                    renderPracticeCategory(`${category}|||${subcat}`);
                } else {
                    switchMode('topics');
                    renderTopicCategory(category, subcat);
                }
            });
        });
    }

    function switchMode(mode) {
        currentMode = mode;
        modeBtns.forEach(btn => {
            if (btn.getAttribute('data-mode') === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        if (currentMode === 'practice') {
            paperFilter.classList.remove('hidden');
        } else {
            paperFilter.classList.add('hidden');
        }
        initNavigation();
    }

    function renderTopicsList() {
        showContentHeader();
        activeCategory = null;
        renderSubjectModeBar('topics');
        currentCategoryTitle.textContent = "Topics";
        categoryStats.textContent = "";
        updateBreadcrumbs([getSubjectLabel(), 'Topics']);

        const data = getSyllabusData();
        const categories = sortCategories(Object.keys(data));
        
        let html = '<div class="dashboard-grid">';
        categories.forEach(category => {
            const subcategories = data[category] || {};
            const subcatNames = sortCategories(Object.keys(subcategories));
            
            let completedCount = 0;
            let totalCount = 0;
            
            subcatNames.forEach(sub => {
                const files = subcategories[sub] || [];
                totalCount += files.length;
                files.forEach(f => {
                    const path = f.filepath || f.qp_path;
                    if (path && isQuestionCompleted(path)) {
                        completedCount++;
                    }
                });
            });
            
            const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

            html += `
                <article class="topic-card card">
                    <div class="topic-card-header card-header">
                        <div class="topic-card-title">${category}</div>
                    </div>
                    <div class="topic-card-body card-content">
                        ${subcatNames.map(sub => {
                            const count = subcategories[sub].length;
                            return `
                                <button type="button" class="subtopic-row" data-category="${category}" data-subtopic="${sub}">
                                    <span class="subtopic-name">${sub}</span>
                                    <span class="subtopic-badge badge">${count} paper${count !== 1 ? 's' : ''}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                    <div class="topic-card-footer card-footer">
                        <div class="progress-info">
                            <span>${completedCount} / ${totalCount} Completed</span>
                            <span>${percent}%</span>
                        </div>
                        <div class="progress-bar-container progress">
                            <div class="progress-bar" style="width: ${percent}%"></div>
                        </div>
                    </div>
                </article>
            `;
        });
        html += '</div>';
        papersGrid.innerHTML = html;
        bindSubtopicRowEvents();
        refreshAOS();
    }

    function renderPapersList() {
        showContentHeader();
        activeCategory = null;
        renderSubjectModeBar('papers');
        currentCategoryTitle.textContent = "Past Papers";
        categoryStats.textContent = "";
        updateBreadcrumbs([getSubjectLabel(), 'Past Papers']);

        const data = getFullPapersData();
        const categories = Object.keys(data).sort().reverse(); // Newest years first
        
        let html = '<div class="dashboard-grid">';
        categories.forEach(category => {
            const subcategories = data[category] || {};
            const subcatNames = sortCategories(Object.keys(subcategories));
            
            let completedCount = 0;
            let totalCount = 0;
            
            subcatNames.forEach(sub => {
                const files = subcategories[sub] || [];
                totalCount += files.length;
                files.forEach(f => {
                    const path = f.filepath || f.qp_path;
                    if (path && isQuestionCompleted(path)) {
                        completedCount++;
                    }
                });
            });
            
            const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

            html += `
                <article class="topic-card card">
                    <div class="topic-card-header card-header">
                        <div class="topic-card-title">Year ${category}</div>
                    </div>
                    <div class="topic-card-body card-content">
                        ${subcatNames.map(sub => {
                            const count = subcategories[sub].length;
                            return `
                                <button type="button" class="subtopic-row" data-category="${category}" data-subtopic="${sub}">
                                    <span class="subtopic-name">${sub}</span>
                                    <span class="subtopic-badge badge">${count} paper${count !== 1 ? 's' : ''}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                    <div class="topic-card-footer card-footer">
                        <div class="progress-info">
                            <span>${completedCount} / ${totalCount} Completed</span>
                            <span>${percent}%</span>
                        </div>
                        <div class="progress-bar-container progress">
                            <div class="progress-bar" style="width: ${percent}%"></div>
                        </div>
                    </div>
                </article>
            `;
        });
        // Append Mock Exams & Predictions Card and Topic-Sorted Papers Card
        const mocks = getSaveMyExamsMocks();
        if (mocks.length > 0) {
            const mockExamsList = mocks.filter(m => m.name.includes("Revision Dojo") || m.name.includes("Mock") || m.name.includes("Synoptic"));
            const topicSortedList = mocks.filter(m => !mockExamsList.includes(m));

            // 1. Mock predicted papers card
            html += `
                <article class="topic-card mock-exams-card card topic-card-featured">
                    <div class="topic-card-header card-header">
                        <div class="topic-card-title topic-card-title-accent">
                            <span>🏆</span> Mock Exams & Predictions
                        </div>
                    </div>
                    <div class="topic-card-body card-content">
                        <button type="button" class="subtopic-row subtopic-row-featured" data-category="Save My Exams Mocks" data-subtopic="All Mocks">
                            <span class="subtopic-name">Save My Exams & Revision Dojo</span>
                            <span class="subtopic-badge badge badge-primary">${mockExamsList.length} papers</span>
                        </button>
                        <p class="topic-card-description">
                            Ripped full mock exams and predicted papers for high-yield exam preparation.
                        </p>
                    </div>
                    <div class="topic-card-footer card-footer">
                        <div class="progress-info">
                            <span>Ready to Practice</span>
                            <span>100% Offline</span>
                        </div>
                    </div>
                </article>
            `;

            // 2. Topic-sorted papers card
            html += `
                <article class="topic-card mock-exams-card card topic-card-featured">
                    <div class="topic-card-header card-header">
                        <div class="topic-card-title topic-card-title-accent">
                            <span>📚</span> Topic-Sorted Papers
                        </div>
                    </div>
                    <div class="topic-card-body card-content">
                        <button type="button" class="subtopic-row subtopic-row-featured" data-category="Save My Exams Topics" data-subtopic="All Topics">
                            <span class="subtopic-name">Save My Exams Topic Tests</span>
                            <span class="subtopic-badge badge badge-primary">${topicSortedList.length} papers</span>
                        </button>
                        <p class="topic-card-description">
                            Full topical test papers compiled from official question banks to target weak areas.
                        </p>
                    </div>
                    <div class="topic-card-footer card-footer">
                        <div class="progress-info">
                            <span>Ready to Practice</span>
                            <span>100% Offline</span>
                        </div>
                    </div>
                </article>
            `;
        }

        html += '</div>';
        papersGrid.innerHTML = html;
        bindSubtopicRowEvents();
        refreshAOS();
    }

    function bindSubtopicRowEvents() {
        document.querySelectorAll('.subtopic-row').forEach(row => {
            row.addEventListener('click', () => {
                const cat = row.getAttribute('data-category');
                const sub = row.getAttribute('data-subtopic');
                
                document.querySelectorAll('.nav-item').forEach(el => {
                    const dataCat = el.getAttribute('data-category');
                    if (dataCat === cat || dataCat === `${cat}|||${sub}`) {
                        el.classList.add('active');
                        activeCategory = dataCat;
                    } else {
                        el.classList.remove('active');
                    }
                });

                if (currentMode === 'topics') {
                    renderTopicCategory(cat);
                } else if (currentMode === 'papers') {
                    renderPaperCategory(cat);
                } else if (currentMode === 'practice') {
                    renderPracticeCategory(`${cat}|||${sub}`);
                }
            });
        });
    }



    // --- Review Queue Renderer ---
    function renderReviewQueue() {
        showContentHeader();
        const dueReviews = getDueReviewQuestions();
        currentCategoryTitle.textContent = 'Review Queue';
        categoryStats.textContent = `${dueReviews.length} due`;
        updateBreadcrumbs([getSubjectLabel(), 'Review Queue']);

        if (dueReviews.length === 0) {
            papersGrid.innerHTML = `<div class="empty-state"><h3>All caught up! 🎉</h3><p>No questions due for review. Keep studying to build your queue.</p></div>`;
            return;
        }

        let html = '<div class="review-queue-list">';
        dueReviews.forEach(entry => {
            const now = Date.now();
            const overdueHours = Math.round((now - entry.nextReview) / (1000 * 60 * 60));
            const urgencyClass = overdueHours > 24 ? 'overdue' : 'due-today';
            const urgencyLabel = overdueHours > 24 ? `${Math.round(overdueHours/24)}d overdue` : overdueHours > 0 ? `${overdueHours}h overdue` : 'Due now';
            const diffLabel = entry.difficulty === 'hard' ? '🔴 Hard' : entry.difficulty === 'medium' ? '🟡 Medium' : '🟢 Easy';
            const filename = entry.filepath.split('/').pop().replace('.pdf', '');

            html += `
                <div class="review-card" data-pdf-url="${entry.filepath}" data-pdf-name="${filename}">
                    ${getPdfIcon()}
                    <div class="pdf-info pdf-info-grow">
                        <div class="pdf-name">${filename}</div>
                        <div class="pdf-meta">${diffLabel} · Review #${entry.reviewCount + 1}</div>
                    </div>
                    <span class="review-urgency ${urgencyClass}">${urgencyLabel}</span>
                </div>
            `;
        });
        html += '</div>';
        papersGrid.innerHTML = html;

        // Attach click listeners for review cards
        document.querySelectorAll('.review-card').forEach(card => {
            card.addEventListener('click', () => {
                const pdfUrl = card.getAttribute('data-pdf-url');
                const name = card.getAttribute('data-pdf-name');
                currentPdfUrl = pdfUrl;
                currentMsUrl = '';
                viewerTitle.textContent = name;
                saveListViewState();
                mainContentArea.classList.add('viewing-pdf');
                pushMobileHistoryState('pdf');
                
                if (completeToggle) {
                    completeToggle.classList.remove('hidden');
                    updateCompleteButtonUI(pdfUrl);
                }
                
                renderPdf(pdfUrl);
                showSrsRating(pdfUrl);
            });
        });
    }



    function renderTopicCategory(category, selectedSubtopic = null) {
        activeCategory = category;
        showContentHeader();
        currentCategoryTitle.textContent = category;
        updateBreadcrumbs([getSubjectLabel(), category, ...(selectedSubtopic ? [selectedSubtopic] : [])]);
        const allSubcategories = getSyllabusData()[category] || {};
        const subcategories = selectedSubtopic && allSubcategories[selectedSubtopic]
            ? { [selectedSubtopic]: allSubcategories[selectedSubtopic] }
            : allSubcategories;
        
        let totalFiles = 0;
        let html = '';

        for (const [subcat, files] of Object.entries(subcategories)) {
            totalFiles += files.length;
            html += `
                <div class="subtopic-section">
                    <h3 class="subtopic-title">${subcat}</h3>
                    <div class="cards-grid">
                        ${files.map((file, idx) => {
                            const done = isQuestionCompleted(file.filepath);
                            const isBoss = idx === files.length - 1; // Last one is the boss!
                            const isBossDefeated = window.gamification ? window.gamification.isBossDefeated(file.filepath) : false;
                            
                            return `
                                <button type="button" class="pdf-card ${isBoss ? 'boss-card' : ''}" data-pdf-url="${file.filepath}" data-pdf-name="${file.filename}" data-subcat="${subcat}" data-boss="${isBoss}">
                                    ${isBoss ? `<div class="boss-crown" title="Boss Battle! 👑">${isBossDefeated ? '👑' : '💀'}</div>` : getPdfIcon()}
                                    <div class="pdf-info">
                                        <div class="pdf-name ${done ? 'is-complete' : ''}">${file.filename.replace('.pdf', '')}</div>
                                        <div class="pdf-meta">${done ? '<span class="resource-status resource-status-complete">Completed ✓</span>' : isBoss ? `<span class="resource-status resource-status-featured">Topic Boss Battle ${isBossDefeated ? '👑' : '💀'}</span>` : 'Topic Snippet'}</div>
                                    </div>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }
        
        categoryStats.textContent = `${totalFiles} snippet${totalFiles !== 1 ? 's' : ''}`;
        papersGrid.innerHTML = html;
        attachPdfListeners();
        refreshAOS();
    }

    const saveMyExamsMocks = {
        physics: [
            { name: "Revision Dojo M26 Predicted Paper 2 HL", filename: "m26-ib-physics-predicted-paper-2-hl.pdf" },
            { name: "Revision Dojo Predicted Paper 2 HL (Set 1)", filename: "physics-hl-predicted-paper-2.pdf" },
            { name: "Revision Dojo Predicted Paper 2 HL (Set 2)", filename: "set-2-physics-hl-predicted-paper-2.pdf" },
            { name: "Save My Exams Synoptic Mock Paper", filename: "SME_Physics_Synoptic.pdf" },
            { name: "Save My Exams Paper 2 Mock (Set 1)", filename: "SME_Physics_Paper2.pdf" },
            { name: "Save My Exams Paper 2 Mock (Set 2)", filename: "SME_Physics_Paper2_v2.pdf" },
            { name: "Save My Exams Paper 2 Mock (Set 3)", filename: "SME_Physics_Paper2_v3.pdf" },
            { name: "Save My Exams Paper 1 Mock (Set 1)", filename: "SME_Physics_Paper1_v1.pdf" },
            { name: "Save My Exams Paper 1 Mock (Set 2)", filename: "SME_Physics_Paper1_v2.pdf" },
            { name: "Save My Exams Paper 1 Mock (Set 3)", filename: "SME_Physics_Paper1_v3.pdf" },
            { name: "Save My Exams Paper 1 Topic Mock - Fields", filename: "SME_Physics_Paper1_Fields.pdf" },
            { name: "Save My Exams Paper 1 Topic Mock - Nuclear", filename: "SME_Physics_Paper1_Nuclear.pdf" },
            { name: "Save My Exams Paper 1 Topic Mock - RBD", filename: "SME_Physics_Paper1_RBD.pdf" },
            { name: "Save My Exams Paper 1 Topic Mock - Waves", filename: "SME_Physics_Paper1_Waves.pdf" },
            { name: "Save My Exams Topic Test - Theme A (Space, Time & Motion)", filename: "SME_Exam_A1-A5.pdf" },
            { name: "Save My Exams Topic Test - Theme B (Particulate Matter)", filename: "SME_Exam_B1-B5.pdf" },
            { name: "Save My Exams Topic Test - Theme C (Wave Behaviour)", filename: "SME_Exam_C1-C5.pdf" },
            { name: "Save My Exams Topic Test - Theme D (Fields)", filename: "SME_Exam_D1-D5.pdf" },
            { name: "Save My Exams Topic Test - Theme E (Nuclear & Quantum)", filename: "SME_Exam_E1-E5.pdf" },
            { name: "Save My Exams Full Syllabus Mock Test (Set 1)", filename: "SME_Exam_ALL.pdf" },
            { name: "Save My Exams Full Syllabus Mock Test (Set 2)", filename: "SME_Exam_ALLv2.pdf" }
        ],
        chemistry: [
            { name: "Save My Exams Synoptic Mock Paper", filename: "SME_Chemistry_Synoptic.pdf" },
            { name: "Save My Exams Mock Paper (Set 1)", filename: "SME_Chemistry_v1.pdf" },
            { name: "Save My Exams Mock Paper (Set 2)", filename: "SME_Chemistry_v2.pdf" },
            { name: "Save My Exams Mock Paper (Set 3)", filename: "SME_Chemistry_v3.pdf" },
            { name: "Save My Exams Topic Test - Reactivity 1", filename: "SME_Chemistry_R1.pdf" },
            { name: "Save My Exams Topic Test - Reactivity 2", filename: "SME_Chemistry_R2.pdf" },
            { name: "Save My Exams Topic Test - Reactivity 3", filename: "SME_Chemistry_R3.pdf" },
            { name: "Save My Exams Topic Test - Structure 1", filename: "SME_Chemistry_S1.pdf" },
            { name: "Save My Exams Topic Test - Structure 2", filename: "SME_Chemistry_S2.pdf" },
            { name: "Save My Exams Topic Test - Structure 3", filename: "SME_Chemistry_S3.pdf" }
        ]
    };
    function getSaveMyExamsMocks() {
        const currentKey = currentSubject;
        const fallback = saveMyExamsMocks[currentKey] || [];

        if (!Object.hasOwn(saveMyExamsMocks, currentKey)) return fallback;
        
        if (!fs || !path || typeof process === 'undefined' || !process.cwd) {
            return fallback;
        }
        
        try {
            const directoryPath = path.join(process.cwd(), 'Content', 'Save My Exams');
            if (!fs.existsSync(directoryPath)) {
                return fallback;
            }
            
            const files = fs.readdirSync(directoryPath);
            const mockPapers = [];
            
            files.forEach(filename => {
                if (!filename.endsWith('.pdf')) return;
                
                const lowerFilename = filename.toLowerCase();
                const isChem = lowerFilename.includes('chem') || lowerFilename.includes('chemistry');
                const isPhys = lowerFilename.includes('phys') || lowerFilename.includes('physics');
                
                if (currentKey === 'chemistry') {
                    if (isPhys && !isChem) return;
                } else {
                    if (isChem && !isPhys) return;
                }
                
                let name = filename.replace(/\.pdf$/i, '');
                if (name.startsWith('SME_')) {
                    name = name.substring(4);
                }
                
                name = name.replace(/[-_]/g, ' ');
                name = name.replace(/\br1\b/i, 'Reactivity 1')
                           .replace(/\br2\b/i, 'Reactivity 2')
                           .replace(/\br3\b/i, 'Reactivity 3')
                           .replace(/\bs1\b/i, 'Structure 1')
                           .replace(/\bs2\b/i, 'Structure 2')
                           .replace(/\bs3\b/i, 'Structure 3')
                           .replace(/\bv1\b/i, '(Set 1)')
                           .replace(/\bv2\b/i, '(Set 2)')
                           .replace(/\bv3\b/i, '(Set 3)')
                           .replace(/\brbd\b/i, 'Rigid Body Dynamics')
                           .replace(/\bhl\b/i, 'HL')
                           .replace(/\bsl\b/i, 'SL');
                
                if (filename.startsWith('SME_') || filename.toLowerCase().includes('sme')) {
                    name = 'Save My Exams ' + name;
                } else if (filename.toLowerCase().includes('predicted') || filename.toLowerCase().includes('m26') || filename.toLowerCase().includes('dojo')) {
                    name = 'Revision Dojo ' + name;
                }
                
                name = name.split(' ')
                           .map(w => w.charAt(0).toUpperCase() + w.substring(1))
                           .join(' ');
                
                mockPapers.push({
                    name: name,
                    filename: filename
                });
            });
            
            mockPapers.sort((a, b) => a.name.localeCompare(b.name));
            return mockPapers.length > 0 ? mockPapers : fallback;
        } catch (e) {
            console.error("Error reading mock exams directory dynamically:", e);
            return fallback;
        }
    }

    function renderPaperCategory(year) {
        activeCategory = year;
        showContentHeader();
        renderSubjectModeBar('papers');
        
        if (year === "Save My Exams" || year === "Save My Exams Mocks" || year === "Save My Exams Topics") {
            const isMocksMode = (year !== "Save My Exams Topics");
            currentCategoryTitle.textContent = isMocksMode ? "Mock Exams & Predictions" : "Topic-Sorted Papers";
            
            updateBreadcrumbs([
                getSubjectLabel(),
                'Past Papers',
                isMocksMode ? 'Mock Exams & Predictions' : 'Topic-Sorted Papers'
            ]);
            
            const allMocks = getSaveMyExamsMocks();
            let html = '';
            
            const mockExamsList = allMocks.filter(m => m.name.includes("Revision Dojo") || m.name.includes("Mock") || m.name.includes("Synoptic"));
            const topicSortedList = allMocks.filter(m => !mockExamsList.includes(m));
            
            const files = isMocksMode ? mockExamsList : topicSortedList;
            let totalFiles = files.length;

            const groups = {};
            if (isMocksMode) {
                groups["Revision Dojo Predicted Papers"] = files.filter(m => m.name.includes("Revision Dojo"));
                groups["Save My Exams Full Mocks"] = files.filter(m => !m.name.includes("Revision Dojo"));
            } else {
                // Group by paper number / type if present, or just one generic list
                groups["Topic Tests by Subject Area"] = files;
            }
            
            for (const [groupName, groupFiles] of Object.entries(groups)) {
                if (groupFiles.length === 0) continue;
                html += `
                    <div class="subtopic-section">
                        <h3 class="subtopic-title">${groupName} (${groupFiles.length})</h3>
                        <div class="cards-grid">
                            ${groupFiles.map(f => {
                                const filepath = `Content/Save My Exams/${f.filename}`;
                                const done = isQuestionCompleted(filepath);
                                return `
                                    <button type="button" class="pdf-card" data-pdf-url="${filepath}" data-ms-url="" data-pdf-name="${f.name}">
                                        ${getPdfIcon()}
                                        <div class="pdf-info">
                                            <div class="pdf-name ${done ? 'is-complete' : ''}">${f.name}</div>
                                            <div class="pdf-meta">${done ? '<span class="resource-status resource-status-complete">Completed ✓</span>' : isMocksMode ? 'Mock Exam Paper' : 'Topic Test Paper'}</div>
                                        </div>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }
            
            categoryStats.textContent = `${totalFiles} paper${totalFiles !== 1 ? 's' : ''}`;
            papersGrid.innerHTML = html;
            attachPdfListeners();
            refreshAOS();
            return;
        }
        
        currentCategoryTitle.textContent = `${year} Examination`;
        updateBreadcrumbs([
            getSubjectLabel(),
            'Past Papers',
            `${year} Exams`
        ]);
        const sessions = getFullPapersData()[year] || {};
        
        let totalFiles = 0;
        let html = '';

        for (const [session, files] of Object.entries(sessions)) {
            totalFiles += files.length;
            html += `
                <div class="subtopic-section">
                    <h3 class="subtopic-title">${session} Session</h3>
                    <div class="cards-grid">
                        ${files.map(file => `
                            <button type="button" class="pdf-card" data-pdf-url="${file.qp_path}" data-ms-url="${file.ms_path || ''}" data-pdf-name="${file.name}">
                                ${getPdfIcon()}
                                <div class="pdf-info">
                                    <div class="pdf-name">${file.name}</div>
                                    <div class="pdf-meta">Full Paper</div>
                                </div>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        categoryStats.textContent = `${totalFiles} paper${totalFiles !== 1 ? 's' : ''}`;
        papersGrid.innerHTML = html;
        attachPdfListeners();
        refreshAOS();
    }

    function getPaperDefinitions(subjectId = currentSubject) {
        const unknown = { title: 'Paper metadata unavailable', meta: 'Needs metadata review' };
        if (subjectId === 'math' || subjectId === 'math_ai') {
            return {
                P1: { title: 'Paper 1 — No technology', meta: 'No technology' },
                P2: { title: 'Paper 2 — Technology', meta: 'Technology allowed' },
                P3: { title: 'Paper 3 — HL extension', meta: 'HL extension' },
                UNKNOWN: unknown
            };
        }
        if (subjectId === 'economics') {
            return {
                P1: { title: 'Paper 1 — Extended response', meta: 'Extended response' },
                P2: { title: 'Paper 2 — Data response', meta: 'Data response' },
                P3: { title: 'Paper 3 — Policy paper', meta: 'Policy paper' },
                UNKNOWN: unknown
            };
        }
        if (subjectId === 'business') {
            return {
                P1: { title: 'Paper 1 — Case study', meta: 'Case study' },
                P2: { title: 'Paper 2 — Business contexts', meta: 'Business contexts' },
                P3: { title: 'Paper 3 — Social enterprise', meta: 'Social enterprise' },
                UNKNOWN: unknown
            };
        }
        return {
            P1: { title: 'Paper 1 — Multiple Choice', meta: 'MCQ' },
            P2: { title: 'Paper 2 — Structured', meta: 'Structured' },
            P3: { title: 'Paper 3 — Options & Data Analysis', meta: 'Data & Options' },
            UNKNOWN: unknown
        };
    }

    function renderPracticeCategory(key) {
        activeCategory = key;
        showContentHeader();
        renderSubjectModeBar('topics');
        const [category, subtopic] = key.split('|||');
        currentCategoryTitle.textContent = subtopic;
        updateBreadcrumbs([
            getSubjectLabel(),
            category,
            subtopic
        ]);
        let questions = (getPracticeData()[category] && getPracticeData()[category][subtopic]) || [];
        
        if (practiceFilter !== 'all') {
            questions = questions.filter(q => q.paper_type === practiceFilter);
        }
        
        let html = '';

        if (questions.length === 0) {
            html = `<div class="empty-state"><h3>No questions found</h3><p>This sub-topic has no extracted questions.</p></div>`;
            categoryStats.textContent = '';
        } else {
            const paperDefinitions = getPaperDefinitions();

            for (const [ptype, pdef] of Object.entries(paperDefinitions)) {
                const qs = questions.filter(q => q.paper_type === ptype);
                if (qs.length > 0) {
                    html += `
                        <div class="subtopic-section">
                            <h3 class="subtopic-title">${pdef.title} (${qs.length})</h3>
                            <div class="cards-grid">
                                ${qs.map(q => {
                                    const done = isQuestionCompleted(q.filepath);
                                    return `
                                        <button type="button" class="pdf-card" data-pdf-url="${q.filepath}" data-full-paper="${q.full_paper_path}" data-pdf-name="${q.filename}">
                                            ${getPdfIcon()}
                                            <div class="pdf-info">
                                                <div class="pdf-name ${done ? 'is-complete' : ''}">${q.source} Q${q.qnum}</div>
                                                <div class="pdf-meta">${done ? '<span class="resource-status resource-status-complete">Completed ✓</span>' : `Pages ${q.pages} · ${pdef.meta}`}</div>
                                            </div>
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }
            }
            
            categoryStats.textContent = `${questions.length} question${questions.length !== 1 ? 's' : ''}`;
        }
        
        papersGrid.innerHTML = html;
        attachPdfListeners();
        refreshAOS();
    }

    // --- Custom PDF Viewer Logic ---
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    
    // Undo Stack for annotations
    const undoStack = [];
    const MAX_UNDO = 25;

    // Global Undo Listener
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (undoStack.length > 0) {
                const state = undoStack.pop();
                if (state.type === 'canvas') {
                    state.canvas.getContext('2d').putImageData(state.data, 0, 0);
                } else if (state.type === 'text') {
                    state.element.remove();
                }
            }
        }
    });
    
    // Tools State
    let activeTool = 'pan'; // pan, draw, highlight, text
    const toolBtns = {
        pan: document.getElementById('toolPan'),
        draw: document.getElementById('toolDraw'),
        highlight: document.getElementById('toolHighlight'),
        text: document.getElementById('toolText')
    };

    function setActiveTool(tool) {
        activeTool = tool;
        Object.values(toolBtns).forEach(b => b.classList.remove('active'));
        toolBtns[tool].classList.add('active');
        
        document.querySelectorAll('.pdf-annotation-layer').forEach(layer => {
            layer.className = 'pdf-annotation-layer';
            if (tool === 'pan') layer.classList.add('cursor-pan');
            if (tool === 'text') layer.classList.add('cursor-text');
        });

        // Award XP for actively reviewing/marking up paper
        if (tool !== 'pan' && window.gamification) {
            window.gamification.awardRewardOnce(`annotation:${currentPdfUrl}:${tool}`, 15, 0, `Used ${tool} annotation tool`);
        }
    }

    Object.keys(toolBtns).forEach(tool => {
        toolBtns[tool].addEventListener('click', () => setActiveTool(tool));
    });
    setActiveTool('pan'); // Initial

    // Save scroll position helper
    function saveScrollPosition() {
        if (currentPdfUrl && pdfContainer) {
            pdfScrollPositions[currentPdfUrl] = {
                scrollTop: pdfContainer.scrollTop,
                scale: currentScale
            };
            localStorage.setItem('science_qbank_pdf_scroll_positions', JSON.stringify(pdfScrollPositions));
        }
    }

    if (pdfContainer) {
        pdfContainer.addEventListener('scroll', () => {
            saveScrollPosition();
        });
    }

    // Zoom
    document.getElementById('toolZoomIn').addEventListener('click', () => { 
        if (currentScale < 3.0) { 
            currentScale = Math.min(3.0, currentScale + 0.25);
            preferredPdfScale = currentScale;
            reRenderPdf().then(() => saveScrollPosition()); 
        } 
    });
    document.getElementById('toolZoomOut').addEventListener('click', () => { 
        if (currentScale > 0.5) { 
            currentScale = Math.max(0.5, currentScale - 0.25);
            preferredPdfScale = currentScale;
            reRenderPdf().then(() => saveScrollPosition()); 
        } 
    });

    // Fullscreen
    document.getElementById('toolFullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.getElementById('viewerPane').requestFullscreen().catch(err => {});
        } else {
            document.exitFullscreen();
        }
    });

    // Clear
    document.getElementById('toolClear').addEventListener('click', () => {
        document.querySelectorAll('.pdf-annotation-layer').forEach(c => {
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, c.width, c.height);
        });
        document.querySelectorAll('.text-annotation').forEach(t => t.remove());
        document.querySelectorAll('.pdf-page-wrapper').forEach(wrapper => {
            wrapper.dataset.annotationDirty = 'false';
        });
    });
    
    function cancelActivePdfRender() {
        activePdfRenderTasks.forEach(task => {
            try { task.cancel(); }
            catch (_) { /* The task may already have completed. */ }
        });
        activePdfRenderTasks.clear();
    }

    function disconnectPdfPageObserver() {
        if (pdfPageObserver) pdfPageObserver.disconnect();
        pdfPageObserver = null;
    }

    function createPdfPagePlaceholder(pageNum, message = `Loading page ${pageNum}…`) {
        const placeholder = document.createElement('div');
        placeholder.className = 'pdf-page-placeholder';
        placeholder.textContent = message;
        placeholder.setAttribute('aria-hidden', 'true');
        return placeholder;
    }

    function getSafeCanvasPixelRatio(viewport) {
        // Supersample even on standard-density displays so fine PDF text and
        // equations remain as crisp as they are in Atom.
        const deviceRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2);
        const cssPixelsPerPage = Math.max(1, viewport.width * viewport.height);

        // Only nearby pages are rendered, so each visible page can keep a high
        // backing resolution without allocating canvases for the entire paper.
        const perPageLayerBudget = 8000000;
        const budgetRatio = Math.sqrt(perPageLayerBudget / cssPixelsPerPage);
        const dimensionRatio = Math.min(8192 / viewport.width, 8192 / viewport.height);
        return Math.max(0.5, Math.min(deviceRatio, budgetRatio, dimensionRatio));
    }

    function releaseUnannotatedPage(wrapper) {
        if (wrapper.dataset.rendered !== 'true' || wrapper.dataset.rendering === 'true') return;
        if (wrapper.dataset.annotationDirty === 'true') return;
        const pageNum = Number(wrapper.dataset.pageNumber) || 1;
        wrapper.replaceChildren(createPdfPagePlaceholder(pageNum));
        wrapper.dataset.rendered = 'false';
        wrapper.classList.add('pdf-page-pending');
    }

    function setupPdfPageObserver(renderId, wrappers) {
        disconnectPdfPageObserver();

        if (typeof IntersectionObserver === 'undefined') {
            wrappers.forEach((wrapper, index) => {
                if (index === 0 || wrapper.dataset.rendered === 'true') return;
                renderPage(renderId, index + 1, wrapper).catch(error => {
                    if (error?.name !== 'RenderingCancelledException') console.error('PDF page render failed:', error);
                });
            });
            return;
        }

        pdfPageObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const wrapper = entry.target;
                const pageNum = Number(wrapper.dataset.pageNumber);
                if (entry.isIntersecting) {
                    renderPage(renderId, pageNum, wrapper).catch(error => {
                        if (error?.name === 'RenderingCancelledException' || renderId !== currentRenderId) return;
                        console.error(`PDF page ${pageNum} render failed:`, error);
                        wrapper.replaceChildren(createPdfPagePlaceholder(pageNum, 'Page could not be rendered. Scroll away and back to retry.'));
                        wrapper.dataset.rendered = 'error';
                    });
                } else {
                    releaseUnannotatedPage(wrapper);
                }
            });
        }, {
            root: pdfContainer,
            rootMargin: '75% 0px',
            threshold: 0.01
        });

        wrappers.forEach(wrapper => pdfPageObserver.observe(wrapper));
    }

    async function reRenderPdf() {
        if (!currentPdfDoc) return;
        currentRenderId++;
        const renderId = currentRenderId;
        disconnectPdfPageObserver();
        cancelActivePdfRender();
        zoomDisplay.textContent = `${Math.round(currentScale * 100)}%`;

        const previousScrollableHeight = Math.max(1, pdfContainer.scrollHeight - pdfContainer.clientHeight);
        const previousScrollRatio = pdfContainer.scrollTop / previousScrollableHeight;
        const fragment = document.createDocumentFragment();
        const wrappers = [];

        try {
            for (let i = 1; i <= currentPdfDoc.numPages; i++) {
                if (renderId !== currentRenderId) return false;
                const page = await currentPdfDoc.getPage(i);
                if (renderId !== currentRenderId) return false;
                const viewport = page.getViewport({ scale: currentScale });
                const wrapper = document.createElement('div');
                wrapper.className = 'pdf-page-wrapper pdf-page-pending';
                wrapper.dataset.pageNumber = String(i);
                wrapper.dataset.rendered = 'false';
                wrapper.dataset.annotationDirty = 'false';
                wrapper.style.width = `${viewport.width}px`;
                wrapper.style.height = `${viewport.height}px`;
                wrapper.replaceChildren(createPdfPagePlaceholder(i));
                wrappers.push(wrapper);
                fragment.appendChild(wrapper);
            }

            const focusPage = Math.min(wrappers.length, Math.max(1, Math.round(previousScrollRatio * Math.max(0, wrappers.length - 1)) + 1));
            const rendered = await renderPage(renderId, focusPage, wrappers[focusPage - 1]);
            if (!rendered || renderId !== currentRenderId) return false;

            // The old view remains intact until the page nearest the user's
            // position is sharp and ready to replace it.
            pdfContainer.replaceChildren(fragment);
            const nextScrollableHeight = Math.max(0, pdfContainer.scrollHeight - pdfContainer.clientHeight);
            pdfContainer.scrollTop = nextScrollableHeight * previousScrollRatio;
            setupPdfPageObserver(renderId, wrappers);
            lastSuccessfulPdfScale = currentScale;
            return true;
        } catch (error) {
            if (error?.name === 'RenderingCancelledException' || renderId !== currentRenderId) return false;
            console.error('PDF zoom render failed:', error);
            currentScale = lastSuccessfulPdfScale;
            preferredPdfScale = lastSuccessfulPdfScale;
            zoomDisplay.textContent = `${Math.round(currentScale * 100)}%`;
            showNotification('That zoom could not be rendered safely. The previous view was restored.', 'error');
            return false;
        }
    }

    async function getViewerFitScale(pdfDoc) {
        const firstPage = await pdfDoc.getPage(1);
        const baseViewport = firstPage.getViewport({ scale: 1 });
        const viewerWidth = document.getElementById('viewerPane')?.clientWidth || pdfContainer.clientWidth || window.innerWidth;
        const horizontalGutter = window.matchMedia('(max-width: 1180px)').matches ? 12 : 32;
        const availableWidth = Math.max(280, viewerWidth - horizontalGutter);
        return Math.max(0.35, Math.min(1.25, availableWidth / baseViewport.width));
    }

    async function adaptViewerScaleToWindow() {
        if (!currentPdfDoc || !mainContentArea.classList.contains('viewing-pdf')) return;
        const responsiveWindow = window.matchMedia('(max-width: 1440px)').matches;
        const targetScale = responsiveWindow
            ? Math.min(preferredPdfScale, await getViewerFitScale(currentPdfDoc))
            : preferredPdfScale;
        if (Math.abs(targetScale - currentScale) < 0.025) return;

        const previousHeight = Math.max(1, pdfContainer.scrollHeight - pdfContainer.clientHeight);
        const scrollRatio = pdfContainer.scrollTop / previousHeight;
        currentScale = targetScale;
        await reRenderPdf();
        const nextHeight = Math.max(0, pdfContainer.scrollHeight - pdfContainer.clientHeight);
        pdfContainer.scrollTop = nextHeight * scrollRatio;
        saveScrollPosition();
    }

    window.addEventListener('resize', () => {
        if (!mainContentArea.classList.contains('viewing-pdf')) return;
        clearTimeout(viewerResizeTimer);
        viewerResizeTimer = setTimeout(() => adaptViewerScaleToWindow().catch(error => {
            console.warn('Could not adapt the paper viewer to the window size.', error);
        }), 180);
    });

    async function renderPdf(url) {
        currentRenderId++;
        const loadId = currentRenderId;
        disconnectPdfPageObserver();
        cancelActivePdfRender();
        pdfContainer.innerHTML = '<div class="loading-state viewer-loading-state">Loading document…</div>';
        try {
            // Restore scale
            if (pdfScrollPositions[url] && pdfScrollPositions[url].scale) {
                currentScale = pdfScrollPositions[url].scale;
            } else {
                currentScale = 1.25;
            }
            preferredPdfScale = currentScale;
            lastSuccessfulPdfScale = currentScale;

            const resolvedUrl = window.resolveStudyIBContentUrl
                ? window.resolveStudyIBContentUrl(url)
                : url;
            const loadingTask = pdfjsLib.getDocument(resolvedUrl);
            const loadedDoc = await loadingTask.promise;
            if (loadId !== currentRenderId) {
                loadedDoc.destroy?.();
                return;
            }
            currentPdfDoc = loadedDoc;
            if (window.matchMedia('(max-width: 1440px)').matches) {
                currentScale = Math.min(preferredPdfScale, await getViewerFitScale(currentPdfDoc));
            }
            await reRenderPdf();

            // Restore scroll position
            if (pdfScrollPositions[url] && pdfScrollPositions[url].scrollTop) {
                setTimeout(() => {
                    if (pdfContainer) pdfContainer.scrollTop = pdfScrollPositions[url].scrollTop;
                }, 150);
            }
        } catch (error) {
            if (loadId !== currentRenderId) return;
            console.error('Error rendering PDF:', error);
            pdfContainer.innerHTML = '<div class="error-state viewer-error-state">Failed to load PDF.</div>';
        }
    }

    async function renderPage(renderId, pageNum, wrapper) {
        if (renderId !== currentRenderId || !wrapper) return false;
        if (wrapper.dataset.rendered === 'true') return true;
        if (wrapper.dataset.rendering === 'true') return false;
        wrapper.dataset.rendering = 'true';

        let page;
        try {
            page = await currentPdfDoc.getPage(pageNum);
        } catch (error) {
            wrapper.dataset.rendering = 'false';
            throw error;
        }
        if (renderId !== currentRenderId) {
            wrapper.dataset.rendering = 'false';
            return false;
        }
        
        const viewport = page.getViewport({ scale: currentScale });
        const pixelRatio = getSafeCanvasPixelRatio(viewport);
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.height = `${viewport.height}px`;
        
        const renderCanvas = document.createElement('canvas');
        renderCanvas.className = 'pdf-render-layer';
        renderCanvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
        renderCanvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
        renderCanvas.style.width = `${viewport.width}px`;
        renderCanvas.style.height = `${viewport.height}px`;
        
        const annotCanvas = document.createElement('canvas');
        annotCanvas.className = 'pdf-annotation-layer';
        if (activeTool === 'pan') annotCanvas.classList.add('cursor-pan');
        if (activeTool === 'text') annotCanvas.classList.add('cursor-text');
        annotCanvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
        annotCanvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
        annotCanvas.style.width = `${viewport.width}px`;
        annotCanvas.style.height = `${viewport.height}px`;
        
        const canvasContext = renderCanvas.getContext('2d');
        if (!canvasContext) {
            wrapper.dataset.rendering = 'false';
            throw new Error('The browser could not allocate a PDF canvas.');
        }
        const renderContext = {
            canvasContext,
            viewport: viewport,
            transform: [pixelRatio, 0, 0, pixelRatio, 0, 0]
        };
        const renderTask = page.render(renderContext);
        activePdfRenderTasks.add(renderTask);
        try {
            await renderTask.promise;
        } catch (error) {
            if (error?.name === 'RenderingCancelledException' || renderId !== currentRenderId) return false;
            throw error;
        } finally {
            activePdfRenderTasks.delete(renderTask);
            wrapper.dataset.rendering = 'false';
        }
        
        if (renderId !== currentRenderId) return false; // Check before final setup
        wrapper.replaceChildren(renderCanvas, annotCanvas);
        setupAnnotationCanvas(annotCanvas, wrapper, pixelRatio);
        wrapper.dataset.rendered = 'true';
        wrapper.classList.remove('pdf-page-pending');
        return true;
    }
    
    function setupAnnotationCanvas(canvas, wrapper, pixelRatio) {
        const ctx = canvas.getContext('2d');
        ctx.scale(pixelRatio, pixelRatio);
        
        let drawing = false;
        let lastX = 0, lastY = 0;
        
        const getCoords = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        };

        canvas.addEventListener('mousedown', (e) => {
            if (activeTool === 'pan') return;
            wrapper.dataset.annotationDirty = 'true';
            const coords = getCoords(e);
            
            if (activeTool === 'text') {
                spawnTextBox(wrapper, coords.x, coords.y);
                return;
            }
            
            drawing = true;
            lastX = coords.x; lastY = coords.y;
            
            // Save state for Undo
            undoStack.push({
                type: 'canvas',
                canvas: canvas,
                data: ctx.getImageData(0, 0, canvas.width, canvas.height)
            });
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            
            if (activeTool === 'highlight') {
                ctx.globalCompositeOperation = 'multiply';
                ctx.strokeStyle = 'rgba(253, 224, 71, 0.4)'; // Yellow highlight
                ctx.lineWidth = 18 * currentScale;
                ctx.lineCap = 'square';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = '#E11D48'; // Rose color for pen
                ctx.lineWidth = 2 * currentScale;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
            }
        });
        
        canvas.addEventListener('mousemove', (e) => {
            if (!drawing) return;
            const coords = getCoords(e);
            ctx.lineTo(coords.x, coords.y);
            ctx.stroke();
            lastX = coords.x; lastY = coords.y;
        });
        
        canvas.addEventListener('mouseup', () => { drawing = false; });
        canvas.addEventListener('mouseleave', () => { drawing = false; });

        // --- Touch Listeners for Apple Pencil / Finger Draw on iOS ---
        canvas.addEventListener('touchstart', (e) => {
            if (activeTool === 'pan') return;
            wrapper.dataset.annotationDirty = 'true';
            e.preventDefault(); // Prevent scrolling on iOS while drawing
            const coords = getCoords(e);
            
            if (activeTool === 'text') {
                spawnTextBox(wrapper, coords.x, coords.y);
                return;
            }
            
            drawing = true;
            lastX = coords.x; lastY = coords.y;
            
            // Save state for Undo
            undoStack.push({
                type: 'canvas',
                canvas: canvas,
                data: ctx.getImageData(0, 0, canvas.width, canvas.height)
            });
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            
            if (activeTool === 'highlight') {
                ctx.globalCompositeOperation = 'multiply';
                ctx.strokeStyle = 'rgba(253, 224, 71, 0.4)'; // Yellow highlight
                ctx.lineWidth = 18 * currentScale;
                ctx.lineCap = 'square';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = '#E11D48'; // Rose color for pen
                ctx.lineWidth = 2 * currentScale;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            if (activeTool === 'pan') return;
            e.preventDefault();
            if (!drawing) return;
            const coords = getCoords(e);
            ctx.lineTo(coords.x, coords.y);
            ctx.stroke();
            lastX = coords.x; lastY = coords.y;
        }, { passive: false });

        canvas.addEventListener('touchend', (e) => {
            if (activeTool === 'pan') return;
            e.preventDefault();
            drawing = false;
        }, { passive: false });

        canvas.addEventListener('touchcancel', () => {
            drawing = false;
        });
    }
    
    function spawnTextBox(wrapper, x, y) {
        wrapper.dataset.annotationDirty = 'true';
        const div = document.createElement('div');
        div.className = 'text-annotation';
        div.contentEditable = true;
        div.style.left = `${x}px`;
        div.style.top = `${y}px`;
        div.style.fontSize = `${16 * currentScale}px`;
        
        wrapper.appendChild(div);
        
        // Save state for Undo
        undoStack.push({
            type: 'text',
            element: div
        });
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        
        div.focus();
        
        div.addEventListener('blur', () => {
            if (div.innerText.trim() === '') div.remove();
        });
    }

    // Wiring up listeners for the list cards
    function attachPdfListeners() {
        document.querySelectorAll('.pdf-card').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.pdf-card').forEach(c => c.classList.remove('active-paper'));
                card.classList.add('active-paper');
                
                currentPdfUrl = card.getAttribute('data-pdf-url');
                currentMsUrl = card.getAttribute('data-ms-url');
                const name = card.getAttribute('data-pdf-name');
                const displayName = name.replace('.pdf', '');
                
                // Store subtopic and boss states to toggle button
                const subcat = card.getAttribute('data-subcat') || '';
                const isBoss = card.getAttribute('data-boss') === 'true';
                if (completeToggle) {
                    completeToggle.setAttribute('data-subcat', subcat);
                    completeToggle.setAttribute('data-boss', isBoss);
                }
                
                // Toggle Show/Hide for Markscheme and Complete buttons
                markschemeToggle.classList.remove('active');
                if (currentMode === 'papers' && currentMsUrl) {
                    markschemeToggle.classList.remove('hidden');
                } else {
                    markschemeToggle.classList.add('hidden');
                }
                
                if (currentMode === 'practice' || currentMode === 'topics') {
                    completeToggle.classList.remove('hidden');
                    updateCompleteButtonUI(currentPdfUrl);
                } else {
                    completeToggle.classList.add('hidden');
                }
                
                // Update Breadcrumb including PDF name
                if (activeCategory) {
                    if (currentMode === 'practice') {
                        const [category, subtopic] = activeCategory.split('|||');
                        updateBreadcrumbs([
                            getSubjectLabel(),
                            category,
                            subtopic,
                            displayName
                        ]);
                    } else if (currentMode === 'topics') {
                        updateBreadcrumbs([
                            getSubjectLabel(),
                            activeCategory,
                            displayName
                        ]);
                    } else if (currentMode === 'papers') {
                        updateBreadcrumbs([
                            getSubjectLabel(),
                            'Past Papers',
                            activeCategory === 'Save My Exams' ? 'Mock Exams & Predictions' : `${activeCategory} Exams`,
                            displayName
                        ]);
                    }
                } else {
                    updateBreadcrumbs([
                        getSubjectLabel(),
                        displayName
                    ]);
                }
                
                viewerTitle.textContent = displayName;
                saveListViewState();
                mainContentArea.classList.add('viewing-pdf');
                pushMobileHistoryState('pdf');
                
                renderPdf(currentPdfUrl);
            });
        });
    }

    function closePdfViewer() {
        currentRenderId++;
        disconnectPdfPageObserver();
        cancelActivePdfRender();
        mainContentArea.classList.remove('viewing-pdf');
        pdfContainer.innerHTML = ''; // Clear memory
        currentPdfDoc = null;
        document.querySelectorAll('.pdf-card').forEach(c => c.classList.remove('active-paper'));
        if (completeToggle) completeToggle.classList.add('hidden');
        if (document.fullscreenElement) {
            document.exitFullscreen();
        }
        const listPane = document.querySelector('.list-pane');
        if (listPane) {
            listPane.style.flex = '';
        }
    }

    function restoreListAfterPdf() {
        closePdfViewer();

        // Restore saved list-pane view state context
        if (lastListViewState) {
            activeView = lastListViewState.activeView;
            activeCategory = lastListViewState.activeCategory;
            currentMode = lastListViewState.currentMode;

            if (activeView === 'home') {
                renderDojoHome();
            } else if (lastListViewState.isReviewQueue) {
                renderReviewQueue();
            } else if (activeCategory) {
                if (currentMode === 'topics') renderTopicCategory(activeCategory);
                else if (currentMode === 'papers') renderPaperCategory(activeCategory);
                else if (currentMode === 'practice') renderPracticeCategory(activeCategory);
            } else {
                renderDashboard();
            }
        } else if (activeCategory) {
            if (currentMode === 'topics') renderTopicCategory(activeCategory);
            else if (currentMode === 'papers') renderPaperCategory(activeCategory);
            else if (currentMode === 'practice') renderPracticeCategory(activeCategory);
        } else {
            renderDashboard();
        }
    }

    function requestPdfClose() {
        if (blitzState.active) {
            if (!confirm("Exit Blitz challenge? Any progress on this run will be lost.")) {
                return;
            }
            endBlitzChallenge(false);
            return;
        }

        if (window.StudyIBMobileNavigation && window.StudyIBMobileNavigation.back()) {
            return;
        }

        restoreListAfterPdf();
    }

    closeViewerBtn.addEventListener('click', requestPdfClose);
    if (mobileViewerBackBtn) {
        mobileViewerBackBtn.addEventListener('click', requestPdfClose);
    }

    window.addEventListener('popstate', () => {
        if (!isMobileUI()) return;
        handlingMobileHistoryPop = true;
        try {
            if (mainContentArea.classList.contains('viewing-pdf')) {
                restoreListAfterPdf();
                return;
            }

            const atomWorkspace = document.getElementById('atomWorkspace');
            if (atomWorkspace && !atomWorkspace.classList.contains('hidden')) {
                const atomEditor = document.getElementById('atomEditorView');
                if (atomEditor && !atomEditor.classList.contains('hidden') && window.AtomWorkspace) {
                    window.AtomWorkspace.closeEditor();
                } else {
                    atomWorkspace.classList.add('hidden');
                    mainContentArea.classList.remove('hidden');
                    updateSidebarActiveState();
                }
            }
        } finally {
            handlingMobileHistoryPop = false;
        }
    });

    if (launchAtomBtn) {
        launchAtomBtn.addEventListener('click', () => {
            if (currentPdfUrl) {
                closePdfViewer();
                const atomWorkspace = document.getElementById('atomWorkspace');
                const mainContent = document.getElementById('mainContentArea');
                if (mainContent) mainContent.classList.add('hidden');
                if (atomWorkspace) atomWorkspace.classList.remove('hidden');

                if (window.AtomWorkspace) {
                    window.AtomWorkspace.launchWithPDF(currentPdfUrl, viewerTitle.textContent || "Imported Exam Paper");
                }
            }
        });
    }

    // --- Challenges & Blitz Core Logic ---
    function getAllPracticeQuestions() {
        const pData = getPracticeData();
        let allQs = [];
        for (const cat of Object.keys(pData)) {
            for (const subcat of Object.keys(pData[cat])) {
                const questions = pData[cat][subcat];
                if (Array.isArray(questions)) {
                    questions.forEach(q => {
                        allQs.push({
                            ...q,
                            category: cat,
                            subtopic: subcat
                        });
                    });
                }
            }
        }
        return allQs;
    }

    function openPdfForChallenge(pdfUrl, name) {
        currentPdfUrl = pdfUrl;
        currentMsUrl = '';
        const displayName = name.replace('.pdf', '');
        
        if (completeToggle) completeToggle.classList.add('hidden');
        if (markschemeToggle) markschemeToggle.classList.add('hidden');
        
        updateBreadcrumbs([
            getSubjectLabel(),
            blitzState.active ? "Blitz Challenge" : "Daily Challenge",
            displayName
        ]);
        
        viewerTitle.textContent = displayName;
        saveListViewState();
        mainContentArea.classList.add('viewing-pdf');
        pushMobileHistoryState('pdf');
        renderPdf(currentPdfUrl);
    }

    function launchDailyChallenge() {
        const allQs = getAllPracticeQuestions();
        if (allQs.length === 0) {
            alert("No practice questions found for this subject.");
            return;
        }
        const today = new Date();
        const dateStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let hash = 0;
        for (let i = 0; i < dateStr.length; i++) {
            hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
        }
        const idx = Math.abs(hash) % allQs.length;
        const q = allQs[idx];
        
        activeDailyChallengeFile = q.filepath || q.qp_path;
        openPdfForChallenge(q.filepath || q.qp_path, q.filename || q.qp_name);
        showNotification("🎯 Daily Challenge started! Mark complete to earn bonus points.", "info");
    }

    function startBlitzChallenge() {
        const allQs = getAllPracticeQuestions();
        if (allQs.length < 5) {
            alert("Need at least 5 questions in the practice database to start Blitz Mode.");
            return;
        }
        
        const shuffled = [...allQs].sort(() => 0.5 - Math.random());
        const blitzQs = shuffled.slice(0, 5);
        
        blitzState.active = true;
        blitzState.questions = blitzQs;
        blitzState.currentIndex = 0;
        blitzState.completedCount = 0;
        blitzState.timeRemaining = 180; // 3 minutes
        
        const blitzHeader = document.getElementById('blitzHeader');
        if (blitzHeader) {
            blitzHeader.classList.remove('hidden');
        }
        
        updateBlitzHeaderUI();
        updateBlitzTimerUI();
        
        if (blitzState.timerInterval) clearInterval(blitzState.timerInterval);
        blitzState.timerInterval = setInterval(() => {
            blitzState.timeRemaining--;
            if (blitzState.timeRemaining <= 0) {
                clearInterval(blitzState.timerInterval);
                blitzState.timerInterval = null;
                endBlitzChallenge(false);
            } else {
                updateBlitzTimerUI();
            }
        }, 1000);
        
        const firstQ = blitzQs[0];
        openPdfForChallenge(firstQ.filepath || firstQ.qp_path, firstQ.filename || firstQ.qp_name);
        showNotification("⚡ Blitz Mode started! Solve all 5 questions before time runs out!", "info");
    }

    function nextBlitzQuestion() {
        blitzState.currentIndex++;
        if (blitzState.currentIndex < blitzState.questions.length) {
            updateBlitzHeaderUI();
            const nextQ = blitzState.questions[blitzState.currentIndex];
            openPdfForChallenge(nextQ.filepath || nextQ.qp_path, nextQ.filename || nextQ.qp_name);
        } else {
            endBlitzChallenge(true);
        }
    }

    function endBlitzChallenge(completedAll) {
        if (blitzState.timerInterval) {
            clearInterval(blitzState.timerInterval);
            blitzState.timerInterval = null;
        }
        
        blitzState.active = false;
        
        const blitzHeader = document.getElementById('blitzHeader');
        if (blitzHeader) {
            blitzHeader.classList.add('hidden');
        }
        
        if (completedAll) {
            let blitzRewardAwarded = false;
            if (window.gamification) {
                const today = window.gamification.getFormattedDate(new Date());
                blitzRewardAwarded = window.gamification.awardRewardOnce(`blitz:${today}`, 100, 25, "Blitz Master Challenge completed!");
            }
            const rewardMessage = blitzRewardAwarded
                ? 'Bonus Awarded: +100 XP & +25 DP Points!'
                : 'Daily Blitz bonus already claimed. Your completion still counts.';
            alert(`⚡ Blitz Complete!\n\nYou solved ${blitzState.completedCount} out of 5 questions within the time limit!\n\n${rewardMessage}`);
        } else {
            alert(`⏰ Time's Up / Exit!\n\nBlitz challenge ended.\n\nYou completed ${blitzState.completedCount} out of 5 questions.`);
        }
        
        // Close viewer cleanly
        closePdfViewer();
        
        renderDashboard();
    }

    function updateBlitzHeaderUI() {
        const blitzIndexText = document.getElementById('blitzIndexText');
        if (blitzIndexText) {
            blitzIndexText.textContent = blitzState.currentIndex + 1;
        }
    }
    
    function updateBlitzTimerUI() {
        const blitzTimerText = document.getElementById('blitzTimerText');
        if (blitzTimerText) {
            const minutes = Math.floor(blitzState.timeRemaining / 60);
            const seconds = blitzState.timeRemaining % 60;
            blitzTimerText.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    markschemeToggle.addEventListener('click', () => {
        if (!currentMsUrl) return;
        
        markschemeToggle.classList.toggle('active');
        if (markschemeToggle.classList.contains('active')) {
            renderPdf(currentMsUrl);
            if (window.gamification) {
                window.gamification.awardRewardOnce(`markscheme:${currentPdfUrl}`, 20, 0, "Reviewed a markscheme");
            }
        } else {
            renderPdf(currentPdfUrl);
        }
    });

    if (completeToggle) {
        completeToggle.addEventListener('click', () => {
            if (currentPdfUrl) {
                const subcat = completeToggle.getAttribute('data-subcat') || '';
                const isBoss = completeToggle.getAttribute('data-boss') === 'true';
                toggleQuestionCompletion(currentPdfUrl, subcat, isBoss);
            }
        });
    }

    // --- Wire up Unified Blitz / Mock Modal Control Listeners ---
    const blitzCompleteBtn = document.getElementById('blitzCompleteBtn');
    if (blitzCompleteBtn) {
        blitzCompleteBtn.addEventListener('click', () => {
            if (blitzState.active) {
                const currentQ = blitzState.questions[blitzState.currentIndex];
                const filepath = currentQ.filepath || currentQ.qp_path;
                if (!isQuestionCompleted(filepath)) {
                    setStoredQuestionCompletion(filepath, true);
                    blitzState.completedCount++;
                    if (window.gamification) {
                        const reward = getQuestionReward(filepath);
                        window.gamification.awardRewardOnce(`question:${filepath}`, reward.xp, 0, reward.completedReason);
                    }
                }
                nextBlitzQuestion();
            } else if (mockState.active) {
                const currentQ = mockState.questions[mockState.currentIndex];
                const filepath = currentQ.filepath || currentQ.qp_path;
                if (!isQuestionCompleted(filepath)) {
                    setStoredQuestionCompletion(filepath, true);
                    mockState.completedCount++;
                }
                nextMockQuestion();
            }
        });
    }
    const blitzSkipBtn = document.getElementById('blitzSkipBtn');
    if (blitzSkipBtn) {
        blitzSkipBtn.addEventListener('click', () => {
            if (blitzState.active) {
                nextBlitzQuestion();
            } else if (mockState.active) {
                nextMockQuestion();
            }
        });
    }
    const blitzExitBtn = document.getElementById('blitzExitBtn');
    if (blitzExitBtn) {
        blitzExitBtn.addEventListener('click', () => {
            if (blitzState.active) {
                if (confirm("Are you sure you want to exit Blitz Mode? Any progress on this run will be lost.")) {
                    endBlitzChallenge(false);
                }
            } else if (mockState.active) {
                if (confirm("Are you sure you want to exit the Mock Exam? Your results will be saved up to this point.")) {
                    endMockExam();
                }
            }
        });
    }

    // --- Search Logic ---
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (query === '') {
            if (activeCategory) {
                if (currentMode === 'topics') renderTopicCategory(activeCategory);
                else if (currentMode === 'papers') renderPaperCategory(activeCategory);
                else if (currentMode === 'practice') renderPracticeCategory(activeCategory);
            } else {
                renderDashboard();
            }
            return;
        }

        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        currentCategoryTitle.textContent = 'Search Results';
        let totalFiles = 0;
        let html = '';

        if (currentMode === 'topics') {
            for (const [category, subcategories] of Object.entries(getSyllabusData())) {
                for (const [subcat, files] of Object.entries(subcategories)) {
                    const filtered = files.filter(f => f.filename.toLowerCase().includes(query) || subcat.toLowerCase().includes(query) || category.toLowerCase().includes(query));
                    if (filtered.length === 0) continue;
                    totalFiles += filtered.length;
                    html += `<div class="subtopic-section"><h3 class="subtopic-title">${category} > ${subcat}</h3><div class="cards-grid">
                        ${filtered.map(file => `
                            <button type="button" class="pdf-card" data-pdf-url="${file.filepath}" data-pdf-name="${file.filename}">
                                ${getPdfIcon()}
                                <div class="pdf-info"><div class="pdf-name">${file.filename.replace('.pdf', '')}</div><div class="pdf-meta">Topic Snippet</div></div>
                            </button>
                        `).join('')}
                    </div></div>`;
                }
            }
        } else if (currentMode === 'papers') {
            for (const [year, sessions] of Object.entries(getFullPapersData())) {
                for (const [session, files] of Object.entries(sessions)) {
                    const filtered = files.filter(f => f.name.toLowerCase().includes(query) || session.toLowerCase().includes(query) || year.includes(query));
                    if (filtered.length === 0) continue;
                    totalFiles += filtered.length;
                    html += `<div class="subtopic-section"><h3 class="subtopic-title">${year} ${session}</h3><div class="cards-grid">
                        ${filtered.map(file => `
                            <button type="button" class="pdf-card" data-pdf-url="${file.qp_path}" data-ms-url="${file.ms_path || ''}" data-pdf-name="${file.name}">
                                ${getPdfIcon()}
                                <div class="pdf-info"><div class="pdf-name">${file.name}</div><div class="pdf-meta">Full Paper</div></div>
                            </button>
                        `).join('')}
                    </div></div>`;
                }
            }
        } else if (currentMode === 'practice') {
            for (const [category, subtopics] of Object.entries(getPracticeData())) {
                for (const [subtopic, questions] of Object.entries(subtopics)) {
                    const filtered = questions.filter(q => q.source.toLowerCase().includes(query) || subtopic.toLowerCase().includes(query) || category.toLowerCase().includes(query) || q.qnum.toString().includes(query));
                    if (filtered.length === 0) continue;
                    totalFiles += filtered.length;
                    html += `<div class="subtopic-section"><h3 class="subtopic-title">${category} > ${subtopic}</h3><div class="cards-grid">
                        ${filtered.map(q => `
                            <button type="button" class="pdf-card" data-pdf-url="${q.filepath}" data-full-paper="${q.full_paper_path}" data-pdf-name="${q.filename}">
                                ${getPdfIcon()}
                                <div class="pdf-info"><div class="pdf-name">${q.source} Q${q.qnum}</div><div class="pdf-meta">${(getPaperDefinitions()[q.paper_type] || getPaperDefinitions().UNKNOWN).meta}</div></div>
                            </button>
                        `).join('')}
                    </div></div>`;
                }
            }

        }

        if (html === '') {
            html = `<div class="empty-state"><h3>No results found</h3><p>Try adjusting your search terms.</p></div>`;
            categoryStats.textContent = '';
        } else {
            categoryStats.textContent = `${totalFiles} result${totalFiles !== 1 ? 's' : ''}`;
        }
        papersGrid.innerHTML = html;
        attachPdfListeners();
    });
}

    // --- Timer Logic ---
    function formatTime(totalSeconds) {
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function updateTimerDisplay() {
        timerDisplay.textContent = formatTime(timerSeconds);
        if (timerSeconds <= 60 && timerSeconds > 0) {
            examTimer.classList.add('danger');
        } else {
            examTimer.classList.remove('danger');
        }
    }

    startTimerBtn.addEventListener('click', () => {
        const mins = parseInt(timerInput.value, 10);
        if (isNaN(mins) || mins <= 0) return;
        
        timerSeconds = mins * 60;
        updateTimerDisplay();
        
        settingsModal.classList.add('hidden');
        examTimer.classList.remove('hidden');
        
        isTimerRunning = true;
        timerPlayPause.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="10" y1="15" x2="10" y2="9"></line><line x1="14" y1="15" x2="14" y2="9"></line><circle cx="12" cy="12" r="10"></circle></svg>';
        
        if (window.gamification) {
            const today = window.gamification.getFormattedDate(new Date());
            window.gamification.awardRewardOnce(`timer:${today}`, 15, 0, `Started a ${mins}-minute exam session`);
        }
        
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (!isTimerRunning) return;
            if (timerSeconds > 0) {
                timerSeconds--;
                updateTimerDisplay();
            } else {
                clearInterval(timerInterval);
                timerDisplay.textContent = "Time's Up!";
                examTimer.classList.add('danger');
            }
        }, 1000);
    });

    timerPlayPause.addEventListener('click', () => {
        if (timerSeconds <= 0) return;
        isTimerRunning = !isTimerRunning;
        if (isTimerRunning) {
            timerPlayPause.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="10" y1="15" x2="10" y2="9"></line><line x1="14" y1="15" x2="14" y2="9"></line><circle cx="12" cy="12" r="10"></circle></svg>';
        } else {
            timerPlayPause.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        }
    });

    timerStop.addEventListener('click', () => {
        clearInterval(timerInterval);
        isTimerRunning = false;
        examTimer.classList.add('hidden');
        examTimer.classList.remove('danger');
    });

    // =============================================
    //  MOCK PAPER GENERATOR
    // =============================================
    const mockGeneratorModal = document.getElementById('mockGeneratorModal');
    const closeMockGeneratorBtn = document.getElementById('closeMockGeneratorBtn');
    const mockPaperTypes = document.getElementById('mockPaperTypes');
    const mockQuestionCount = document.getElementById('mockQuestionCount');
    const mockCountDisplay = document.getElementById('mockCountDisplay');
    const mockTopicsGrid = document.getElementById('mockTopicsGrid');
    const mockTimerInput = document.getElementById('mockTimerInput');
    const generateMockBtn = document.getElementById('generateMockBtn');
    const mockResultsOverlay = document.getElementById('mockResultsOverlay');
    const closeMockResultsBtn = document.getElementById('closeMockResultsBtn');

    let mockSelectedPaperType = 'P1';

    if (closeMockGeneratorBtn) {
        closeMockGeneratorBtn.addEventListener('click', () => mockGeneratorModal.classList.add('hidden'));
    }
    if (mockGeneratorModal) {
        mockGeneratorModal.addEventListener('click', (e) => {
            if (e.target === mockGeneratorModal) mockGeneratorModal.classList.add('hidden');
        });
    }
    if (closeMockResultsBtn) {
        closeMockResultsBtn.addEventListener('click', () => {
            mockResultsOverlay.classList.add('hidden');
            renderDashboard();
        });
    }

    // Paper type toggle
    if (mockPaperTypes) {
        mockPaperTypes.addEventListener('click', (e) => {
            const btn = e.target.closest('.mock-paper-btn');
            if (!btn) return;
            mockPaperTypes.querySelectorAll('.mock-paper-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            mockSelectedPaperType = btn.getAttribute('data-paper');
            
            // Adjust defaults
            if (mockSelectedPaperType === 'P1') {
                mockQuestionCount.max = 40;
                mockQuestionCount.value = 30;
                mockTimerInput.value = 60;
            } else if (mockSelectedPaperType === 'P2') {
                mockQuestionCount.max = 10;
                mockQuestionCount.value = 5;
                mockTimerInput.value = 75;
            } else {
                mockQuestionCount.max = 30;
                mockQuestionCount.value = 15;
                mockTimerInput.value = 90;
            }
            mockCountDisplay.textContent = mockQuestionCount.value;
        });
    }

    // Slider
    if (mockQuestionCount) {
        mockQuestionCount.addEventListener('input', () => {
            mockCountDisplay.textContent = mockQuestionCount.value;
        });
    }

    function openMockGeneratorModal() {
        // Populate topics grid from practice data
        const pData = getPracticeData();
        const topics = sortCategories(Object.keys(pData));
        if (topics.length === 0) {
            showNotification('Question-level mock generation is not available for this subject.', 'info');
            return;
        }
        
        let gridHTML = '';
        topics.forEach(topic => {
            const qCount = Object.values(pData[topic]).reduce((sum, qs) => sum + qs.length, 0);
            gridHTML += `
                <label class="mock-topic-checkbox checked">
                    <input type="checkbox" value="${topic}" checked>
                    <span>${topic} (${qCount})</span>
                </label>
            `;
        });
        mockTopicsGrid.innerHTML = gridHTML;

        // Toggle checked visual
        mockTopicsGrid.querySelectorAll('.mock-topic-checkbox input').forEach(cb => {
            cb.addEventListener('change', () => {
                cb.closest('.mock-topic-checkbox').classList.toggle('checked', cb.checked);
            });
        });

        mockGeneratorModal.classList.remove('hidden');
    }

    if (generateMockBtn) {
        generateMockBtn.addEventListener('click', () => {
            const selectedTopics = [];
            mockTopicsGrid.querySelectorAll('input:checked').forEach(cb => {
                selectedTopics.push(cb.value);
            });

            if (selectedTopics.length === 0) {
                showNotification('Please select at least one topic.', 'error');
                return;
            }

            const count = parseInt(mockQuestionCount.value, 10);
            const timeMinutes = parseInt(mockTimerInput.value, 10);

            // Gather questions from selected topics
            const pData = getPracticeData();
            let pool = [];
            selectedTopics.forEach(topic => {
                if (!pData[topic]) return;
                for (const [sub, questions] of Object.entries(pData[topic])) {
                    questions.forEach(q => {
                        if (mockSelectedPaperType === 'mixed' || q.paper_type === mockSelectedPaperType) {
                            pool.push({ ...q, _topic: topic, _sub: sub });
                        }
                    });
                }
            });

            if (pool.length < count) {
                showNotification(`Only ${pool.length} questions available. Adjust your filters.`, 'error');
                return;
            }

            // Weighted selection based on IB HL topic priorities
            const selected = weightedSample(pool, count);

            mockGeneratorModal.classList.add('hidden');
            startMockExam(selected, timeMinutes);
        });
    }

    function weightedSample(pool, count) {
        // Assign weights to each question based on its topic
        const weighted = pool.map(q => {
            const w = IB_HL_TOPIC_WEIGHTS[q._topic] || DEFAULT_TOPIC_WEIGHT;
            return { q, weight: w };
        });

        const selected = [];
        const remaining = [...weighted];

        for (let i = 0; i < count && remaining.length > 0; i++) {
            const totalWeight = remaining.reduce((sum, item) => sum + item.weight, 0);
            let random = Math.random() * totalWeight;
            let chosenIdx = 0;
            for (let j = 0; j < remaining.length; j++) {
                random -= remaining[j].weight;
                if (random <= 0) {
                    chosenIdx = j;
                    break;
                }
            }
            selected.push(remaining[chosenIdx].q);
            remaining.splice(chosenIdx, 1);
        }

        return selected;
    }

    function startMockExam(questions, timeMinutes) {
        mockState.active = true;
        mockState.questions = questions;
        mockState.completedCount = 0;
        mockState.totalTime = timeMinutes * 60;
        mockState.timeRemaining = timeMinutes * 60;
        mockState.paperType = mockSelectedPaperType;
        mockState.currentIndex = 0;
        mockState.clientEventId = `mock:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
        mockState.startedAt = new Date().toISOString();

        // Execute PDF compilation check (detect if inside Electron with Node)
        let exec, fs;
        if (typeof require !== 'undefined') {
            try {
                exec = require('child_process').exec;
                fs = require('fs');
            } catch (e) {
                console.error("Node modules not loaded", e);
            }
        }

        mockState.isWebFallback = !(exec && fs);

        const blitzHeader = document.getElementById('blitzHeader');
        const blitzControls = document.getElementById('blitzControls');
        const mockControls = document.getElementById('mockControls');
        const progressText = document.getElementById('blitzProgressText');
        const togglesContainer = document.getElementById('mockTogglesContainer');

        if (blitzHeader) blitzHeader.classList.remove('hidden');

        if (mockState.isWebFallback) {
            // Web Fallback: question-by-question pagination
            if (togglesContainer) togglesContainer.classList.add('hidden');
            if (blitzControls) blitzControls.classList.remove('hidden');
            if (mockControls) mockControls.classList.add('hidden');
            if (progressText) progressText.innerHTML = `📝 Mock Exam: Question <span id="blitzIndexText">1</span> of ${questions.length}`;
            
            updateMockHeaderUI();
        } else {
            // Compiled single PDF mode (Electron)
            if (togglesContainer) {
                togglesContainer.classList.remove('hidden');
                let pillsHtml = '';
                questions.forEach((q, idx) => {
                    pillsHtml += `<button type="button" class="mock-q-pill" data-idx="${idx}" title="Mark Question ${idx + 1} Solved" aria-pressed="false">Q${idx + 1}</button>`;
                });
                togglesContainer.innerHTML = pillsHtml;

                togglesContainer.querySelectorAll('.mock-q-pill').forEach(pill => {
                    pill.addEventListener('click', () => {
                        pill.classList.toggle('active');
                        pill.setAttribute('aria-pressed', String(pill.classList.contains('active')));
                    });
                });
            }
            if (blitzControls) blitzControls.classList.add('hidden');
            if (mockControls) mockControls.classList.remove('hidden');
            if (progressText) progressText.innerHTML = `📝 Mock Exam (${questions.length} Qs)`;
        }

        updateMockTimerUI();

        if (mockState.timerInterval) clearInterval(mockState.timerInterval);
        mockState.timerInterval = setInterval(() => {
            mockState.timeRemaining--;
            if (mockState.timeRemaining <= 0) {
                clearInterval(mockState.timerInterval);
                mockState.timerInterval = null;
                endMockExam();
            } else {
                updateMockTimerUI();
            }
        }, 1000);

        const loadCurrentWebQuestion = () => {
            const q = questions[mockState.currentIndex];
            openPdfForChallenge(q.filepath || q.qp_path, q.filename || q.qp_name);
        };

        if (!mockState.isWebFallback) {
            showNotification("Compiling clean exam pages...", "info");
            if (!fs.existsSync('Content/Mocks')) {
                fs.mkdirSync('Content/Mocks', { recursive: true });
            }

            const jsonPath = 'Content/Mocks/temp_mock_q.json';
            const pdfPath = 'Content/Mocks/temp_mock.pdf';

            try {
                fs.writeFileSync(jsonPath, JSON.stringify(questions, null, 2), 'utf-8');
                const cmd = `python3 Utils/generate_mock_pdf.py "${jsonPath}" "${pdfPath}"`;
                exec(cmd, (err, stdout, stderr) => {
                    if (err) {
                        console.error(err, stderr);
                        showNotification("Stitch failed. Showing individual questions.", "error");
                        mockState.isWebFallback = true;
                        if (togglesContainer) togglesContainer.classList.add('hidden');
                        if (blitzControls) blitzControls.classList.remove('hidden');
                        if (mockControls) mockControls.classList.add('hidden');
                        if (progressText) progressText.innerHTML = `📝 Mock Exam: Question <span id="blitzIndexText">1</span> of ${questions.length}`;
                        updateMockHeaderUI();
                        loadCurrentWebQuestion();
                    } else {
                        showNotification("Stitched Mock Exam loaded!", "success");
                        openPdfForChallenge(pdfPath, 'Stitched Mock Exam.pdf');
                    }
                });
            } catch (err) {
                console.error(err);
                mockState.isWebFallback = true;
                if (togglesContainer) togglesContainer.classList.add('hidden');
                if (blitzControls) blitzControls.classList.remove('hidden');
                if (mockControls) mockControls.classList.add('hidden');
                if (progressText) progressText.innerHTML = `📝 Mock Exam: Question <span id="blitzIndexText">1</span> of ${questions.length}`;
                updateMockHeaderUI();
                loadCurrentWebQuestion();
            }
        } else {
            loadCurrentWebQuestion();
        }

        showNotification(`📝 Mock Exam started! ${questions.length} questions, ${timeMinutes} min timer.`, 'info');
    }

    function updateMockHeaderUI() {
        const blitzIndexText = document.getElementById('blitzIndexText');
        if (blitzIndexText) blitzIndexText.textContent = mockState.currentIndex + 1;
    }

    function loadCurrentWebQuestion() {
        const q = mockState.questions[mockState.currentIndex];
        openPdfForChallenge(q.filepath || q.qp_path, q.filename || q.qp_name);
    }

    function nextMockQuestion() {
        mockState.currentIndex++;
        if (mockState.currentIndex < mockState.questions.length) {
            updateMockHeaderUI();
            loadCurrentWebQuestion();
        } else {
            endMockExam();
        }
    }

    function updateMockTimerUI() {
        const blitzTimerText = document.getElementById('blitzTimerText');
        if (blitzTimerText) {
            const m = Math.floor(mockState.timeRemaining / 60);
            const s = mockState.timeRemaining % 60;
            blitzTimerText.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
    }

    function endMockExam() {
        if (mockState.timerInterval) {
            clearInterval(mockState.timerInterval);
            mockState.timerInterval = null;
        }

        // Tally solved checkboxes (for Electron) or count completed (for Web)
        if (!mockState.isWebFallback) {
            const togglesContainer = document.getElementById('mockTogglesContainer');
            if (togglesContainer) {
                const activePills = togglesContainer.querySelectorAll('.mock-q-pill.active');
                mockState.completedCount = activePills.length;
                togglesContainer.classList.add('hidden');
                togglesContainer.innerHTML = '';
            }
        }

        mockState.active = false;

        const blitzHeader = document.getElementById('blitzHeader');
        if (blitzHeader) blitzHeader.classList.add('hidden');

        // Restore header buttons
        const blitzControls = document.getElementById('blitzControls');
        const mockControls = document.getElementById('mockControls');
        if (blitzControls) blitzControls.classList.remove('hidden');
        if (mockControls) mockControls.classList.add('hidden');

        // Close viewer
        closePdfViewer();

        // Calculate score
        const pct = mockState.questions.length > 0 ? Math.round((mockState.completedCount / mockState.questions.length) * 100) : 0;
        const timeUsed = mockState.totalTime - mockState.timeRemaining;
        const m = Math.floor(timeUsed / 60);
        const s = timeUsed % 60;

        document.getElementById('mockResultsScore').textContent = `${pct}%`;
        document.getElementById('mockResultsSubtitle').textContent = `${mockState.completedCount} of ${mockState.questions.length} questions completed`;
        document.getElementById('mockStatCompleted').textContent = mockState.completedCount;
        document.getElementById('mockStatTotal').textContent = mockState.questions.length;
        document.getElementById('mockStatTime').textContent = `${m}:${s.toString().padStart(2, '0')}`;
        mockResultsOverlay.classList.remove('hidden');

        if (window.studyIBAccount?.signedIn && mockState.completedCount > 0) {
            window.studyIBAccount.recordMockResult({
                clientEventId: mockState.clientEventId,
                subject: currentSubject,
                paperType: mockState.paperType,
                totalQuestions: mockState.questions.length,
                completedQuestions: mockState.completedCount,
                scorePercent: pct,
                durationSeconds: timeUsed,
                topicIds: []
            }).catch(error => showNotification(error.message || 'Mock result will sync when you are back online.', 'error'));
        } else if (window.gamification && mockState.completedCount > 0) {
            const xp = mockState.completedCount * 25;
            window.gamification.awardRewardOnce(mockState.clientEventId || `mock:${Date.now()}`, xp, 0, `Mock Exam: ${mockState.completedCount}/${mockState.questions.length} completed`);
        }
    }

    // Attach mock header buttons
    const mockFinishBtn = document.getElementById('mockFinishBtn');
    if (mockFinishBtn) {
        mockFinishBtn.addEventListener('click', () => {
            if (confirm('Finish Mock Exam? Your score will be tallied.')) {
                endMockExam();
            }
        });
    }
    const mockExitBtn = document.getElementById('mockExitBtn');
    if (mockExitBtn) {
        mockExitBtn.addEventListener('click', () => {
            if (confirm('Exit Mock Exam? Any progress on this run will be lost.')) {
                if (mockState.timerInterval) {
                    clearInterval(mockState.timerInterval);
                    mockState.timerInterval = null;
                }
                mockState.active = false;
                
                const togglesContainer = document.getElementById('mockTogglesContainer');
                if (togglesContainer) {
                    togglesContainer.classList.add('hidden');
                    togglesContainer.innerHTML = '';
                }

                const blitzHeader = document.getElementById('blitzHeader');
                if (blitzHeader) blitzHeader.classList.add('hidden');

                const blitzControls = document.getElementById('blitzControls');
                const mockControls = document.getElementById('mockControls');
                if (blitzControls) blitzControls.classList.remove('hidden');
                if (mockControls) mockControls.classList.add('hidden');

                closePdfViewer();
                renderDashboard();
            }
        });
    }



    // =============================================
    //  NOTIFICATION SYSTEM
    // =============================================
    function showNotification(message, type = 'info') {
        // Remove existing notification
        const existing = document.querySelector('.notification-pill');
        if (existing) existing.remove();

        const pill = document.createElement('div');
        pill.className = `notification-pill ${type}`;
        pill.textContent = message;
        document.body.appendChild(pill);

        setTimeout(() => {
            pill.style.opacity = '0';
            pill.style.transform = 'translateY(-20px)';
            pill.style.transition = 'all 0.3s ease';
            setTimeout(() => pill.remove(), 300);
        }, 3000);
    }

    // =============================================
    //  SCORE PREDICTOR & SCALER LOGIC
    // =============================================
    const predictorModal = document.getElementById('predictorModal');
    const predictorBtn = document.getElementById('predictorBtn');
    const closePredictorBtn = document.getElementById('closePredictorBtn');
    
    const predictorSubject = document.getElementById('predictorSubject');
    const predictorSession = document.getElementById('predictorSession');
    const predictorP1 = document.getElementById('predictorP1');
    const predictorP2 = document.getElementById('predictorP2');
    
    const predictedPercent = document.getElementById('predictedPercent');
    const predictedGrade = document.getElementById('predictedGrade');
    const predictedOssd = document.getElementById('predictedOssd');
    const predictorMarker = document.getElementById('predictorMarker');
    const predictorLabels = document.getElementById('predictorLabels');

    if (predictorBtn && predictorModal) {
        predictorBtn.addEventListener('click', () => {
            // Pre-select based on active subject
            let currentSubVal = 'physics';
            if (currentSubject.includes('chemistry')) {
                currentSubVal = 'chemistry';
            }
            predictorSubject.value = currentSubVal;
            
            // Populate sessions
            populatePredictorSessions();
            
            // Calculate initial
            calculateProjectedScores();
            
            predictorModal.classList.remove('hidden');
        });
    }

    if (closePredictorBtn && predictorModal) {
        closePredictorBtn.addEventListener('click', () => {
            predictorModal.classList.add('hidden');
        });
    }

    if (predictorSubject) {
        predictorSubject.addEventListener('change', () => {
            populatePredictorSessions();
            calculateProjectedScores();
        });
    }
    
    if (predictorSession) {
        predictorSession.addEventListener('change', calculateProjectedScores);
    }
    if (predictorP1) {
        predictorP1.addEventListener('input', calculateProjectedScores);
    }
    if (predictorP2) {
        predictorP2.addEventListener('input', calculateProjectedScores);
    }

    function populatePredictorSessions() {
        if (!predictorSubject || !predictorSession) return;
        const sub = predictorSubject.value; // 'physics' or 'chemistry'
        const sessions = Object.keys(window.IB_BOUNDARIES_DATA[sub] || {}).sort();
        
        // Remove 'Average' if present and put it at the top
        const hasAvg = sessions.includes('Average');
        const sortedSessions = sessions.filter(s => s !== 'Average');
        sortedSessions.reverse();
        if (hasAvg) {
            sortedSessions.unshift('Average');
        }

        predictorSession.innerHTML = sortedSessions.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    function calculateProjectedScores() {
        if (!predictorSubject || !predictorSession || !predictorP1 || !predictorP2) return;
        
        const sub = predictorSubject.value;
        const session = predictorSession.value;
        const p1Score = Math.max(0, Math.min(40, parseFloat(predictorP1.value) || 0));
        const p2Score = Math.max(0, Math.min(90, parseFloat(predictorP2.value) || 0));
        
        // Boundaries array: [G1, G2, G3, G4, G5, G6, G7]
        const boundaries = (window.IB_BOUNDARIES_DATA[sub] && window.IB_BOUNDARIES_DATA[sub][session]) 
                            || [0, 15, 25, 38, 50, 62, 74];
                            
        // Weighted Percentage Calculation
        // P1 weight: 20%, P2 weight: 36% relative to 56% total
        const p1Pct = p1Score / 40;
        const p2Pct = p2Score / 90;
        const combinedPct = ((p1Pct * 0.20 + p2Pct * 0.36) / 0.56) * 100;
        
        const displayPct = Math.min(100, Math.max(0, combinedPct));
        predictedPercent.textContent = `${displayPct.toFixed(1)}%`;
        
        // Determine IB Grade
        let grade = 1;
        for (let g = 7; g >= 1; g--) {
            const minBoundary = boundaries[g - 1];
            if (displayPct >= minBoundary) {
                grade = g;
                break;
            }
        }
        
        predictedGrade.textContent = `Grade ${grade}`;
        
        // OSSD Interpolation
        // 7 -> 97-100%
        // 6 -> 93-96%
        // 5 -> 84-92%
        // 4 -> 72-83%
        // 3 -> 61-71%
        // 2 -> 50-60%
        // 1 -> <50%
        let ossd = 0;
        
        if (grade === 7) {
            const b7 = boundaries[6];
            const t = (displayPct - b7) / (100 - b7);
            ossd = 97 + (isNaN(t) ? 0 : t) * (100 - 97);
        } else if (grade === 6) {
            const b6 = boundaries[5];
            const b7 = boundaries[6];
            const t = (displayPct - b6) / (b7 - b6);
            ossd = 93 + (isNaN(t) ? 0 : t) * (96 - 93);
        } else if (grade === 5) {
            const b5 = boundaries[4];
            const b6 = boundaries[5];
            const t = (displayPct - b5) / (b6 - b5);
            ossd = 84 + (isNaN(t) ? 0 : t) * (92 - 84);
        } else if (grade === 4) {
            const b4 = boundaries[3];
            const b5 = boundaries[4];
            const t = (displayPct - b4) / (b5 - b4);
            ossd = 72 + (isNaN(t) ? 0 : t) * (83 - 72);
        } else if (grade === 3) {
            const b3 = boundaries[2];
            const b4 = boundaries[3];
            const t = (displayPct - b3) / (b4 - b3);
            ossd = 61 + (isNaN(t) ? 0 : t) * (71 - 61);
        } else if (grade === 2) {
            const b2 = boundaries[1];
            const b3 = boundaries[2];
            const t = (displayPct - b2) / (b3 - b2);
            ossd = 50 + (isNaN(t) ? 0 : t) * (60 - 50);
        } else {
            const b2 = boundaries[1] || 15;
            const t = displayPct / b2;
            ossd = (isNaN(t) ? 0 : t) * 49;
        }
        
        const finalOssd = Math.round(Math.min(100, Math.max(0, ossd)));
        predictedOssd.textContent = `${finalOssd}%`;
        
        // Color coding for Grade output
        if (grade >= 6) {
            predictedGrade.style.color = '#22C55E'; // green
        } else if (grade >= 4) {
            predictedGrade.style.color = '#EAB308'; // yellow/gold
        } else {
            predictedGrade.style.color = '#EF4444'; // red
        }
        
        // Update visual boundaries tracker pointer
        if (predictorMarker) {
            predictorMarker.style.left = `${displayPct}%`;
        }
        
        // Update tracker labels to display actual boundaries dynamically
        if (predictorLabels) {
            predictorLabels.innerHTML = `
                <span>G2: ${boundaries[1]}%</span>
                <span>G3: ${boundaries[2]}%</span>
                <span>G4: ${boundaries[3]}%</span>
                <span>G5: ${boundaries[4]}%</span>
                <span>G6: ${boundaries[5]}%</span>
                <span>G7: ${boundaries[6]}%</span>
            `;
        }
    }

    // --- Resize Handle Logic ---
    const resizeHandle = document.getElementById('resizeHandle');
    const listPane = document.querySelector('.list-pane');
    
    if (resizeHandle && listPane) {
        let isResizing = false;
        
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeHandle.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const sidebar = document.querySelector('.sidebar');
            const sidebarWidth = sidebar ? sidebar.offsetWidth : 280;
            const newWidth = e.clientX - sidebarWidth;
            const minWidth = 280;
            const maxWidth = window.innerWidth * 0.6;
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                listPane.style.flex = `0 0 ${newWidth}px`;
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizeHandle.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });

        // Initialize Notability Atom Notes System
        if (window.AtomWorkspace) {
            window.AtomWorkspace.init();
        }

        // Mobile Sidebar Drawer Toggle Logic
        const sidebarToggle = document.getElementById('sidebarToggle');
        const mobileHomeMenuBtn = document.getElementById('mobileHomeMenuBtn');
        const sidebarElement = document.querySelector('.sidebar');
        const sidebarBackdrop = document.getElementById('sidebarBackdrop');

        if (sidebarElement && sidebarBackdrop) {
            const toggleSidebar = () => {
                sidebarElement.classList.toggle('open');
                sidebarBackdrop.classList.toggle('active');
            };

            const closeSidebar = () => {
                sidebarElement.classList.remove('open');
                sidebarBackdrop.classList.remove('active');
            };

            if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
            if (mobileHomeMenuBtn) mobileHomeMenuBtn.addEventListener('click', toggleSidebar);
            sidebarBackdrop.addEventListener('click', closeSidebar);

            // Close sidebar when clicking any navigation items on mobile
            document.querySelectorAll('.sidebar .nav-link, .sidebar .nav-item').forEach(link => {
                link.addEventListener('click', closeSidebar);
            });
        }
    }
});
