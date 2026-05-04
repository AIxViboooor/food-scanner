// Edge middleware — gates every request behind HTTP Basic Auth.
// Runs on Vercel's edge network before any HTML or API response.
// Free on Hobby tier. Credentials live in Vercel env vars.

export const config = {
  matcher: '/((?!_next/static|favicon.ico).*)',
};

export default function middleware(request) {
  const auth = request.headers.get('authorization');

  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      let decoded;
      try {
        decoded = atob(encoded);
      } catch {
        return unauthorized();
      }
      const [user, pass] = decoded.split(':');
      if (
        user === process.env.BASIC_AUTH_USER &&
        pass === process.env.BASIC_AUTH_PASS
      ) {
        // Auth passes — continue normally.
        return;
      }
    }
  }

  return unauthorized();
}

function unauthorized() {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Food Scanner", charset="UTF-8"',
      'Content-Type': 'text/plain',
    },
  });
}
