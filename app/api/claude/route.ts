import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("=== API CLAUDE ===");
    console.log("Body recibido:", JSON.stringify(body).slice(0, 300));
    console.log("API KEY presente:", !!process.env.ANTHROPIC_API_KEY);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log("Anthropic status:", response.status);
    console.log("Anthropic response:", JSON.stringify(data).slice(0, 300));

    if (!response.ok) {
      console.error("Anthropic error:", response.status, JSON.stringify(data));
      return NextResponse.json(
        { error: data.error?.message ?? "API error", detail: data },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Anthropic route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}