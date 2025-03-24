// Global variable to keep track of the current chat ID.
let currentChatId = null;

// Track processing status
let processingInterval = null;
let processingData = {};

/**
 * Updates the chat ID display on the frontend.
 */
function updateChatIdDisplay() {
    const chatIdSpan = document.getElementById('chat-id');
    // Show the chat ID if available; otherwise, display a placeholder.
    chatIdSpan.textContent = currentChatId !== null ? currentChatId : 'None';
}

/**
 * Start a new chat session and store the chat ID.
 */
async function startNewChat() {
    try {
        const response = await fetch("/assistant/chat/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        const data = await response.json();
        if (data.chat_id) {
            currentChatId = data.chat_id;
            updateChatIdDisplay();
        }
    } catch (error) {
        console.error("Error starting a new chat:", error);
    }
}

/**
 * If second assistant is enabled, we add a button below both assistant messages.
 * Clicking this "Prefer" button will mark that output as preferred.
 * Then we hide the other assistant output from the same parent message.
 */
async function preferOutput(parentMessageId, outputNumber) {
    if (!currentChatId) {
        console.warn('No current chat for preferOutput.');
        return;
    }
    try {
        const response = await fetch(`/assistant/chat/${currentChatId}/message/${parentMessageId}/prefer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferred_output: outputNumber })
        });
        const data = await response.json();
        if (data.error) {
            console.error('Error preferring message:', data.error);
            return;
        }
        console.log('Preferred output updated:', data);

        // Hide the sibling message in the UI.
        // The sibling has the same data-parent-id but a different data-output-number.
        const otherOutputNumber = outputNumber === 1 ? 2 : 1;
        const sibling = document.querySelector(
            `[data-parent-id='${parentMessageId}'][data-output-number='${otherOutputNumber}']`
        );
        if (sibling) {
            sibling.style.display = 'none';
        }
    } catch (err) {
        console.error('Failed to prefer output:', err);
    }
}

/**
 * Appends a message bubble to the messages container.
 * Each message now includes a unique ID for identification.
 * If the message is from the assistant and includes a critic score,
 * a small circle with the score is added.
 * If second assistant is enabled, we also add a "Prefer" button.
 */
function addMessageToChat(
    id,
    text,
    role,
    criticScore,
    isDummy = false,
    parentId = null,
    outputNumber = null,
    extraData = null
) {
    const messagesContainer = document.getElementById('messages');

    // Check if the message already exists
    let existingMessage = document.querySelector(`[data-message-id='${id}']`);
    if (existingMessage) {
        // Update the text content if it's changed (for async processing updates)
        const textSpan = existingMessage.querySelector('.message-text');
        if (textSpan && textSpan.textContent !== text) {
            textSpan.textContent = text;
        }
        
        // Update the critic score if needed
        if (criticScore !== undefined) {
            let criticCircle = existingMessage.querySelector('.critic-score');
            if (!criticCircle) {
                criticCircle = document.createElement('div');
                criticCircle.className = 'critic-score absolute top-0 right-0 mt-1 mr-1 text-xs text-white bg-red-500 rounded-full w-5 h-5 flex items-center justify-center';
                existingMessage.appendChild(criticCircle);
            }
            criticCircle.textContent = criticScore;
        }
        
        // Update extra data if provided
        if (extraData) {
            updateExtraDataSection(existingMessage, extraData);
        }
        
        return existingMessage;
    }

    // Create the message bubble container.
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'p-4 rounded-lg max-w-[75%] min-w-[25%] break-words flex flex-col relative';
    bubbleDiv.setAttribute('data-message-id', id);
    if (parentId) {
        bubbleDiv.setAttribute('data-parent-id', parentId);
    }
    if (outputNumber) {
        bubbleDiv.setAttribute('data-output-number', outputNumber.toString());
    }

    // Mark this bubble as a dummy if requested.
    if (isDummy) {
        bubbleDiv.classList.add('dummy-message');
    }

    // Create an element for the message text.
    const textSpan = document.createElement('span');
    textSpan.className = 'message-text';
    textSpan.textContent = text;
    bubbleDiv.appendChild(textSpan);

    // If assistant + critic score, add small circle.
    if (role === 'assistant' && criticScore !== undefined) {
        const criticCircle = document.createElement('div');
        criticCircle.textContent = criticScore;
        criticCircle.className = 'critic-score absolute top-0 right-0 mt-1 mr-1 text-xs text-white bg-red-500 rounded-full w-5 h-5 flex items-center justify-center';
        bubbleDiv.appendChild(criticCircle);
    }

    // If second assistant is enabled AND role===assistant AND outputNumber is valid,
    // add a "Prefer" button to choose this output.
    const secondAssistantToggle = document.getElementById('second-assistant-toggle');
    const secondAssistantEnabled = secondAssistantToggle && secondAssistantToggle.checked;
    if (role === 'assistant' && secondAssistantEnabled && outputNumber) {
        const preferBtn = document.createElement('button');
        preferBtn.textContent = 'Prefer';
        preferBtn.className = 'mt-2 text-xs self-end bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded';
        preferBtn.onclick = () => {
            if (!parentId) {
                console.warn('No parent message ID to prefer.');
                return;
            }
            preferOutput(parentId, outputNumber);
        };
        bubbleDiv.appendChild(preferBtn);
    }
    
    // Add extra data sections if provided
    if (extraData) {
        updateExtraDataSection(bubbleDiv, extraData);
    }

    // Assign classes for styling.
    bubbleDiv.classList.add(role === 'assistant' ? 'assistant-message' : 'user-message');

    messagesContainer.appendChild(bubbleDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return bubbleDiv;
}

/**
 * Updates or creates sections for extra message data like NER results, search results, etc.
 */
function updateExtraDataSection(messageElement, extraData) {
    // Check if we have regenerated content
    const hasRegeneration = extraData.regenerated_content && 
                          extraData.regenerated_content.trim().length > 0;

    // Clear any existing regeneration comparison sections before adding new ones
    const existingComparison = messageElement.querySelector('.regeneration-comparison');
    if (existingComparison) {
        existingComparison.remove();
    }
    
    // If we have regeneration, create a special comparison section at the top
    if (hasRegeneration) {
        createRegenerationComparisonUI(messageElement, extraData);
    }
    
    // Process each type of extra data for expandable sections
    if (extraData.ner_result) {
        addOrUpdateSection(messageElement, 'ner-result', 'Extracted Preferences', formatJsonAsHtml(extraData.ner_result));
    }
    
    if (extraData.search_call_result) {
        addOrUpdateSection(messageElement, 'search-call', 'Search Query', extraData.search_call_result);
    }
    
    if (extraData.search_result) {
        const searchResultContent = extraData.search_result.results || "No results available";
        addOrUpdateSection(messageElement, 'search-result', 'Search Results', searchResultContent);
    }
    
    if (extraData.thinking) {
        addOrUpdateSection(messageElement, 'thinking', 'Assistant Reasoning', extraData.thinking);
    }
    
    // Only show critic result section if we don't have regeneration (otherwise it's in the comparison UI)
    if (!hasRegeneration && extraData.critic_result) {
        const criticContent = formatCriticResultSafely(extraData.critic_result);
        addOrUpdateSection(messageElement, 'critic-result', 'Response Evaluation', criticContent);
    }
}

function createRegenerationComparisonUI(messageElement, extraData) {
    // Create the main comparison container
    const comparisonDiv = document.createElement('div');
    comparisonDiv.className = 'regeneration-comparison mt-4 mb-2 border-t pt-2 border-gray-300';
    
    // Add a header
    const header = document.createElement('div');
    header.className = 'text-sm font-semibold mb-2 text-blue-600';
    header.textContent = 'This response was improved based on quality evaluation';
    comparisonDiv.appendChild(header);
    
    // Create the comparison grid
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-3';
    
    // Original response section
    const originalDiv = document.createElement('div');
    originalDiv.className = 'border rounded p-2 bg-gray-50';
    
    // Get the message text - this is the original response
    const messageText = messageElement.querySelector('.message-text');
    const originalResponseText = messageText ? messageText.textContent : '';
    
    // Original response heading
    const originalHeading = document.createElement('div');
    originalHeading.className = 'text-xs font-bold mb-1 text-gray-700';
    originalHeading.textContent = 'Original Response';
    originalDiv.appendChild(originalHeading);
    
    // Original response content
    const originalContent = document.createElement('div');
    originalContent.className = 'text-xs text-gray-800 max-h-40 overflow-y-auto';
    originalContent.textContent = originalResponseText;
    originalDiv.appendChild(originalContent);
    
    // Original critic score
    if (extraData.critic_result) {
        const originalCritic = document.createElement('div');
        originalCritic.className = 'mt-2 pt-2 border-t border-gray-200';
        originalCritic.innerHTML = `
            <div class="text-xs font-bold mb-1 text-gray-700">Original Evaluation</div>
            <div class="text-xs critic-details">${formatCriticResultSafely(extraData.critic_result)}</div>
        `;
        originalDiv.appendChild(originalCritic);
    }
    
    // Improved response section
    const improvedDiv = document.createElement('div');
    improvedDiv.className = 'border rounded p-2 bg-blue-50';
    
    // Improved response heading
    const improvedHeading = document.createElement('div');
    improvedHeading.className = 'text-xs font-bold mb-1 text-blue-700';
    improvedHeading.textContent = 'Improved Response';
    improvedDiv.appendChild(improvedHeading);
    
    // Improved response content
    const improvedContent = document.createElement('div');
    improvedContent.className = 'text-xs text-gray-800 max-h-40 overflow-y-auto';
    improvedContent.textContent = extraData.regenerated_content;
    improvedDiv.appendChild(improvedContent);
    
    // Improved critic score
    if (extraData.regenerated_critic) {
        const improvedCritic = document.createElement('div');
        improvedCritic.className = 'mt-2 pt-2 border-t border-gray-200';
        improvedCritic.innerHTML = `
            <div class="text-xs font-bold mb-1 text-blue-700">Improved Evaluation</div>
            <div class="text-xs critic-details">${formatCriticResultSafely(extraData.regenerated_critic)}</div>
        `;
        improvedDiv.appendChild(improvedCritic);
    }
    
    // Add sections to grid
    grid.appendChild(originalDiv);
    grid.appendChild(improvedDiv);
    comparisonDiv.appendChild(grid);
    
    // Add buttons for choosing which response to display
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'flex justify-between mt-2';
    
    // Button to use original response
    const useOriginalBtn = document.createElement('button');
    useOriginalBtn.className = 'text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-2 rounded';
    useOriginalBtn.textContent = 'Use Original Response';
    useOriginalBtn.onclick = () => {
        if (messageText) {
            messageText.textContent = originalResponseText;
        }
    };
    
    // Button to use improved response
    const useImprovedBtn = document.createElement('button');
    useImprovedBtn.className = 'text-xs bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-2 rounded';
    useImprovedBtn.textContent = 'Use Improved Response';
    useImprovedBtn.onclick = () => {
        if (messageText) {
            messageText.textContent = extraData.regenerated_content;
        }
    };
    
    buttonsDiv.appendChild(useOriginalBtn);
    buttonsDiv.appendChild(useImprovedBtn);
    comparisonDiv.appendChild(buttonsDiv);
    
    // Add to message element - insert after the message text
    messageElement.insertBefore(comparisonDiv, messageElement.querySelector('.message-text').nextSibling);
}

/**
 * Safely formats critic result data, handling potential parsing errors
 */
function formatCriticResultSafely(criticData) {
    try {
        return formatCriticResult(criticData);
    } catch (e) {
        console.error("Error formatting critic result:", e);
        return "<span class='text-red-500'>Error displaying evaluation data</span>";
    }
}


// Helper function to add or update a section
function addOrUpdateSection(parentElement, sectionId, title, content) {
    // Check if section already exists
    let section = parentElement.querySelector(`[data-section-id="${sectionId}"]`);
    
    if (section) {
        // Update existing section content
        const contentDiv = section.querySelector('.section-content');
        if (contentDiv) {
            contentDiv.innerHTML = content;
        }
        return;
    }
    
    // Create new section
    section = document.createElement('div');
    section.className = 'mt-3 border-t pt-2 w-full';
    section.setAttribute('data-section-id', sectionId);
    
    // Create toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-2 rounded';
    toggleBtn.textContent = `Show ${title}`;
    
    // Create content container (hidden initially)
    const contentDiv = document.createElement('div');
    contentDiv.className = 'section-content mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto max-h-40 hidden';
    contentDiv.innerHTML = content;
    
    // Add click handler for toggle
    toggleBtn.onclick = () => {
        const isHidden = contentDiv.classList.contains('hidden');
        contentDiv.classList.toggle('hidden');
        toggleBtn.textContent = isHidden ? `Hide ${title}` : `Show ${title}`;
    };
    
    // Add elements to section
    section.appendChild(toggleBtn);
    section.appendChild(contentDiv);
    
    // Add section to parent
    parentElement.appendChild(section);
}

// Helper function to safely format JSON
function formatJsonAsHtml(jsonObj) {
    try {
        if (typeof jsonObj === 'string') {
            jsonObj = JSON.parse(jsonObj);
        }
        return '<pre>' + JSON.stringify(jsonObj, null, 2) + '</pre>';
    } catch (e) {
        return '<pre>Error formatting: ' + e.message + '</pre>';
    }
}

/**
 * Format critic result in a readable way.
 */
function formatCriticResult(criticData) {
    if (!criticData) return "No critique available";
    
    let html = '<div class="critic-result">';
    
    // Add total score if present
    if (criticData.total_score !== undefined) {
        html += `<div class="font-bold">Score: ${criticData.total_score}</div>`;
    }
    
    // Add summary if present
    if (criticData.summary) {
        html += `<div class="mt-1"><strong>Summary:</strong> ${criticData.summary}</div>`;
    }
    
    // Add category scores
    const categories = [
        'adherence_to_search', 
        'question_format',
        'conversational_quality',
        'contextual_intelligence',
        'overall_effectiveness'
    ];
    
    // Build table of scores
    let tableHtml = '<table class="mt-2 w-full text-xs border-collapse">';
    tableHtml += '<tr><th class="text-left">Category</th><th class="text-right">Score</th></tr>';
    
    categories.forEach(category => {
        if (criticData[category]) {
            const score = criticData[category].score;
            const categoryName = category.split('_').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ');
            
            tableHtml += `<tr>
                <td>${categoryName}</td>
                <td class="text-right">${score}</td>
            </tr>`;
        }
    });
    
    tableHtml += '</table>';
    html += tableHtml;
    
    return html;
}

/**
 * Polls the server for processing status updates for a message.
 */
// Modified startProcessingPolling to preserve all sections
function startProcessingPolling(messageId, outputNumber) {
    // Clear any existing interval
    if (processingInterval) {
        clearInterval(processingInterval);
    }
    
    // Keep track of original content to prevent losing it during regeneration
    let originalContent = null;
    let isProcessingStatusShown = false;
    
    const pollingFunc = async () => {
        if (!currentChatId) return;
        
        try {
            const chatIdForRequest = outputNumber === 2 ? `${currentChatId}_second` : currentChatId;
            const response = await fetch(`/assistant/chat/processing/${chatIdForRequest}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) {
                console.error('Error fetching processing status:', response.statusText);
                return;
            }
            
            const data = await response.json();
            
            // Update processingData
            processingData[messageId] = data;
            
            // Get the message element
            const messageElement = document.querySelector(`[data-message-id='${messageId}']`);
            if (!messageElement) {
                console.warn(`Message element not found: ${messageId}`);
                return;
            }
            
            // Get the message text element
            const textSpan = messageElement.querySelector('.message-text');
            if (!textSpan) return;
            
            // If we haven't saved the original content yet and this isn't the initial processing message
            if (originalContent === null && !textSpan.textContent.includes('[Processing')) {
                originalContent = textSpan.textContent;
            }
            
            // Create or update the processing status overlay
            let processingOverlay = messageElement.querySelector('.processing-overlay');
            
            if (data.status === 'processing') {
                // Show processing status as an overlay instead of replacing content
                if (!processingOverlay) {
                    processingOverlay = document.createElement('div');
                    processingOverlay.className = 'processing-overlay absolute top-0 left-0 w-full bg-black bg-opacity-70 text-white p-2 rounded-t-lg z-10';
                    messageElement.appendChild(processingOverlay);
                    
                    // Make sure the message element has relative positioning for proper overlay
                    if (!messageElement.style.position) {
                        messageElement.style.position = 'relative';
                    }
                }
                
                // Check if we're in the regeneration phase
                const isRegenerating = data.step && (data.step.includes('regenerat') || data.step === 'evaluating_response');
                
                if (isRegenerating) {
                    processingOverlay.innerHTML = `
                        <div class="flex items-center justify-between">
                            <span>${data.step}: ${data.progress}%</span>
                            ${originalContent ? '<span class="text-xs">Original response preserved</span>' : ''}
                        </div>
                    `;
                    
                    // If we have original content and we're regenerating, make sure it's still shown
                    if (originalContent && textSpan.textContent.includes('[')) {
                        textSpan.textContent = originalContent;
                    }
                } else {
                    processingOverlay.innerHTML = `<span>${data.step}: ${data.progress}%</span>`;
                    
                    // For initial processing, we can show the status in the message
                    if (!originalContent) {
                        textSpan.textContent = `[${data.step}: ${data.progress}%]`;
                        isProcessingStatusShown = true;
                    }
                }
                
                // Update expandable sections with any data we have so far
                // This ensures sections appear as soon as their data is available
                updateAllExpandableSections(messageElement, data);
            } else {
                // Remove the processing overlay if processing is complete
                if (processingOverlay) {
                    processingOverlay.remove();
                }
                
                // If completed or error, stop polling and update the message
                if (data.completed || data.status === 'error') {
                    clearInterval(processingInterval);
                    processingInterval = null;
                    
                    // Handle error case
                    if (data.error) {
                        textSpan.textContent = `[Error: ${data.error}]`;
                        return;
                    }
                    
                    // Handle regeneration case - show comparison UI
                    if (data.regenerated_response && data.final_response) {
                        // Create regeneration comparison UI
                        createRegenerationUI(messageElement, data, originalContent || data.final_response);
                    } 
                    // Handle normal completion without regeneration
                    else if (data.final_response) {
                        textSpan.textContent = data.final_response;
                        // Update all expandable sections
                        updateAllExpandableSections(messageElement, data);
                    }
                    
                    // Add critic score if available
                    updateCriticScore(messageElement, data);
                }
            }
        } catch (err) {
            console.error('Error polling for processing status:', err);
        }
    };
    
    // Call immediately and then set interval
    pollingFunc();
    processingInterval = setInterval(pollingFunc, 1000);
}


