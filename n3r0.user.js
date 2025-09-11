-// ==UserScript==
// @name        N3r0
// @namespace   http://n3r0.tech/
// @version     2.0
// @description Kun et vaan jaksaisi koulua
// @author      You
// @match       *://materiaalit.otava.fi/*
// @grant       none
// @run-at      document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.self !== window.top) return;

    // Configuration
    let submitAnswers = true;

    // Global state variables
    let storedAnswers = [];
    let currentSectionIds = [];
    let floatingWindow = null;
    let updateTimeout = null;
    let currentQuestionTypes = [];
    let currentFlashcardQuestion = null;
    let currentStoredStructure = null;
    let currentTaskId = null;
    let currentMaterialUuid = null;
    let currentMaterialId = null;
    let currentPage = null;
    let currentPageUuid = null;
    let currentQuestionIds = [];
    let currentMaxScore = null;

    let lastPageUrl = window.location.href;
    let pageChangeTimeout = null;


    // Constants
    const API_BASE_URL = "https://materiaalit.otava.fi/o/task-container/a/";
    const INPUT_FIELD_SELECTOR = 'input, textarea, [aria-label]';
    const FLASHCARD_CONTAINER_SELECTOR = '.flashcards';
    const FLASHCARD_QUESTION_SELECTOR = '#question-Q_1424 > div.content-view-wrapper > div > div:nth-child(2) > div.flashcards-term > div > div > div';

    // Utility Functions
    function logError(error, context = '') {
        console.error(`Error in ${context}:`, error);
        // showNotification('DEBUG', `Error in ${context}`, 3000)
    }

    function debounce(func, delay) {
        return function (...args) {
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // DOM Interaction Functions
    function findInputFields() {
        const iframeDocument = window.top.document.querySelector('iframe').contentDocument;
        const inputs = iframeDocument.querySelectorAll(INPUT_FIELD_SELECTOR);
        return Array.from(inputs).filter(input =>
            input.getAttribute('aria-label') === 'Kirjoita vastaus' ||
            input.getAttribute('aria-label') === 'Write your answer'
        );
    }

    function extractFlashcardQuestion() {
        try {
            const iframeDocument = window.top.document.querySelector('iframe').contentDocument;
            const flashcardContainer = iframeDocument.querySelector(FLASHCARD_CONTAINER_SELECTOR);
            if (!flashcardContainer) return;

            const flashcardQuestion = iframeDocument.querySelector(FLASHCARD_QUESTION_SELECTOR);
            if (flashcardQuestion && currentFlashcardQuestion !== flashcardQuestion.innerText) {
                currentFlashcardQuestion = flashcardQuestion.innerText;
                storedAnswers = extractCorrectAnswers(currentStoredStructure);
            }
        } catch(error) {
            console.log("Failed to extract flashcard question: "+error)
        }
    }

    // API Interaction Functions
    async function apiHandler(type, answer, sectionId, questionId) {
        const url =
              type === "structure-answer"
        ? `${API_BASE_URL}${currentTaskId}/-/structure-answer`
        : type === "score"
        ? `${API_BASE_URL}${currentTaskId}/-/score`
        : type === "suspend-data"
        ? `${API_BASE_URL}${currentTaskId}/-/suspend-data`
        : null;

        if (!url) {
            logError(new Error(`Unknown API handler type: ${type}`), "apiHandler");
            return;
        }

        let body;
        if (type === "structure-answer") {
            body = JSON.stringify({
                questionId: questionId,
                sectionId: sectionId,
                answer: Array.isArray(answer) ? answer : [answer],
                score: 0,
                graded: 1,
                materialId: currentMaterialId,
                materialUuid: currentMaterialUuid,
                page: currentPage,
                pageUuid: currentPageUuid,
            });
        } else if (type === "score") {
            body = JSON.stringify({
                score: currentMaxScore,
                progressMeasure: 1,
                scoreMax: currentMaxScore,
                materialId: currentMaterialId,
                materialUuid: currentMaterialUuid,
                page: currentPage,
                pageUuid: currentPageUuid,
            });
        } else if (type === "suspend-data") {
            // You can make this dynamic later if needed
            const suspendData = {
                Seed: Date.now(),
                randomFilePrefix: Date.now(),
                Pages: { current: 0 },
                Questions: {
                    [questionId]: {
                        answersCheckCount: 0,
                        wrongAnswersCount: 0,
                        Sections: {
                            [sectionId]: {
                                answer: Array.isArray(answer) ? answer : [answer],
                                answersCheckCount: 0,
                                answerHasChanged: true,
                                wrongAnswersCount: 0,
                                locked: false,
                            },
                        },
                        Assignment: {},
                    },
                },
                Containers: {
                    ["K3122"]: {
                        isSeen: true,
                        isCompleted: true,
                        isActiveContainer: true,
                    },
                },
            };

            body = JSON.stringify({
                suspendData: JSON.stringify(suspendData),
            });
        }

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json; charset=UTF-8",
                    Accept: "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                    ...(window.csrfToken ? { "X-CSRF-Token": window.csrfToken } : {}),
                },
                credentials: "include",
                body: body,
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.statusText}`);
            }

            return await response.json().catch(() => ({}));
        } catch (error) {
            logError(error, "apiHandler");
        }
    }


    function stripHtmlToText(html) {
        html = html.replace(/<\s*\/?(div|p|h[1-6]|li|br)[^>]*>/gi, '\n');

        html = html.replace(/<[^>]+>/g, '');

        html = html
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        html = html
            .replace(/\r\n|\r/g, '\n')
            .replace(/\n[ \t]*\n+/g, '\n\n')
            .replace(/[ \t]+/g, ' ')
            .trim();

        return html;
    }

    function htmlEncode(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#x27;");
    }

    function removeArtifacts(str) {
        return str
            .replace('Suggested key', '')
    }


    function handleMarkTheWords(questionId, correctAnswers, iframeDocument) {
        const questionDiv = iframeDocument.querySelector(`#question-${questionId}`);
        if (!questionDiv) {
            console.error(`Question div not found for ID: ${questionId}`);
            return [];
        }

        const textContent = questionDiv.textContent.trim();
        const words = textContent.split(/\s+/).map(w => w.replace(/[.,!?;:]/g, ""));

        const correctIndexes = [];

        correctAnswers.forEach(answer => {
            // split multi-word answers
            const answerWords = answer.split(/\s+/).map(w => w.replace(/[.,!?;:]/g, ""));

            for (let i = 0; i <= words.length - answerWords.length; i++) {
                let match = true;

                for (let j = 0; j < answerWords.length; j++) {
                    if (words[i + j] !== answerWords[j]) {
                        match = false;
                        break;
                    }
                }

                if (match) {
                    // push all indexes for this multi-word answer
                    for (let j = 0; j < answerWords.length; j++) {
                        correctIndexes.push((i + j).toString());
                    }
                    console.log(`Found match: "${answer}" at indexes [${i}..${i + answerWords.length - 1}]`);
                }
            }
        });

        console.log(`Correct indexes for question ${questionId}:`, correctIndexes);
        return correctIndexes;
    }


    function extractCorrectAnswers(storedStructure) {
        if (!storedStructure?.structure?.questions) {
            logError('Invalid storedStructure', 'extractCorrectAnswers');
            return [];
        }

        const iframeDocument = window.top.document.querySelector('iframe').contentDocument;
        const questions = storedStructure.structure.questions;
        const results = [];
        currentQuestionIds = [];
        currentQuestionTypes = [];
        currentSectionIds = [];



        questions.forEach(question => {
            currentQuestionIds.push(question.id);
            currentQuestionTypes.push(question.type);

            if (question.type === 'open' && question.exampleAnswer?.medias?.length > 0 && question.sections) {
                question.sections.forEach(section => {
                    const exampleText = question.exampleAnswer.medias[0].content.text;
                    const strippedAnswer = stripHtmlToText(exampleText);
                    results.push({
                        questionId: question.id,
                        sectionId: section.id,
                        answers: [removeArtifacts(strippedAnswer)]
                    });
                });
            }

            if (question.type === 'crossword' && question.sections) {
                question.sections.forEach(section => {
                    currentSectionIds.push(section.id);
                    results.push({
                        questionId: question.id,
                        sectionId: section.id,
                        answers: [section.word]
                    });
                });
            } else if (question.type === 'markthewords' && question.sections) {
                const correctAnswers = question.sections
                    .map(sec => sec.choices.filter(c => c.correct).map(c => c.name))
                    .flat();

                console.log("answers" + correctAnswers)

                const correctIndexes = handleMarkTheWords(question.id, correctAnswers, iframeDocument);

                results.push({
                    questionId: question.id,
                    sectionId: question.sections[0].id, // markthewords usually has one section
                    answers: correctIndexes
                });
            } else if (question.sections) {
                question.sections.forEach(section => {
                    currentSectionIds.push(section.id);
                    const correctChoices = section.choices
                    .filter(choice => choice.points > 0)
                    .map(choice => choice.name);
                    results.push({
                        questionId: question.id,
                        sectionId: section.id,
                        answers: correctChoices
                    });
                });
            }
        });

        return results;
    }

    function handlePageChangeWithoutStructure() {
        console.log("Page changed but no new storedStructure detected, flushing answers");

        // Flush stored answers
        storedAnswers = [];
        currentSectionIds = [];
        currentQuestionTypes = [];
        currentFlashcardQuestion = null;
        currentStoredStructure = null;
        currentQuestionIds = [];

        // Update floating window to show "No answers detected"
        updateFloatingWindowContentNoAnswers();

        showNotification("N3R0", "No answers detected on this page", 3000);
    }

    function updateFloatingWindowContentNoAnswers() {
        if (!floatingWindow) return;

        const answersContainer = document.getElementById('answersContainer');
        if (!answersContainer) {
            logError('Answers container not found in floating window.', 'updateFloatingWindowContentNoAnswers');
            return;
        }
        answersContainer.innerHTML = '';

        const noAnswersDiv = document.createElement('div');
        noAnswersDiv.textContent = 'No answers detected';
        Object.assign(noAnswersDiv.style, {
            textAlign: 'center',
            color: '#888',
            fontStyle: 'italic',
            padding: '20px'
        });

        answersContainer.appendChild(noAnswersDiv);
    }


    function extractData(responseText) {
        try {
            const storedStructureMatch = responseText.match(/var storedStructure = (\{.*?\});/);
            if (storedStructureMatch) {
                currentStoredStructure = JSON.parse(storedStructureMatch[1]);
                storedAnswers = extractCorrectAnswers(currentStoredStructure);
                updateFloatingWindowContent();

                // Clear any pending page change timeout since we found new structure
                if (pageChangeTimeout) {
                    clearTimeout(pageChangeTimeout);
                    pageChangeTimeout = null;
                }
            }

            const taskIdMatch = responseText.match(/var taskId = '([^']+)';/);
            if (taskIdMatch) currentTaskId = taskIdMatch[1];

            const currentMaterialMatch = responseText.match(/Cloubi\.currentMaterial\s*=\s*(\{[\s\S]*?\})/);
            if (currentMaterialMatch) {
                const jsonString = currentMaterialMatch[1].trim().replace(/;$/, '');
                const currentMaterial = JSON.parse(jsonString);
                currentMaterialUuid = currentMaterial.uuid;
                console.log("MaterialUUID: "+currentMaterialUuid)
            }

            const materialIdMatch = responseText.match(/"materialId":\s*"(\d+)"/);
            if (materialIdMatch) currentMaterialId = materialIdMatch[1];

            const pageUuidMatch = responseText.match(/"pageId"\s*:\s*"([a-f0-9]{24})"/);
            if (pageUuidMatch) {
                currentPageUuid = pageUuidMatch[1];
                console.log("Current Page UUID: "+currentPageUuid)
            }

            const pageIdMatch = window.location.href.match(/\/([^\/]+)$/);
            if (pageIdMatch) currentPage = pageIdMatch[1];
        } catch (error) {
            logError(error, 'extractData');
        }
    }

    function monitorFloatingWindow() {
        setInterval(() => {
            if (!floatingWindow || !document.body.contains(floatingWindow)) {
                console.warn("Floating window missing, restoring...");
                createOrUpdateFloatingWindow();
            }
        }, 1000);
    }


    function createOrUpdateFloatingWindow() {
        if (floatingWindow) {
            updateFloatingWindowContent();
            return;
        }

        floatingWindow = document.createElement('div');
        floatingWindow.id = 'floatingWindow';
        Object.assign(floatingWindow.style, {
            position: 'fixed',
            width: '400px',
            height: '350px',
            top: '20px',
            left: '20px',
            backgroundColor: '#333',
            color: '#fff',
            border: '1px solid #000',
            borderRadius: '10px',
            zIndex: '10000',
            cursor: 'move',
            fontFamily: 'Manrope, sans-serif',
            overflow: 'hidden',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column'
        });

        const topBar = document.createElement('div');
        Object.assign(topBar.style, {
            backgroundColor: '#222',
            padding: '5px',
            height: '30px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: '0'
        });

        const title = document.createElement('span');
        title.textContent = 'N3R0';
        Object.assign(title.style, {
            fontWeight: '800',
            fontSize: '18px',
            background: 'radial-gradient(circle at 100%, #b2a8fd, #8678f9 50%, #c7d2fe 75%, #9a8dfd 75%)',
            backgroundSize: '200% auto',
            color: '#000',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            animation: 'animatedTextGradient 1.5s linear infinite'
        });

        const closeButton = document.createElement('button');
        closeButton.textContent = 'X';
        Object.assign(closeButton.style, {
            marginLeft: 'auto',
            backgroundColor: '#ff4d4d',
            border: 'none',
            borderRadius: '15px',
            color: '#fff',
            cursor: 'pointer',
            padding: '0 8px'
        });
        closeButton.onclick = removeFloatingWindow;

        const minimizeButton = document.createElement('button');
        minimizeButton.textContent = '–';
        Object.assign(minimizeButton.style, {
            marginLeft: '75%',
            backgroundColor: '#ffaa00',
            border: 'none',
            borderRadius: '15px',
            color: '#fff',
            cursor: 'pointer',
            padding: '0 8px'
        });
        minimizeButton.onclick = () => {
            floatingWindow.style.display = 'none';
            createRestoreButton();
        };


        topBar.appendChild(title);
        topBar.appendChild(minimizeButton);
        topBar.appendChild(closeButton);

        floatingWindow.appendChild(topBar);

        const mainContainer = document.createElement('div');
        Object.assign(mainContainer.style, {
            display: 'flex',
            flex: '1',
            overflow: 'hidden'
        });

        const answersContainer = document.createElement('div');
        answersContainer.id = 'answersContainer';
        Object.assign(answersContainer.style, {
            flex: '2',
            padding: '10px',
            overflowY: 'auto',
            backgroundColor: '#2b2b2b',
            borderRight: '1px solid #444',
            height: '100%'
        });

        const buttonsContainer = document.createElement('div');
        buttonsContainer.id = 'buttonsContainer';
        Object.assign(buttonsContainer.style, {
            flex: '1',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#222',
            padding: '10px',
            height: '100%',
            flexShrink: '0'
        });

        const autoAnswerButton = document.createElement('button');
        autoAnswerButton.textContent = 'Send Answers';
        Object.assign(autoAnswerButton.style, {
            width: '100%',
            padding: '8px',
            backgroundColor: '#4CAF50',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            borderRadius: '5px',
            marginBottom: '5px'
        });
        autoAnswerButton.onclick = autoAnswer;

        const placeholderButton = document.createElement('button');
        placeholderButton.textContent = 'Placeholder';
        Object.assign(placeholderButton.style, {
            width: '100%',
            padding: '8px',
            backgroundColor: '#555',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            borderRadius: '5px'
        });

        buttonsContainer.appendChild(autoAnswerButton);
        // Implement later
        // buttonsContainer.appendChild(placeholderButton);

        const navContainer = document.createElement('div');
        Object.assign(navContainer.style, {
            width: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: '#1a1a1a',
            borderLeft: '1px solid #444',
            paddingTop: '10px'
        });

        const navButton1 = document.createElement('div');
        navButton1.textContent = '☰';
        Object.assign(navButton1.style, {
            cursor: 'pointer',
            padding: '10px',
            color: '#fff',
            fontSize: '18px'
        });
        navButton1.onclick = () => switchTab('answers');

        const navButton2 = document.createElement('div');
        navButton2.textContent = '⚙️';
        Object.assign(navButton2.style, {
            cursor: 'pointer',
            padding: '10px',
            color: '#fff',
            fontSize: '18px'
        });
        navButton2.onclick = () => switchTab('settings');

        navContainer.appendChild(navButton1);
        navContainer.appendChild(navButton2);

        mainContainer.appendChild(answersContainer);
        mainContainer.appendChild(buttonsContainer);
        mainContainer.appendChild(navContainer);

        floatingWindow.appendChild(mainContainer);
        document.body.appendChild(floatingWindow);

        makeElementDraggable(floatingWindow);

        const notificationContainer = document.createElement('div');
        notificationContainer.id = 'notification-container';
        Object.assign(notificationContainer.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '300px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            zIndex: '10000',
            pointerEvents: 'none'
        });
        document.body.appendChild(notificationContainer);

        const style = document.createElement('style');
        style.textContent = `
            @keyframes animatedTextGradient {
                0% { background-position: 0% 0%; }
                100% { background-position: 200% 0%; }
            }
`       ;
        document.head.appendChild(style);

        function showNotification(title, message, duration = 3000) {
            const notification = document.createElement('div');
            Object.assign(notification.style, {
                backgroundColor: '#222',
                color: '#fff',
                padding: '15px',
                borderRadius: '8px',
                boxShadow: '0 4px 10px rgba(0, 0, 0, 0.3)',
                opacity: '0',
                transform: 'translateY(10px)',
                transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
                fontFamily: 'Manrope, sans-serif',
                pointerEvents: 'auto'
            });

            const titleElem = document.createElement('strong');
            titleElem.textContent = title;
            titleElem.style.display = 'block';

            const messageElem = document.createElement('span');
            messageElem.textContent = message;

            notification.appendChild(titleElem);
            notification.appendChild(messageElem);
            notificationContainer.appendChild(notification);

            requestAnimationFrame(() => {
                notification.style.opacity = '1';
                notification.style.transform = 'translateY(0)';
            });

            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transform = 'translateY(-10px)';
                setTimeout(() => {
                    notification.remove();
                }, 300);
            }, duration);
        }

        setTimeout(() => showNotification('Success', 'Notification system loaded!', 3000), 500);

        window.showNotification = showNotification;

        window.mainContainer = mainContainer;

    }

    function createRestoreButton() {
        const existingRestore = document.getElementById('restoreFloatingWindowBtn');
        if (existingRestore) return;

        const restoreBtn = document.createElement('button');
        restoreBtn.id = 'restoreFloatingWindowBtn';
        restoreBtn.textContent = 'Open N3R0';
        Object.assign(restoreBtn.style, {
            position: 'fixed',
            bottom: '20px',
            left: '20px',
            backgroundColor: '#4CAF50',
            color: '#fff',
            border: 'none',
            borderRadius: '5px',
            padding: '8px 12px',
            cursor: 'pointer',
            zIndex: '10001',
            fontFamily: 'Manrope, sans-serif'
        });

        restoreBtn.onclick = () => {
            floatingWindow.style.display = 'flex';
            restoreBtn.remove();
        };

        document.body.appendChild(restoreBtn);
    }

    function switchTab(tabName) {
        const answersContainer = document.getElementById('answersContainer');
        const buttonsContainer = document.getElementById('buttonsContainer');
        const settingsContainer = document.getElementById('settingsContainer');

        if (tabName === 'answers') {
            answersContainer.style.display = 'block';
            buttonsContainer.style.display = 'flex';
            if (settingsContainer) settingsContainer.style.display = 'none';
        } else if (tabName === 'settings') {
            answersContainer.style.display = 'none';
            buttonsContainer.style.display = 'none';

            if (!settingsContainer) {
                const settingsContainer = document.createElement('div');
                settingsContainer.id = 'settingsContainer';
                Object.assign(settingsContainer.style, {
                    flex: '2',
                    padding: '10px',
                    overflowY: 'auto',
                    backgroundColor: '#222',
                    borderRight: '1px solid #444',
                    height: '100%'
                });

                const storedStructureButton = document.createElement('button');
                storedStructureButton.textContent = 'Copy StoredStructure as JSON';
                Object.assign(storedStructureButton.style, {
                    width: '100%',
                    padding: '8px',
                    backgroundColor: '#555',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    borderRadius: '5px'
                });
                storedStructureButton.onclick = () => navigator.clipboard.writeText(JSON.stringify(currentStoredStructure)).then(() => {alert("Copied to clipboard!")}).catch((error) => {logError(error)})


                const pageSourceButton = document.createElement('button');
                pageSourceButton.textContent = 'Copy Page Source as JSON';
                Object.assign(pageSourceButton.style, {
                    width: '100%',
                    padding: '8px',
                    backgroundColor: '#555',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    borderRadius: '5px'
                });
                pageSourceButton.onclick = () => navigator.clipboard.writeText(JSON.stringify(fetchPageSource())).then(() => {alert("Copied to clipboard!")}).catch((error) => {logError(error)})

                const currentTypeDebug = document.createElement('div');
                currentTypeDebug.textContent = currentQuestionTypes.toString();
                Object.assign(currentTypeDebug.style, {
                    textAlign: 'center',
                    padding: '10px',
                    top: '90%',
                    color: '#fff',
                    fontSize: '12px',
                    borderTop: '1px solid #444',
                    marginTop: 'auto'
                });


                const credits = document.createElement('div');
                credits.textContent = 'Developed by JonaPoka';
                Object.assign(credits.style, {
                    textAlign: 'center',
                    padding: '10px',
                    top: '90%',
                    color: '#fff',
                    fontSize: '12px',
                    borderTop: '1px solid #444',
                    marginTop: 'auto'
                });

                settingsContainer.appendChild(storedStructureButton);
                settingsContainer.appendChild(pageSourceButton);
                settingsContainer.appendChild(currentTypeDebug);

                settingsContainer.appendChild(credits);

                window.mainContainer.insertBefore(settingsContainer, mainContainer.children[1]);
            } else {
                settingsContainer.style.display = 'block';
            }
        }
    }

    function updateFloatingWindowContent() {
        if (!floatingWindow) return;

        const answersContainer = document.getElementById('answersContainer');
        if (!answersContainer) {
            logError('Answers container not found in floating window.', 'updateFloatingWindowContent');
            return;
        }
        answersContainer.innerHTML = '';

        const answersList = document.createElement('div'); // use div instead of ul

        storedAnswers.forEach(entry => {
            entry.answers.forEach(ans => {
                const ansDiv = document.createElement('div');
                ansDiv.textContent = ans;

                // add a line separator after each answer
                const separator = document.createElement('hr');
                separator.style.border = "0";
                separator.style.borderTop = "1px solid #555";
                separator.style.margin = "6px 0";

                answersList.appendChild(ansDiv);
                answersList.appendChild(separator);
            });
        });

        answersContainer.appendChild(answersList);

    }
    function removeFloatingWindow() {
        if (floatingWindow) {
            floatingWindow.remove();
            floatingWindow = null;
        }
    }

    function makeElementDraggable(element) {
        let isDragging = false;
        let startX, startY;

        element.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX - element.offsetLeft;
            startY = e.clientY - element.offsetTop;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                element.style.left = `${e.clientX - startX}px`;
                element.style.top = `${e.clientY - startY}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    function autoAnswer() {
        // Get the button element and change its appearance
        const autoAnswerButton = document.querySelector('#buttonsContainer button');
        if (autoAnswerButton) {
            // Store original styles
            const originalBgColor = autoAnswerButton.style.backgroundColor;
            const originalText = autoAnswerButton.textContent;

            // Change to gray and disable
            autoAnswerButton.style.backgroundColor = '#666';
            autoAnswerButton.textContent = 'Sending...';
            autoAnswerButton.disabled = true;
            autoAnswerButton.style.cursor = 'not-allowed';
        }

        console.log(storedAnswers)
        storedAnswers.forEach(entry => {
            console.log("Entry: "+entry)
            entry.answers.forEach(ans => {
                let formattedAnswer = ans;

                // If open question -> wrap & encode in <p>...</p>
                const questionIndex = currentQuestionIds.indexOf(entry.questionId);
                if (questionIndex !== -1 && currentQuestionTypes[questionIndex] === "open") {
                    formattedAnswer = `&lt;p&gt;${htmlEncode(ans)}&lt;/p&gt;`;
                }
                // apiHandler("suspend-data", formattedAnswer, entry.sectionId, entry.questionId);
                apiHandler("structure-answer", formattedAnswer, entry.sectionId, entry.questionId);
                // showNotification("AutoAnswer", "Sent", 3000);
            });
        });

        showNotification("AutoAnswer", "Sent API requests for all answers...", 3000);

        if (submitAnswers) {
            //
        }

        setTimeout(() => {
            showNotification("AutoAnswer", "Reloading, please wait...", 3000);

            // Restore button appearance after operation
            if (autoAnswerButton) {
                autoAnswerButton.style.backgroundColor = '#4CAF50';
                autoAnswerButton.textContent = 'Send Answers';
                autoAnswerButton.disabled = false;
                autoAnswerButton.style.cursor = 'pointer';
            }

            document.querySelectorAll("button.cb-page-turner")[0].click();
        }, 1000);
        document.querySelectorAll("button.cb-page-turner")[1].click();
    }

    function promptForProductKey() {
        const productKey = prompt("Please enter your product key (format: xxxx-xxxx-xxxx-xxxx):");
        if (productKey) {
            const sanitizedKey = productKey.replace(/-/g, '');
            if (sanitizedKey.length === 16) {
                validateProductKey(sanitizedKey);
            } else {
                alert("Invalid product key format. Please try again.");
                promptForProductKey();
            }
        } else {
            alert("Product key is required to proceed.");
        }
    }

    function validateProductKey(productKey) {
        localStorage.setItem('productKey', productKey);

        // Product key validation methods removed for security purposes. Validates any code.
        const startTime = Date.now();
        // Wait until the main iframe is present before creating the window
        function waitForIframe() {
            const iframe = document.querySelector("iframe");
            if (iframe && iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
                createOrUpdateFloatingWindow();
                monitorFloatingWindow();

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                showNotification('N3R0',`Successfully injected in ${elapsed} seconds`);

                // ⚡ Force initial parse if storedStructure already exists
                if (window.storedStructure) {
                    processStoredStructure(window.storedStructure);
                }

                iframe.addEventListener("load", () => {
                    createOrUpdateFloatingWindow();
                    monitorFloatingWindow();
                    if (window.storedStructure) {
                        processStoredStructure(window.storedStructure);
                    }
                });
            } else {
                setTimeout(waitForIframe, 500);
            }
        }

        // Kick off the check once DOM is ready
        if (document.readyState === "complete" || document.readyState === "interactive") {
            waitForIframe();
        } else {
            window.addEventListener("DOMContentLoaded", waitForIframe);
        }
    }



    function checkForSavedProductKey() {
        const savedProductKey = localStorage.getItem('productKey');
        if (savedProductKey) {
            validateProductKey(savedProductKey);
        } else {
            promptForProductKey();
        }
    }

    function fetchPageSource() {
        fetch(window.location.href)
            .then(response => response.text())
            .then(html => {
            console.log(html);
            extractData(html);
        })
            .catch(error => logError(error, 'fetchPageSource'));
    }

    (function(open) {
        XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
            this.addEventListener('load', function() {
                extractData(this.responseText);
                fetchPageSource()
            });
            open.call(this, method, url, async, user, pass);
        };
    })(XMLHttpRequest.prototype.open);

    (function(fetch) {
        window.fetch = function() {
            return fetch.apply(this, arguments).then(response => {
                const clonedResponse = response.clone();
                clonedResponse.text().then(responseText => extractData(responseText));
                return response;
            });
        };
    })(window.fetch);



    checkForSavedProductKey()



    const throttledUpdate = debounce(() => {
        const currentUrl = window.location.href;

        // Check if page URL has changed
        if (currentUrl !== lastPageUrl) {
            console.log("Page URL changed from", lastPageUrl, "to", currentUrl);
            lastPageUrl = currentUrl;

            // Set a timeout to check if new storedStructure was found
            if (pageChangeTimeout) {
                clearTimeout(pageChangeTimeout);
            }

            pageChangeTimeout = setTimeout(() => {
                // If we reach here, it means no new storedStructure was detected within the timeout
                handlePageChangeWithoutStructure();
                pageChangeTimeout = null;
            }, 2000); // Wait 2 seconds for new structure to be detected
        }

        updateFloatingWindowContent();
        extractFlashcardQuestion();
        extractCorrectAnswers(currentStoredStructure);
    }, 200);
    const observer = new MutationObserver(throttledUpdate);
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('popstate', throttledUpdate);
})();

