(function initializeWorksheetGenerator(globalScope) {
    'use strict';

    const SUBJECTS = {
        physics: 'Physics HL',
        chemistry: 'Chemistry HL',
        biology: 'Biology HL',
        math: 'Mathematics AA HL',
        math_ai: 'Mathematics AI HL',
        economics: 'Economics HL',
        business: 'Business Management HL',
        computer_science: 'Computer Science HL'
    };

    const DIFFICULTY_LABELS = {
        1: 'Quick questions',
        2: 'Mostly shorter',
        3: 'Mixed',
        4: 'Mostly extended',
        5: 'Extended questions'
    };

    function parsePageCount(value) {
        const numbers = String(value || '').match(/\d+/g)?.map(Number) || [];
        if (numbers.length >= 2) return Math.max(1, Math.abs(numbers[1] - numbers[0]) + 1);
        return 1;
    }

    function estimateQuestionDifficulty(question) {
        const pageCount = parsePageCount(question?.pages);
        const paper = String(question?.paper_type || '').toUpperCase();
        if (pageCount >= 3) return 5;
        if (pageCount === 2) return paper === 'P1' ? 3 : 4;
        if (paper === 'P1' || paper === 'P1A' || paper === 'P1B') return 1;
        if (paper === 'P3') return 4;
        if (paper === 'P2') return 3;
        return 2;
    }

    function matchesDifficulty(question, preference) {
        const score = estimateQuestionDifficulty(question);
        const selected = Number(preference) || 3;
        if (selected === 1) return score <= 2;
        if (selected === 2) return score <= 3;
        if (selected === 4) return score >= 3;
        if (selected === 5) return score >= 4;
        return true;
    }

    function normalizeWorksheetPageText(text) {
        return String(text || '')
            .replace(/\b\d{4}\s*[-–—]\s*\d{4}\b/g, ' ')
            .replace(/\bturn\s+over\b/gi, ' ')
            .replace(/[-–—]\s*\d{1,3}\s*[-–—]/g, ' ')
            .replace(/\bpage\s+\d+(?:\s+of\s+\d+)?\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function shouldKeepWorksheetPage({ width, height, text }) {
        const safeWidth = Math.max(1, Number(width) || 1);
        const aspectRatio = (Number(height) || 0) / safeWidth;
        const meaningfulText = normalizeWorksheetPageText(text);
        const meaningfulCharacters = meaningfulText.replace(/[^A-Za-z0-9]/g, '').length;

        // Question slices retain the source-page width. Stray detector fragments are
        // characteristically very shallow and contain only a footer/page identifier.
        if (aspectRatio < 0.2 && meaningfulCharacters < 80) return false;
        if (aspectRatio < 0.32 && meaningfulCharacters < 24) return false;
        return true;
    }

    async function getUsablePageIndices(sourceBytes, sourcePdf) {
        const pages = sourcePdf.getPages();
        const analyses = pages.map(page => ({ ...page.getSize(), text: '' }));
        const pdfjs = globalScope.pdfjsLib;

        if (pdfjs?.getDocument) {
            let textDocument = null;
            try {
                textDocument = await pdfjs.getDocument({ data: sourceBytes.slice() }).promise;
                for (let index = 0; index < textDocument.numPages && index < analyses.length; index += 1) {
                    const page = await textDocument.getPage(index + 1);
                    const content = await page.getTextContent();
                    analyses[index].text = content.items.map(item => item.str || '').join(' ');
                }
            } catch (error) {
                console.warn('Worksheet page-quality text scan unavailable; using geometric checks.', error);
            } finally {
                await textDocument?.destroy?.();
            }
        }

        return analyses
            .map((analysis, index) => shouldKeepWorksheetPage(analysis) ? index : -1)
            .filter(index => index >= 0);
    }

    function flattenSubjectData(subjectData, selectedTopicKeys, difficultyPreference) {
        const selected = selectedTopicKeys instanceof Set ? selectedTopicKeys : new Set(selectedTopicKeys || []);
        const unique = new Map();

        Object.entries(subjectData || {}).forEach(([category, subtopics]) => {
            Object.entries(subtopics || {}).forEach(([subtopic, questions]) => {
                const topicKey = `${category}\u241f${subtopic}`;
                if (selected.size && !selected.has(topicKey)) return;
                (questions || []).forEach(question => {
                    const filepath = question.filepath || question.qp_path;
                    if (!filepath || unique.has(filepath) || !matchesDifficulty(question, difficultyPreference)) return;
                    unique.set(filepath, { ...question, filepath, _category: category, _subtopic: subtopic, _topicKey: topicKey });
                });
            });
        });

        return [...unique.values()];
    }

    function shuffle(values, random = Math.random) {
        const output = [...values];
        for (let index = output.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(random() * (index + 1));
            [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
        }
        return output;
    }

    function selectRandomQuestions(pool, requestedCount, random = Math.random) {
        const count = Math.max(0, Math.min(Number(requestedCount) || 0, pool.length));
        const groups = new Map();
        pool.forEach(question => {
            const key = question._topicKey || 'all';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(question);
        });

        const queues = shuffle([...groups.values()], random).map(group => shuffle(group, random));
        const selected = [];
        while (selected.length < count && queues.length) {
            for (let index = queues.length - 1; index >= 0 && selected.length < count; index -= 1) {
                const question = queues[index].shift();
                if (question) selected.push(question);
                if (!queues[index].length) queues.splice(index, 1);
            }
        }
        return selected;
    }

    function getDataset() {
        if (globalScope.StudyIBTopicQuestionData) return globalScope.StudyIBTopicQuestionData;
        return typeof topicQuestionPracticeData !== 'undefined' ? topicQuestionPracticeData : {};
    }

    function wrapText(text, font, size, maxWidth) {
        const safeText = String(text || '')
            .normalize('NFKD')
            .replace(/[\u2010-\u2015]/g, '-')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201c\u201d]/g, '"')
            .replace(/[^\x20-\x7e]/g, '?');
        const words = safeText.split(/\s+/).filter(Boolean);
        const lines = [];
        let line = '';
        words.forEach(word => {
            const candidate = line ? `${line} ${word}` : word;
            if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    function drawWrappedText(page, text, options) {
        const lines = wrapText(text, options.font, options.size, options.maxWidth);
        lines.forEach((line, index) => page.drawText(line, {
            x: options.x,
            y: options.y - (index * options.lineHeight),
            size: options.size,
            font: options.font,
            color: options.color
        }));
        return options.y - (lines.length * options.lineHeight);
    }

    async function createWorksheetPdf(options) {
        const PDFLib = globalScope.PDFLib;
        if (!PDFLib?.PDFDocument) throw new Error('The PDF generator did not load. Refresh the page and try again.');

        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        const output = await PDFDocument.create();
        const regular = await output.embedFont(StandardFonts.Helvetica);
        const bold = await output.embedFont(StandardFonts.HelveticaBold);
        const pageWidth = 595.28;
        const pageHeight = 841.89;
        const margin = 54;
        const blue = rgb(0.26, 0.31, 0.96);
        const ink = rgb(0.07, 0.08, 0.11);
        const muted = rgb(0.35, 0.38, 0.45);

        output.setTitle(options.title);
        output.setSubject(`${options.subjectLabel} printable practice worksheet`);
        output.setCreator('StudyIB Worksheet Generator');
        output.setProducer('StudyIB using pdf-lib');

        if (options.includeCover) {
            const cover = output.addPage([pageWidth, pageHeight]);
            cover.drawRectangle({ x: 0, y: pageHeight - 14, width: pageWidth, height: 14, color: blue });
            cover.drawText('StudyIB', { x: margin, y: pageHeight - 72, size: 14, font: bold, color: blue });
            let y = drawWrappedText(cover, options.title, {
                x: margin, y: pageHeight - 128, maxWidth: pageWidth - (margin * 2), size: 27, lineHeight: 34, font: bold, color: ink
            });
            y -= 16;
            cover.drawText(options.subjectLabel, { x: margin, y, size: 14, font: regular, color: muted });
            y -= 52;
            cover.drawText('Name', { x: margin, y, size: 10, font: bold, color: muted });
            cover.drawLine({ start: { x: margin + 42, y: y - 2 }, end: { x: 360, y: y - 2 }, thickness: 0.75, color: muted });
            cover.drawText('Date', { x: 390, y, size: 10, font: bold, color: muted });
            cover.drawLine({ start: { x: 422, y: y - 2 }, end: { x: pageWidth - margin, y: y - 2 }, thickness: 0.75, color: muted });
            y -= 72;
            const details = [
                ['Questions', String(options.targetCount || options.questions.length)],
                ['Topics selected', String(options.topicCount)],
                ['Question length', options.difficultyLabel]
            ];
            details.forEach(([label, value], index) => {
                const x = margin + (index * 160);
                cover.drawText(value, { x, y, size: 18, font: bold, color: ink });
                cover.drawText(label, { x, y: y - 20, size: 9, font: regular, color: muted });
            });
            cover.drawText('Instructions', { x: margin, y: y - 86, size: 11, font: bold, color: ink });
            drawWrappedText(cover, 'Answer every question. Show your working where appropriate. The original examination formatting, diagrams, answer space, and mark allocations have been preserved.', {
                x: margin, y: y - 108, maxWidth: pageWidth - (margin * 2), size: 10, lineHeight: 15, font: regular, color: muted
            });
            cover.drawText(`Generated ${new Date().toLocaleDateString()}`, { x: margin, y: 42, size: 8, font: regular, color: muted });
        }

        const included = [];
        const failed = [];
        const targetCount = Math.max(1, Number(options.targetCount) || options.questions.length);
        for (let index = 0; index < options.questions.length && included.length < targetCount; index += 1) {
            const question = options.questions[index];
            options.onProgress?.(included.length, targetCount, question);
            try {
                const resolvedUrl = globalScope.resolveStudyIBContentUrl
                    ? globalScope.resolveStudyIBContentUrl(question.filepath)
                    : question.filepath;
                const response = await fetch(resolvedUrl, { mode: 'cors', credentials: 'omit' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const sourceBytes = new Uint8Array(await response.arrayBuffer());
                const source = await PDFDocument.load(sourceBytes.slice(), { ignoreEncryption: true, updateMetadata: false });
                const usablePageIndices = await getUsablePageIndices(sourceBytes, source);
                if (!usablePageIndices.length) throw new Error('Question contained only blank or footer-only crop fragments.');
                const pages = await output.copyPages(source, usablePageIndices);
                pages.forEach(page => output.addPage(page));
                included.push({ ...question, outputPages: pages.length });
            } catch (error) {
                console.error('Unable to add worksheet question', question.filepath, error);
                failed.push({ question, error: error.message || String(error) });
            }
        }

        if (!included.length) throw new Error('None of the selected question files could be loaded. Check your connection and try again.');

        if (options.includeSources) {
            let sourcePage = null;
            let y = 0;
            const addSourcePage = () => {
                sourcePage = output.addPage([pageWidth, pageHeight]);
                sourcePage.drawText('Question source list', { x: margin, y: pageHeight - 66, size: 20, font: bold, color: ink });
                sourcePage.drawText('For worksheet organization and tutor reference.', { x: margin, y: pageHeight - 88, size: 9, font: regular, color: muted });
                y = pageHeight - 124;
            };
            addSourcePage();
            included.forEach((question, index) => {
                const sourceText = `${index + 1}. ${question._subtopic} — ${question.source || 'Source metadata unavailable'}, question ${question.qnum || '?'}`;
                const lines = wrapText(sourceText, regular, 8.5, pageWidth - (margin * 2));
                const requiredHeight = (lines.length * 12) + 8;
                if (y - requiredHeight < 48) addSourcePage();
                lines.forEach((line, lineIndex) => sourcePage.drawText(line, {
                    x: margin, y: y - (lineIndex * 12), size: 8.5, font: regular, color: ink
                }));
                y -= requiredHeight;
            });
        }

        options.onProgress?.(included.length, targetCount, null);
        const bytes = await output.save({ useObjectStreams: true });
        return { bytes, included, failed, pageCount: output.getPageCount() };
    }

    const api = {
        SUBJECTS,
        DIFFICULTY_LABELS,
        parsePageCount,
        estimateQuestionDifficulty,
        matchesDifficulty,
        normalizeWorksheetPageText,
        shouldKeepWorksheetPage,
        flattenSubjectData,
        selectRandomQuestions,
        createWorksheetPdf
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    globalScope.StudyIBWorksheet = api;

    if (typeof document === 'undefined') return;

    document.addEventListener('DOMContentLoaded', () => {
        const modal = document.getElementById('worksheetGeneratorModal');
        const openButton = document.getElementById('sidebarWorksheet');
        const closeButton = document.getElementById('closeWorksheetGeneratorBtn');
        const subjectSelect = document.getElementById('worksheetSubject');
        const titleInput = document.getElementById('worksheetTitle');
        const countInput = document.getElementById('worksheetQuestionCount');
        const countDisplay = document.getElementById('worksheetQuestionCountDisplay');
        const countDownButton = document.getElementById('worksheetCountDown');
        const countUpButton = document.getElementById('worksheetCountUp');
        const countPresetButtons = [...document.querySelectorAll('.worksheet-count-presets [data-count]')];
        const difficultyInput = document.getElementById('worksheetDifficulty');
        const difficultyDisplay = document.getElementById('worksheetDifficultyDisplay');
        const difficultyOptions = document.getElementById('worksheetDifficultyOptions');
        const topicsRoot = document.getElementById('worksheetTopics');
        const poolSummary = document.getElementById('worksheetPoolSummary');
        const selectAllButton = document.getElementById('worksheetSelectAll');
        const clearAllButton = document.getElementById('worksheetClearAll');
        const generateButton = document.getElementById('generateWorksheetBtn');
        const generateLabel = document.getElementById('worksheetGenerateLabel');
        const footerSummary = document.getElementById('worksheetFooterSummary');
        const status = document.getElementById('worksheetStatus');
        const statusText = document.getElementById('worksheetStatusText');
        const statusCount = document.getElementById('worksheetStatusCount');
        const statusBar = document.getElementById('worksheetStatusBar');
        const result = document.getElementById('worksheetResult');
        const resultSummary = document.getElementById('worksheetResultSummary');
        const downloadButton = document.getElementById('worksheetDownloadBtn');
        const printButton = document.getElementById('worksheetPrintBtn');
        const coverCheckbox = document.getElementById('worksheetCoverPage');
        const sourcesCheckbox = document.getElementById('worksheetSourceList');

        if (!modal || !openButton) return;

        let outputUrl = '';
        let outputFilename = '';
        let titleWasEdited = false;
        let lastFocusedElement = null;
        let isGenerating = false;

        Object.entries(SUBJECTS).forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = `IB ${label}`;
            subjectSelect.appendChild(option);
        });

        const currentSubjectData = () => getDataset()[subjectSelect.value] || {};
        const checkedTopicKeys = () => new Set([...topicsRoot.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value));
        const currentPool = () => flattenSubjectData(currentSubjectData(), checkedTopicKeys(), Number(difficultyInput.value));

        function updateTitle() {
            if (!titleWasEdited) titleInput.value = `IB ${SUBJECTS[subjectSelect.value]} Practice Worksheet`;
        }

        function updateSummary() {
            const selectedTopics = checkedTopicKeys();
            const pool = currentPool();
            const maxCount = Math.min(20, Math.max(1, pool.length));
            const requested = Math.max(1, Math.min(Number(countInput.value) || 1, maxCount));
            countInput.max = String(maxCount);
            countInput.value = String(requested);
            countDisplay.textContent = countInput.value;
            poolSummary.textContent = selectedTopics.size
                ? `${selectedTopics.size} topic${selectedTopics.size === 1 ? '' : 's'} selected · ${pool.length.toLocaleString()} matching question${pool.length === 1 ? '' : 's'}`
                : 'Select at least one topic.';
            footerSummary.textContent = `${requested} question${requested === 1 ? '' : 's'} · ${selectedTopics.size} topic${selectedTopics.size === 1 ? '' : 's'}`;
            countDownButton.disabled = requested <= 1;
            countUpButton.disabled = requested >= maxCount;
            countPresetButtons.forEach(button => {
                const value = Number(button.dataset.count);
                button.disabled = value > maxCount;
                button.classList.toggle('active', value === requested);
                button.setAttribute('aria-pressed', String(value === requested));
            });
            generateButton.disabled = !selectedTopics.size || !pool.length;
        }

        function renderTopics() {
            topicsRoot.replaceChildren();
            Object.entries(currentSubjectData()).forEach(([category, subtopics]) => {
                const group = document.createElement('section');
                group.className = 'worksheet-topic-group';
                const heading = document.createElement('div');
                heading.className = 'worksheet-topic-group-title';
                heading.textContent = category;
                group.appendChild(heading);

                Object.entries(subtopics || {}).forEach(([subtopic, questions]) => {
                    const uniqueCount = new Set((questions || []).map(question => question.filepath || question.qp_path).filter(Boolean)).size;
                    if (!uniqueCount) return;
                    const label = document.createElement('label');
                    label.className = 'worksheet-topic-option';
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.value = `${category}\u241f${subtopic}`;
                    input.checked = true;
                    const text = document.createElement('span');
                    const name = document.createElement('strong');
                    name.textContent = subtopic;
                    const count = document.createElement('small');
                    count.textContent = `${uniqueCount.toLocaleString()} questions`;
                    text.append(name, count);
                    label.append(input, text);
                    group.appendChild(label);
                });
                if (group.children.length > 1) topicsRoot.appendChild(group);
            });
            updateSummary();
        }

        function clearPreviousResult() {
            result.classList.add('hidden');
            if (outputUrl) URL.revokeObjectURL(outputUrl);
            outputUrl = '';
            outputFilename = '';
        }

        function openModal() {
            lastFocusedElement = document.activeElement;
            modal.classList.remove('hidden');
            const requestedSubject = globalScope.currentStudyIBSubject;
            subjectSelect.value = Object.hasOwn(SUBJECTS, requestedSubject) ? requestedSubject : 'physics';
            titleWasEdited = false;
            updateTitle();
            renderTopics();
            subjectSelect.focus();
        }

        function closeModal() {
            if (isGenerating) return;
            modal.classList.add('hidden');
            lastFocusedElement?.focus?.();
        }

        api.open = openModal;
        openButton.addEventListener('click', openModal);
        closeButton.addEventListener('click', closeModal);
        modal.addEventListener('click', event => {
            if (event.target === modal) closeModal();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
        });
        subjectSelect.addEventListener('change', () => {
            updateTitle();
            clearPreviousResult();
            renderTopics();
        });
        titleInput.addEventListener('input', () => { titleWasEdited = true; });
        countInput.addEventListener('input', updateSummary);
        countInput.addEventListener('change', updateSummary);
        countDownButton.addEventListener('click', () => {
            countInput.value = String(Math.max(1, Number(countInput.value) - 1));
            updateSummary();
        });
        countUpButton.addEventListener('click', () => {
            countInput.value = String(Math.min(Number(countInput.max), Number(countInput.value) + 1));
            updateSummary();
        });
        countPresetButtons.forEach(button => button.addEventListener('click', () => {
            countInput.value = button.dataset.count;
            updateSummary();
        }));
        difficultyOptions.addEventListener('click', event => {
            const button = event.target.closest('[data-difficulty]');
            if (!button) return;
            difficultyInput.value = button.dataset.difficulty;
            difficultyOptions.querySelectorAll('[data-difficulty]').forEach(option => {
                const active = option === button;
                option.classList.toggle('active', active);
                option.setAttribute('aria-pressed', String(active));
            });
            difficultyDisplay.textContent = DIFFICULTY_LABELS[difficultyInput.value];
            clearPreviousResult();
            updateSummary();
        });
        topicsRoot.addEventListener('change', () => {
            clearPreviousResult();
            updateSummary();
        });
        selectAllButton.addEventListener('click', () => {
            topicsRoot.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = true; });
            clearPreviousResult();
            updateSummary();
        });
        clearAllButton.addEventListener('click', () => {
            topicsRoot.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
            clearPreviousResult();
            updateSummary();
        });

        generateButton.addEventListener('click', async () => {
            const selectedTopics = checkedTopicKeys();
            const pool = currentPool();
            const targetCount = Number(countInput.value);
            const backupCount = Math.max(4, Math.ceil(targetCount / 2));
            const questions = selectRandomQuestions(pool, Math.min(pool.length, targetCount + backupCount));
            if (!selectedTopics.size || !questions.length) return;

            clearPreviousResult();
            isGenerating = true;
            generateButton.disabled = true;
            generateLabel.textContent = 'Generating…';
            status.classList.remove('hidden');
            status.classList.remove('error');
            statusText.textContent = 'Preparing original question pages…';
            statusCount.textContent = `0 / ${questions.length}`;
            statusBar.style.width = '0%';

            try {
                const generated = await createWorksheetPdf({
                    title: titleInput.value.trim() || `IB ${SUBJECTS[subjectSelect.value]} Practice Worksheet`,
                    subjectLabel: `IB ${SUBJECTS[subjectSelect.value]}`,
                    difficultyLabel: DIFFICULTY_LABELS[difficultyInput.value],
                    topicCount: selectedTopics.size,
                    questions,
                    targetCount,
                    includeCover: coverCheckbox.checked,
                    includeSources: sourcesCheckbox.checked,
                    onProgress(completed, total, question) {
                        statusText.textContent = question ? `Adding ${question._subtopic}…` : 'Finalizing PDF…';
                        statusCount.textContent = `${completed} / ${total}`;
                        statusBar.style.width = `${Math.round((completed / Math.max(1, total)) * 100)}%`;
                    }
                });
                const blob = new Blob([generated.bytes], { type: 'application/pdf' });
                outputUrl = URL.createObjectURL(blob);
                const safeTitle = (titleInput.value.trim() || 'studyib-worksheet').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
                outputFilename = `${safeTitle || 'studyib-worksheet'}.pdf`;
                status.classList.add('hidden');
                result.classList.remove('hidden');
                const skippedText = generated.failed.length ? ` · ${generated.failed.length} unavailable file${generated.failed.length === 1 ? '' : 's'} skipped` : '';
                resultSummary.textContent = `${generated.included.length} questions · ${generated.pageCount} pages${skippedText}`;
            } catch (error) {
                status.classList.remove('hidden');
                status.classList.add('error');
                statusText.textContent = error.message || 'The worksheet could not be generated.';
                statusCount.textContent = '';
                statusBar.style.width = '0%';
            } finally {
                isGenerating = false;
                generateButton.disabled = false;
                generateLabel.textContent = outputUrl ? 'Generate another' : 'Try again';
                updateSummary();
            }
        });

        downloadButton.addEventListener('click', () => {
            if (!outputUrl) return;
            const anchor = document.createElement('a');
            anchor.href = outputUrl;
            anchor.download = outputFilename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        });
        printButton.addEventListener('click', () => {
            if (!outputUrl) return;
            const printWindow = globalScope.open(outputUrl, '_blank', 'noopener,noreferrer');
            if (!printWindow) statusText.textContent = 'Allow pop-ups, then choose “Open to print” again.';
        });
    });
})(typeof window !== 'undefined' ? window : globalThis);