/**
 * Add CSS styles for the regeneration comparison UI
 */
function addRegenerationStyles() {
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        .regeneration-comparison {
            font-family: system-ui, -apple-system, sans-serif;
        }
        
        .critic-details {
            font-size: 10px;
        }
        
        .critic-details table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 4px;
        }
        
        .critic-details table th,
        .critic-details table td {
            padding: 2px 4px;
            border-bottom: 1px solid #e5e7eb;
            text-align: left;
        }
        
        .critic-details table th {
            font-weight: bold;
            background-color: #f9fafb;
        }
    `;
    document.head.appendChild(styleEl);
}

// Add the styles when the document loads
document.addEventListener('DOMContentLoaded', addRegenerationStyles);
/**
 * Polls the server every 5 seconds to update critic scores.
 */
async function pollCriticScores() {
    if (!currentChatId) return;

    try {
        const response = await fetch(`/assistant/chat/score/${currentChatId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (data.scores) {
            data.scores.forEach(scoreObj => {
                // Update existing messages without modifying text
                let existingMessage = document.querySelector(`[data-message-id='${scoreObj.id}']`);
                if (existingMessage) {
                    let criticCircle = existingMessage.querySelector('.critic-score');
                    if (!criticCircle) {
                        criticCircle = document.createElement('div');
                        criticCircle.className = 'critic-score absolute top-0 right-0 mt-1 mr-1 text-xs text-white bg-red-500 rounded-full w-5 h-5 flex items-center justify-center';
                        existingMessage.appendChild(criticCircle);
                    }
                    
                    // Parse critic score from the data
                    let criticScore = null;
                    try {
                        if (scoreObj.critic_score) {
                            const criticData = typeof scoreObj.critic_score === 'string' 
                                ? JSON.parse(scoreObj.critic_score) 
                                : scoreObj.critic_score;
                                
                            criticScore = criticData.total_score;
                        }
                    } catch (e) {
                        console.error('Error parsing critic score:', e);
                    }
                    
                    // Check if the score has changed
                    if (criticScore !== null && criticCircle.textContent !== criticScore.toString()) {
                        criticCircle.textContent = criticScore;

                        // Force a DOM update by toggling opacity
                        existingMessage.style.opacity = '0.99';
                        setTimeout(() => {
                            existingMessage.style.opacity = '1';
                        }, 10);
                    }
                }
            });
        }
    } catch (err) {
        console.error('Error fetching critic scores:', err);
    }
}

