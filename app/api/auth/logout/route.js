import { NextResponse } from "next/server";
import { destroySessionByToken, SESSION_COOKIE_NAME } from "../../../../lib/auth";

export async function POST(request) {
  try {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    await destroySessionByToken(token);

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: "No se pudo cerrar sesion." }, { status: 500 });
  }
}
