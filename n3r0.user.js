
// ==UserScript==
// @name        N3r0 Dev Build
// @namespace   http://n3r0.tech/
// @version     1.25
// @description Kun et vaan jaksaisi koulua
// @author      You
// @match       *://materiaalit.otava.fi/*
// @grant       none
// ==/UserScript==

(function() {
    'use strict';
    if (window.self !== window.top) {
        return;
    }

    let storedAnswers = [];
    let floatingWindow = null;
    let updateTimeout = null;
    let currentFlashcardQuestion = null;
    let currentStoredStructure = null;
    let sectionIds = [];

    let currentTaskId = null;


    function findInputFields() {
        console.log("searching")
        let fields = []
        let inputs = window.top.document.querySelector('iframe').contentDocument.querySelectorAll('input, textarea, [aria-label]');

        inputs.forEach(input => {
            if (input.getAttribute('aria-label') === 'Kirjoita vastaus') {
                console.log('Found input:', input);
                fields.push(input);
            }
        });
        return fields;
    }

    function updateData(storedStructure) {
        let metadata = storedStructure.structure.metadata
        currentTaskId = metadata.taskId

    }

    function apiHandler(type, answer, sectionId) {
        if (type === "structure-answer") {
            fetch("https://materiaalit.otava.fi/o/task-container/a/" + currentTaskId + "/-/structure-answer", {
                "headers": {
                    "accept": "application/json, text/javascript, */*; q=0.01",
                    "accept-language": "fi-FI,fi;q=0.9,en-US;q=0.8,en;q=0.7",
                    "cache-control": "no-cache",
                    "content-type": "application/json; charset=UTF-8",
                    "pragma": "no-cache",
                    "priority": "u=1, i",
                    "sec-ch-ua": "\"Not)A;Brand\";v=\"99\", \"Google Chrome\";v=\"127\", \"Chromium\";v=\"127\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Linux\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-origin",
                    "x-csrf-token": "v4030WaqmcB27p1m",
                    "x-requested-with": "XMLHttpRequest"
                },
                "referrer": "https://materiaalit.otava.fi/web/state-jurdsmbsga2celcpge/6107da4397dcff07e8e24e21",
                "referrerPolicy": "strict-origin-when-cross-origin",
                "body": "{\"questionId\":\"Q_64\",\"sectionId\":\""+ sectionId +"\",\"answer\":[\"" + answer + "\"],\"score\":0,\"graded\":1,\"materialId\":\"90204\",\"materialUuid\":\"5f8eda9b2c6196729023f81f\",\"page\":\"6107da4397dcff07e8e24e21\",\"pageUuid\":\"6087422edfa20c5a02dc7247\"}",
                "method": "POST",
                "mode": "cors",
                "credentials": "include"
            });
        }
    }

    function autoAnswer() {
        let inputFields = findInputFields();
        if (inputFields) {
            for (var i = 0; i < inputFields.length; i++) {
                inputFields[i].value = storedAnswers[i]
                apiHandler("structure-answer", storedAnswers[i], sectionIds[i])
            }
        }
    }

    function extractFlashcardQuestion() {
        // Check if the question type is flashcards
        const flashcardContainer = window.top.document.querySelector('iframe').contentDocument.querySelector('.flashcards');
        if (!flashcardContainer) return;
        console.log("Extracting flashcard questions")
        // Find the flashcard question inside the paragraph
        const flashcardQuestion = window.top.document.querySelector('iframe').contentDocument.querySelector("#question-Q_1424 > div.content-view-wrapper > div > div:nth-child(2) > div.flashcards-term > div > div > div")
        console.log('Current Flashcard Question:', flashcardQuestion.innerText);
        if (currentFlashcardQuestion !== flashcardQuestion.innerText) {
            currentFlashcardQuestion = flashcardQuestion.innerText
        }
        storedAnswers = extractCorrectAnswers(currentStoredStructure)
    }

    function extractCorrectAnswers(storedStructure) {
        console.log(storedStructure);
        const questions = storedStructure.structure.questions;
        const correctAnswers = [];
        sectionIds = [];

        questions.forEach(question => {
            console.log(question.type);

            // Check for 'fillintheblank' type questions
            if (question.type === "fillintheblank" || question.type === "multiplechoice") {
                question.sections.forEach(section => {
                    let correctChoice = null;
                    let maxPoints = -1;

                    sectionIds.push(section.id)

                    section.choices.forEach(choice => {
                        // Find the choice with the highest points
                        if (choice.points > maxPoints) {
                            maxPoints = choice.points;
                            correctChoice = choice.name;
                        }
                    });

                    if (correctChoice) {
                        correctAnswers.push(correctChoice);
                    }
                });
            }

            // Check for 'flashcards' type questions
            else if (question.type == "flashcards") {
                question.sections.forEach(section => {
                    if (section.name === currentFlashcardQuestion) {
                        section.choices.forEach(choice => {
                            console.log("Correct: " + choice.name)
                            correctAnswers.push(choice.name);
                        });
                    }
                });
            }

            else if (question.type === "open") return correctAnswers.push(`No answers available for this question.`);

            // Handle unsupported question types
            else {
                correctAnswers.push(`Unsupported question type: ${question.type}`);
            }
        });

        return correctAnswers;
    }



    function checkForStoredStructure(responseText) {
        try {
            if (responseText.includes('storedStructure')) {
                let regex = /var storedStructure = (\{.*?\});/;
                let match = responseText.match(regex);
                if (match && match[1]) {
                    let storedStructure = JSON.parse(match[1]);
                    currentStoredStructure = storedStructure
                    storedAnswers = extractCorrectAnswers(storedStructure);
                    updateData(storedStructure);
                    updateFloatingWindowContent();
                }
            }
        } catch (error) {
            console.error('Error parsing storedStructure:', error);
        }
    }

    (function(open) {
        XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
            this.addEventListener('load', function() {
                checkForStoredStructure(this.responseText);
            });
            open.call(this, method, url, async, user, pass);
        };
    })(XMLHttpRequest.prototype.open);

    (function(fetch) {
        window.fetch = function() {
            return fetch.apply(this, arguments).then(response => {
                const clonedResponse = response.clone();
                clonedResponse.text().then(responseText => checkForStoredStructure(responseText));
                return response;
            });
        };
    })(window.fetch);

    function createOrUpdateFloatingWindow() {
        if (floatingWindow) {
            updateFloatingWindowContent();
            return;
        }

        floatingWindow = document.createElement('div');
        floatingWindow.id = 'floatingWindow';
        floatingWindow.style.position = 'fixed';
        floatingWindow.style.width = '250px';
        floatingWindow.style.height = '300px';
        floatingWindow.style.top = '20px';
        floatingWindow.style.left = '20px';
        floatingWindow.style.backgroundColor = '#333';
        floatingWindow.style.color = '#fff';
        floatingWindow.style.border = '1px solid #000';
        floatingWindow.style.borderRadius = '10px';
        floatingWindow.style.zIndex = '10000';
        floatingWindow.style.cursor = 'move';
        floatingWindow.style.fontFamily = 'Manrope, sans-serif';
        floatingWindow.style.overflow = 'hidden';
        floatingWindow.style.boxSizing = 'border-box';

        const topBar = document.createElement('div');
        topBar.style.backgroundColor = '#222';
        topBar.style.padding = '5px';
        topBar.style.height = '30px';
        topBar.style.display = 'flex';
        topBar.style.justifyContent = 'space-between';
        topBar.style.alignItems = 'center';

        const title = document.createElement('span');
        title.textContent = 'N3r0';
        title.style.fontWeight = '800';
        title.style.fontSize = '18px';
        title.style.background = 'radial-gradient(circle at 100%, #b2a8fd, #8678f9 50%, #c7d2fe 75%, #9a8dfd 75%)';
        title.style.backgroundSize = '200% auto';
        title.style.color = '#000';
        title.style.backgroundClip = 'text';
        title.style.webkitTextFillColor = 'transparent';
        title.style.animation = 'animatedTextGradient 1.5s linear infinite';
        topBar.appendChild(title);

        const closeButton = document.createElement('button');
        closeButton.textContent = 'X';
        closeButton.style.marginLeft = 'auto';
        closeButton.style.backgroundColor = '#ff4d4d';
        closeButton.style.border = 'none';
        closeButton.style.color = '#fff';
        closeButton.style.cursor = 'pointer';
        closeButton.onclick = removeFloatingWindow;
        topBar.appendChild(closeButton);

        floatingWindow.appendChild(topBar);

        const contentArea = document.createElement('div');
        contentArea.style.padding = '10px';
        contentArea.style.overflowY = 'auto';
        contentArea.style.height = 'calc(100% - 30px)';
        contentArea.style.position = 'relative';
        floatingWindow.appendChild(contentArea);

        const loadingSpinner = document.createElement('div');
        loadingSpinner.id = 'loadingSpinner';
        loadingSpinner.style.border = '4px solid #f3f3f3';
        loadingSpinner.style.borderTop = '4px solid #b2a8fd';
        loadingSpinner.style.borderRadius = '50%';
        loadingSpinner.style.width = '24px';
        loadingSpinner.style.height = '24px';
        loadingSpinner.style.animation = 'spin 1s linear infinite';
        loadingSpinner.style.position = 'absolute';
        loadingSpinner.style.left = '50%';
        loadingSpinner.style.top = '50%';
        loadingSpinner.style.transform = 'translate(-50%, -50%)';

        contentArea.appendChild(loadingSpinner);

        document.body.appendChild(floatingWindow);

        const style = document.createElement('style');
        style.textContent = `
            @keyframes animatedTextGradient {
                to {
                    background-position: 200% center;
                }
            }
            @keyframes spin {
                0% { transform: translate(-50%, -50%) rotate(0deg); }
                100% { transform: translate(-50%, -50%) rotate(360deg); }
            }
        `;
        document.head.appendChild(style);

        const fontLink = document.createElement('link');
        fontLink.rel = 'stylesheet';
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap';
        document.head.appendChild(fontLink);

        makeElementDraggable(floatingWindow);
    }

    function updateFloatingWindowContent() {
        if (!floatingWindow) return; // Ensure the window exists before updating
        const contentArea = floatingWindow.querySelector('div:nth-child(2)');
        const loadingSpinner = document.getElementById('loadingSpinner');

        contentArea.innerHTML = '';
        const answersList = document.createElement('ul');
        storedAnswers.forEach(answer => {
            const listItem = document.createElement('li');
            listItem.textContent = answer;
            answersList.appendChild(listItem);
        });
        contentArea.appendChild(answersList);
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

        element.addEventListener('mousedown', function(e) {
            autoAnswer()
            isDragging = true;
            startX = e.clientX - element.offsetLeft;
            startY = e.clientY - element.offsetTop;
        });

        document.addEventListener('mousemove', function(e) {
            if (isDragging) {
                element.style.left = `${e.clientX - startX}px`;
                element.style.top = `${e.clientY - startY}px`;
            }
        });

        document.addEventListener('mouseup', function() {
            isDragging = false;
        });
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
        fetch('https://api.n3r0.tech:3000/validate-key', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ key: productKey })
        })
        .then(response => response.json())
        .then(data => {
            if (data.valid) {
                // Save the product key to localStorage
                localStorage.setItem('productKey', productKey);
                // Proceed with the program
                createOrUpdateFloatingWindow();
            } else {
                alert("Invalid product key. Please try again.");
                promptForProductKey();
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert("An error occurred while validating the product key.");
        });
    }

    function checkForSavedProductKey() {
        const savedProductKey = localStorage.getItem('productKey');
        if (savedProductKey) {
            validateProductKey(savedProductKey);
        } else {
            promptForProductKey();
        }
    }

    checkForSavedProductKey();

    function throttledUpdate() {
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
            updateFloatingWindowContent();
        }, 200);
    }

    const observer = new MutationObserver(() => {
        throttledUpdate();
        extractFlashcardQuestion();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    window.addEventListener('popstate', throttledUpdate);
})();
