import os
import time
import re
import json
import threading
from datetime import datetime
from typing import Dict, List, Any, Optional

from openai import OpenAI
from together import Together
from anthropic import Anthropic
import groq

# Ensure logs directory exists
os.makedirs("logs", exist_ok=True)

# Global state tracking
PROCESSING_STATES = {}
LLM_CLIENTS = {}
API_KEYS = {}

def log_error(error_message, chat_id=None):
    """Log errors to error log file."""
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    with open("logs/error_logs.txt", "a", encoding="utf-8") as f:
        log_entry = f"[{timestamp}] ERROR"
        if chat_id:
            log_entry += f" (chat_id={chat_id})"
        log_entry += f": {error_message}\n\n"
        f.write(log_entry)

def log_debug(debug_message, chat_id=None):
    """Log debug information to debug log file."""
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    with open("logs/debug_logs.txt", "a", encoding="utf-8") as f:
        log_entry = f"[{timestamp}] DEBUG"
        if chat_id:
            log_entry += f" (chat_id={chat_id})"
        log_entry += f": {debug_message}\n\n"
        f.write(log_entry)

def log_processed_prompt(prompt_name, processed_prompt, chat_id=None):
    """Log the processed prompt after placeholder replacement."""
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    truncated_prompt = processed_prompt[:300] + "..." if len(processed_prompt) > 300 else processed_prompt
    
    with open("logs/processed_prompts.txt", "a", encoding="utf-8") as f:
        log_entry = f"[{timestamp}]"
        if chat_id:
            log_entry += f" (chat_id={chat_id})"
        log_entry += f" PROCESSED {prompt_name}:\n{truncated_prompt}\n\n"
        f.write(log_entry)

def read_prompt_template(file_path):
    """Read a prompt template from file."""
    try:
        path = os.path.join("prompts", file_path)
        with open(path, 'r', encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        error_msg = f"Error reading prompt template {file_path}: {str(e)}"
        log_error(error_msg)
        return None

def extract_thinking(response):
    """
    Extract <think>...</think> tags from response.
    Returns (thinking_text, response_after_thinking)
    """
    if not response or not isinstance(response, str):
        return "", response
        
    think_pattern = r'<think>(.*?)</think>\s*'
    think_match = re.search(think_pattern, response, re.DOTALL)
    
    if think_match:
        thinking = think_match.group(1)
        response_after_thinking = re.sub(think_pattern, '', response, count=1, flags=re.DOTALL).strip()
        return thinking, response_after_thinking
    else:
        return "", response

def extract_function_calls(response):
    """
    Extract <function> search_func(...) </function> calls.
    Returns (cleaned_response, [function_calls])
    """
    if not response or not isinstance(response, str):
        log_error(f"Invalid response passed to extract_function_calls: {type(response)}")
        return "", []
        
    patterns = [
        r'<function>\s*search_func\((.*?)\)\s*</function>',
        r'<function>search_func\((.*?)\)</function>',
        r'<function>\s*search_func\s*\((.*?)\)\s*</function>'
    ]
    
    function_calls = []
    clean_response = response
    
    for pattern in patterns:
        calls = re.findall(pattern, response, flags=re.DOTALL)
        if calls:
            function_calls = calls
            clean_response = re.sub(pattern, '', response, flags=re.DOTALL)
            log_debug(f"Extract function calls - Found pattern match: {pattern}")
            break
    
    clean_response = clean_response.strip()
    return clean_response, function_calls

def get_client(provider_type):
    """Get or initialize the appropriate LLM client"""
    if provider_type in LLM_CLIENTS:
        return LLM_CLIENTS[provider_type]
    
    # Initialize the client if not already done
    try:
        if provider_type == 'openai':
            if 'openai' not in API_KEYS:
                with open("openai.key", "r", encoding="utf-8") as f:
                    API_KEYS['openai'] = f.read().strip()
            LLM_CLIENTS['openai'] = OpenAI(api_key=API_KEYS['openai'])
            
        elif provider_type == 'together':
            if 'together' not in API_KEYS:
                with open("together.key", "r", encoding="utf-8") as f:
                    API_KEYS['together'] = f.read().strip()
            LLM_CLIENTS['together'] = Together(api_key=API_KEYS['together'])
            
        elif provider_type == 'claude':
            if 'claude' not in API_KEYS:
                with open("claude.key", "r", encoding="utf-8") as f:
                    API_KEYS['claude'] = f.read().strip()
            LLM_CLIENTS['claude'] = Anthropic(api_key=API_KEYS['claude'])
            
        elif provider_type == 'groq':
            if 'groq' not in API_KEYS:
                with open("groq.key", "r", encoding="utf-8") as f:
                    API_KEYS['groq'] = f.read().strip()
            LLM_CLIENTS['groq'] = groq.Client(api_key=API_KEYS['groq'])
        
        return LLM_CLIENTS[provider_type]
    except Exception as e:
        log_error(f"Error initializing {provider_type} client: {str(e)}")
        return None

def get_openai_completion(prompt, model="o3-mini", chat_id=None):
    """Use OpenAI for responses."""
    try:
        log_processed_prompt(f"OpenAI_{model}", prompt, chat_id)
        
        client = get_client('openai')
        if not client:
            return None

        completion = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}]
        )
        return completion.choices[0].message.content if completion.choices else None

    except Exception as e:
        error_msg = f"Error in get_openai_completion for model {model}: {str(e)}"
        log_error(error_msg, chat_id)
        return None

