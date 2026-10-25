/**
 * The public API reference, as data.
 *
 * can-api guards everything under `/api/v1` itself, and a handful of those
 * routes are deliberately open: the ATIS and weather endpoints EuroScope,
 * TopSky and `ATIS for CAN` call with no session, the radar's track and
 * route lookups, the server directory and the desktop clients'
 * update/download path. A smaller set accepts an OAuth access token carrying
 * a scope a self-registered application may request. Those are the ones third
 * parties can build against, so those are the ones documented here.
 * Everything else needs a member's session cookie, a hand-granted scope or a
 * network password and is plumbing — see `NOT_PUBLIC` at the bottom, which is
 * rendered on the page so "it is not in the list" reads as a decision rather
 * than an omission.
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

import type { IconName } from "@jianyuelab-org/can-ui";

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

export type ApiMethod = "GET" | "HEAD" | "POST" | "DELETE";

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
   * the docs: the OIDC discovery documents, the key set, revocation, the
   * datafeed and the member reads are served without a counter of their own.
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
  icon: IconName;
  endpoints: ApiEndpoint[];
}

/* ------------------------------------------------------------------ *
 * ATIS
 * ------------------------------------------------------------------ */

const ATIS: ApiEndpoint = {
  id: "atis",
  methods: ["GET"],
  path: "/api/v1/atis",
  summary: "One station's current METAR, as plain text.",
  body: [
    'This is the URL controllers paste into EuroScope\'s "ATIS maker URL" field. EuroScope substitutes its own macros into the query string, GETs it, and reads the plain text that comes back. The ATIS maker on https://controller.ceruleanavi.net/atis builds the URL.',
    "What comes back is the report this service fetched for the station, not an echo of anything you sent. The station is `icao`; when `icao` is absent it is read from the header of the `metar` parameter (an optional `METAR `/`SPECI ` and `COR ` prefix, then the four-letter station and the `DDHHMMZ` time). Every other query parameter is ignored.",
  ],
  auth: "none",
  cors: true,
  limit: "atis",
  limitScope: "per IP",
  query: [
    {
      name: "icao",
      type: "ICAO",
      description:
        "Four letters, either case. Required unless `metar` carries a station header.",
    },
    {
      name: "metar",
      type: "string",
      description:
        "A METAR whose header names the station. Read only when `icao` is absent, and only for the station code.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: "The report, as `text/plain; charset=utf-8` with `Cache-Control: no-store`. It keeps its leading `METAR`/`SPECI` word when the source sent one.",
    },
    {
      code: 400,
      when: "No valid station in `icao` or in the `metar` header. Plain text.",
    },
    { code: 404, when: "No source has a report for that station. Plain text." },
    {
      code: 429,
      when: 'Rate limited — `{"error": "rate_limited", …}` as JSON with `Retry-After`, unlike the other answers here.',
    },
  ],
  example: {
    request: "curl '{origin}/api/v1/atis?icao=ZBAA'",
    response: "METAR ZBAA 231630Z VRB01MPS CAVOK 11/08 Q1018 NOSIG",
  },
  notes: [
    "The weather sources and the per-station cache are the ones `/api/v1/metar` uses, so the two answer with the same report.",
    "Nothing here touches the database or a session — it reads public weather and returns text.",
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
    {
      code: 200,
      when: "The configuration document, with an `ETag` and `Cache-Control: public, max-age=300`.",
    },
    {
      code: 304,
      when: "`If-None-Match` matched the current version. No body.",
    },
    { code: 429, when: "Rate limited." },
    {
      code: 500,
      when: '`{"error": "config_invalid", "message": …}` — the published file failed validation; `message` names each reason (no stations, a station with no identifier or frequency, an unknown `atis_type`, a duplicate callsign).',
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
    "`version` is a content hash of the document, not a number anybody remembers to bump — any edit is a new version, and a client can compare it to decide whether it is current. The same value, quoted, is the `ETag`.",
    "`atis_type` is one of `combined` (the default when absent), `departure`, `arrival`. The station's callsign is derived from it — `ZBAA_ATIS`, `ZBAA_D_ATIS`, `ZBAA_A_ATIS` — which is why there is no callsign key and why two entries deriving the same callsign fail validation.",
    "The information letter is deliberately absent: it advances with the weather and belongs to a running session, not to a configuration.",
    "`ETag` is not listed in `Access-Control-Expose-Headers`, so a cross-origin browser fetch cannot read it. Read `version` from the body instead and send it back quoted.",
  ],
};

const METAR: ApiEndpoint = {
  id: "metar",
  methods: ["GET"],
  path: "/api/v1/metar",
  summary: "The METAR and/or TAF for one station.",
  body: [
    "A bare weather lookup for desktop clients and scripts that want the report text itself. METAR sources, in order: NOAA, etops, VATSIM, then CMA's avimet.nmc.cn. The last serves decoded fields, so its METAR is assembled and carries only wind, cloud, temperature and QNH, with no `METAR` prefix. TAF sources: NOAA, then etops.",
    "Reports are cached per station for 10 minutes.",
    'A report is an empty string rather than an error status when no source has one — the caller can then tell "no report for this station" from "the service is down", which a non-2xx would blur.',
    "`format` picks the shape. The default (`json`) is the object below. `pre` and `raw` are plain-text answers for two non-browser readers that poll: `pre` is the one report wrapped in `<pre>…</pre>` (what TopSky's weather window scrapes), `raw` is the bare report with any leading `METAR`/`SPECI` word removed so the line starts with the station (what can-fsd reads). Both fold the report onto one line, take one report per request — `type=all` is refused — and answer an empty `<pre></pre>` or empty body when there is no report.",
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
    {
      name: "type",
      type: "string",
      required: false,
      description:
        "`metar` (default), `taf` or `all`. The JSON reply carries a `metar` and/or `taf` key to match. `pre` and `raw` accept only `metar` or `taf`.",
    },
    {
      name: "format",
      type: "string",
      required: false,
      description:
        "`json` (default), `pre` or `raw`. `pre` and `raw` count against their own bucket, `metarPoll`, instead of `metarLookup`.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: '`{"icao": "ZSPD", "metar": "METAR ZSPD ..."}` — or an empty string when no source has a report. Plain text for `format=pre`/`raw`.',
    },
    {
      code: 400,
      when: "`invalid_icao` (`icao` missing or not four letters), `invalid_type`, or `invalid_format`.",
    },
    { code: 429, when: "Rate limited." },
  ],
  example: {
    request: "curl '{origin}/api/v1/metar?icao=ZSPD&type=all'",
    response: `{
  "icao": "ZSPD",
  "metar": "METAR ZSPD 071300Z 13004MPS 9999 SCT015 BKN020 24/22 Q1014 NOSIG",
  "taf": "TAF ZSPD 071100Z 0712/0818 14004MPS 9999 SCT020"
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
        "How many points to return, 1–2000 (default 600; out-of-range values are clamped, a non-number is ignored). The **oldest** points are dropped first, so a long flight keeps its recent shape.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: "The track. `points` is empty when nothing was recorded, and `callsign` is `null` when there is neither an open session nor a recorded point to name it from.",
    },
    {
      code: 400,
      when: '`cid` is missing or not 1–10 digits — `{"error": "invalidCid", …}`.',
    },
    {
      code: 429,
      when: 'Rate limited — `{"error": "rate_limited", …}` with `Retry-After`. This answer carries no CORS header.',
    },
    {
      code: 500,
      when: '`{"error": "internal_error", …}` — the track could not be read.',
    },
  ],
  example: {
    request: "curl '{origin}/api/v1/track?cid=1234&limit=200'",
    response: `{
  "status": 200,
  "data": {
    "cid": "1234",
    "callsign": "CCA1501",
    "since": "2026-08-01T09:14:22Z",
    "points": [
      [40.0741, 116.5908, 112, 1785574462000],
      [40.0812, 116.6033, 1450, 1785574492000]
    ]
  },
  "timestamp": "2026-08-01T10:31:02Z"
}`,
  },
  notes: [
    "A point is `[latitude, longitude, altitude in feet, unix milliseconds]`, oldest first. `since` is where the window starts, as RFC 3339 UTC.",
    "Positions at exactly 0/0 are excluded: a simulator that has not finished initialising reports them, and one such row drags the drawn track out to the Gulf of Guinea and back.",
    "Error bodies carry a short `error` **key** to branch on; `message` is for a human and may change.",
  ],
};

const ROUTE: ApiEndpoint = {
  id: "route",
  methods: ["GET"],
  path: "/api/v1/route",
  summary: "A filed route, resolved into the points a map draws.",
  body: [
    "Give it the departure, the arrival and the route string from a flight plan, and it answers the sequence of points — airports, fixes, airway and procedure legs — that the live map connects. The navigation data stays on the server: a caller gets this one flight's line, not a copy of the database.",
    "Unrecognised tokens are skipped rather than failing the whole route: a filed route is free text typed by a member, and half a line beats none. The answer is the **whole** route; trimming it to the part not yet flown is the map's job, because that changes every time the aircraft moves.",
    "The radar serves the same path on its own origin (`https://radar.ceruleanavi.net/api/v1/route`) as a server-side proxy to this one, so its page stays same-origin. The resolver itself is can-api's.",
  ],
  auth: "none",
  cors: true,
  limit: "routeResolve",
  limitScope: "per IP",
  query: [
    {
      name: "departure",
      type: "ICAO",
      required: true,
      description: "3–4 letters or digits; trimmed and upper-cased.",
    },
    {
      name: "arrival",
      type: "ICAO",
      required: true,
      description: "3–4 letters or digits; trimmed and upper-cased.",
    },
    {
      name: "route",
      type: "string",
      description:
        "The filed route, e.g. `LAT91D LATUX W108 MATNU MATNU2`. Anything past 1,500 characters is cut off.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: "`points`, in flying order. `Cache-Control: no-store`.",
    },
    {
      code: 400,
      when: '`{"error": "invalidAirports", …}` — `departure` or `arrival` is not 3–4 letters or digits.',
    },
    {
      code: 429,
      when: "Rate limited. This answer carries no CORS header.",
    },
    {
      code: 503,
      when: '`{"error": "navDataUnavailable", …}` — this instance has no navigation data loaded. Fall back to a direct line between the two airports.',
    },
  ],
  example: {
    request:
      "curl '{origin}/api/v1/route?departure=ZSQD&arrival=ZSPD&route=LAT91D%20LATUX%20W108%20MATNU%20MATNU2'",
    response: `{
  "status": 200,
  "data": {
    "points": [
      { "ident": "ZSQD", "lat": 36.36, "lon": 120.09, "kind": "airport" },
      { "ident": "LATUX", "lat": 35.43, "lon": 120.66, "kind": "sid", "via": "LAT91D" },
      { "ident": "MATNU", "lat": 32.27, "lon": 121.97, "kind": "airway", "via": "W108" },
      { "ident": "ZSPD", "lat": 31.14, "lon": 121.81, "kind": "airport" }
    ]
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "`kind` is one of `airport`, `fix`, `airway`, `sid`, `star` — what put the point on the line. `via` is the airway or procedure the point was reached along; it is absent for a point reached direct. Consecutive points sharing a `via` are one labelled leg.",
    "Which AIRAC cycle the resolver is using is answered by `/api/v1/meta/navdata`.",
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
    "Without parameters this describes the newest can-audio release — its version, when it was published, where the notes are, and one entry per package in `clients` (`audio-for-can`, `atis-for-can`) with its size and a download link — plus `apps`: programs released separately, keyed by name. Today those are `can-pilot` (the pilot client for MSFS 2020/2024 and X-Plane 11.50+/12 on Windows, which replaces `msfs-for-can` and `xpc-for-can`) and `can-downloader`. An app that cannot be resolved is simply absent from `apps`.",
    "Each `apps` entry carries `name`, `version`, `publishedAt`, `prerelease`, `size`, `sha256` (when GitHub recorded one), `download` (our relay), `notes` (the release page), `origin` (the GitHub asset) and `changelog` (the release body, Markdown). An app's version is its newest stable release; a prerelease is offered only while the app has no stable one.",
    'With `client` and `version` it answers the question directly, so every client agrees on what "newer" means rather than each writing its own comparison. Versions are compared numerically field by field and a leading `v` is ignored — as strings, `2.0.10` sorts before `2.0.9` and the check either nags forever or never fires. Every run of digits counts, including one in a suffix: `2.1.0-rc1` reads as `2.1.0.1` and compares *newer* than `2.1.0`.',
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
        "One of `audio-for-can`, `atis-for-can` (the can-audio bundle — the answer carries no `apps`), `can-pilot`, `can-downloader` (an app — `update` compares against that app's version, and the answer carries `apps` but none of the bundle's `version`, `clients` or `notes`), or the retired `msfs-for-can` / `xpc-for-can` (answered with can-pilot — see below). Adds two top-level keys to the answer: `client` (the name you asked about, as a **string**) and `update` (an object — `available`, `current`, `latest`).",
    },
    {
      name: "version",
      type: "string",
      description:
        "The version you are running, e.g. `2.0.1`. Omitting it compares against an empty version, so `update.available` is `true` whenever a release exists.",
    },
  ],
  statuses: [
    { code: 200, when: "The release document." },
    {
      code: 404,
      when: '`client` is not one of the accepted names — `{"error": "unknown_client"}`.',
    },
    { code: 429, when: "Rate limited." },
    {
      code: 503,
      when: 'The relevant release could not be resolved — `{"error": "unavailable"}`. No version is invented — a client told "you are up to date" wrongly stops asking.',
    },
  ],
  example: {
    request:
      "curl '{origin}/api/v1/clients/latest?client=atis-for-can&version=2.0.0'",
    response: `{
  "version": "2.0.3",
  "publishedAt": "2026-07-31T08:35:28Z",
  "notes": "https://github.com/JianyueLab-Org/can-audio/releases/tag/v2.0.3",
  "clients": {
    "audio-for-can": { "name": "audio-for-can", "version": "2.0.3", "size": 64583682, "download": "…", "origin": "…" },
    "atis-for-can": {
      "name": "atis-for-can",
      "version": "2.0.3",
      "size": 58094371,
      "download": "{origin}/api/v1/clients/download/atis-for-can?v=2.0.3",
      "origin": "https://github.com/JianyueLab-Org/can-audio/releases/download/v2.0.3/…"
    }
  },
  "client": "atis-for-can",
  "update": { "available": true, "current": "2.0.0", "latest": "2.0.3" }
}`,
  },
  notes: [
    "`download` points at our own relay; `origin` is the GitHub asset, for anyone who can reach it. Prefer `download`. Versions are reported without the tag's leading `v`, and `download` pins one with `?v=`.",
    "**This endpoint has no `{status, data, timestamp}` envelope.** Most of can-api wraps its answer; this one writes the document at the top level, and the field names are `publishedAt` (camelCase) and `notes`. Read the keys above literally.",
    "**`client` is a string and `update` is an object.** They replaced an earlier `client` object plus an `update_available` boolean, and older shipped desktop clients still read the old shape — so they are the ones that are wrong, not this page. There is no `reason` field anywhere in the answer.",
    "**`msfs-for-can` and `xpc-for-can` are retired; their update check is answered with can-pilot.** `update.latest` is can-pilot's version, `clients[<retired name>]` holds `name`, `version`, `size` and a `download` pointing at can-pilot's relay link, and `notes` is can-pilot's release page — so an old pilot client is told to move on. Only a **stable** can-pilot is offered: while its successor is a prerelease, `update.available` is `false`, `clients` is empty and there is no `notes`. Neither name can be downloaded any more.",
    "**A package missing from a release still gets an `update` answer.** When one of the builds fails it is simply absent from `clients`, but `update.available` is computed from the release version regardless — so check that `clients[name]` exists before following a download, rather than trusting `available` alone.",
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
    "It is **not an open proxy**: the upstream URL only ever comes out of the resolved release for a fixed set of repositories, keyed by a whitelist of four names, and nothing the caller sends is used to build it.",
    "When the release records a SHA-256 for the asset — GitHub's digest for an app (`can-pilot`, `can-downloader`), or a published `SHA256SUMS` for the can-audio bundle — a `GET` downloads and hashes the whole file before sending a byte, and a mismatch is a 502 `checksum_mismatch` rather than bytes nobody published.",
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
        "One of `audio-for-can`, `atis-for-can`, `can-pilot`, `can-downloader`. The retired `msfs-for-can` and `xpc-for-can` answer 404 — can-pilot replaces both.",
    },
  ],
  query: [
    {
      name: "v",
      type: "string",
      description:
        "Pin the release, e.g. `2.0.1` — the version as `/api/v1/clients/latest` reports it, with no leading `v`. A pinned answer is `Cache-Control: public, max-age=604800, immutable`; unpinned it is `max-age=300`. A pin that is not the current version is redirected to the current one rather than silently serving different bytes than the URL promised.",
    },
  ],
  headers: [
    {
      name: "Range",
      type: "string",
      description:
        "Resume a stalled download with `bytes=N-`. On a checksum-verified `GET` the range is served from the verified file; otherwise `Range` and `If-Range` are forwarded to GitHub.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: "The asset, as an attachment — `application/zip` (an app whose asset is not a zip is `application/octet-stream`).",
    },
    { code: 206, when: "A range of it, when `Range` was sent." },
    {
      code: 302,
      when: "`v` pinned a release that is no longer current; `Location` carries the current one. `Cache-Control: no-store`.",
    },
    {
      code: 404,
      when: "`unknown_client` — not one of the four names (including the retired `msfs-for-can` / `xpc-for-can`); or `no_asset` — that bundle package is not in the latest release.",
    },
    { code: 405, when: "`method_not_allowed` — anything but `GET` or `HEAD`." },
    {
      code: 416,
      when: "`bad_range`, mirrored from GitHub: the forwarded `Range` cannot be served.",
    },
    {
      code: 429,
      when: "Rate limited. Each miss pulls the whole asset across our bandwidth, and every request of a resumed download counts.",
    },
    {
      code: 501,
      when: "`bad_range`, mirrored from GitHub: it answers this to a forwarded suffix range like `bytes=-22`.",
    },
    {
      code: 502,
      when: "`upstream_error` — GitHub could not be reached or answered something else; `upstream_too_large`; or `checksum_mismatch` — the bytes did not match the recorded SHA-256.",
    },
    {
      code: 503,
      when: "`unavailable` — the release feed could not be resolved, so there is no asset to stream.",
    },
  ],
  example: {
    request:
      "curl -L -O -J '{origin}/api/v1/clients/download/atis-for-can?v=2.0.1'\ncurl -I '{origin}/api/v1/clients/download/atis-for-can'",
  },
  notes: [
    "`HEAD` exists so a client can check size and version without pulling 60 MB. `X-Client-Version` carries the release on a successful answer (200, 206, or `HEAD`); error answers and the 302 do not carry it.",
    '416 and 501 are mirrored rather than flattened to 502 on purpose: they are about the request, and calling them "GitHub is down" sends whoever is debugging to the wrong end.',
    "An unverified download is streamed straight through. A verified one is staged and hashed first, so its first byte arrives only after the whole file has crossed from GitHub.",
  ],
};

const LOGS: ApiEndpoint = {
  id: "logs",
  methods: ["POST"],
  path: "/api/v1/logs",
  summary: "Send a client log to the maintainer.",
  body: [
    "Diagnosing \"it won't connect\" means reading the client's log file, which otherwise means asking the member to find it and get it over chat. This is that step automated: the log lands in an inbox, attached, with who sent it, which client and which version.",
    "**Nothing is stored.** No table, no file on disk — the mail is the record, which keeps a log of somebody's session out of the database.",
  ],
  auth: "credentials",
  cors: false,
  limit: "logUpload",
  limitScope:
    "per member, after sign-in (plus `logUploadPerIP` before the body is read, and shared `credentialAccount` / `credentialPerIP` failure budgets; successful authentication clears only the account budget)",
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
      type: "string",
      required: true,
      description: "The log text, inline.",
    },
    {
      name: "client",
      type: "string",
      description:
        "Which client, e.g. `atis-for-can`. Used in the subject line.",
    },
    { name: "version", type: "string", description: "Client version string." },
  ],
  statuses: [
    {
      code: 200,
      when: 'Accepted — `{"status": 200, "data": {"received": true}, "timestamp": …}`.',
    },
    {
      code: 400,
      when: "`invalidBody` — not JSON, or over 4 MiB.",
    },
    {
      code: 401,
      when: "`invalidCredentials` — CAN ID or password is wrong. One message for both cases, deliberately.",
    },
    {
      code: 429,
      when: "Rate limited — per IP, per member, or after repeated failed sign-ins for that CAN ID.",
    },
    {
      code: 503,
      when: "`unavailable` — log upload is not configured on this deployment.",
    },
  ],
  example: {
    request: `curl -X POST '{origin}/api/v1/logs' \\
  -H 'Content-Type: application/json' \\
  -d '{"cid":"1234","password":"...","client":"atis-for-can","version":"2.0.1","log":"<log>"}'`,
    response: `{
  "status": 200,
  "data": { "received": true },
  "timestamp": "2026-08-01T10:31:02Z"
}`,
  },
  notes: [
    "`application/json` only. The Python clients use nothing but stdlib `urllib`, where hand-rolling multipart is twenty lines of boundary bookkeeping.",
    "Past 1 MiB the **tail** is kept, because the failure is the last thing that happened and the start of the file is startup noise.",
    "The mail is sent in the background. A 200 means the log was accepted, not that it has reached the inbox.",
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
    "Point any OAuth/OIDC library at this URL and it will find the authorization, token, userinfo, revocation and introspection endpoints, the key set, the signing algorithm and the scopes this network supports. Nothing below has to be typed in by hand.",
    "The `issuer` here is the exact string that appears as `iss` in an id_token — both come from the same place in the code, so they cannot drift apart.",
    "The same document is served at `/.well-known/oauth-authorization-server` (RFC 8414) and at the older `/api/oauth/openid-configuration`.",
  ],
  auth: "none",
  cors: true,
  limitScope: "—",
  statuses: [
    {
      code: 200,
      when: "Always. `Cache-Control: public, max-age=3600`.",
    },
  ],
  example: { request: `curl '{origin}/.well-known/openid-configuration'` },
  notes: [
    "`grant_types_supported` lists `client_credentials` too. That grant exists only for service clients the network registers by hand, carrying service-only scopes; an application registered on this developer centre is refused it (`unauthorized_client`).",
  ],
};

const OIDC_JWKS: ApiEndpoint = {
  id: "oidc-jwks",
  methods: ["GET"],
  path: "/api/oauth/jwks",
  summary: "Public keys for verifying an id_token.",
  body: [
    "RS256 only. A retired key stays in this document until every id_token signed with it has expired, so verify by `kid` rather than by taking the first key.",
    "You only need this to verify an **id_token**. Access tokens are opaque strings, not JWTs — see the note on `/api/oauth/introspect`.",
    "This is the `jwks_uri` the discovery document advertises. There is no `/.well-known/jwks.json`.",
  ],
  auth: "none",
  cors: true,
  limitScope: "—",
  statuses: [
    { code: 200, when: "Always. `Cache-Control: public, max-age=3600`." },
  ],
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
    "Anonymous visitors are sent to the sign-in page and returned here afterwards with every parameter intact. Trusted first-party applications skip the consent screen; others show it once and skip it afterwards while the member's earlier approval already covers every scope requested, until the member revokes it.",
    "The page is rendered by the main site, but every decision on it — which client, which callback, which scopes — is made by can-api, which is also where the rate limit is counted.",
  ],
  auth: "browser",
  cors: false,
  limit: "oAuthAuthorize",
  limitScope: "per IP while signed out, per member once signed in",
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
        "Must match a registered URI exactly. The one exception is a loopback address (`http://127.0.0.1/…` or `http://[::1]/…`), where the port may differ — RFC 8252, for native apps that bind an ephemeral port. Path and query must still match.",
    },
    {
      name: "scope",
      type: "string",
      required: true,
      description:
        "Space-separated. Unrecognised scopes are dropped; if none is left the request fails with `invalid_scope`, and so does any scope the application was not registered for.",
    },
    {
      name: "code_challenge",
      type: "string",
      required: true,
      description:
        "Base64url (unpadded) SHA-256 of your `code_verifier`. The verifier itself must be 43–128 unreserved characters, which is checked at the token exchange.",
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
  ],
  statuses: [
    {
      code: 302,
      when: "Back to your `redirect_uri` with `code` and `state` when no screen is needed, or with `error`, `error_description` and `state` for a request that failed after the callback was verified.",
    },
    {
      code: 302,
      when: "To `/signin?callbackUrl=…` when nobody is signed in.",
    },
    {
      code: 200,
      when: "The consent screen; after the member answers it, a page that forwards the browser to your `redirect_uri` with `code` (or `error=access_denied`) and `state`. Or an error page, when `client_id` or `redirect_uri` could not be verified — those two never redirect: with an unverified callback there is nowhere safe to send the error.",
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
    "`prompt`, `max_age`, `login_hint` and other optional OIDC request parameters are not supported and have no effect.",
  ],
};

const OAUTH_TOKEN: ApiEndpoint = {
  id: "oauth-token",
  methods: ["POST"],
  path: "/api/oauth/token",
  summary:
    "Exchange an authorization code — or a refresh token — for an access token.",
  body: [
    "`application/x-www-form-urlencoded` only. Confidential clients authenticate with HTTP Basic (`client_secret_basic`) or a `client_secret` field (`client_secret_post`); public clients send only `client_id` and rely on PKCE.",
    "**Refresh tokens rotate.** Every refresh returns a new one and invalidates the one you sent, so store what comes back. Presenting an already-rotated refresh token is treated as a leak and revokes the whole grant — both the thief and the real client are logged out, which is the only safe reading when the two are indistinguishable.",
    "A refresh token is only issued when the member granted `offline_access`, and an id_token only when the grant holds `openid`.",
  ],
  auth: "oauthClient",
  cors: true,
  limit: "oAuthToken",
  limitScope:
    "per IP, then per client and IP once the client is known; failed attempts count in `oAuthTokenFail`, per client and IP (per IP for an unknown client)",
  fields: [
    {
      name: "grant_type",
      type: "string",
      required: true,
      description:
        "`authorization_code` or `refresh_token`. (`client_credentials` is reserved for hand-registered service clients — see the discovery note.)",
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
      when: "`invalid_request`, `invalid_grant` (bad/expired/replayed code or refresh token, a code or token issued to another client, `redirect_uri` mismatch, PKCE mismatch), `invalid_scope` (a refresh asked for more than the grant holds), `unsupported_grant_type`.",
    },
    { code: 401, when: "`invalid_client` — client authentication failed." },
    {
      code: 429,
      when: "Rate limited. Failures are counted in their own, much tighter bucket.",
    },
    { code: 500, when: "`server_error` — a token could not be issued." },
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
    "Every answer, errors included, carries `Cache-Control: no-store`. Errors are `{error, error_description}` per RFC 6749.",
  ],
};

const OAUTH_USERINFO: ApiEndpoint = {
  id: "oauth-userinfo",
  methods: ["GET", "POST"],
  path: "/api/oauth/userinfo",
  summary: "Who the access token belongs to, right now.",
  body: [
    "What comes back is decided entirely by the scopes on the token, not by anything in the request: a token holding only `openid` gets a `sub` (the CAN ID) and nothing else. `profile` adds `name`, `rating` and `developer`; `email` adds `email` and `email_verified`.",
    "`rating` is this network's controller rating as a bare integer (5 is C1), not any other network's. `developer` says whether the member may use this developer centre.",
    "Prefer this over the id_token when you want current data. The id_token is a snapshot of the moment the member signed in; this is now.",
  ],
  auth: "oauth",
  cors: true,
  limit: "oAuthUserinfo",
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
    { code: 200, when: "The claim set. `Cache-Control: no-store`." },
    {
      code: 401,
      when: '`invalid_request` with `WWW-Authenticate: Bearer realm="can-api"` when no Bearer token was sent; `invalid_grant` with `WWW-Authenticate: Bearer error="invalid_token"` when it is expired, revoked or unknown.',
    },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not hold `openid`.",
    },
    { code: 429, when: "Rate limited." },
  ],
  example: {
    request: `curl '{origin}/api/oauth/userinfo' -H 'Authorization: Bearer can_at_...'`,
    response: `{
  "sub": "1234",
  "name": "Jane Doe",
  "rating": 5,
  "developer": false,
  "email": "jane@example.com",
  "email_verified": true
}`,
  },
  notes: [
    "`divisions` is a scope and appears in `claims_supported`, but userinfo carries no division claim. Read memberships from `/api/v1/pilot/divisions` with that scope.",
  ],
};

