/**
 * The public API reference, as data.
 *
 * can-api guards everything under `/api/v1` itself, and a handful of those
 * routes are deliberately open: the ATIS endpoints EuroScope and
 * `ATIS for CAN` call with no session, the radar's track lookup, and the
 * desktop clients' update/download path. Those are the ones third parties can
 * build against, so those are the ones documented here. Everything else needs
 * a member's session cookie and is portal plumbing — see `NOT_PUBLIC` at the
 * bottom, which is rendered on the page so "it is not in the list" reads as a
 * decision rather than an omission.
 *
 * ## This file used to live in can-web
 *
 * It documents can-api, it is read by people who are here to register an
 * application, and it is the only page on the main site that had nothing to do
 * with being a member — so it moved to the developer centre with the page that
 * renders it. Two consequences worth knowing before editing:
 *
 * - **`{origin}` is no longer this site's own origin.** On can-web the two
 *   happened to coincide, because the legacy allow-list proxy in
 *   `src/pages/api/[...path].ts` still answers these paths on `ceruleanavi.net`.
 *   Here they do not coincide at all: `platform.ceruleanavi.net/api/v1/atis` is a
 *   404. `withOrigin` therefore takes **two** origins and each endpoint says
 *   which one serves it — see `ApiHost`.
 * - **Nothing addresses the reader as "this site".** The prose below names
 *   can-api, can-web and the radar explicitly, because on a third site every
 *   "here" is ambiguous.
 *
 * Browser-safe on purpose: no handler, no secret, no server import. The rate
 * limits are not written down here either — the page fetches the live table
 * and renders the *enforced* number, so a documented limit cannot drift from
 * the real one.
 *
 * The reference text is English while the surrounding chrome is localised:
 * parameter names, headers and response fields are English on the wire, and
 * four translations of a wire format are four things to keep in step.
 */

/**
 * A key in can-api's rate-limit table.
 *
 * This used to be `keyof typeof LIMITS`, which made it impossible to document
 * a limit that did not exist. The table lives in can-api (Go), so the compiler
 * cannot check it from here — instead the page fetches the live table from
 * `/api/v1/meta/limits` and renders the *enforced* number, so the documented
 * value still cannot drift from the real one. A key that no longer exists
 * shows as "not limited" rather than as a stale number.
 */
export type LimitKey = string;

/**
 * Which origin actually serves an endpoint.
 *
 * Most of this reference is can-api's, and there are two exceptions.
 *
 * The consent screen `/oauth/authorize` is a **page** — it carries the main
 * site's chrome, language and session, so it stayed on can-web when the data
 * layer moved into Go, and can-api's discovery document points
 * `authorization_endpoint` back at it (RFC 8414 permits a different origin).
 *
 * The live datafeed is **can-fsd's**, served by the FSD daemon itself. It is
 * not proxied and never has been: the daemon builds the document from the
 * connections it is holding, so putting can-api in front of it would add a hop
 * to a document that changes every second and own nothing. It is also the one
 * group here that does not use the `{status, data, timestamp}` envelope.
 *
 * Getting this wrong is not cosmetic: printing `api.ceruleanavi.net/oauth/authorize`
 * would send every integrator's first sign-in attempt to a 404, and
 * `api.ceruleanavi.net/v1/data.json` is a 404 for every traffic display.
 */
export type ApiHost = "api" | "web" | "fsd";

export type ApiMethod = "GET" | "HEAD" | "POST";

/** How a caller proves who they are. */
export type ApiAuth =
  | "none"
  /** CAN ID + network password in the body — what the desktop clients hold. */
  | "credentials"
  /** An OAuth access token in `Authorization: Bearer`. */
  | "oauth"
  /** `client_id` (+ `client_secret` for confidential clients). */
  | "oauthClient"
  /** A page the member opens while signed in here. */
  | "browser";

export interface ApiParam {
  name: string;
  /** Free-form, e.g. `string`, `integer`, `ICAO`. */
  type: string;
  required?: boolean;
  description: string;
}

export interface ApiStatus {
  code: number;
  /** When this status is returned, and what the body says. */
  when: string;
}

export interface ApiEndpoint {
  /** Anchor and TOC key. */
  id: string;
  /** `GET`, or `GET` + `HEAD` where both are implemented. */
  methods: ApiMethod[];
  /** Path template; `{client}` marks a path parameter. */
  path: string;
  /** Which origin serves it. Absent means can-api, which is nearly all of them. */
  host?: ApiHost;
  summary: string;
  /** Prose, one string per paragraph. */
  body: string[];
  auth: ApiAuth;
  /**
   * The OAuth scopes a token must carry, when `auth` is `oauth`.
   *
   * Separate from `auth` because "a Bearer token" and "a Bearer token carrying
   * `flights:read`" are different requirements and the second one is what
   * actually returns 403. can-api's default is that a route accepts **no**
   * token at all — every scope-reachable route is an explicit exception, so
   * listing the scope is also how a reader can tell that a route is reachable
   * by an application at all rather than only by a member in a browser.
   */
  scopes?: string[];
  /** True when the route sends `Access-Control-Allow-Origin: *`. */
  cors: boolean;
  /**
   * Which bucket in `LIMITS` this endpoint counts against.
   *
   * Optional, and the absence is a fact about the route rather than a gap in
   * the docs: the two OIDC discovery documents are static, cacheable and
   * fetched once per client at startup, so they are served without a counter.
   * The page prints "not limited" for those rather than leaving the field
   * blank, so a reader can tell the difference.
   */
  limit?: LimitKey;
  /** What the bucket is keyed by, e.g. "per IP". */
  limitScope: string;
  path_params?: ApiParam[];
  query?: ApiParam[];
  /** Request body fields (POST). */
  fields?: ApiParam[];
  /** Request headers worth knowing about. */
  headers?: ApiParam[];
  statuses: ApiStatus[];
  /** `{origin}` in either string is replaced with the site's own base URL. */
  example?: { request: string; response?: string };
  notes?: string[];
}

export interface ApiGroup {
  key: string;
  name: string;
  description: string;
  /** Key in `ICON_PATHS`. */
  icon: string;
  endpoints: ApiEndpoint[];
}

/* ------------------------------------------------------------------ *
 * ATIS
 * ------------------------------------------------------------------ */

const ATIS: ApiEndpoint = {
  id: "atis",
  methods: ["GET"],
  path: "/api/v1/atis",
  summary: "Turn a METAR into a line of spoken ATIS text.",
  body: [
    'This is the URL a controller pastes into EuroScope\'s "ATIS maker URL" field. EuroScope substitutes its own macros into the query string, GETs it, and speaks or displays the plain text that comes back. Build the URL on https://ceruleanavi.net/controllers/atis rather than by hand.',
    "It is a formatter, not a weather service: give it a METAR and it gives you the ATIS. `icao` alone also works — the METAR is then fetched for you — which makes the same URL usable from a script that has no weather source of its own.",
  ],
  auth: "none",
  cors: true,
  limit: "atis",
  limitScope: "per IP",
  query: [
    {
      name: "metar",
      type: "string",
      description:
        "Raw METAR to format. EuroScope passes `$metar($atisairportA)` here. Required unless `icao` is given.",
    },
    {
      name: "icao",
      type: "ICAO",
      description:
        "Four letters. Names the station in the text, and — when `metar` is absent — the report is fetched for it.",
    },
    {
      name: "info",
      type: "string",
      description: "Information letter, e.g. `A`.",
    },
    {
      name: "arr",
      type: "string",
      description: "Arrival runways, comma-separated: `19,18R`.",
    },
    {
      name: "dep",
      type: "string",
      description: "Departure runways, comma-separated: `18L,18R`.",
    },
    {
      name: "apptype",
      type: "string",
      description: "Approach in use, e.g. `ILS`.",
    },
    { name: "tl", type: "string", description: "Transition level." },
    {
      name: "remarks",
      type: "string",
      description: "Extra text, appended as given.",
    },
    {
      name: "format",
      type: "string",
      description:
        "`multiline` returns one element per line. Anything else (the default) joins them with full stops.",
    },
  ],
  statuses: [
    { code: 200, when: "The ATIS, as `text/plain; charset=utf-8`." },
    { code: 400, when: "Neither a `metar` nor a valid `icao` was given." },
    {
      code: 429,
      when: "Rate limited. Plain text, not JSON — see the note below.",
    },
    { code: 502, when: "No METAR could be fetched for that station." },
  ],
  example: {
    request:
      "curl '{origin}/api/v1/atis?icao=ZBAA&info=A&arr=19,18R&dep=18L&apptype=ILS'",
    response:
      "ZBAA INFORMATION ALPHA 1730Z. ARR RWY 19, 18R, DEP RWY 18L. EXPECT ILS APPROACH. WIND 300 DEGREES 2 METRES PER SECOND, VARIABLE BETWEEN 260 AND 330 DEGREES. CAVOK. TEMPERATURE 28, DEWPOINT 22. QNH 1001. ADVISE ON INITIAL CONTACT YOU HAVE INFORMATION ALPHA",
  },
  notes: [
    "The default is **one line**. EuroScope reads the response only up to the first newline, so a `\\n`-joined ATIS would arrive as nothing but the header; the full stops give the voice engine its pauses instead. Use `format=multiline` when a human is reading it.",
    "This route answers a 429 in plain text like every other response it sends, rather than in the JSON envelope the rest of the API uses. EuroScope has no JSON parser.",
    "Nothing here touches the database or a session — it reads public weather and echoes formatted text.",
  ],
};

