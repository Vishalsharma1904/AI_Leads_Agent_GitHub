"""No real carrier requests: tenant, daily budget, timeout and receipt semantics."""
from unittest.mock import patch
from fastapi import HTTPException
from tests.test_crm import CRMTest
from api.textbee import router, SMSDispatch, SMSBudget, SMSCampaign, day_key
from api.crm import CRMRecord, CRMActivity


class TextBeeTest(CRMTest):
    def setUp(self):
        super().setUp()
        self.app.include_router(router)
        self.cfg = patch('api.textbee.config', return_value={'apiKey': 'test', 'deviceId': 'device', 'dailyLimit': 20})
        self.cfg.start()

    def tearDown(self):
        self.cfg.stop()
        super().tearDown()

    def sms(self, method, path, body=None, owner='owner'):
        return self.client.request(method, '/api/textbee' + path, json=body, headers={'Authorization': 'Bearer ' + owner})

    def campaign(self):
        result = self.sms('POST', '/campaigns', {'name': 'Test', 'message': 'Hello'})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()['id']

    def test_phone_dedupe_ownership_optouts_and_timeout(self):
        lead = self.lead(phone='9876543210')
        self.lead('same-number', phone='+91 98765 43210')
        self.lead('optout', phone='9876543211', phoneOptOut=True)
        self.lead('other-only', owner='other', phone='9876543212')
        self.assertEqual(self.sms('GET', '/audience').json()['total'], 1)
        campaign = self.campaign()
        self.assertEqual(self.sms('POST', '/campaigns/' + campaign + '/run', owner='other').status_code, 404)
        with patch('api.textbee.gateway', side_effect=HTTPException(502, 'Timed out')) as provider:
            result = self.sms('POST', '/campaigns/' + campaign + '/run').json()
            self.assertEqual(result['status'], 'unknown')
            self.assertTrue(self.sms('POST', '/campaigns/' + campaign + '/run').json()['done'])
            self.assertEqual(provider.call_count, 1)
        self.assertEqual(self.sms('GET', '/audience').json()['total'], 0)
        self.assertEqual(self.db.query(SMSBudget).one().used, 1)
        self.assertEqual(self.db.get(CRMRecord, lead.id).stage, 'new')

    def test_daily_limit_and_confirmed_delivery_not_conversation(self):
        lead = self.lead(phone='9876543210')
        campaign = self.campaign()
        budget = SMSBudget(id='budget', owner_user_id='owner', day=day_key(), used=20)
        self.db.add(budget); self.db.commit()
        with patch('api.textbee.gateway') as provider:
            self.assertEqual(self.sms('POST', '/campaigns/' + campaign + '/run').status_code, 429)
            provider.assert_not_called()
        budget.used = 19; self.db.commit()
        with patch('api.textbee.gateway', return_value={'smsBatchId': 'batch'}):
            self.assertEqual(self.sms('POST', '/campaigns/' + campaign + '/run').json()['status'], 'queued')
        self.assertEqual(self.db.get(CRMRecord, lead.id).stage, 'new')
        with patch('api.textbee.gateway', return_value={'deliveredCount': 1}):
            self.sms('POST', '/refresh'); self.sms('POST', '/refresh')
        self.assertEqual(self.db.query(SMSDispatch).one().status, 'delivered')
        self.assertEqual(self.db.query(CRMActivity).filter_by(channel='sms').count(), 1)
        metrics = self.call('GET', '/overview').json()['metrics']
        self.assertEqual(metrics['messagesSent'], 1)
        self.assertEqual(metrics['conversations'], 0)
        self.assertEqual(metrics['clients'], 0)

    def test_unicode_single_segment_and_arbitrary_numbers_rejected(self):
        self.lead(phone='9876543210')
        self.assertEqual(self.sms('POST', '/campaigns', {'name': 'Test', 'message': 'अ' * 71}).status_code, 422)
        self.assertEqual(self.sms('POST', '/campaigns', {'name': 'Test', 'message': 'Hi', 'recordIds': ['foreign']}).status_code, 422)

    def test_offline_android_carryover_reserves_next_day_capacity(self):
        self.lead(phone='9876543210')
        campaign = self.campaign()
        for i in range(20):
            self.db.add(SMSDispatch(id='old-' + str(i), owner_user_id='owner', campaign_id='old-campaign',
                                   record_id='old-record', phone='+91990000' + str(i).zfill(4), day='2000-01-01',
                                   status='queued', device_id='device', provider_id='old-batch-' + str(i), created_at=1))
        self.db.commit()
        with patch('api.textbee.gateway', return_value={}) as provider:
            self.assertEqual(self.sms('GET', '/status').json()['usedToday'], 20)
            provider.reset_mock()
            self.assertEqual(self.sms('POST', '/campaigns/' + campaign + '/run').status_code, 429)
            provider.assert_not_called()