def get_together_completion(prompt, include_thinking=False, chat_id=None):
    """Use Together AI DeepSeek-R1 for responses."""
    try:
        log_processed_prompt("Together_DeepSeek-R1", prompt, chat_id)
        
        client = get_client('together')
        if not client:
            return None
            
        completion = client.chat.completions.create(
            model="deepseek-ai/DeepSeek-R1",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            stream=False
        )
        final_text = completion.choices[0].message.content if completion.choices else ""
        
        if include_thinking:
            return final_text if final_text.strip() else None
        else:
            cleaned_text = re.sub(r'<think>.*?</think>\s*', '', final_text, flags=re.DOTALL)
            return cleaned_text if cleaned_text.strip() else None

    except Exception as e:
        error_msg = f"Error in get_together_completion: {str(e)}"
        log_error(error_msg, chat_id)
        return None

# Initialize and track processing state for a chat session
def init_processing_state(chat_id):
    """Initialize the processing state for a new chat."""
    PROCESSING_STATES[chat_id] = {
        "status": "initializing",
        "step": "starting",
        "progress": 0,
        "ner_result": None,
        "search_call_result": None,
        "search_result": None,
        "assistant_response": None,
        "critic_result": None,
        "regenerated_response": None,
        "regenerated_critic": None,
        "final_response": None,
        "completed": False,
        "error": None
    }
    return PROCESSING_STATES[chat_id]

def get_processing_state(chat_id):
    """Retrieve the current processing state for a chat."""
    if chat_id not in PROCESSING_STATES:
        return None
    return PROCESSING_STATES[chat_id]

def update_processing_state(chat_id, **kwargs):
    """Update the processing state with new values."""
    if chat_id not in PROCESSING_STATES:
        init_processing_state(chat_id)
    
    for key, value in kwargs.items():
        PROCESSING_STATES[chat_id][key] = value
    
    return PROCESSING_STATES[chat_id]

def extract_ner_from_conversation(conversation_history, chat_id=None):
    """
    Extract named entities (hotel preferences) from the conversation using NER prompt.
    Returns a dictionary of extracted preferences.
    """
    update_processing_state(chat_id, status="processing", step="extracting_ner", progress=10)
    
    try:
        # Create a simplified conversation for the prompt
        simple_conversation = [
            {"role": msg["role"], "content": msg["content"]} 
            for msg in conversation_history
        ]
        
        ner_template = read_prompt_template("ner.md")
        if not ner_template:
            log_error("Failed to read ner.md template", chat_id)
            update_processing_state(chat_id, error="Failed to read NER template")
            return {}
            
        ner_prompt = ner_template.replace("{conv}", json.dumps(simple_conversation, ensure_ascii=False, indent=2))
        ner_response = get_openai_completion(ner_prompt, model="o3-mini", chat_id=chat_id)
        
        if not ner_response:
            log_error("No NER response generated", chat_id)
            update_processing_state(chat_id, error="No NER response generated")
            return {}
            
        dict_pattern = r'```python\s*({[\s\S]*?})\s*```'
        dict_match = re.search(dict_pattern, ner_response)
        
        update_processing_state(chat_id, step="ner_completed", progress=20)
        
        if dict_match:
            try:
                preferences_dict = eval(dict_match.group(1))
                log_debug(f"Extracted preferences: {json.dumps(preferences_dict, ensure_ascii=False)}", chat_id)
                update_processing_state(chat_id, ner_result=preferences_dict)
                return preferences_dict
            except Exception as e:
                log_error(f"Error parsing extracted preferences: {str(e)}", chat_id)
                update_processing_state(chat_id, error=f"Error parsing preferences: {str(e)}")
                return {}
        else:
            # Try direct extraction if no code block
            dict_pattern = r'({[\s\S]*?})'
            dict_match = re.search(dict_pattern, ner_response)
            if dict_match:
                try:
                    preferences_dict = eval(dict_match.group(1))
                    log_debug(f"Extracted preferences (direct): {json.dumps(preferences_dict, ensure_ascii=False)}", chat_id)
                    update_processing_state(chat_id, ner_result=preferences_dict)
                    return preferences_dict
                except Exception as e:
                    log_error(f"Error with direct parsing: {str(e)}", chat_id)
                    update_processing_state(chat_id, error=f"Error with direct parsing: {str(e)}")
                    return {}
            else:
                log_error("No valid preferences dictionary found in NER response", chat_id)
                update_processing_state(chat_id, error="No valid preferences dictionary found")
                return {}
    except Exception as e:
        error_msg = f"Error in NER extraction: {str(e)}"
        log_error(error_msg, chat_id)
        update_processing_state(chat_id, error=error_msg)
        return {}

