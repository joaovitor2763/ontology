import {
  artifactFromItem,
  googleMeetCode,
  pickConferenceRecord,
  transcriptText,
  type MeetArtifact,
  type MeetArtifacts,
  type MeetParticipant,
} from "../modules/engagement/application/google-meet.ts";

/**
 * Google Agenda and Meet, per member: each person connects their own Google
 * account (authorization code + PKCE). Meetings are created on that person's
 * primary calendar with a Meet link and invitations; after the meeting, the
 * recording and the transcript come through the Meet REST API. The refresh
 * token is stored sealed (AES-GCM with GOOGLE_TOKEN_KEY) in D1; access tokens
 * are minted on demand and never stored.
 */
export type GoogleEnv = {
  GOOGLE_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_TOKEN_KEY?: string;
};

export const MEET_SETTINGS_SCOPE = "https://www.googleapis.com/auth/meetings.space.settings";

export const GOOGLE_SCOPES = [
  MEET_SETTINGS_SCOPE,
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/meetings.space.readonly",
];

export function googleConfigured(env: GoogleEnv) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_KEY);
}
export function googleEnabled(env: GoogleEnv) {
  return env.GOOGLE_ENABLED === "true" && googleConfigured(env);
}

export type GoogleConnection = {
  workspace_id: string;
  user_email: string;
  account_email: string;
  calendar_id: string;
  scopes: string;
  refresh_token_enc: string;
  status: string;
  last_error: string | null;
  updated_at: string;
};

/* ---------- sealing ---------- */

const enc = new TextEncoder();
const dec = new TextDecoder();
function toB64(bytes: Uint8Array) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
function fromB64(text: string) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
function toB64url(bytes: Uint8Array) {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function keyFrom(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(secret: string, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(secret);
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text)),
  );
  const out = new Uint8Array(iv.length + body.length);
  out.set(iv);
  out.set(body, iv.length);
  return toB64(out);
}
export async function unseal(secret: string, sealed: string) {
  const bytes = fromB64(sealed);
  const key = await keyFrom(secret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    key,
    bytes.slice(12),
  );
  return dec.decode(plain);
}
async function sha256b64url(text: string) {
  return toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}
