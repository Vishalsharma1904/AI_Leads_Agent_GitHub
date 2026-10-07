"""Small runnable check for scenario ownership and caller-controlled fields."""
import asyncio
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from api.auth_sync import Base, UserAccount
from api.toughtongue import CallRequest, ScenarioRequest, VoiceScenario, _config, call, create_scenario, update_scenario


class ToughTongueCheck(unittest.TestCase):
    def test_tenant_boundary(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        owner = UserAccount(id="business-a", email="a@example.com", name="A")
        other = UserAccount(id="business-b", email="b@example.com", name="B")
        scenario_id = "689e283d8ff2b6aca6239d8b"
        payload = {"name": "Sales agent", "ai_instructions": "Qualify leads"}

        async def provider(method, path, user, db, body=None):
            return {"id": scenario_id}

        with Session(engine) as db, patch("api.toughtongue._provider", provider):
            result = asyncio.run(create_scenario(ScenarioRequest(config=payload), db, owner))
            self.assertEqual(result["id"], scenario_id)
            self.assertEqual(db.query(VoiceScenario).one().owner_user_id, owner.id)
            with self.assertRaises(HTTPException) as denied:
                asyncio.run(update_scenario(scenario_id, ScenarioRequest(config=payload), db, other))
            self.assertEqual(denied.exception.status_code, 404)
            with self.assertRaises(HTTPException) as denied:
                asyncio.run(call(CallRequest(scenario_id=scenario_id, sip_trunk_id="trunk", phone_number="+919876543210"), db, other))
            self.assertEqual(denied.exception.status_code, 404)
            with self.assertRaises(HTTPException):
                _config({**payload, "id": scenario_id})


if __name__ == "__main__":
    unittest.main()
