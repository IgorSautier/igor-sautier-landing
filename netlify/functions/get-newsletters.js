const https = require('https');

exports.handler = async function(event, context) {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},
      body: JSON.stringify({ error: "BREVO_API_KEY not configured" })
    };
  }

  return new Promise(function(resolve) {
    var options = {
      hostname: 'api.brevo.com',
      path: '/v3/emailCampaigns?type=classic&status=sent&limit=3&sort=desc',
      method: 'GET',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      }
    };

    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        try {
          var data = JSON.parse(body);
          var campaigns = (data.campaigns || []).map(function(c) {
            return {
              subject: c.subject,
              date: c.sentDate || c.scheduledAt || c.createdAt,
              id: c.id
            };
          });
          resolve({
            statusCode: 200,
            headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Cache-Control":"public, max-age=3600"},
            body: JSON.stringify(campaigns)
          });
        } catch(e) {
          resolve({
            statusCode: 500,
            headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},
            body: JSON.stringify({ error: "Parse error" })
          });
        }
      });
    });

    req.on('error', function(e) {
      resolve({
        statusCode: 500,
        headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},
        body: JSON.stringify({ error: e.message })
      });
    });

    req.end();
  });
};