function randomB64url(bytes: number) {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/* ---------- storage ---------- */

export async function getConnection(db: D1Database, workspace: string, userEmail: string) {
  return db
    .prepare("SELECT * FROM google_connections WHERE workspace_id = ? AND user_email = ?")
    .bind(workspace, userEmail.toLowerCase())
    .first<GoogleConnection>();
}
export async function deleteConnection(db: D1Database, workspace: string, userEmail: string) {
  await db
    .prepare("DELETE FROM google_connections WHERE workspace_id = ? AND user_email = ?")
    .bind(workspace, userEmail.toLowerCase())
    .run();
}
async function markConnection(
  db: D1Database,
  workspace: string,
  userEmail: string,
  status: string,
  error: string | null,
) {
  await db
    .prepare(
      "UPDATE google_connections SET status = ?, last_error = ?, updated_at = ? WHERE workspace_id = ? AND user_email = ?",
    )
    .bind(status, error, new Date().toISOString(), workspace, userEmail.toLowerCase())
    .run();
}

/* ---------- OAuth ---------- */

export async function startOAuth(
  env: GoogleEnv,
  db: D1Database,
  workspace: string,
  userEmail: string,
  redirectUri: string,
) {
  const verifier = randomB64url(48);
  const state = randomB64url(32);
  const now = new Date();
  await db
    .prepare(
      "INSERT INTO google_oauth_states (state_hash, workspace_id, user_email, verifier_enc, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      await sha256b64url(state),
      workspace,
      userEmail.toLowerCase(),
      await seal(env.GOOGLE_TOKEN_KEY!, verifier),
      now.toISOString(),
      new Date(now.getTime() + 10 * 60_000).toISOString(),
    )
    .run();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("login_hint", userEmail);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await sha256b64url(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function finishOAuth(
  env: GoogleEnv,
  db: D1Database,
  workspace: string,
  input: { code: string; state: string },
  redirectUri: string,
): Promise<{ ok: true; accountEmail: string } | { ok: false; reason: string }> {
  const stateHash = await sha256b64url(input.state);
  const row = await db
    .prepare("SELECT * FROM google_oauth_states WHERE state_hash = ?")
    .bind(stateHash)
    .first<{ workspace_id: string; user_email: string; verifier_enc: string; expires_at: string }>();
  await db.prepare("DELETE FROM google_oauth_states WHERE state_hash = ? OR expires_at < ?")
    .bind(stateHash, new Date().toISOString())
    .run();
  if (!row || row.workspace_id !== workspace) return { ok: false, reason: "estado" };
  if (row.expires_at < new Date().toISOString()) return { ok: false, reason: "expirado" };
  const verifier = await unseal(env.GOOGLE_TOKEN_KEY!, row.verifier_enc);
  const token = (await (
    await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        code: input.code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    })
  ).json()) as TokenResponse;
  if (!token.access_token) return { ok: false, reason: token.error ?? "token" };
  if (!token.refresh_token) return { ok: false, reason: "sem_refresh" };
  const me = (await (
    await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    })
  ).json()) as { email?: string };
  const accountEmail = (me.email ?? "").toLowerCase();
  if (!accountEmail || accountEmail !== row.user_email.toLowerCase())
    return { ok: false, reason: "identidade" };
  const primary = (await (
    await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", {
      headers: { authorization: `Bearer ${token.access_token}` },
    })
  ).json()) as { accessRole?: string; id?: string };
  if (!["owner", "writer"].includes(primary.accessRole ?? ""))
    return { ok: false, reason: "agenda" };
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO google_connections (workspace_id, user_email, account_email, calendar_id, scopes, refresh_token_enc, status, last_error, created_at, updated_at)
       VALUES (?, ?, ?, 'primary', ?, ?, 'connected', NULL, ?, ?)
       ON CONFLICT(workspace_id, user_email) DO UPDATE SET account_email = excluded.account_email, scopes = excluded.scopes, refresh_token_enc = excluded.refresh_token_enc, status = 'connected', last_error = NULL, updated_at = excluded.updated_at`,
    )
    .bind(
      workspace,
      row.user_email,
      accountEmail,
      token.scope ?? GOOGLE_SCOPES.join(" "),
      await seal(env.GOOGLE_TOKEN_KEY!, token.refresh_token),
      now,
      now,
    )
    .run();
  return { ok: true, accountEmail };
}

export async function revokeConnection(env: GoogleEnv, db: D1Database, workspace: string, userEmail: string) {
  const connection = await getConnection(db, workspace, userEmail);
  if (connection) {
    try {
      const refresh = await unseal(env.GOOGLE_TOKEN_KEY!, connection.refresh_token_enc);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh }),
      });
    } catch {
      /* best effort */
    }
  }
  await deleteConnection(db, workspace, userEmail);
}

export class GoogleError extends Error {
  status: number;
  constructor(
    message: string,
    status: number,
  ) {
    super(message);
    this.status = status;
  }
}

/** Mints an access token from the sealed refresh token; never stored. */
export async function accessTokenFor(env: GoogleEnv, db: D1Database, workspace: string, userEmail: string) {
  const connection = await getConnection(db, workspace, userEmail);
  if (!connection) throw new GoogleError("Conecte sua conta Google no seu perfil.", 409);
  const refresh = await unseal(env.GOOGLE_TOKEN_KEY!, connection.refresh_token_enc);
  const token = (await (
    await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }),
    })
  ).json()) as TokenResponse;
  if (!token.access_token) {
    const status = token.error === "invalid_grant" ? "expired" : "error";
    await markConnection(db, workspace, userEmail, status, token.error ?? "sem token");
    throw new GoogleError(
      status === "expired"
        ? "A conexão com o Google expirou. Conecte de novo em Configurações."
        : "O Google recusou a conexão. Confira as credenciais.",
      409,
    );
  }
  return { token: token.access_token, connection };
}

async function googleJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string; status?: string };
  };
  if (!response.ok)
    throw new GoogleError(
      body.error?.message ?? `O Google respondeu ${response.status}.`,
      response.status === 403 ? 403 : 502,
    );
  return body;
}

/* ---------- calendar ---------- */

export type CreateEventInput = {
  requestId: string;
  /** Caller-derived SHA-256 ID for durable scheduling operations. */
  eventId?: string;
  title: string;
  description: string;
  location?: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  attendees: string[];
  withMeet: boolean;
};

export async function createCalendarEvent(
  env: GoogleEnv,
  db: D1Database,
  workspace: string,
  userEmail: string,
  input: CreateEventInput,
) {
  const { token, connection } = await accessTokenFor(env, db, workspace, userEmail);
  if (connection.account_email.toLowerCase() !== userEmail.toLowerCase())
    throw new GoogleError("Conecte a sua própria conta Google no perfil para organizar a reunião.", 409);
  const calendar = "primary";
  const base = `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`;
  const eventId = input.eventId ?? (input.requestId.replace(/[^a-v0-9]/gi, "").toLowerCase().slice(0, 64) || undefined);
  type Event = {
    id?: string;
    etag?: string;
    htmlLink?: string;
    hangoutLink?: string;
    organizer?: { email?: string };
    conferenceData?: {
      createRequest?: { status?: { statusCode?: string } };
      entryPoints?: { entryPointType?: string; uri?: string }[];
    };
  };
  const body = {
    id: eventId,
    summary: input.title,
    description: input.description,
    location: input.location,
    start: { dateTime: input.startsAt, timeZone: input.timeZone },
    end: { dateTime: input.endsAt, timeZone: input.timeZone },
    attendees: input.attendees.map((email) => ({ email })),
    ...(input.withMeet
      ? {
          conferenceData: {
            createRequest: {
              requestId: input.requestId,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }
      : {}),
    extendedProperties: { private: { ontologyRequestId: input.requestId } },
  };
  let event: Event;
  try {
    event = await googleJson<Event>(`${base}?conferenceDataVersion=1&sendUpdates=all`, token, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    // Same id already created (retry): read it instead of failing.
    if (error instanceof GoogleError && eventId && /exist|duplicate|409/i.test(error.message))
      event = await googleJson<Event>(`${base}/${eventId}?conferenceDataVersion=1`, token);
    else throw error;
  }
  const meetUrl = (e: Event) =>
    e.hangoutLink ||
    e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ||
    "";
  let status = event.conferenceData?.createRequest?.status?.statusCode ?? (meetUrl(event) ? "success" : "pending");
  for (let attempt = 0; input.withMeet && status === "pending" && attempt < 6; attempt += 1) {
    await new Promise((r) => setTimeout(r, 500));
    event = await googleJson<Event>(`${base}/${event.id}?conferenceDataVersion=1`, token);
    status = event.conferenceData?.createRequest?.status?.statusCode ?? (meetUrl(event) ? "success" : "pending");
  }
  let recordingWarning: string | undefined;
  let autoRecording = false;
  if (input.withMeet) {
    const code = googleMeetCode(meetUrl(event));
    if (!connection.scopes.split(" ").includes(MEET_SETTINGS_SCOPE)) {
      recordingWarning = "Reconecte sua conta Google no perfil para autorizar a gravação automática. Esta reunião foi agendada, mas a gravação ainda precisa ser ativada no Google Agenda.";
    } else if (!code) {
      recordingWarning = "O Google ainda não disponibilizou o Meet. Confira o link e ative a gravação nas opções do evento no Google Agenda.";
    } else {
      try {
        await enableMeetArtifacts(token, code);
        autoRecording = true;
      } catch {
        // The invitation already exists: never report that scheduling failed or create a duplicate.
        recordingWarning = "Reunião agendada, mas o Google não confirmou a gravação automática. Confira as permissões e as opções de gravação do evento no Google Agenda.";
      }
    }
  }
  return {
    etag: event.etag,
    autoRecording,
    recordingWarning,
    calendarId: "primary",
    eventId: event.id ?? eventId ?? "",
    htmlLink: event.htmlLink ?? "",
    meetLink: input.withMeet ? meetUrl(event) : "",
    meetStatus: input.withMeet ? status : "none",
    organizer: event.organizer?.email ?? connection.account_email,
  };
}

/** Only change artifact flags; keep access, moderation and smart notes untouched. */
export async function enableMeetArtifacts(token: string, code: string) {
  const space = await googleJson<{ name: string }>(
    `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(code)}`, token,
  );
  if (!/^spaces\/[A-Za-z0-9_-]+$/.test(space.name)) throw new GoogleError("Espaço do Meet inválido.", 502);
  const mask = "config.artifactConfig.recordingConfig.autoRecordingGeneration,config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration";
  const result = await googleJson<{ config?: { artifactConfig?: {
    recordingConfig?: { autoRecordingGeneration?: string };
    transcriptionConfig?: { autoTranscriptionGeneration?: string };
  } } }>(`https://meet.googleapis.com/v2/${space.name}?updateMask=${mask}`, token, {
    method: "PATCH",
    body: JSON.stringify({ name: space.name, config: { artifactConfig: {
      recordingConfig: { autoRecordingGeneration: "ON" },
      transcriptionConfig: { autoTranscriptionGeneration: "ON" },
    } } }),
  });
  const config = result.config?.artifactConfig;
  if (config?.recordingConfig?.autoRecordingGeneration !== "ON" ||
      config?.transcriptionConfig?.autoTranscriptionGeneration !== "ON")
    throw new GoogleError("O Google não confirmou a gravação e transcrição automáticas.", 502);
}

