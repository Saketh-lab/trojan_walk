# TrojanWalk — PRD

Nov 15, 2026 · @Sketh

## Problem

Trojans walk alone at night for the trips that are too short for a Lyft and too long to feel fine: Leavey to the Lorenzo, a 9:50pm class to the Village, a club meeting to an apartment on 30th. Other Trojans are making the same walk within minutes of them, and there is no way to find each other.

USC already covers the ride case well. The [USC Lyft Rides Program](https://transnet.usc.edu/?p=31075) gives free Shared rides inside the UPC boundary from 7:00pm to 2:00am, and [USC Transportation](https://transnet.usc.edu/index.php/about-usc-rides-program/) reports over 30,000 rides a week. Its limits are the gap TrojanWalk fills:

- Shared only, and Lyft's own [case study](https://www.lyft.com/business/customer-stories/university-of-southern-california) notes weekend demand pushed wait times up. A 7-minute walk should not need a 12-minute wait.
- DPS's [LiveSafe app](https://dps.usc.edu/services/lyft-rides-program/) lets a friend watch your location, but it needs a friend who is awake and watching.
- Neither answers the actual question at 11:30pm: is anyone else walking this way right now?

TrojanWalk is the layer between walking alone and waiting for a car: verified Trojans, heading the same way, at the same time.

## Goals and non-goals

The hackathon build proves one thing: two verified Trojans who are about to make the same walk can find each other in under a minute without either one exposing where they are to a stranger.

Goals

- A student who feels uneasy can see, within seconds, whether other Trojans are walking nearby and which way.
- A student can ask people they trust, or vetted volunteers, to walk with them, and get an answer in under 2 minutes.
- Every walk has a safety net that escalates on its own if the walker stops responding.
- Nothing the app does makes a nervous, alone student easier for a bad actor to find.
- The data it produces (where and when Trojans walk alone) is something USG and DPS can act on.

Non-goals for this weekend

- Replacing Lyft Rides, LiveSafe or DPS. TrojanWalk sits between them.
- Any claim that matching makes a walk safe. It makes a walk less lonely and better watched.
- Teammate, study or social matching. That is a different product.
- Background location tracking when the app is closed. Location is shared only during an active session.

## Users

The primary user is any UPC student making a 5 to 15 minute walk between 9pm and 2am. Three situations cover most of them.

| Who | Typical walk | What they need |
| --- | --- | --- |
| Late studier | Leavey or Doheny to the Village, Lorenzo, Icon, Tuscany, or Gateway, 10pm to 2am | To see whether anyone else is leaving now, and fall in with them |
| Evening class or club member | A 7pm to 10pm class or a club meeting to an apartment west of Vermont or north of Jefferson | A recurring walk with the same few people every week |
| Student heading home from a social event | A friend's apartment or a Row event to their own place, often after midnight | A friend who will actually watch them get home, and a fast way to get a car if nobody is around |

A second user is the Trojan Walker: an upperclassman, RA, or org member who has opted in to being pinged when someone within about 100 meters wants company. They need the asks to be rare, nearby, and worth stepping out for.

The third user is USG and DPS. They do not use the app at night. They need the heatmap it produces: where and when students are walking alone, by block and half hour.

## Core concept: the escalation ladder

TrojanWalk is five rungs, and a student only climbs as far as they need. The rule that holds the ladder together: the person who feels unsafe receives information and never broadcasts it.

&#91;embedded content: escalation ladder · 5 rungs, who is told at each\]

Each rung widens who is told, from no one to trained responders. Rung 4 exists because many students will not call DPS or 911 unless it is dire; it broadcasts that someone needs a person, never where, and the requester approves one responder before any location is shared. The ladder also climbs on its own: a missed check-in moves a walk up one rung without the walker doing anything.

## Features

Build the MVP column and nothing else before the demo. Everything in v1 is a slide.

| Feature | MVP (Sunday demo) | v1 (first month) | Later |
| --- | --- | --- | --- |
| Sign-in | @usc.edu email magic link | USC SSO (Shibboleth) | Student ID photo check for Walkers |
| Friends | In-app friend adds; phone contacts matched by hashed number | Shared-context graph (same class, same hall) | Recurring walk groups |
| Walking alone toggle | On/off; shares coarse location to the server only while on | Auto-suggest when leaving a saved spot after 9pm | Apple Watch / widget toggle |
| Nearby map | Anonymous dots for verified Trojans within 150 m, with a heading arrow | Dots clustered by direction ("4 heading toward the Village") | Predicted flow in the next 10 min |
| Walk with me | One tap or a typed line sends "Sree wants company, Leavey to Lorenzo, leaving in 2 min" to friends on the app who are nearby | Also sends to people with shared context nearby | Recurring walks: same group auto-invited each week |
| Trojan Walkers | Opt-in role, five-question profile, badge on the dot, receives pings within 100 m from matching requesters | Vetting flow and monthly cap on pings | USG-run volunteer program with shifts |
| Broadcast | "I need someone now" to all verified users within 400 m, area only; responders apply; requester approves one; silent DPS log; nearest safe spot shown | Safe-spot list maintained with DPS; responder reputation | Blue-light phone and kiosk integration |
| Walking session | Starts when both accept; both see each other's live dot; ends on arrival | Shared public meeting point suggested | Group sessions of 3 or more |
| Safety check-in | "You good?" every 4 min with a 60 s countdown; no answer escalates one rung | Adaptive interval based on route | Fall / sudden-stop detection |
| Emergency | One tap sends live location to chosen contacts and opens LiveSafe / DPS (213-740-4321) | DPS dispatch integration if offered | 911 handoff with location |
| Lyft handoff | Button appears if no match in 3 min: opens Lyft with the destination prefilled | Shows Lyft ETA next to the match ETA | Auto-suggest Lyft when the route leaves the boundary |
| Heatmap (for USG/DPS) | Static slide from demo data | Weekly export: requests and broadcasts by block and half hour | Live dashboard for DPS |

## Trust and safety design

One rule governs everything: the person who feels unsafe receives information and never broadcasts it. An @usc.edu address proves enrollment, not character, and USC has roughly 50,000 people with one. So no feature ever tells strangers that a specific, frightened person is alone at a specific spot.

How each rung stays safe

- Ambient map: dots are anonymous, rounded to about 25 m, and show heading only. Nobody is notified that you are looking. Your own dot appears to others only while your toggle is on, so you are one of the dots, not the one looking.
- Friends on your route: the request goes to a trusted set, not a radius. Phone contacts and in-app friends first, then people who share context with you (same class, same hall). Contacts are matched by hashed phone number and never uploaded in the clear. Instagram is not used; its API does not expose follower lists to apps. Being friends in TrojanWalk never means sharing location. Unlike Find My, a friend sees nothing about you until you send a request, and sees your live dot only for the session they accepted, which ends on arrival. So people who would never share Find My can still be the ones who get pinged.
- Matched Trojan Walkers: opt-in role with a second verification step (ID photo in v1), a visible badge, ratings after each walk, a cap of 3 pings a night, and one-strike removal on any report. A five-question profile (gender, year, school, hall or area, contact preference) routes a request to Walkers who match the requester, not just the nearest.
- Broadcast the need, not the place: all verified users within 400 m see that someone near a landmark needs a person now, with no exact location and no name. Responders apply with name, photo, year and rating. The requester approves one, and only that person gets the live location. DPS receives a silent log entry when a broadcast fires, and the same screen shows the nearest staffed safe spot (Leavey 24-hour desk, Village security kiosk, nearest blue-light phone), which is usually faster than waiting for someone to arrive.
- Emergency: goes to trained responders (DPS, 911) and your chosen contacts, never to a crowd. A crowd at an incident is unpredictable, and false alarms would get the feature muted within a week.

Controls every user has

- Same-gender filter for who can see or answer a walk-with-me.
- Block and report in two taps; a reported user cannot see or match with the reporter again.
- Meeting points are limited to a list of lit, public spots (library entrances, Village plaza, gate kiosks), never an address.
- A session can be ended by either person at any time; ending it never notifies anyone except the user's own contacts.

What this does not do: matching and verification do not make a walk safe. Any real deployment needs DPS review, abuse testing with students, and a clear line in the app that says so.

## Key user flows

The demo flow is flow 2, then flow 4 if there is time. Build flow 2 end to end on two phones before touching anything else.

1. Ambient look (no match)
   1. Student leaves Leavey at 11:30pm, opens the app, turns on Walking alone.
   2. Map shows 3 anonymous dots within 150 m, two with arrows pointing toward the Village.
   3. Student walks out and falls in 20 m behind them. No tap, no message, no session.
2. Friends on your route (the demo)
   1. Phone A: Walking alone on. Taps Walk with me, types or says "leaving leavey in 2, heading to the lo." The app reads that as Leavey to the Lorenzo, leaving in 2 min.
   2. Server sends the request to A's contacts and in-app friends within 300 m, then to classmates and hall-mates nearby. Phone B (a friend) gets: "Sree wants company, Leavey to Lorenzo, leaving in 2 min. Walk together?"
   3. Phone B taps Yes. Both phones show the session: each other's live dot, a suggested meeting point (Leavey front steps), and the check-in timer.
   4. Every 4 min each phone asks "You good?" with a 60 s countdown. A tap clears it.
   5. Arrival at the Lorenzo geofence ends the session. Both get a one-tap rating. Location sharing stops.
3. Matched Walkers (no friend answers)
   1. No friend accepts within 2 min. The request goes to Walkers within 100 m whose profile matches A's (same gender if A set that, similar year, same area).
   2. A Walker accepts. A sees their name, photo, badge and rating before the session starts, and can decline.
   3. Session runs as in flow 2.
4. Broadcast (feels threatened, does not want police yet)
   1. A taps "I need someone now." Every verified user within 400 m gets: "Someone near Leavey needs a person right now. Can you come?" No pin, no name.
   2. A's screen shows two things at once: responders as they apply (name, photo, year, rating) and the nearest staffed safe spot with a walking time ("Leavey 24-hour desk, 1 min").
   3. A approves one responder. Only then does that person get A's live location and a route to them. DPS has already received a silent log entry with the broadcast's area and time.
   4. If A reaches the safe spot first, one tap cancels the broadcast and thanks responders. If anything escalates, the Emergency button is on the same screen.
5. No one around
   1. Walk with me goes out; nobody accepts within 3 min.
   2. App shows two options: Lyft (opens Lyft with the Lorenzo prefilled, free inside the boundary before 2am) or Walk with a watcher (a chosen contact gets the live dot and the check-in alerts, no second walker).
6. Missed check-in
   1. Countdown hits zero with no tap.
   2. Phone buzzes a second time for 30 s.
   3. Still nothing: the user's chosen contacts get the live location and a message, and the app shows a one-tap DPS call. The other walker in the session, if any, gets a prompt to check on them.
7. Trojan Walker
   1. Walker opts in during onboarding, completes the second verification, fills the five-question profile, sets hours (for example, 10pm to 1am on weeknights).
   2. Gets a ping only for requests within 100 m, inside their hours, from requesters their profile matches, at most 3 a night.
   3. Accepts, walks, gets rated. Three sessions in a month earns a badge.

## Data and privacy

The app stores as little as it can and forgets fast. Location exists on the server only while a toggle or session is on.

| Data | Stored? | For how long | Who can see it |
| --- | --- | --- | --- |
| @usc.edu address, display name | Yes | Account lifetime | The user; first name only to a matched walker |
| Live location while Walking alone is on | In memory, rounded to \~25 m | Dropped when the toggle goes off | Shown to others only as an anonymous dot |
| Live location during a session | Yes, precise | Deleted 1 hour after the session ends | The other walker and the user's chosen contacts |
| Walk-with-me requests (origin block, destination block, time) | Yes, with the user id removed | 12 months | USG/DPS heatmap, aggregated to block and half hour |
| Friends list, chosen contacts | Yes | Until the user removes them | The user only |
| Ratings, reports, blocks | Yes | Account lifetime | Moderators; the reported user never sees who reported them |
| Message content | No, there is no chat |  |  |

Never stored: location when the app is closed or the toggle is off, who looked at the map, who declined a request, a user's route history tied to their identity.

The heatmap is the only data that leaves the app, and it is aggregated before export. A block-and-half-hour cell with fewer than 5 requests is suppressed so no single walk can be picked out.

## Where the AI is

Route overlap is geometry, not AI, and a judge at an AI hackathon will say so. Say where the model does real work before they ask. Three places, in order of how much they matter for the demo.

1. Demand prediction (the one to show). From the request log, predict how many Trojans will be walking from a given spot toward a given area in the next 10 minutes. The product moment: a student opens the app at 11:28pm and sees "Wait 6 minutes. 3 people usually leave Leavey for the Village around 11:35 on weeknights." For the demo, train on seeded data from the team's own walks this week plus a plausible synthetic week; say that out loud.
2. Natural-language requests. "leaving leavey in 10, heading to lorenzo" becomes origin, destination, departure window, and group size, with no form. Also normalizes the dozens of ways students name the same place ("the Lo", "Lorenzo", "3rd floor Lorenzo"). One LLM call per request.
3. Anomaly detection on a session. Given the planned route and the live dot, flag a stop longer than 90 seconds off a known waiting spot, a reversal, or a turn off the route by more than one block. This is what fires the "You good?" early instead of waiting for the 4-minute timer. Start with rules; replace with a model once there are real sessions.

Not AI, and do not call it AI: matching by distance and heading, the geofence that ends a session, the check-in timer.

## Technical architecture and hackathon stack

A mobile web app, one backend, one realtime channel. No native build: a PWA opens from a QR code on stage and gets browser geolocation, which is all the demo needs.

| Layer | Choice | Why |
| --- | --- | --- |
| Client | React or Next.js PWA, Mapbox GL or Leaflet for the map | Runs on both demo phones from a URL; geolocation and push work in Safari and Chrome |
| Realtime | Supabase Realtime (Postgres + websockets) or Firebase | Presence (who is toggled on, where) and session updates with no server code to write |
| Backend | Supabase edge functions or a small FastAPI service | Matching query, request fan-out, check-in timers, Lyft deep link |
| Auth | Supabase magic link restricted to @usc.edu | Verification in one line; SSO is a v1 item |
| Geo | PostGIS on the Supabase Postgres | ST\_DWithin for "within 150 m", heading from the last two fixes, geofence on arrival |
| LLM | Claude or GPT API, one call per walk-with-me request | Parses free text into origin, destination, window; normalizes place names |
| Prediction | A notebook that bins seeded requests by origin, destination, weekday, half hour; served as a lookup table | Honest for a weekend; swap in a real model later |
| Push | Web Push for the walk-with-me ping; SMS fallback via Twilio to chosen contacts on a missed check-in | Contacts may not have the app |
| Lyft | Deep link `lyft://ridetype?id=lyft_line&destination[latitude]=...` with the destination prefilled | No API deal needed; the free pass is already on the student's Lyft account |

Matching query, in words: among users with Walking alone on, inside 150 m of the requester, whose heading is within 45 degrees of the requester's bearing to the destination, rank by friends first, shared context second, Walkers third. Send the request to the top set only.

What to fake for the demo: Walker vetting (a flag in the database), the prediction model (a lookup table), DPS integration (a phone link). Say so if asked. What must be real: two phones, live dots, the request and accept round trip, the check-in timer, the arrival geofence.

## Positioning and the path to USC adoption

The one-line position: Lyft is for the ride, LiveSafe needs a friend awake, TrojanWalk is for the ten-minute walk.

|  | Lyft Rides Program | LiveSafe (DPS) | DPS escort / Campus Cruiser | TrojanWalk |
| --- | --- | --- | --- | --- |
| What it does | Free Shared Lyft inside the UPC boundary, 7pm to 2am | Share location with a friend who watches; report tips to DPS | Officer or van escort on request | Find verified Trojans making the same walk now; watched session; escalation |
| Best for | Trips over \~15 min, bad weather, outside the walking zone | Someone with a friend awake to watch | Specific high-concern situations | 5 to 15 min walks when you would rather not be alone |
| Gap it leaves | Shared only; weekend waits rise; a 7 min walk is shorter than the wait | Needs a watcher; no way to find a companion | Limited capacity; wait times | Not a car; not an officer; needs enough users on at once |
| Cost to USC | Per ride | Existing contract | Staff time | Near zero to run; volunteers are students |

Path to adoption, in the order USG can actually do it

1. Pilot with two or three orgs and one residence hall as the first Walkers and first users. Enough density on a few routes beats thin coverage everywhere.
2. Hand DPS and USG the first month's heatmap. Where and when students walk alone, by block and half hour, is data neither office has today. It decides lighting, tram stops, and whether Lyft hours should shift.
3. USG runs the Trojan Walker program the way it runs other volunteer programs: shifts, a badge, recognition. The app is the dispatch layer.
4. DPS review of the escalation path, then a LiveSafe or dispatch integration so a missed check-in can reach an officer, not just a friend.
5. Add the Lyft handoff to USC Transportation's own pages so the two services point at each other.

## Success metrics

The product works if a walk-with-me request gets a yes fast, and if the people who said yes come back. Everything else is vanity.

| Metric | Target for a pilot month | Why it matters |
| --- | --- | --- |
| Time from request to accept | Median under 2 min on pilot routes | Longer than that and the student has already left alone |
| Request fill rate | Over 60% of requests get a companion or a watcher | Below that, users learn the app is empty at night |
| Toggle-on users between 10pm and 1am on a weeknight | 40 or more inside the pilot zone | The density needed for the ambient map to show anyone |
| Missed check-ins that escalated | 100% of them, within 90 s | The safety net has to be reliable or it is worse than none |
| False escalations | Under 1 in 20 sessions | Too many and people turn check-ins off |
| Walker repeat rate | Over half of Walkers accept 2 or more pings in the month | Volunteers who come back are the program |
| Reports per 100 sessions | Under 1, and every one actioned within 24 h | Trust |
| Heatmap delivered to USG and DPS | Once, with at least 200 requests behind it | The adoption hook |

## Risks and open questions

The two risks that kill it are an empty map at night and a safety incident during a matched walk. Everything in the trust section and the pilot plan is aimed at those two.

| Risk | How likely | What we do |
| --- | --- | --- |
| Nobody is toggled on when a student looks | High at launch | Pilot by route, not campus-wide; recurring walks seed density; Lyft handoff so the app is never a dead end |
| An incident between matched walkers | Low, severe | Trusted-set matching, Walker vetting, ratings, one-strike removal, public meeting points, no address sharing, clear language that matching is not safety |
| A judge says "just take the Lyft" | Certain | Lead with the weekend wait times and the 7-minute walk; show the handoff button, which proves we are not competing with Lyft |
| Location data leaks or is subpoenaed | Low | Precise location deleted 1 hour after a session; heatmap aggregated with small-cell suppression; no route history by identity |
| Check-ins annoy people into turning them off | Medium | 4-minute interval, one tap to clear, anomaly detection fires early so the timer can stay long |
| USC sees liability and asks it to be taken down | Medium | Go to DPS and USG first with the heatmap; position as a volunteer program they run, not a vendor app |
| Browser geolocation is flaky on the demo phones | Medium | Test in Ginsburg Hall in the morning; keep a fallback with two fixed demo positions |

Open questions

- [ ] Does DPS still run on-request walking escorts at UPC, or only the Lyft program? Decides whether Walkers are a new layer or a peer version of something that exists.
- [ ] What is the actual Lyft wait at 11pm on a Friday from Leavey? One week of spot checks is the number for the pitch.
- [ ] Will USC Housing let RAs serve as Walkers on duty nights?
- [ ] Does the free Lyft pass work with a deep link that prefills a destination, or only inside the app?
- [ ] Who at USG owns student safety this year, and can they be at the pitch?

## Build plan for today and the pitch

One rule for the day: flow 2 on two phones is done before anyone opens Figma for a slide. Confirm the demo time with the organizers first thing and work backward from it.

Build order (tick as you go)

- [ ] 00:30 Supabase project, @usc.edu magic link, a `presence` table (user, lat, lng, heading, toggled\_on, updated\_at) and a `sessions` table
- [ ] 01:30 PWA shell with the map, Walking alone toggle writing presence every 5 s, anonymous dots from presence within 150 m
- [ ] 03:00 Walk with me: request row, fan-out to friends within 300 m and Walkers within 100 m, push to Phone B, accept creates a session
- [ ] 04:30 Session view: both dots, meeting point, 4-minute check-in with 60 s countdown, arrival geofence ends it
- [ ] 06:00 Sleep. Nothing good ships between 6 and 9
- [ ] 09:30 Missed check-in path: SMS to a chosen contact via Twilio, DPS call button; Lyft deep link when no accept in 3 min
- [ ] 11:00 Natural-language request parsing (one LLM call) and the prediction lookup table from seeded data
- [ ] 12:00 Heatmap slide from the seeded requests; comparison slide (Lyft, LiveSafe, TrojanWalk); trust slide
- [ ] 13:00 Walk the demo in Ginsburg Hall on both phones, on venue wifi and on cellular. Fix geolocation. Record a backup video
- [ ] 14:00 Pitch run-through twice, with the DPS question asked cold

The 3-minute pitch

1. Problem (30 s). "It's 11:30 on a Tuesday. You're leaving Leavey for the Lorenzo. It's a 9-minute walk. The Lyft is 12 minutes out, and three other Trojans are about to make the exact same walk. You will never know."
2. Position (20 s). "USC covers the ride: 30,000 free Lyfts a week. LiveSafe covers the friend who's awake. Nothing covers the ten-minute walk. TrojanWalk does."
3. Demo (80 s). Phone A toggles on, sees dots. Taps Walk with me, says "leaving leavey in 2, heading to the lo." Phone B gets the ping, accepts. Session appears on both. Check-in fires, one tap clears it. Arrive, session ends. Then show the broadcast screen: the need goes out with no pin, a responder applies, A approves, and the nearest safe spot is right there.
4. Trust (30 s). "The person who feels unsafe never broadcasts where they are. Requests go to friends, then matched Walkers. If you feel threatened and don't want police yet, you can broadcast that you need a person, not your location, and you choose who comes. Emergencies go to DPS and your contacts, never to a crowd. Verification isn't safety, and the app says so."
5. For USG (20 s). Heatmap slide. "Every request is a data point: where and when Trojans walk alone, by block and half hour. Nobody at USC has this. It tells you where the lights go, where the tram stops, and when Lyft hours should shift. And the Walker program is yours to run."

Questions you will get, and the answer

- "Why not just take the Lyft?" Shared only, weekend waits climb, and a 7-minute walk is shorter than the wait. Our no-match screen hands you to Lyft; we complete it, we don't compete with it.
- "What stops someone using this to find a victim?" Nothing in the app reveals that a specific person is alone, afraid, or where they are. Dots are anonymous and rounded. Requests go to a trusted set. Walkers are vetted, matched to you, and rated. A broadcast carries a need and an area, never a pin, and the requester approves one responder before any location is shared. Emergency goes to DPS, not nearby users.
- "Why a broadcast at all? Isn't that what DPS is for?" A lot of students will not call DPS or 911 unless it's dire. Without rung 4 they walk alone and scared; with it they get a Trojan and a safe spot, and DPS is quietly logged in case it turns into more.
- "Where's the AI?" Demand prediction ("wait 6 minutes, 3 people usually leave now"), natural-language requests, Walker matching from the profile, and anomaly detection that fires the check-in early. Matching by distance is geometry, and we don't call it AI.
- "Cold start?" We pilot by route, not by campus: one hall, two orgs, Leavey to the Village. Contacts sync means your friends are there on day one. Recurring weekly walks seed density, and the Lyft handoff means the app is never a dead end.

Schema, queries, API and the Claude Code build order: Technical spec (Claude Code)