const ATIS_CONFIG: ApiEndpoint = {
  id: "atis-config",
  methods: ["GET"],
  path: "/api/v1/atis/config",
  summary: "The network's ATIS stations, frequencies and runway presets.",
  body: [
    "`ATIS for CAN` downloads this from its \"update configuration from network\" button and merges the stations into the operator's local profile, so a change to an airport's wording reaches every controller instead of being re-typed at each one.",
    "The keys are `snake_case` because this document is **the desktop client's own schema** — each entry is handed straight to its `Station.from_dict`. A new key is ignored safely by older clients; a renamed one is silent data loss, so treat the field names as a wire contract.",
  ],
  auth: "none",
  cors: true,
  limit: "atisConfig",
  limitScope: "per IP",
  headers: [
    {
      name: "If-None-Match",
      type: "string",
      description:
        "The `version` you already hold, quoted. Answered with a bare 304 when it is still current.",
    },
  ],
  statuses: [
    { code: 200, when: "The configuration document, with an `ETag`." },
    {
      code: 304,
      when: "`If-None-Match` matched the current version. No body.",
    },
    { code: 429, when: "Rate limited." },
    {
      code: 500,
      when: "The published file failed validation. The body carries `problems[]` naming each reason.",
    },
  ],
  example: {
    request: "curl -i '{origin}/api/v1/atis/config'",
    response: `{
  "version": "7b946fdec3cf",
  "updated": "2026-07-31",
  "notes": "...",
  "stations": [
    {
      "identifier": "ZBAA",
      "name": "Beijing Capital International Airport",
      "chinese_name": "北京首都国际机场",
      "frequency": "127.000",
      "atis_type": "combined",
      "voice_language": "both",
      "code_range": ["A", "Z"],
      "latitude": 40.07407,
      "longitude": 116.5908,
      "chinese_runway": "",
      "contractions": {},
      "presets": [
        {
          "name": "南向",
          "template": "[FACILITY] information [ATIS_LETTER], [OBS_TIME]. ...",
          "airport_conditions": "ARR RWY 19, 18R, DEP RWY 18L, 18R.",
          "notams": "...",
          "transition_level": "",
          "chinese_runway": "...",
          "closing": "...",
          "chinese_extra": "..."
        }
      ]
    }
  ]
}`,
  },
  notes: [
    "`version` is a content hash of the document, not a number anybody remembers to bump — any edit is a new version, and a client can compare it to decide whether it is current.",
    "`atis_type` is one of `combined`, `departure`, `arrival`; `voice_language` is one of `en`, `zh`, `both`.",
    "The information letter is deliberately absent: it advances with the weather and belongs to a running session, not to a configuration.",
    "`ETag` is listed in `Access-Control-Expose-Headers`, so a browser fetch can read the value it needs to send back.",
  ],
};

const METAR: ApiEndpoint = {
  id: "metar",
  methods: ["GET"],
  path: "/api/v1/metar",
  summary: "The raw METAR for one station.",
  body: [
    "A bare weather lookup for desktop clients and scripts that want the report text itself rather than the ATIS formatter's rendition of it. Same sources as /api/v1/atis: VATSIM METAR first, NOAA as fallback.",
    '`metar` is `null` rather than an error status when neither source has a report — the caller can then tell "no report for this station" from "the service is down", which a non-2xx would blur.',
  ],
  auth: "none",
  cors: true,
  limit: "metarLookup",
  limitScope: "per IP",
  query: [
    {
      name: "icao",
      type: "ICAO",
      required: true,
      description: "Four letters, e.g. `ZSPD`.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: '`{"icao": "ZSPD", "metar": "ZSPD ..."}` — or `metar: null` when no source has a report.',
    },
    { code: 400, when: "`icao` is missing or not four letters." },
    { code: 429, when: "Rate limited." },
  ],
  example: {
    request: "curl '{origin}/api/v1/metar?icao=ZSPD'",
    response: `{
  "icao": "ZSPD",
  "metar": "ZSPD 071300Z 13004MPS 9999 SCT015 BKN020 24/22 Q1014 NOSIG"
}`,
  },
};

/* ------------------------------------------------------------------ *
 * Flight data
 * ------------------------------------------------------------------ */

const TRACK: ApiEndpoint = {
  id: "track",
  methods: ["GET"],
  path: "/api/v1/track",
  summary: "The flown track of one aircraft.",
  body: [
    "Sampled positions written by the FSD server as a pilot flies, read back for the radar to draw. The window is the pilot's **current** session — the track starts at the logon time of their open flight record, so a reconnect starts a fresh line instead of drawing a straight jump from wherever the last flight ended. With no open session it falls back to the last three hours, which keeps a just-landed aircraft on screen.",
  ],
  auth: "none",
  cors: true,
  limit: "track",
  limitScope: "per IP",
  query: [
    {
      name: "cid",
      type: "integer",
      required: true,
      description: "The pilot's CAN ID, 1–10 digits.",
    },
    {
      name: "limit",
      type: "integer",
      description:
        "How many points to return, 1–2000 (default 600). The **oldest** points are dropped first, so a long flight keeps its recent shape.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: "The track. `points` is empty when nothing was recorded.",
    },
    {
      code: 400,
      when: '`cid` is missing or not 1–10 digits — `{ "error": "invalidCid" }`.',
    },
    { code: 429, when: 'Rate limited — `{ "error": "tooManyRequests" }`.' },
  ],
  example: {
    request: "curl '{origin}/api/v1/track?cid=1234&limit=200'",
    response: `{
  "status": 200,
  "data": {
    "cid": "1234",
    "callsign": "CCA1501",
    "since": "2026-08-01T09:14:22.000Z",
    "points": [
      [40.0741, 116.5908, 112, 1785574462000],
      [40.0812, 116.6033, 1450, 1785574492000]
    ]
  },
  "timestamp": "2026-08-01T10:31:02.884Z"
}`,
  },
  notes: [
    "A point is `[latitude, longitude, altitude in feet, unix milliseconds]`, oldest first.",
    "Positions at exactly 0/0 are excluded: a simulator that has not finished initialising reports them, and one such row drags the drawn track out to the Gulf of Guinea and back.",
    "The 400 and 429 bodies carry a short `error` **key**, not a sentence — they are translated by the caller, not by us.",
  ],
};

/* ------------------------------------------------------------------ *
 * Desktop clients
 * ------------------------------------------------------------------ */

const CLIENTS_LATEST: ApiEndpoint = {
  id: "clients-latest",
  methods: ["GET"],
  path: "/api/v1/clients/latest",
  summary: "Is there a newer version of a desktop client?",
  body: [
    "Without parameters this describes the newest release: its version, when it was published, where the notes are, and one entry per package with its size and a download link.",
    'With `client` and `version` it answers the question directly, so all four clients agree on what "newer" means rather than each writing its own comparison. Versions are compared numerically field by field, a leading `v` is ignored and anything after the numbers (`-rc1`, `+dirty`) is too — as strings, `2.0.10` sorts before `2.0.9` and the check either nags forever or never fires.',
    "What to do about an update is the client's business. The design is *tell the user, let them choose* — never a silent self-update.",
  ],
  auth: "none",
  cors: true,
  limit: "clientUpdate",
  limitScope: "per IP",
  query: [
    {
      name: "client",
      type: "string",
      description:
        "One of `audio-for-can`, `atis-for-can`, `msfs-for-can`, `xpc-for-can`. Adds `client` and `update_available` to the answer.",
    },
    {
      name: "version",
      type: "string",
      description:
        "The version you are running, e.g. `2.0.1`. Without it `update_available` is `true` whenever the package exists.",
    },
  ],
  statuses: [
    { code: 200, when: "The release document." },
    { code: 400, when: "`client` is not one of the four names." },
    { code: 429, when: "Rate limited." },
    {
      code: 503,
      when: 'The release feed could not be reached. No version is invented — a client told "you are up to date" wrongly stops asking.',
    },
  ],
  example: {
    request:
      "curl '{origin}/api/v1/clients/latest?client=atis-for-can&version=2.0.0'",
    response: `{
  "status": 200,
  "timestamp": "2026-08-01T10:31:02.884Z",
  "version": "v2.0.3",
  "published_at": "2026-07-31T08:35:28Z",
  "notes": "https://github.com/JianyueLab-Org/airwaysn_audio/releases/tag/v2.0.3",
  "clients": {
    "audio-for-can": { "name": "audio-for-can", "version": "v2.0.3", "size": 64583682, "download": "…", "origin": "…" },
    "atis-for-can": {
      "name": "atis-for-can",
      "version": "v2.0.3",
      "size": 58094371,
      "download": "{origin}/api/v1/clients/download/atis-for-can?v=v2.0.3",
      "origin": "https://github.com/JianyueLab-Org/airwaysn_audio/releases/download/v2.0.3/atis-for-can-v2.0.3.zip"
    }
  },
  "client": { "name": "atis-for-can", "version": "v2.0.3", "size": 58094371, "download": "…", "origin": "…" },
  "update_available": true
}`,
  },
  notes: [
    "`download` points at our own relay; `origin` is the GitHub asset, for anyone who can reach it. Prefer `download`.",
    'A package missing from a release (one of the four builds failed) is simply absent from `clients`, and asking about it answers `update_available: false` with a `reason` — "no update" is the honest answer when there is nothing to hand out.',
    "Cached for 5 minutes at the edge, so a release reaches members within minutes without every client startup reaching GitHub.",
  ],
};

