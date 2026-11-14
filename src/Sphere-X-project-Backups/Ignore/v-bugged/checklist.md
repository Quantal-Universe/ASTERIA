    # Checklist by app component, with functionality

    I've organized this by the parts of the app, so each box says what the thing is and what it does.

    Status key: `[x]` implemented in code; `[~]` partial/limited or not live-validated; `[ ]` not implemented or requires external work.

    ## 1. Star Map (sky map panel) - idea is that here yu. know on left bar underneath thte reuslts there hsoulkd be a button called detailed sky map and you can search over there as well. 
    *Built with Aladin Lite, which is free and handles most of this for you.*

    - [x] **Interactive all-sky map** that you can pan and zoom
    - [x] **Click anywhere to select a patch.** The map center can be selected as the target; image cutouts load on request
    - [x] **Draggable box showing the field of view,** resizing as the user changes FOV
    - [~] **Survey layer switcher** (WISE, Gaia, optical, and available Aladin surveys); SPHEREx imagery is not a survey layer here
    - [~] **Catalog overlays:** Gaia stars and AllWISE sources as toggleable markers; live service support is required
    - [~] **Click a marker** to show available name, magnitude, and proper motion (depends on catalog fields)
    - [~] **"Known object?" check:** checks loaded catalogs, not a complete SIMBAD cross-match for every map click
    - [~] **Coverage indicator** uses returned SPHEREx observation points, not full observation footprints; warns when no points are returned
    - [x] **Preset pins** for the five test targets
    - [x] **Grid and coordinate readout** that follows the cursor
    - [~] **Sync with the blink viewer:** map center/target and view URL are synchronized; there is no continuously linked WCS-registered image view

    ## 2. Search and coordinate input
    - [x] RA/Dec fields accepting **decimal degrees and sexagesimal** (08h55m10.8s)
    - [x] **Name search** with catalog/name-resolution services (CDS Sesame + SIMBAD)
    - [x] **Live SPHEREx TAP Archive Search:** Real-time queries to IRSA TAP (`spherex.obscore`) for legitimate observations, observation IDs, and coordinates
    - [x] **Input validation** with friendly error messages
    - [x] **Preset buttons** for all test targets plus live archive survey observations
    - [x] **Recent searches** list
    - [x] **FOV slider** with an indication that larger fields take longer to load

    ## 3. Blink Viewer (the core)
    - [x] **Animated cutouts** over time, loaded on demand from IRSA
    - [x] **Play/pause, speed slider, frame-by-frame stepping,** and a scrubber bar
    - [x] **Timestamp and date** on every frame
    - [x] **Loading progress bar** while image cutouts download
    - [x] **Brightness stretch** (linear, log, asinh) and colormap choice
    - [x] **Zoom and pan** inside the image
    - [x] **Crosshair** follows the selected sky coordinate in each cutout
    - [~] **Difference mode:** subtracts matching detector/wavelength pixels; images are not WCS-registered
    - [~] **Add/stack mode:** combines matching quick-look pixels; not a calibrated science stack
    - [~] **Motion trail overlay:** shows available Gaia/catalog motion; not a measured per-frame source trajectory
    - [x] **Side-by-side comparison** of matching frames from the loaded set
    - [x] **Keyboard shortcuts** (space = play, arrows = step)

    ## 4. Band and detector controls
    - [x] **Select detector array** (six arrays) or load a small sample from all six arrays
    - [~] **Band selector:** chooses from loaded wavelength samples; it cannot guarantee all 102 bands
    - [~] **False-color composite** from three chosen detector arrays when those arrays were loaded
    - [x] **Quality toggle** to hide or flag quality-flagged pixels

    ## 5. Spectrum Panel (your signature feature)
    - [~] **Click a source** in the image to plot available target-pixel measurements; not a full 102-band extraction
    - [x] **Hover tooltips** on the plot showing wavelength and flux
    - [x] **Molecule markers** labeling approximate water, CO2, and CO regions
    - [~] **Compare two sources** on one plot (target vs. a nearby loaded Gaia star when data is available)
    - [x] **Download spectrum** as CSV or PNG
    - [~] **Plain-language caption** reports possible relative dips with explicit caveats; it does not claim a molecular detection

    ## 6. Metadata and Info Panel
    - [x] Per-frame **observation date, band, detector, and exposure duration**
    - [~] **Quality flags** shown as colored pixels and counts; flag-specific contamination explanations are not available
    - [x] **Data release version** shown on loaded frames
    - [x] **Object info card** for the selected target (type, distance, and description)

    ## 7. Discovery Tools (what makes it feel like citizen science)
    - [~] **Auto-detect candidates:** flags high-significance image changes; candidates are unverified and images are unregistered
    - [~] **Measure motion:** approximate image-plane arcsec/year; WCS alignment and source identity must be verified
    - [x] **Distance estimate** for nearby movers from their motion
    - [x] **"Report a discovery" button:** exports coordinates, frame metadata and pixel values as CSV plus a PNG snapshot
    - [x] **Practice mode** using WISE 0855-0714 as a guided example

    ## 8. Sharing and embedding
    - [~] **URL parameters** restore target, field of view, detector, release, band, frame, and supported viewer mode; not all display preferences are serialized
    - [x] **Copy-link button**
    - [x] **Embed code generator** (iframe snippet)
    - [x] **Export animation** as GIF (WebM export is also available; MP4 is not)
    - [x] **Download screenshot** as PNG

    ## 9. Onboarding and accessibility
    - [x] **Guided tour** walking through WISE 0855 step by step
    - [~] **Tooltips** on primary controls; not every control has one
    - [x] **Colorblind-aware palettes** and keyboard navigation
    - [x] **Mobile-responsive layout**
    - [x] **Light/dark mode** (dark by default)

    ## 10. Under the hood
    - [x] **Data layer separated from the UI,** with shared QR2/QR3 release configuration
    - [x] **Caching** of cutouts in memory for repeat views in the same app session
    - [x] **Graceful error handling** for no data, archive failures, and bad input
    - [~] **Open-source repo** with setup README; screenshots are not included
    - [ ] **Live deployed URL** and a 1-2 minute demo video (requires a hosting destination and an actual recording)

    ## How the pieces connect (the user flow)
    1. User clicks the **Star Map** or types a name → coordinates fill in
    2. **Blink Viewer** loads cutouts and animates them
    3. User toggles **Difference mode** → the mover pops out
    4. User clicks the mover → **Spectrum Panel** shows its infrared fingerprint
    5. User hits **Report** or **Share** → link or CSV is created

    This flow is a strong demo script, since it shows every major feature in about a minute.
    
