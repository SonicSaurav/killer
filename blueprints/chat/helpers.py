import re
from openai import OpenAI
from models.models import AssistantMessage, Chat, Message, UserMessage, db
from together import Together
from datetime import datetime
import json
import threading
import time
from . import llm_processing

##############################################
# Helper Functions
##############################################

client = OpenAI()


def retrieve_or_create_chat(user, chat_id=None):
    """
    Retrieve an existing chat by ID or create a new one if no chat ID is provided.

    This function checks if a chat ID is provided. If it is, the function fetches the chat from the database,
    verifying that the specified chat exists and is owned by the given user. If the chat does not exist or does not belong
    to the user, an appropriate error message is returned. When no chat ID is provided, a new chat instance is created for the user,
    added to the database, and committed to generate its ID.

    Parameters:
        user: The user instance who owns the chat.
        chat_id (optional): The unique identifier of the chat to retrieve. Defaults to None.

    Returns:
        tuple:
            - The chat instance if successfully retrieved or created, otherwise None.
            - An error message if an error occurred (e.g. chat not found or unauthorized access), otherwise None.

    """
    if chat_id:
        chat = Chat.query.get(chat_id)
        if not chat:
            return None, "Chat not found"
        if chat.user_id != user.id:
            return None, "Unauthorized chat access"
        return chat, None
    else:
        chat = Chat(user_id=user.id)
        db.session.add(chat)
        db.session.commit()  # Commit to generate chat.id
        return chat, None


def create_user_message(chat, user_input):
    """
    Create a new Message and a corresponding UserMessage in the database.
    """
    # Create a new parent message record
    message = Message(chat_id=chat.id)
    db.session.add(message)
    db.session.commit()  # commits to generate the message.id

    # Create the user message
    user_msg = UserMessage(message_id=message.id, content=user_input)
    db.session.add(user_msg)
    db.session.commit()

    return message


def store_assistant_message(
    message_id, 
    content, 
    search_output=None, 
    output_number=1,
    thinking=None,
    critic_score=None,
    regenerated_content=None,
    regenerated_critic=None
):
    """
    Stores an assistant message in the database with enhanced information.
    
    Args:
        message_id (str): A unique identifier for the message.
        content (str): The textual content of the assistant's message.
        search_output (dict, optional): Search output data associated with the message.
        output_number (int, optional): The sequence number of the output. Defaults to 1.
        thinking (str, optional): The assistant's reasoning process.
        critic_score (dict, optional): The evaluation scores from the critic.
        regenerated_content (str, optional): Regenerated response if original had low score.
        regenerated_critic (dict, optional): Critic evaluation of the regenerated response.
    
    Returns:
        AssistantMessage: The assistant message object that was stored in the database.
    """
    # Store critic_score as JSON string if provided
    critic_score_json = None
    if critic_score:
        try:
            critic_score_json = json.dumps(critic_score)
        except:
            pass
            
    # Create the assistant message
    assistant_msg = AssistantMessage(
        message_id=message_id,
        content=content,
        search_output=json.dumps(search_output) if search_output else None,
        output_number=output_number,
        thinking=thinking,
        critic_score=critic_score_json,
        regenerated_content=regenerated_content,
        regenerated_critic=json.dumps(regenerated_critic) if regenerated_critic else None
    )
    
    db.session.add(assistant_msg)
    db.session.commit()
    return assistant_msg


def process_conversation_history(conversation_history):
    """
    Convert a conversation history from the database format to the format expected by the LLM processing module.
    """
    processed_history = []
    for msg in conversation_history:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role and content:
            processed_history.append({"role": role, "content": content})
    return processed_history


