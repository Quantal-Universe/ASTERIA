const SPHEREX_RELEASES = Object.freeze(['spherex_dr1', 'spherex_qr3', 'spherex_qr2']);

function getReleaseFallback(collection) {
  return collection === 'spherex_qr3' ? 'spherex_dr1' : 'spherex_qr3';
}

module.exports = {
  SPHEREX_RELEASES,
  getReleaseFallback
};