/**
 * Removes only the dummy messages from the messages container.
 */
function removeDummyMessages() {
    const dummyMessages = document.querySelectorAll('.dummy-message');
    dummyMessages.forEach(dummy => dummy.remove());
}

/**
 * Clears all messages from the messages container.
 */
function clearAllMessages() {
    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
}

/**
 * Sends a POST /assistant/chat request to the server with the user_input and, if available, the chat_id.
 * The server returns a JSON object with the message dump (including assistant messages).
 *
 * @param {string} userInput
 */
async function sendToServer(userInput) {
    try {
        const payload = { user_input: userInput };
        if (currentChatId) {
            payload.chat_id = currentChatId;
        }
        console.log("Sending payload:", payload);
        
        const response = await fetch('/assistant/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        console.log("Received data:", data);

        if (data.error) {
            removeDummyMessages();
            addMessageToChat('error', data.error, 'assistant');
            return;
        }

        // Update the global currentChatId if the server returns one.
        if (data.chat_id) {
            currentChatId = data.chat_id;
            updateChatIdDisplay();
        }

        // Wait one second before updating the UI.
        setTimeout(() => {
            removeDummyMessages();

            // user_message
            if (data.user_message) {
                addMessageToChat(
                    data.user_message.id,
                    data.user_message.content,
                    'user',
                    undefined,
                    false,
                    null, // parent ID not needed for user message
                    null  // no outputNumber
                );
            }

            // assistant_message (primary)
            if (data.assistant_message) {
                const messageBubble = addMessageToChat(
                    data.assistant_message.id,
                    data.assistant_message.content,
                    'assistant',
                    getTotalScoreFromCritic(data.assistant_message.critic_score),
                    false,
                    data.id, // use the parent 'Message' id
                    data.assistant_message.output_number // might be 1
                );
                
                // Start polling for processing status
                startProcessingPolling(data.assistant_message.id, 1);
            }

            // assistant_message2 (secondary)
            if (data.assistant_message2) {
                const messageBubble2 = addMessageToChat(
                    data.assistant_message2.id,
                    data.assistant_message2.content,
                    'assistant',
                    getTotalScoreFromCritic(data.assistant_message2.critic_score),
                    false,
                    data.id, // same parent message ID
                    data.assistant_message2.output_number // might be 2
                );
                
                // Start polling for processing status for second assistant
                startProcessingPolling(data.assistant_message2.id, 2);
            }
        }, 1000);

    } catch (err) {
        console.error('Error sending to server:', err);
        removeDummyMessages();
        addMessageToChat('error', "Error: Failed to get response from server.", 'assistant');
    }
}

/**
 * Extract total_score from critic data.
 */
function getTotalScoreFromCritic(criticData) {
    if (!criticData) return undefined;
    
    try {
        // Parse if it's a string
        const criticJson = typeof criticData === 'string' 
            ? JSON.parse(criticData) 
            : criticData;
            
        // Return total_score if it exists
        return criticJson.total_score;
    } catch (e) {
        console.error('Error parsing critic data:', e);
        return undefined;
    }
}

// DOM elements
const userInputEl = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const refreshBtn = document.getElementById('refresh-btn');
const secondAssistantToggle = document.getElementById('second-assistant-toggle');

/**
 * Handles sending the user's message.
 */
function handleSend() {
    const text = userInputEl.value.trim();
    if (!text) return;

    userInputEl.value = '';
    addMessageToChat('temp-user', text, 'user', undefined, true);
    addMessageToChat('temp-assistant', "Assistant is typing...", 'assistant', undefined, true);

    setTimeout(() => {
        sendToServer(text);
    }, 1000);
}

/**
 * Refreshes the current chat session.
 */
function refreshSession() {
    currentChatId = null;
    updateChatIdDisplay();
    clearAllMessages();
    addMessageToChat('system-refresh', "Session refreshed.", 'assistant');
}

/**
 * Toggles the second assistant by calling the appropriate API endpoint.
 * @param {boolean} enable
 */
async function toggleSecondAssistant(enable) {
    if (!currentChatId) {
        console.warn('No current chat. Create or join a chat first.');
        secondAssistantToggle.checked = false;
        return;
    }

    const url = enable
        ? `/assistant/chat/enable_second_assistant/${currentChatId}`
        : `/assistant/chat/disable_second_assistant/${currentChatId}`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        // If the backend returns success
        if (data.error) {
            console.warn('Toggling second assistant failed:', data.error);
            secondAssistantToggle.checked = !enable; // revert
        } else if (data.success !== undefined && data.success !== true) {
            console.warn('Unexpected response:', data);
            secondAssistantToggle.checked = !enable;
        } else {
            console.log('Second assistant toggled:', data);
        }
    } catch (e) {
        console.error('Error toggling second assistant:', e);
        secondAssistantToggle.checked = !enable;
    }
}