def generate_and_store_assistant_message(
    chat, message, base_prompt_path, search_prompt_path
):
    """
    Starts asynchronous generation of an assistant response.
    
    This function initiates the asynchronous processing of generating an assistant response
    based on the current conversation. It sets up the necessary parameters and starts a
    background thread to handle the actual processing.
    
    Parameters:
        chat: An object representing the active chat session.
        message: An object representing the current message context.
        base_prompt_path: No longer used directly; kept for compatibility.
        search_prompt_path: No longer used directly; kept for compatibility.
    
    Returns:
        None
    """
    # Get conversation history
    conversation_history = chat.get_conversation_history()
    processed_history = process_conversation_history(conversation_history)
    
    # Start asynchronous processing
    processing_state = llm_processing.start_processing_thread(
        chat_id=chat.id,
        conversation_history=processed_history,
        enable_search=True,
        evaluate_response=True,
        regenerate_response=True
    )
    
    # Create a placeholder assistant message that will be updated when processing completes
    store_assistant_message(
        message_id=message.id,
        content="[Processing your request...]",
        search_output=None,
        output_number=1
    )
    
    # Start a background thread to periodically check the processing state and update the message
    threading.Thread(
        target=monitor_processing_state,
        args=(chat.id, message.id, 1)
    ).start()


def maybe_generate_second_assistant_message(
    chat, message, base_prompt_path, search_prompt_path
):
    """
    Starts asynchronous generation of a second assistant response.
    
    Similar to generate_and_store_assistant_message but for the second assistant.
    Uses a different seed value to ensure variation.
    
    Parameters:
        chat: An object representing the chat.
        message: The message object associated with this interaction.
        base_prompt_path: No longer used directly; kept for compatibility.
        search_prompt_path: No longer used directly; kept for compatibility.
    """
    # Get conversation history
    conversation_history = chat.get_conversation_history()
    processed_history = process_conversation_history(conversation_history)
    
    # Start asynchronous processing with a different seed
    processing_state = llm_processing.start_processing_thread(
        chat_id=f"{chat.id}_second",  # Different chat_id for the second assistant
        conversation_history=processed_history,
        enable_search=True,
        evaluate_response=True,
        regenerate_response=True
    )
    
    # Create a placeholder assistant message that will be updated when processing completes
    store_assistant_message(
        message_id=message.id,
        content="[Processing your request for second assistant...]",
        search_output=None,
        output_number=2
    )
    
    # Start a background thread to periodically check the processing state and update the message
    threading.Thread(
        target=monitor_processing_state,
        args=(f"{chat.id}_second", message.id, 2)
    ).start()


def get_total_score_from_critic(critic_result):
    """
    Extract total_score from the critic result.
    The critic can return different JSON formats based on whether search results were present.
    """
    if not critic_result:
        return None
        
    try:
        # Try to parse if it's a string
        if isinstance(critic_result, str):
            critic_data = json.loads(critic_result)
        else:
            critic_data = critic_result
            
        # Extract total_score directly if present
        if "total_score" in critic_data:
            return critic_data["total_score"]
        
        # If no total_score, try to calculate from component scores
        total = 0
        if "adherence_to_search" in critic_data:
            total += critic_data["adherence_to_search"].get("score", 0)
        if "question_format" in critic_data:
            total += critic_data["question_format"].get("score", 0)
        if "conversational_quality" in critic_data:
            total += critic_data["conversational_quality"].get("score", 0)
        if "contextual_intelligence" in critic_data:
            total += critic_data["contextual_intelligence"].get("score", 0)
        if "overall_effectiveness" in critic_data:
            total += critic_data["overall_effectiveness"].get("score", 0)
            
        return total if total > 0 else None
        
    except Exception as e:
        print(f"[ERROR] Failed to extract total score: {e}")
        return None

