# ASTERIA

ASTERIA is an Electron desktop prototype for exploring SPHEREx time-domain observations alongside Gaia and other sky catalogs. It combines the existing research chat and infrared spectrum panel with a detailed sky map and a FITS cutout blink viewer.

## Run locally

```sh
cd src
npm install
npm start
```

The app needs an internet connection to query IRSA and the external catalog/image services. Open the **Detailed sky map** to search for a target or enter coordinates. Select a target, then use **Load image cutouts** to request real calibrated SPHEREx images. Network coverage, archive availability, and DNS behavior vary by target and environment.

## Data and interpretation

- SPHEREx image cutouts and spectrum samples are fetched on demand from IRSA. QR2 and QR3 are configurable releases, with fallback to the other release when the requested one has no coverage.
- Image cutouts are quick-look FITS pixels, not source-extracted photometry. Difference, stack, and motion tools do not replace WCS registration or validated astrometry.
- The infrared graph plots available target-pixel measurements. Its quick-look product limit is up to 17 products per detector; it does not guarantee a complete set of 102 wavelength bands.
- Gaia and catalog overlays depend on live service availability. Observation-footprint points indicate returned observations, not a complete sky-coverage map or object detections.
- Candidate detections and spectral captions are exploratory hints, not scientific classifications or molecular detections.

## Current limitations

The viewer exports PNG screenshots, animated GIF, and browser-supported WebM video. MP4 export, a fully draggable map field-of-view box, registered astrometry, a complete SPHEREx coverage footprint, public hosting, README screenshots, and a recorded demo video are not included yet. A public deployment also requires a hosting destination and deployment authorization.

## Validation

`npm test` is currently a placeholder in `package.json`; it does not run an automated test suite.
