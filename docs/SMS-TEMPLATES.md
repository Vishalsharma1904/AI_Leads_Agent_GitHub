# SMS Templates (Fast2SMS / DLT)

Copy these into Fast2SMS → DLT Templates. Each `{#var#}` is one variable you
pass in order via the `variables` array.

## Why DLT matters

Route `q` (Quick) works without any registration and is what the plugin uses
first, so you can test immediately. But TRAI requires DLT registration for
production bulk SMS to Indian numbers. Without it, high-volume sends get
filtered or blocked by the operators.

DLT needs two things approved with your operator before the template works:

- a **sender ID** (also called header) — 3 to 6 characters, e.g. `JOBIFY`
- each **message template**, with variables marked as `{#var#}`

Approval usually takes a day or two. Until then use route `q`.

---

## Template 1 — Job Alert

```
Hi {#var#}, {#var#} ke liye {#var#} position available hai. Salary: {#var#}. Interested? Reply APPLY - JOBIFY
```

Variables in order: `candidateName`, `companyName`, `jobTitle`, `salary`

```bash
curl -X POST http://localhost:8000/api/sms/send-dlt \
  -H "Content-Type: application/json" \
  -d '{
    "numbers": ["9876543210"],
    "sender_id": "JOBIFY",
    "template_id": "YOUR_APPROVED_TEMPLATE_ID",
    "variables": ["Rahul", "Acme Hotels", "Security Guard", "18000"]
  }'
```

---

## Template 2 — Interview Call

```
Dear {#var#}, interview {#var#} ko {#var#} baje schedule hai. Venue: {#var#}. Confirm reply YES - JOBIFY
```

Variables in order: `candidateName`, `date`, `time`, `venue`

---

## Template 3 — Selection

```
Congratulations {#var#}! Aap {#var#} mein select hue hain. Offer letter email pe bheja gaya. - JOBIFY
```

Variables in order: `candidateName`, `companyName`

---

## Template 4 — Client Update

```
Dear {#var#}, {#var#} candidates shortlist hue hain. Interview schedule ke liye call karein: {#var#} - JOBIFY
```

Variables in order: `clientName`, `candidateCount`, `contactNumber`

---

## Template 5 — Reminder

```
Hi {#var#}, kal {#var#} baje interview hai. Documents ready rakhein. All the best! - JOBIFY
```

Variables in order: `candidateName`, `time`

---

## Testing without DLT

Use the quick route. No template or sender ID needed:

```bash
curl -X POST http://localhost:8000/api/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "numbers": ["9876543210"],
    "message": "Hi Rahul, your interview is on 15 Aug at 11 AM. - JOBIFY"
  }'
```

Bulk works the same way — pass up to 1000 numbers in one request:

```bash
curl -X POST http://localhost:8000/api/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "numbers": ["9876543210", "9876543211", "9876543212"],
    "message": "New Job Alert! Security Guard at Acme Hotels. Salary 18000. - JOBIFY"
  }'
```

## Check your balance

```bash
curl http://localhost:8000/api/sms/wallet
```

This is the same endpoint the plugin health check uses, which is why a passing
health check proves the key is genuinely valid rather than merely present.

---

## Setup checklist

1. Fast2SMS → Dashboard → Dev API → copy the API key.
2. Add to `backend/.env`:
   ```
   FAST2SMS_API_KEY=your_key_here
   ```
   Never put this in any frontend file — the browser cannot keep a secret.
3. Start the backend:
   ```
   cd backend
   uvicorn main:app --reload --port 8000
   ```
4. In the app: Plugins → SMS (Fast2SMS) → Connect → relay URL `http://localhost:8000`.
5. Press **Save & test**. It calls the wallet endpoint, so a pass means the key works.
6. For production bulk, register the sender ID and templates above, then use
   `/api/sms/send-dlt`.