const CLIENTS_DOWNLOAD: ApiEndpoint = {
  id: "clients-download",
  methods: ["GET", "HEAD"],
  path: "/api/v1/clients/download/{client}",
  summary: "Download a client through us instead of from GitHub.",
  body: [
    "`github.com` and `objects.githubusercontent.com` are unreliable from the mainland — a 60 MB release asset routinely crawls or stops halfway — so the bytes are relayed through this origin, which members can already reach. This is the link `/api/v1/clients/latest` hands out and the one the download centre uses.",
    "It is **not an open proxy**: the upstream URL only ever comes out of the resolved release for one fixed repository, keyed by a four-entry whitelist, and nothing the caller sends is used to build it.",
  ],
  auth: "none",
  cors: true,
  limit: "clientDownload",
  limitScope: "per IP",
  path_params: [
    {
      name: "client",
      type: "string",
      required: true,
      description:
        "One of `audio-for-can`, `atis-for-can`, `msfs-for-can`, `xpc-for-can`.",
    },
  ],
  query: [
    {
      name: "v",
      type: "string",
      description:
        "Pin the release, e.g. `v2.0.1`. Matching the current release makes the answer immutable and cacheable at the edge; a stale pin is redirected to the current version rather than silently serving different bytes than the URL promised.",
    },
  ],
  headers: [
    {
      name: "Range",
      type: "string",
      description:
        "Forwarded upstream, so a stalled download can be resumed with `bytes=N-`. `If-Range` is forwarded too.",
    },
  ],
  statuses: [
    { code: 200, when: "The asset, streamed as `application/zip`." },
    { code: 206, when: "A range of it, when `Range` was sent." },
    {
      code: 302,
      when: "`v` pinned a release that is no longer current; `Location` carries the current one.",
    },
    {
      code: 404,
      when: "Unknown client name, or that package is not in the latest release.",
    },
    {
      code: 416,
      when: "Mirrored from upstream: the `Range` cannot be served.",
    },
    {
      code: 429,
      when: "Rate limited. This is the tightest bucket here — each miss pulls the whole asset across our bandwidth.",
    },
    {
      code: 501,
      when: "Mirrored from upstream: GitHub answers this to a suffix range like `bytes=-22`.",
    },
    {
      code: 502,
      when: "GitHub could not be reached, or answered something else.",
    },
    {
      code: 503,
      when: "The release feed could not be resolved, so there is no asset to stream.",
    },
  ],
  example: {
    request:
      "curl -L -O -J '{origin}/api/v1/clients/download/atis-for-can?v=v2.0.1'\ncurl -I '{origin}/api/v1/clients/download/atis-for-can'",
  },
  notes: [
    "`HEAD` exists so a client can check size and version without pulling 60 MB. `X-Client-Version` carries the release on every answer.",
    '416 and 501 are mirrored rather than flattened to 502 on purpose: they are about the request, and calling them "GitHub is down" sends whoever is debugging to the wrong end.',
    "The body is streamed, never buffered, so a slow download costs no memory here either.",
  ],
};

const LOGS: ApiEndpoint = {
  id: "logs",
  methods: ["POST"],
  path: "/api/v1/logs",
  summary: "Send a client log to the maintainer.",
  body: [
    'Diagnosing "it won\'t connect" means reading `audio-for-can.log`, `atis-for-can.log` or `xpc.log`, which otherwise means asking the member to find the file and get it over chat. This is that step automated: the log lands in an inbox with who sent it, which client, which version and what they were doing.',
    "**Nothing is stored.** No table, no file on disk — the mail is the record, which keeps a log of somebody's session out of the database.",
  ],
  auth: "credentials",
  cors: false,
  limit: "logUpload",
  limitScope:
    "per member (plus a wider per-IP bucket, checked before the body is read)",
  fields: [
    { name: "cid", type: "string", required: true, description: "CAN ID." },
    {
      name: "password",
      type: "string",
      required: true,
      description:
        "Network password — the same one the client connects to FSD with.",
    },
    {
      name: "log",
      type: "file",
      description: "The log file. `multipart/form-data` only.",
    },
    {
      name: "text",
      type: "string",
      description:
        "The log inline, as a string. `application/json` only. One of `log`/`text` is required.",
    },
    {
      name: "component",
      type: "string",
      description:
        "Which client: `atis`, `controller`, `xpc`, `msfs`… Used in the subject line.",
    },
    { name: "version", type: "string", description: "Client version string." },
    {
      name: "note",
      type: "string",
      description:
        "What the member was doing when it broke. The most useful field on the form.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: "Sent. The body reports `bytes` received and whether it was `truncated`.",
    },
    {
      code: 400,
      when: "Missing `cid`/`password`, an empty log, or a body that could not be read.",
    },
    {
      code: 401,
      when: "CAN ID or password is wrong. One message for both cases, deliberately.",
    },
    {
      code: 413,
      when: "Over 8 MB. The stream is counted, so this does not depend on `Content-Length`.",
    },
    {
      code: 429,
      when: "Rate limited — per IP, per member, and per member for failed sign-ins.",
    },
    { code: 500, when: "The credentials could not be checked." },
    {
      code: 502,
      when: "The mail could not be sent. Nothing was kept, so retry.",
    },
  ],
  example: {
    request: `curl -X POST '{origin}/api/v1/logs' \\
  -F cid=1234 -F password=... \\
  -F component=atis -F version=2.0.1 \\
  -F 'note=Connects, then no audio on transmit' \\
  -F log=@atis-for-can.log

curl -X POST '{origin}/api/v1/logs' \\
  -H 'Content-Type: application/json' \\
  -d '{"cid":"1234","password":"...","component":"atis","text":"<log>"}'`,
    response: `{
  "status": 200,
  "timestamp": "2026-08-01T10:31:02.884Z",
  "success": true,
  "bytes": 428113,
  "truncated": false,
  "message": "Log received. Thank you."
}`,
  },
  notes: [
    "Two body shapes on purpose: `multipart/form-data` for a browser or `curl -F`, and `application/json` with the log inline for the Python clients, which use nothing but stdlib `urllib` — hand-rolling multipart there is twenty lines of boundary bookkeeping.",
    "Past 1 MB the **tail** is kept, because the failure is the last thing that happened and the first 200 KB is startup noise.",
    "It authenticates not because a log is secret but because an unauthenticated endpoint that mails a fixed human address is a mail bomb with a rate limit in front of it. `rating` is not checked — an unrated member with a broken client is exactly who needs to send one.",
  ],
};

/* ------------------------------------------------------------------ *
 * 统一登录 (OAuth 2.1 / OIDC)
 *
 * These are the endpoints a third party actually builds against, so they are
 * documented in full even though the discovery document already describes
 * them: a client library reads the discovery document, but the person writing
 * the integration reads this.
 * ------------------------------------------------------------------ */

const OIDC_DISCOVERY: ApiEndpoint = {
  id: "oidc-discovery",
  methods: ["GET"],
  path: "/.well-known/openid-configuration",
  summary: "Everything a client library needs to configure itself.",
  body: [
    "Point any OAuth/OIDC library at this URL and it will find the authorization, token, userinfo, revocation and introspection endpoints, the signing algorithm and the scopes this network supports. Nothing below has to be typed in by hand.",
    "The `issuer` here is the exact string that appears as `iss` in an id_token — both come from the same place in the code, so they cannot drift apart.",
  ],
  auth: "none",
  cors: true,
  limitScope: "—",
  statuses: [
    { code: 200, when: "Always. The document is cached for an hour." },
  ],
  example: { request: `curl '{origin}/.well-known/openid-configuration'` },
};

