import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Cabecera HTTP como item de diccionario de Shortcuts. */
function header(key: string, value: string) {
  return `
          <dict>
            <key>WFItemType</key><integer>0</integer>
            <key>WFKey</key>
            <dict>
              <key>Value</key><dict><key>string</key><string>${esc(key)}</string></dict>
              <key>WFSerializationType</key><string>WFTextTokenString</string>
            </dict>
            <key>WFValue</key>
            <dict>
              <key>Value</key><dict><key>string</key><string>${esc(value)}</string></dict>
              <key>WFSerializationType</key><string>WFTextTokenString</string>
            </dict>
          </dict>`;
}

function buildShortcut(endpoint: string, token: string): string {
  const repeatUUID = randomUUID().toUpperCase();
  const group = randomUUID().toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowClientVersion</key><string>1146.14</string>
  <key>WFWorkflowMinimumClientVersion</key><integer>900</integer>
  <key>WFWorkflowMinimumClientVersionString</key><string>900</string>
  <key>WFWorkflowHasShortcutInputVariables</key><true/>
  <key>WFWorkflowImportQuestions</key><array/>
  <key>WFWorkflowTypes</key>
  <array><string>ActionExtension</string></array>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFImageContentItem</string>
    <string>WFAVAssetContentItem</string>
  </array>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconStartColor</key><integer>1440408063</integer>
    <key>WFWorkflowIconGlyphNumber</key><integer>61440</integer>
  </dict>
  <key>WFWorkflowActions</key>
  <array>
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key><string>${repeatUUID}</string>
        <key>GroupingIdentifier</key><string>${group}</string>
        <key>WFControlFlowMode</key><integer>0</integer>
        <key>WFInput</key>
        <dict>
          <key>Value</key><dict><key>Type</key><string>ExtensionInput</string></dict>
          <key>WFSerializationType</key><string>WFTextTokenAttachment</string>
        </dict>
      </dict>
    </dict>
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFURL</key><string>${esc(endpoint)}</string>
        <key>WFHTTPMethod</key><string>POST</string>
        <key>WFHTTPBodyType</key><string>File</string>
        <key>WFRequestVariable</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>Type</key><string>ActionOutput</string>
            <key>OutputUUID</key><string>${repeatUUID}</string>
            <key>OutputName</key><string>Repeat Item</string>
          </dict>
          <key>WFSerializationType</key><string>WFTextTokenAttachment</string>
        </dict>
        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>${header("X-Upload-Token", token)}
            </array>
          </dict>
          <key>WFSerializationType</key><string>WFDictionaryFieldValue</string>
        </dict>
      </dict>
    </dict>
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key><string>${group}</string>
        <key>WFControlFlowMode</key><integer>2</integer>
        <key>UUID</key><string>${randomUUID().toUpperCase()}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

export async function GET() {
  const access = await getAccessToken();
  if (!access) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  // token de subida nuevo (la API nunca devuelve tokens ya creados)
  const r = await fetch(`${API}/v1/tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify({ label: "Atajo iOS" }),
  });
  const data = (await r.json().catch(() => ({}))) as { token?: string };
  if (!data.token) return NextResponse.json({ error: "no se pudo crear el token" }, { status: 502 });

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3001";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const endpoint = `${proto}://${host}/_api/v1/assets`;

  const xml = buildShortcut(endpoint, data.token);
  return new NextResponse(xml, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="Upscale.shortcut"',
      "cache-control": "no-store",
    },
  });
}
