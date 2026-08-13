import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authOk, isAuthExempt } from "@/lib/auth";

// Gate the whole app behind CUF_AUTH_TOKEN when it is set. API requests get 401;
// page requests redirect to /login. No token set = open (local dev).
export async function proxy(req: NextRequest) {
  const expected = process.env.CUF_AUTH_TOKEN;
  const path = req.nextUrl.pathname;
  if (!expected || isAuthExempt(path)) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const header = req.headers.get("authorization") ?? undefined;
  if (await authOk(expected, cookie, header)) return NextResponse.next();

  if (path.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