const OIDC_JWKS: ApiEndpoint = {
  id: "oidc-jwks",
  methods: ["GET"],
  path: "/.well-known/jwks.json",
  summary: "Public keys for verifying an id_token.",
  body: [
    "RS256 only. A retired key stays in this document until every id_token signed with it has expired, so verify by `kid` rather than by taking the first key.",
    "You only need this to verify an **id_token**. Access tokens are opaque strings, not JWTs — see the note on `/api/oauth/introspect`.",
  ],
  auth: "none",
  cors: true,
  limitScope: "—",
  statuses: [{ code: 200, when: "Always. Cached for 10 minutes." }],
};

const OAUTH_AUTHORIZE: ApiEndpoint = {
  id: "oauth-authorize",
  methods: ["GET"],
  path: "/oauth/authorize",
  // The one endpoint that is not can-api's. See `ApiHost`.
  host: "web",
  summary: "Send the member here to sign in and approve your app.",
  body: [
    "A page, not an API call: open it in the member's browser (or the system browser, for a native app — never an embedded webview, which hides the address bar the member needs in order to see who they are giving a password to).",
    "**PKCE is required for every client, including confidential ones**, and only `S256` is accepted. That is OAuth 2.1, and it is the only thing still protecting the exchange if the authorization code is intercepted on the way back to you.",
    "Anonymous visitors are sent to the sign-in page and returned here afterwards with every parameter intact. First-party applications skip the consent screen; third-party ones show it once and remember the answer until the member revokes it.",
  ],
  auth: "browser",
  cors: false,
  limit: "oauthAuthorize",
  limitScope: "per IP",
  query: [
    {
      name: "response_type",
      type: "string",
      required: true,
      description: "`code`. Nothing else is supported.",
    },
    {
      name: "client_id",
      type: "string",
      required: true,
      description: "Issued when the application was registered.",
    },
    {
      name: "redirect_uri",
      type: "URL",
      required: true,
      description:
        "Must match a registered URI exactly. The one exception is a loopback address (`http://127.0.0.1/…`), where the port may differ — RFC 8252, for native apps that bind an ephemeral port.",
    },
    {
      name: "scope",
      type: "string",
      required: true,
      description:
        "Space-separated. See the scope list on the consent screen; unknown scopes are dropped.",
    },
    {
      name: "code_challenge",
      type: "string",
      required: true,
      description:
        "Base64url SHA-256 of your `code_verifier`, 43–128 characters.",
    },
    {
      name: "code_challenge_method",
      type: "string",
      required: true,
      description: "`S256`. `plain` is rejected.",
    },
    {
      name: "state",
      type: "string",
      description:
        "Returned unchanged on the redirect back. Use it — it is your CSRF defence, not ours.",
    },
    {
      name: "nonce",
      type: "string",
      description:
        "Returned in the id_token. Bind it to the member's browser session and check it.",
    },
    {
      name: "prompt",
      type: "string",
      description:
        "`none` to fail with `login_required`/`consent_required` instead of showing anything; `consent` to force the screen even if the member has approved before.",
    },
  ],
  statuses: [
    {
      code: 302,
      when: "Back to your `redirect_uri` with `code` and `state`, or with `error` and `error_description`.",
    },
    {
      code: 302,
      when: "To `/signin` when nobody is signed in and `prompt` is not `none`.",
    },
    {
      code: 200,
      when: "The consent screen — or an error page, when `client_id` or `redirect_uri` could not be verified. Those two never redirect: with an unverified callback there is nowhere safe to send the error.",
    },
  ],
  example: {
    request: `{origin}/oauth/authorize
  ?response_type=code
  &client_id=your-app
  &redirect_uri=https://your.app/callback
  &scope=openid%20profile%20email
  &state=<random>
  &code_challenge=<base64url(sha256(verifier))>
  &code_challenge_method=S256`,
  },
  notes: [
    "An unknown `client_id` or an unregistered `redirect_uri` renders an error page rather than redirecting. This is deliberate: redirecting an error to an address we could not verify is how an attacker gets the `state` of a request they did not make.",
  ],
};

const OAUTH_TOKEN: ApiEndpoint = {
  id: "oauth-token",
  methods: ["POST"],
  path: "/api/oauth/token",
  summary:
    "Exchange an authorization code — or a refresh token — for an access token.",
  body: [
    "`application/x-www-form-urlencoded` only. Confidential clients authenticate with HTTP Basic (`client_secret_basic`) or a `client_secret` field; public clients send only `client_id` and rely on PKCE.",
    "**Refresh tokens rotate.** Every refresh returns a new one and invalidates the one you sent, so store what comes back. Presenting an already-rotated refresh token is treated as a leak and revokes the whole grant — both the thief and the real client are logged out, which is the only safe reading when the two are indistinguishable.",
    "A refresh token is only issued when the member granted `offline_access`.",
  ],
  auth: "oauthClient",
  cors: true,
  limit: "oauthToken",
  limitScope: "per client and per IP; failures counted separately, per client",
  fields: [
    {
      name: "grant_type",
      type: "string",
      required: true,
      description: "`authorization_code` or `refresh_token`.",
    },
    {
      name: "code",
      type: "string",
      description:
        "The authorization code. `authorization_code` only; valid for 5 minutes and single-use.",
    },
    {
      name: "redirect_uri",
      type: "URL",
      description:
        "Must be byte-identical to the one in the authorization request. `authorization_code` only.",
    },
    {
      name: "code_verifier",
      type: "string",
      description:
        "The PKCE verifier. `authorization_code` only, and always required.",
    },
    {
      name: "refresh_token",
      type: "string",
      description: "`refresh_token` grant only.",
    },
    {
      name: "scope",
      type: "string",
      description:
        "`refresh_token` only, to narrow the grant. It can never widen it.",
    },
    {
      name: "client_id",
      type: "string",
      description: "Required unless sent via HTTP Basic.",
    },
    {
      name: "client_secret",
      type: "string",
      description: "Confidential clients only; prefer HTTP Basic.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: "`access_token`, `token_type`, `expires_in`, `scope`, plus `refresh_token` and `id_token` when applicable.",
    },
    {
      code: 400,
      when: "`invalid_request`, `invalid_grant` (bad/expired/replayed code, PKCE mismatch), `unsupported_grant_type`.",
    },
    { code: 401, when: "`invalid_client` — client authentication failed." },
    {
      code: 429,
      when: "Rate limited. Failures are counted in their own, much tighter bucket.",
    },
  ],
  example: {
    request: `curl -X POST '{origin}/api/oauth/token' \\
  -u 'your-app:<client_secret>' \\
  -d grant_type=authorization_code \\
  -d code=<code> \\
  -d redirect_uri=https://your.app/callback \\
  -d code_verifier=<verifier>`,
    response: `{
  "access_token": "can_at_...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email",
  "id_token": "eyJhbGciOiJSUzI1NiIs..."
}`,
  },
  notes: [
    "An authorization code presented twice revokes every token issued from it. Retrying a failed exchange with the same code will not work — start the authorization again.",
  ],
};

const OAUTH_USERINFO: ApiEndpoint = {
  id: "oauth-userinfo",
  methods: ["GET", "POST"],
  path: "/api/oauth/userinfo",
  summary: "Who the access token belongs to, right now.",
  body: [
    "What comes back is decided entirely by the scopes on the token, not by anything in the request: a token holding only `openid` gets a `sub` and nothing else.",
    "Standard OIDC claims keep their standard names; everything specific to this network is prefixed `asn_` — `rating` means something else on every other network, and a reader should be able to see whose definition applies.",
    "Prefer this over the id_token when you want current data. The id_token is a snapshot of the moment the member signed in; this is now.",
  ],
  auth: "oauth",
  cors: true,
  limit: "oauthUserinfo",
  limitScope: "per IP",
  headers: [
    {
      name: "Authorization",
      type: "string",
      required: true,
      description: "`Bearer can_at_…`",
    },
  ],
  statuses: [
    { code: 200, when: "The claim set." },
    {
      code: 401,
      when: "Missing, expired, revoked or unknown token. `WWW-Authenticate` says which.",
    },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not hold `openid`.",
    },
  ],
  example: {
    request: `curl '{origin}/api/oauth/userinfo' -H 'Authorization: Bearer can_at_...'`,
    response: `{
  "sub": "1234",
  "name": "Jane Doe",
  "asn_id": "1234",
  "asn_rating": 5,
  "asn_rating_short": "C1",
  "email": "jane@example.com",
  "email_verified": true
}`,
  },
};