def process_search_call(extracted_preferences, chat_id=None):
    """
    Determine if a search should be triggered based on extracted preferences.
    Returns a string with the <function> search_func(...) call or "" if no search.
    """
    update_processing_state(chat_id, status="processing", step="processing_search_call", progress=30)
    
    try:
        search_call_template = read_prompt_template("search_call.md")
        if not search_call_template:
            log_error("Failed to read search_call.md template", chat_id)
            update_processing_state(chat_id, error="Failed to read search call template")
            return ""
        
        search_call_prompt = search_call_template.replace(
            "{preferences}",
            json.dumps(extracted_preferences, ensure_ascii=False, indent=2)
        )
        
        search_call_response = get_openai_completion(search_call_prompt, model="o3-mini", chat_id=chat_id)
        if not search_call_response:
            log_error("No search call response generated", chat_id)
            update_processing_state(chat_id, error="No search call response generated")
            return ""
        
        search_call_response = search_call_response.strip()
        update_processing_state(
            chat_id, 
            step="search_call_completed", 
            progress=40,
            search_call_result=search_call_response
        )
        
        if "<function>" in search_call_response:
            return search_call_response
        return ""
    except Exception as e:
        error_msg = f"Error in search call processing: {str(e)}"
        log_error(error_msg, chat_id)
        update_processing_state(chat_id, error=error_msg)
        return ""

def process_search_simulation(search_call, chat_id=None):
    """
    Process the function calls in response_after_thinking, simulate search, 
    and return the search record (or None).
    """
    update_processing_state(chat_id, status="processing", step="simulating_search", progress=50)
    
    if not search_call or not search_call.strip():
        log_error("Empty response passed to search processing", chat_id)
        update_processing_state(chat_id, error="Empty search call")
        return None
    
    log_debug(f"Processing search in response of length: {len(search_call)}", chat_id)
    
    try:
        clean_response, function_calls = extract_function_calls(search_call)
        if not function_calls:
            log_debug("No function calls detected - returning None", chat_id)
            update_processing_state(chat_id, step="search_not_needed", progress=60)
            return None
        
        log_debug(f"Found {len(function_calls)} function calls to process", chat_id)
        function_call_content = function_calls[0]
        
        search_template = read_prompt_template("search_simulator.md")
        if not search_template:
            log_error("Failed to read search_simulator.md template", chat_id)
            update_processing_state(chat_id, error="Failed to read search simulator template")
            return None
        
        search_prompt = search_template.replace("{search_query}", function_call_content.strip())
        search_response = get_openai_completion(search_prompt, chat_id=chat_id)
        
        if not search_response:
            log_error("No search result received for query", chat_id)
            update_processing_state(chat_id, error="No search result received")
            return None
        
        log_debug(f"Search result received of length: {len(search_response)}", chat_id)
        
        # Extract number of matches
        num_matches = None
        patterns = [
            r'"Number of matches":\s*(\d+)',
            r'Number of matches:\s*(\d+)',
            r'Found (\d+) matches',
            r'(\d+) results found',
            r'(\d+) hotels match'
        ]
        for pattern in patterns:
            m = re.search(pattern, search_response, re.IGNORECASE)
            if m:
                try:
                    num_matches = int(m.group(1))
                    log_debug(f"Found {num_matches} matches in search results", chat_id)
                    break
                except:
                    continue
        
        # If no match found, try to estimate
        if num_matches is None:
            if re.search(r'no matches|no results|0 matches|0 results', search_response, re.IGNORECASE):
                num_matches = 0
            else:
                hotel_name_count = len(re.findall(r'Hotel name:', search_response, re.IGNORECASE))
                if hotel_name_count > 0:
                    num_matches = hotel_name_count
                else:
                    num_matches = 10  # Default
        
        # Set threshold for showing results to the agent
        threshold = 50
        
        # Build search record
        search_record = {
            "timestamp": datetime.now().strftime("%Y-%m-%d_%H-%M-%S"),
            "parameters": function_call_content,
            "results": search_response,
            "num_matches": num_matches,
            "show_results_to_actor": num_matches <= threshold
        }
        
        update_processing_state(
            chat_id, 
            step="search_completed", 
            progress=60,
            search_result=search_record
        )
        
        return search_record
        
    except Exception as e:
        error_msg = f"Unexpected error in search processing: {str(e)}"
        log_error(error_msg, chat_id)
        update_processing_state(chat_id, error=error_msg)
        return None
    