// Event listeners
sendBtn.addEventListener('click', handleSend);
userInputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
    }
});
refreshBtn.addEventListener('click', refreshSession);
secondAssistantToggle.addEventListener('change', (e) => {
    toggleSecondAssistant(e.target.checked);
});

// Start polling for critic scores every 5 seconds
setInterval(pollCriticScores, 5000);

document.addEventListener("DOMContentLoaded", startNewChat);
updateChatIdDisplay();



function updateCriticScore(messageElement, data) {
    if (!messageElement) return;
    
    try {
        let criticScore = null;
        
        // If we have regenerated content and critic, use that score
        if (data.regenerated_critic) {
            criticScore = extractCriticScore(data.regenerated_critic);
        } 
        // Otherwise use the original critic score
        else if (data.critic_result) {
            criticScore = extractCriticScore(data.critic_result);
        }
        
        // Update the score display if we have a valid score
        if (criticScore !== null) {
            let criticCircle = messageElement.querySelector('.critic-score');
            if (!criticCircle) {
                criticCircle = document.createElement('div');
                criticCircle.className = 'critic-score absolute top-0 right-0 mt-1 mr-1 text-xs text-white rounded-full w-5 h-5 flex items-center justify-center';
                messageElement.appendChild(criticCircle);
            }
            
            // Set score and color based on value
            criticCircle.textContent = criticScore;
            
            // Use color coding based on score value
            if (data.regenerated_critic) {
                criticCircle.classList.add('bg-blue-500'); // Blue for regenerated
            } else if (criticScore >= 8) {
                criticCircle.classList.add('bg-green-500'); // Green for good
            } else if (criticScore >= 5) {
                criticCircle.classList.add('bg-yellow-500'); // Yellow for average
            } else {
                criticCircle.classList.add('bg-red-500'); // Red for poor
            }
        }
    } catch (e) {
        console.error('Error updating critic score:', e);
    }
}