const OAUTH_INTROSPECT: ApiEndpoint = {
  id: "oauth-introspect",
  methods: ["POST"],
  path: "/api/oauth/introspect",
  summary: "Ask whether a token is still valid (RFC 7662).",
  body: [
    "Access tokens are **opaque strings, not JWTs**. That is a deliberate trade: you cannot verify one offline, but a member who revokes your app on /pilots/apps stops you the same second rather than an hour later. This endpoint is how a resource server of your own checks one.",
    'A client may only introspect its own tokens. Anything else answers `{"active": false}` — otherwise every registered app could use this to confirm that some string it found is a live token.',
  ],
  auth: "oauthClient",
  cors: true,
  limit: "oauthUserinfo",
  limitScope: "per IP",
  fields: [
    {
      name: "token",
      type: "string",
      required: true,
      description: "The access or refresh token.",
    },
    {
      name: "token_type_hint",
      type: "string",
      description:
        "`access_token` or `refresh_token`. A hint only — both are tried.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: '`{"active": true, …}` or `{"active": false}`. An invalid token is not an error.',
    },
    { code: 401, when: "`invalid_client`." },
  ],
};

const OAUTH_REVOKE: ApiEndpoint = {
  id: "oauth-revoke",
  methods: ["POST"],
  path: "/api/oauth/revoke",
  summary: "Sign the member out of your app (RFC 7009).",
  body: [
    "Pass a refresh token and the whole grant goes — the paired access tokens included. Leaving a still-valid access token behind is not what anyone means by signing out.",
    "Always answers 200, including for a token that is unknown, expired or belongs to someone else. A revocation endpoint that 404s is a way to ask whether a string is a live token.",
  ],
  auth: "oauthClient",
  cors: true,
  limit: "oauthUserinfo",
  limitScope: "per IP",
  fields: [
    {
      name: "token",
      type: "string",
      required: true,
      description: "Access or refresh token.",
    },
    {
      name: "token_type_hint",
      type: "string",
      description: "Accepted and ignored — the type is looked up.",
    },
  ],
  statuses: [
    { code: 200, when: "Done, or there was nothing to do." },
    { code: 401, when: "`invalid_client`." },
  ],
};

/* ------------------------------------------------------------------ *
 * Live network datafeed — can-fsd
 *
 * The one group in this reference that is not can-api's. It is served by the
 * FSD daemon itself, on its own hostname, and it does **not** use the
 * `{status, data, timestamp}` envelope every can-api route wraps its payload
 * in — these documents are the payload. A client that unwraps `data` here gets
 * `undefined`.
 * ------------------------------------------------------------------ */

const DATAFEED: ApiEndpoint = {
  id: "datafeed",
  methods: ["GET"],
  path: "/v1/data.json",
  host: "fsd",
  summary: "Everyone connected to the network right now.",
  body: [
    "One document describing the whole network at this instant: `general` (a summary), `pilots`, `controllers` and `atis`. It is what the live map draws and what every third-party traffic display should read. Built fresh per request — there is no cache and the response carries `Cache-Control: no-store`.",
    "The same document is served at `/api/v1/data/data.json`. That is a byte-identical alias, added so new consumers can stay under one namespace; `/v1/data.json` is the original path and is what the existing clients fetch, so neither is going away.",
    "**A pilot's `latitude`/`longitude` are JSON numbers while a controller's are JSON strings.** That is not a bug and must not be normalised: it is inherited from the Python server this replaced, both readers depend on it, and it is pinned by a golden-file test in can-fsd. Parse a controller's position with `parseFloat`.",
  ],
  auth: "none",
  cors: true,
  limitScope: "—",
  statuses: [
    { code: 200, when: "The feed. Every array is present, possibly empty." },
  ],
  example: {
    request: "curl '{origin}/v1/data.json'",
    response: `{
  "general": {
    "version": "CAN BETA TEST",
    "update": "2026-08-19 10:31:02",
    "update_timestamp": 1787136662,
    "pilots": 2, "atc": 1, "socket": 3, "user": 3
  },
  "pilots": [
    {
      "cid": "1234", "callsign": "CCA1501", "name": "Someone",
      "visual_range": 40, "logon_time": "2026-08-19 09:14:22",
      "send_time": 1787136661.42,
      "latitude": 40.0741, "longitude": 116.5908,
      "altitude": 11200, "groundspeed": 310, "transponder": 2000,
      "heading": 118.4, "pitch": -0.7, "bank": 0.2,
      "vertical_speed": 1800, "ground_track": 119.1,
      "tracked_by": "ZBAA_APP",
      "track": { "owner": "ZBAA_APP", "status": "owned" },
      "flight_plan": {
        "flight_rules": "I", "aircraft": "A320", "cruise_tas": "450",
        "departure": "ZBAA", "depatime": "0900",
        "cruising_altitude": "36000", "arrival": "ZSPD",
        "alternate": "ZSNJ", "remarks": "", "route": "ELKUR A593 SASAN",
        "raw_data": ""
      }
    }
  ],
  "controllers": [
    {
      "cid": "5678", "callsign": "ZBAA_APP", "name": "Someone Else",
      "frequency": "120.500", "facility": 5, "type": 2, "rating": 4,
      "server": "CAN BETA TEST", "visual_range": 150,
      "text_atis": ["ZBAA APPROACH ONLINE"],
      "logon_time": "2026-08-19 08:02:11", "send_time": 1787136659.10,
      "latitude": "40.0801", "longitude": "116.5847"
    }
  ],
  "atis": []
}`,
  },
  notes: [
    "**The contract is one-directional: adding a key is free, renaming or retyping one is not.** can-fsd's `datafeed_test.go` walks a committed golden document and asserts the live feed still carries every key at the same JSON type. That is what let `track`, `vertical_speed` and `ground_track` be added without touching a single reader. When a field genuinely has to change, add the replacement, move the readers, then drop the original.",
    "Position and attitude keys (`latitude`, `longitude`, `altitude`, `groundspeed`, `transponder`, `heading`, `pitch`, `bank`) are **absent** until the pilot's first position packet arrives, rather than present and zero. `vertical_speed` and `ground_track` are derived and appear only once the aircraft has been seen to move.",
    "`text_atis` is always an array — never `null` — even for a controller who has posted nothing.",
    "`general.version` is the **network's name**, taken from can-fsd's config (`\"CAN BETA TEST\"` today), and it is also each controller's `server` field. It is not a protocol or API version, and it is not the FSD banner, which must keep saying `VATSIM FSD` or older EuroScope builds drop the connection.",
    "`general.socket` and `general.user` always report the same number. They were separate counters in the Python server; a connection is only registered once here. The keys stay for compatibility.",
    "`update` and every `logon_time` are `YYYY-MM-DD HH:MM:SS` in **UTC with no zone marker**. Parse them as UTC; the server converts explicitly rather than relying on its own `TZ`.",
    "`tracked_by` is the callsign of the controller holding the radar track, and `track` is the full server-owned state (`owner`, `handoff_peer`, `status` of `owned` / `pending_handoff` / `handoff_accepted`). A client must read these rather than decide locally — two workstations disagreeing about who holds an aircraft is the bug this prevents.",
    "There is no rate limit here, because can-fsd runs no limiter. That is not an invitation: the document is rebuilt on every request. Poll no faster than once a second, and prefer `/v1/events` below, which exists precisely so you do not have to poll at all.",
  ],
};