export async function eventResponses(
  env: GoogleEnv,
  db: D1Database,
  workspace: string,
  userEmail: string,
  input: { calendarId: string; eventId: string },
) {
  const { token } = await accessTokenFor(env, db, workspace, userEmail);
  type Event = {
    etag?: string;
    status?: string;
    attendees?: { email?: string; responseStatus?: string; organizer?: boolean; optional?: boolean }[];
    hangoutLink?: string;
    htmlLink?: string;
  };
  const event = await googleJson<Event>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId || "primary")}/events/${encodeURIComponent(input.eventId)}`,
    token,
  );
  const known = new Set(["accepted", "declined", "tentative", "needsAction"]);
  return {
    etag: event.etag,
    status: event.status ?? "confirmed",
    attendees: (event.attendees ?? [])
      .filter((a) => a.email)
      .map((a) => ({
        email: a.email!.toLowerCase(),
        responseStatus: (known.has(a.responseStatus ?? "") ? a.responseStatus : "needsAction") as
          | "accepted"
          | "declined"
          | "tentative"
          | "needsAction",
        organizer: Boolean(a.organizer),
      })),
    meetLink: event.hangoutLink ?? null,
    htmlLink: event.htmlLink ?? null,
  };
}

/* ---------- Meet artifacts ---------- */

async function pagedList<T>(url: string, token: string, field: string): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const target = new URL(url);
    target.searchParams.set("pageSize", "100");
    if (pageToken) target.searchParams.set("pageToken", pageToken);
    const body = await googleJson<Record<string, unknown>>(target.toString(), token);
    items.push(...((body[field] as T[] | undefined) ?? []));
    pageToken = body.nextPageToken as string | undefined;
    if (!pageToken) break;
  }
  if (pageToken) throw new GoogleError("A transcrição excedeu o limite de leitura. Abra o documento completo no Google Meet.", 502);
  return items;
}

export async function meetArtifacts(
  env: GoogleEnv,
  db: D1Database,
  workspace: string,
  userEmail: string,
  input: { meetLink: string; startsAt: string; includeEarlierSessions?: boolean },
): Promise<{ state: "ready" | "pending" | "not_found"; artifacts?: MeetArtifacts }> {
  const code = googleMeetCode(input.meetLink);
  if (!code) throw new GoogleError("O link do Meet não é válido.", 400);
  const { token } = await accessTokenFor(env, db, workspace, userEmail);
  const start = new Date(input.startsAt).getTime();
  const from = new Date(start - 6 * 3_600_000).toISOString();
  const to = new Date(start + 6 * 3_600_000).toISOString();
  const url = new URL("https://meet.googleapis.com/v2/conferenceRecords");
  url.searchParams.set(
    "filter",
    `space.meeting_code = "${code}" AND start_time >= "${from}" AND start_time <= "${to}"`,
  );
  type Record_ = { name: string; startTime?: string; endTime?: string };
  let records = await pagedList<Record_>(url.toString(), token, "conferenceRecords");
  if (!records.length && input.includeEarlierSessions && start > Date.now()) {
    const since = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    url.searchParams.set("filter", `space.meeting_code = "${code}" AND start_time >= "${since}" AND start_time <= "${new Date().toISOString()}"`);
    records = await pagedList<Record_>(url.toString(), token, "conferenceRecords");
    if (records.length > 1) throw new GoogleError("Há mais de uma sessão antecipada neste link. Ajuste a data da reunião para identificar a transcrição correta.", 409);
  }
  const record = pickConferenceRecord(records, input.startsAt);
  if (!record) return { state: "not_found" };
  if (!record.endTime) return { state: "pending" };
  type Item = Record<string, unknown>;
  const [recordings, transcripts] = await Promise.all([
    pagedList<Item>(`https://meet.googleapis.com/v2/${record.name}/recordings`, token, "recordings"),
    pagedList<Item>(`https://meet.googleapis.com/v2/${record.name}/transcripts`, token, "transcripts"),
  ]);
  const lines: { participant?: string; text?: string; startTime?: string }[] = [];
  for (const transcript of transcripts.every((t) => t.state === "FILE_GENERATED") ? transcripts : []) {
    const name = String(transcript.name ?? "");
    if (!name) continue;
    lines.push(
      ...(await pagedList<{ participant?: string; text?: string; startTime?: string }>(
        `https://meet.googleapis.com/v2/${name}/entries`,
        token,
        "transcriptEntries",
      )),
    );
  }
  const participants = lines.length
    ? await pagedList<MeetParticipant>(`https://meet.googleapis.com/v2/${record.name}/participants`, token, "participants")
    : [];
  const keep = (list: (MeetArtifact | null)[]) => list.filter((x): x is MeetArtifact => x !== null);
  return {
    state: "ready",
    artifacts: {
      conferenceRecord: record.name,
      startedAt: record.startTime,
      endedAt: record.endTime,
      recordings: keep(recordings.map((r) => artifactFromItem(r, "driveDestination"))),
      transcripts: keep(transcripts.map((t) => artifactFromItem(t, "docsDestination"))),
      transcriptText: transcriptText(lines.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "")), 1_000_000, participants),
    },
  };
}

