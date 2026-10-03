# NAVI Product Vision

## Elevator Pitch

NAVI is an open-source indoor navigation platform that lets campus administrators author and publish navigable maps, and lets visitors route themselves from anywhere to anywhere via web or mobile.

NAVI consists of two applications:

- **NAVI Studio** — the authoring environment used by administrators.
- **NAVI Runtime** — the navigation application used by visitors.

## Who Is NAVI For?

**Primary: Campus Administrators**
- Facilities managers who need to map buildings, rooms, roads, and pathways
- IT staff who deploy and maintain the system
- Content authors who add panoramas, QR markers, and points of interest

**Secondary: Visitors**
- Students, faculty, and guests navigating a campus
- Anyone who needs to find a room, office, or service by searching or scanning a QR code

## What Problem Does NAVI Solve?

Indoor navigation is fragmented. Google Maps stops at the building entrance. Proprietary solutions are expensive, closed, and require custom hardware. NAVI is:

- **Open** — anyone can deploy it, extend it, or audit it
- **Authorable** — administrators map spaces using a visual editor, not CAD tools
- **Self-contained** — no dependency on third-party mapping services
- **Offline-capable** — published artifacts run without a live backend

## Administrator Experience

An administrator opens NAVI Studio and sees a canvas. They:

1. Create or open a campus
2. Add buildings with floor plans
3. Trace rooms, hallways, stairs, and elevators on each floor
4. Connect floors with transitions (stairs, elevators)
5. Connect buildings with roads and pathways
6. Place QR markers and panoramas at key locations
7. Validate the campus against structural rules
8. Publish — one click produces a deployable artifact bundle

The entire workflow stays inside the Studio. No external tools required.

## Visitor Experience

A visitor opens the NAVI app and:

- **Searches** for a room, office, or POI by name
- **Scans** a QR code to get instant location and directions
- **Navigates** with turn-by-turn guidance indoors and between buildings
- **Switches floors** seamlessly during a route
- **Views panoramas** at decision points for visual confirmation
- **Works offline** — routes are computed locally from the published bundle

## What "Feature Complete" Means for v1

NAVI v1 is complete when:

1. **An administrator can author a multi-building campus entirely in the Studio** — every editor tool works, validation catches common errors, publish produces a correct artifact bundle
2. **A visitor can navigate any route on that campus** — search, routing, QR, floor switching, and panoramas all function correctly
3. **The ASU campus is mapped with real data** — not placeholders
4. **Thesis metrics are collected** — usability, accuracy, performance

## What Is Out of Scope for v1

- Real-time GPS tracking (turn-by-turn with position updates)
- Crowd-sourced data or live traffic
- Turn-by-turn voice guidance
- Native mobile apps (mobile-web is the target)
- Multi-language support
- Collaborative multi-admin editing
- API for third-party integrations
- Analytics dashboard
- Accessibility compliance beyond standard web best practices

These may be addressed in future versions.

## Design Principles

From the Constitution, adapted for the product phase:

- **The administrator workflow is the backbone.** Every editor feature exists to make the "Create → Trace → Connect → Validate → Publish" flow complete.
- **The visitor route is the test.** If a route from any A to any B fails, the system is broken.
- **Real data before polish.** Map the real campus before optimizing load times or adding animations.
- **One click to publish.** The gap between authoring and deployment should be zero.
- **Offline by default.** The runtime must work without a server.
- **The real campus is the source of truth.** Features should be validated against the physical campus, not against artificial datasets. A successful demo is not enough — the software must solve the real navigation problem at ASU-Ibajay.