def generate_assistant_response(conversation_history, search_record=None, chat_id=None):
    """Generate the assistant response based on conversation and search."""
    update_processing_state(chat_id, status="processing", step="generating_assistant_response", progress=70)
    
    try:
        # Create a simpler conversation (role + content only) for the prompt
        simple_conversation = [
            {"role": msg["role"], "content": msg["content"]}
            for msg in conversation_history
        ]
        
        # Build the agent prompt
        agent_template = read_prompt_template("actor.md")
        if not agent_template:
            log_error("Failed to read actor.md template", chat_id)
            update_processing_state(chat_id, error="Failed to read actor template")
            return None
        
        # Get search results text and match count if available
        search_text = ""
        num_matches = ""
        
        if search_record:
            # Only provide search results and count if show_results_to_actor is True
            if search_record.get("show_results_to_actor", False):
                search_text = search_record.get("results", "")
                
                # Only provide the count when showing results
                if "num_matches" in search_record:
                    num_matches = str(search_record["num_matches"])
            # If not showing results, don't provide the count either
        
        # Build the final prompt
        agent_prompt = (
            agent_template
            .replace("{conv}", json.dumps(simple_conversation, ensure_ascii=False, indent=2))
            .replace("{search}", search_text)
            .replace("{num_matches}", num_matches)
        )
        
        # Generate assistant response
        assistant_response = get_together_completion(agent_prompt, include_thinking=True, chat_id=chat_id)
        
        if not assistant_response:
            log_error("No assistant response generated", chat_id)
            update_processing_state(chat_id, error="No assistant response generated")
            return None
        
        # Extract thinking and clean final response
        thinking, response_after_thinking = extract_thinking(assistant_response)
        final_response, _ = extract_function_calls(response_after_thinking)
        if not final_response.strip():
            final_response = response_after_thinking
            
        update_processing_state(
            chat_id,
            step="assistant_response_generated",
            progress=80,
            assistant_response={
                "thinking": thinking,
                "response_after_thinking": response_after_thinking,
                "final_response": final_response
            }
        )
        
        return {
            "thinking": thinking,
            "response_after_thinking": response_after_thinking,
            "final_response": final_response
        }
        
    except Exception as e:
        error_msg = f"Error generating assistant response: {str(e)}"
        log_error(error_msg, chat_id)
        update_processing_state(chat_id, error=error_msg)
        return None
    
