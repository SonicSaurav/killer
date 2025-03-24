import json
from openai import OpenAI
from dotenv import load_dotenv
from together import Together
import re

load_dotenv()  # Load environment variables from .env file if present

# Initialize the Together client for DeepSeek
try:
    with open("together.key", "r", encoding="utf-8") as f:
        together_key = f.read().strip()
    together_client = Together(api_key=together_key)
except Exception as e:
    print(f"[CRITIC] Error initializing Together client: {e}")
    together_client = None

# Fallback to OpenAI client
try:
    client = OpenAI()
except Exception as e:
    print(f"[CRITIC] Error initializing OpenAI client: {e}")
    client = None

def get_score(conversation_history: list, search_history: list = []) -> int:
    """
    Calculate and return a rating based on the conversation and search histories.
    This function constructs a critic prompt by replacing placeholders with relevant data from the conversation history,
    the original agent prompt, the search history, and the last response. It then logs the generated prompt to a file,
    performs a chat completion API call using the DeepSeek-R1 model, and attempts to extract score information from the JSON
    formatted response.
    Parameters:
        conversation_history (list): List containing the conversation history. The final element is considered the
                                     last response, while the remaining elements form the conversation context.
        search_history (list, optional): Optional list of search-related inputs. Defaults to an empty list.
    Returns:
        int: The extracted rating if the process is successful. In case of an error during prompt preparation,
             API call, JSON decoding, or if the expected score data is missing, the function returns -1.0.
    """

    # Open the file using the resolved absolute path
    try:
        with open("prompts/actor.md", "r") as file:
            agent_prompt = file.read()
    except FileNotFoundError:
        print("[CRITIC] Error: actor.md not found, using default prompt")
        agent_prompt = "Default Actor Prompt"
        
    try:
        with open("prompts/critic.md", "r") as file:
            critic_prompt = file.read()
    except FileNotFoundError:
        print("[CRITIC] Error: critic.md not found")
        return -1.0

    with open("logs/conv_hist.json", "w") as file:
        json.dump(conversation_history, file)

    last_response = conversation_history[-1]
    conversation_history = conversation_history[:-1]
    try:
        critic_prompt = (
            critic_prompt.replace("{conversation}", str(conversation_history))
            .replace("{original_prompt}", str(agent_prompt))
            .replace("{search_history}", str(search_history))
            .replace("{last_response}", str(last_response))
        )
        # dump the critic prompt to a file
        with open("logs/critic.md", "a") as file:
            file.write(f"{critic_prompt}\n")
            file.write("-" * 50 + "\n" * 5)
    except Exception as e:
        print(f"[CRITIC] Error: {e}")
        with open("logs/critic_error.log", "a") as file:
            file.write(f"{e}\n")
        return -1.0

    # Try to get response from DeepSeek via Together API
    response = None
    if together_client:
        try:
            completion = together_client.chat.completions.create(
                model="deepseek-ai/DeepSeek-R1",
                messages=[{"role": "user", "content": critic_prompt}],
                temperature=0.2  # Low temperature for consistent evaluation
            )
            response = completion.choices[0].message.content
            print(f"[CRITIC] Using Together DeepSeek-R1")
        except Exception as e:
            print(f"[CRITIC] Together API error: {e}")
            response = None
    
    # Fall back to OpenAI if Together API fails
    if response is None and client:
        try:
            completion = client.chat.completions.create(
                model="o1-2024-12-17",  # Use available model
                messages=[{"role": "user", "content": critic_prompt}]
            )
            response = completion.choices[0].message.content
            print(f"[CRITIC] Using OpenAI (fallback)")
        except Exception as e:
            print(f"[CRITIC] OpenAI API error: {e}")
            return -1.0
    
    if not response:
        print("[CRITIC] Failed to get any API response")
        return -1.0

    print(f"[CRITIC] Response received of length: {len(response)}")
    with open("logs/critic_response.log", "a") as file:
        file.write(f"{response}\n")
        file.write("-" * 50 + "\n" * 5)
    
    try:
        # FIRST CHANGE: Remove <think> tags before JSON parsing
        think_pattern = r'<think>(.*?)</think>\s*'
        response_without_thinking = re.sub(think_pattern, '', response, flags=re.DOTALL).strip()
        
        # Try to find JSON in the critic response (using response without thinking tags)
        json_pattern = r'(\{[\s\S]*\})'
        json_match = re.search(json_pattern, response_without_thinking)
        
        if json_match:
            try:
                parsed_json = json.loads(json_match.group(1))
                
                # Check for total_score directly
                if "total_score" in parsed_json:
                    return parsed_json["total_score"]
                
                # If no total_score, try to calculate from component scores
                total = 0
                if "adherence_to_search" in parsed_json and "score" in parsed_json["adherence_to_search"]:
                    total += float(parsed_json["adherence_to_search"]["score"])
                if "question_format" in parsed_json and "score" in parsed_json["question_format"]:
                    total += float(parsed_json["question_format"]["score"]) 
                if "conversational_quality" in parsed_json and "score" in parsed_json["conversational_quality"]:
                    total += float(parsed_json["conversational_quality"]["score"])
                if "contextual_intelligence" in parsed_json and "score" in parsed_json["contextual_intelligence"]:
                    total += float(parsed_json["contextual_intelligence"]["score"])
                if "overall_effectiveness" in parsed_json and "score" in parsed_json["overall_effectiveness"]:
                    total += float(parsed_json["overall_effectiveness"]["score"])
                
                if total > 0:
                    return total
                    
                print("[CRITIC] JSON found but no scores detected")
                return -1.0
                
            except json.JSONDecodeError:
                print("[CRITIC] Failed to parse JSON from match")
        
        # If no JSON found, try to find standalone score in response without thinking tags
        score_pattern = r'total_score[\s:"]*(\d+\.?\d*)'
        score_match = re.search(score_pattern, response_without_thinking, re.IGNORECASE)
        if score_match:
            try:
                return float(score_match.group(1))
            except:
                pass
                
        print("[CRITIC] No valid score patterns found in response")
        return -1.0
            
    except Exception as e:
        print(f"[CRITIC] Error processing response: {e}")
        with open("logs/critic_error.log", "a") as file:
            file.write(f"{e}\n")
        return -1.0