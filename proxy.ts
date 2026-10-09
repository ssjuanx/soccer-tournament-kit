import { NextResponse, type NextRequest } from "next/server";

/**
 * Minimal HTTP Basic protection for the single-admin tournament workflow.
 * Browsers remember the credentials for the session, so this needs no login
 * page, user table, or authentication dependency.
 */
export function proxy(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === "development") {
      return NextResponse.next();
    }
    return new NextResponse("ADMIN_PASSWORD is not configured.", {
      status: 503,
    });
  }

  const expected = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  if (request.headers.get("authorization") === expected) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Tournament admin"' },
  });
}

export const config = {
  matcher: "/admin/:path*",
};
