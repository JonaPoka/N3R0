-// ==UserScript==
// @name        N3r0 Performance Test
// @namespace   http://n3r0.tech/
// @version     1.0
// @description Kun et vaan jaksaisi koulua
// @author      You
// @match       *://materiaalit.otava.fi/*
// @grant       none
// @run-at      document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Ensure script runs only in the top window
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

    // Constants
    const API_BASE_URL = "https://materiaalit.otava.fi/o/task-container/a/";
    const INPUT_FIELD_SELECTOR = 'input, textarea, [aria-label]';
    const FLASHCARD_CONTAINER_SELECTOR = '.flashcards';
    const FLASHCARD_QUESTION_SELECTOR = '#question-Q_1424 > div.content-view-wrapper > div > div:nth-child(2) > div.flashcards-term > div > div > div';

    // Utility Functions
    function logError(error, context = '') {
        console.error(`Error in ${context}:`, error);
        showNotification('DEBUG', `Error in ${context}`, 3000)
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
    async function apiHandler(type, answer, sectionId) {
        const url = type === "structure-answer"
            ? `${API_BASE_URL}${currentTaskId}/-/structure-answer`
            : `${API_BASE_URL}${currentTaskId}/-/score`;

        const body = type === "structure-answer"
            ? JSON.stringify({
                questionId: currentQuestionIds[0],
                sectionId: sectionId,
                answer: [answer],
                score: 0,
                graded: 1,
                materialId: currentMaterialId,
                materialUuid: currentMaterialUuid,
                page: currentPage,
                pageUuid: currentPageUuid
            })
            : JSON.stringify({
                score: currentMaxScore,
                progressMeasure: 1,
                scoreMax: currentMaxScore,
                materialId: currentMaterialId,
                materialUuid: currentMaterialUuid,
                page: currentPage,
                pageUuid: currentPageUuid
            });

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: body
            });
            if (!response.ok) throw new Error(`API request failed: ${response.statusText}`);
        } catch (error) {
            logError(error, 'apiHandler');
        }
    }

    function stripHtmlToText(html) {
        // 1. Turn block-level tags into newlines
        html = html.replace(/<\s*\/?(div|p|h[1-6]|li|br)[^>]*>/gi, '\n');

        // 2. Remove all other tags
        html = html.replace(/<[^>]+>/g, '');

        // 3. Decode a few common HTML entities
        html = html
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        // 4. Normalize whitespace and collapse multiple newlines
        html = html
            .replace(/\r\n|\r/g, '\n')       // unify newlines
            .replace(/\n[ \t]*\n+/g, '\n\n') // collapse multiple blank lines
            .replace(/[ \t]+/g, ' ')         // collapse spaces/tabs
            .trim();

        return html;
    }

    function extractCorrectAnswers(storedStructure) {
        if (!storedStructure?.structure?.questions) {
            logError('Invalid storedStructure', 'extractCorrectAnswers');
            return [];
        }

        const questions = storedStructure.structure.questions;
        const results = [];
        currentQuestionIds = [];
        currentQuestionTypes = [];
        currentSectionIds = [];

        questions.forEach(question => {
            currentQuestionIds.push(question.id);
            currentQuestionTypes.push(question.type);

            if (question.type === 'open' && question.exampleAnswer?.medias?.length > 0) {
                const exampleText = question.exampleAnswer.medias[0].content.text;
                results.push({
                    questionId: question.id,
                    sectionId: null,
                    answers: [stripHtmlToText(exampleText)]
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


    function extractData(responseText) {
        try {
            const storedStructureMatch = responseText.match(/var storedStructure = (\{.*?\});/);
            if (storedStructureMatch) {
                currentStoredStructure = JSON.parse(storedStructureMatch[1]);
                storedAnswers = extractCorrectAnswers(currentStoredStructure);
                updateFloatingWindowContent();
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
            // if window is gone or detached from DOM → restore
            if (!floatingWindow || !document.body.contains(floatingWindow)) {
                console.warn("Floating window missing, restoring...");
                createOrUpdateFloatingWindow();
            }
        }, 1000); // check every second
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
        autoAnswerButton.textContent = 'Auto Answer';
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
        buttonsContainer.appendChild(placeholderButton);

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

        const answersList = document.createElement('ul');

        storedAnswers.forEach(entry => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `<strong>${entry.questionId}</strong> (${entry.sectionId || "no section"})`;

            const subList = document.createElement('ul');
            entry.answers.forEach(ans => {
                const ansItem = document.createElement('li');
                ansItem.textContent = ans;
                subList.appendChild(ansItem);
            });
            listItem.appendChild(subList);
            answersList.appendChild(listItem);
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
        storedAnswers.forEach(entry => {
            entry.answers.forEach(ans => {
                apiHandler("structure-answer", ans, entry.sectionId);
            });
        });

        showNotification("AutoAnswer", "Sent API requests for all answers...", 3000);
        
        if (submitAnswers) {
            // 
        }

        setTimeout(() => {
            const iframe = document.getElementsByClassName('cloubi-library-tasks-iframe')[0];
            if (iframe) iframe.src = iframe.src; // reload
        }, 2000);
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

        createOrUpdateFloatingWindow();
        monitorFloatingWindow();k
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
        updateFloatingWindowContent();
        extractFlashcardQuestion();
    }, 200);

    const observer = new MutationObserver(throttledUpdate);
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('popstate', throttledUpdate);
})();