// Extract the critic score from critic data
function extractCriticScore(criticData) {
    if (!criticData) return null;
    
    try {
        // Parse if it's a string
        const criticJson = typeof criticData === 'string' 
            ? JSON.parse(criticData) 
            : criticData;
            
        // Return total_score if it exists
        if (criticJson.total_score !== undefined) {
            return typeof criticJson.total_score === 'number' 
                ? criticJson.total_score 
                : parseFloat(criticJson.total_score);
        }
        
        return null;
    } catch (e) {
        console.error('Error extracting critic score:', e);
        return null;
    }
}

function createRegenerationUI(messageElement, data, originalContent) {
    if (!messageElement || !data.regenerated_response) return;
    
    // Get the message text element
    const textSpan = messageElement.querySelector('.message-text');
    if (!textSpan) return;
    
    // Remove any existing regeneration UI
    const existingRegenUI = messageElement.querySelector('.regeneration-ui');
    if (existingRegenUI) {
        existingRegenUI.remove();
    }
    
    // Create the regeneration UI container
    const regenUI = document.createElement('div');
    regenUI.className = 'regeneration-ui mt-3 border-t pt-2 w-full';
    
    // Add a toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 font-semibold py-1 px-2 rounded flex items-center';
    toggleBtn.innerHTML = '<span class="mr-1">✨</span> View Improved Response';
    
    // Create content container (hidden initially)
    const contentDiv = document.createElement('div');
    contentDiv.className = 'mt-2 p-2 bg-blue-50 border border-blue-200 rounded hidden';
    
    // Create comparison table
    const comparisonTable = document.createElement('table');
    comparisonTable.className = 'w-full text-xs';
    comparisonTable.innerHTML = `
        <tr>
            <th class="p-1 bg-gray-100 text-left">Original Response</th>
            <th class="p-1 bg-blue-100 text-left">Improved Response</th>
        </tr>
        <tr>
            <td class="p-2 border-r border-gray-200 align-top">${originalContent}</td>
            <td class="p-2 align-top">${data.regenerated_response}</td>
        </tr>
    `;
    
    contentDiv.appendChild(comparisonTable);
    
    // Add critic score comparison if available
    if (data.critic_result && data.regenerated_critic) {
        try {
            const originalCritic = typeof data.critic_result === 'string' 
                ? JSON.parse(data.critic_result) 
                : data.critic_result;
                
            const regeneratedCritic = typeof data.regenerated_critic === 'string' 
                ? JSON.parse(data.regenerated_critic) 
                : data.regenerated_critic;
            
            const originalScore = originalCritic.total_score;
            const regeneratedScore = regeneratedCritic.total_score;
            
            if (originalScore !== undefined && regeneratedScore !== undefined) {
                const scoreComparison = document.createElement('div');
                scoreComparison.className = 'mt-2 p-2 bg-gray-50 rounded text-center';
                scoreComparison.innerHTML = `
                    <span class="font-bold">Score Improvement: </span>
                    <span class="text-red-500">${originalScore}</span> → 
                    <span class="text-blue-500">${regeneratedScore}</span>
                    (${(regeneratedScore - originalScore).toFixed(1)} point change)
                `;
                contentDiv.appendChild(scoreComparison);
            }
        } catch (e) {
            console.error('Error parsing critic data for comparison:', e);
        }
    }
    
    // Add buttons to select which response to display
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'flex justify-end gap-2 mt-2';
    
    const useOriginalBtn = document.createElement('button');
    useOriginalBtn.className = 'text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-2 rounded';
    useOriginalBtn.textContent = 'Use Original';
    useOriginalBtn.onclick = () => {
        textSpan.textContent = originalContent;
        toggleBtn.innerHTML = '<span class="mr-1">✨</span> View Improved Response';
    };
    
    const useImprovedBtn = document.createElement('button');
    useImprovedBtn.className = 'text-xs bg-blue-500 hover:bg-blue-600 text-white py-1 px-2 rounded';
    useImprovedBtn.textContent = 'Use Improved';
    useImprovedBtn.onclick = () => {
        textSpan.textContent = data.regenerated_response;
        toggleBtn.innerHTML = '<span class="mr-1">⟲</span> View Original Response';
    };
    
    buttonsDiv.appendChild(useOriginalBtn);
    buttonsDiv.appendChild(useImprovedBtn);
    contentDiv.appendChild(buttonsDiv);
    
    // Add toggle functionality
    toggleBtn.onclick = () => {
        const isHidden = contentDiv.classList.contains('hidden');
        contentDiv.classList.toggle('hidden');
        
        if (isHidden) {
            toggleBtn.innerHTML = '<span class="mr-1">⟲</span> Hide Comparison';
        } else {
            if (textSpan.textContent === originalContent) {
                toggleBtn.innerHTML = '<span class="mr-1">✨</span> View Improved Response';
            } else {
                toggleBtn.innerHTML = '<span class="mr-1">⟲</span> View Original Response';
            }
        }
    };
    
    // Add elements to UI
    regenUI.appendChild(toggleBtn);
    regenUI.appendChild(contentDiv);
    
    // Add to message element after the text
    messageElement.insertBefore(regenUI, textSpan.nextSibling);
    
    // Set the displayed text to the regenerated response by default
    textSpan.textContent = data.regenerated_response;
    
    // NOW ADD ALL THE EXPANDABLE SECTIONS BASED ON THE DATA
    updateAllExpandableSections(messageElement, data);
}

