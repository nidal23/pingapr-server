// src/middleware/slack-verify.js
const crypto = require('crypto');

// Verify that requests are coming from Slack
const verifySlackRequest = (req, res, next) => {
  // During URL verification, just pass through
  if (req.body && req.body.type === 'url_verification') {
    return next();
  }
  
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  
  // Skip verification in development if needed
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_SLACK_VERIFICATION === 'true') {
    return next();
  }
  
  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSignature = req.headers['x-slack-signature'];
  
  if (!timestamp || !slackSignature) {
    return res.status(400).send('Missing required Slack headers');
  }
  
  // Verify the request is not too old (to prevent replay attacks)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    return res.status(400).send('Verification failed: Request too old');
  }
  
  // Create the signature base string
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  
  // Create the signature to compare
  const mySignature = 'v0=' + 
    crypto.createHmac('sha256', slackSigningSecret)
      .update(sigBaseString, 'utf8')
      .digest('hex');
  
  // Compare signatures 
  if (slackSignature === mySignature) {
    next();
  } else {
    return res.status(400).send('Verification failed: Signatures do not match');
  }
};

module.exports = {
  verifySlackRequest
};