const DATAFEED_EVENTS: ApiEndpoint = {
  id: "datafeed-events",
  methods: ["GET"],
  path: "/v1/events",
  host: "fsd",
  summary: "The same feed as a live stream — snapshot, then only what changed.",
  body: [
    "Server-Sent Events. On connect you get one `snapshot` event carrying the whole document `/v1/data.json` would have returned; after that, one `update` per second carrying **only** the entries that changed and the callsigns that went away. A network where nothing moved sends nothing.",
    "It is built from the identical `BuildDatafeed` output, diffed — so the stream and `data.json` are one contract and not two, and a field added to one is a field added to both. Also served at `/api/v1/data/events`.",
    "**Treat `snapshot` as the only event that replaces whole state.** In an `update`, each entry under `changed` fully replaces the previous value for that callsign, and each string under `removed` is a callsign that disconnected. Nothing else is implied — there is no ordering guarantee beyond that, and none is needed, because every entry is self-contained per callsign.",
  ],
  auth: "none",
  cors: true,
  limitScope: "—",
  statuses: [
    { code: 200, when: "`text/event-stream`, held open." },
    {
      code: 404,
      when: "An older can-fsd that predates the stream. Fall back to polling `/v1/data.json` — a client should do this automatically rather than fail.",
    },
    {
      code: 500,
      when: "The response writer cannot stream (a proxy that buffers). Rare, and not something a client can retry into working.",
    },
  ],
  example: {
    request: "curl -N '{origin}/v1/events'",
    response: `event: snapshot
data: {"general":{…},"pilots":[…],"controllers":[…],"atis":[]}

event: update
data: {"update":1787136663,"pilots":{"changed":[{"cid":"1234","callsign":"CCA1501",…}]}}

event: update
data: {"update":1787136665,"pilots":{"removed":["CCA1501"]}}

: keepalive`,
  },
  notes: [
    "**A subscriber that falls behind is dropped, not buffered.** The per-connection queue is 16 events deep and a subscriber that has not drained it within a tick is disconnected, so one slow reader cannot stall the broker for everyone. Reconnect and take the fresh `snapshot` as the new truth; do not try to stitch it onto what you had.",
    "A comment line `: keepalive` arrives every 15 seconds. It is not an event — it exists so idle connections survive proxies that time out silent streams.",
    "Empty groups are omitted from an `update` rather than sent as empty arrays, so a quiet network produces a small event. Absent means *nothing changed in that collection*, which is not the same as *that collection is now empty*.",
    "The response carries `X-Accel-Buffering: no` so a reverse proxy does not hold the stream. If you deploy your own proxy in front of a consumer, do the same.",
    "The broker is idle while nobody is watching and rebuilds the feed when the first subscriber connects, so the first `snapshot` is always current rather than whatever the last tick left behind.",
  ],
};

const DATAFEED_STATUS: ApiEndpoint = {
  id: "datafeed-status",
  methods: ["GET"],
  path: "/api/v1/data/status.json",
  host: "fsd",
  summary: "How many clients are connected, and what the network calls itself.",
  body: [
    "Two fields and nothing else: `version` (the network name, the same string `general.version` carries) and `online` (the number of connected clients, pilots and controllers together). For a status badge, a bot, or a health page that wants a number without pulling the whole feed.",
    "Note this is **not** wrapped in the `{status, data, timestamp}` envelope — like everything else can-fsd serves, the object is the payload.",
  ],
  auth: "none",
  cors: true,
  limitScope: "—",
  statuses: [{ code: 200, when: "The counts." }],
  example: {
    request: "curl '{origin}/api/v1/data/status.json'",
    response: `{ "version": "CAN BETA TEST", "online": 3 }`,
  },
  notes: [
    "`online` counts connections, not people: one member connected as a pilot and as an observer is two.",
    "There is no equivalent on the legacy `/v1/…` prefix — this endpoint was added with the namespaced aliases.",
  ],
};

/* ------------------------------------------------------------------ *
 * Member data
 *
 * The routes an application can reach **on a member's behalf**, with an
 * access token carrying the named scope. Everything else under
 * `/api/v1/pilot/*` is cookie-only and is listed at the foot of this page:
 * the default is no token access, and each of these three is an explicit
 * exception made because the data is the member's own and an EFB or a logbook
 * genuinely needs it.
 *
 * The one deliberately never opened is `/api/v1/pilot/data`, which returns the
 * cleartext FSD network password. An app allowed to read a flight log must not
 * thereby be able to connect to the network as that member.
 * ------------------------------------------------------------------ */