def get_critic_evaluation(conversation_history, assistant_response, search_record=None, chat_id=None):
    """
    Get a critique of the assistant's response using critic.md.
    Returns a JSON object with score and reason.
    """
    update_processing_state(chat_id, status="processing", step="evaluating_response", progress=85)
    
    try:
        # Create a simplified conversation for the prompt
        simple_conversation = [
            {"role": msg["role"], "content": msg["content"]} 
            for msg in conversation_history
        ]
        
        critic_template = read_prompt_template("critic.md")
        if not critic_template:
            log_error("Failed to read critic.md template", chat_id)
            update_processing_state(chat_id, error="Failed to read critic template")
            return None
        
        # Get original prompt template
        original_prompt = read_prompt_template("actor.md")
        if original_prompt:
            # Remove placeholders
            original_prompt = original_prompt.replace("{conv}", "").replace("{search}", "").replace("{num_matches}", "").strip()
        else:
            original_prompt = "Default Actor Prompt"
        
        # Create critic prompt
        critic_prompt = critic_template.replace("{original_prompt}", original_prompt)
        critic_prompt = critic_prompt.replace("{conversation}", json.dumps(simple_conversation, ensure_ascii=False, indent=2))
        critic_prompt = critic_prompt.replace("{last_response}", assistant_response)
        
        # Add search results if available and shown to assistant
        if search_record and search_record.get("show_results_to_actor", False):
            critic_prompt = critic_prompt.replace("{search_history}", search_record.get("results", ""))
        else:
            critic_prompt = critic_prompt.replace("<last_search_output>\n{search_history}\n</last_search_output>", "")
        
        # Get critic response
        critic_response = get_together_completion(critic_prompt, chat_id=chat_id)
        if not critic_response:
            log_error("No critic response generated", chat_id)
            update_processing_state(chat_id, error="No critic response generated")
            return None
        
        # Try to find JSON in the critique response
        json_pattern = r'(\{[\s\S]*\})'
        json_match = re.search(json_pattern, critic_response)
        if json_match:
            try:
                critique_json = json.loads(json_match.group(1))
                log_debug(f"Parsed critique: {json.dumps(critique_json, ensure_ascii=False)}", chat_id)
                
                update_processing_state(
                    chat_id,
                    step="critique_completed",
                    progress=90,
                    critic_result=critique_json
                )
                
                return critique_json
            except Exception as e:
                log_error(f"Error parsing critique JSON: {str(e)}", chat_id)
                update_processing_state(chat_id, error=f"Error parsing critique JSON: {str(e)}")
                return None
        else:
            log_error("No valid JSON found in critic response", chat_id)
            update_processing_state(chat_id, error="No valid JSON found in critic response")
            return None

    except Exception as e:
        error_msg = f"Error in critique evaluation: {str(e)}"
        log_error(error_msg, chat_id)
        update_processing_state(chat_id, error=error_msg)
        return None

def regenerate_low_score_response(conversation_history, assistant_response, critique, search_record=None, chat_id=None):
    """
    Regenerate a response if the score is low.
    """
    update_processing_state(chat_id, status="processing", step="regenerating_response", progress=92)
    
    if not critique or "total_score" not in critique:
        log_debug("No critique score found, skipping regeneration", chat_id)
        update_processing_state(chat_id, step="regeneration_skipped", progress=95)
        return None
    
    total_score = critique["total_score"]
    score_threshold = 8.5
    
    if total_score > score_threshold:
        log_debug(f"Score {total_score} is above threshold {score_threshold}, skipping regeneration", chat_id)
        update_processing_state(chat_id, step="regeneration_skipped", progress=95)
        return None
    
    try:
        # Build conversation context
        conversation_context = []
        for msg in conversation_history:
            role = msg["role"]
            content = msg["content"]
            conversation_context.append(f"{role}: {content}")
        conversation_context_str = "\n\n".join(conversation_context)
        
        # Summarize the critic's reasons
        critic_analysis = []
        for key, val in critique.items():
            if key in ("score", "total_score"):
                continue
            if isinstance(val, dict):
                section_lines = [f"## {key}"]
                if "strengths" in val:
                    section_lines.append(f"**Strengths**: {val['strengths']}")
                if "improvement_areas" in val:
                    section_lines.append(f"**Improvement Areas**: {val['improvement_areas']}")
                if len(section_lines) > 1:
                    critic_analysis.append("\n".join(section_lines))
            elif key == "summary":
                critic_analysis.append(f"## Summary\n{val}")
        
        critic_reason_str = "\n\n".join(critic_analysis)
        
        # Get search history if it was shown to assistant
        search_history_str = ""
        if search_record and search_record.get("show_results_to_actor", False):
            search_history_str = search_record.get("results", "")
        
        # Read the response updater template
        regen_template = read_prompt_template("critic_regen.md")
        if not regen_template:
            log_error("Could not read critic_regen.md template", chat_id)
            update_processing_state(chat_id, error="Could not read regeneration template")
            return None
        
        # Build the regeneration prompt
        regen_prompt = (
            regen_template
            .replace("{conversation_context}", conversation_context_str)
            .replace("{last_response}", assistant_response)
            .replace("{critic_reason}", critic_reason_str)
            .replace("{search_history}", search_history_str)
        )
        
        # Generate improved response
        regenerated_response = get_together_completion(regen_prompt, chat_id=chat_id)
        if not regenerated_response:
            log_error("Regeneration call returned None or empty", chat_id)
            update_processing_state(chat_id, error="Regeneration call returned empty")
            return None
        
        # Re-evaluate the regenerated response
        regenerated_critique = get_critic_evaluation(
            conversation_history,
            regenerated_response,
            search_record,
            chat_id
        )
        
        update_processing_state(
            chat_id,
            step="regeneration_completed",
            progress=95,
            regenerated_response=regenerated_response,
            regenerated_critic=regenerated_critique
        )
        
        return {
            "regenerated_response": regenerated_response,
            "regenerated_critique": regenerated_critique
        }
        
    except Exception as e:
        error_msg = f"Error in regeneration: {str(e)}"
        log_error(error_msg, chat_id)
        update_processing_state(chat_id, error=error_msg)
        return None

