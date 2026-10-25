const https = require('https');

exports.handler = async function(event, context) {
  var apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    console.log('BREVO_API_KEY not found in env');
    return {
      statusCode: 500,
      headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},
      body: JSON.stringify({ error: "BREVO_API_KEY not configured" })
    };
  }

  console.log('API key found, length:', apiKey.length);

  return new Promise(function(resolve) {
    var options = {
      hostname: 'api.brevo.com',
      path: '/v3/emailCampaigns?type=classic&status=sent&limit=3&sort=desc&excludeHtmlContent=true',
      method: 'GET',
      headers: {
        'api-key': apiKey,
        'accept': 'application/json'
      }
    };

    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        console.log('Brevo response status:', res.statusCode);
        console.log('Brevo response body length:', body.length);

        if (res.statusCode !== 200) {
          console.log('Brevo error body:', body.substring(0, 500));
          resolve({
            statusCode: 200,
            headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},
            body: JSON.stringify([])
          });
          return;
        }

        try {
          var data = JSON.parse(body);
          console.log('Campaigns count:', (data.campaigns || []).length);
          var campaigns = (data.campaigns || []).map(function(c) {
            var subj = c.subject || '';
            subj = subj.replace(/\{\{[^}]*\}\},?\s*/g, '').trim();
            if (subj.startsWith(',')) subj = subj.substring(1).trim();
            subj = subj.charAt(0).toUpperCase() + subj.slice(1);
            return {
              subject: subj,
              previewText: c.previewText || '',
              date: c.sentDate || c.scheduledAt || c.createdAt,
              id: c.id,
              shareLink: c.shareLink || ''
            };
          });
          resolve({
            statusCode: 200,
            headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Cache-Control":"no-cache"},
            body: JSON.stringify(campaigns)
          });
        } catch(e) {
          console.log('Parse error:', e.message);
          resolve({
            statusCode: 200,
            headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},
            body: JSON.stringify([])
          });
        }
      });
    });

    req.on('error', function(e) {
      console.log('Request error:', e.message);
      resolve({
        statusCode: 200,
        headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"},
        body: JSON.stringify([])
      });
    });

    req.end();
  });
};
