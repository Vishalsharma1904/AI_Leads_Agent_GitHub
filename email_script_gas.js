/**
 * NEXUS AI EMAIL AUTOMATION — Google Apps Script (GAS) Webhook v3
 * 
 * SETUP INSTRUCTIONS (One-time, takes ~3 minutes):
 * ─────────────────────────────────────────────────
 * 1. Go to https://script.google.com/
 * 2. Click "New Project" → delete default code → paste this entire file
 * 3. Click "Deploy" → "New deployment"
 * 4. Deployment type: "Web app" (gear icon)
 * 5. Execute as: "Me" (your Google account)
 * 6. Who has access: "Anyone"
 * 7. Click "Deploy" → Authorize when prompted
 * 8. Copy the Web app URL → Paste in the app → Accounts tab
 * 
 * FEATURES:
 *  - Sends from your Gmail account (shows YOUR email as sender)
 *  - Full CC / BCC support
 *  - Sender name (From: "Your Name <you@gmail.com>")
 *  - Reply-To header
 *  - HTML + plain text fallback
 *  - Daily quota: 500 emails (free Gmail), 1500 (Google Workspace)
 *  - Returns real success/failure status (not blind)
 */

// ── CONFIG (edit if needed) ────────────────────────────────────────
var CONFIG = {
  // Max emails allowed per single request (anti-abuse)
  MAX_RECIPIENTS_PER_REQUEST: 1,

  // Set a custom "From" display name (leave blank to use your Google profile name)
  SENDER_NAME: '',

  // Optional: Set a default Reply-To address
  REPLY_TO: ''
};

// ── CORS Headers ───────────────────────────────────────────────────
function addCORSHeaders(output) {
  return output
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    .setHeader('Access-Control-Max-Age', '86400');
}

// ── Preflight (OPTIONS) ────────────────────────────────────────────
function doOptions(e) {
  return addCORSHeaders(ContentService.createTextOutput(''));
}

// ── GET: Health check ─────────────────────────────────────────────
function doGet(e) {
  var quotaRemaining = MailApp.getRemainingDailyQuota();
  var response = {
    status: 'ok',
    service: 'Nexus AI Email Webhook v3',
    senderEmail: Session.getActiveUser().getEmail(),
    dailyQuotaRemaining: quotaRemaining,
    timestamp: new Date().toISOString()
  };
  return addCORSHeaders(
    ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON)
  );
}

// ── POST: Send Email ───────────────────────────────────────────────
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return errorResponse('No POST data received');
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return errorResponse('Invalid JSON payload: ' + parseErr.toString());
    }

    // ── Validate required fields ──
    var toAddress   = (data.to    || '').trim();
    var subject     = (data.subject || '').trim();
    var htmlBody    = data.htmlBody || data.body || '';

    if (!toAddress)  return errorResponse('Missing required field: to');
    if (!subject)    return errorResponse('Missing required field: subject');
    if (!htmlBody)   return errorResponse('Missing required field: htmlBody');
    if (!toAddress.includes('@')) return errorResponse('Invalid email address: ' + toAddress);

    // ── Check quota ──
    var quota = MailApp.getRemainingDailyQuota();
    if (quota <= 0) {
      return errorResponse('Daily email quota exhausted. Resets at midnight Pacific Time.');
    }

    // ── Build email options ──
    var senderName = CONFIG.SENDER_NAME ||
                     (data.senderName || '') ||
                     Session.getActiveUser().getEmail().split('@')[0];

    var emailOptions = {
      to:       toAddress,
      subject:  subject,
      htmlBody: htmlBody,
      name:     senderName
    };

    // Plain text fallback (strip HTML tags)
    emailOptions.body = htmlBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    // CC / BCC
    if (data.cc  && data.cc.trim())  emailOptions.cc  = data.cc.trim();
    if (data.bcc && data.bcc.trim()) emailOptions.bcc = data.bcc.trim();

    // Reply-To
    var replyTo = CONFIG.REPLY_TO || data.replyTo || '';
    if (replyTo) emailOptions.replyTo = replyTo;

    // Attachments (base64-encoded)
    var attachmentsData = data.attachments || [];
    if (attachmentsData.length > 0) {
      var atts = [];
      for (var i = 0; i < attachmentsData.length; i++) {
        var a = attachmentsData[i];
        if (a.data && a.name && a.type) {
          atts.push(Utilities.newBlob(Utilities.base64Decode(a.data), a.type, a.name));
        }
      }
      if (atts.length > 0) emailOptions.attachments = atts;
    }

    // Inline signature/body images and GIFs (CID-keyed base64 blobs)
    var inlineData = data.inlineImages || [];
    if (inlineData.length > 0) {
      var inlineBlobs = {};
      for (var j = 0; j < inlineData.length; j++) {
        var inlineItem = inlineData[j];
        if (inlineItem.cid && inlineItem.data && inlineItem.type) {
          var safeCid = String(inlineItem.cid).replace(/[^a-zA-Z0-9_-]/g, '');
          if (safeCid) {
            inlineBlobs[safeCid] = Utilities.newBlob(
              Utilities.base64Decode(inlineItem.data),
              inlineItem.type,
              inlineItem.name || (safeCid + '.img')
            );
          }
        }
      }
      if (Object.keys(inlineBlobs).length > 0) emailOptions.inlineImages = inlineBlobs;
    }

    // ── Send ──
    MailApp.sendEmail(emailOptions);

    return successResponse({
      message:        'Email sent successfully',
      to:             toAddress,
      subject:        subject,
      cc:             emailOptions.cc  || null,
      bcc:            emailOptions.bcc || null,
      quotaRemaining: MailApp.getRemainingDailyQuota(),
      sentAt:         new Date().toISOString()
    });

  } catch (err) {
    return errorResponse(err.toString());
  }
}

// ── Helpers ────────────────────────────────────────────────────────
function successResponse(data) {
  return addCORSHeaders(
    ContentService.createTextOutput(JSON.stringify({ status: 'success', ...data }))
      .setMimeType(ContentService.MimeType.JSON)
  );
}

function errorResponse(message) {
  return addCORSHeaders(
    ContentService.createTextOutput(JSON.stringify({ status: 'error', message: message }))
      .setMimeType(ContentService.MimeType.JSON)
  );
}
