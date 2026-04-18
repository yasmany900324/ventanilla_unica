import { NextResponse } from "next/server";
import {
  createSession,
  getSessionCookieOptions,
  loginCitizen,
  SESSION_COOKIE_NAME,
} from "../../../../lib/auth";

export async function POST(request) {
  try {
    const body = await request.json();
    const loginResult = await loginCitizen({
      identifier: body?.identifier,
      password: body?.password,
    });

    if (!loginResult.ok) {
      return NextResponse.json(
        { error: loginResult.error },
        { status: loginResult.status || 400 }
      );
    }

    const session = await createSession(loginResult.citizen.id);
    const response = NextResponse.json({ user: loginResult.citizen });
    response.cookies.set(
      SESSION_COOKIE_NAME,
      session.token,
      getSessionCookieOptions(session.expiresAt)
    );

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: "No se pudo iniciar sesión." },
      { status: 500 }
    );
  }
}