def process_chat_async(chat_id, conversation_history, enable_search=True, evaluate_response=True, regenerate_response=True):
    """
    Process a chat asynchronously, updating the state as it progresses.
    This function will be run in a separate thread.
    """
    # Import Flask's current_app to get the application context
    from flask import current_app
    app = current_app._get_current_object()
    
    try:
        init_processing_state(chat_id)
        log_debug(f"Starting async processing for chat {chat_id}", chat_id)
        
        # STEP 1: NER Extraction
        extracted_preferences = {}
        if enable_search:
            extracted_preferences = extract_ner_from_conversation(conversation_history, chat_id)
        
        # STEP 2: Search Determination
        search_record = None
        if enable_search and extracted_preferences:
            search_call = process_search_call(extracted_preferences, chat_id)
            if search_call:
                search_record = process_search_simulation(search_call, chat_id)
        
        # STEP 3: Generate Assistant Response
        assistant_result = generate_assistant_response(conversation_history, search_record, chat_id)
        if not assistant_result:
            update_processing_state(
                chat_id,
                status="error",
                error="Failed to generate assistant response",
                completed=True
            )
            return
        
        final_response = assistant_result["final_response"]
        
        # STEP 4: Evaluate Response
        critique = None
        if evaluate_response:
            critique = get_critic_evaluation(
                conversation_history, 
                final_response, 
                search_record, 
                chat_id
            )
        
        # STEP 5: Regenerate Low-Score Response
        regeneration_result = None
        if regenerate_response and critique and critique.get("total_score", 10) <= 8.5:
            regeneration_result = regenerate_low_score_response(
                conversation_history,
                final_response,
                critique,
                search_record,
                chat_id
            )
            
            # Use regenerated response if it has a better score
            if regeneration_result and regeneration_result.get("regenerated_critique"):
                regen_critique = regeneration_result["regenerated_critique"]
                regen_score = regen_critique.get("total_score")
                original_score = critique.get("total_score")
                
                if regen_score and original_score and regen_score > original_score:
                    log_debug(f"Using regenerated response with improved score: {original_score} -> {regen_score}", chat_id)
                    final_response = regeneration_result["regenerated_response"]
        
        # STEP 6: Update final state
        update_processing_state(
            chat_id,
            status="completed",
            step="all_completed",
            progress=100,
            final_response=final_response,
            completed=True
        )
        
        log_debug(f"Completed async processing for chat {chat_id}", chat_id)
        
    except Exception as e:
        error_msg = f"Error in process_chat_async: {str(e)}"
        log_error(error_msg, chat_id)
        update_processing_state(
            chat_id,
            status="error",
            error=error_msg,
            completed=True
        )

def start_processing_thread(chat_id, conversation_history, enable_search=True, evaluate_response=True, regenerate_response=True):
    """
    Start a new thread to process the chat asynchronously.
    Returns the initial processing state.
    """
    # Initialize the processing state
    state = init_processing_state(chat_id)
    
    # Import the Flask app
    from flask import current_app
    app = current_app._get_current_object()
    
    # Define a wrapper function that manages the application context
    def process_with_app_context():
        with app.app_context():
            process_chat_async(chat_id, conversation_history, enable_search, evaluate_response, regenerate_response)
    
    # Start processing in a separate thread with app context
    thread = threading.Thread(
        target=process_with_app_context
    )
    thread.daemon = True
    thread.start()
    
    return state