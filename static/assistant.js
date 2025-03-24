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
    // Process each type of extra data
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
    
    if (extraData.critic_result) {
        let criticContent = "";
        try {
            const criticData = typeof extraData.critic_result === 'string' 
                ? JSON.parse(extraData.critic_result) 
                : extraData.critic_result;
                
            // Format the critic result nicely
            criticContent = formatCriticResult(criticData);
        } catch (e) {
            criticContent = "Failed to parse critic data: " + e.message;
        }
        addOrUpdateSection(messageElement, 'critic-result', 'Response Evaluation', criticContent);
    }
    
    if (extraData.regenerated_content) {
        addOrUpdateSection(messageElement, 'regenerated-content', 'Improved Response', extraData.regenerated_content);
    }
    
    if (extraData.regenerated_critic) {
        let regeneratedCriticContent = "";
        try {
            const regeneratedCriticData = typeof extraData.regenerated_critic === 'string' 
                ? JSON.parse(extraData.regenerated_critic) 
                : extraData.regenerated_critic;
                
            // Format the regenerated critic nicely
            regeneratedCriticContent = formatCriticResult(regeneratedCriticData);
        } catch (e) {
            regeneratedCriticContent = "Failed to parse regenerated critic data: " + e.message;
        }
        addOrUpdateSection(messageElement, 'regenerated-critic', 'Improved Response Evaluation', regeneratedCriticContent);
    }
}

/**
 * Adds or updates a collapsible section in a message bubble.
 */
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

/**
 * Format JSON object as formatted HTML.
 */
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
function startProcessingPolling(messageId, outputNumber) {
    // Clear any existing interval
    if (processingInterval) {
        clearInterval(processingInterval);
    }
    
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
            
            // Update the message text with progress
            const textSpan = messageElement.querySelector('.message-text');
            if (textSpan && data.status === 'processing') {
                textSpan.textContent = `[${data.step}: ${data.progress}%]`;
            }
            
            // Add extra data sections as they become available
            updateExtraDataSection(messageElement, data);
            
            // If completed or error, stop polling and update the message
            if (data.completed || data.status === 'error') {
                clearInterval(processingInterval);
                processingInterval = null;
                
                // If there's a final response, update the message text
                if (data.final_response) {
                    if (textSpan) {
                        textSpan.textContent = data.final_response;
                    }
                    
                    // Add critic score if available
                    if (data.critic_result) {
                        let criticScore = null;
                        try {
                            const criticData = typeof data.critic_result === 'string' 
                                ? JSON.parse(data.critic_result) 
                                : data.critic_result;
                                
                            criticScore = criticData.total_score;
                            
                            if (criticScore !== undefined) {
                                let criticCircle = messageElement.querySelector('.critic-score');
                                if (!criticCircle) {
                                    criticCircle = document.createElement('div');
                                    criticCircle.className = 'critic-score absolute top-0 right-0 mt-1 mr-1 text-xs text-white bg-red-500 rounded-full w-5 h-5 flex items-center justify-center';
                                    messageElement.appendChild(criticCircle);
                                }
                                criticCircle.textContent = criticScore;
                            }
                        } catch (e) {
                            console.error('Error parsing critic score:', e);
                        }
                    }
                }
                
                // If there's an error, update the message text
                if (data.error) {
                    if (textSpan) {
                        textSpan.textContent = `[Error: ${data.error}]`;
                    }
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