def monitor_processing_state(chat_id, message_id, output_number, check_interval=1, max_retries=300):
    """
    Monitor the processing state and update the message when processing completes.
    
    Parameters:
        chat_id: The ID of the chat being processed.
        message_id: The ID of the message to update.
        output_number: The output number (1 for primary, 2 for secondary).
        check_interval: How often to check the processing state (in seconds).
        max_retries: Maximum number of retries before giving up.
    """
    retries = 0
    
    # Import Flask's app outside the loop to avoid repeated imports
    from flask import current_app
    app = current_app._get_current_object()
    
    def update_with_context():
        """Function to run within app context"""
        with app.app_context():
            # Get the current message
            assistant_msg = AssistantMessage.query.filter_by(
                message_id=message_id, 
                output_number=output_number
            ).first()
            
            if not assistant_msg:
                print(f"[ERROR] Assistant message not found: {message_id}, output_number: {output_number}")
                return
                
            # Update with message
            state = llm_processing.get_processing_state(chat_id)
            if not state:
                assistant_msg.content = "[Processing state not found]"
                db.session.commit()
                return
                
            if state["completed"] or state["status"] == "error":
                # Final update
                if state["status"] == "error" or state["error"]:
                    error_msg = state["error"] or "Unknown error"
                    assistant_msg.content = f"[Error: {error_msg}]"
                elif state["final_response"]:
                    assistant_msg.content = state["final_response"]
                    
                    # Update thinking
                    if state.get("assistant_response") and state["assistant_response"].get("thinking"):
                        assistant_msg.thinking = state["assistant_response"]["thinking"]
                        
                    # Update search output
                    if state.get("search_result"):
                        assistant_msg.search_output = json.dumps(state["search_result"])
                        
                    # Update critic score
                    if state.get("critic_result"):
                        assistant_msg.critic_score = json.dumps(state["critic_result"])
                        
                    # Update regenerated content if available
                    if state.get("regenerated_response"):
                        assistant_msg.regenerated_content = state["regenerated_response"]
                        
                    # Update regenerated critic if available
                    if state.get("regenerated_critic"):
                        assistant_msg.regenerated_critic = json.dumps(state["regenerated_critic"])
                else:
                    assistant_msg.content = "[No response generated]"
            else:
                # Progress update
                step = state.get("step", "processing")
                progress = state.get("progress", 0)
                
                progress_messages = {
                    "starting": "Initializing...",
                    "extracting_ner": "Analyzing conversation to understand preferences...",
                    "ner_completed": "Preferences extracted...",
                    "processing_search_call": "Determining if search is needed...",
                    "search_call_completed": "Search requirements determined...",
                    "simulating_search": "Searching for hotels matching your criteria...",
                    "search_completed": "Search complete...",
                    "search_not_needed": "No search needed at this time...",
                    "generating_assistant_response": "Generating response...",
                    "assistant_response_generated": "Response generated...",
                    "evaluating_response": "Evaluating response quality...",
                    "critique_completed": "Response evaluation complete...",
                    "regenerating_response": "Improving response based on feedback...",
                    "regeneration_completed": "Response improved...",
                    "regeneration_skipped": "Response meets quality standards..."
                }
                
                if step in progress_messages:
                    progress_text = progress_messages[step]
                else:
                    progress_text = f"Processing ({step})..."
                    
                assistant_msg.content = f"[{progress_text} {progress}%]"
                
            db.session.commit()
    
    # Capture initial state before starting the loop
    try:
        update_with_context()
    except Exception as e:
        print(f"[ERROR] Failed to update message initially: {e}")
    
    # Main monitoring loop
    while retries < max_retries:
        # Get the current processing state
        state = llm_processing.get_processing_state(chat_id)
        if not state:
            print(f"[ERROR] Processing state not found for chat {chat_id}")
            break
            
        # If processing completed or errored out, update the message and exit
        if state["completed"] or state["status"] == "error":
            try:
                update_with_context()
            except Exception as e:
                print(f"[ERROR] Failed to update message at completion: {e}")
            break
            
        # If still processing, update the message with progress information
        try:
            update_with_context()
        except Exception as e:
            print(f"[ERROR] Failed to update progress message: {e}")
            
        # Wait before next check
        time.sleep(check_interval)
        retries += 1
    
    # If we hit max retries, update the message with an error
    if retries >= max_retries:
        error_msg = f"Processing timed out after {max_retries * check_interval} seconds"
        try:
            # Update the message with the error
            with app.app_context():
                assistant_msg = AssistantMessage.query.filter_by(
                    message_id=message_id, 
                    output_number=output_number
                ).first()
                
                if assistant_msg:
                    assistant_msg.content = f"[Error: {error_msg}]"
                    db.session.commit()
        except Exception as e:
            print(f"[ERROR] Failed to update message on timeout: {e}")
            
