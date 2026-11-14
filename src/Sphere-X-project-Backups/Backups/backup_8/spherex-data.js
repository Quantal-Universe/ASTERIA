const SPHEREX_RELEASES = Object.freeze(['spherex_qr2', 'spherex_qr3']);

function getReleaseFallback(collection) {
  return collection === 'spherex_qr2' ? 'spherex_qr3' : 'spherex_qr2';
}

module.exports = {
  SPHEREX_RELEASES,
  getReleaseFallback
};
