import logging

logger = logging.getLogger(__name__)

class ConversationStateMachine:
    STATES = [
        "INIT",
        "GREETING",
        "TIMING_CHECK",
        "LEAD_QUALIFICATION",
        "OBJECTION_HANDLING",
        "CLOSING",
        "FAILED"
    ]
    
    def __init__(self):
        self.current_state = "INIT"
        self.turn_count = 0

    def transition(self, intent: str, sentiment: str) -> str:
        """
        Calculates the next state based on the current state, user intent, and sentiment.
        """
        previous_state = self.current_state
        
        if self.current_state == "INIT":
            self.current_state = "GREETING"
            
        elif self.current_state == "GREETING":
            self.current_state = "TIMING_CHECK"
            
        elif self.current_state == "TIMING_CHECK":
            if intent == "declining":
                self.current_state = "CLOSING"
            else:
                self.current_state = "LEAD_QUALIFICATION"
                
        elif self.current_state == "LEAD_QUALIFICATION":
            if intent == "objecting" or intent == "requesting_info":
                self.current_state = "OBJECTION_HANDLING"
            elif intent == "declining":
                self.current_state = "CLOSING"
                
        elif self.current_state == "OBJECTION_HANDLING":
            if intent == "agreeing":
                self.current_state = "LEAD_QUALIFICATION"
            elif intent == "declining":
                self.current_state = "CLOSING"
                
        self.turn_count += 1
        logger.info(f"State Transition: {previous_state} -> {self.current_state}")
        return self.current_state

    def get_system_instruction(self) -> str:
        """
        Provides dynamic instructions to the LLM based on the current state.
        """
        instructions = {
            "GREETING": "Greet the user warmly, state the company name, and disclose you are an AI.",
            "TIMING_CHECK": "Ask if it is a good time to talk for 2 minutes.",
            "LEAD_QUALIFICATION": "Ask qualifying questions about their needs.",
            "OBJECTION_HANDLING": "Address their concerns politely using the knowledge base.",
            "CLOSING": "Thank them for their time and end the call politely."
        }
        return instructions.get(self.current_state, "Respond naturally.")