const OAUTH_INTROSPECT: ApiEndpoint = {
  id: "oauth-introspect",
  methods: ["POST"],
  path: "/api/oauth/introspect",
  summary: "Ask whether a token is still valid (RFC 7662).",
  body: [
    "Access tokens are **opaque strings, not JWTs**. That is a deliberate trade: you cannot verify one offline, but a member who revokes your app on https://ceruleanavi.net/account/apps stops you the same second rather than an hour later. This endpoint is how a resource server of your own checks one.",
    'A client may only introspect its own tokens. Anything else answers `{"active": false}` — otherwise every registered app could use this to confirm that some string it found is a live token.',
    "**Confidential clients only.** A public client is refused with 401 even with a correct `client_id`: a client id is public by construction, and an introspection endpoint open to it would be an oracle for stolen tokens.",
  ],
  auth: "oauthClient",
  cors: true,
  limit: "oAuthUserinfo",
  limitScope: "per IP (its own counter, same rule as userinfo)",
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
        "Ignored. The type is read from the token's prefix: `can_rt_` is a refresh token, anything else is looked up as an access token.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: '`{"active": true, "scope", "client_id", "username", "sub", "token_type": "Bearer", "exp", "iss"}` or `{"active": false}`. An invalid token is not an error.',
    },
    { code: 400, when: "`invalid_request` — the form body could not be read." },
    {
      code: 401,
      when: "`invalid_client` — authentication failed, or the client is public.",
    },
    { code: 429, when: "Rate limited." },
  ],
};

