from .. import chat_blueprint
from flask import jsonify, request, session, redirect, url_for, render_template
from models import db
from models.models import User, Chat, Message, AssistantMessage
from .helpers import (
    retrieve_or_create_chat,
    create_user_message,
    generate_and_store_assistant_message,
    maybe_generate_second_assistant_message,
)
from .llm_processing import get_processing_state, init_processing_state


# ==================================================================================================#
#                                          ⛔NOTE⛔                                                 #
# This blueprint is registered with /assistant prefix in app.py.                                    #
# So every route in this blueprint will be prefixed with /assistant.                                #
# "/" route would be "/assistant/" in the browser.                                                  #
# "/chat" route would be "/assistant/chat" in the browser.                                          #
# ==================================================================================================#


@chat_blueprint.route("/")
def assistant():
    if "username" not in session:
        return redirect(url_for("login"))
    return render_template("assistant.html")


@chat_blueprint.route("/chat/start", methods=["POST"])
def start_chat():
    """
    Starts a new chat session or reuses the last empty chat for an authenticated user.
    """
    if "username" not in session:
        return jsonify({"error": "Unauthorized"}), 401
    user = User.query.filter_by(name=session["username"]).first()
    if not user:
        return jsonify({"error": "User not found"}), 404
    # if last chat is empty, return the last chat, else create a new chat
    last_chat = (
        Chat.query.filter_by(user_id=user.id).order_by(Chat.timestamp.desc()).first()
    )
    if last_chat and last_chat.is_empty():
        chat = last_chat
    else:
        chat = Chat(user_id=user.id)
        db.session.add(chat)
        db.session.commit()

    # clear logs/critic.md file
    with open("logs/critic.md", "w") as file:
        file.write("")
        print("[DEBUG] Cleared critic.md file")

    return jsonify({"success": True, "chat_id": chat.id}), 200


@chat_blueprint.route("/chat/processing/<string:chat_id>", methods=["GET"])
def get_processing_status(chat_id):
    """
    Get the current processing status for a chat.
    
    This endpoint retrieves the current state of asynchronous message processing,
    allowing the frontend to display progress and intermediate results.
    
    Args:
        chat_id (str): The ID of the chat being processed.
        
    Returns:
        JSON: A JSON object containing the current processing state.
    """
    if "username" not in session:
        return jsonify({"error": "Unauthorized"}), 401
        
    user = User.query.filter_by(name=session["username"]).first()
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    # Get the processing state
    state = get_processing_state(chat_id)
    if not state:
        # Initialize a new processing state
        state = init_processing_state(chat_id)
        state.update({
            "status": "not_started",
            "error": "Processing has not been started for this chat"
        })
    
    return jsonify(state), 200


@chat_blueprint.route("/sessions")
def get_sessions():
    """
    Retrieve and render chat sessions for the authenticated user.
    """
    if "username" not in session:
        return jsonify({"error": "Unauthorized"}), 401
    user = User.query.filter_by(name=session["username"]).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    # For demonstration, we are ignoring ownership of sessions.
    # If you'd like to only show the user's sessions, do:
    # chat_sessions = user.get_chats()

    chat_sessions = Chat.query.all()
    chat_sessions = chat_sessions[::-1]  # Reverse the order
    return render_template("chat-sessions.html", sessions=chat_sessions)


@chat_blueprint.route("/chat/<string:chat_id>")
def chat_session(chat_id):
    """
    Handle a chat session by retrieving the chat data for the given chat_id.
    """
    print(f"[DEBUG] Chat ID: {chat_id}")
    if "username" not in session:
        print("[DEBUG] Redirecting to login")
        return redirect(url_for("login"))
    user = User.query.filter_by(name=session["username"]).first()
    print(f"[DEBUG] User: {user}")
    if not user:
        return jsonify({"error": "User not found"}), 404

    chat = db.session.get(Chat, chat_id)
    if not chat:
        return jsonify({"error": "Chat not found"}), 404
    return jsonify(chat.dump()), 200


@chat_blueprint.route("/chat/score/<string:chat_id>", methods=["POST"])
def score_chat(chat_id):
    """
    Scores a chat by retrieving its critic scores.
    """
    if "username" not in session:
        return jsonify({"error": "Unauthorized"}), 401
    user = User.query.filter_by(name=session["username"]).first()
    if not user:
        print("[DEBUG] User not found")
        return jsonify({"error": "User not found"}), 404

    chat = db.session.get(Chat, chat_id)
    if not chat:
        print("[DEBUG] Chat not found")
        return jsonify({"error": "Chat not found"}), 404
    print(f"[DEBUG] Chat ID: {chat_id}")
    scores = chat.get_critic_scores()
    print(f"[DEBUG] Scores: {scores}")
    # Update the scores before exiting
    chat.update_missing_critic_scores()
    return jsonify({"scores": scores}), 200


