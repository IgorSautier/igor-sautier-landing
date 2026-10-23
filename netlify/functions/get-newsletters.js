exports.handler = async function(event, context) {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "BREVO_API_KEY not configured" })
    };
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/emailCampaigns?type=classic&status=sent&limit=3&sort=desc", {
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: "Brevo API error" })
      };
    }

    const data = await res.json();
    const campaigns = (data.campaigns || []).map(c => ({
      name: c.name || c.subject,
      subject: c.subject,
      date: c.sentDate || c.scheduledAt || c.createdAt,
      id: c.id
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600"
      },
      body: JSON.stringify(campaigns)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