const OAUTH_REVOKE: ApiEndpoint = {
  id: "oauth-revoke",
  methods: ["POST"],
  path: "/api/oauth/revoke",
  summary: "Sign the member out of your app (RFC 7009).",
  body: [
    "Revokes exactly the token you send, and only if it was issued to your client. Revoking a refresh token does **not** revoke access tokens already issued from it — to sign a member out, revoke both, or the access token keeps working until it expires (one hour).",
    "Always answers 200, including for a token that is unknown, expired or belongs to someone else. A revocation endpoint that 404s is a way to ask whether a string is a live token.",
    "Public clients authenticate with `client_id` alone here, as at the token endpoint.",
  ],
  auth: "oauthClient",
  cors: true,
  limitScope: "—",
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
      description:
        "Accepted and ignored — the token is looked up by its value.",
    },
  ],
  statuses: [
    { code: 200, when: "Done, or there was nothing to do. No body." },
    { code: 400, when: "`invalid_request` — the form body could not be read." },
    { code: 401, when: "`invalid_client`." },
  ],
};

/* ------------------------------------------------------------------ *
 * Live network datafeed — can-fsd
 *
 * The one group in this reference that is not can-api's. It is served by the
 * FSD daemon itself, on its HTTP hostname (`data.ceruleanavi.net`), and it
 * does **not** use the `{status, data, timestamp}` envelope every can-api
 * route wraps its payload in — these documents are the payload. A client that
 * unwraps `data` here gets `undefined`.
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
    "Position and attitude keys (`latitude`, `longitude`, `altitude`, `groundspeed`, `transponder`, `heading`, `pitch`, `bank`) are **absent** until the pilot's first position packet arrives, rather than present and zero.",
    '`vertical_speed` and `ground_track` are derived, but they are **not** absent until the aircraft moves — they are written in the same block as the coordinates, so they appear exactly when those do and read `0` while the aircraft is stationary. Do not treat a missing key as "unknown" for these two: a parked aircraft reports `ground_track: 0`, which is due north, and a client that draws it will point every stationary aircraft at the top of the screen. Use `groundspeed` to decide whether the track means anything.',
    "`text_atis` is always an array — never `null` — even for a controller who has posted nothing.",
    "`general.version` is the **network's name**, taken from can-fsd's config (`\"CAN BETA TEST\"` today), and it is also each controller's `server` field. It is not a protocol or API version, and it is not the FSD banner, which must keep saying `VATSIM FSD` or older EuroScope builds drop the connection.",
    "`general.socket` and `general.user` always report the same number. They were separate counters in the Python server; a connection is only registered once here. The keys stay for compatibility.",
    "`update` and every `logon_time` are `YYYY-MM-DD HH:MM:SS` in **UTC with no zone marker**. Parse them as UTC; the server converts explicitly rather than relying on its own `TZ`.",
    "`tracked_by` is the callsign of the controller holding the radar track, and `track` is the full server-owned state (`owner`, `handoff_peer`, `status` of `owned` / `pending_handoff` / `handoff_accepted`). A client must read these rather than decide locally — two workstations disagreeing about who holds an aircraft is the bug this prevents.",
    "There is no rate limit on can-fsd's HTTP routes. That is not an invitation: the document is rebuilt on every request. Poll no faster than once a second, and prefer `/v1/events` below, which exists precisely so you do not have to poll at all.",
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
      when: '`{"error": "streaming unsupported"}` — the server\'s response writer cannot flush. Not something a client can retry into working.',
    },
  ],
  example: {
    request: "curl -N '{origin}/v1/events'",
    response: `event: snapshot
data: {"general":{…},"pilots":[…],"controllers":[…],"atis":[]}

event: update
data: {"update":1787136663,"pilots":{"changed":[{"cid":"1234","callsign":"CCA1501",…}]},"controllers":{},"atis":{}}

event: update
data: {"update":1787136665,"pilots":{"removed":["CCA1501"]},"controllers":{},"atis":{}}

: keepalive`,
  },
  notes: [
    "**A subscriber that falls behind is dropped, not buffered.** The per-connection queue is 16 events deep; when a new update finds it full, the subscriber is disconnected, so one slow reader cannot stall the broker for everyone. Reconnect and take the fresh `snapshot` as the new truth; do not try to stitch it onto what you had.",
    "A comment line `: keepalive` arrives every 15 seconds. It is not an event — it exists so idle connections survive proxies that time out silent streams.",
    "Every `update` carries all three groups, `pilots`, `controllers` and `atis`; a group where nothing changed is an empty object `{}`, and within a group `changed` and `removed` are omitted when empty. Neither means *that collection is now empty*.",
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
    "Two fields and nothing else: `version` (the network name, the same string `general.version` carries) and `online` (the number of connected clients — pilots, controllers and ATIS stations together, the same number as `general.socket`). For a status badge, a bot, or a health page that wants a number without pulling the whole feed.",
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
 * the default is no token access, and each route here is an explicit
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
        "rating": { "id": 5, "long": "Enroute Controller", "short": "C1", "zh": "航路管制员" },
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
    "rating": 5,
    "home": {
      "id": 91, "region": 1,
      "regionName": { "short": "PRC", "shortZh": "PRC", "zh": "中国大陆" },
      "del": true, "gnd": true, "twr": true, "app": false, "ctr": false,
      "instructor": false, "director": false, "status": true, "home": true,
      "createdAt": "2026-03-02T11:20:00Z", "updatedAt": "2026-06-14T08:05:41Z"
    },
    "visiting": [],
    "canSetHome": false,
    "canAddVisiting": true,
    "minVisitingRating": 1
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "**Joining is one-way.** Setting a home division succeeds exactly once and there is no leave or remove action anywhere in this API; a transfer goes through an instructor. `canSetHome` is therefore false forever after the first success.",
    "The seat flags (`del`/`gnd`/`twr`/`app`/`ctr`), `instructor`, `director` and `status` are instructor-granted and are read-only here. The member-side write can only ever set the region and the home flag.",
    "`regionName.shortZh` is the simplified-Chinese short code. It equals `short` for every region except 5 (`ROC`, 中国台湾), where it is `TWN`. Region codes: 0 UNK, 1 PRC, 2 USA, 3 JPN, 4 HKG, 5 ROC.",
    "`rating` in this payload is the bare integer, unlike the expanded object on `/api/v1/pilot/atc`. Both shapes exist in this API and neither is going to change — check which one you are holding.",
  ],
};

const AUTH_SESSION: ApiEndpoint = {
  id: "auth-session",
  methods: ["GET"],
  path: "/api/v1/auth/session",
  summary: "The token's member, in the shape the network's own sites read.",
  body: [
    "With a Bearer token this answers who the token belongs to and which scopes it carries. It is the same member object the network's websites get from their session cookie, so a resource server that already reads it for the sites can read it for a token too. For a third-party sign-in, `/api/oauth/userinfo` is the standard answer and usually the better one.",
    "`email` and `emailVerified` are present only when the token also carries `email` — the same gate userinfo applies.",
  ],
  auth: "oauth",
  scopes: ["profile"],
  cors: false,
  limitScope: "—",
  statuses: [
    { code: 200, when: "`user` and `scope`." },
    {
      code: 401,
      when: "`unauthorized` — the token is invalid or expired, or the member's account is gone or closed.",
    },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `profile`.",
    },
  ],
  example: {
    request:
      "curl -H 'Authorization: Bearer can_at_…' '{origin}/api/v1/auth/session'",
    response: `{
  "user": {
    "username": "1234",
    "name": "Jane Doe",
    "rating": 5,
    "aipAccess": 0,
    "developer": false,
    "email": "jane@example.com",
    "emailVerified": true
  },
  "scope": "openid profile email"
}`,
  },
  notes: [
    "**No `{status, data, timestamp}` envelope** — `user` and `scope` are top-level keys.",
    "`username` is the CAN ID, as a string. `rating` is the bare integer. `aipAccess` is the member's access level to the aeronautical data console and `developer` whether they may use this developer centre — facts the network's own sites draw their navigation from.",
    'Without any credential this route answers 200 `{"user": null}` — that is the signed-out answer the websites expect, not an error.',
  ],
};

/* ------------------------------------------------------------------ *
 * Flight plan
 *
 * Seven routes, one scope. `flightplan` reaches the member's filed plan and
 * their SimBrief binding; filing broadcasts to every controller under the
 * member's name, which is why no other scope reaches any of these.
 * ------------------------------------------------------------------ */