Since 2025, NASA’s SPHEREx mission has been mapping the entire sky every six months in 102 bands of near-infrared light, returning images of more than a billion objects. Comets, asteroids, stars, brown dwarfs, and even new planets reveal themselves by shifting position between images, but no one person can sift through all that data alone. Your challenge is to create a public-facing web tool to display images of the sky from SPHEREx mission, making it easy for anyone to quickly see how they change over time.

Background
Asteroids and comets orbit around the Sun. Nearby stars march across the sky as they orbit around the Galaxy. The Earth orbits the Sun too, causing objects near us to change their apparent positions. Watching for these motions help us discover new astronomical objects and also help measure the distances to these objects. For example, the dwarf planet Pluto was discovered when an astronomer compared two images of the sky taken at different times and recognized that one point of light had shifted between images.

More recently, astronomers have mounted massive searches for nearby objects using this process with help from the public. Hundreds of thousands of volunteers have used this technique to discover asteroids, comets, stars and brown dwarfs—balls of gas too massive to be considered planets yet without enough mass to burn like stars. In fact, most of the known comets and brown dwarfs were discovered by volunteers in this manner through projects like backyardworlds.org.

Since May 2025, NASA’s new SPHEREx mission has been returning unique data that could yield new discoveries. SPHEREx is mapping the whole sky once every six months in 102 bands of near-infrared light, making it uniquely sensitive to objects that are rich in hydrogen, water, carbon dioxide, carbon monoxide, and many other molecules. There will be too much data for any one person or even computer code to completely comprehend. There will be images of more than a billion objects - including brown dwarfs, quasars, comets, asteroids, stars, supernovae and galaxies - which often overlap or vary in brightness. We need your creative new tools to make the most of this treasure trove and help as many people as possible pitch in to make discoveries.

Objectives
Your challenge is to create a public-facing web tool to display images of the sky from the SPHEREx mission, making it easy for anyone to quickly see how they change over time. Users will enter the coordinates of a patch of sky (Right Ascension and declination). Your tool will display a series of images of that patch like a little video, making it easy to spot moving objects.

Test your tool on Barnard’s Star, Epsilon Indi B (a pair of brown dwarfs orbiting a star), WISE 0855 (a fast-moving brown dwarf Right Ascension 08h55m10.831s, declination -7d14m42.53s), and variable stars RW Aurigae and R Draconis.

Potential Considerations
You may (but are not required to) consider the following:

New SPHEREx data is arriving fast! Make sure to design a tool that’s easy to update with the latest data releases.
Think creatively about how to display those 102 infrared bands so users can take advantage of them to make new discoveries! For example, it may make sense to separately add together all the data taken by each of the six detector arrays to improve the signal-to-noise in the images you display. Extra kudos if your tool can generate spectra on the fly.
It may help users discover moving objects if they have the options to add together or subtract images taken at different times.
Let users choose the field of view! Larger fields of view can make it possible to track faster-moving sources, at the cost of longer data transfer times.
Users could benefit from having the option to overlay astronomical data from other telescopes, such as the Gaia mission or the WISE mission.
If you make it possible to query your tool by including coordinates in the URL, users will be able to easily embed it in other websites and projects.
It can be useful to display metadata, like contamination flags.
Consider looking for publicly available tools that may help in handling astronomical data, like the Astrophy tools, and in displaying astronomical data, like the Aladin tool developed by the Strasbourg Astronomical Data Center (CDS).
For data and resources related to this challenge, refer to the Resources tab at the top of the page. More resources may be added before the hackathon begins.