const PILOT_FLIGHTS: ApiEndpoint = {
  id: "pilot-flights",
  methods: ["GET"],
  path: "/api/v1/pilot/flights",
  summary: "The member's own flight log, with totals already computed.",
  body: [
    "Every flight session the network recorded for the token's owner, newest first, plus a `summary` block and a `callsigns` rollup. The totals are computed server-side so two clients cannot disagree about what a member's hours are.",
    "Scoped to the token's own member and not addressable by CAN ID — a per-session log is more identifying than the aggregate totals `/api/v1/pilot/{id}` already shares between members.",
  ],
  auth: "oauth",
  scopes: ["flights:read"],
  cors: false,
  limitScope: "—",
  statuses: [
    {
      code: 200,
      when: "The log. `flights` is empty for a member who has never connected.",
    },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `flights:read`.",
    },
  ],
  example: {
    request:
      "curl -H 'Authorization: Bearer can_at_…' '{origin}/api/v1/pilot/flights'",
    response: `{
  "status": 200,
  "data": {
    "flights": [
      {
        "id": 8812, "callsign": "CCA1501",
        "logonTime": "2026-08-19T09:14:22Z", "logoffTime": null,
        "durationMs": 4600000, "formattedDuration": "1:16:40",
        "live": true
      }
    ],
    "summary": {
      "totalFlights": 41, "totalDurationMs": 512400000,
      "formattedTotalTime": "142:20:00",
      "longestDurationMs": 27180000, "formattedLongest": "7:33:00",
      "callsignCount": 9
    },
    "callsigns": [
      { "callsign": "CCA1501", "count": 12, "durationMs": 138000000,
        "formattedDuration": "38:20:00" }
    ]
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "**Durations are milliseconds.** `durationMs` on a closed session comes straight from the column can-fsd writes, which is milliseconds; reading it as seconds renders a two-hour flight as eighty-three days. `formattedDuration` is the same value already rendered, for display.",
    "`live: true` means the session is still open, and its `durationMs` is measured against *now* rather than a logoff time — so it grows between two calls. `logoffTime` is `null` for exactly those rows.",
    "`callsigns` is sorted longest-total first, then by callsign, so equal totals do not reorder between two requests.",
  ],
};

const PILOT_ATC: ApiEndpoint = {
  id: "pilot-atc",
  methods: ["GET"],
  path: "/api/v1/pilot/atc",
  summary: "The member's own controller sessions.",
  body: [
    "The same shape as the flight log, for time spent controlling: `sessions` plus a `summary`. Each session carries the callsign, the position's `facility` and `type` codes, and the rating the member held **at the time** — which is why the rating is on the row rather than only on the account.",
  ],
  auth: "oauth",
  scopes: ["atc:read"],
  cors: false,
  limitScope: "—",
  statuses: [
    {
      code: 200,
      when: "The sessions. Empty for a member who has never controlled.",
    },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `atc:read`.",
    },
  ],
  example: {
    request:
      "curl -H 'Authorization: Bearer can_at_…' '{origin}/api/v1/pilot/atc'",
    response: `{
  "status": 200,
  "data": {
    "sessions": [
      {
        "id": 1204, "callsign": "ZBAA_APP",
        "rating": { "id": 4, "long": "Controller 1", "short": "C1", "zh": "一级管制员" },
        "facility": 5, "type": 2,
        "logonTime": "2026-08-19T08:02:11Z", "logoffTime": "2026-08-19T10:14:03Z",
        "durationMs": 7912000, "formattedDuration": "2:11:52",
        "live": false
      }
    ],
    "summary": {
      "totalSessions": 63, "totalDurationMs": 402000000,
      "formattedTotalTime": "111:40:00"
    }
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "`rating` here is the **expanded object** `{id, long, short, zh}`, not a bare integer. Several fields across this API carry a rating and they are not all the same shape — read `id` and do arithmetic on that, never on the object.",
    "Durations are milliseconds, and `live: true` behaves exactly as it does in the flight log above.",
  ],
};

const PILOT_DIVISIONS: ApiEndpoint = {
  id: "pilot-divisions",
  methods: ["GET"],
  path: "/api/v1/pilot/divisions",
  summary:
    "Which divisions the member belongs to, and what they may still join.",
  body: [
    "A member has one **home** division — where they trained, and which cannot be changed from the member side — and any number of **visiting** ones. They are returned as two separate fields rather than one list with a flag, because they are two different things to a reader.",
    "The response also carries the rules as already-evaluated booleans: `canSetHome`, `canAddVisiting` and `minVisitingRating`. Those come from the same rule the write enforces, so a UI that enables its button from these cannot offer an action that then fails.",
  ],
  auth: "oauth",
  scopes: ["divisions"],
  cors: false,
  limitScope: "—",
  statuses: [
    {
      code: 200,
      when: "The memberships. `home` is `null` for a member who has not joined one.",
    },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `divisions`.",
    },
  ],
  example: {
    request:
      "curl -H 'Authorization: Bearer can_at_…' '{origin}/api/v1/pilot/divisions'",
    response: `{
  "status": 200,
  "data": {
    "rating": 4,
    "home": {
      "id": 91, "region": 1,
      "regionName": { "short": "PRC", "zh": "中国大陆" },
      "del": true, "gnd": true, "twr": true, "app": false, "ctr": false,
      "instructor": false, "director": false, "status": true, "home": true
    },
    "visiting": [],
    "canSetHome": false,
    "canAddVisiting": true,
    "minVisitingRating": 3
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "**Joining is one-way.** Setting a home division succeeds exactly once and there is no leave or remove action anywhere in this API; a transfer goes through an instructor. `canSetHome` is therefore false forever after the first success.",
    "The seat flags (`del`/`gnd`/`twr`/`app`/`ctr`), `instructor`, `director` and `status` are instructor-granted and are read-only here. The member-side write can only ever set the region and the home flag.",
    "`rating` in this payload is the bare integer, unlike the expanded object on `/api/v1/pilot/atc`. Both shapes exist in this API and neither is going to change — check which one you are holding.",
  ],
};

/* ------------------------------------------------------------------ *
 * Network directory
 *
 * Unauthenticated reads that describe the network rather than a member. All
 * four are already public pages' backing data or values a client needs before
 * it can sign in, so none of them carries a session, and all four are safe to
 * cache.
 * ------------------------------------------------------------------ */

const SERVERS: ApiEndpoint = {
  id: "servers",
  methods: ["GET"],
  path: "/api/v1/servers",
  summary: "Where the network's FSD, voice and datafeed servers are.",
  body: [
    "The addresses a client needs in order to connect, grouped by kind: `fsd`, `audio` and `datafeed`. Ask for this instead of compiling a hostname in — that is exactly what this endpoint exists to replace, and a client that reads it turns the network's next move into a row edit rather than a release.",
    "Unauthenticated, and it has to be: a client must learn where FSD is *before* it can sign in, so the order does not reverse. It is also reachable at `https://ceruleanavi.net/api/v1/servers` through the main site's allow-list proxy, which is the hostname to prefer from mainland China.",
  ],
  auth: "none",
  cors: false,
  limitScope: "—",
  statuses: [
    {
      code: 200,
      when: "The directory. Every kind is present as a key, possibly with an empty array.",
    },
  ],
  example: {
    request: "curl '{origin}/api/v1/servers'",
    response: `{
  "status": 200,
  "data": {
    "fsd": [
      { "id": 1, "kind": "fsd", "name": "Tokyo",
        "host": "fsd.ceruleanavi.net", "port": 6809, "location": "JP" }
    ],
    "audio": [
      { "id": 2, "kind": "audio", "name": "Tokyo",
        "host": "audio.ceruleanavi.net", "port": 64738, "location": "JP" }
    ],
    "datafeed": [
      { "id": 3, "kind": "datafeed", "name": "Primary",
        "url": "https://data.ceruleanavi.net" }
    ]
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "**Fields that do not apply to a kind are absent, not `null`.** An `fsd` or `audio` entry has `host` and `port` and no `url`; a `datafeed` entry has `url` and neither. A client reading `port` off a datafeed row has misunderstood the kind, and an absent key says so louder than a null.",
    "**A `datafeed` entry's `url` is an origin, not a path.** The feed publishes two paths under it (`/v1/data.json` and `/v1/events`) and different clients want different ones, so storing a complete URL could only ever satisfy one of them. Append the path you need.",
    'Retired servers are omitted from this list but are not deleted upstream — the row survives so that "where is your client pointed" stays answerable when somebody cannot connect.',
    "Cached for an hour (`Cache-Control: public, max-age=3600`). Respect it; the list changes a few times a year.",
  ],
};

const META_LIMITS: ApiEndpoint = {
  id: "meta-limits",
  methods: ["GET"],
  path: "/api/v1/meta/limits",
  summary: "The rate-limit table this service is actually enforcing.",
  body: [
    "Every bucket in the service, by key, with its `limit` and its `windowMs`. Published so a client can back off correctly instead of finding the edge by trial — these numbers are discoverable by anyone willing to collect a 429 anyway.",
    'This page is drawn from it: every "per hour" figure printed beside an endpoint above is fetched from here at render time rather than written down, so a documented limit cannot drift from the enforced one.',
  ],
  auth: "none",
  cors: true,
  limitScope: "—",
  statuses: [{ code: 200, when: "The table." }],
  example: {
    request: "curl '{origin}/api/v1/meta/limits'",
    response: `{
  "status": 200,
  "data": {
    "limits": {
      "atis":           { "limit": 120, "windowMs": 3600000 },
      "clientDownload": { "limit": 40,  "windowMs": 3600000 },
      "signIn":         { "limit": 10,  "windowMs": 900000 }
    }
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "The keys are lower-camel and are the same keys this page uses. A key vanishing is a limit that no longer exists, not a value of zero — treat a missing key as unlimited, which is what this page renders.",
    "Cached for an hour. The table only changes when can-api is redeployed.",
    "A limit being listed does not say what the bucket is *keyed by* — per IP, per member, per client. That varies per endpoint and is written beside each one above.",
  ],
};

const ROSTER: ApiEndpoint = {
  id: "atc-roster",
  methods: ["GET"],
  path: "/api/v1/atc/roster",
  summary: "The network's controller roster, by division.",
  body: [
    "What `ceruleanavi.net/roster` draws: every member holding a controller position, grouped by numeric region code. Unauthenticated, because the roster is a public page linked from the site header — it used to sit behind a staff guard, which meant a signed-out visitor got a 401 on a page the footer advertised.",
    "It is a **separate handler over a separate query** from the staff roster, not the same one with the guard removed. The staff version's payload also carries every member's email address; keeping them apart is what makes it impossible to publish that by loosening one condition.",
  ],
  auth: "none",
  cors: false,
  limitScope: "—",
  statuses: [
    { code: 200, when: "The roster, keyed by region code as a string." },
  ],
  example: {
    request: "curl '{origin}/api/v1/atc/roster'",
    response: `{
  "status": 200,
  "data": {
    "byRegion": {
      "1": [
        { "id": "1234", "name": "Someone", "rating": 4, "status": true,
          "permission": { "del": true, "gnd": true, "twr": true,
                          "app": false, "ctr": false,
                          "instructor": false, "home": true } }
      ]
    }
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "**Everything absent here is absent on purpose.** This renders for an anonymous caller, so there is no email address, no join date and no account state — adding a field to this shape publishes it to the world.",
    "`status` is the division row's active flag, which is what splits each region into serving and non-serving members. It is **not** an online indicator: this route never sees who is connected. For that, read the datafeed.",
    "Regions with nobody in them are absent rather than present and empty, so the set of keys is the set of divisions with members.",
    "`rating` here is the bare integer.",
  ],
};

const LEADERBOARD: ApiEndpoint = {
  id: "leaderboard",
  methods: ["GET"],
  path: "/api/v1/leaderboard",
  summary:
    "Monthly and all-time rankings for flight time, control time and points.",
  body: [
    "Five boards in one response: monthly flight time, monthly control time, all-time flight time, all-time control time and all-time points. Unauthenticated, like the page it draws.",
    "Ranking is standard competition ranking — equal totals share a rank and the next one skips — and only **finished** sessions are counted, so a board does not change under a reader because somebody is still connected.",
  ],
  auth: "none",
  cors: false,
  limit: "leaderboard",
  limitScope: "per IP",
  query: [
    {
      name: "month",
      type: "YYYY-MM",
      description:
        "Which month the two monthly boards cover. Defaults to the current UTC month. A month that does not parse is a 400 rather than a silent fallback.",
    },
    {
      name: "limit",
      type: "integer",
      description:
        "Rows per board, minimum 1, default 20, silently capped at 100.",
    },
  ],
  statuses: [
    { code: 200, when: "The boards." },
    { code: 400, when: "`invalidMonth` or `invalidLimit`." },
    { code: 429, when: "Rate limited." },
  ],
  example: {
    request: "curl '{origin}/api/v1/leaderboard?month=2026-08&limit=5'",
    response: `{
  "status": 200,
  "data": {
    "month": "2026-08",
    "monthStart": "2026-08-01T00:00:00Z",
    "monthEnd": "2026-09-01T00:00:00Z",
    "limit": 5,
    "generatedAt": "2026-08-19T10:31:02Z",
    "award": { "places": 3, "topPoints": 30, "minimumMs": 3600000 },
    "boards": {
      "monthlyFlight": [
        { "rank": 1, "id": "1234", "name": "Someone", "rating": 4,
          "sessions": 12, "durationMs": 138000000,
          "formattedDuration": "38:20:00", "award": 30 }
      ],
      "monthlyAtc": [],
      "allTimeFlight": [],
      "allTimeAtc": [],
      "allTimePoints": [
        { "rank": 1, "id": "1234", "name": "Someone", "rating": 4, "points": 480 }
      ]
    }
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "`monthStart`/`monthEnd` say which UTC window the monthly boards were actually computed over. A page labelling a month in local time needs this to tell a timezone bug from an empty month.",
    "**Only the monthly boards carry `award` on their rows.** The all-time ones must not — nothing is awarded for an all-time placing, and a client that reads the key uniformly would announce prizes nobody is getting.",
    "The `award` block is the ladder itself (`places`, `topPoints`, `minimumMs`), published so a client can write its footnote from the rule rather than from a translated copy of the numbers.",
    "Cached for five minutes. Five aggregate scans stand behind one request, on a page linked from the site header.",
  ],
};

export const API_GROUPS: ApiGroup[] = [
  {
    key: "oauth",
    name: "Unified sign-in",
    description:
      "Sign a member in with their CAN account, and act for them afterwards. Standard OAuth 2.1 authorization code + PKCE with OpenID Connect on top, so an off-the-shelf client library configured from the discovery document will work without anything bespoke. Applications are registered by hand for now — ask through the feedback form.",
    icon: "key",
    endpoints: [
      OIDC_DISCOVERY,
      OIDC_JWKS,
      OAUTH_AUTHORIZE,
      OAUTH_TOKEN,
      OAUTH_USERINFO,
      OAUTH_INTROSPECT,
      OAUTH_REVOKE,
    ],
  },
  {
    key: "atis",
    name: "ATIS",
    description:
      "The two ATIS endpoints, both called by software with no session to present. Note that a third thing shares the name: `atis[]` in the network datafeed is who is broadcasting right now, which is runtime state and lives with the datafeed, not here.",
    icon: "speakerWave",
    endpoints: [ATIS, ATIS_CONFIG, METAR],
  },
  {
    key: "flight-data",
    name: "Flight data",
    description:
      "What the live map draws. Both are open for the same reason the map is: the positions are already public in the network datafeed, and a track is the same information a few minutes older.",
    icon: "mapPin",
    endpoints: [TRACK],
  },
  {
    key: "datafeed",
    name: "Live network datafeed",
    description:
      "Who is connected right now, served by the FSD daemon on its own hostname (`fsd.ceruleanavi.net`) rather than by can-api. Two faces of one document: fetch `data.json` for a snapshot, or hold `/v1/events` open and receive only what changed. Neither needs a credential, and neither uses the `{status, data, timestamp}` envelope the rest of this page describes — here the document *is* the payload.",
    icon: "signal",
    endpoints: [DATAFEED, DATAFEED_EVENTS, DATAFEED_STATUS],
  },
  {
    key: "member-data",
    name: "Member data",
    description:
      "What an application may read **on a member's behalf** after they sign in through the flow above. Each route names the scope it requires, and a token without it gets 403 rather than an empty result. can-api's default is that no route accepts a token at all — these three are deliberate exceptions, chosen because the data is the member's own and a flight bag or a logbook cannot work without it.",
    icon: "userCircle",
    endpoints: [PILOT_FLIGHTS, PILOT_ATC, PILOT_DIVISIONS],
  },
  {
    key: "network",
    name: "Network directory",
    description:
      "Unauthenticated reads that describe the network rather than a member: where its servers are, what it is enforcing, who its controllers are and who is at the top of the boards. All four back a public page or answer a question a client has to ask before it can sign in, and all four are cacheable — the cache headers say for how long.",
    icon: "globeAlt",
    endpoints: [SERVERS, META_LIMITS, ROSTER, LEADERBOARD],
  },
  {
    key: "clients",
    name: "Desktop clients",
    description:
      "Update checks, downloads and log uploads for the four CAN desktop clients. An update check that needs a login is an update check that does not happen, so the first two are open.",
    icon: "arrowDownTray",
    endpoints: [CLIENTS_LATEST, CLIENTS_DOWNLOAD, LOGS],
  },
];

/**
 * Routes that exist but are not documented here, and why — rendered on the
 * page so their absence reads as a decision.
 *
 * Every entry names the component it belongs to rather than saying "this
 * site". The reader is on `platform.ceruleanavi.net`, the routes are can-api's,
 * and the panels that call them are can-web's — three different things that
 * "this" cannot distinguish.
 */
export const NOT_PUBLIC: { path: string; reason: string }[] = [
  {
    path: "/api/v1/route",
    reason:
      "Moved. Route resolution lives on the radar's own site — https://radar.ceruleanavi.net/api/v1/route — with the same shape, the same rate limit and still no authentication. It went with the map because the navigation database it reads is what makes it expensive, and nothing else needs it.",
  },
  {
    path: "The rest of /api/v1/pilot/*, plus /api/v1/activity/*, /api/v1/super/* and the rest of /api/v1/atc/*",
    reason:
      "Portal plumbing. Most need a member's session cookie and refuse an access token outright; the few reads that do not — the activity feed and the ATC reservation board — exist to draw a panel on ceruleanavi.net, their shapes follow whatever that panel needs that week, and they are not a contract with anyone outside the network's own repositories. The exceptions are documented above: the three member routes an application can reach with a scope, and the public roster.",
  },
  {
    path: "/api/v1/pilot/data",
    reason:
      "A member's own record — and it returns the cleartext FSD network password, which is why it is the one route that is deliberately never opened to an access token however narrow. An application allowed to read a flight log must not thereby be able to connect to the network as that member. Reachable with the session cookie only, from ceruleanavi.net itself.",
  },
  {
    path: "/api/v1/internal/flightplan (can-fsd)",
    reason:
      "Not can-api's at all: it is on the FSD daemon, beside the datafeed, and it is how can-api pushes a plan filed on the website into an already-connected pilot's live session. A shared secret is its whole protection, so the daemon advertises only GET and OPTIONS for cross-origin requests — a browser's preflight for it fails by design, and a member's session can never be ridden into it.",
  },
  {
    path: "/api/v1/public/auth",
    reason:
      "Despite the name, this is the wire contract between the FSD server, the voice server and can-api — it takes a member's network credentials and nothing else calls it. Not a third-party endpoint.",
  },
  {
    path: "/api/email/*",
    reason:
      "Sign-up, verification and password reset for ceruleanavi.net's own forms.",
  },
  {
    path: "/api/v1/dev/clients",
    reason:
      "What this developer centre uses to register your applications. It needs the `apps:manage` scope, which is deliberately not self-serviceable — an application that could grant itself that scope could repoint another application's redirect URI and collect its next authorization code.",
  },
  {
    path: "/api/v1/pilot/authorizations",
    reason:
      "Where a member reviews and revokes the apps they have authorized. Session cookie only, and deliberately not reachable with an access token — an app that could call it could revoke a competitor, or lock the member out of the page that removes it.",
  },
];

export interface ApiOrigins {
  /** can-api — `https://api.ceruleanavi.net`. */
  api: string;
  /** can-web — `https://ceruleanavi.net`. Serves the consent screen only. */
  web: string;
  /**
   * can-fsd — `https://fsd.ceruleanavi.net`. Serves the datafeed only.
   *
   * Read from configuration rather than hardcoded for the same reason the
   * other two are: the network has already moved hostname once, and the
   * endpoint that tells a client where things are (`/api/v1/servers`) exists
   * precisely so it can move again. A reference that printed a compiled-in
   * address would be the one place that did not follow.
   */
  fsd: string;
}

export interface ResolvedEndpoint extends ApiEndpoint {
  /** The origin that serves this endpoint, already picked from `ApiOrigins`. */
  baseUrl: string;
}

export interface ResolvedGroup extends Omit<ApiGroup, "endpoints"> {
  endpoints: ResolvedEndpoint[];
}

/**
 * Resolve `{origin}` in every example against the host that actually serves
 * the endpoint, and hand the page a `baseUrl` it can print beside the path.
 *
 * On can-web this was one string, because the page and the API answered on the
 * same hostname. It cannot be one string here — see the note on `ApiHost`.
 *
 * The return type is spelled out rather than written as
 * `(ApiGroup & { endpoints: ResolvedEndpoint[] })[]`: intersecting two array
 * properties does not give you an array of the intersected element, so
 * `endpoint.baseUrl` would not typecheck at the call site.
 */
export function withOrigin(
  groups: ApiGroup[],
  origins: ApiOrigins,
): ResolvedGroup[] {
  return groups.map((group) => ({
    ...group,
    endpoints: group.endpoints.map((endpoint) => {
      // Indexed rather than a chain of ternaries, and that is what makes it
      // safe to extend: `ApiHost` and the keys of `ApiOrigins` are the same
      // three strings, so adding a fourth host to one without the other stops
      // compiling here. A ternary chain ending in `: origins.api` would
      // instead have printed can-api's hostname for it, which is the failure
      // this whole type exists to prevent.
      const baseUrl = origins[endpoint.host ?? "api"];
      const swap = (value: string) => value.replaceAll("{origin}", baseUrl);
      return {
        ...endpoint,
        baseUrl,
        example: endpoint.example
          ? {
              request: swap(endpoint.example.request),
              response: endpoint.example.response
                ? swap(endpoint.example.response)
                : undefined,
            }
          : undefined,
      };
    }),
  }));
}
