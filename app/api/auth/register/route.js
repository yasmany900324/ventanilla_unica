import { NextResponse } from "next/server";
import {
  createSession,
  getSessionCookieOptions,
  registerCitizen,
  SESSION_COOKIE_NAME,
} from "../../../../lib/auth";

export async function POST(request) {
  try {
    const body = await request.json();
    const registrationResult = await registerCitizen({
      fullName: body?.fullName,
      cedula: body?.cedula,
      email: body?.email,
      password: body?.password,
      confirmPassword: body?.confirmPassword,
    });

    if (!registrationResult.ok) {
      return NextResponse.json(
        { error: registrationResult.error },
        { status: registrationResult.status || 400 }
      );
    }

    const session = await createSession(registrationResult.citizen.id);
    const response = NextResponse.json(
      { user: registrationResult.citizen },
      { status: 201 }
    );
    response.cookies.set(
      SESSION_COOKIE_NAME,
      session.token,
      getSessionCookieOptions(session.expiresAt)
    );

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: "No se pudo completar el registro." },
      { status: 500 }
    );
  }
}
