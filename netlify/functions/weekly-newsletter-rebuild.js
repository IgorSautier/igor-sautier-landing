// Runs every Wednesday morning (schedule in netlify.toml): triggers a new deploy,
// which rebuilds the newsletter pages with Tuesday's newsletter from Brevo.
exports.handler = async function() {
  var hook = process.env.NEWSLETTER_BUILD_HOOK;
  if (!hook) {
    console.log('NEWSLETTER_BUILD_HOOK is not set, nothing to trigger');
    return { statusCode: 500 };
  }
  var res = await fetch(hook, { method: 'POST' });
  console.log('Build hook triggered:', res.status);
  return { statusCode: res.ok ? 200 : 502 };
};
