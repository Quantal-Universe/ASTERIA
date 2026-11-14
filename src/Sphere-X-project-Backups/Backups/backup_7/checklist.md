# ASTERIA feature checklist

This checklist describes the features present in the active `src` app. It distinguishes code that is implemented from features that depend on live services or have scientific limitations.

**Status:** `[x]` implemented in code · `[~]` implemented with a limitation or dependent on live data/service validation · `[ ]` not implemented

## Search and target selection

- [x] Search preset targets, object names, target types, and coordinates from the dashboard.
- [x] Debounced search, keyboard navigation of result choices, and clear-search control.
- [x] Resolve names through astronomical name-resolution services.
- [x] Parse decimal-degree and sexagesimal RA/Dec and validate coordinate ranges.
- [x] Search the live SPHEREx IRSA TAP archive and show matching observation IDs and positions.
- [x] Browse preset science targets, survey fields, and recent sky-map searches.
- [x] Show a selected object's name, type, coordinates, distance estimate/description, archive coverage, and summary.
- [~] Search and archive results depend on network access and upstream catalog/archive availability.

## Detailed Sky Map

- [x] Open the full-screen Detailed Sky Map from the dashboard without requiring OpenRouter authentication.
- [x] Pan and zoom an interactive Aladin Lite sky view with coordinate grid and cursor coordinates.
- [x] Choose among optical DSS2, 2MASS, AllWISE, and Gaia image surveys; DSS2, 2MASS, and AllWISE use ESA HiPS mirrors while the CDS image service is degraded.
- [x] Search the map by resolved object name or decimal/sexagesimal coordinates.
- [x] Change field of view and drag or keyboard-move a selection box to choose the field center.
- [x] Click a sky position or load the selected field into the research viewer.
- [x] Jump to preset targets and revisit recent searches.
- [~] Toggle Gaia DR3, AllWISE, and SPHEREx observation overlays; availability and returned rows depend on external services and loaded catalog results.
- [~] Coverage markers represent returned observation positions, not complete exposure footprints.
- [~] Marker details and known-object checks are limited to fields and catalogs loaded for the current view; this is not a complete SIMBAD cross-match.
- [~] SPHEREx calibrated cutouts are loaded in the research viewer; they are not an Aladin image-survey layer.

## SPHEREx observations and Blink Viewer

- [x] Query QR2/QR3 archive data and organize dated observations into timeline epochs.
- [x] Load real image cutouts on request, with progress feedback and errors when no coverage or products are available.
- [x] Choose a detector array (D1–D6) or request a sample across arrays; select among available wavelength bands.
- [x] Play/pause, change playback speed, step frames, and scrub through loaded cutouts.
- [x] Display frame date, wavelength/band, detector, exposure and release metadata when supplied by the archive.
- [x] Zoom and pan the image, show the target crosshair, and inspect pixel values.
- [x] Select brightness stretch (linear, log, asinh), palette, and quality-flag display behavior.
- [~] Difference mode compares available matching image pixels; frames are not guaranteed to be WCS-registered.
- [~] Stack mode combines available quick-look pixels; it is not a calibrated science coadd.
- [~] RGB composite uses only detector arrays present in the loaded sample.
- [~] Motion trail uses available catalog motion; it is not an independently detected per-frame trajectory.
- [x] Compare frames side by side and use keyboard playback/step shortcuts.
- [~] Data availability, archive throughput, and cutout rendering depend on the live IRSA service and selected target.

## Spectrum and source analysis

- [x] Load available calibrated target-pixel wavelength samples from archive products and plot them in the spectrum panel.
- [x] Show wavelength/flux hover values, detector toggles, uncertainty/quality indicators where available, and approximate molecule-region markers.
- [x] Export available spectrum samples and metadata to CSV or the graph to PNG.
- [~] Spectrum samples are a quick-look subset of recent products, not a complete 102-band extraction or PSF-extracted point-source spectrum.
- [~] Compare the target with a nearby loaded Gaia source when suitable measurements are available.
- [~] Plain-language spectrum notes flag possible relative dips for review; they are not molecular detections.
- [x] Find candidate image changes and support clicking a source in two frames to estimate apparent motion.
- [~] Candidate changes and motion estimates require visual/scientific review; registration, source identity, and image quality can limit them.
- [~] Distance estimates from proper motion rely on available catalog parallax/motion inputs and are not independent distance measurements.
- [x] Export a discovery report with target/frame details and an image snapshot.

## Catalogs and context

- [x] Load Gaia DR3, SIMBAD named-star, and SPHEREx archive context for a selected field where service queries return data.
- [x] Show source hover information such as coordinates, source/catalog, magnitude, classification, and available motion/distance fields.
- [x] Draw target surroundings and compare selected targets with available catalog sources.
- [~] Catalog search regions and result counts are bounded; source classifications are candidates, not confirmations.
- [~] Constellation labels use a simplified coordinate-region approximation.

## Sharing, export, and onboarding

- [x] Copy a share link and restore supported target, map center, field of view, release, detector, band, frame, viewer mode, and display options from URL parameters.
- [x] Generate an iframe embed snippet.
- [x] Export a loaded blink animation as GIF or WebM, and download a PNG screenshot/cutout.
- [x] Guided tour and practice flow using WISE 0855-0714.
- [x] Light/dark theme preference and responsive layout for smaller screens.
- [x] Keyboard focus styles, accessible labels/status announcements on key controls, and color-aware image palettes.
- [~] Some secondary controls and visualizations may not yet have complete screen-reader descriptions or tooltips.

## Research Chat and settings

- [x] Use OpenRouter/DeepSeek research chat when a user connects an OpenRouter account.
- [x] Keep sky map, archive, viewer, and spectrum features available when no OpenRouter session exists; authentication gates chat only.
- [x] Show chat connection state, support reconnect, clear the conversation, and limit chat history sent by the app.
- [x] Store the OpenRouter session through Electron secure storage where the operating system supports it; settings can sign out and remove the local session.
- [~] Chat requires network access, a valid OpenRouter session, and upstream model availability.

## Data, setup, and remaining work

- [x] Keep shared QR2/QR3 release configuration and archive/data operations separate from the renderer UI.
- [x] Cache downloaded cutouts in memory for repeat views during the same app session.
- [x] Provide user-facing handling for invalid input, unavailable catalogs, missing observations, and service errors.
- [~] Aladin Lite, Tailwind, fonts, and icon assets are loaded from external CDNs; offline startup has reduced functionality.
- [~] Validate the application in a running Electron window after the host Mac is available; this session could not open the app because the Mac was locked.
- [ ] Publish a hosted public demo and record a short demo video; this requires a hosting destination and recording.

## Suggested end-to-end walkthrough

1. Open **Detailed Sky Map**, search for Barnard's Star or choose WISE 0855, and inspect map layers and coordinates.
2. Click **Load selected field in research view**, then load available SPHEREx cutouts.
3. Step or play the dated images, inspect a source, and compare/difference frames.
4. Load available spectrum samples and review their caveats and quality flags.
5. Export a discovery report or share the current view.