@chat_blueprint.route(
    "/chat/enable_second_assistant/<string:chat_id>", methods=["POST"]
)
def enable_second_assistant(chat_id):
    """Enables the second assistant for a given chat."""
    if "username" not in session:
        return jsonify({"error": "Unauthorized"}), 401
    user = User.query.filter_by(name=session["username"]).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    chat = Chat.query.get(chat_id)
    if not chat:
        return jsonify({"error": "Chat not found"}), 404
    if chat.user_id != user.id:
        return jsonify({"error": "Unauthorized"}), 403

    chat.allow_second_assistant = True
    db.session.commit()
    return jsonify({"success": True, "allow_second_assistant": True}), 200


@chat_blueprint.route(
    "/chat/disable_second_assistant/<string:chat_id>", methods=["POST"]
)
def disable_second_assistant(chat_id):
    if "username" not in session:
        return jsonify({"error": "Unauthorized"}), 401
    user = User.query.filter_by(name=session["username"]).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    chat = Chat.query.get(chat_id)
    if not chat:
        return jsonify({"error": "Chat not found"}), 404
    if chat.user_id != user.id:
        return jsonify({"error": "Unauthorized"}), 403

    chat.allow_second_assistant = False
    db.session.commit()
    return jsonify({"success": True, "allow_second_assistant": False}), 200


@chat_blueprint.route("/chat", methods=["POST"])
def chat():
    """
    Handles chat interactions by performing a series of operations:
    1. Authenticates the user
    2. Retrieves an existing chat or creates a new one
    3. Creates a new user message
    4. Initiates asynchronous processing for assistant response
    5. Optionally initiates a second assistant response
    6. Returns the message data
    """
    print("[DEBUG] Chat route accessed")
    # 1) User authentication
    if "username" not in session:
        return jsonify({"error": "Unauthorized"}), 401
    user = User.query.filter_by(name=session["username"]).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    # 2) Retrieve or create a chat
    chat_id = request.json.get("chat_id")
    chat, error = retrieve_or_create_chat(user, chat_id)
    if not chat:
        return jsonify({"error": error}), 404 if error == "Chat not found" else 403

    # 3) Get user_input
    user_input = request.json.get("user_input")
    if not user_input:
        return jsonify({"error": "No message provided"}), 400

    # 4) Create a user message
    message = create_user_message(chat, user_input)

    # 5) Generate the first assistant response (now asynchronous)
    generate_and_store_assistant_message(
        chat,
        message,
        base_prompt_path="./prompts/actor.md",
        search_prompt_path="./prompts/search_simulator.md",
    )

    # 6) If second assistant is enabled, generate a second assistant response (also asynchronous)
    if chat.allow_second_assistant:
        maybe_generate_second_assistant_message(
            chat,
            message,
            base_prompt_path="./prompts/actor.md",
            search_prompt_path="./prompts/search_simulator.md",
        )

    # 7) Dump message data
    data = message.dump()
    data["chat_id"] = chat.id

    print(data)
    return jsonify(data), 200


@chat_blueprint.route(
    "/chat/<string:chat_id>/message/<string:message_id>/prefer", methods=["POST"]
)
def prefer_message(chat_id, message_id):
    """
    Route handler to update the preferred assistant output for a given message within a chat.
    """
    if "username" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    user = User.query.filter_by(name=session["username"]).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    chat = Chat.query.get(chat_id)
    if not chat:
        return jsonify({"error": "Chat not found"}), 404

    if chat.user_id != user.id:
        return jsonify({"error": "Unauthorized"}), 403

    # Retrieve the message
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"error": "Message not found"}), 404

    # Ensure the message belongs to the specified chat
    if message.chat_id != chat_id:
        return jsonify({"error": "Message does not belong to this chat"}), 400

    # Get the preferred output number from JSON
    preferred_output = request.json.get("preferred_output")
    if preferred_output not in [1, 2]:
        return jsonify({"error": "Invalid preferred output. Must be 1 or 2."}), 400

    # Update the message's preferred assistant
    message.preferred_assistant = preferred_output
    db.session.commit()

    return (
        jsonify(
            {
                "success": True,
                "chat_id": chat_id,
                "message_id": message_id,
                "preferred_assistant": preferred_output,
            }
        ),
        200,
    )