def update_assistant_progress_message(state, message_id, output_number):
    """
    Update the assistant message with progress information.
    """
    try:
        # Get the current message
        assistant_msg = AssistantMessage.query.filter_by(
            message_id=message_id, 
            output_number=output_number
        ).first()
        
        if assistant_msg:
            # Build a progress message based on the current step
            step = state.get("step", "processing")
            progress = state.get("progress", 0)
            
            progress_messages = {
                "starting": "Initializing...",
                "extracting_ner": "Analyzing conversation to understand preferences...",
                "ner_completed": "Preferences extracted...",
                "processing_search_call": "Determining if search is needed...",
                "search_call_completed": "Search requirements determined...",
                "simulating_search": "Searching for hotels matching your criteria...",
                "search_completed": "Search complete...",
                "search_not_needed": "No search needed at this time...",
                "generating_assistant_response": "Generating response...",
                "assistant_response_generated": "Response generated...",
                "evaluating_response": "Evaluating response quality...",
                "critique_completed": "Response evaluation complete...",
                "regenerating_response": "Improving response based on feedback...",
                "regeneration_completed": "Response improved...",
                "regeneration_skipped": "Response meets quality standards..."
            }
            
            if step in progress_messages:
                progress_text = progress_messages[step]
            else:
                progress_text = f"Processing ({step})..."
                
            assistant_msg.content = f"[{progress_text} {progress}%]"
            db.session.commit()
            
    except Exception as e:
        print(f"[ERROR] Failed to update progress message: {e}")


def update_assistant_message_from_state(state, message_id, output_number):
    """
    Update the assistant message with the final results from processing.
    """
    try:
        # Get the current message
        assistant_msg = AssistantMessage.query.filter_by(
            message_id=message_id, 
            output_number=output_number
        ).first()
        
        if not assistant_msg:
            print(f"[ERROR] Assistant message not found: {message_id}, output_number: {output_number}")
            return
            
        # If there was an error, update with error message
        if state["status"] == "error" or state["error"]:
            error_msg = state["error"] or "Unknown error"
            assistant_msg.content = f"[Error: {error_msg}]"
            db.session.commit()
            return
            
        # Get final response
        final_response = state["final_response"]
        if not final_response:
            assistant_msg.content = "[Error: No response generated]"
            db.session.commit()
            return
            
        # Update message content
        assistant_msg.content = final_response
        
        # Update thinking
        if state["assistant_response"] and "thinking" in state["assistant_response"]:
            assistant_msg.thinking = state["assistant_response"]["thinking"]
            
        # Update search output
        if state["search_result"]:
            assistant_msg.search_output = json.dumps(state["search_result"])
            
        # Update critic score
        if state["critic_result"]:
            assistant_msg.critic_score = json.dumps(state["critic_result"])
            
        # Update regenerated content if available
        if state["regenerated_response"]:
            assistant_msg.regenerated_content = state["regenerated_response"]
            
        # Update regenerated critic if available
        if state["regenerated_critic"]:
            assistant_msg.regenerated_critic = json.dumps(state["regenerated_critic"])
            
        # Commit changes
        db.session.commit()
        
    except Exception as e:
        print(f"[ERROR] Failed to update assistant message: {e}")
        # Try to update with error message
        try:
            if assistant_msg:
                assistant_msg.content = f"[Error updating message: {str(e)}]"
                db.session.commit()
        except:
            pass