// Function to update all expandable sections
function updateAllExpandableSections(messageElement, data) {
    if (!messageElement || !data) return;
    
    // Create/update all the expandable sections
    if (data.ner_result) {
        addOrUpdateSection(messageElement, 'ner-result', 'Extracted Preferences', formatJsonAsHtml(data.ner_result));
    }
    
    if (data.search_call_result) {
        addOrUpdateSection(messageElement, 'search-call', 'Search Query', data.search_call_result);
    }
    
    if (data.search_result) {
        const searchResultContent = data.search_result.results || "No results available";
        addOrUpdateSection(messageElement, 'search-result', 'Search Results', searchResultContent);
    }
    
    if (data.thinking) {
        addOrUpdateSection(messageElement, 'thinking', 'Assistant Reasoning', data.thinking);
    }
    
    // Only add critic sections if we don't have regeneration
    // (for regeneration, we use the comparison UI instead)
    if (!data.regenerated_response) {
        if (data.critic_result) {
            let criticContent = formatCriticResultSafely(data.critic_result);
            addOrUpdateSection(messageElement, 'critic-result', 'Response Evaluation', criticContent);
        }
    } else {
        // If we have regeneration, ensure we have sections for both original and regenerated critics
        if (data.critic_result) {
            let criticContent = formatCriticResultSafely(data.critic_result);
            addOrUpdateSection(messageElement, 'critic-result', 'Original Evaluation', criticContent);
        }
        
        if (data.regenerated_critic) {
            let regeneratedCriticContent = formatCriticResultSafely(data.regenerated_critic);
            addOrUpdateSection(messageElement, 'regenerated-critic', 'Improved Evaluation', regeneratedCriticContent);
        }
    }
}


// Add necessary CSS for processing overlay
function addProcessingOverlayStyles() {
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        .processing-overlay {
            font-size: 0.75rem;
            opacity: 0.9;
            backdrop-filter: blur(2px);
            border-radius: 0.375rem 0.375rem 0 0;
        }
        
        .regeneration-ui table {
            border-collapse: collapse;
        }
        
        .regeneration-ui td {
            max-height: 200px;
            overflow-y: auto;
            white-space: pre-wrap;
        }
    `;
    document.head.appendChild(styleEl);
}

// Add the styles when the document loads
document.addEventListener('DOMContentLoaded', addProcessingOverlayStyles);