/** Replays read the operation marker before mutating; If-Match rejects external edits. */
export async function changeCalendarEvent(
  env: GoogleEnv, db: D1Database, workspace: string, userEmail: string,
  input: { operationId: string; eventId: string; calendarId: string; expectedEtag?: string; cancel?: boolean; event?: CreateEventInput },
) {
  const { token, connection } = await accessTokenFor(env, db, workspace, userEmail);
  if (connection.account_email.toLowerCase() !== userEmail.toLowerCase())
    throw new GoogleError("Conecte sua própria conta Google para alterar a reunião.", 409);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`;
  type Event = { etag?: string; status?: string; extendedProperties?: { private?: Record<string, string> } };
  const current = await googleJson<Event>(url, token);
  if (current.extendedProperties?.private?.deliveryOperationId === input.operationId || (input.cancel && current.status === "cancelled")) return { etag: current.etag };
  if (!input.expectedEtag) throw new GoogleError("Atualize a reunião com a revisão atual do Google antes de alterar o evento.", 409);
  if (current.etag !== input.expectedEtag) throw new GoogleError("O evento mudou no Google. Reconcilie a reunião antes de reenviar os convites.", 409);
  const event = input.event;
  const patch = {
    ...(input.cancel ? { status: "cancelled" } : {
      summary: event!.title, description: event!.description, location: event!.location ?? "",
      start: { dateTime: event!.startsAt, timeZone: event!.timeZone },
      end: { dateTime: event!.endsAt, timeZone: event!.timeZone },
      attendees: event!.attendees.map(email => ({ email })),
    }),
    extendedProperties: { private: { ...current.extendedProperties?.private, deliveryOperationId: input.operationId } },
  };
  const changed = await googleJson<Event>(`${url}?sendUpdates=all`, token, {
    method: "PATCH", headers: { "if-match": input.expectedEtag }, body: JSON.stringify(patch),
  });
  return { etag: changed.etag };
}
