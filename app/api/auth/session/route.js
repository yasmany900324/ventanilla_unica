import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/auth";

export async function GET(request) {
  try {
    const authenticatedUser = await requireAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json(
        { user: null },
        {
          status: 401,
          headers: { "Cache-Control": "no-store, must-revalidate" },
        }
      );
    }

    return NextResponse.json(
      { user: authenticatedUser },
      { headers: { "Cache-Control": "no-store, must-revalidate" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "No se pudo obtener la sesion actual." },
      {
        status: 500,
        headers: { "Cache-Control": "no-store, must-revalidate" },
      }
    );
  }
}