const FLIGHTPLAN_GET: ApiEndpoint = {
  id: "flightplan-get",
  methods: ["GET"],
  path: "/api/v1/pilot/flightplan",
  summary: "The member's flight plan on file.",
  body: [
    "Whatever is on file for the token's member — filed through `POST` below, or written back by the FSD server when the member filed from their simulator (`filedFromClient: true`).",
  ],
  auth: "oauth",
  scopes: ["flightplan"],
  cors: false,
  limitScope: "—",
  statuses: [
    {
      code: 200,
      when: "The plan, or `data: null` when nothing is on file.",
    },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `flightplan`.",
    },
  ],
  example: {
    request:
      "curl -H 'Authorization: Bearer can_at_…' '{origin}/api/v1/pilot/flightplan'",
    response: `{
  "status": 200,
  "data": {
    "callsign": "CCA1501", "flightRules": "I", "aircraft": "A320",
    "cruiseTas": "450", "departure": "ZBAA", "departureTime": "0900",
    "cruisingAltitude": "FL361", "arrival": "ZSPD", "alternate": "ZSNJ",
    "hoursEnroute": "2", "minutesEnroute": "5",
    "fuelHours": "3", "fuelMinutes": "30",
    "remarks": "", "route": "ELKUR A593 SASAN",
    "filedFromClient": false,
    "updatedAt": "2026-08-19T08:41:10Z"
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "Every plan field is a **string**, numbers included — that is what the FSD protocol carries. Numbers are validated, not converted.",
  ],
};

const FLIGHTPLAN_FILE: ApiEndpoint = {
  id: "flightplan-file",
  methods: ["POST"],
  path: "/api/v1/pilot/flightplan",
  summary: "File or replace the member's flight plan.",
  body: [
    'The plan is normalised (trimmed; codes upper-cased; empty numbers become `"0"`), validated, and handed to the FSD server **before** it is stored. If the member is connected on that callsign the plan is in force at once and every controller sees it (`live: true`); otherwise it applies at their next login (`live: false`, which also covers an FSD server that could not be reached).',
    "**A plan cannot be changed while a controller holds the aircraft's radar track.** The amendment is then the controller's to make: the request is refused with 409 `tracked` and nothing is stored. The datafeed's `tracked_by` says in advance when that is the case, so a form can grey itself out first.",
  ],
  auth: "oauth",
  scopes: ["flightplan"],
  cors: false,
  limit: "flightPlanFile",
  limitScope: "per member",
  fields: [
    {
      name: "callsign",
      type: "string",
      required: true,
      description: "2–10 of `A-Z`, `0-9`, `_`, `-`.",
    },
    {
      name: "flightRules",
      type: "string",
      required: true,
      description: "`I`, `V`, `S` or `D`.",
    },
    {
      name: "aircraft",
      type: "string",
      required: true,
      description: "1–40 characters.",
    },
    {
      name: "cruiseTas",
      type: "string",
      required: true,
      description: "1–4 digits, above zero.",
    },
    {
      name: "departure",
      type: "ICAO",
      required: true,
      description: "Four letters.",
    },
    {
      name: "departureTime",
      type: "string",
      required: true,
      description: "Zulu `HHMM`.",
    },
    {
      name: "cruisingAltitude",
      type: "string",
      required: true,
      description: "1–12 characters, e.g. `FL361` or `36100`.",
    },
    {
      name: "arrival",
      type: "ICAO",
      required: true,
      description: "Four letters.",
    },
    {
      name: "alternate",
      type: "ICAO",
      description: "Four letters when given.",
    },
    {
      name: "hoursEnroute",
      type: "string",
      description:
        "1–2 digits. Likewise `minutesEnroute`, `fuelHours`, `fuelMinutes`; the minutes at most 59.",
    },
    {
      name: "route",
      type: "string",
      required: true,
      description:
        "Up to 1,000 characters; runs of whitespace collapse to one space.",
    },
    {
      name: "remarks",
      type: "string",
      description: "Up to 400 characters.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: '`{"status": 200, "message": "filed", "live": …, "data": <normalised plan>, "timestamp": …}`.',
    },
    {
      code: 400,
      when: "`invalidBody` — not JSON, or a field is not a string.",
    },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `flightplan`.",
    },
    {
      code: 409,
      when: '`{"error": "tracked", "controller": "<callsign>"}` — a controller holds the track; or `callsignInUse` — another member is connected on that callsign.',
    },
    {
      code: 422,
      when: '`{"error": "validation", "fields": {"<field>": "<reason>"}}` — one entry per failing field.',
    },
    { code: 429, when: "Rate limited." },
  ],
  example: {
    request: `curl -X POST '{origin}/api/v1/pilot/flightplan' \\
  -H 'Authorization: Bearer can_at_…' \\
  -H 'Content-Type: application/json' \\
  -d '{"callsign":"CCA1501","flightRules":"I","aircraft":"A320","cruiseTas":"450","departure":"ZBAA","departureTime":"0900","cruisingAltitude":"FL361","arrival":"ZSPD","route":"ELKUR A593 SASAN"}'`,
  },
  notes: [
    "A colon or a line break in `route` or `remarks` is refused (`structural`) rather than stripped: the plan becomes a colon-delimited, newline-terminated protocol packet, and either character would shift or split it.",
    "The reasons in `fields` are short keys — `callsign`, `icao`, `time`, `number`, `minutes`, `route`, `remarksLength`, `structural` and the like — meant to be translated by the caller.",
    "The off-block time is the simulator client's to set, and an edit made here keeps the stored one.",
  ],
};

const FLIGHTPLAN_DELETE: ApiEndpoint = {
  id: "flightplan-delete",
  methods: ["DELETE"],
  path: "/api/v1/pilot/flightplan",
  summary: "Withdraw the stored flight plan.",
  body: [
    'Clears the plan on file. It does not reach controllers: the protocol has no way to say "this flight has no plan any more", so an aircraft already flying keeps the plan it was given, and the radar-track lock does not apply.',
  ],
  auth: "oauth",
  scopes: ["flightplan"],
  cors: false,
  limitScope: "—",
  statuses: [
    {
      code: 200,
      when: '`{"status": 200, "message": "withdrawn", "timestamp": …}` — also when nothing was on file.',
    },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `flightplan`.",
    },
  ],
};

const SIMBRIEF_GET: ApiEndpoint = {
  id: "simbrief-get",
  methods: ["GET"],
  path: "/api/v1/pilot/simbrief",
  summary: "Which SimBrief account the member has linked.",
  body: [
    "`simbriefId` is the linked account's numeric SimBrief id as a string, or `null` when none is linked. Cheap: it reads the member's own record and calls nothing outside.",
  ],
  auth: "oauth",
  scopes: ["flightplan"],
  cors: false,
  limitScope: "—",
  statuses: [
    {
      code: 200,
      when: '`{"status": 200, "data": {"simbriefId": "123456"}, …}`.',
    },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `flightplan`.",
    },
  ],
};

const SIMBRIEF_LINK: ApiEndpoint = {
  id: "simbrief-link",
  methods: ["POST"],
  path: "/api/v1/pilot/simbrief",
  summary: "Link a SimBrief account.",
  body: [
    "Send a SimBrief Pilot ID or Navigraph username. It is proved against SimBrief before anything is stored, and what is stored — and returned — is the **numeric id** SimBrief reports, so a later rename of the alias does not break the link.",
  ],
  auth: "oauth",
  scopes: ["flightplan"],
  cors: false,
  limit: "simbriefLink",
  limitScope: "per member",
  fields: [
    {
      name: "identifier",
      type: "string",
      required: true,
      description:
        "Pilot ID or Navigraph username: up to 64 of letters, digits, `.`, `_`, `-`, starting with a letter or digit.",
    },
  ],
  statuses: [
    {
      code: 200,
      when: '`{"status": 200, "data": {"simbriefId": "123456"}, …}`.',
    },
    {
      code: 400,
      when: "`invalid_request` (not JSON) or `invalid_identifier`.",
    },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `flightplan`.",
    },
    {
      code: 404,
      when: "`not_found` — SimBrief has no saved flight for that account; or `invalid_plan` — it answered without the fields a plan needs.",
    },
    { code: 429, when: "Rate limited." },
    { code: 502, when: "`unreachable` — SimBrief did not answer." },
  ],
};

const SIMBRIEF_UNLINK: ApiEndpoint = {
  id: "simbrief-unlink",
  methods: ["DELETE"],
  path: "/api/v1/pilot/simbrief",
  summary: "Remove the SimBrief link.",
  body: ["Clears the link. The answer carries `simbriefId: null`."],
  auth: "oauth",
  scopes: ["flightplan"],
  cors: false,
  limitScope: "—",
  statuses: [
    { code: 200, when: '`{"status": 200, "data": {"simbriefId": null}, …}`.' },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `flightplan`.",
    },
  ],
};

const SIMBRIEF_IMPORT: ApiEndpoint = {
  id: "simbrief-import",
  methods: ["GET"],
  path: "/api/v1/pilot/simbrief/import",
  summary: "The linked account's latest SimBrief OFP, as a flight plan.",
  body: [
    "Fetches the newest OFP from SimBrief and converts it into the same plan object `POST /api/v1/pilot/flightplan` takes. **Returned, not filed, and not validated** — show it to the member, let them check it, then file it through the normal route, which is what validates it.",
  ],
  auth: "oauth",
  scopes: ["flightplan"],
  cors: false,
  limit: "simbriefImport",
  limitScope: "per member",
  statuses: [
    { code: 200, when: "`data` is the plan object." },
    { code: 401, when: "No credential, or the token is invalid or expired." },
    {
      code: 403,
      when: "`insufficient_scope` — the token does not carry `flightplan`.",
    },
    {
      code: 404,
      when: "`not_found` or `invalid_plan`, as for linking.",
    },
    { code: 409, when: "`not_linked` — no SimBrief account is linked." },
    { code: 429, when: "Rate limited." },
    { code: 502, when: "`unreachable` — SimBrief did not answer." },
  ],
};

/* ------------------------------------------------------------------ *
 * Network directory
 *
 * Unauthenticated reads that describe the network rather than a member: where
 * its servers are, what it is enforcing, and which navigation data cycle the
 * route resolver is on. None carries a session.
 * ------------------------------------------------------------------ */

const SERVERS: ApiEndpoint = {
  id: "servers",
  methods: ["GET"],
  path: "/api/v1/servers",
  summary: "Where the network's FSD, voice and datafeed servers are.",
  body: [
    "The addresses a client needs in order to connect, grouped by kind: `fsd` (FSD servers), `audio` (the Mumble voice server), `voice` (the newer can-voice server), `datafeed` (the live feed) and `automation` (the authenticated controller automation plane). Ask for this instead of compiling a hostname in — that is exactly what this endpoint exists to replace, and a client that reads it turns the network's next move into a row edit rather than a release.",
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
    {
      code: 500,
      when: '`{"error": "internal_error", …}` — the list could not be read.',
    },
  ],
  example: {
    request: "curl '{origin}/api/v1/servers'",
    response: `{
  "status": 200,
  "data": {
    "fsd": [
      { "id": 1, "kind": "fsd", "name": "Tokyo",
        "host": "fsd.ceruleanavi.net", "port": 6809, "location": "JP",
        "capabilities": [] }
    ],
    "audio": [
      { "id": 2, "kind": "audio", "name": "Tokyo",
        "host": "audio.ceruleanavi.net", "port": 64738, "location": "JP",
        "capabilities": [] }
    ],
    "voice": [],
    "datafeed": [
      { "id": 3, "kind": "datafeed", "name": "Primary",
        "url": "https://data.ceruleanavi.net", "capabilities": [] }
    ],
    "automation": []
  },
  "timestamp": "2026-08-19T10:31:02Z"
}`,
  },
  notes: [
    "**Fields that do not apply to a kind are absent, not `null`.** An `fsd`, `audio` or `voice` entry has `host` and `port` and no `url`; a `datafeed` or `automation` entry has an HTTPS `url` and neither. A client reading `port` off a datafeed row has misunderstood the kind, and an absent key says so louder than a null. `location` is absent when unset.",
    "`tlsPort` appears only on `fsd` entries that serve FSD over TLS; a client that sees it should connect there and never try the plaintext port. `capabilities` is always an array, possibly empty — an `automation` entry serves the shared automation plane only when it carries `atc:automation`.",
    "**`audio` and `voice` are different protocols that can share a host and port** (both listen on 64738). Ask for the kind your client speaks and ignore the rest.",
    "**A `datafeed` entry's `url` is an origin, not a path.** The feed publishes two paths under it (`/v1/data.json` and `/v1/events`) and different clients want different ones, so storing a complete URL could only ever satisfy one of them. Append the path you need.",
    'Retired servers are omitted from this list but are not deleted upstream — the row survives so that "where is your client pointed" stays answerable when somebody cannot connect.',
    "Cached for an hour (`Cache-Control: public, max-age=3600`). Respect it; the list changes a few times a year.",
  ],
};

const META_NAVDATA: ApiEndpoint = {
  id: "meta-navdata",
  methods: ["GET"],
  path: "/api/v1/meta/navdata",
  summary: "Which AIRAC cycle the route resolver is using.",
  body: [
    "The cycle of the navigation data `/api/v1/route` resolves against, its validity window, and whether it is current. A map can print it beside a drawn route, or warn when the data has expired.",
  ],
  auth: "none",
  cors: true,
  limitScope: "—",
  statuses: [
    { code: 200, when: "The cycle. `Cache-Control: no-store`." },
    {
      code: 503,
      when: "`navDataUnavailable`, `navDataMetadataMissing` or `navDataMetadataInvalid` — no navigation data, or no usable cycle information for it, on this instance.",
    },
  ],
  example: {
    request: "curl '{origin}/api/v1/meta/navdata'",
    response: `{
  "status": 200,
  "data": {
    "cycle": "2610",
    "version": "1",
    "valid_from": "2026-10-01",
    "valid_to": "2026-10-28",
    "expired": false,
    "status": "current"
  },
  "timestamp": "2026-10-24T08:00:00Z"
}`,
  },
  notes: [
    "`status` is `current`, `future` (the cycle has not started yet) or `expired`. `valid_from` and `valid_to` are `YYYY-MM-DD`; `cycle` is four digits.",
    "Keys are `snake_case` here, unlike most of can-api.",
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
    "The keys are lower-camel and are the same keys this page uses. A leading acronym is lowered up to the next word, so the OAuth buckets read `oAuthToken`, `oAuthUserinfo` — copy keys from this table rather than guessing them. A key vanishing is a limit that no longer exists, not a value of zero — treat a missing key as unlimited, which is what this page renders.",
    "Cached for an hour. The table only changes when can-api is redeployed.",
    "A limit being listed does not say what the bucket is *keyed by* — per IP, per member, per client. That varies per endpoint and is written beside each one above.",
  ],
};

export const API_GROUPS: ApiGroup[] = [
  {
    key: "oauth",
    name: "Unified sign-in",
    description:
      "Sign a member in with their CAN account, and act for them afterwards. Standard OAuth 2.1 authorization code + PKCE with OpenID Connect on top, so an off-the-shelf client library configured from the discovery document will work without anything bespoke. Register your application on this developer centre; using it needs developer access, which an administrator grants.",
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
      "The ATIS maker's weather line, the ATIS client's station configuration, and the raw METAR/TAF lookup — all called by software with no session to present. Note that another thing shares the name: `atis[]` in the network datafeed is who is broadcasting right now, which is runtime state and lives with the datafeed, not here.",
    icon: "speakerWave",
    endpoints: [ATIS, ATIS_CONFIG, METAR],
  },
  {
    key: "flight-data",
    name: "Flight data",
    description:
      "What the live map draws. Both are open for the same reason the map is: the positions are already public in the network datafeed, a track is the same information a few minutes older, and a route is what the pilot filed.",
    icon: "mapPin",
    endpoints: [TRACK, ROUTE],
  },
  {
    key: "datafeed",
    name: "Live network datafeed",
    description:
      "Who is connected right now, served by the FSD daemon on its HTTP hostname (`data.ceruleanavi.net`) rather than by can-api. The FSD protocol itself still listens on `fsd.ceruleanavi.net:6809`; that host does not serve this document over HTTPS. Two faces of one document: fetch `data.json` for a snapshot, or hold `/v1/events` open and receive only what changed. Neither needs a credential, and neither uses the `{status, data, timestamp}` envelope the rest of this page describes — here the document *is* the payload.",
    icon: "signal",
    endpoints: [DATAFEED, DATAFEED_EVENTS, DATAFEED_STATUS],
  },
  {
    key: "member-data",
    name: "Member data",
    description:
      "What an application may read and do **on a member's behalf** after they sign in through the flow above. Each route names the scope it requires, and a token without it gets 403 rather than an empty result. can-api's default is that no route accepts a token at all — these are deliberate exceptions, chosen because the data is the member's own and a flight bag or a logbook cannot work without it. None sends CORS headers to other sites: call them from your server or a native app.",
    icon: "userCircle",
    endpoints: [
      PILOT_FLIGHTS,
      PILOT_ATC,
      PILOT_DIVISIONS,
      AUTH_SESSION,
      FLIGHTPLAN_GET,
      FLIGHTPLAN_FILE,
      FLIGHTPLAN_DELETE,
      SIMBRIEF_GET,
      SIMBRIEF_LINK,
      SIMBRIEF_UNLINK,
      SIMBRIEF_IMPORT,
    ],
  },
  {
    key: "network",
    name: "Network directory",
    description:
      "Unauthenticated reads that describe the network rather than a member: where its servers are, what it is enforcing, and which navigation data cycle the route resolver uses.",
    icon: "globeAlt",
    endpoints: [SERVERS, META_LIMITS, META_NAVDATA],
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
    path: "The rest of /api/v1/pilot/*, plus /api/v1/activity/*, /api/v1/lottery/*, /api/v1/notifications/*, /api/v1/super/* and the rest of /api/v1/atc/*",
    reason:
      "Portal plumbing. Almost all of it needs a member's session cookie and refuses an access token outright; the one read that does not — the activity list and an activity's briefing — exists to draw a panel on the network's own sites, its shape follows whatever that panel needs, and it is not a contract with anyone outside the network's own repositories. The exceptions are documented above: the member routes an application can reach with a scope.",
  },
  {
    path: "/api/v1/weather/precipitation/{z}/{x}/{y}",
    reason:
      "The precipitation overlay of the network's flight bag. Every tile it does not already hold is fetched from an upstream weather provider under one network-wide rate budget, so a third-party map drawing from it would spend the flight bag's allowance. Not a contract.",
  },
  {
    path: "/api/v1/voice/update/… and /api/v1/voice/download/…",
    reason:
      "The voice clients' own updater feed and download relay, shaped for their updater. Like `/api/v1/clients/*` for the older clients, but there is nothing for a third party to build against.",
  },
  {
    path: "/api/v1/auth/token, /api/v1/voice/token",
    reason:
      "Exchange a CAN ID and network password for a short-lived token for the controller automation plane or the voice server. Each exists only on a deployment running that service, and each takes the member's network password — which is exactly what a third-party application must never ask for.",
  },
  {
    path: "/api/v1/bot/*",
    reason:
      "The network's community bot. Service tokens only, with bot scopes that are granted by hand and cannot be requested by a self-registered application.",
  },
  {
    path: "/v1/… bridge, /api/v1/atc/* and /healthz (can-fsd)",
    reason:
      "The FSD daemon's other HTTP routes: a key-guarded copy of the datafeed for the network's own relays, the controller automation plane (its own token, obtained with the network password), and a health probe. None is a third-party surface.",
  },
  {
    path: "/api/v1/leaderboard",
    reason: "Members only. Session cookie only; an access token is refused.",
  },
  {
    path: "/api/v1/atc/roster",
    reason:
      "Members only. It names every controller, and nothing reachable without a session serves member data beyond the CID. Session cookie only; an access token is refused.",
  },
  {
    path: "/api/v1/feedback",
    reason:
      "Members only, for the same reason: published cases name the members involved. Session cookie only.",
  },
  {
    path: "/api/v1/pilot/data",
    reason:
      "A member's own record — and it returns the cleartext FSD network password, which is why it is the one route that is deliberately never opened to an access token however narrow. An application allowed to read a flight log must not thereby be able to connect to the network as that member. Reachable with the session cookie only, from ceruleanavi.net itself.",
  },
  {
    path: "/api/v1/internal/flightplan (can-fsd)",
    reason:
      "Not can-api's at all: it is on the FSD daemon, beside the datafeed, and it is how can-api pushes a plan filed through `/api/v1/pilot/flightplan` into an already-connected pilot's live session. It exists only when the daemon is configured with a shared secret, that secret is its whole protection, and the daemon advertises only GET and OPTIONS for cross-origin requests — a browser's preflight for it fails by design, and a member's session can never be ridden into it.",
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
   * can-fsd's HTTP face — `https://data.ceruleanavi.net`. The only public
   * routes documented on it are the datafeed's; the daemon's other HTTP
   * routes are listed in `NOT_PUBLIC`. The FSD protocol host remains
   * `fsd.ceruleanavi.net:6809`.
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
