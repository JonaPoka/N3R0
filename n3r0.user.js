// ==UserScript==
// @name        Intercept HTTP Responses to Extract storedStructure
// @namespace   http://tampermonkey.net/
// @version     1.25
// @description Intercepts HTTP responses to extract storedStructure
// @author      You
// @match       *://materiaalit.otava.fi/*
// @grant       none
// ==/UserScript==

(function() {
    'use strict';

    // Only run in the top-level window
    if (window.self !== window.top) {
        return; // Exit the script if running in an iframe
    }

    let storedAnswers = []; // To store answers globally
    let floatingWindow = null; // To reference the floating window
    let updateTimeout = null; // Timeout for throttling updates

    function extractCorrectAnswers(storedStructure) {
        const questions = storedStructure.structure.questions;
        const correctAnswers = [];

        questions.forEach(question => {
            question.sections.forEach(section => {
                section.choices.forEach(choice => {
                    if (choice.correct) {
                        correctAnswers.push(choice.correct);
                    }
                });
            });
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
                    storedAnswers = extractCorrectAnswers(storedStructure);
                    updateFloatingWindowContent(); // Update window content with new answers
                }
            }
        } catch (error) {
            console.error('Error parsing storedStructure:', error);
        }
    }

    // Intercept XMLHttpRequests
    (function(open) {
        XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
            this.addEventListener('load', function() {
                checkForStoredStructure(this.responseText);
            });
            open.call(this, method, url, async, user, pass);
        };
    })(XMLHttpRequest.prototype.open);

    // Intercept fetch requests
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
            // If the window already exists, just update its content
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

        contentArea.innerHTML = ''; // Clear existing content
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

    
    
    // Function to prompt for product key and validate it
    function promptForProductKey() {
        const productKey = prompt("Please enter your product key (format: xxxx-xxxx-xxxx-xxxx):");
        if (productKey) {
            // Remove hyphens and check the length
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

    // Function to validate product key
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

    // Function to check for saved product key and validate it
    function checkForSavedProductKey() {
        const savedProductKey = localStorage.getItem('productKey');
        if (savedProductKey) {
            validateProductKey(savedProductKey);
        } else {
            promptForProductKey();
        }
    }

    // Call the check function when the script loads
    checkForSavedProductKey();

    // Throttled function to update content
    function throttledUpdate() {
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
            updateFloatingWindowContent();
        }, 200); // Adjust the delay as needed
    }

    // Detect page changes using a MutationObserver
    const observer = new MutationObserver(() => {
        throttledUpdate(); // Use throttled update instead of direct call
    });

    observer.observe(document.querySelector('main'), { // Adjust selector to observe only necessary parts
        childList: true,
        subtree: true
    });

    window.addEventListener('popstate', throttledUpdate);
})();
